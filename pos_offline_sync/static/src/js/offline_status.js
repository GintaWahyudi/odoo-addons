/** @odoo-module */

import { Component } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/store/pos_hook";
import { useService } from "@web/core/utils/hooks";
import { Navbar } from "@point_of_sale/app/navbar/navbar";
import { Chrome } from "@point_of_sale/app/pos_app";
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
                return _t("OFFLINE");
            case "syncing":
                return _t("SYNCING…");
            case "queued":
                return _t("QUEUED");
            default:
                return _t("ONLINE");
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

/**
 * Banner dominan di bawah navbar saat koneksi putus atau ada antrean.
 * Tidak mungkin terlewat dibanding ikon wifi bawaan.
 */
export class OfflineBanner extends Component {
    static template = "pos_offline_sync.OfflineBanner";
    static props = {};

    setup() {
        this.pos = usePos();
        this.offlineSync = useService("offline_sync");
    }

    get syncState() {
        return this.offlineSync.state;
    }

    get isShown() {
        const s = this.syncState;
        return !s.online || s.pending > 0;
    }

    get bannerClass() {
        if (!this.syncState.online) {
            return "offline";
        }
        return this.syncState.syncing ? "syncing" : "queued";
    }

    get message() {
        const s = this.syncState;
        if (!s.online) {
            return s.pending > 0
                ? _t("MODE OFFLINE — %s transaksi tersimpan lokal, akan dikirim otomatis saat online.", s.pending)
                : _t("MODE OFFLINE — transaksi baru disimpan lokal (IndexedDB).");
        }
        if (s.syncing) {
            return _t("Menyinkronkan antrean offline… sisa %s transaksi.", s.pending);
        }
        return _t("%s transaksi offline menunggu sinkron — klik untuk coba sekarang.", s.pending);
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

patch(Chrome, {
    components: { ...Chrome.components, OfflineBanner },
});
