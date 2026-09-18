// ─── Penjaga kesepakatan skrip seed dan aplikasi ────────────────────────────
// scripts/seed-r2-backups.mjs mengunggah snapshot lama, dan verifikasinya
// membandingkan daftar objek di prefix yang SAMA dengan yang ia pakai sendiri.
// Kalau prefix-nya menyimpang dari `BACKUP_PREFIX` milik server/lib/backupR2.ts,
// skrip akan melaporkan sukses sambil mengunggah ke tempat yang tidak pernah
// dibaca aplikasi — bentuk "berhasil" yang paling menyesatkan.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const appSource = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'backupR2.ts'), 'utf8')
const scriptSource = fs.readFileSync(path.join(ROOT, 'scripts', 'seed-r2-backups.mjs'), 'utf8')

/**
 * Skrip tanpa komentar. Penjaga "pola ini tidak boleh ada" harus melihat kode
 * saja; skrip ini sendiri menyebut DeleteObject di komentar penjelasannya.
 */
const scriptCode = scriptSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n')

test('prefix R2 di skrip seed sama dengan BACKUP_PREFIX aplikasi', () => {
  const app = /const BACKUP_PREFIX = '([^']+)'/.exec(appSource)
  assert.ok(app, 'BACKUP_PREFIX harus ada di server/lib/backupR2.ts')

  const script = /const PREFIX = '([^']+)'/.exec(scriptSource)
  assert.ok(script, 'PREFIX harus ada di scripts/seed-r2-backups.mjs')

  // Aplikasi menyimpan backup sebagai `${BACKUP_PREFIX}/${filename}`.
  assert.equal(
    script[1],
    app[1] + '/',
    'prefix skrip seed harus sama dengan prefix aplikasi',
  )
})

test('skrip seed tidak pernah menghapus objek', () => {
  assert.doesNotMatch(scriptCode, /DeleteObject/, 'skrip ini hanya boleh menambah, bukan memangkas')
})

test('skrip seed memverifikasi dengan membaca ulang daftar objek', () => {
  assert.match(scriptCode, /Verifikasi dengan membaca ulang/)
  assert.match(scriptCode, /ListObjectsV2Command/)
})

test('skrip seed menolak jalan tanpa kredensial, bukan gagal separuh jalan', () => {
  assert.match(scriptCode, /R2 BELUM DIKONFIGURASI/)
  assert.match(scriptCode, /process\.exit\(1\)/)
})
