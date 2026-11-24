# ARKX Motion Studio

Platform konten kreatif bertenaga AI: generate video motion, naratif, storyboard,
bulk fashion, dan image-to-video dalam satu dashboard.

**Produksi:** VPS — <https://arkxmotion-studio.win> (health check `/api/health/live`).
Konfigurasi Vercel lama (`vercel.json`, `api/*`) masih ada di repo tapi tidak
dipakai lagi.

## Stack

| Lapisan | Teknologi |
| --- | --- |
| Frontend | React 19 + TypeScript + Vite 8 + Tailwind CSS 4 |
| State | Zustand v5 |
| Backend | Express 5 (`server/`) + SQLite (better-sqlite3) |
| Penyimpanan hasil | Cloudflare R2 (opsional, disarankan) |
| Deploy | VPS + pm2 + nginx (`deploy_vps.py`, `deploy_dist.py`) |

## Menjalankan lokal

```bash
npm install
cp .env.example .env
# isi minimal JWT_SECRET — server TIDAK start tanpa ini:
openssl rand -hex 32
npm run dev:all        # backend :6000 + frontend :5173
```

Tanpa `SMTP_*`, email verifikasi/reset hanya di-log ke console. Tanpa `R2_*`,
hasil video bertahan sementara. Detail semua variabel: komentar di
[`.env.example`](.env.example).

## Perintah

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | Frontend Vite (port 5173) |
| `npm run dev:server` | Backend Express (port 6000) |
| `npm run dev:all` | Keduanya sekaligus |
| `npm run build` | Typecheck + build produksi ke `dist/` |
| `npm run test` | Test (node:test lewat tsx, folder `test/`) |
| `npm run typecheck` | TypeScript app + test + cek undefined |
| `npm run lint` | OXLint |
| `npm run seed:admin` | Buat/seed akun admin |
| `npm run smoke` | Smoke test (`scripts/smoke-test.sh`) |
| `npm run verify:r2` | Cek koneksi bucket R2 |

## Struktur proyek

```
src/        # React SPA — halaman, komponen UI, store Zustand
server/     # Express backend — auth, admin, generate, relay provider
api/        # Endpoint serverless lama (Vercel) — tidak dipakai produksi
test/       # Test node:test (*.test.ts)
scripts/    # Skrip bantu: check-undefined, smoke-test, verify-r2
docs *.md   # Dokumentasi fitur & operasi (lihat di bawah)
```

Halaman utama: Dashboard, Command Center, Motion Control, Naratif Video,
Storyboard, Bulk Fashion, Image to Video, Research, Projects, Assets,
Providers, Settings.

## Dokumentasi

- [`SMTP_SETUP.md`](SMTP_SETUP.md) — email verifikasi/reset (Gmail App Password, Brevo, Zoho)
- [`R2_BACKUP_SETUP.md`](R2_BACKUP_SETUP.md) — simpan hasil generate + backup otomatis
- [`NEXABOT_MASTER_KEY.md`](NEXABOT_MASTER_KEY.md) — kunci induk NexaBot di server (rotasi)
- [`BOOT_BACKUP_GATE.md`](BOOT_BACKUP_GATE.md) — gerbang backup saat boot
- [`ADDON_AKUN.md`](ADDON_AKUN.md), [`IMPLEMENTATION_SUMMARY.md`](IMPLEMENTATION_SUMMARY.md),
  [`CHANGELOG_ROBONEO_UPDATES.md`](CHANGELOG_ROBONEO_UPDATES.md),
  [`PROJECT_ANALYSIS.md`](PROJECT_ANALYSIS.md) — catatan fitur & riwayat

## Deploy frontend ke VPS

Selalu pakai skrip ini untuk deploy frontend, jangan unggah tar manual. Skrip
menghapus `dist/` lama di server SEBELUM ekstrak, jadi chunk hasil build
terdahulu tidak menumpuk.

```bash
python deploy_dist.py              # build -> unggah -> restart pm2 -> tunggu health 200
python deploy_dist.py --no-build   # pakai dist/ hasil build terakhir (tanpa npm run build)
python deploy_dist.py --check      # hanya cek kredensial VPS, tidak unggah / tidak restart
```

Langkah yang dijalankan `deploy_dist.py`:

1. `npm run build` (dilewati kalau `--no-build`)
2. arsip `dist/` ke `.tmpdbg/dist.tar.gz`
3. unggah arsip ke `/tmp/arkxmotion_dist_upload.tar.gz`
4. `rm -rf dist && tar -xzf` di folder remote (`VPS_REMOTE_DIR`, default `/opt/arkxmotion-studio`)
5. `pm2 restart arkxmotion --update-env`
6. polling `http://127.0.0.1:6000/api/health/live` sampai 200 (maks 60 detik); keluar dengan
   status bukan 0 kalau proses server tidak hidup, supaya kegagalan deploy tidak lolos diam-diam.
   Endpoint `/api/health` tetap menyediakan pemeriksaan database dan layanan upstream yang lebih rinci.

Kredensial dibaca dari `.env` lewat `deploy_config.py` (`VPS_HOST`, `VPS_PORT`,
`VPS_USER`, `VPS_PASSWORD`, opsional `VPS_REMOTE_DIR`). Tidak ada kredensial di
dalam skrip deploy.

`deploy_vps.py` tetap dipakai kalau perubahan menyentuh kode server (`server/**`),
karena skrip itu ikut mengunggah sumber dan melakukan deploy penuh. Untuk
perubahan frontend saja, `deploy_dist.py` lebih cepat dan dijamin bersih.
