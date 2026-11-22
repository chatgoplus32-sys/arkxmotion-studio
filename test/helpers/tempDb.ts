// Isolasi database untuk test yang memakai server/db.ts.
//
// Tanpa ini, test memakai `data/arkxmotion.db` relatif terhadap cwd — di VPS
// itu adalah DATABASE PRODUKSI. Akibatnya pengaturan nyata (mis.
// app_settings.nexot_submit_concurrency) ikut menentukan perilaku test dan
// test bisa menulis ke data produksi. Impor helper ini PALING PERTAMA supaya
// env terbaca sebelum modul server dievaluasi (ESM import di-evaluasi sesuai
// urutan deklarasi).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PREFIX = 'arkxmotion-test-db-'
const UMUR_BASI_MS = 60 * 60 * 1000

try {
  const batas = Date.now() - UMUR_BASI_MS
  for (const nama of fs.readdirSync(os.tmpdir())) {
    if (!nama.startsWith(PREFIX)) continue
    const berkas = path.join(os.tmpdir(), nama)
    try {
      if (fs.statSync(berkas).mtimeMs < batas) fs.unlinkSync(berkas)
    } catch {
      /* dipakai proses lain / sudah hilang */
    }
  }
} catch {
  /* tmpdir tidak terbaca — bukan tugas test ini */
}

export const TEST_DB_PATH = path.join(os.tmpdir(), `${PREFIX}${process.pid}-${Date.now()}.db`)
process.env.ARKXMOTION_DB_PATH = TEST_DB_PATH

/** Hapus DB test beserta file WAL/SHM-nya. Dipanggil dari test.after(). */
export function bersihkanTempDb(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix) } catch { /* sudah hilang / terkunci */ }
  }
}
