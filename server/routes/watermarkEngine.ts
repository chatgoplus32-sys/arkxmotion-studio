import { Router, Request, Response } from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const router = Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Mesin penghapus watermark video yang dipakai situs referensi
// (geminiwatermarkremover.io/video) sudah ada di dependencies kita: paket
// @pilio/gemini-watermark-remover. Aplikasi videonya berupa bundel browser
// (dist/video-app.js + halaman + model ONNX FDnCNN + wasm onnxruntime) yang tidak
// bisa diimpor sebagai modul, hanya bisa dijalankan sebagai halaman. Jadi
// file-file itu disajikan dari node_modules, bukan disalin ke repo: totalnya
// ±44 MB dan versinya sudah terkunci oleh package.json.
const ENGINE_DIST = findEngineDist()

function findEngineDist(): string | null {
  let dir = path.resolve(__dirname, '..', '..')
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(dir, 'node_modules', '@pilio', 'gemini-watermark-remover', 'dist')
    if (fs.existsSync(path.join(candidate, 'video-app.js'))) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

// Whitelist eksplisit: hanya aset yang dibutuhkan halaman video engine.
const ALLOWED = /^(?:video-preview\.html|video-app\.js|onnxruntime\/[\w.-]+|models\/allenk-fdncnn\/[\w.-]+)$/

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.json': 'application/json; charset=utf-8',
}

// Express 5 menolak pola '*' di router.get, jadi tangani semua metode di sini.
router.use((req: Request, res: Response) => {
  // Aset mesin selalu diminta dari halaman engine kami sendiri, tapi browser
  // mengirim header Origin untuk setiap request ES module / worker — termasuk
  // yang sama-origin. Tanpa cerminan ACAO, fetch modul itu dianggap CORS dan
  // gagal dengan "Failed to fetch dynamically imported module", sehingga
  // runtime ONNX tidak pernah siap. Ini berkas statis MIT milik paket publik,
  // jadi mencerminkan Origin di sini tidak membuka apa pun.
  const origin = req.headers.origin
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') return res.status(204).end()

  if (!ENGINE_DIST) {
    return res.status(503).json({ ok: false, error: 'Watermark engine tidak terpasang di server' })
  }

  const rel = decodeURIComponent(req.path).replace(/^\/+/, '')
  if (!ALLOWED.test(rel)) return res.status(404).json({ ok: false, error: 'Not found' })

  const abs = path.resolve(ENGINE_DIST, rel)
  if (!abs.startsWith(ENGINE_DIST + path.sep)) return res.status(403).json({ ok: false, error: 'Forbidden' })
  if (!fs.existsSync(abs)) return res.status(404).json({ ok: false, error: 'Not found' })

  const type = CONTENT_TYPES[path.extname(abs).toLowerCase()]
  if (type) res.setHeader('Content-Type', type)
  // Model + wasm berukuran belasan MB dan hanya diminta saat pengguna benar-benar
  // memakai alatnya. Tanpa immutable: bila versi paket naik, browser wajib
  // merevalidasi (ETag dari sendFile membuat revalidasi hanya jadi 304 kecil).
  res.setHeader('Cache-Control', rel.endsWith('.html') ? 'no-cache' : 'public, max-age=86400')

  return res.sendFile(abs, (err) => {
    if (err) console.error('[watermark-engine] sendFile gagal:', err.message)
  })
})

export default router
