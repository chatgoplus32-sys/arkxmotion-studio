// ── Test endpoint wallet Alriz (Express + SQLite) ───────────────────────────
// Alur yang paling mahal kalau salah: validasi nominal top up (Rp 5.000–
// 100.000, dikunci server), approve admin yang kredit 1:1, pemotongan saldo
// per generate memakai tarif shared/pricing.ts (bukan angka klien), dan refund
// saat job gagal. Test menembak HTTP sungguhan — router asli dipasang di port
// acak — supaya middleware auth, validasi body, dan bentuk respons ikut teruji.
//
// Versi Vercel (api/alriz-wallet.ts) adalah cermin dari router ini dan butuh
// Neon, jadi yang diuji di sini jalur Express.
import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import express from 'express'
import jwt from 'jsonwebtoken'
import {
  ALRIZ_MIN_TOPUP,
  ALRIZ_MAX_TOPUP,
  ALRIZ_NOMINALS,
  ALRIZ_MODEL_PRICES,
  isValidAlrizTopup,
  getAlrizCharge,
  getAlrizPriceRange,
} from '../shared/pricing.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'data', 'test-alriz-wallet.db')

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
process.env.ARKXMOTION_DB_PATH = DB_PATH
const JWT_SECRET = 'test-secret-alriz-wallet'
process.env.JWT_SECRET = JWT_SECRET

const db = (await import('../server/db.js')).default as any
const alrizWalletRoutes = (await import('../server/routes/alrizWallet.js')).default
const adminTopupRoutes = (await import('../server/routes/adminTopup.js')).default

const USER_ID = 1
const ADMIN_ID = 2
const userToken = jwt.sign({ id: USER_ID, email: 'user@test.local', role: 'user' }, JWT_SECRET)
const adminToken = jwt.sign({ id: ADMIN_ID, email: 'admin@test.local', role: 'admin' }, JWT_SECRET)

const app = express()
app.use(express.json())
app.use('/api/alriz', alrizWalletRoutes)
app.use('/api/admin/topup', adminTopupRoutes)

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
  db.prepare('DELETE FROM alriz_topup').run()
  db.prepare('DELETE FROM alriz_usage').run()
  db.prepare('DELETE FROM alriz_balance').run()
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
  let body: any = null
  try { body = await res.json() } catch { /* body kosong */ }
  return { status: res.status, body }
}

// ── Konstanta harga (shared/pricing.ts) ────────────────────────────────────

test('konstanta Alriz: min 5rb, max 100rb, nominal & harga model masuk akal', () => {
  assert.equal(ALRIZ_MIN_TOPUP, 5000)
  assert.equal(ALRIZ_MAX_TOPUP, 100000)
  assert.deepEqual(ALRIZ_NOMINALS, [5000, 10000, 15000, 20000, 25000, 50000, 100000])
  assert.ok(ALRIZ_NOMINALS.every((n) => n >= ALRIZ_MIN_TOPUP && n <= ALRIZ_MAX_TOPUP))
  assert.deepEqual(
    Object.entries(ALRIZ_MODEL_PRICES).sort(),
    [
      ['mc-kling-2.6-pro', 1500],
      ['mc-kling-2.6-std', 750],
      ['mc-kling-3.0-pro', 1750],
      ['mc-kling-3.0-std', 1000],
    ].sort(),
  )
  const range = getAlrizPriceRange()
  assert.deepEqual(range, { min: 750, max: 1750 })
})

test('isValidAlrizTopup: batas min/max & bilangan bulat', () => {
  assert.equal(isValidAlrizTopup(5000), true)
  assert.equal(isValidAlrizTopup(100000), true)
  assert.equal(isValidAlrizTopup(7500), true)
  assert.equal(isValidAlrizTopup(4999), false)
  assert.equal(isValidAlrizTopup(100001), false)
  assert.equal(isValidAlrizTopup(5000.5), false)
  assert.equal(isValidAlrizTopup('5000'), false) // string tidak lolos
  assert.equal(isValidAlrizTopup(null), false)
})

test('getAlrizCharge: tarif per model, prefix al: dilepas, default termurah', () => {
  assert.equal(getAlrizCharge('mc-kling-3.0-pro'), 1750)
  assert.equal(getAlrizCharge('al:mc-kling-2.6-std'), 750)
  assert.equal(getAlrizCharge('model_ngawur'), 750)
  assert.equal(getAlrizCharge(), 750)
})

// ── Balance & top up ────────────────────────────────────────────────────────

test('/balance: awal 0 + batas topup + nominal + harga model', async () => {
  const res = await api('GET', '/api/alriz/balance', { token: userToken })
  assert.equal(res.status, 200)
  assert.equal(res.body.balance, 0)
  assert.equal(res.body.min_topup, 5000)
  assert.equal(res.body.max_topup, 100000)
  assert.deepEqual(res.body.nominals, ALRIZ_NOMINALS)
  assert.equal(res.body.models['mc-kling-2.6-std'], 750)
})

test('/balance tanpa login → 401', async () => {
  const res = await api('GET', '/api/alriz/balance')
  assert.equal(res.status, 401)
})

test('/topup: nominal valid tersimpan pending', async () => {
  const res = await api('POST', '/api/alriz/topup', { token: userToken, body: { amount: 50000, proof_note: 'an. Uji' } })
  assert.equal(res.status, 201)
  assert.equal(res.body.topup.amount, 50000)
  assert.equal(res.body.topup.status, 'pending')
  // Belum dikredit sebelum approve
  const bal = await api('GET', '/api/alriz/balance', { token: userToken })
  assert.equal(bal.body.balance, 0)
})

test('/topup: tolak di bawah min, di atas max, dan non-bulat', async () => {
  const bawah = await api('POST', '/api/alriz/topup', { token: userToken, body: { amount: 4999 } })
  assert.equal(bawah.status, 400)
  assert.match(bawah.body.error, /5\.000/)
  assert.match(bawah.body.error, /100\.000/)

  const atas = await api('POST', '/api/alriz/topup', { token: userToken, body: { amount: 100001 } })
  assert.equal(atas.status, 400)

  const pecahan = await api('POST', '/api/alriz/topup', { token: userToken, body: { amount: 5000.5 } })
  assert.equal(pecahan.status, 400)

  const kosong = await api('POST', '/api/alriz/topup', { token: userToken, body: {} })
  assert.equal(kosong.status, 400)

  const pending = db.prepare('SELECT COUNT(*) AS n FROM alriz_topup').get() as { n: number }
  assert.equal(pending.n, 0, 'tidak ada baris pending yang tersimpan dari request invalid')
})

// ── Approve / reject admin ──────────────────────────────────────────────────

test('approve admin: kredit 1:1 ke alriz_balance', async () => {
  await api('POST', '/api/alriz/topup', { token: userToken, body: { amount: 25000 } })
  const pending = await api('GET', '/api/admin/topup/pending?provider=alriz', { token: adminToken })
  assert.equal(pending.status, 200)
  assert.equal(pending.body.topups.length, 1)
  const id = pending.body.topups[0].id

  const approve = await api('PATCH', '/api/admin/topup/approve', {
    token: adminToken,
    body: { id, admin_note: 'OK', provider: 'alriz' },
  })
  assert.equal(approve.status, 200)
  assert.equal(approve.body.balance, 25000)

  const bal = await api('GET', '/api/alriz/balance', { token: userToken })
  assert.equal(bal.body.balance, 25000)
})

test('approve admin: dua topup menumpuk', async () => {
  await api('POST', '/api/alriz/topup', { token: userToken, body: { amount: 10000 } })
  await api('POST', '/api/alriz/topup', { token: userToken, body: { amount: 5000 } })
  const pending = await api('GET', '/api/admin/topup/pending?provider=alriz', { token: adminToken })
  for (const t of pending.body.topups) {
    await api('PATCH', '/api/admin/topup/approve', { token: adminToken, body: { id: t.id, provider: 'alriz' } })
  }
  const bal = await api('GET', '/api/alriz/balance', { token: userToken })
  assert.equal(bal.body.balance, 15000)
})

test('approve bukan admin → ditolak', async () => {
  await api('POST', '/api/alriz/topup', { token: userToken, body: { amount: 5000 } })
  const pending = await api('GET', '/api/admin/topup/pending?provider=alriz', { token: adminToken })
  const res = await api('PATCH', '/api/admin/topup/approve', {
    token: userToken,
    body: { id: pending.body.topups[0].id, provider: 'alriz' },
  })
  assert.equal(res.status, 403)
})

test('reject admin: tidak mengkredit saldo', async () => {
  await api('POST', '/api/alriz/topup', { token: userToken, body: { amount: 100000 } })
  const pending = await api('GET', '/api/admin/topup/pending?provider=alriz', { token: adminToken })
  const rej = await api('PATCH', '/api/admin/topup/reject', {
    token: adminToken,
    body: { id: pending.body.topups[0].id, admin_note: 'Bukti tidak jelas', provider: 'alriz' },
  })
  assert.equal(rej.status, 200)
  const bal = await api('GET', '/api/alriz/balance', { token: userToken })
  assert.equal(bal.body.balance, 0)
})

// ── Deduct & refund ─────────────────────────────────────────────────────────

async function seedBalance(amount: number) {
  await api('POST', '/api/alriz/topup', { token: userToken, body: { amount: Math.min(amount, ALRIZ_MAX_TOPUP) } })
  const pending = await api('GET', '/api/admin/topup/pending?provider=alriz', { token: adminToken })
  await api('PATCH', '/api/admin/topup/approve', { token: adminToken, body: { id: pending.body.topups[0].id, provider: 'alriz' } })
}

test('/deduct: tarif dari shared/pricing (prefix al: dipotong benar) × quantity', async () => {
  await seedBalance(10000)
  const res = await api('POST', '/api/alriz/deduct', {
    token: userToken,
    body: { model: 'al:mc-kling-3.0-pro', quantity: 2, batch_id: 'batch-1' },
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.deducted, 1750 * 2)
  assert.equal(res.body.balance, 10000 - 3500)

  const usage = db.prepare("SELECT * FROM alriz_usage WHERE batch_id = 'batch-1'").get() as any
  assert.equal(usage.cost, 3500)
  assert.equal(usage.status, 'used')
})

test('/deduct: saldo kurang → 400 dengan required', async () => {
  await seedBalance(5000)
  const res = await api('POST', '/api/alriz/deduct', {
    token: userToken,
    body: { model: 'mc-kling-3.0-pro', quantity: 10 },
  })
  assert.equal(res.status, 400)
  assert.equal(res.body.required, 17500)
  assert.equal(res.body.balance, 5000)
  const used = db.prepare('SELECT COUNT(*) AS n FROM alriz_usage').get() as { n: number }
  assert.equal(used.n, 0, 'deduct gagal tidak membuat baris usage')
})

test('/refund: mengembalikan saldo tepat & hanya sekali', async () => {
  await seedBalance(10000)
  await api('POST', '/api/alriz/deduct', { token: userToken, body: { model: 'mc-kling-2.6-std', batch_id: 'b-rf' } })
  const afterDeduct = await api('GET', '/api/alriz/balance', { token: userToken })
  assert.equal(afterDeduct.body.balance, 10000 - 750)

  const refund = await api('POST', '/api/alriz/refund', { token: userToken, body: { batch_id: 'b-rf' } })
  assert.equal(refund.status, 200)
  assert.equal(refund.body.refunded, 750)
  assert.equal(refund.body.balance, 10000)

  const kedua = await api('POST', '/api/alriz/refund', { token: userToken, body: { batch_id: 'b-rf' } })
  assert.equal(kedua.status, 404, 'refund kedua kali ditolak (usage sudah refunded)')
  const bal = await api('GET', '/api/alriz/balance', { token: userToken })
  assert.equal(bal.body.balance, 10000)
})

test('wallet terpisah antar user', async () => {
  const OTHER_ID = 3
  db.prepare("INSERT OR IGNORE INTO users (id, email, password, name, role, approved) VALUES (?, 'other@test.local', 'x', 'Lain', 'user', 1)").run(OTHER_ID)
  const otherToken = jwt.sign({ id: OTHER_ID, email: 'other@test.local', role: 'user' }, JWT_SECRET)

  await seedBalance(50000)
  const other = await api('GET', '/api/alriz/balance', { token: otherToken })
  assert.equal(other.body.balance, 0)

  const bobol = await api('POST', '/api/alriz/deduct', { token: otherToken, body: { model: 'mc-kling-2.6-std' } })
  assert.equal(bobol.status, 400, 'user lain tidak bisa memakai saldo user pertama')
})
