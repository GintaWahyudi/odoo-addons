# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import content_disposition, request
from odoo.tools import consteq


class PosWhatsappReceiptController(http.Controller):

    @http.route(
        '/pos_whatsapp_receipt/pdf/<int:order_id>/<string:access_token>',
        type='http', auth='public', website=False, sitemap=False,
    )
    def receipt_pdf(self, order_id, access_token='', **_kwargs):
        """Unduh nota PoS sebagai PDF.

        Publik tapi diamankan access_token (uuid per-order, sama seperti
        yang dipakai route /pos/ticket bawaan). Tanpa token yang cocok
        selalu 404 agar URL order tidak bisa ditebak berurutan.
        """
        order = request.env['pos.order'].sudo().browse(order_id)
        if (
            not order.exists()
            or not access_token
            or not order.access_token
            or not consteq(order.access_token, access_token)
        ):
            return request.not_found()

        pdf = request.env['ir.actions.report'].sudo()._render_qweb_pdf(
            'pos_whatsapp_receipt.report_pos_receipt', [order.id]
        )[0]
        filename = 'nota-%s.pdf' % (order.pos_reference or order.name or order.id)
        filename = filename.replace('/', '-').replace(' ', '_')
        return request.make_response(
            pdf,
            headers=[
                ('Content-Type', 'application/pdf'),
                ('Content-Length', len(pdf)),
                ('Content-Disposition', content_disposition(filename)),
            ],
        )
