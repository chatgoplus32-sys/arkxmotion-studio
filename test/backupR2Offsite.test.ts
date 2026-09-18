// ─── Penjaga jalur backup off-site (R2) ─────────────────────────────────────
// Dua hal yang dijaga di sini:
//
//   1. "Database kosong" tidak boleh jadi nama lain dari "gagal membaca".
//      Versi lama punya `catch { return 0 }` sendiri di jalur R2, jadi database
//      yang gagal dibaca sekejap tampak kosong dan unggahan dilewati tanpa jejak.
//
//   2. runBackup() harus menyebut apa yang terjadi pada salinan OFF-SITE.
//      Sebelumnya "database kosong" dan "R2 belum dikonfigurasi" dua-duanya
//      mengembalikan { ok: true } — persis bentuk yang membuat "backup" yang
//      hanya ada di disk VPS bisa lolos sebagai seolah-olah aman.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const source = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'backupR2.ts'), 'utf8')

/**
 * Sumber tanpa komentar. Penjaga "pola ini tidak boleh ada lagi" harus melihat
 * kode saja — file ini sendiri menuliskan pola lamanya di komentar penjelasan,
 * dan itu bukan pelanggaran.
 */
const codeOnly = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n')

// DB sementara supaya tes tidak pernah menyentuh data/arkxmotion.db milik dev.
// Harus diset SEBELUM modul db dimuat.
process.env.ARKXMOTION_DB_PATH = path.join(os.tmpdir(), `arkxmotion-r2-test-${process.pid}.db`)

const { getBackupStatus, runBackup, startBackupScheduler, stopBackupScheduler } = await import(
  '../server/lib/backupR2.js'
)
const { countRows } = await import('../server/backup.js')

// ── countRows: "0 yang pasti" dibedakan dari "tidak bisa dibaca" ────────────
test('tabel yang ada tapi kosong dihitung 0', () => {
  assert.equal(countRows('users'), 0)
})

test('kegagalan baca yang bukan "no such table" mengembalikan null, bukan 0', () => {
  // Query sengaja rusak: pesannya bukan "no such table", jadi ini jalur gagal-baca.
  // Sebelumnya nilainya 0 — artinya "database kosong", dan snapshot dilewati.
  assert.equal(countRows('SELECT 1'), null)
})

// ── runBackup: menjawab apa yang benar-benar terjadi ────────────────────────
test('database kosong dijawab eksplisit dan tidak menulis berkas apa pun', async () => {
  const dir = path.join(ROOT, 'data', 'backups')
  const before = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0

  const result = await runBackup()

  assert.equal(result.ok, true)
  assert.equal(result.skipped, 'database-empty', 'harus disebut kosong, bukan sukses tanpa keterangan')
  assert.equal(result.offsite, undefined, 'tidak ada unggahan yang diklaim')
  assert.equal(fs.readdirSync(dir).length, before, 'keputusan kosong diambil sebelum menulis snapshot')
})

// ── status: bukti, bukan harapan ───────────────────────────────────────────
test('status awal tidak mengaku sudah pernah mengunggah', () => {
  const status = getBackupStatus()
  assert.equal(typeof status.r2.configured, 'boolean')
  assert.equal(status.r2.lastUploadAt, null)
  assert.equal(status.r2.lastUploadKey, null)
  assert.equal(status.r2.lastError, null)
  assert.equal(status.scheduler.running, false)
  assert.equal(status.scheduler.nextRunAt, null)
})

test('scheduler menyala dengan jadwal berikutnya, lalu benar-benar berhenti', () => {
  startBackupScheduler()
  const running = getBackupStatus().scheduler
  assert.equal(running.running, true)
  assert.ok(
    running.nextRunAt && !Number.isNaN(Date.parse(running.nextRunAt)),
    'nextRunAt harus waktu yang sah, supaya jadwalnya bisa dipercaya dari luar',
  )

  startBackupScheduler() // start ganda harus diabaikan, bukan menumpuk interval

  stopBackupScheduler()
  const stopped = getBackupStatus().scheduler
  assert.equal(stopped.running, false)
  assert.equal(stopped.nextRunAt, null, 'jadwal ikut dibatalkan, bukan cuma bendera running')
})

// ── penjaga sumber: wiring yang tidak bisa diuji lewat perilaku ─────────────
test('tidak ada lagi catch buta yang mengubah gagal-baca menjadi 0', () => {
  assert.doesNotMatch(codeOnly, /catch \{\s*return 0\s*\}/)
  assert.match(
    codeOnly,
    /import \{[^}]*countRows[^}]*hasBackupableData[^}]*\} from '\.\.\/backup\.js'/,
    'jalur R2 harus memakai aturan hitung baris yang sama dari server/backup.ts',
  )
})

test('hasil runBackup membedakan terunggah, tidak dikonfigurasi, dan gagal', () => {
  assert.match(source, /offsite\?: 'uploaded' \| 'not-configured' \| 'failed'/)
  assert.match(source, /offsite: 'uploaded'/)
  assert.match(source, /offsite: 'not-configured'/)
  assert.match(source, /offsite: 'failed'/)
})

test('kegagalan unggah tidak memangkas apa pun', () => {
  assert.ok(
    source.indexOf("offsite: 'failed'") < source.indexOf('// 3. Prune old backups'),
    'jalur gagal harus keluar sebelum pemangkasan lokal dan R2',
  )
  assert.match(codeOnly, /pemangkasan dilewati/)
})

test('scheduler tidak lagi membuang kegagalan diam-diam', () => {
  assert.doesNotMatch(codeOnly, /\.catch\(\(\) => \{\}\)/)
  assert.match(codeOnly, /runScheduledBackup\(\)/)
})

test('status ikut melaporkan bukti unggahan dan jadwal berikutnya', () => {
  assert.match(codeOnly, /lastUploadAt,/)
  assert.match(codeOnly, /lastError,/)
  assert.match(codeOnly, /nextRunAt,/)
})
