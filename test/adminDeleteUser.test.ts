import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import express from 'express'
import jwt from 'jsonwebtoken'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'data', 'test-admin-delete-user.db')

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
process.env.ARKXMOTION_DB_PATH = DB_PATH
const JWT_SECRET = 'test-secret-admin-delete-user'
process.env.JWT_SECRET = JWT_SECRET

const db = (await import('../server/db.js')).default as any
const adminRoutes = (await import('../server/routes/admin.js')).default

const USER_ID = 1
const ADMIN_ID = 2
const USER2_ID = 3
const adminToken = jwt.sign({ id: ADMIN_ID, email: 'admin@test.local', role: 'admin' }, JWT_SECRET)

const app = express()
app.use(express.json())
app.use('/api/admin', adminRoutes)

let server: ReturnType<typeof app.listen>
let base = ''

/** Setiap tabel yang terikat ke users(id) — bukti bahwa delete tidak lagi FK-error. */
const FK_TABLES = [
  'token_orders',
  'provider_topup_request',
  'createpulse_balance',
  'createpulse_topup',
  'createpulse_usage',
  'nexabot_balance',
  'nexabot_topup',
  'nexabot_usage',
  'seavi_balance',
  'seavi_topup',
  'seavi_usage',
  'posbot_balance',
  'posbot_topup',
  'posbot_usage',
  'generation_logs',
  'membership_payments',
  'pro_payments',
  'notifications',
] as const

const EXTRA_TABLES = [
  'sync_token_queue',
  'runninghub_claim_token',
  'nexabot_charge_ticket',
  'provider_charge_ticket',
] as const

function seedMember(userId: number, email: string) {
  db.prepare("INSERT INTO users (id, email, password, name, role, approved) VALUES (?, ?, 'x', 'Member Uji', 'user', 1)")
    .run(userId, email)

  const tokenBank = db.prepare("INSERT INTO tokens (provider, name, token_value) VALUES ('nexabot', 'bank-uji', 'bank-secret')").run()
  const tokenId = Number(tokenBank.lastInsertRowid)

  db.prepare('INSERT INTO token_orders (user_id, token_id) VALUES (?, ?)').run(userId, tokenId)
  db.prepare("INSERT INTO provider_topup_request (user_id, provider, amount) VALUES (?, 'weavy', 50000)").run(userId)
  db.prepare('INSERT INTO createpulse_balance (user_id) VALUES (?)').run(userId)
  db.prepare('INSERT INTO createpulse_topup (user_id, amount) VALUES (?, 50000)').run(userId)
  db.prepare("INSERT INTO createpulse_usage (user_id, model, cost) VALUES (?, 'createpulse-uji', 10)").run(userId)
  db.prepare('INSERT INTO nexabot_balance (user_id) VALUES (?)').run(userId)
  db.prepare("INSERT INTO nexabot_topup (user_id, amount, kind) VALUES (?, 50000, 'balance')").run(userId)
  db.prepare("INSERT INTO nexabot_usage (user_id, model, cost) VALUES (?, 'gpt-image', 1)").run(userId)
  db.prepare('INSERT INTO seavi_balance (user_id) VALUES (?)').run(userId)
  db.prepare('INSERT INTO seavi_topup (user_id, amount) VALUES (?, 50000)').run(userId)
  db.prepare("INSERT INTO seavi_usage (user_id, model, cost) VALUES (?, 'seavi-uji', 1)").run(userId)
  db.prepare('INSERT INTO posbot_balance (user_id) VALUES (?)').run(userId)
  db.prepare('INSERT INTO posbot_topup (user_id, amount) VALUES (?, 50000)').run(userId)
  db.prepare("INSERT INTO posbot_usage (user_id, model, cost) VALUES (?, 'posbot-uji', 1)").run(userId)
  db.prepare("INSERT INTO generation_logs (user_id, page, provider, model) VALUES (?, 'edit-image', 'nexabot', 'gpt-image')").run(userId)
  db.prepare('INSERT INTO membership_payments (user_id, amount) VALUES (?, 250000)').run(userId)
  db.prepare('INSERT INTO pro_payments (user_id, amount) VALUES (?, 250000)').run(userId)
  db.prepare("INSERT INTO notifications (title, message, target, user_id) VALUES ('t', 'm', 'users', ?)").run(userId)

  db.prepare("INSERT INTO sync_token_queue (user_id, provider, token, created_at) VALUES (?, 'nexabot', 'q-token', 1)").run(userId)
  db.prepare("INSERT INTO runninghub_claim_token (user_id, token, created_at, updated_at) VALUES (?, 'rh-token', 1, 1)").run(userId)
  db.prepare("INSERT INTO nexabot_charge_ticket (usage_id, user_id, route, state, created_at, updated_at) VALUES (?, ?, 'submit', 'reserved', 1, 1)").run(userId * 1000 + 1, userId)
  db.prepare("INSERT INTO provider_charge_ticket (provider, usage_id, user_id, created_at, updated_at) VALUES ('seavi', ?, ?, 1, 1)").run(userId * 1000 + 1, userId)
}

async function api(method: string, path: string, opts: { token?: string } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  db.prepare("INSERT INTO users (id, email, password, name, role, approved) VALUES (?, 'admin@test.local', 'x', 'Admin Uji', 'admin', 1)").run(ADMIN_ID)
  seedMember(USER_ID, 'user@test.local')
  seedMember(USER2_ID, 'user2@test.local')

  // Audit yang SENGAJA tidak ikut dihapus.
  db.prepare("INSERT INTO nexabot_upstream_usage (user_id, route, credential_kind, credential_fingerprint, status_code, created_at) VALUES (?, 'submit', 'api-key', 'fp-uji', 200, 1)").run(USER_ID)
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  try { db.close() } catch { /* sudah tertutup */ }
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
})

test('DELETE user dengan seluruh dependen terisi → 200, semua anak ikut bersih', async () => {
  const res = await api('DELETE', `/api/admin/users/${USER_ID}`, { token: adminToken })
  assert.equal(res.status, 200, JSON.stringify(res.data))

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(USER_ID)
  assert.equal(user, undefined, 'user harus terhapus')

  for (const tabel of [...FK_TABLES, ...EXTRA_TABLES]) {
    const baris = db.prepare(`SELECT COUNT(*) AS n FROM ${tabel} WHERE user_id = ?`).get(USER_ID) as { n: number }
    assert.equal(baris.n, 0, `${tabel} masih menyimpan baris untuk user yang dihapus`)
  }
})

test('DELETE tidak menghapus jejak audit upstream usage milik member', async () => {
  const baris = db.prepare('SELECT COUNT(*) AS n FROM nexabot_upstream_usage WHERE user_id = ?').get(USER_ID) as { n: number }
  assert.equal(baris.n, 1, 'baris audit harus dipertahankan')
})

test('DELETE tidak menyentuh stok token milik operator (token_orders member saja yang dibersihkan)', async () => {
  const stok = db.prepare("SELECT COUNT(*) AS n FROM tokens WHERE name = 'bank-uji'").get() as { n: number }
  assert.equal(stok.n >= 1, true, 'stok token operator harus tetap ada')
})

test('POST /users/:id/reject juga menghapus member beserta dependen', async () => {
  const res = await api('POST', `/api/admin/users/${USER2_ID}/reject`, { token: adminToken })
  assert.equal(res.status, 200, JSON.stringify(res.data))
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(USER2_ID)
  assert.equal(user, undefined)
  for (const tabel of FK_TABLES) {
    const baris = db.prepare(`SELECT COUNT(*) AS n FROM ${tabel} WHERE user_id = ?`).get(USER2_ID) as { n: number }
    assert.equal(baris.n, 0, `${tabel} masih menyimpan baris`)
  }
})

test('DELETE ke member yang sudah terhapus → 404', async () => {
  const res = await api('DELETE', `/api/admin/users/${USER_ID}`, { token: adminToken })
  assert.equal(res.status, 404)
})

test('DELETE ke user admin → 400', async () => {
  const res = await api('DELETE', `/api/admin/users/${ADMIN_ID}`, { token: adminToken })
  assert.equal(res.status, 400)
})

test('DELETE tanpa token → 401', async () => {
  const res = await api('DELETE', `/api/admin/users/${ADMIN_ID}`)
  assert.equal(res.status, 401)
})

test('DELETE dengan token non-admin → 403', async () => {
  const extraUser = db.prepare("INSERT INTO users (id, email, password, name, role, approved) VALUES (?, 'plain@test.local', 'x', 'Plain', 'user', 1)").run(90)
  void extraUser
  const plainToken = jwt.sign({ id: 90, email: 'plain@test.local', role: 'user' }, JWT_SECRET)
  const res = await api('DELETE', `/api/admin/users/${ADMIN_ID}`, { token: plainToken })
  assert.equal(res.status, 403)
})
