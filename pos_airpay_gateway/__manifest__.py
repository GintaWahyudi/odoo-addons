# -*- coding: utf-8 -*-
{
    'name': 'PoS AirPay Gateway',
    'version': '17.0.1.0.0',
    'category': 'Sales/Point of Sale',
    'summary': 'Terima pembayaran AirPay (QRIS/ShopeePay/dll) langsung dari layar Point of Sale',
    'description': """
Integrasi AirPay Payment Gateway (ShopeePay) ke Point of Sale Odoo 17.

- Kredensial per payment method: Client ID, Secret Key, Merchant/Store Ext ID,
  pilihan environment Sandbox (api.gw.uat.airpay.co.id) atau
  Production (api.gw.airpay.co.id).
- Request ditandatangani HMAC-SHA256 -> Base64 via header
  X-Airpay-ClientId dan X-Airpay-Req-H.
- Kasir klik "Send" pada payment line AirPay -> Odoo memanggil
  POST /v1/checkout dan menampilkan QR checkout_url ke kasir/customer.
- Status transaksi di-polling berkala (GET /v1/checkout/<id>) sampai
  Successful/Settled; Expired/Cancelled ditandai gagal.
- Halaman return sederhana di /pos_airpay/return sebagai return_url
  default setelah customer selesai membayar.
    """,
    'author': 'Ginta Wahyudi',
    'license': 'LGPL-3',
    'depends': ['point_of_sale'],
    'data': [
        'views/pos_payment_method_views.xml',
    ],
    'assets': {
        'point_of_sale._assets_pos': [
            'pos_airpay_gateway/static/src/js/**/*.js',
            'pos_airpay_gateway/static/src/xml/**/*.xml',
            'pos_airpay_gateway/static/src/scss/**/*.scss',
        ],
    },
    'installable': True,
    'auto_install': False,
    'application': False,
}
