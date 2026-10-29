# PoS AirPay Gateway (Odoo 17)

Terima pembayaran via **AirPay Payment Gateway** (ShopeePay) langsung dari layar
Point of Sale: kasir menampilkan QR checkout, customer membayar dari HP,
dan status transaksi dicek otomatis sampai lunas.

Mengikuti dokumentasi resmi:
<https://product.shopeepay.co.id/integration/api/gateway>

## Fitur

- **Konfigurasi per payment method** — Client ID, Secret Key,
  Merchant Ext ID, Store Ext ID, dan pilihan environment
  (`Sandbox` → `https://api.gw.uat.airpay.co.id` atau
  `Production` → `https://api.gw.airpay.co.id`).
- **HMAC-SHA256 signature** — setiap request JSON di-sign dan di-Base64,
  dikirim lewat header `X-Airpay-ClientId` dan `X-Airpay-Req-H`;
  signature respons ikut divalidasi.
- **Checkout** — `POST /v1/checkout` dengan `reference_id`,
  `merchant_ext_id`, `store_ext_id`, `amount` (dikali 100),
  `currency: IDR`, `return_url`, dan `items`; mengambil `checkout_url`
  + `checkout_id` dari respons.
- **QR + link pembayaran** — popup di layar kasir menampilkan QR ke
  `checkout_url` (dirender `/report/barcode`, tanpa dependensi eksternal)
  beserta link yang bisa dibuka manual.
- **Polling status** — `GET /v1/checkout/<id>` setiap 5 detik;
  `Successful`/`Settled` menandai payment line lunas dan (bila total
  terpenuhi) order tervalidasi otomatis; `Expired`/`Cancelled` → gagal,
  kasir bisa *Retry*.
- **Cancel** — tombol *Batalkan* di popup maupun penghapusan payment line
  memanggil `POST /v1/checkout/cancel/<id>`.
- **Return URL** — halaman publik sederhana di `/pos_airpay/return`
  dipakai sebagai `return_url` default setelah customer membayar.

## Konfigurasi

1. Install modul → *Point of Sale → Configuration → Payment Methods*.
2. Buat/pilih metode pembayaran → isi *Use a Payment Terminal* = **AirPay**.
3. Isi field yang muncul:

   | Field | Keterangan |
   |-------|------------|
   | Environment | `Sandbox (UAT)` atau `Production` |
   | Client ID | Dari dashboard/onboarding AirPay |
   | Secret Key | Shared secret untuk signature (hanya terlihat oleh POS Manager) |
   | Merchant Ext ID | Identifier merchant di sistem Anda |
   | Store Ext ID | Identifier toko/cabang di sistem Anda |

4. Tambahkan metode itu ke *Payment Methods* pada konfigurasi POS,
   lalu buka sesi POS.

## Alur kasir

1. Pada layar pembayaran, pilih metode **AirPay** → payment line muncul
   dengan tombol **Send**.
2. Klik **Send** → popup QR checkout muncul.
3. Customer scan QR (QRIS/ShopeePay/dll. sesuai kanal yang diizinkan
   di dashboard AirPay) dan membayar di halaman hosted AirPay.
4. POS mengecek status tiap 5 detik. `Successful` → popup menutup,
   payment line *done*, order tervalidasi otomatis bila lunas.
5. `Expired`/`Cancelled` → payment line masuk status *retry*;
   kasir dapat mengulang **Send** (checkout baru dibuatkan).

## Catatan

- `reference_id` dibuat unik per percobaan checkout: `<uid order>-<8 hex>`.
- `amount` dikirim sebagai integer terkecil (x100) sesuai spesifikasi;
  `currency` dikirim `IDR` — pastikan mata uang POS adalah IDR.
- Item pesanan dikirim sebagai array `items` (nama, qty, harga satuan
  termasuk pajak, x100). Bila jumlah item tidak sama dengan `amount`
  (pembayaran sebagian/pembulatan), ditambahkan item penyesuaian
  `discount`/`fee` agar total cocok.
- Pembatalan checkout juga dilakukan saat payment line dihapus atau
  popup ditutup (Esc / Batalkan) untuk mencegah pembayaran "nyangkut".
- Konfirmasi akhir mengikuti polling `Get Checkout Status`; notifikasi
  callback server AirPay tidak dipakai (polling adalah mekanisme yang
  direkomendasikan dokumentasi sebagai alternatif callback).
- Diuji pada Odoo 17.0 Community.
