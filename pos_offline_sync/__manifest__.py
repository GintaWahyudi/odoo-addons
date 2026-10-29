# -*- coding: utf-8 -*-
{
    'name': 'PoS Offline-First & Smart Sync',
    'version': '17.0.1.0.0',
    'category': 'Sales/Point of Sale',
    'summary': 'Penyimpanan transaksi lokal (IndexedDB), indikator status offline, dan antrean sinkronisasi otomatis dengan deduplikasi UUID',
    'description': """
Meningkatkan keandalan Point of Sale saat koneksi internet tidak stabil:

- Offline-First: setiap order tervalidasi dicerminkan ke IndexedDB browser
  sehingga aman dari crash/tab tertutup, bukan hanya localStorage bawaan.
- Indikator status offline: badge di header POS menampilkan status koneksi,
  jumlah order dalam antrean, dan progres sinkronisasi.
- Auto-retry sync queue: order yang gagal terkirim dicoba ulang otomatis
  dengan exponential backoff saat koneksi kembali, plus tombol retry manual.
- Deduplikasi UUID: setiap order membawa offline_uuid yang divalidasi unik
  di backend (unique constraint pada pos.order), sehingga retry ganda atau
  antrean dari tab berbeda tidak membuat data ganda.
    """,
    'author': 'Ginta Wahyudi',
    'license': 'LGPL-3',
    'depends': ['point_of_sale'],
    'data': [
        'views/pos_order_views.xml',
    ],
    'assets': {
        'point_of_sale._assets_pos': [
            'pos_offline_sync/static/src/js/offline_db.js',
            'pos_offline_sync/static/src/js/offline_sync_service.js',
            'pos_offline_sync/static/src/js/pos_db_offline.js',
            'pos_offline_sync/static/src/js/offline_status.js',
            'pos_offline_sync/static/src/xml/offline_status.xml',
            'pos_offline_sync/static/src/scss/offline_sync.scss',
        ],
    },
    'installable': True,
    'auto_install': False,
    'application': False,
}
