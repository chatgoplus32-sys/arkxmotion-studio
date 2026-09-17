// ─── Test keputusan snapshot saat boot ──────────────────────────────────────
// Backup saat start dulu bisa melewatkan snapshot DIAM-DIAM kalau pembacaan
// tabel gagal: `countRows()` menelan error dan mengembalikan 0, sehingga
// database yang terkunci sekejap tampak seperti "masih kosong". Kasus di sini
// menjaga garis pemisahnya — 0 yang pasti tidak sama dengan tidak bisa dibaca.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { hasBackupableData } from '../server/backup.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'backup.ts'), 'utf8')

test('database yang terbaca kosong memang dilewati', () => {
  assert.equal(hasBackupableData([0, 0, 0]), false)
})

test('ada data di salah satu tabel berarti backup dijalankan', () => {
  assert.equal(hasBackupableData([3, 0, 0]), true)
  assert.equal(hasBackupableData([0, 0, 7]), true)
})

test('tidak bisa dibaca tidak diperlakukan sebagai kosong', () => {
  assert.equal(hasBackupableData([null, 0, 0]), true)
  assert.equal(hasBackupableData([null, null, null]), true)
  assert.equal(hasBackupableData([0, null, 0]), true)
})

test('countRows membedakan gagal-baca dari tabel kosong', () => {
  // Boleh mengembalikan null, artinya "tidak terbaca".
  assert.match(source, /function countRows\(table: string\): number \| null/)
  // Hanya tabel yang belum ada yang boleh dianggap kosong.
  assert.match(source, /no such table/i)
  // Tidak ada lagi catch buta yang mengubah kegagalan menjadi 0.
  assert.doesNotMatch(source, /catch \{\s*return 0\s*\}/)
})

test('gerbang backup memakai keputusan itu, bukan membandingkan angka langsung', () => {
  assert.match(source, /const counts = \[countRows\('users'\), countRows\('tokens'\), countRows\('generation_logs'\)\]/)
  assert.match(source, /hasBackupableData\(counts\)/)
  // Kalau ada yang tidak terbaca, itu harus terlihat di log.
  assert.match(source, /tidak sepenuhnya terbaca/)
})
