// ─── Penjaga gerbang 3: boot harus meninggalkan snapshot ────────────────────
// Gerbang ini menjalankan bash + curl + stat terhadap VPS, jadi tidak bisa
// diuji dengan memanggil fungsi. Tes di sini menjalankannya sungguhan terhadap
// endpoint /api/health tiruan dan folder backup bersuhu waktu terkendali —
// sehingga logikanya terbukti, bukan diasumsikan.
//
// Catatan penting: gerbang dijalankan dengan spawn ASINKRON. `spawnSync` akan
// memblokir event loop, sehingga server health tiruan di proses ini tidak bisa
// menjawab dan semua kasus gagal karena "server tidak merespons" — bukan karena
// logika yang diuji.
//
// Kasus paling penting adalah "kasus produksi": snapshot gerbang 2 (smoke test)
// duduk ~10 detik SEBELUM restart. Snapshot itu tidak boleh dihitung sebagai
// bukti boot, karena itulah bentuk kegagalan yang terjadi 17 Sep 2026.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const GATE = path.join(ROOT, 'scripts', 'check-boot-backup.sh')

const now = () => Math.floor(Date.now() / 1000)
const mkdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gate3-'))

let uptime = 5
const server = http.createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString(), uptime }))
    return
  }
  if (req.url === '/api/backup/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ local: { count: 1 }, r2: {}, scheduler: {} }))
    return
  }
  res.writeHead(404)
  res.end('{}')
})

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port

test.after(() => server.close())

interface Hasil {
  code: number
  out: string
}

/** Jalankan gerbang dengan snapshot berumur `snapshotAges` detik (relatif sekarang). */
function jalankanGerbang(opts: {
  uptimeDetik: number
  snapshotAges?: number[]
  marker?: number
  waitSeconds?: number
  baseUrl?: string
}): Promise<Hasil> {
  uptime = opts.uptimeDetik
  const dir = mkdir()
  for (const [i, age] of (opts.snapshotAges || []).entries()) {
    const file = path.join(dir, `arkxmotion-20260917-0442${String(10 + i).padStart(2, '0')}.db`)
    fs.writeFileSync(file, 'x')
    const t = now() - age
    fs.utimesSync(file, t, t)
  }

  const args = [GATE]
  if (opts.marker !== undefined) args.push(String(opts.marker))

  return new Promise((resolve) => {
    const child = spawn('bash', args, {
      cwd: ROOT,
      env: {
        ...process.env,
        BASE_URL: opts.baseUrl ?? `http://127.0.0.1:${port}`,
        BACKUP_DIR: dir,
        LOG_DIR: dir,
        WAIT_SECONDS: String(opts.waitSeconds ?? 6),
        POLL_SECONDS: '1',
        GRACE_SECONDS: '3',
      },
    })
    let out = ''
    child.stdout.on('data', (d) => (out += String(d)))
    child.stderr.on('data', (d) => (out += String(d)))
    child.on('close', (code) => resolve({ code: code ?? -1, out }))
  })
}

test('snapshot yang lebih baru dari start proses → lolos', async () => {
  const hasil = await jalankanGerbang({ uptimeDetik: 5, snapshotAges: [1], marker: now() - 5 })
  assert.equal(hasil.code, 0, hasil.out)
  assert.match(hasil.out, /GERBANG 3 LOLOS/)
})

test('KASUS PRODUKSI: snapshot lama sebelum restart tidak dihitung sebagai bukti boot', async () => {
  // Proses baru start 5 detik lalu, tapi snapshot terbaru berumur 15 detik —
  // persis pola gerbang 2 (snapshot 11:42:10) vs restart (11:42:19).
  const hasil = await jalankanGerbang({ uptimeDetik: 5, snapshotAges: [15], marker: now() - 5, waitSeconds: 3 })
  assert.equal(hasil.code, 1, hasil.out)
  assert.match(hasil.out, /bukan bukti boot ini/)
  assert.match(hasil.out, /TIDAK berjalan/)
})

test('tanpa snapshot sama sekali → gagal', async () => {
  const hasil = await jalankanGerbang({ uptimeDetik: 5, snapshotAges: [], waitSeconds: 3 })
  assert.equal(hasil.code, 1, hasil.out)
  assert.match(hasil.out, /tidak ada snapshot sama sekali/)
})

test('server tidak merespons → gagal, bukan lolos diam-diam', async () => {
  const hasil = await jalankanGerbang({
    uptimeDetik: 5,
    snapshotAges: [1],
    baseUrl: 'http://127.0.0.1:1',
    waitSeconds: 2,
  })
  assert.equal(hasil.code, 1, hasil.out)
  assert.match(hasil.out, /tidak merespons/)
})

test('proses lama yang belum benar-benar restart → gagal dengan sebab yang berbeda', async () => {
  // uptime 600 detik sementara perintah restart baru saja dijalankan:
  // yang salah bukan backup-nya, tapi restart-nya tidak berefek.
  const hasil = await jalankanGerbang({ uptimeDetik: 600, snapshotAges: [1], marker: now(), waitSeconds: 3 })
  assert.equal(hasil.code, 1, hasil.out)
  assert.match(hasil.out, /TIDAK baru start/)
})

test('kegagalan mencetak sebabnya: status backup dan berkas terbaru', async () => {
  const hasil = await jalankanGerbang({ uptimeDetik: 5, snapshotAges: [15], waitSeconds: 3 })
  assert.match(hasil.out, /status backup saat ini/)
  assert.match(hasil.out, /5 berkas terbaru/)
  assert.match(hasil.out, /baris log yang menyebut backup/)
})
