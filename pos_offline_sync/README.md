# PoS Offline-First & Smart Sync (Odoo 17)

Modul kustom untuk meningkatkan keandalan Point of Sale Odoo 17 saat koneksi
internet tidak stabil atau terputus.

## Fitur

1. **Penyimpanan lokal tahan-crash (IndexedDB)**
   Setiap order yang tervalidasi dicerminkan ke IndexedDB browser
   (`pos_offline_sync` DB) selain localStorage bawaan PosDB. Antrean tetap
   aman walaupun tab/browser tertutup atau crash di tengah sinkronisasi.

2. **Indikator status offline di header POS**
   Badge OWL di samping `SyncNotification` menampilkan status:
   `Online` (hijau), `Syncing…` (biru), `Queued` (kuning), `Offline` (merah),
   beserta jumlah order dalam antrean. Klik untuk mencoba sinkron manual.
   Tooltip menampilkan error terakhir & ringkasan batch terakhir.

3. **Auto-retry sync queue**
   Service `offline_sync` menyiram antrean otomatis:
   - saat event `online` browser,
   - setiap 30 detik,
   - manual lewat klik indikator.
   Order yang gagal dijadwalkan ulang dengan exponential backoff
   (5 detik → maks. 5 menit). Batch 20 order per request.

4. **Deduplikasi UUID di backend**
   Setiap order membawa `offline_uuid` (uuidv4) yang disimpan pada
   `pos.order` dengan `UNIQUE` constraint. Method
   `pos.order.sync_offline_orders()` memvalidasi UUID sebelum membuat order
   dan melaporkan status per order: `synced` / `duplicate` / `failed`.
   Race condition dua tab/sesi ditangkap lewat `IntegrityError` → `duplicate`.

## Struktur

```
pos_offline_sync/
├── __manifest__.py
├── models/
│   └── pos_order.py            # field offline_uuid + sync_offline_orders()
├── views/
│   └── pos_order_views.xml     # tampilkan offline_uuid di form pos.order
└── static/src/
    ├── js/
    │   ├── offline_db.js            # wrapper IndexedDB
    │   ├── pos_db_offline.js        # patch PosDB: mirror order + inject uuid
    │   ├── offline_sync_service.js  # antrean auto-retry + backoff
    │   └── offline_status.js        # komponen indikator + patch Navbar
    ├── xml/offline_status.xml       # template indikator & inherit navbar
    └── scss/offline_sync.scss       # styling badge status
```

## Cara kerja singkat

- `PosDB.add_order` di-patch: order tervalidasi langsung mendapat
  `offline_uuid` dan dicatat ke IndexedDB.
- `PosDB.remove_order` / `remove_all_orders` turut membersihkan IndexedDB,
  jadi push bawaan Odoo yang sukses juga mengosongkan antrean modul.
- `offline_sync` service menyiram antrean IndexedDB ke
  `pos.order.sync_offline_orders`; order berstatus `synced`/`duplicate`
  dihapus dari antrean lokal (dan PosDB), yang `failed` diretry berjadwal.
- Backend memakai `_process_order` per order di dalam `savepoint` — identik
  dengan jalur `create_from_ui` (paid, picking, invoice), termasuk dukungan
  update draft dan rescue session saat sesi sudah tertutup.

## Instalasi

1. Salin `pos_offline_sync` ke direktori addons.
2. Update apps list, lalu Install **PoS Offline-First & Smart Sync**.
3. Buka POS — indikator status muncul di header, di kiri ikon sync bawaan.

Tidak ada konfigurasi tambahan; modul aktif untuk semua `pos.config`.
