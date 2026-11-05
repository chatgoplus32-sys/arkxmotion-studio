/**
 * Memuat `.env` untuk seluruh server — satu-satunya tempat pemuatan.
 *
 * Kenapa modul ini ada: ESM mengevaluasi SELURUH impor sebuah modul sebelum
 * body-nya berjalan. Jadi `dotenv.config()` yang dulu ditulis di body
 * `server/index.ts` (baris 49) baru berjalan setelah modul-modul impornya
 * dievaluasi — padahal beberapa modul membaca `process.env` di top level:
 * `lib/backupR2.ts` (R2_*, BACKUP_KEEP_*), `lib/alerts.ts`, `routes/auth.ts`
 * (JWT_SECRET), `db.ts` (ARKXMOTION_DB_PATH), dan `index.ts` sendiri.
 *
 * Nilai dari `.env` dulu terbaca hanya karena kebetulan urutan impor:
 * `routes/auth.ts` (impor baris 9) mengimpor `mailer.ts`, dan `mailer.ts`
 * memanggil dotenv di top level, sehingga `.env` sudah termuat sebelum
 * `lib/backupR2.ts` dievaluasi di baris 47.
 *
 * Terbukti bukan teori: dengan isi `.env` yang sama, menukar urutan dua impor
 * itu mengubah `getBackupStatus().r2.configured` dari true menjadi false —
 * tanpa peringatan, tanpa error, sementara scheduler tetap menyala karena
 * `index.ts:205` ada di body (setelah dotenv). Kredensial R2 yang sudah benar
 * tinggal tidak terpakai, dan unggahan tidak pernah terjadi.
 *
 * Karena itu modul ini diimpor PALING AWAL di `server/index.ts`. Urutan itu
 * dijaga oleh `test/envLoadOrder.test.ts` — jangan pindahkan impornya ke bawah.
 *
 * Body modul ini juga dipakai untuk efek samping boot lain yang harus jalan
 * sebelum modul mana pun membuat koneksi: urutan resolusi DNS.
 */
import dotenv from 'dotenv'
import dns from 'node:dns'

dotenv.config()

// IPv4 didahulukan untuk SEMUA koneksi keluar. VPS tidak punya IPv6 (kernel
// menolak AF_INET6), sementara Cloudflare mengembalikan rekaman AAAA lebih dulu
// — sejak Node 17 urutan default-nya 'verbatim', jadi Node menunggu koneksi
// IPv6 gagal dulu sebelum jatuh ke IPv4. Terukur 5 Nov 2026 dari VPS:
// GET /v1/models Seavi 51.820 ms lewat fetch Node vs 904 ms lewat `curl -4`.
dns.setDefaultResultOrder('ipv4first')
