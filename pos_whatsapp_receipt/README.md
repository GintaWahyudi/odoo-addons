# PoS WhatsApp Receipt (Odoo 17)

Kirim nota/receipt transaksi Point of Sale ke customer via WhatsApp
menggunakan link `wa.me` — **tanpa API key, tanpa biaya**.

## Cara Kerja

1. Kasir selesaikan pembayaran seperti biasa → layar receipt muncul.
2. Klik tombol hijau **WhatsApp** di bawah tombol *Print Receipt*.
3. WhatsApp (Web/App) terbuka di tab baru dengan:
   - nomor tujuan = field `mobile`/`phone` customer di order,
   - isi pesan = nota terformat (monospace, siap kirim).
4. Kasir tinggal klik **kirim** di WhatsApp.

Jika order tidak punya customer atau customer belum punya nomor,
popup akan meminta nomor WhatsApp secara manual.

## Format Nomor

Nomor Indonesia dinormalisasi otomatis ke format internasional:

| Input            | Hasil          |
|------------------|----------------|
| `0812 3456 7890` | `6281234567890`|
| `+62 812-3456`   | `628123456`    |
| `6281234567890`  | `6281234567890`|

Kode negara default `62` dapat diubah lewat parameter
`defaultCountryCode` di `static/src/js/whatsapp_receipt.js`.

## Instalasi

1. Salin folder `pos_whatsapp_receipt` ke direktori addons Odoo 17.
2. Pastikan direktori itu ada di `--addons-path` (atau `addons_path`
   di `odoo.conf`).
3. Restart Odoo → *Apps* → update app list → cari
   **PoS WhatsApp Receipt** → *Install*.
4. Buka sesi PoS seperti biasa — tombol WhatsApp muncul di layar
   receipt setelah pembayaran.

Tidak ada konfigurasi tambahan yang diperlukan.

## Catatan

- Header/footer nota mengikuti konfigurasi receipt PoS
  (`receipt_header`, `receipt_footer`, nama & alamat company).
- Pesan dikirim dari akun WhatsApp milik kasir/perangkat toko
  (wa.me hanya membuka chat dengan isi pesan terisi).
- Diuji pada Odoo 17.0 Community.
