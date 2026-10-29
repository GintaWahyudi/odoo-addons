/** @odoo-module */

import { _t } from "@web/core/l10n/translation";
import { AbstractAwaitablePopup } from "@point_of_sale/app/popup/abstract_awaitable_popup";
import { useState, onMounted, onWillUnmount } from "@odoo/owl";

// Interval polling status transaksi ke backend (ms).
const POLL_INTERVAL_MS = 5000;
// Jeda tampilan status sukses sebelum popup menutup otomatis (ms).
const AUTO_CLOSE_MS = 1200;

export class AirpayQRPopup extends AbstractAwaitablePopup {
    static template = "pos_airpay_gateway.AirpayQRPopup";
    static defaultProps = {
        confirmKey: false,
        cancelKey: "Escape",
    };

    setup() {
        super.setup(...arguments);
        this.state = useState({
            status: "active", // active | successful | failed
            failedReason: "",
            cancelling: false,
        });
        this._timer = null;
        this._checking = false;
        onMounted(() => {
            this._poll();
            this._timer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
        });
        onWillUnmount(() => this._stopPolling());
    }

    get qrSrc() {
        if (!this.props.checkoutUrl) {
            return "";
        }
        return (
            "/report/barcode/?barcode_type=QR&width=280&height=280&value=" +
            encodeURIComponent(this.props.checkoutUrl)
        );
    }

    get statusTitle() {
        if (this.state.status === "successful") {
            return _t("Pembayaran berhasil!");
        }
        if (this.state.status === "failed") {
            return _t("Pembayaran gagal / kedaluwarsa");
        }
        return _t("Menunggu pembayaran...");
    }

    _stopPolling() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    async _poll() {
        if (this._checking || this.state.cancelling || this.state.status !== "active") {
            return;
        }
        this._checking = true;
        let status = null;
        try {
            status = await this.props.pollStatus();
        } catch (e) {
            status = null; // kegagalan jaringan sesaat: coba lagi di tick berikutnya
        }
        this._checking = false;
        if (!status) {
            return;
        }
        const normalized = String(status).toLowerCase();
        if (normalized === "successful" || normalized === "settled") {
            this.state.status = "successful";
            this._finish("successful");
        } else if (normalized === "expired" || normalized === "cancelled") {
            this.state.failedReason = normalized === "expired"
                ? _t("Sesi checkout kedaluwarsa.")
                : _t("Checkout dibatalkan.");
            this.state.status = "failed";
            this._finish(normalized);
        }
    }

    _finish(terminalStatus) {
        this._stopPolling();
        if (terminalStatus === "successful") {
            setTimeout(() => this.confirm(), AUTO_CLOSE_MS);
        } else {
            setTimeout(() => {
                this.props.close({ confirmed: false, payload: { status: terminalStatus } });
            }, AUTO_CLOSE_MS + 600);
        }
    }

    async confirm() {
        this._stopPolling();
        this.props.close({ confirmed: true, payload: { status: "successful" } });
    }

    async cancel() {
        if (this.state.cancelling) {
            return;
        }
        this._stopPolling();
        this.state.cancelling = true;
        try {
            if (this.props.cancelCheckout) {
                await this.props.cancelCheckout();
            }
        } catch (e) {
            // abaikan: penutupan popup tetap berlanjut
        }
        this.props.close({ confirmed: false, payload: { status: "cancelled" } });
    }

    async getPayload() {
        return { status: "successful" };
    }
}
