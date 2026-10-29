/** @odoo-module */

import { registry } from "@web/core/registry";
import { reactive } from "@odoo/owl";
import { uuidv4 } from "@point_of_sale/utils";
import { offlineDB } from "./offline_db";
import { mirrorOrderToIndexedDB } from "./pos_db_offline";

const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 30000;
const CONNECTIVITY_CHECK_MS = 15000;
const BASE_RETRY_MS = 5000;
const MAX_RETRY_MS = 5 * 60 * 1000;
const SYNCING_STALE_MS = 60000;

function backoffDelay(attempts) {
    return Math.min(BASE_RETRY_MS * Math.pow(2, attempts), MAX_RETRY_MS);
}

function errorMessage(err) {
    if (!err) {
        return "";
    }
    if (typeof err === "string") {
        return err;
    }
    return (
        (err.data && (err.data.message || err.data.debug)) ||
        err.message ||
        String(err)
    );
}

export const offlineSyncService = {
    // Jangan bergantung pada service "pos": akses lazy via env.services.pos
    // agar service ini tidak memaksa POS store start lebih awal.
    dependencies: ["orm"],
    start(env, { orm }) {
        const state = reactive({
            online: navigator.onLine,
            pending: 0,
            syncing: false,
            lastError: "",
            lastSyncAt: null,
            lastResult: null, // { synced, duplicate, failed }
        });

        const getPos = () => env.services.pos;
        const notify = (msg, ms = 5000) => {
            try {
                const n = env.services.pos_notification;
                if (n) {
                    n.add(msg, ms);
                }
            } catch (err) {
                console.warn("[pos_offline_sync] notifikasi gagal", err);
            }
        };

        async function refreshCount() {
            try {
                state.pending = await offlineDB.count();
            } catch (err) {
                console.warn("[pos_offline_sync] count gagal", err);
            }
        }

        /**
         * Order yang sudah ada di antrean PosDB sebelum modul ini dipasang
         * (atau yang terlewat mirror) ikut dicatat ke IndexedDB. UUID juga
         * ditulis balik ke PosDB agar push bawaan membawa UUID yang sama.
         */
        async function backfillFromPosDB() {
            const pos = getPos();
            if (!pos || !pos.db) {
                return;
            }
            for (const record of pos.db.get_orders()) {
                const data = record.data || {};
                if (!data.offline_uuid) {
                    data.offline_uuid = uuidv4();
                    try {
                        pos.db.add_order(data);
                    } catch (err) {
                        console.warn("[pos_offline_sync] backfill PosDB gagal", err);
                    }
                }
                await mirrorOrderToIndexedDB(data);
            }
        }

        async function failBatch(batch, err) {
            const now = Date.now();
            const updates = batch.map((record) => {
                const attempts = record.attempts + 1;
                return {
                    ...record,
                    status: "pending",
                    attempts,
                    next_retry_at: now + backoffDelay(attempts),
                    last_error: errorMessage(err),
                };
            });
            await offlineDB.upsertMany(updates);
        }

        /**
         * Kirim antrean ke backend secara batch. Idempotent — order yang sudah
         * ada di server (UUID sama) dikeluarkan dari antrean; yang gagal
         * dijadwalkan ulang dengan exponential backoff.
         *
         * @param {boolean} force abaikan navigator.onLine (retry manual).
         */
        async function flush(force = false) {
            if (state.syncing) {
                return;
            }
            if (!navigator.onLine) {
                setOnline(false);
                if (!force) {
                    return;
                }
            } else if (!state.online && !force) {
                return;
            }

            state.syncing = true;
            try {
                await offlineDB.recoverStaleSyncing(SYNCING_STALE_MS);
                const pos = getPos();
                const busyUids = (pos && pos.syncingOrders) || new Set();

                while (true) {
                    const batch = (await offlineDB.getSyncable())
                        .filter((record) => !busyUids.has(record.uid))
                        .slice(0, BATCH_SIZE);
                    if (!batch.length) {
                        break;
                    }

                    const now = Date.now();
                    await offlineDB.upsertMany(
                        batch.map((record) => ({
                            ...record,
                            status: "syncing",
                            last_attempt: now,
                        }))
                    );

                    let results;
                    try {
                        results = await orm.call(
                            "pos.order",
                            "sync_offline_orders",
                            [batch.map((record) => record.order)]
                        );
                    } catch (err) {
                        // RPC gagal (koneksi putus / error server):
                        // kembalikan seluruh batch ke pending + backoff.
                        setOnline(false);
                        state.lastError = errorMessage(err);
                        await failBatch(batch, err);
                        break;
                    }

                    const byUid = new Map(
                        (results || []).map((res) => [res.uid, res])
                    );
                    const summary = { synced: 0, duplicate: 0, failed: 0 };
                    const errors = [];
                    const doneUids = [];
                    for (const record of batch) {
                        const res = byUid.get(record.uid) || {
                            status: "failed",
                            error: "no result returned",
                        };
                        if (res.status === "synced" || res.status === "duplicate") {
                            doneUids.push(record.uid);
                            summary[res.status] += 1;
                        } else {
                            const attempts = record.attempts + 1;
                            await offlineDB.upsert({
                                ...record,
                                status: "failed",
                                attempts,
                                next_retry_at:
                                    Date.now() + backoffDelay(attempts),
                                last_error: res.error || "",
                            });
                            summary.failed += 1;
                            if (res.error) {
                                errors.push(
                                    `${res.pos_reference || record.uid}: ${res.error}`
                                );
                            }
                        }
                    }
                    await offlineDB.removeMany(doneUids);
                    // Keluarkan juga dari antrean PosDB agar push bawaan
                    // tidak mengirim ulang order yang sudah aman di server.
                    if (pos && pos.db) {
                        for (const uid of doneUids) {
                            try {
                                pos.db.remove_order(uid);
                            } catch (err) {
                                console.warn(
                                    "[pos_offline_sync] remove_order gagal",
                                    err
                                );
                            }
                        }
                    }
                    state.lastResult = summary;
                    state.lastSyncAt = Date.now();
                    state.lastError = errors.join("\n");
                    setOnline(true);

                    if (
                        summary.synced + summary.duplicate > 0 &&
                        !(await offlineDB.getSyncable()).length &&
                        (await offlineDB.count()) === 0
                    ) {
                        notify("Semua transaksi offline berhasil tersinkron ke server.");
                    } else if (summary.failed > 0) {
                        notify(
                            `${summary.failed} transaksi gagal disinkronkan — dicoba ulang otomatis.`
                        );
                    }
                }
            } finally {
                state.syncing = false;
                await refreshCount();
            }
        }

        /**
         * navigator.onLine dan event online/offline tidak selalu akurat —
         * misalnya toggle "Offline" di DevTools Chrome tidak mengubahnya.
         * Heartbeat RPC berkala memastikan status offline terdeteksi apapun
         * cara koneksi terputus.
         */
        function setOnline(value) {
            if (state.online === value) {
                return;
            }
            state.online = value;
            if (!value) {
                notify(
                    "Koneksi terputus — mode offline aktif, transaksi disimpan ke antrean lokal (IndexedDB).",
                    8000
                );
            } else {
                state.lastError = "";
                offlineDB
                    .resetRetries()
                    .catch(() => {})
                    .finally(() => flush().catch(safeFlushError));
                notify("Koneksi kembali — menyinkronkan antrean offline…", 4000);
            }
        }

        async function checkConnectivity() {
            if (!navigator.onLine) {
                setOnline(false);
                return;
            }
            try {
                // POST JSON-RPC via orm.silent: transport yang sama dengan
                // sync order (XHR, bukan GET yang bisa dijawab cache/service
                // worker), tanpa dialog error saat koneksi putus.
                await orm.silent.call("pos.order", "sync_offline_orders", [[]]);
                setOnline(true);
            } catch (err) {
                setOnline(false);
            }
        }

        function onOnline() {
            checkConnectivity();
        }

        function safeFlushError(err) {
            console.warn("[pos_offline_sync] flush error", err);
        }
        function onOffline() {
            setOnline(false);
        }

        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);

        const connectivityTimer = setInterval(
            checkConnectivity,
            CONNECTIVITY_CHECK_MS
        );

        const interval = setInterval(() => {
            if (state.online) {
                flush().catch(safeFlushError);
            } else {
                checkConnectivity();
            }
        }, FLUSH_INTERVAL_MS);

        offlineDB.onChange(refreshCount);

        const init = async () => {
            try {
                await offlineDB.open();
                const pos = getPos();
                if (pos && pos.ready) {
                    await pos.ready;
                }
                await backfillFromPosDB();
            } catch (err) {
                console.warn("[pos_offline_sync] init gagal", err);
            } finally {
                await refreshCount();
                checkConnectivity();
            }
        };
        init();

        return {
            state,
            flush,
            refreshCount,
            checkConnectivity,
            destroy() {
                clearInterval(interval);
                clearInterval(connectivityTimer);
                window.removeEventListener("online", onOnline);
                window.removeEventListener("offline", onOffline);
            },
        };
    },
};

registry.category("services").add("offline_sync", offlineSyncService);
