# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
import psycopg2

from odoo import api, fields, models, _

_logger = logging.getLogger(__name__)

# Batas panjang UUID yang diterima dari client. uuidv4 standar = 36 karakter.
OFFLINE_UUID_MAX_LENGTH = 64


class PosOrder(models.Model):
    _inherit = "pos.order"

    offline_uuid = fields.Char(
        string="Offline UUID",
        readonly=True,
        copy=False,
        index=True,
        help="UUID yang dibuat client POS sebelum order dikirim. "
             "Dipakai untuk deduplikasi retry dari antrean offline (IndexedDB).",
    )
    offline_synced = fields.Boolean(
        string="Synced from Offline Queue",
        readonly=True,
        copy=False,
        default=False,
        help="True jika order dikirim dengan UUID antrean offline "
             "(dibuat/diupdate lewat jalur offline sync).",
    )

    _sql_constraints = [
        (
            "pos_offline_uuid_uniq",
            "unique(offline_uuid)",
            "Order dengan Offline UUID yang sama sudah tersinkronisasi.",
        )
    ]

    @api.model
    def _order_fields(self, ui_order):
        order_fields = super()._order_fields(ui_order)
        offline_uuid = (ui_order.get("offline_uuid") or "").strip()
        if offline_uuid:
            order_fields["offline_uuid"] = offline_uuid
            order_fields["offline_synced"] = True
        return order_fields

    @api.model
    def sync_offline_orders(self, orders):
        """Sinkronkan batch order dari antrean offline client secara idempotent.

        Dipanggil oleh service JS pos_offline_sync. Setiap order dicek
        offline_uuid-nya terlebih dahulu; order yang sudah ada dilaporkan
        sebagai 'duplicate' dan tidak dibuat ulang.

        Catatan implementasi: memakai _process_order langsung (bukan
        create_from_ui) supaya error handler capture bawaan — yang
        melakukan cr.rollback()/commit() global — tidak ikut berjalan.
        Setiap order dibungkus savepoint sendiri sehingga kegagalan satu
        order tidak membatalkan order lain dalam batch yang sama.

        :param orders: list of dict {"id": <uid>, "data": {<order json>}}
            (format sama dengan payload create_from_ui)
        :return: list of dict per order:
            {uid, uuid, pos_reference, status, server_id, error}
            status: 'synced' | 'duplicate' | 'failed'
        """
        results = []
        for order in orders:
            results.append(self._sync_one_offline_order(order))
        _logger.info(
            "pos_offline_sync: %d order diproses (synced=%d, duplicate=%d, failed=%d)",
            len(results),
            sum(1 for r in results if r["status"] == "synced"),
            sum(1 for r in results if r["status"] == "duplicate"),
            sum(1 for r in results if r["status"] == "failed"),
        )
        return results

    def _sync_one_offline_order(self, order):
        data = order.get("data") or {}
        uuid = (data.get("offline_uuid") or "").strip()
        result = {
            "uid": data.get("uid"),
            "uuid": uuid,
            "pos_reference": data.get("name"),
            "status": "failed",
            "server_id": False,
            "error": "",
        }

        if not uuid or len(uuid) > OFFLINE_UUID_MAX_LENGTH:
            result["error"] = _("offline_uuid kosong atau tidak valid.")
            return result

        # Fast path: UUID sudah ada -> order ini sudah pernah tersinkron.
        existing = self.search([("offline_uuid", "=", uuid)], limit=1)
        if existing:
            result.update(
                status="duplicate",
                server_id=existing.id,
                pos_reference=existing.pos_reference,
            )
            return result

        # Logika serupa create_from_ui: update draft yang sudah ada di server
        # (order pernah tersimpan draft, lalu dibayar saat offline).
        existing_draft = False
        if data.get("server_id"):
            existing_draft = self.search(
                [
                    "&",
                    ("id", "=", data["server_id"]),
                    ("state", "=", "draft"),
                ],
                limit=1,
            )
        if not existing_draft and data.get("name"):
            existing_draft = self.search(
                [
                    "&",
                    ("pos_reference", "=", data["name"]),
                    ("state", "=", "draft"),
                ],
                limit=1,
            )

        if not existing_draft and data.get("name"):
            # Dedup tambahan: order identik yang tersinkron lewat jalur lain
            # tanpa offline_uuid (mis. push bawaan sebelum uuid tertanam).
            same_order = next(
                (
                    rec
                    for rec in self.search(
                        [("pos_reference", "=", data["name"])]
                    )
                    if self._is_the_same_order(data, rec)
                ),
                self.env["pos.order"],
            )
            if same_order:
                if not same_order.offline_uuid:
                    try:
                        with self.env.cr.savepoint():
                            same_order.write({"offline_uuid": uuid})
                    except psycopg2.IntegrityError:
                        pass  # uuid sudah diklaim order lain; biarkan
                result.update(
                    status="duplicate",
                    server_id=same_order.id,
                    pos_reference=same_order.pos_reference,
                )
                return result

        try:
            with self.env.cr.savepoint():
                order_id = self._process_order(
                    order, draft=False, existing_order=existing_draft
                )
        except psycopg2.IntegrityError:
            # Kalah race: transaksi lain menulis uuid yang sama lebih dulu.
            existing = self.search([("offline_uuid", "=", uuid)], limit=1)
            result.update(
                status="duplicate",
                server_id=existing.id or False,
                pos_reference=existing.pos_reference or result["pos_reference"],
            )
            return result
        except Exception as err:  # noqa: BLE001 - semua error dilaporkan ke client
            _logger.warning(
                "pos_offline_sync: gagal memproses order %s: %s",
                result["pos_reference"],
                err,
            )
            result["error"] = str(err)
            return result

        synced_order = self.browse(order_id)
        result.update(
            status="synced",
            server_id=order_id,
            pos_reference=synced_order.pos_reference or result["pos_reference"],
        )
        return result
