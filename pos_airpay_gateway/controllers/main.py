# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import request

_RETURN_HTML = """<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Pembayaran AirPay</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif;
         display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; background: #f0f4f8; color: #1f2937; }
  .card { background: #fff; border-radius: 16px; padding: 40px 32px;
          max-width: 360px; text-align: center;
          box-shadow: 0 10px 30px rgba(0,0,0,.08); }
  .icon { font-size: 48px; }
  h1 { font-size: 20px; margin: 16px 0 8px; }
  p { font-size: 14px; color: #6b7280; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">&#128179;</div>
    <h1>Pembayaran diproses</h1>
    <p>Silakan kembali ke kasir untuk menyelesaikan transaksi Anda.</p>
  </div>
</body>
</html>"""


class PosAirpayController(http.Controller):

    @http.route('/pos_airpay/return', type='http', auth='public')
    def airpay_return(self, **kwargs):
        """Halaman return_url sederhana: customer diarahkan ke sini setelah
        menyelesaikan pembayaran di halaman hosted AirPay."""
        return request.make_response(_RETURN_HTML, headers=[('Content-Type', 'text/html')])
