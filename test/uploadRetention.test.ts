// ─── Retention uploads: buang yang tua, sisakan yang baru ───────────────────
// Tanpa R2, uploads/ adalah satu-satunya tempat hasil generate disimpan, jadi
// pemangkasan ini yang menjaga disk VPS tidak penuh (disk penuh = nginx membalas
// HTML, frontend melihat "Unexpected token '<'"). Tes memakai folder sementara
// supaya tidak pernah menyentuh uploads/ sungguhan.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-'))
process.env.UPLOAD_DIR = tmp

const { pruneOldUploads } = await import('../server/lib/mediaStorage.js')

const hari = 24 * 60 * 60 * 1000

function buat(key: string, umurHari: number, isi = 'x'.repeat(32)) {
  const target = path.join(tmp, key)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, isi)
  const waktu = new Date(Date.now() - umurHari * hari)
  fs.utimesSync(target, waktu, waktu)
  return target
}

test('file lebih tua dari batas dihapus, file baru disisakan', () => {
  const tua = buat('videos/tua.mp4', 5)
  const baru = buat('videos/baru.mp4', 1)
  const hasil = pruneOldUploads(3)

  assert.equal(hasil.deleted, 1)
  assert.equal(hasil.failed, 0)
  assert.equal(hasil.bytes, 32)
  assert.equal(fs.existsSync(tua), false)
  assert.equal(fs.existsSync(baru), true)
})

test('file tepat di dalam batas tidak disentuh', () => {
  const aman = buat('videos/dua-setengah-hari.mp4', 2.5)
  pruneOldUploads(3)
  assert.equal(fs.existsSync(aman), true)
})

test('retention 0 = mati, tidak menghapus apa pun', () => {
  const tua = buat('videos/lama-sekali.mp4', 30)
  const hasil = pruneOldUploads(0)
  assert.equal(hasil.skipped, true)
  assert.equal(hasil.deleted, 0)
  assert.equal(fs.existsSync(tua), true)
  // Bersihkan supaya tes berikutnya hanya melihat file miliknya sendiri.
  fs.rmSync(tua)
})

test('subfolder ikut dipangkas, dan tidak melempar saat folder kosong', () => {
  const dalam = buat('videos/2026/10/dalam.mp4', 10)
  const hasil = pruneOldUploads(3)
  assert.equal(hasil.deleted, 1)
  assert.equal(fs.existsSync(dalam), false)
  // Folder sementara lain tidak ada — pemanggilan kedua harus tenang.
  assert.equal(pruneOldUploads(3).deleted, 0)
})
