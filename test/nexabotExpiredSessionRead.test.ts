// ─── Hasil job tidak boleh hilang karena sesi app mati di tengah job ────────
//
// Kejadian produksi 2026-11-01: generate Seedance 30d menit jalan, tab browser
// dibekukan (Memory Saver) sehingga tick perpanjangan sesi di App.tsx tidak
// pernah jalan. Access token app cuma 15 menit. Saat tab hidup lagi, poll
// berikutnya dijawab relay 400 "Kunci NexaBot milik server hanya untuk member
// yang login" — dan klien menyalahartikannya sebagai kunci mati: rotasi kunci
// mengirim job BARU (kredit terpotong dua kali) sedangkan video yang sudah
// jadi ditinggalkan.
//
// Yang dikunci di sini (sisi server):
//  1. rute baca untuk job yang relay ini buat sendiri tetap dilayani walau
//     token app kedaluwarsa — submit-nya sudah lolos identitas + tiket, dan
//     rute baca tidak memakai kredit;
//  2. job yang TIDAK kita ingat tetap butuh identitas, jadi kelonggarannya
//     terbatas pada job yang memang kita buat.
import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import express from 'express'
import jwt from 'jsonwebtoken'

const DB_PATH = path.join(
  os.tmpdir(),
  `arkxmotion-nxb-expiredread-${process.pid}-${Date.now()}.db`,
)
process.env.ARKXMOTION_DB_PATH = DB_PATH
const JWT_SECRET = 'test-secret-expiredread'
process.env.JWT_SECRET = JWT_SECRET
delete process.env.NEXABOT_MASTER_API_KEY
delete process.env.NEXABOT_MASTER_KEY_MODE

// Import server dimuat DINAMIS: ESM meng-hoist `import` statis di atas
// penugasan env, sehingga db.js akan memakai data/arkxmotion.db (DB dev asli)
// alih-alih file temp di bawah.
const { default: nexabotRoutes } = await import('../server/routes/nexabot.js')
const { default: db } = await import('../server/db.js')

const ADMIN_ID = 9101
const KUNCI_UTAMA = 'kunci-utama-server-abc'

const originalFetch = globalThis.fetch
let panggilan: Array<{ url: string; headers: Record<string, string> }> = []
let antrean: Array<() => Response> = []

const app = express()
app.use(express.json())
app.use('/api/public/nexabot', nexabotRoutes)
let server: ReturnType<typeof app.listen>
let base = ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function aturAkun(kunci: string) {
  db.prepare("DELETE FROM app_settings WHERE key IN ('nexabot_master_api_key', 'nexabot_master_cookie', 'nexabot_master_accounts')").run()
  db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run('nexabot_master_api_key', kunci)
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  const res = await originalFetch(`${base}/api/public/nexabot/seedance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

async function get(pathUrl: string, headers: Record<string, string> = {}) {
  const res = await originalFetch(`${base}${pathUrl}`, { headers })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

const token = (opts: { expiresIn: string }) => `Bearer ${jwt.sign({ id: ADMIN_ID }, JWT_SECRET, opts)}`

before(async () => {
  db.prepare('DELETE FROM users WHERE id = ? OR email = ?').run(ADMIN_ID, 'admin@test.local')
  db.prepare(
    "INSERT INTO users (id, email, password, name, role, approved) VALUES (?, 'admin@test.local', 'x', 'Admin Uji', 'admin', 1)",
  ).run(ADMIN_ID)
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

beforeEach(() => {
  panggilan = []
  antrean = []
  globalThis.fetch = (async (input: any, init?: any) => {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(init?.headers || {})) headers[k.toLowerCase()] = String(v)
    panggilan.push({ url: String(input), headers })
    const next = antrean.shift()
    if (!next) throw new Error(`fetch dipanggil ke-${panggilan.length} tanpa langkah berikutnya`)
    return next()
  }) as typeof fetch
})

after(async () => {
  globalThis.fetch = originalFetch
  if (server) await new Promise((resolve) => server.close(resolve))
  try {
    fs.rmSync(DB_PATH, { force: true })
  } catch {
    // DB sementara bisa saja sudah dihapus proses lain; bukan kegagalan test.
  }
})

test('poll job yang kita buat sendiri tetap jalan walau token app kedaluwarsa', async () => {
  aturAkun(KUNCI_UTAMA)
  antrean.push(() => jsonResponse({ ok: true, job_id: 'sd-9', status: 'queued' }, 202))

  const submit = await post({ prompt: 'x', duration: 15 }, { Authorization: token({ expiresIn: '15m' }) })
  assert.equal(submit.status, 202)

  // 9 menit kemudian (token 15m sudah mati, tab sempat dibekukan browser).
  panggilan = []
  antrean.push(() => jsonResponse({ ok: true, job: { id: 'sd-9', status: 'processing' } }))
  const poll = await get('/api/public/nexabot/seedance/sd-9', { Authorization: token({ expiresIn: '-1s' }) })

  assert.equal(poll.status, 200, 'hasil yang sudah dibayar tidak boleh hilang karena sesi app')
  assert.equal(panggilan[0].headers['x-api-key'], KUNCI_UTAMA, 'dibaca lewat akun pembuat jobnya')
})

test('download job yang diingat juga lolos dari token kedaluwarsa', async () => {
  aturAkun(KUNCI_UTAMA)
  antrean.push(() => jsonResponse({ ok: true, job_id: 'sd-8', status: 'queued' }, 202))
  await post({ prompt: 'x', duration: 15 }, { Authorization: token({ expiresIn: '15m' }) })

  panggilan = []
  antrean.push(() => new Response(Buffer.from('video'), { status: 200, headers: { 'Content-Type': 'video/mp4' } }))
  const dl = await originalFetch(`${base}/api/public/nexabot/seedance/sd-8/download`, {
    headers: { Authorization: token({ expiresIn: '-1s' }) },
  })

  assert.equal(dl.status, 200)
  assert.equal(panggilan[0].headers['x-api-key'], KUNCI_UTAMA)
})

test('job yang tidak dikenal relay tetap butuh identitas — kelonggarannya terbatas', async () => {
  aturAkun(KUNCI_UTAMA)

  const res = await get('/api/public/nexabot/seedance/bukan-job-kita', { Authorization: token({ expiresIn: '-1s' }) })

  assert.equal(res.status, 400)
  assert.match(String(res.body?.error), /member yang login/)
  assert.equal(panggilan.length, 0, 'tidak ada request ke upstream untuk job asing')
})
