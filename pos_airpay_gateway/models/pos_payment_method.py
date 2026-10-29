# -*- coding: utf-8 -*-
import base64
import hashlib
import hmac
import json
import logging
import urllib.parse

import requests

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError

_logger = logging.getLogger(__name__)

TIMEOUT = 15

AIRPAY_ENVIRONMENTS = {
    'sandbox': 'https://api.gw.uat.airpay.co.id',
    'production': 'https://api.gw.airpay.co.id',
}


class PosPaymentMethod(models.Model):
    _inherit = 'pos.payment.method'

    airpay_client_id = fields.Char(
        string='Client ID',
        help='Client ID yang diberikan AirPay saat onboarding merchant.')
    airpay_secret_key = fields.Char(
        string='Secret Key',
        groups='point_of_sale.group_pos_manager',
        help='Shared secret untuk membuat signature HMAC-SHA256 pada setiap request.')
    airpay_environment = fields.Selection(
        selection=[('sandbox', 'Sandbox (UAT)'), ('production', 'Production')],
        string='Environment',
        default='sandbox',
        help='Sandbox: api.gw.uat.airpay.co.id - Production: api.gw.airpay.co.id')
    airpay_merchant_ext_id = fields.Char(
        string='Merchant Ext ID',
        help='Identifier unik merchant di sistem Anda (merchant_ext_id).')
    airpay_store_ext_id = fields.Char(
        string='Store Ext ID',
        help='Identifier unik toko/cabang di sistem Anda (store_ext_id).')

    def _get_payment_terminal_selection(self):
        return super()._get_payment_terminal_selection() + [('airpay', 'AirPay')]

    # ------------------------------------------------------------------
    # AirPay API helpers
    # ------------------------------------------------------------------

    def _airpay_base_url(self):
        self.ensure_one()
        return AIRPAY_ENVIRONMENTS.get(self.airpay_environment, AIRPAY_ENVIRONMENTS['sandbox'])

    def _airpay_sign(self, raw_body):
        """Return Base64(HMAC-SHA256(raw_body, secret_key)) per AirPay docs.

        Untuk request GET (tanpa body), yang ditandatangani adalah string kosong.
        """
        self.ensure_one()
        secret = (self.sudo().airpay_secret_key or '').encode('utf-8')
        digest = hmac.new(secret, raw_body.encode('utf-8'), hashlib.sha256).digest()
        return base64.b64encode(digest).decode('ascii')

    def _airpay_headers(self, raw_body):
        self.ensure_one()
        return {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Airpay-ClientId': self.airpay_client_id or '',
            'X-Airpay-Req-H': self._airpay_sign(raw_body),
        }

    def _airpay_request(self, method, path, body=None):
        """Kirim request bertanda tangan ke AirPay. Kembalikan dict response,
        atau {'error': ...} bila gagal."""
        self.ensure_one()
        raw_body = '' if body is None else json.dumps(body, separators=(',', ':'))
        url = self._airpay_base_url() + path
        try:
            resp = requests.request(
                method, url,
                data=raw_body if raw_body else None,
                headers=self._airpay_headers(raw_body),
                timeout=TIMEOUT,
            )
        except requests.exceptions.RequestException as e:
            _logger.exception('AirPay request failed: %s %s', method, path)
            return {'error': _('Tidak bisa terhubung ke AirPay API: %s', e)}

        # Validasi signature response bila disertakan (dok AirPay).
        resp_sig = resp.headers.get('X-Airpay-Req-H')
        if resp_sig and not hmac.compare_digest(resp_sig, self._airpay_sign(resp.text or '')):
            _logger.warning('Invalid AirPay response signature for %s %s', method, path)
            return {'error': _('Signature respons AirPay tidak valid.')}

        try:
            data = resp.json() if resp.text else {}
        except ValueError:
            data = {}

        if not resp.ok:
            detail = data.get('error') or data.get('message') or resp.text[:200]
            _logger.warning('AirPay %s %s -> HTTP %s: %s', method, path, resp.status_code, detail)
            return {'error': _('AirPay API error (HTTP %s): %s', resp.status_code, detail)}
        return data

    def _airpay_check_user(self):
        if not self.env.user.has_group('point_of_sale.group_pos_user'):
            raise AccessError(_("Hanya pengguna Point of Sale yang boleh memakai terminal AirPay."))

    def _airpay_default_return_url(self):
        return '%s/pos_airpay/return' % self.get_base_url()

    # ------------------------------------------------------------------
    # RPC endpoints (dipanggil dari POS frontend)
    # ------------------------------------------------------------------

    def airpay_create_checkout(self, data):
        """POST /v1/checkout -> {'checkout_id', 'checkout_url', ...}."""
        self._airpay_check_user()
        self.ensure_one()
        if not self.airpay_client_id or not self.sudo().airpay_secret_key:
            return {'error': _('Kredensial AirPay belum diisi pada metode pembayaran ini.')}
        if not self.airpay_merchant_ext_id or not self.airpay_store_ext_id:
            return {'error': _('Merchant Ext ID dan Store Ext ID wajib diisi.')}

        body = {
            'reference_id': (data.get('reference_id') or '')[:64],
            'merchant_ext_id': self.airpay_merchant_ext_id,
            'store_ext_id': self.airpay_store_ext_id,
            'amount': int(round(float(data.get('amount') or 0))),
            'currency': 'IDR',
            'return_url': data.get('return_url') or self._airpay_default_return_url(),
            'items': data.get('items') or [],
        }
        if data.get('customer'):
            body['customer'] = data['customer']
        if data.get('validity_period'):
            body['validity_period'] = int(data['validity_period'])
        if data.get('allowed_payment_method'):
            body['allowed_payment_method'] = data['allowed_payment_method']
        return self._airpay_request('POST', '/v1/checkout', body)

    def airpay_get_checkout_status(self, checkout_id):
        """GET /v1/checkout/<checkout_id> -> {'status': 'active|successful|expired|cancelled|settled', ...}."""
        self._airpay_check_user()
        self.ensure_one()
        if not checkout_id:
            return {'error': _('checkout_id kosong')}
        path = '/v1/checkout/%s' % urllib.parse.quote(str(checkout_id), safe='')
        return self._airpay_request('GET', path)

    def airpay_cancel_checkout(self, checkout_id):
        """POST /v1/checkout/cancel/<checkout_id>."""
        self._airpay_check_user()
        self.ensure_one()
        if not checkout_id:
            return {'error': _('checkout_id kosong')}
        path = '/v1/checkout/cancel/%s' % urllib.parse.quote(str(checkout_id), safe='')
        return self._airpay_request('POST', path)

    @api.constrains('use_payment_terminal')
    def _check_airpay_credentials(self):
        for record in self:
            if record.use_payment_terminal != 'airpay':
                continue
            missing = [f for f in (
                'airpay_client_id',
                'airpay_secret_key',
                'airpay_merchant_ext_id',
                'airpay_store_ext_id',
            ) if not record[f]]
            if missing:
                raise UserError(_(
                    'Metode pembayaran AirPay membutuhkan Client ID, Secret Key, '
                    'Merchant Ext ID, dan Store Ext ID.'
                ))
