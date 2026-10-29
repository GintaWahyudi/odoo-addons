# -*- coding: utf-8 -*-
{
    'name': 'PoS WhatsApp Receipt',
    'version': '17.0.1.3.1',
    'category': 'Sales/Point of Sale',
    'summary': 'Kirim nota/receipt PoS ke pelanggan via WhatsApp (wa.me link)',
    'description': """
Tambahkan tombol "WhatsApp" di layar receipt Point of Sale.
Klik tombol -> WhatsApp (Web/App) terbuka dengan isi nota sudah terisi,
kasir tinggal klik kirim.

- Nomor diambil dari field mobile/phone customer di order.
- Jika tidak ada nomor, muncul popup untuk input nomor manual.
- Nomor Indonesia (08xx) otomatis dinormalisasi ke format internasional (62xx).
- Tidak butuh API key atau akun WhatsApp Business.
    """,
    'author': 'Ginta Wahyudi',
    'license': 'LGPL-3',
    'depends': ['point_of_sale'],
    'data': [
        'views/report_pos_receipt.xml',
    ],
    'assets': {
        'point_of_sale._assets_pos': [
            'pos_whatsapp_receipt/static/src/js/whatsapp_receipt.js',
            'pos_whatsapp_receipt/static/src/xml/whatsapp_receipt.xml',
            'pos_whatsapp_receipt/static/src/scss/whatsapp_receipt.scss',
        ],
    },
    'installable': True,
    'auto_install': False,
    'application': False,
}
