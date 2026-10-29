/** @odoo-module */

import { _t } from "@web/core/l10n/translation";
import { PaymentInterface } from "@point_of_sale/app/payment/payment_interface";
import { ErrorPopup } from "@point_of_sale/app/errors/popups/error_popup";
import { sprintf } from "@web/core/utils/strings";
import { roundPrecision } from "@web/core/utils/numbers";
import { uuidv4 } from "@point_of_sale/utils";
import { AirpayQRPopup } from "@pos_airpay_gateway/js/airpay_qr_popup";

const SUCCESS_STATUSES = ["successful", "settled"];

export class PaymentAirPay extends PaymentInterface {
    /*
     * AirPay Payment Gateway (ShopeePay).
     * Docs: https://product.shopeepay.co.id/integration/api/gateway
     *
     * Alur: Send -> POST /v1/checkout -> tampilkan QR checkout_url
     * -> polling GET /v1/checkout/<id> sampai status final.
     */

    send_payment_request(cid) {
        super.send_payment_request(cid);
        return this._airpay_pay(cid);
    }
    send_payment_cancel(order, cid) {
        super.send_payment_cancel(order, cid);
        return this._airpay_cancel(order, cid);
    }

    pending_airpay_line() {
        return this.pos.getPendingPaymentLine("airpay");
    }

    _call_airpay(data, action) {
        return this.env.services.orm.silent
            .call("pos.payment.method", action, [[this.payment_method.id], data])
            .catch(this._handle_odoo_connection_failure.bind(this));
    }

    _handle_odoo_connection_failure(data = {}) {
        this._show_error(
            _t("Tidak bisa terhubung ke server Odoo, periksa koneksi internet Anda."),
            _t("Koneksi Terputus")
        );
        return Promise.reject(data);
    }

    /**
     * Bangun array items AirPay. price dalam integer terkecil (x100).
     * Tambahkan item penyesuaian bila total item != amount payment line
     * (mis. pembayaran sebagian atau selisih pembulatan).
     */
    _build_airpay_items(order, amountCents) {
        const items = order.get_orderlines().map((line) => {
            const qty = line.get_quantity();
            const unitPrice = Math.round(line.get_all_prices(1).priceWithTax * 100);
            return {
                name: line.product.display_name || line.get_full_product_name(),
                quantity: qty,
                price: unitPrice,
            };
        });
        const itemsTotal = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
        const diff = amountCents - itemsTotal;
        if (diff !== 0) {
            items.push({
                name: diff < 0 ? _t("Potongan / pembayaran sebagian") : _t("Biaya tambahan"),
                quantity: 1,
                price: diff,
                category: diff < 0 ? "discount" : "fee",
            });
        }
        return items;
    }

    _build_airpay_customer(order) {
        const partner = order.get_partner();
        if (!partner) {
            return null;
        }
        const customer = {};
        if (partner.name) customer.name = partner.name;
        if (partner.email) customer.email = partner.email;
        if (partner.mobile || partner.phone) customer.phone_number = partner.mobile || partner.phone;
        if (partner.zip) customer.postal_code = partner.zip;
        if (partner.street) customer.address = partner.street;
        return Object.keys(customer).length ? customer : null;
    }

    async _airpay_pay(cid) {
        const order = this.pos.get_order();
        const line = order.get_paymentline(cid);
        line.set_payment_status("waitingCard");

        const amountCents = Math.round(roundPrecision(line.amount, 0.01) * 100);
        if (amountCents <= 0) {
            this._show_error(_t("Nominal pembayaran harus lebih dari nol."));
            return false;
        }

        // reference_id unik per percobaan checkout (maks. 64 karakter).
        const referenceId = `${order.uid}-${uuidv4().slice(0, 8)}`.slice(0, 64);
        const requestData = {
            reference_id: referenceId,
            amount: amountCents,
            items: this._build_airpay_items(order, amountCents),
        };
        const customer = this._build_airpay_customer(order);
        if (customer) {
            requestData.customer = customer;
        }

        let response;
        try {
            response = await this._call_airpay(requestData, "airpay_create_checkout");
        } catch (e) {
            return false; // error popup sudah ditampilkan
        }
        if (response.error || !response.checkout_url) {
            this._show_error(
                response.error ||
                    _t("AirPay tidak mengembalikan checkout_url. Respons: %s",
                       JSON.stringify(response))
            );
            return false;
        }

        line.airpay_checkout_id = response.checkout_id;
        line.airpay_reference_id = response.reference_id || referenceId;

        // Tampilkan QR ke kasir; popup menangani polling + cancel.
        const { payload } = await this.env.services.popup.add(AirpayQRPopup, {
            title: _t("Pembayaran AirPay"),
            checkoutUrl: response.checkout_url,
            checkoutId: response.checkout_id,
            referenceId: line.airpay_reference_id,
            amount: this.env.utils.formatCurrency(line.amount),
            pollStatus: async () => {
                const result = await this._call_airpay(
                    response.checkout_id,
                    "airpay_get_checkout_status"
                ).catch(() => null);
                return result && !result.error ? result.status : null;
            },
            cancelCheckout: async () => {
                await this._call_airpay(
                    response.checkout_id,
                    "airpay_cancel_checkout"
                ).catch(() => null);
            },
        });

        const status = (payload && payload.status && String(payload.status).toLowerCase()) || "";
        if (SUCCESS_STATUSES.includes(status)) {
            line.transaction_id = response.checkout_id;
            line.set_receipt_info(
                sprintf(_t("AirPay %s"), line.airpay_reference_id) + "\n"
            );
            return true;
        }
        return false;
    }

    async _airpay_cancel(order, cid) {
        const line = this.pos.get_order().get_paymentline(cid);
        if (line && line.airpay_checkout_id) {
            await this._call_airpay(
                line.airpay_checkout_id,
                "airpay_cancel_checkout"
            ).catch(() => null);
        }
        return true;
    }

    _show_error(msg, title) {
        if (!title) {
            title = _t("AirPay Error");
        }
        this.pos.env.services.popup.add(ErrorPopup, {
            title: title,
            body: msg,
        });
    }
}
