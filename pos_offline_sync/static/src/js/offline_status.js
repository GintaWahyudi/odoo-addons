/** @odoo-module */

import { Component } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/store/pos_hook";
import { useService } from "@web/core/utils/hooks";
import { Navbar } from "@point_of_sale/app/navbar/navbar";
import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";

/**
 * Indikator status offline di header POS.
 *
 * Tampilan mengikuti state dari service `offline_sync`:
 *  - online   : hijau, antrean kosong
 *  - syncing  : spinner biru + jumlah antrean tersisa
 *  - queued   : kuning, online tapi masih ada order menunggu retry
 *  - offline  : merah, tidak ada koneksi + jumlah antrean
 *
 * Klik indikator = coba sinkron sekarang (bypass navigator.onLine).
 */
export class OfflineStatusIndicator extends Component {
    static template = "pos_offline_sync.OfflineStatusIndicator";
    static props = {};

    setup() {
        this.pos = usePos();
        this.offlineSync = useService("offline_sync");
    }

    get syncState() {
        return this.offlineSync.state;
    }

    get statusKey() {
        if (!this.syncState.online) {
            return "offline";
        }
        if (this.syncState.syncing) {
            return "syncing";
        }
        if (this.syncState.pending > 0) {
            return "queued";
        }
        return "online";
    }

    get label() {
        switch (this.statusKey) {
            case "offline":
                return _t("Offline");
            case "syncing":
                return _t("Syncing…");
            case "queued":
                return _t("Queued");
            default:
                return _t("Online");
        }
    }

    get title() {
        const s = this.syncState;
        const lines = [
            s.online
                ? _t("Koneksi ke server OK")
                : _t("Tidak ada koneksi — order disimpan di antrean lokal (IndexedDB)"),
            _t("Antrean offline: %s order", s.pending),
        ];
        if (s.lastResult) {
            lines.push(
                _t("Batch terakhir — synced: %s, duplikat: %s, gagal: %s",
                    s.lastResult.synced, s.lastResult.duplicate, s.lastResult.failed)
            );
        }
        if (s.lastError) {
            lines.push(_t("Error terakhir: %s", s.lastError));
        }
        lines.push(_t("Klik untuk mencoba sinkron sekarang."));
        return lines.join("\n");
    }

    onClick() {
        this.offlineSync
            .flush(true)
            .catch((err) => console.warn("[pos_offline_sync] flush manual gagal", err));
    }
}

patch(Navbar, {
    components: { ...Navbar.components, OfflineStatusIndicator },
});
