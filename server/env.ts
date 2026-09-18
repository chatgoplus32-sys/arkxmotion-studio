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
 */
import dotenv from 'dotenv'

dotenv.config()
