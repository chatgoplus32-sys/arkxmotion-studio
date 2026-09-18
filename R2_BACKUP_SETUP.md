# Backup off-site ke Cloudflare R2 — penyiapan di VPS

Dokumen ini untuk satu tujuan saja: membuat backup database punya **salinan di
luar VPS**, dan memastikannya benar-benar terjadi.

Sebelum ini, seluruh "backup" hanya duduk di disk VPS yang sama dengan aplikasi
yang menjalankannya — satu mesin, satu titik kegagalan.

## Keadaan sebelum penyiapan (terukur, bukan asumsi)

Diperiksa lewat `GET https://<domain>/api/backup/status`:

```json
{"local":{"count":30,"latest":"arkxmotion-20260917-044210.db","totalSizeMB":4.57},
 "r2":{"configured":false,"bucket":null},
 "scheduler":{"running":false,"intervalMs":21600000}}
```

Artinya: 30 snapshot lokal, **nol** salinan off-site, dan scheduler mati.

## Urutan yang benar

Kenapa urutannya begini: begitu R2 terkonfigurasi dan proses restart, scheduler
menyala dan **pemangkasan lokal ikut bekerja** — `BACKUP_KEEP_LOCAL` (default 7).
Snapshot lama yang belum pernah naik ke R2 akan hilang permanen, bukan
dipindahkan. Karena itu riwayat lama diunggah **lebih dulu**.

### 1. Siapkan bucket dan token di Cloudflare

Cloudflare Dashboard → R2 Object Storage → Create Bucket, lalu Manage R2 API
Tokens → Create API Token dengan izin **Object Read & Write**. Catat:

- Account ID → `R2_ACCOUNT_ID`
- Access Key ID → `R2_ACCESS_KEY_ID`
- Secret Access Key → `R2_SECRET_ACCESS_KEY`
- nama bucket → `R2_BUCKET_NAME`
- (opsional, untuk URL publik objek) `R2_PUBLIC_URL`

### 2. Isi `.env` di VPS

`.env` **tidak pernah** disentuh oleh workflow deploy — ia berkas yang dirawat
manual:

```bash
ssh <user>@<vps>
cd /opt/arkxmotion-studio
nano .env
```

Isi kelima kunci `R2_*` di bagian R2, dan pertimbangkan:

```
BACKUP_KEEP_R2=60        # default 30; naikkan kalau riwayat hasil seed ingin tetap ada
BACKUP_INTERVAL_MS=21600000   # 6 jam (default)
BACKUP_KEEP_LOCAL=7      # jumlah snapshot di disk VPS (default)
```

Nilai-nilai ini dibaca **saat modul server dimuat**, jadi harus ada di `.env` —
mengekspornya di shell tidak cukup untuk modul yang membacanya di top level.
Pemuatan `.env` dijamin terjadi lebih dulu oleh `server/env.ts`, yang diimpor
paling awal di `server/index.ts` (dijaga `test/envLoadOrder.test.ts`).

### 3. Gerbang: buktikan round-trip benar-benar bekerja

```bash
node scripts/verify-r2.mjs
```

Harus berakhir dengan `✅ R2 ROUND-TRIP BERHASIL`. Skrip ini menulis objek uji,
membacanya kembali, membandingkan isinya, lalu menghapusnya — jadi "tidak ada
error" saja tidak dianggap cukup.

Kalau gagal, pesannya sudah menunjuk penyebabnya: bucket salah, kredensial
ditolak, atau koneksi/TLS.

### 4. Unggah riwayat yang sudah ada (sekali saja)

```bash
node scripts/seed-r2-backups.mjs --dry-run   # lihat rencananya
node scripts/seed-r2-backups.mjs
```

Idempoten (objek yang sudah ada dilewati) dan **tidak pernah menghapus apa pun**.
Skrip berakhir dengan membaca ulang daftar objek di bucket; exit 0 hanya kalau
semua snapshot lokal terkonfirmasi ada di R2.

### 5. Nyalakan

```bash
pm2 restart arkxmotion --update-env
```

### 6. Buktikan sudah menyala — jangan percaya `configured: true` saja

```bash
curl -s localhost:6000/api/backup/status
```

Yang harus terlihat:

- `r2.configured: true` dan `r2.bucket` terisi
- `scheduler.running: true` dan `scheduler.nextRunAt` berisi waktu yang sah
- setelah backup terjadwal pertama (±5 menit setelah start):
  `r2.lastUploadAt` terisi, `r2.lastUploadKey` menunjuk objeknya, `r2.lastError: null`

`lastUploadAt` itu buktinya. Sebelum perubahan ini, `configured: true` bisa
berdampingan dengan `scheduler.running: true` **tanpa satu objek pun pernah
naik** — dan tidak ada satu field pun yang membocorkannya.

`offsite` pada respons `POST /api/backup/run` juga membedakan tiga kemungkinan:
`uploaded`, `not-configured` (snapshot hanya di disk VPS), `failed`.

## Apa yang berubah setelah menyala

| | Sebelum | Sesudah |
|---|---|---|
| Snapshot saat start | ada (30 terakhir) | ada (maks `BACKUP_KEEP_LOCAL`, default 7) |
| Salinan di luar VPS | tidak ada | di R2, maks `BACKUP_KEEP_R2` (default 30) |
| Backup berkala | tidak jalan | setiap `BACKUP_INTERVAL_MS` (default 6 jam), pertama ±5 menit setelah start |
| Kegagalan unggah | senyap | `lastError` terisi, dan pemangkasan dilewati |

## Kalau ada yang tidak beres

| Gejala | Artinya |
|---|---|
| `configured: false` padahal `.env` sudah diisi | proses belum restart (`pm2 restart arkxmotion --update-env`), atau kuncinya tidak ada di `.env` tempat aplikasi membaca |
| `scheduler.running: false` tapi `configured: true` | `AUTO_BACKUP=0` (atau nilai "mati" lain) sedang berlaku |
| `lastAttemptAt` terisi tapi `lastUploadAt` tetap `null` | snapshot dibuat, tapi tidak naik: lihat `lastError` |
| `verify-r2.mjs` gagal `SignatureDoesNotMatch` | Access Key/Secret salah, atau token tidak punya izin Object Read & Write |
| `verify-r2.mjs` gagal `NoSuchBucket` | nama bucket salah |
| Snapshot lama hilang dari disk VPS | pemangkasan lokal bekerja (`BACKUP_KEEP_LOCAL`); pastikan langkah 4 sudah dijalankan lebih dulu |

## Catatan

- Sejak perubahan ini, kegagalan yang dulu senyap tidak lagi senyap:
  `runBackup()` tidak pernah lagi mengembalikan `{ ok: true }` polos tanpa
  menjelaskan apa yang terjadi pada salinan off-site, dan scheduler mencatat
  kegagalannya ke log alih-alih membuang promise-nya.
- `/api/backup/status` (GET) dan `/api/backup/run` (POST) **terbuka tanpa
  autentikasi**. Status membocorkan nama berkas backup; `run` memicu snapshot +
  unggahan + pemangkasan. Tidak ada pemanggil di dalam repo ini, jadi
  menambahkan autentikasi aman dilakukan — tapi itu keputusan terpisah.
