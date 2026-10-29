/** @odoo-module */

import { PosDB } from "@point_of_sale/app/store/db";
import { patch } from "@web/core/utils/patch";
import { uuidv4 } from "@point_of_sale/utils";
import { offlineDB } from "./offline_db";

/**
 * Mencerminkan antrean order PosDB (localStorage) ke IndexedDB.
 *
 * PosDB.add_order dipanggil untuk setiap order tervalidasi yang belum
 * terkirim — dengan mem-patch-nya, setiap transaksi otomatis tersimpan
 * di IndexedDB (lebih tahan-crash daripada localStorage) dan selalu
 * membawa offline_uuid untuk deduplikasi backend.
 *
 * Pencerminan bersifat fire-and-forget: kegagalan IndexedDB tidak boleh
 * mengganggu alur POS utama.
 */
export function mirrorOrderToIndexedDB(orderData) {
    try {
        if (!orderData.offline_uuid) {
            orderData.offline_uuid = uuidv4();
        }
        return offlineDB
            .upsert({
                uid: orderData.uid,
                offline_uuid: orderData.offline_uuid,
                session_id: orderData.pos_session_id || false,
                order: { id: orderData.uid, data: orderData },
                status: "pending",
                attempts: 0,
                queued_at: Date.now(),
                last_attempt: 0,
                next_retry_at: 0,
                last_error: "",
            })
            .catch((err) =>
                console.warn("[pos_offline_sync] gagal menulis antrean IndexedDB", err)
            );
    } catch (err) {
        console.warn("[pos_offline_sync] mirror ke IndexedDB gagal", err);
        return Promise.resolve();
    }
}

patch(PosDB.prototype, {
    add_order(order) {
        // Pastikan UUID tertanam di payload SEBELUM disimpan: dengan begitu
        // push bawaan (create_from_ui) juga membawa UUID yang sama.
        if (order && !order.offline_uuid) {
            order.offline_uuid = uuidv4();
        }
        const orderId = super.add_order(...arguments);
        mirrorOrderToIndexedDB(order);
        return orderId;
    },
    remove_order(order_id) {
        const result = super.remove_order(...arguments);
        offlineDB
            .remove(order_id)
            .catch((err) =>
                console.warn("[pos_offline_sync] gagal menghapus antrean IndexedDB", err)
            );
        return result;
    },
    remove_all_orders() {
        const result = super.remove_all_orders(...arguments);
        offlineDB
            .clear()
            .catch((err) =>
                console.warn("[pos_offline_sync] gagal mengosongkan IndexedDB", err)
            );
        return result;
    },
});
