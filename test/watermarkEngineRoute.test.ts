// ─── Penjaga aset mesin watermark video ─────────────────────────────────────
// Halaman engine (@pilio/gemini-watermark-remover) di-load lewat iframe
// same-origin dan menarik asetnya sendiri: bundel ES module, wasm onnxruntime,
// dan model ONNX FDnCNN. Dua hal yang sudah benar-benar merusak ini di dev:
//   1. Express 5 menolak pola rute '*' → server mati saat start;
//   2. gerbang cors() API menolak request yang membawa header Origin — dan
//      browser SELALU mengirim Origin untuk impor ES module, sehingga runtime
//      ONNX gagal dimuat ("Failed to fetch dynamically imported module").
// Karena itu rute ini harus terpasang SEBELUM cors() dan mencerminkan Origin.

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import watermarkEngineRoutes from '../server/routes/watermarkEngine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const app = express()
app.use('/api/public/watermark-engine', watermarkEngineRoutes)

let server: ReturnType<typeof app.listen>
let base = ''

before(async () => {
  server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => new Promise<void>((resolve) => server.close(() => resolve())))

const get = (rel: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/public/watermark-engine/${rel}`, { headers })

test('halaman engine disajikan dan punya kontrak DOM yang dipakai bridge', async () => {
  const res = await get('video-preview.html')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') || '', /text\/html/)
  assert.equal(res.headers.get('cache-control'), 'no-cache')
  const html = await res.text()
  for (const id of ['fileInput', 'processBtn', 'resetBtn', 'cancelBtn', 'downloadBtn', 'status', 'allowLowConfidence', 'denoiseBackend', 'videoBitrateMbps']) {
    assert.ok(html.includes(`id="${id}"`), `halaman engine kehilangan #${id}`)
  }
})

test('aset engine menerima header Origin (impor ES module browser)', async () => {
  const origin = 'http://localhost:5173'
  const res = await get('video-app.js', { Origin: origin })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('access-control-allow-origin'), origin)
  assert.equal(res.headers.get('vary'), 'Origin')
  assert.match(res.headers.get('content-type') || '', /javascript/)
})

test('preflight OPTIONS dijawab tanpa menyentuh whitelist berkas', async () => {
  const res = await fetch(`${base}/api/public/watermark-engine/onnxruntime/ort-wasm-simd-threaded.wasm`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
  })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173')
})

test('wasm dan model ONNX punya Content-Type yang benar', async () => {
  const wasm = await get('onnxruntime/ort-wasm-simd-threaded.asyncify.wasm')
  assert.equal(wasm.status, 200)
  assert.equal(wasm.headers.get('content-type'), 'application/wasm')
  assert.equal(wasm.headers.get('cache-control'), 'public, max-age=86400')

  const onnx = await get('models/allenk-fdncnn/model_core_fp32_104.onnx')
  assert.equal(onnx.status, 200)
  assert.equal(onnx.headers.get('content-type'), 'application/octet-stream')
})

test('di luar whitelist aset engine: 404, termasuk upaya traversal', async () => {
  // Catatan: Express menormalkan ".." SEBELUM rute dipanggil, jadi URL dengan
  // titik-titik hanya bisa lolos kalau hasilnya memang aset yang diizinkan.
  // Yang harus mati adalah upaya keluar dari dist lewat encoding.
  for (const rel of [
    'package.json',
    'video-app.js.map',
    'models/allenk-fdncnn/../../package.json',
    '%2e%2e%2f%2e%2e%2f%2e%2e%2fpackage.json',
    'onnxruntime/%2e%2e%2f%2e%2e%2fpackage.json',
    'models/%2e%2e%2f%2e%2e%2fserver%2findex.ts',
    'LICENSE',
  ]) {
    const res = await get(rel)
    assert.equal(res.status, 404, `${rel} seharusnya tidak disajikan (${res.status})`)
  }
})

test('rute engine terpasang sebelum gerbang cors() di server/index.ts', () => {
  const source = fs.readFileSync(path.join(ROOT, 'server', 'index.ts'), 'utf8')
  const engineAt = source.indexOf("app.use('/api/public/watermark-engine'")
  const corsAt = source.indexOf('app.use(cors(')
  assert.ok(engineAt >= 0, 'rute watermark-engine tidak terpasang')
  assert.ok(corsAt >= 0, 'gerbang cors() tidak ditemukan')
  assert.ok(engineAt < corsAt, 'rute engine WAJIB sebelum cors(): impor ES module membawa Origin dan akan ditolak')
})
