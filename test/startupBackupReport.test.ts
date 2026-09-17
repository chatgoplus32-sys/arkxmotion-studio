// ─── Penjaga laporan backup saat start ──────────────────────────────────────
// Latar: boot pm2 pada deploy 17 Sep, 7faf8f0, dan 55a4bfa tidak meninggalkan
// snapshot, dan dari luar keempat sebabnya terlihat identik — tidak ada berkas
// baru. Tes ini mengunci pelaporannya, bukan cuma jalurnya:
//
//   created       — snapshot dibuat
//   skipped-empty — tiga tabel terbaca kosong (atau tabelnya tidak ada)
//   failed        — exception, dengan pesannya
//   not-run       — gerbang AUTO_BACKUP menutup jalurnya
//
// `backupOnStartup(dir)` menerima folder tujuan supaya tes dapat memaksa jalur
// gagal tanpa menyentuh data/backups milik aplikasi.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const dbFile = path.join(os.tmpdir(), `arkxmotion-startup-report-${process.pid}.db`)
process.env.ARKXMOTION_DB_PATH = dbFile // harus sebelum modul db dimuat

const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix))

const { backupOnStartup, getStartupBackupStatus, noteStartupBackupDisabled } = await import(
  '../server/backup.js'
)
const { default: db, dbPath } = await import('../server/db.js')
const { getBackupStatus } = await import('../server/lib/backupR2.js')

test('database kosong: dilaporkan sebagai skipped-empty beserta angkanya', async () => {
  const dir = tmp('startup-empty-')
  const hasil = await backupOnStartup(dir)

  assert.equal(hasil, null, 'tidak ada snapshot yang dibuat')

  const laporan = getStartupBackupStatus()
  assert.equal(laporan?.outcome, 'skipped-empty')
  assert.deepEqual(laporan?.counts, [0, 0, 0])
  assert.match(laporan?.reason || '', /users=0 tokens=0 generation_logs=0/)
  assert.ok(
    (laporan?.reason || '').includes(dbPath),
    'alasan harus menyebut database mana yang benar-benar dibuka — itulah yang membedakan "kosong" dari "salah berkas"',
  )
})

test('ada data: dilaporkan created dan berkasnya benar-benar ada', async () => {
  db.prepare(
    "INSERT INTO users (email, password, name) VALUES ('uji-laporan@contoh.test', 'x', 'uji')",
  ).run()

  const dir = tmp('startup-created-')
  const hasil = await backupOnStartup(dir)

  assert.ok(hasil && fs.existsSync(hasil), 'snapshot harus ada di disk')

  const laporan = getStartupBackupStatus()
  assert.equal(laporan?.outcome, 'created')
  assert.equal(laporan?.snapshot, path.basename(hasil as string))
  assert.equal(laporan?.path, hasil)
  assert.ok(fs.readdirSync(dir).some((f) => f === laporan?.snapshot), 'berkasnya ada di folder tujuan')
})

test('folder tujuan tidak sah: dilaporkan failed dengan pesannya, tanpa melempar', async () => {
  const berkas = path.join(tmp('startup-file-'), 'bukan-folder')
  fs.writeFileSync(berkas, 'x')

  const hasil = await backupOnStartup(path.join(berkas, 'sub'))

  assert.equal(hasil, null, 'kegagalan tidak boleh membuat pemanggilnya ikut gagal')
  const laporan = getStartupBackupStatus()
  assert.equal(laporan?.outcome, 'failed')
  assert.ok((laporan?.reason || '').length > 0, 'pesan kegagalannya harus ikut dilaporkan')
  assert.match(String(laporan?.reason), /ENOTDIR|ENOENT|EEXIST|not a directory|cannot find/i)
})

test('gerbang AUTO_BACKUP tertutup: dilaporkan not-run, bukan failed', async () => {
  noteStartupBackupDisabled('gerbang AUTO_BACKUP tertutup (uji)')

  const laporan = getStartupBackupStatus()
  assert.equal(laporan?.outcome, 'not-run')
  assert.match(laporan?.reason || '', /AUTO_BACKUP/)
})

test('laporan itu yang muncul di /api/backup/status', async () => {
  noteStartupBackupDisabled('gerbang AUTO_BACKUP tertutup (status)')
  const status = getBackupStatus()
  assert.equal(status.startup?.outcome, 'not-run')
  assert.match(status.startup?.reason || '', /status/)
})

test('index.ts mencatat alasan saat gerbang backup tertutup', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.ts'), 'utf8')
  assert.match(src, /import \{ backupOnStartup, noteStartupBackupDisabled \} from '\.\/backup\.js'/)

  // Namanya muncul saja tidak cukup: panggilan yang dipindah ke dalam ekspresi
  // yang tidak pernah dievaluasi, misalnya "void 0 && noteStartupBackupDisabled",
  // tetap lolos pencarian nama, padahal laporannya tidak pernah ditulis. Jadi
  // panggilannya harus berupa pernyataan sendiri di sekitar cabang berikut.
  const baris = src.split(/\r?\n/)
  const idx = baris.findIndex((l) => l.includes('Backup otomatis dilewati'))
  assert.ok(idx > 0, 'cabang "backup dilewati" harus ada di index.ts')

  const jendela = baris.slice(Math.max(0, idx - 12), idx + 2).join('\n')
  assert.match(
    jendela,
    /^\s*noteStartupBackupDisabled\(/m,
    'di cabang itu noteStartupBackupDisabled() harus dipanggil sebagai pernyataan sendiri',
  )
})
