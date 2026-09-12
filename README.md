# clone — workspace kerja (bukan produk)

Folder ini adalah **workspace lokal tempat produk dikerjakan**, bukan sebuah
aplikasi. Yang di-commit dari sini hanyalah alat dan dokumentasi; produk utamanya
ada di `arkxmotion-studio/` yang punya repo dan remote sendiri, jadi folder itu
di-ignore di sini (lihat komentar di `.gitignore`).

## Isi workspace

| Path | Isi |
| --- | --- |
| `arkxmotion-studio/` | Produk ARKXMotion Studio (Vite + React + Express). Repo terpisah: https://github.com/chatgoplus32-sys/arkxmotion-studio — jalankan perintah npm dari dalam folder itu, bukan dari sini. |
| `firefly-auth-helper/` | Ekstensi browser MV3 untuk menangkap header auth Adobe Firefly. |
| `g5-auth-helper/` | Ekstensi MV3 untuk Galleri5 AI Studio (header submit + refresh token). |
| `oneover-auth-helper/` | Ekstensi MV3 untuk OneOver (inject + capture token). |
| `jwt-extractor-extension/` | Ekstensi MV3 untuk menarik JWT dari sesi login. |
| `recipe-endpoint-scraper/` | Scraper recipe/endpoint provider (Node `server.js` + `scraper.py`). `node_modules/` dan log-nya di-ignore. |
| `scratch/` (di-ignore) | Sisa pekerjaan sekali pakai, lihat di bawah. |

## `scratch/` — silakan dihapus kapan saja

Semua yang di sini adalah artefak satu kali pakai dari sesi debugging/deploy
sebelumnya, dipindahkan keluar dari root supaya akar workspace bisa dibaca:

- `scratch/scripts/` — ~60 skrip sekali pakai (`check_*.ps1`, `read_*.ps1`,
  `find_*.ps1`, `fix_*.js` …) untuk memeriksa/menambal hal tertentu saat itu.
- `scratch/logs/` — keluaran `vercel deploy` dan log dev server lama.
- `scratch/artifacts/` — dump respons API (`api-test.json`, `test-catalog.json`),
  ekspor halaman proyek lama "Vigen" (`dash*.html`, `loginpage*.html`,
  `leonardo.js`), aset gambar, dan arsip `oneover-auth-helper.zip`.

Tidak ada sub-proyek yang mengimpor apa pun dari `scratch/`, jadi menghapus
folder itu tidak memutus build. Ekspor `dash*.html`/`leonardo.js` sengaja
disimpan karena berisi UI mode Leonardo/Vigen lama yang bisa jadi acuan.

## Catatan

- **File kredensial dibiarkan di root dan tidak disentuh** — `cookiejar.txt`,
  `headers*.txt`, `cred-*.json`. Semuanya sudah di-ignore, tapi tetap: rotasi
  atau hapus sendiri kalau sudah tidak dipakai, karena isinya sesi/API key.
- Menjalankan produk: `cd arkxmotion-studio && npm install && npm run dev:all`.
  Catatan port dan jebakannya (mis. `.env` berisi `PORT=3001` sementara Vite
  mem-proxy `/api` ke `6000`) ada di `.freebuff/run.md` — file lokal yang
  di-ignore, jadi tidak ikut ter-commit.
