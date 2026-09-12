# clone — workspace kerja (bukan produk)

Folder ini adalah **workspace lokal tempat produk dikerjakan**, bukan sebuah
aplikasi. Yang di-commit dari sini hanyalah alat dan dokumentasi; produk utamanya
ada di `arkxmotion-studio/` yang punya repo dan remote sendiri, jadi folder itu
di-ignore di sini (lihat komentar di `.gitignore`).

## Isi workspace

| Path | Isi |
| --- | --- |
| `arkxmotion-studio/` | Produk ARKXMotion Studio (Vite + React + Express). Repo terpisah: https://github.com/chatgoplus32-sys/arkxmotion-studio — jalankan perintah npm dari dalam folder itu, bukan dari sini. |
| `recipe-endpoint-scraper/` | Scraper recipe/endpoint provider (Node `server.js` + `scraper.py`). `node_modules/` dan log-nya di-ignore. |
| `scratch/` (di-ignore) | Sisa pekerjaan sekali pakai, lihat di bawah. |

### Ekstensi token: sekarang satu, di repo produk

Empat helper lama di workspace ini (`firefly-auth-helper`, `g5-auth-helper`,
`oneover-auth-helper`, `jwt-extractor-extension`) sudah pensiun. Semuanya —
plus `lemur-galleri5`, `oneover-token-ext`, dan `firebase-token-ext` dari repo
produk — digabung menjadi **satu** ekstensi dengan registry provider:

```
arkxmotion-studio/extensions/auth-helper/
```

Isi ekstensi lama tetap bisa dibuka dari riwayat git masing-masing repo
(`git show HEAD:g5-auth-helper/popup.js`, dan seterusnya). Hint provider di app
sudah diarahkan ke ekstensi baru, jadi tidak ada lagi instruksi yang menunjuk
folder yang sudah hilang.

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
folder itu tidak memutus build.

## Catatan

- **File kredensial dibiarkan di root dan tidak disentuh** — `cookiejar.txt`,
  `headers*.txt`, `cred-*.json`. Semuanya sudah di-ignore, tapi tetap: rotasi
  atau hapus sendiri kalau sudah tidak dipakai, karena isinya sesi/API key.
- Menjalankan produk: `cd arkxmotion-studio && npm install && npm run dev:all`.
  Catatan port dan jebakannya (mis. `.env` berisi `PORT=3001` sementara Vite
  mem-proxy `/api` ke `6000`) ada di `.freebuff/run.md` — file lokal yang
  di-ignore, jadi tidak ikut ter-commit.
