/**
 * SEGEL: webhook VelianPay hanya boleh dipercaya kalau SIGNATURNYA VALID,
 * dan body webhook tidak pernah dipakai untuk mengkredit saldo.
 *
 * Kenapa tes ini ada:
 *  - Tanpa verifikasi tanda tangan, siapa pun yang tahu URL publik bisa
 *    memicu poller (minimal: banjir request). Yang lebih penting, body palsu
 *    { status: 'paid' } TIDAK boleh mengubah baris top-up — status sebenarnya
 *    selalu diambil dari API VelianPay.
 *  - Tanda tangan dihitung dari BODY MENTAH memakai webhook secret (BUKAN API
 *    key) dan dibandingkan `crypto.timingSafeEqual`. Perbandingan panjang
 *    berbeda tidak boleh melempar (harus 401 rapi).
 *  - Route wajib di-mount dengan `express.raw` SEBELUM `express.json()` di
 *    server/index.ts, kalau tidak body mentah sudah dipotong dan semua
 *    signature gagal.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

process.env.ARKXMOTION_DB_PATH = ':memory:'
process.env.ALERT_WEBHOOK_URL = ''
process.env.VELIANPAY_ENABLED = 'true'
process.env.VELIANPAY_API_KEY = 'test-only'
process.env.VELIANPAY_BASE_URL = 'https://velianpay.test'
process.env.VELIANPAY_WEBHOOK_SECRET = 'whsec-webhook-test'

const crypto = (await import('node:crypto')).default
const http = (await import('node:http')).default
const express = (await import('express')).default
const { default: db } = await import('../server/db.js')
const { default: velianpayWebhookRoutes } = await import('../server/routes/velianpayWebhook.js')

// API VelianPay selalu menjawab "pending" — body webhook (yang mungkin
// mengklaim "paid") TIDAK boleh dipercaya.
let fetchCalls = 0
const realFetch = globalThis.fetch
// HANYA panggilan ke API VelianPay yang di-stub; request tes ke server kita
// memakai `realFetch` (kalau global fetch di-stub, request HTTP tes ikut palsu).
globalThis.fetch = async () => {
  fetchCalls++
  return Response.json({ success: true, data: { status: 'pending' } })
}

// Seed satu pengajuan pending + checkout VelianPay pending supaya poller
// benar-benar memanggil API status saat webhook valid.
db.prepare("INSERT INTO users (id,email,password,name) VALUES (1,'wh1@example.test','x','Webhook Test')").run()
db.prepare("INSERT INTO runninghub_topup (id,user_id,amount,status) VALUES (1,1,1000,'pending')").run()
db.prepare(
  "INSERT INTO velianpay_payment (order_id,ref_table,ref_id,user_id,base_amount,payable_amount,status) VALUES ('ref-wh-1','runninghub_topup',1,1,1000,1100,'pending')",
).run()

const app = express()
app.use('/api/public/velianpay/webhook', express.raw({ type: '*/*' }), velianpayWebhookRoutes)
const server = http.createServer(app)
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
const port = (server.address() as { port: number }).port
const URL = `http://127.0.0.1:${port}/api/public/velianpay/webhook`
const BODY = JSON.stringify({ reference: 'ref-wh-1', status: 'paid', final_amount: 1100 })
const sign = (raw: string) => crypto.createHmac('sha256', 'whsec-webhook-test').update(raw).digest('hex')

after(() => {
  globalThis.fetch = realFetch
  server.close()
  db.close()
})

function topupStatus(): string {
  return (db.prepare('SELECT status FROM runninghub_topup WHERE id = 1').get() as { status: string }).status
}
function checkoutStatus(): string {
  return (db.prepare("SELECT status FROM velianpay_payment WHERE order_id = 'ref-wh-1'").get() as { status: string })
    .status
}

test('statis: route webhook di-mount express.raw SEBELUM express.json()', () => {
  const src = readFileSync(join(ROOT, 'server/index.ts'), 'utf8')
  const rawAt = src.indexOf("app.use('/api/public/velianpay/webhook', express.raw(")
  const jsonAt = src.indexOf('app.use(express.json(')
  assert.ok(rawAt >= 0, "route webhook VelianPay tidak ter-mount dengan express.raw di server/index.ts")
  assert.ok(jsonAt >= 0, 'express.json() tidak ditemukan di server/index.ts')
  assert.ok(rawAt < jsonAt, 'webhook VelianPay HARUS di-mount sebelum express.json() agar body mentah utuh')
})

test('tanpa header signature → 401 dan poller TIDAK dipanggil', async () => {
  fetchCalls = 0
  const res = await realFetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: BODY })
  assert.equal(res.status, 401, 'request tanpa X-VelianPay-Signature harus ditolak')
  assert.equal(fetchCalls, 0, 'request tak sah tidak boleh memicu poll ke API VelianPay')
  assert.equal(topupStatus(), 'pending', 'top-up tidak berubah')
})

test('signature panjangnya beda → 401 tanpa melempar', async () => {
  fetchCalls = 0
  const res = await realFetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-velianpay-signature': 'abc' },
    body: BODY,
  })
  assert.equal(res.status, 401)
  assert.equal(fetchCalls, 0)
})

test('signature salah (panjang sama) → 401 dan tidak memakai timing bocor', async () => {
  fetchCalls = 0
  const wrong = sign(BODY).replace(/^./, (c) => (c === 'a' ? 'b' : 'a'))
  const res = await realFetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-velianpay-signature': wrong },
    body: BODY,
  })
  assert.equal(res.status, 401)
  assert.equal(fetchCalls, 0)
})

test('signature benar → poller jalan, TAPI status palsu di body tidak mengkredit', async () => {
  fetchCalls = 0
  const res = await realFetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-velianpay-signature': sign(BODY) },
    body: BODY,
  })
  assert.equal(res.status, 200)
  const json = (await res.json()) as { ok: boolean; poll: { checked: number } }
  assert.equal(json.ok, true)
  assert.ok(json.poll.checked >= 1, 'webhook sah harus menjalankan satu siklus poll')
  assert.ok(fetchCalls >= 1, 'poll harus bertanya ke API VelianPay')

  // Body mengklaim "paid", tapi API menjawab "pending" → TIDAK boleh dikredit.
  assert.equal(topupStatus(), 'pending', 'klaim lunas di body webhook tidak boleh dipercaya')
  assert.equal(checkoutStatus(), 'pending', 'checkout tetap pending selama API belum melaporkan lunas')
})
