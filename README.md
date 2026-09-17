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
| `dev.sh` | Titik masuk kerja: rapikan log → cek jebakan port/`.env` → jalankan `npm run dev:all`. Lihat "Menjalankan semuanya". |
| `test-scripts.sh` | Tes untuk `tidy-logs.sh` dan `dev.sh` di sandbox (sesi log sintetis, `npm`/`netstat` tiruan). Lihat "Tes". |
| `check.sh` | Satu perintah pemeriksaan: konsistensi `.env` vs `.env.example` vs proxy Vite, tes skrip, typecheck repo produk; sekaligus pemasang pre-commit hook. Lihat "Pemeriksaan menyeluruh". |

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

## Menjalankan semuanya

```
./dev.sh                  # perapian log + cek + nyalakan dev server
./dev.sh --dry-run        # cek saja, server tidak dinyalakan
./dev.sh --no-tidy        # lewati perapian log (awal dan akhir)
./dev.sh --respect-env    # ikuti PORT dari `.env` (default: ikuti proxy Vite)
./dev.sh --api-port 7000  # paksa port backend lain
./dev.sh -- --host        # teruskan argumen setelah `--` ke npm
```

Satu perintah itu mengerjakan tiga hal berurutan:

1. **Merapikan log lebih dulu** lewat `tidy-logs.sh`, jadi perapian tidak perlu
   diingat dan tidak ada sesi lama yang menumpuk di `.freebuff/` sebelum kerja
   berikutnya dimulai.
2. **Memverifikasi bahwa port backend dan proxy Vite sepakat.** `.env` memakai
   `PORT=6000` dan `vite.config.ts` mem-proxy `/api` ke `6000`; kalau keduanya
   berbeda, app akan tampak jalan sementara setiap permintaan `/api` gagal
   tersambung. Karena itu kesamaannya dicek lebih dulu dan dilaporkan sebagai
   baris `ok:`, sedangkan selisihnya jadi `PERINGATAN` lengkap dengan cara
   memperbaiki akarnya — di `.env`, bukan lewat opsi skrip (server memanggil
   dotenv tanpa override, jadi nilai dari shell selalu bisa menimpa `.env`).
   Selain itu: `node_modules` yang hilang di-`npm install` otomatis, dan port
   yang sudah terisi dilaporkan lengkap dengan PID-nya.
3. **Menjalankan `npm run dev:all`** dengan seluruh output disalin ke
   `scratch/logs/dev-<stamp>.log`, lalu merapikan sekali lagi saat berhenti.
   Exit code npm diteruskan apa adanya.

Kalau port sudah terisi, `dev.sh` berhenti **sebelum** menyalakan apa pun
(daripada backend mati dengan `EADDRINUSE` di tengah tumpukan log). `--force`
melewati pemeriksaan itu.

`dev.sh` juga menyetel `AUTO_BACKUP=0` untuk sesi ini (kecuali Anda sudah
menyetelnya sendiri, mis. `AUTO_BACKUP=1 ./dev.sh`). Latarnya: `server/index.ts`
dulu menjalankan `backupOnStartup()` di setiap boot — menulis snapshot ke
`data/backups/` **dan** memangkas backup lama — plus menyalakan scheduler R2
begitu `R2_ACCOUNT_ID` ada. Sekarang semuanya hanya jalan di production (atau
kalau `AUTO_BACKUP=1` diminta eksplisit), dan `dev.sh` menutup celah sisa:
`NODE_ENV=production` yang nyasar di shell tidak lagi menghidupkan backup saat
sesi dev.

## Tes

```
./test-scripts.sh     # 55 pemeriksaan, sekitar 75 detik; exit 0 kalau semua lolos
```

Kedua skrip menentukan akar workspace dari lokasi file-nya sendiri, jadi suite
ini menyalinnya ke sandbox (`mktemp -d`) berisi `arkxmotion-studio/` palsu,
`.freebuff/` berisi sesi log sintetis, dan `npm`/`netstat` tiruan di `bin/`.
Tidak ada berkas workspace asli yang tersentuh dan tidak ada server yang
dinyalakan: `npm` tiruan hanya mencatat invokasinya — argumen, `PORT`,
`AUTO_BACKUP`, `NODE_ENV` — lalu keluar dengan kode yang ditentukan tes.

Yang dijaga paling ketat adalah perlindungan sesi hidup: satu sesi menulis
beberapa berkas sekaligus, dan berkas statis tidak boleh terlepas hanya karena
pasangannya yang tumbuh. Supaya tesnya benar-benar menjaga, suite ini juga saya
jalankan terhadap versi yang sengaja dirusak: liveness dibuat per-berkas
(bukan per-sesi) → 3 tes gagal; deteksi port proxy dikembalikan ke pola lama
yang rusak → 8 tes gagal.

Dan suite ini langsung menemukan satu bug nyata saat pertama dijalankan:
deteksi port proxy di `dev.sh` memakai `grep -oE '[0-9]+$'`, padahal teks yang
cocok diakhiri tanda kutip atau koma — jadi pola itu selalu gagal, nilainya
selalu jatuh ke default `6000`, dan pemeriksaan "port cocok atau tidak" cuma
kelihatan bekerja. Sekarang diambil dengan `sed`.

## Pemeriksaan menyeluruh

```
./check.sh                 # semua fase (sekitar 100 detik)
./check.sh --staged        # hanya yang relevan dengan berkas yang di-stage
./check.sh --config-only   # fase konfigurasi saja (di bawah 1 detik)
./check.sh --install-hook  # pasang pre-commit hook di repo workspace
./check.sh --install-hook --product     # ... dan di repo produk
./check.sh --uninstall-hook [--product]
```

Tiga fase:

1. **Konfigurasi lokal** — selalu jalan karena biayanya di bawah satu detik dan
   kelas kesalahan yang dijaganya tidak kelihatan sampai ada permintaan `/api`
   yang gagal: `PORT` di `.env` harus cocok dengan `.env.example` **dan** dengan
   target proxy `/api` di `vite.config.ts`, dan setiap kunci di `.env` harus
   terdokumentasi di `.env.example`.
2. **Tes skrip** — menjalankan `test-scripts.sh` di sandbox; kalau gagal, hanya
   baris `GAGAL`-nya yang ditampilkan.
3. **Typecheck repo produk** — `npm run typecheck:backend`.

Hook-nya cuma wrapper tipis: `.git/hooks/pre-commit` memanggil `check.sh --staged`,
yang memilih fase menurut berkas yang di-stage — ada `*.sh` → jalankan tes; ada
perubahan di `server/`, `api/`, `package.json`, atau `tsconfig*.json` repo produk
→ jalankan typecheck; fase konfigurasi selalu jalan. Terpasang di **kedua** repo
(workspace dan produk), dan keduanya menunjuk `check.sh` milik workspace — repo
produk tidak menyimpan salinannya sendiri yang harus ikut dirawat. Hasilnya:
commit dokumentasi ≈1 detik, perubahan `server/` ≈11 detik (konfigurasi +
typecheck), perubahan skrip ≈95 detik (konfigurasi + seluruh suite).

Hook yang sudah ada tidak pernah ditimpa: kalau `pre-commit` bukan buatan
`check.sh`, pemasangan ditolak dan menyarankan `--force` (hook lama lalu
disimpan sebagai `pre-commit.backup-<stamp>`). Pengenalannya lewat penanda
`penanda: check.sh-hook`, bukan sekadar nama berkasnya — hook orang lain yang
kebetulan menyebut "check.sh" tidak diklaim sebagai milik sendiri. Hook versi
lama yang belum berpenanda tetap dikenali dan di-upgrade tanpa `--force`.

## Catatan

- **File kredensial dibiarkan di root dan tidak disentuh** — `cookiejar.txt`,
  `headers*.txt`, `cred-*.json`. Semuanya sudah di-ignore, tapi tetap: rotasi
  atau hapus sendiri kalau sudah tidak dipakai, karena isinya sesi/API key.
- Menjalankan produk: `./dev.sh` (lihat "Menjalankan semuanya"). Kalau ingin
  manual: `cd arkxmotion-studio && npm install && npm run dev:all` — sudah aman
  karena `.env` dan `.env.example` sama-sama memakai `PORT=6000`, cocok dengan
  target proxy `/api` di `vite.config.ts`. Sebelumnya `.env` berisi `3001`,
  sehingga backend berdiri di port yang tidak ditunjuk siapa pun dan tidak ada
  satu pun rujukan `3001` lain di seluruh repo produk. Catatan port ada di
  `arkxmotion-studio/.freebuff/run.md` — file lokal yang di-ignore, jadi tidak
  ikut ter-commit. Ada dua `run.md`: yang di repo produk untuk cara
  menjalankannya, yang di root `.freebuff/` untuk hal-hal seputar workspace ini.
