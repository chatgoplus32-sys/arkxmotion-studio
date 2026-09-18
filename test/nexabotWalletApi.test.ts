// ─── Test endpoint wallet NexaBot yang butuh login (Express + SQLite) ───────
// Alur yang paling mahal kalau salah: pengajuan paket (harga & durasi dikunci
// server, bukan dari klien), pemotongan saldo saat paket Unlimited aktif, dan
// refund saat generate gagal. Test ini menembak HTTP sungguhan — router asli
// dipasang di port acak — supaya middleware auth, validasi body, dan bentuk
// respons ikut teruji, bukan cuma fungsinya.
//
// Versi Vercel (api/nexabot-wallet.ts) adalah cermin dari router ini dan butuh
// Neon, jadi yang diuji di sini jalur Express; logika harga bersama sudah
// dikunci di test/pricing.test.ts.
import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import express from 'express'
import jwt from 'jsonwebtoken'
import { NEXABOT_PACKAGES, parseNexabotPricing } from '../shared/pricing.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'data', 'test-nexabot-wallet.db')

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
process.env.ARKXMOTION_DB_PATH = DB_PATH
const JWT_SECRET = 'test-secret-nexabot-wallet'
process.env.JWT_SECRET = JWT_SECRET

const db = (await import('../server/db.js')).default as any
const nexabotWalletRoutes = (await import('../server/routes/nexabotWallet.js')).default
const adminTopupRoutes = (await import('../server/routes/adminTopup.js')).default
const { setNexabotPricing } = await import('../server/routes/nexabotWallet.js')

const USER_ID = 1
const ADMIN_ID = 2
const userToken = jwt.sign({ id: USER_ID, email: 'user@test.local', role: 'user' }, JWT_SECRET)
const adminToken = jwt.sign({ id: ADMIN_ID, email: 'admin@test.local', role: 'admin' }, JWT_SECRET)

const app = express()
app.use(express.json())
app.use('/api/nexabot', nexabotWalletRoutes)
app.use('/api/admin/topup', adminTopupRoutes)

let server: ReturnType<typeof app.listen>
let base = ''

before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  db.prepare("INSERT INTO users (id, email, password, name, role, approved) VALUES (?, ?, 'x', 'User Uji', 'user', 1)").run(USER_ID, 'user@test.local')
  db.prepare("INSERT INTO users (id, email, password, name, role, approved) VALUES (?, ?, 'x', 'Admin Uji', 'admin', 1)").run(ADMIN_ID, 'admin@test.local')
})

beforeEach(() => {
  db.prepare('DELETE FROM nexabot_topup').run()
  db.prepare('DELETE FROM nexabot_usage').run()
  db.prepare('DELETE FROM nexabot_balance').run()
  const defaults = parseNexabotPricing({})
  setNexabotPricing({
    price: defaults.price,
    packages: Object.fromEntries(defaults.packages.map((p) => [p.slug, { price: p.price, days: p.days }])),
  })
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  try { db.close() } catch { /* sudah tertutup */ }
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
})

async function api(method: string, path: string, opts: { body?: unknown; token?: string } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

function setBalance(amount: number) {
  db.prepare(`
    INSERT INTO nexabot_balance (user_id, balance) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET balance = excluded.balance
  `).run(USER_ID, amount)
}

function getBalance(): number {
  return (db.prepare('SELECT balance FROM nexabot_balance WHERE user_id = ?').get(USER_ID) as { balance: number }).balance
}

/** Ajukan paket dan kembalikan baris yang dibuat server (harga/durasi dari server). */
async function submitPackage(slug?: string) {
  const { status, body } = await api('POST', '/api/nexabot/package', {
    token: userToken,
    body: slug ? { slug } : {},
  })
  assert.equal(status, 201, `pengajuan paket ${slug || '(tanpa slug)'} harus 201`)
  return { id: body.package.id as number, ...body.package }
}

/** Paket Unlimited yang sudah di-approve admin (default: masih berjalan 30 hari). */
function giveApprovedPackage({ slug = 'unlimited_monthly', days = 30, expiresInDays = 30 } = {}) {
  const info = db.prepare(`
    INSERT INTO nexabot_topup (user_id, amount, kind, days, package_slug, status, started_at, expires_at)
    VALUES (?, 99000, 'unlimited', ?, ?, 'approved', datetime('now'), datetime('now', ?))
  `).run(USER_ID, days, slug, `+${expiresInDays} days`)
  return Number(info.lastInsertRowid)
}

// ── Auth ───────────────────────────────────────────────────────────────────

// Keduanya 401: token yang tidak sah bukan "sudah login tapi tidak berhak",
// melainkan belum/tidak lagi punya identitas — access token app cuma hidup
// 15 menit (ACCESS_EXPIRES di server/routes/auth.ts) dan app hanya mencoba
// refresh diam-diam kalau jawabannya 401. 403 tetap untuk requireAdmin,
// yang dikunci test/nexabotUpstreamUsage.test.ts.
test('tanpa token → 401, token ngawur → 401', async () => {
  const guarded: [string, string][] = [
    ['GET', '/balance'],
    ['POST', '/package'],
    ['POST', '/deduct'],
    ['POST', '/refund'],
    ['GET', '/topups/mine'],
  ]
  for (const [method, path] of guarded) {
    const anonymous = await api(method, `/api/nexabot${path}`, method === 'GET' ? {} : { body: {} })
    assert.equal(anonymous.status, 401, `${path} tanpa token harus 401`)
    assert.match(anonymous.body.error, /token/i)
  }

  const wrong = await api('GET', '/api/nexabot/balance', { token: jwt.sign({ id: USER_ID }, 'secret-lain') })
  assert.equal(wrong.status, 401)
})

// ── GET /balance ───────────────────────────────────────────────────────────

test('GET /balance: saldo, harga, dan semua varian paket dari server', async () => {
  setBalance(5000)
  setNexabotPricing({ packages: { unlimited_yearly: { price: 750000, days: 365 } } })

  const { status, body } = await api('GET', '/api/nexabot/balance', { token: userToken })

  assert.equal(status, 200)
  assert.equal(body.balance, 5000)
  assert.equal(body.price, 250)
  assert.equal(body.min_topup, 10000)
  assert.equal(body.unlimited.active, false)
  assert.equal(body.package.slug, 'unlimited_weekly')
  const yearly = body.packages.find((p: any) => p.slug === 'unlimited_yearly')
  assert.equal(yearly.price, 750000)
  assert.equal(yearly.days, 365)
})

// ── Pengajuan paket per slug ───────────────────────────────────────────────

test('POST /package: varian dipilih lewat slug, harga & durasi dari server', async () => {
  setNexabotPricing({ packages: { unlimited_monthly: { price: 99000, days: 30 } } })

  const { status, body } = await api('POST', '/api/nexabot/package', {
    token: userToken,
    body: { slug: 'unlimited_monthly', proof_note: 'an. Budi' },
  })

  assert.equal(status, 201)
  assert.equal(body.package.kind, 'unlimited')
  assert.equal(body.package.status, 'pending')
  assert.equal(body.package.package_slug, 'unlimited_monthly')
  assert.equal(body.package.amount, 99000)
  assert.equal(body.package.days, 30)
  assert.equal(body.package.proof_note, 'an. Budi')
  assert.match(body.message, /Bulanan/)
})

test('POST /package: klien lama tanpa slug → varian utama (Mingguan)', async () => {
  const { status, body } = await api('POST', '/api/nexabot/package', { token: userToken, body: {} })

  assert.equal(status, 201)
  assert.equal(body.package.package_slug, NEXABOT_PACKAGES[0].slug)
  assert.equal(body.package.amount, NEXABOT_PACKAGES[0].defaultPrice)
  assert.equal(body.package.days, NEXABOT_PACKAGES[0].days)
})

test('POST /package: slug asing ditolak dengan daftar pilihan', async () => {
  const { status, body } = await api('POST', '/api/nexabot/package', {
    token: userToken,
    body: { slug: 'unlimited_harian' },
  })

  assert.equal(status, 400)
  assert.match(body.error, /Paket tidak dikenal/)
  for (const plan of NEXABOT_PACKAGES) assert.ok(body.error.includes(plan.slug))
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM nexabot_topup').get().n, 0, 'tidak boleh ada baris tersimpan')
})

test('satu pengajuan paket yang masih pending memblokir pengajuan berikutnya', async () => {
  const first = await api('POST', '/api/nexabot/package', { token: userToken, body: { slug: 'unlimited_weekly' } })
  const second = await api('POST', '/api/nexabot/package', { token: userToken, body: { slug: 'unlimited_yearly' } })

  assert.equal(first.status, 201)
  assert.equal(second.status, 400)
  assert.match(second.body.error, /menunggu approval/)
})

test('tarif dikunci saat pengajuan: ubah harga admin tidak mengubah baris yang sudah masuk', async () => {
  const submitted = await submitPackage('unlimited_monthly')
  const before = db.prepare('SELECT amount, days FROM nexabot_topup WHERE id = ?').get(submitted.id) as { amount: number; days: number }

  setNexabotPricing({ packages: { unlimited_monthly: { price: 555000, days: 30 } } })
  const after = db.prepare('SELECT amount, days FROM nexabot_topup WHERE id = ?').get(submitted.id) as { amount: number; days: number }

  assert.equal(before.amount, 119000)
  assert.deepEqual(after, before)
})

test('admin approve → paket aktif; beli lagi saat aktif → masa berlaku ditumpuk', async () => {
  const first = await submitPackage('unlimited_monthly')
  const firstApprove = await api('PATCH', '/api/admin/topup/approve', {
    token: adminToken,
    body: { provider: 'nexabot', id: first.id },
  })
  assert.equal(firstApprove.status, 200)
  assert.equal(firstApprove.body.unlimited.active, true)
  assert.equal(firstApprove.body.unlimited.days_left, 30)

  // Beli varian lain saat paket masih jalan (masih ada sisa ~30 hari).
  setNexabotPricing({ packages: { unlimited_yearly: { price: 750000, days: 365 } } })
  const second = await submitPackage('unlimited_yearly')
  assert.equal(second.amount, 750000)
  const secondApprove = await api('PATCH', '/api/admin/topup/approve', {
    token: adminToken,
    body: { provider: 'nexabot', id: second.id },
  })

  // Ditumpuk dari expiry terlama (bukan dari sekarang), jadi > 365 hari.
  assert.ok(secondApprove.body.unlimited.days_left > 365, `days_left tidak ditumpuk: ${secondApprove.body.unlimited.days_left}`)
  const { body } = await api('GET', '/api/nexabot/balance', { token: userToken })
  assert.equal(body.unlimited.active, true)
  assert.ok(body.unlimited.days_left > 365)
})

// ── Pemotongan saldo & paket aktif ─────────────────────────────────────────

test('POST /deduct: potong saldo sesuai harga server dan kembalikan usage_id', async () => {
  setBalance(1000)

  const { status, body } = await api('POST', '/api/nexabot/deduct', {
    token: userToken,
    body: { model: 't2v' },
  })

  assert.equal(status, 200)
  assert.equal(body.deducted, 250)
  assert.equal(body.balance, 750)
  assert.equal(body.unlimited, false)
  assert.ok(body.usage_id > 0)
  assert.equal(getBalance(), 750)
})

test('POST /deduct: saldo kurang → 400 (tanpa memotong apa pun)', async () => {
  setBalance(100)

  const { status, body } = await api('POST', '/api/nexabot/deduct', { token: userToken, body: {} })

  assert.equal(status, 400)
  assert.equal(body.required, 250)
  assert.match(body.error, /Saldo NexaBot tidak cukup/)
  assert.match(body.error, /Paket Mingguan/, 'sebut varian termurah sebagai jalan keluar')
  assert.equal(getBalance(), 100)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM nexabot_usage').get().n, 0)
})

test('POST /deduct saat paket Unlimited aktif: gratis, saldo utuh, tetap dicatat cost 0', async () => {
  setBalance(1000)
  giveApprovedPackage()

  const { status, body } = await api('POST', '/api/nexabot/deduct', { token: userToken, body: { model: 'i2v' } })

  assert.equal(status, 200)
  assert.equal(body.deducted, 0)
  assert.equal(body.balance, 1000)
  assert.equal(body.unlimited, true)
  assert.ok(body.expires_at)
  assert.equal(getBalance(), 1000, 'saldo tidak boleh tersentuh')
  const usage = db.prepare('SELECT cost, status FROM nexabot_usage WHERE id = ?').get(body.usage_id) as { cost: number; status: string }
  assert.deepEqual(usage, { cost: 0, status: 'used' })
})

test('POST /deduct saat paket sudah kedaluwarsa: tarif normal berlaku lagi', async () => {
  setBalance(1000)
  giveApprovedPackage({ expiresInDays: -1 })

  const { status, body } = await api('POST', '/api/nexabot/deduct', { token: userToken, body: {} })

  assert.equal(status, 200)
  assert.equal(body.unlimited, false)
  assert.equal(body.deducted, 250)
  assert.equal(body.balance, 750)
})

test('POST /deduct memakai harga per generate terbaru dari admin', async () => {
  setBalance(5000)
  setNexabotPricing({ price: 1000 })

  const { body } = await api('POST', '/api/nexabot/deduct', { token: userToken, body: {} })

  assert.equal(body.deducted, 1000)
  assert.equal(body.balance, 4000)
})

// ── Refund saat generate gagal ─────────────────────────────────────────────

test('POST /refund: saldo kembali dan usage ditandai refunded (sekali saja)', async () => {
  setBalance(1000)
  const charge = await api('POST', '/api/nexabot/deduct', { token: userToken, body: {} })

  const refund = await api('POST', '/api/nexabot/refund', { token: userToken, body: { usage_id: charge.body.usage_id } })
  assert.equal(refund.status, 200)
  assert.equal(refund.body.refunded, 250)
  assert.equal(refund.body.balance, 1000)
  assert.equal(getBalance(), 1000)

  const usage = db.prepare('SELECT status FROM nexabot_usage WHERE id = ?').get(charge.body.usage_id) as { status: string }
  assert.equal(usage.status, 'refunded')

  // Refund kedua untuk usage yang sama harus gagal (tidak mencetak saldo).
  const again = await api('POST', '/api/nexabot/refund', { token: userToken, body: { usage_id: charge.body.usage_id } })
  assert.equal(again.status, 404)
  assert.equal(getBalance(), 1000)
})

test('POST /refund untuk generate gratis (paket aktif): tidak menambah saldo', async () => {
  setBalance(1000)
  giveApprovedPackage()
  const charge = await api('POST', '/api/nexabot/deduct', { token: userToken, body: {} })

  const refund = await api('POST', '/api/nexabot/refund', { token: userToken, body: { usage_id: charge.body.usage_id } })

  assert.equal(refund.status, 200)
  assert.equal(refund.body.refunded, 0)
  assert.equal(getBalance(), 1000, 'refund usage gratis tidak boleh menambah saldo')
  assert.equal(db.prepare('SELECT status FROM nexabot_usage WHERE id = ?').get(charge.body.usage_id).status, 'refunded')
})

test('POST /refund tanpa usage_id/batch_id yang cocok → 404', async () => {    const missing = await api('POST', '/api/nexabot/refund', { token: userToken, body: {} })
  assert.equal(missing.status, 404)

  const foreign = await api('POST', '/api/nexabot/refund', { token: userToken, body: { usage_id: 9999 } })
  assert.equal(foreign.status, 404)
})

// ── Riwayat ────────────────────────────────────────────────────────────────

test('GET /topups/mine: riwayat gabungan saldo & paket beserta status paket', async () => {
  await api('POST', '/api/nexabot/topup', { token: userToken, body: { amount: 50000 } })
  await api('POST', '/api/nexabot/package', { token: userToken, body: { slug: 'unlimited_yearly' } })

  const { status, body } = await api('GET', '/api/nexabot/topups/mine', { token: userToken })

  assert.equal(status, 200)
  assert.equal(body.topups.length, 2)
  const kinds = body.topups.map((t: any) => t.kind).sort()
  assert.deepEqual(kinds, ['balance', 'unlimited'])
  const pkg = body.topups.find((t: any) => t.kind === 'unlimited')
  assert.equal(pkg.package_slug, 'unlimited_yearly')
  assert.equal(body.unlimited.active, false, 'paket baru aktif setelah di-approve admin')
})

test('POST /topup: nominal di bawah minimum ditolak', async () => {
  const { status, body } = await api('POST', '/api/nexabot/topup', { token: userToken, body: { amount: 5000 } })

  assert.equal(status, 400)
  assert.match(body.error, /Minimal topup/)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM nexabot_topup').get().n, 0)
})
