// Hasil Motion Control yang di-mux di browser harus mendarat di URL yang benar-
// benar file video. Kenyataan 6 Nov 2026: rantai upload browser jatuh ke host
// terakhir (tmpfiles) yang cuma mengembalikan URL halaman HTML — hasilnya di
// galeri tidak bisa diputar atau diunduh.
//
// Tes ini mengunci keputusan rantaiya lewat pembacaan sumber, termasuk batas
// ukuran yang membuat file >4 MB lolos dari relay Server satu-satunya yang
// pasti jalan dari browser.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const read = (...rel: string[]) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8')

const CHAIN = read('src', 'lib', 'roboneo.ts')
const RELAY = read('server', 'routes', 'publicUploadCatbox.ts')
const VOICED = read('src', 'lib', 'motionAudio.ts')

const numberConst = (src: string, name: string): number => {
  const m = src.match(new RegExp(`const ${name} = ([\\d_ *]+)`))
  assert.ok(m, `konstanta ${name} tidak ditemukan`)
  return Function(`"use strict";return (${m[1]})`)() as number
}

test('rantai upload browser tidak memakai tmpfiles — URL-nya halaman HTML', () => {
  assert.equal(CHAIN.includes('tmpfiles.org'), false, 'tmpfiles tidak boleh jadi host langsung browser')
})

test('relay Server juga berhenti di 0x0, bukan mengembalikan view URL tmpfiles', () => {
  assert.equal(RELAY.includes('tmpfiles.org'), false)
})

test('host yang URL-nya gagal validasi media tidak boleh dikembalikan', () => {
  assert.equal(CHAIN.includes('using anyway'), false, 'validasi gagal tidak boleh diteruskan')
  const gate = CHAIN.slice(CHAIN.indexOf('export async function uploadToCatbox'))
  assert.match(gate, /validateMedia\(url, kind\)[\s\S]{0,160}throw Error/, 'kegagalan validasi harus melempar')
})

test('relay Server menampung video referensi terbesar (6 MB) — tidak didrop ke host eksternal', () => {
  const cap = numberConst(CHAIN, 'MAX_SERVER_PROXY')
  const maxRefMb = Number(numberConst(read('src', 'pages', 'Motion.tsx'), 'MAX_VIDEO_REF_MB'))
  assert.ok(cap >= maxRefMb * 1024 * 1024, `MAX_SERVER_PROXY ${cap} < batas video referensi ${maxRefMb} MB`)
  // nginx mengirim sampai 50 MB — relay tidak boleh melewatinya
  assert.ok(cap <= 50 * 1024 * 1024)
})

test('hasil bersuara disimpan di penyimpanan sendiri lebih dulu, host eksternal hanya cadangan', () => {
  const fn = VOICED.slice(VOICED.indexOf('export async function uploadVoicedVideo'))
  assert.ok(fn.length > 0, 'uploadVoicedVideo hilang')
  assert.ok(fn.indexOf('uploadBlobToCdn') < fn.indexOf('uploadToCatbox'), 'R2 harus dicoba sebelum host eksternal')
  assert.match(fn, /selfHosted: true/, 'URL penyimpanan sendiri ditandai supaya tidak dicerminkan dua kali')
  assert.match(VOICED, /uploadToCatbox\(file, 'video'/, 'cadangan tetap divalidasi sebagai video')
})
