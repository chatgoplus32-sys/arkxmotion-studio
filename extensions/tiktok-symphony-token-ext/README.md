# TikTok Symphony Token Manager (Chrome Extension)

Extension Chrome untuk **menangkap Access-Token + tto_id** dari browser saat kamu login ke
**Symphony Creative Studio** / TikTok for Business, lalu **mengirimnya otomatis** ke aplikasi
ARKXMotion Studio. Tanpa copy-paste manual.

> Kredensial TikTok bersifat **server-level** (milik operator/admin), bukan per-member.
> Extension ini dipakai **admin**, bukan member.

## Cara install

1. Buka `chrome://extensions` di Chrome / browser Chromium.
2. Aktifkan **Developer mode** (pojok kanan atas).
3. Klik **Load unpacked** → pilih folder `extensions/tiktok-symphony-token-ext`.
4. Klik ikon **pin** agar extension muncul di toolbar.

## Cara pakai

1. **Login sebagai admin** di tab aplikasi ARKXMotion (`https://arkxmotion-studio.win`).
   Extension membaca JWT login kamu dari tab ini untuk mengautentikasi pengiriman ke app.
2. Di tab lain, buka [Symphony Creative Studio](https://symphony.tiktok.com) dan/login ke akun TikTok yang dipakai.
3. Extension memindai halaman & network response untuk menangkap:
   - **tto_id** — dari dropdown akun kanan atas di Creative Studio (atau field `tto_id`/account id di response).
   - **Access-Token** — dari response OAuth (`/oauth2/access_token/`) / field `access_token` / storage.
4. Klik ikon extension → lihat status ✓ pada kedua field. Klik **Kirim ke Aplikasi**
   (atau biarkan **Auto-sync** aktif agar terkirim otomatis saat berubah).
5. Verifikasi di aplikasi: **System Settings → Kredensial TikTok Symphony → Cek Koneksi**.

## Pengaturan popup

- **App URL** — origin aplikasi (default `https://arkxmotion-studio.win`). Ganti kalau pakai localhost.
- **Auto-sync saat token berubah** — aktif secara default.
- **Kirim ke Aplikasi** — paksa kirim sekarang (abaikan auto-sync & dedupe).
- **Refresh / Hapus** — muat ulang status / hapus token yang tersimpan di extension.

## Endpoint yang dipakai

Extension mengirim ke endpoint admin yang sudah ada di aplikasi:

```
PUT /api/admin/tiktok/credentials
Authorization: Bearer <JWT admin>
Content-Type: application/json

{ "accessToken": "…", "ttoId": "…" }
```

Endpoint ini hanya menerima admin (`requireAdmin`) dan tidak pernah mengembalikan nilai kredensial ke browser.

## Keamanan

- Access-Token **hanya dikirim ke App URL yang kamu set** — tidak ke host lain.
- JWT admin dibaca dari tab app milikmu sendiri (localStorage `arkxmotion_token`), bukan disimpan permanen.
- Token tersimpan di `chrome.storage.local` extension (lokal di browser kamu).
- Content script memindai `localStorage` / `sessionStorage` / response network di domain TikTok untuk
  menemukan field yang bernama `access_token` / `tto_id` — tidak membaca data di luar itu.

## Troubleshooting

- **Status "belum tertangkap"** — pastikan sudah login di Symphony Creative Studio, lalu klik Refresh.
  tto_id muncul dari dropdown akun kanan atas; Access-Token muncul saat token digenerate di developer portal.
- **"Buka tab app sambil login sebagai admin dulu"** — extension tidak menemukan JWT admin.
  Pastikan tab aplikasi terbuka & kamu login sebagai **admin**.
- **HTTP 401/403 saat kirim** — JWT kedaluwarsa; extension akan coba baca ulang sekali. Kalau masih gagal,
  logout/login ulang di aplikasi.
- **Access-Token tertangkap tapi tto_id tidak** — buka Creative Studio, klik dropdown akun kanan atas,
  lalu Refresh. Atau isi manual keduanya di **System Settings → Kredensial TikTok Symphony**.
