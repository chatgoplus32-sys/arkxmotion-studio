// ── Test alur top-up manual provider tanpa dompet ──────────────────────────
// Roboneo/Weavy/Framia tidak punya saldo server, jadi permintaan member harus
// tercatat, dibatasi, dan hanya admin yang boleh memprosesnya. Test menembak
// HTTP sungguhan dengan router asli supaya middleware auth + validasi ikut
// teruji, bukan cuma query DB.
import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import express from 'express'
import jwt from 'jsonwebtoken'
import { MANUAL_TOPUP_MAX, MANUAL_TOPUP_MIN } from '../shared/pricing.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'data', 'test-provider-topup.db')

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
process.env.ARKXMOTION_DB_PATH = DB_PATH
const JWT_SECRET = 'test-secret-provider-topup'
process.env.JWT_SECRET = JWT_SECRET

const db = (await import('../server/db.js')).default as any
const modul = await import('../server/routes/providerTopup.js')
const routes = modul.default
const MAX_PENDING = modul.MAX_PENDING_MANUAL_TOPUPS

const USER_ID = 1
const ADMIN_ID = 2
const userToken = jwt.sign({ id: USER_ID, email: 'user@test.local', role: 'user' }, JWT_SECRET)
const adminToken = jwt.sign({ id: ADMIN_ID, email: 'admin@test.local', role: 'admin' }, JWT_SECRET)

const app = express()
app.use(express.json())
app.use('/api/provider-topup', routes)

let server: ReturnType<typeof app.listen>
let base = ''

before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  db.prepare("INSERT INTO users (id, email, password, name, role, approved) VALUES (?, 'user@test.local', 'x', 'User Uji', 'user', 1)").run(USER_ID)
  db.prepare("INSERT INTO users (id, email, password, name, role, approved) VALUES (?, 'admin@test.local', 'x', 'Admin Uji', 'admin', 1)").run(ADMIN_ID)
})

beforeEach(() => {
  db.prepare('DELETE FROM provider_topup_request').run()
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  try { db.close() } catch { /* sudah tertutup */ }
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
})

async function api(method: string, pathName: string, opts: { body?: unknown; token?: string } = {}) {
  const res = await fetch(`${base}${pathName}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  return { status: res.status, body: await res.json() }
}

test('permintaan valid tercatat pending dan muncul di riwayat member', async () => {
  const dibuat = await api('POST', '/api/provider-topup/request', {
    token: userToken,
    body: { provider: 'roboneo', amount: 50000, note: 'transfer DANA 14.20' },
  })
  assert.equal(dibuat.status, 201, JSON.stringify(dibuat.body))
  assert.equal(dibuat.body.request.status, 'pending')
  assert.equal(dibuat.body.request.provider, 'roboneo')
  assert.equal(dibuat.body.request.amount, 50000)

  const mine = await api('GET', '/api/provider-topup/mine', { token: userToken })
  assert.equal(mine.status, 200)
  assert.equal(mine.body.requests.length, 1)
  assert.equal(mine.body.requests[0].note, 'transfer DANA 14.20')
})

test('provider dan nominal di luar batas ditolak', async () => {
  const providerSalah = await api('POST', '/api/provider-topup/request', {
    token: userToken,
    body: { provider: '../etc/passwd', amount: 50000 },
  })
  assert.equal(providerSalah.status, 400)

  const terlaluKecil = await api('POST', '/api/provider-topup/request', {
    token: userToken,
    body: { provider: 'weavy', amount: MANUAL_TOPUP_MIN - 1 },
  })
  assert.equal(terlaluKecil.status, 400)

  const terlaluBesar = await api('POST', '/api/provider-topup/request', {
    token: userToken,
    body: { provider: 'weavy', amount: MANUAL_TOPUP_MAX + 1 },
  })
  assert.equal(terlaluBesar.status, 400)

  const tanpaLogin = await api('POST', '/api/provider-topup/request', {
    body: { provider: 'weavy', amount: 50000 },
  })
  assert.equal(tanpaLogin.status, 401)
})

test('permintaan pending dibatasi per member', async () => {
  for (let i = 0; i < MAX_PENDING; i++) {
    const res = await api('POST', '/api/provider-topup/request', {
      token: userToken,
      body: { provider: 'framia', amount: 25000 },
    })
    assert.equal(res.status, 201, JSON.stringify(res.body))
  }

  const kelebihan = await api('POST', '/api/provider-topup/request', {
    token: userToken,
    body: { provider: 'framia', amount: 25000 },
  })
  assert.equal(kelebihan.status, 429)
})

test('admin melihat permintaan lalu approve; approve kedua kali ditolak', async () => {
  const dibuat = await api('POST', '/api/provider-topup/request', {
    token: userToken,
    body: { provider: 'roboneo', amount: 100000, note: 'bukti' },
  })
  const id = dibuat.body.request.id

  const pending = await api('GET', '/api/provider-topup/admin/pending', { token: adminToken })
  assert.equal(pending.status, 200)
  assert.equal(pending.body.requests.length, 1)
  assert.equal(pending.body.requests[0].email, 'user@test.local')
  assert.equal(pending.body.requests[0].note, 'bukti')

  const approve = await api('PATCH', `/api/provider-topup/admin/${id}`, {
    token: adminToken,
    body: { status: 'approved', admin_note: 'sudah dicek' },
  })
  assert.equal(approve.status, 200, JSON.stringify(approve.body))
  assert.equal(approve.body.request.status, 'approved')
  assert.equal(approve.body.request.admin_note, 'sudah dicek')

  const approveLagi = await api('PATCH', `/api/provider-topup/admin/${id}`, {
    token: adminToken,
    body: { status: 'rejected' },
  })
  assert.equal(approveLagi.status, 409)

  const mine = await api('GET', '/api/provider-topup/mine', { token: userToken })
  assert.equal(mine.body.requests[0].status, 'approved')
})

test('member biasa tidak bisa memakai endpoint admin', async () => {
  const list = await api('GET', '/api/provider-topup/admin/pending', { token: userToken })
  assert.equal(list.status, 403)

  const patch = await api('PATCH', '/api/provider-topup/admin/1', {
    token: userToken,
    body: { status: 'approved' },
  })
  assert.equal(patch.status, 403)
})
