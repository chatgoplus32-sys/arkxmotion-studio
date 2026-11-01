// ─── Seedance & /api/v1/api/credit hanya menerima API key ───────────────────
//
// NexaBot menjawab 401 "API key tidak valid" untuk endpoint itu bila yang dikirim
// sesi cookie web. Akun server operator umumnya punya cookie (Unlimited) DAN
// kunci, jadi memilih kredensial dengan urutan "cookie dulu" berarti setiap
// submit/poll Seedance membayar satu 401 + satu percobaan ulang.
//
// Yang dikunci di sini:
//  1. Jalur khusus kunci mengirim `x-api-key`, bukan `cookie`;
//  2. kunci akun yang ditolak → dicoba kunci akun pool lain;
//  3. job yang lahir dari kunci cadangan diingat sebagai milik akun cadangan,
//     sehingga poll berikutnya langsung memakai kunci itu (satu request, bukan dua).
import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import express from 'express'
import jwt from 'jsonwebtoken'
import { resetNexabotLaneJobs } from '../shared/nexabotProxy.js'

const DB_PATH = path.join(
  os.tmpdir(),
  `arkxmotion-nxb-seedance-keyonly-${process.pid}-${Date.now()}.db`,
)
process.env.ARKXMOTION_DB_PATH = DB_PATH
const JWT_SECRET = 'test-secret-seedance-keyonly'
process.env.JWT_SECRET = JWT_SECRET
delete process.env.NEXABOT_MASTER_API_KEY
delete process.env.NEXABOT_MASTER_KEY_MODE

// Import server dimuat DINAMIS: ESM meng-hoist `import` statis di atas
// penugasan env, sehingga db.js akan memakai data/arkxmotion.db (DB dev asli)
// alih-alih file temp di bawah.
const { default: nexabotRoutes } = await import('../server/routes/nexabot.js')
const { default: db } = await import('../server/db.js')

const ADMIN_ID = 9001
const KUNCI_UTAMA = 'kunci-utama-server-abc'
const COOKIE_UTAMA = 'session=sesi-unlimited-server; cf_clearance=xyz'
const KUNCI_AKUN2 = 'kunci-akun-kedua-def'

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

function aturAkun(utama: { key: string | null; cookie: string | null }, tambahan: Array<{ id: string; key: string }>) {
  db.prepare("DELETE FROM app_settings WHERE key IN ('nexabot_master_api_key', 'nexabot_master_cookie', 'nexabot_master_accounts')").run()
  const simpan = db.prepare(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
  )
  if (utama.key) simpan.run('nexabot_master_api_key', utama.key)
  if (utama.cookie) simpan.run('nexabot_master_cookie', utama.cookie)
  if (tambahan.length > 0) {
    simpan.run('nexabot_master_accounts', JSON.stringify(
      tambahan.map((a) => ({ id: a.id, label: a.id, api_key: a.key })),
    ))
  }
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  resetNexabotLaneJobs()
  const res = await originalFetch(`${base}/api/public/nexabot/seedance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

async function get(path_url: string, headers: Record<string, string> = {}) {
  const res = await originalFetch(`${base}${path_url}`, { headers })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

function tokenAdmin() {
  return `Bearer ${jwt.sign({ id: ADMIN_ID }, JWT_SECRET)}`
}

before(async () => {
  db.prepare('DELETE FROM users WHERE id = ?').run(ADMIN_ID)
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

test('/seedance mengirim API key akun, bukan cookie sesi server', async () => {
  aturAkun({ key: KUNCI_UTAMA, cookie: COOKIE_UTAMA }, [])
  antrean.push(() => jsonResponse({ ok: true, job_id: 'sd-1', status: 'queued' }, 202))

  const res = await post({ prompt: 'x', duration: 15 }, { Authorization: tokenAdmin() })

  assert.equal(res.status, 202)
  assert.equal(panggilan.length, 1, 'satu request: tidak ada 401 lalu percobaan ulang')
  assert.equal(panggilan[0].headers['x-api-key'], KUNCI_UTAMA)
  assert.equal(panggilan[0].headers.cookie, undefined, 'endpoint ini menolak sesi cookie')
})

test('/seedance: kunci akun ditolak → kunci akun pool lain, dan poll lanjut di akun itu', async () => {
  aturAkun({ key: 'kunci-sudah-dicabut', cookie: null }, [{ id: 'acc_2', key: KUNCI_AKUN2 }])
  antrean.push(
    () => jsonResponse({ ok: false, error: 'API key tidak valid' }, 401),
    () => jsonResponse({ ok: true, job_id: 'sd-2', status: 'queued' }, 202),
  )

  const res = await post({ prompt: 'x', duration: 15 }, { Authorization: tokenAdmin() })

  assert.equal(res.status, 202)
  assert.equal(panggilan.length, 2)
  assert.equal(panggilan[0].headers['x-api-key'], 'kunci-sudah-dicabut')
  assert.equal(panggilan[1].headers['x-api-key'], KUNCI_AKUN2)

  // Job lahir di akun cadangan → poll harus langsung memakai kuncinya.
  panggilan = []
  antrean.push(() => jsonResponse({ ok: true, job: { id: 'sd-2', status: 'processing' } }))
  const poll = await get('/api/public/nexabot/seedance/sd-2', { Authorization: tokenAdmin() })

  assert.equal(poll.status, 200)
  assert.equal(panggilan.length, 1, 'tanpa 401 berulang di setiap poll')
  assert.equal(panggilan[0].headers['x-api-key'], KUNCI_AKUN2)
})

test('/seedance/:id dengan cookie sesi server tetap memakai API key', async () => {
  aturAkun({ key: KUNCI_UTAMA, cookie: COOKIE_UTAMA }, [])
  antrean.push(() => jsonResponse({ ok: true, job: { id: 'sd-3', status: 'processing' } }))

  const res = await get('/api/public/nexabot/seedance/sd-3', {
    Authorization: tokenAdmin(),
    'X-Nexabot-Cookie': COOKIE_UTAMA,
  })

  assert.equal(res.status, 200)
  assert.equal(panggilan.length, 1)
  assert.equal(panggilan[0].headers['x-api-key'], KUNCI_UTAMA)
  assert.equal(panggilan[0].headers.cookie, undefined)
})
