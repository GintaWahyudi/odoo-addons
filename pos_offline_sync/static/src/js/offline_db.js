/** @odoo-module */

/**
 * Wrapper Promise-based di atas IndexedDB untuk antrean order PoS.
 *
 * Database  : pos_offline_sync
 * Store     : orders  (keyPath = uid, index: status, offline_uuid unique)
 *             meta    (key-value kecil: mis. last flush)
 *
 * Record antrean:
 * {
 *   uid,            // order.uid (sama dengan key PosDB)
 *   offline_uuid,   // uuidv4 — kunci deduplikasi di backend
 *   session_id,     // pos_session_id
 *   order,          // {id: uid, data: <export_as_JSON()>} — payload create_from_ui
 *   status,         // 'pending' | 'syncing' | 'failed'
 *   attempts,       // jumlah percobaan kirim yang gagal
 *   queued_at,      // timestamp ms saat order masuk antrean
 *   last_attempt,   // timestamp ms percobaan terakhir
 *   next_retry_at,  // timestamp ms; 0 = boleh dicoba kapan saja
 *   last_error,     // pesan error backend terakhir
 * }
 */

const DB_NAME = "pos_offline_sync";
const DB_VERSION = 1;
const STORE_ORDERS = "orders";
const STORE_META = "meta";

function requestToPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function transactionDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
    });
}

export class OfflineDB {
    constructor() {
        this._dbPromise = null;
        this._listeners = new Set();
    }

    /** Daftarkan callback yang dipanggil setiap antrean berubah. */
    onChange(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _notify() {
        for (const listener of this._listeners) {
            try {
                listener();
            } catch (err) {
                console.error("[pos_offline_sync] listener error", err);
            }
        }
    }

    open() {
        if (!this._dbPromise) {
            this._dbPromise = new Promise((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(STORE_ORDERS)) {
                        const store = db.createObjectStore(STORE_ORDERS, {
                            keyPath: "uid",
                        });
                        store.createIndex("status", "status", { unique: false });
                        store.createIndex("offline_uuid", "offline_uuid", {
                            unique: true,
                        });
                    }
                    if (!db.objectStoreNames.contains(STORE_META)) {
                        db.createObjectStore(STORE_META, { keyPath: "key" });
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
                req.onblocked = () =>
                    reject(new Error("IndexedDB upgrade blocked by another tab"));
            });
            // Jika open gagal sekali, ijinkan percobaan ulang di pemanggilan berikutnya.
            this._dbPromise.catch(() => (this._dbPromise = null));
        }
        return this._dbPromise;
    }

    async _tx(mode, fn) {
        const db = await this.open();
        const tx = db.transaction(STORE_ORDERS, mode);
        const result = await fn(tx.objectStore(STORE_ORDERS));
        await transactionDone(tx);
        return result;
    }

    async upsert(record) {
        await this._tx("readwrite", (store) => requestToPromise(store.put(record)));
        this._notify();
    }

    async upsertMany(records) {
        if (!records.length) {
            return;
        }
        await this._tx("readwrite", async (store) => {
            for (const record of records) {
                store.put(record);
            }
        });
        this._notify();
    }

    async get(uid) {
        return this._tx("readonly", (store) => requestToPromise(store.get(uid)));
    }

    async getAll() {
        const records = await this._tx("readonly", (store) =>
            requestToPromise(store.getAll())
        );
        return records.sort((a, b) => a.queued_at - b.queued_at);
    }

    /** Antrean yang boleh dicoba sekarang (pending/failed dan bukan sedang syncing). */
    async getSyncable() {
        const now = Date.now();
        return (await this.getAll()).filter(
            (record) =>
                record.status !== "syncing" &&
                (!record.next_retry_at || record.next_retry_at <= now)
        );
    }

    /** Record 'syncing' yang basi (flush crash/putus) dikembalikan ke 'pending'. */
    async recoverStaleSyncing(staleMs) {
        const now = Date.now();
        const stale = (await this.getAll()).filter(
            (record) =>
                record.status === "syncing" &&
                now - (record.last_attempt || 0) > staleMs
        );
        for (const record of stale) {
            record.status = "pending";
            record.next_retry_at = 0;
        }
        if (stale.length) {
            await this.upsertMany(stale);
        }
        return stale.length;
    }

    async remove(uid) {
        await this._tx("readwrite", (store) => requestToPromise(store.delete(uid)));
        this._notify();
    }

    async removeMany(uids) {
        if (!uids.length) {
            return;
        }
        await this._tx("readwrite", async (store) => {
            for (const uid of uids) {
                store.delete(uid);
            }
        });
        this._notify();
    }

    async count() {
        return (await this.getAll()).length;
    }

    async clear() {
        await this._tx("readwrite", (store) => requestToPromise(store.clear()));
        this._notify();
    }

    /** Nolkan jadwal retry — dipakai saat event 'online' agar langsung dicoba. */
    async resetRetries() {
        const records = (await this.getAll()).filter(
            (record) => record.status !== "syncing" && record.next_retry_at > 0
        );
        for (const record of records) {
            record.next_retry_at = 0;
        }
        if (records.length) {
            await this.upsertMany(records);
        }
    }

    async getMeta(key, fallback = null) {
        const db = await this.open();
        const tx = db.transaction(STORE_META, "readonly");
        const record = await requestToPromise(
            tx.objectStore(STORE_META).get(key)
        );
        return record ? record.value : fallback;
    }

    async setMeta(key, value) {
        const db = await this.open();
        const tx = db.transaction(STORE_META, "readwrite");
        tx.objectStore(STORE_META).put({ key, value });
        await transactionDone(tx);
    }
}

export const offlineDB = new OfflineDB();
