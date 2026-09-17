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
| `.freebuff/` (di-ignore) | Artefak tooling lokal; sekarang hanya berisi catatan dan log sesi yang masih hidup, lihat di bawah. |
| `tidy-logs.sh` | Perapi log: memindahkan log sesi dev/preview yang sudah mati dari `.freebuff/` ke `scratch/logs/`. Lihat "Menahan penumpukan log". |

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

- `scratch/scripts/` — ~90 skrip sekali pakai (`check_*.ps1`, `read_*.ps1`,
  `find_*.ps1`, `fix_*.js`, plus `add-*.js`, `clean-*.js`, `remove-*.js`,
  `replace-*.js`, `test-leo-upload.js`) untuk memeriksa/menambal hal tertentu
  saat itu. Sebagiannya dipindahkan dari root `.freebuff/` (lihat di bawah).
- `scratch/logs/` — keluaran `vercel deploy` dan log dev server lama, termasuk
  log sesi preview yang dulu menumpuk di `.freebuff/` (`preview-*-vite.log`,
  `express-*.log`, `vite-2026-08-28.log`, dan seterusnya).
- `scratch/artifacts/` — dump respons API (`api-test.json`, `test-catalog.json`),
  ekspor halaman proyek lama "Vigen" (`dash*.html`, `loginpage*.html`,
  `leonardo.js`), aset gambar, arsip `oneover-auth-helper.zip`, dan dump kode
  handler Leonardo (`leonardo-handler.txt`, `leo-v4.txt`, dll).

Tidak ada sub-proyek yang mengimpor apa pun dari `scratch/`, jadi menghapus
folder itu tidak memutus build.

## `.freebuff/` — sisanya hanya yang masih hidup

`.freebuff/` juga di-ignore dan seluruh isinya artefak tooling lokal, bukan
bagian proyek. Setelah dibersihkan, root-nya hanya menyisakan empat hal:

- `run.md` — catatan lokal workspace (perintah, port, jebakan).
- `project-id` — penanda proyek milik tooling; jangan dihapus.
- `preview-<id>.log` dan `preview-<id>.log.err` — log sesi dev/preview yang
  **sedang jalan**. Dua file ini ditulis terus-menerus selama ada server aktif,
  jadi biarkan sampai sesinya dimatikan; setelah itu `tidy-logs.sh` yang
  memindahkannya (lihat di bawah).

### Menahan penumpukan log

Folder log ditentukan tooling yang menjalankannya
(`<workspace>/.freebuff/preview-<id>.log`), dan tidak ada setelan di `.freebuff/`
yang bisa mengarahkannya ke tempat lain — jadi log baru memang selalu lahir di
sini. Supaya tidak menumpuk lagi seperti sebelumnya, workspace ini punya
`tidy-logs.sh` di root:

```
./tidy-logs.sh              # pindahkan log sesi yang sudah mati ke scratch/logs/
./tidy-logs.sh --dry-run    # lihat rencananya saja
./tidy-logs.sh --all        # semua *.log/*.err di .freebuff, bukan cuma preview-*
./tidy-logs.sh --min-age 1  # anggap sesi "segar" sampai 1 menit (default 10)
```

Jalankan setelah sesi dev/preview dimatikan (atau kapan pun root `.freebuff/`
mulai terasa penuh). Yang penting:

- **Penilaian dilakukan per sesi, bukan per file.** Satu sesi menulis beberapa
  file sekaligus, dan pola khasnya adalah `preview-<id>.log` statis sementara
  `preview-<id>.log.err` yang tumbuh. Selama salah satu file sesi masih tumbuh —
  atau tersentuh kurang dari `--min-age` menit lalu — seluruh file sesi itu
  dibiarkan, termasuk yang statis.
- **Tidak pernah menghapus.** Hanya `mv`, dan nama bentrok di `scratch/logs/`
  diberi stempel waktu (mis. `preview-crash.20260917-0843.log`), bukan ditimpa.
  File bisa dikembalikan kapan saja dari `scratch/logs/`.
- **Tidak menyentuh `run.md` atau `project-id`** — polanya khusus file log.
- **Jaring pengaman terakhir: file yang masih dipegang proses tidak bisa
  dipindah.** `mv` gagal dengan *Device or resource busy*, dan skrip melaporkan
  baris `HIDUP` lalu melanjutkan — jadi bahkan `--force` tidak akan melepas log
  dari sesi yang benar-benar jalan.

Satu perilaku yang perlu diketahui: sesi dinilai per uuid, jadi kalau ada file
lama dengan uuid sama dari hari lain (mis. `preview-<id>-api.log` yang sisa dari
sesi sebelumnya sementara `preview-<id>.log` jalan sekarang), file lama itu baru
ikut terpindah setelah sesi hari ini selesai.

Sisanya (~80 file: `add-*.js`, `fix-*.js`, `clean-*.js`, `remove-*.js`,
`replace-*.js`, `test-*.js`, dump `.txt`, `start-vite.ps1`, dan semua log lama)
sudah dipindah ke `scratch/scripts/`, `scratch/artifacts/`, dan
`scratch/logs/`. Tidak ada `package.json`, skrip, atau `run.md` yang menunjuk
ke file-file itu — sudah dicek lewat grep — jadi tidak ada jalur yang putus.

## Catatan

- **File kredensial dibiarkan di root dan tidak disentuh** — `cookiejar.txt`,
  `headers*.txt`, `cred-*.json`. Semuanya sudah di-ignore, tapi tetap: rotasi
  atau hapus sendiri kalau sudah tidak dipakai, karena isinya sesi/API key.
- Menjalankan produk: `cd arkxmotion-studio && npm install && npm run dev:all`.
  Catatan port dan jebakannya (mis. `.env` berisi `PORT=3001` sementara Vite
  mem-proxy `/api` ke `6000`) ada di `arkxmotion-studio/.freebuff/run.md` —
  file lokal yang di-ignore, jadi tidak ikut ter-commit. Ada dua `run.md`:
  yang di repo produk untuk cara menjalankannya, yang di root `.freebuff/`
  untuk hal-hal seputar workspace ini.
