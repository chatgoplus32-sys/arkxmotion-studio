/**
 * SEGEL: `createVelianpayPayment` hanya menyimpan URL http/https yang sah ke
 * `checkout_url` / `qris_image`. Nilai tak sah dari API (mis. 'bukan-url'
 * atau data URI) disimpan sebagai '' — TANPA menggagalkan pembayaran.
 *
 * Kontrak kolom `checkout_url` dan `qris_image` adalah URL. Kalau nilai
 * sampah lolos, UI bisa menyisipkan data URI ke <img src> atau link rusak.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'

process.env.ARKXMOTION_DB_PATH = ':memory:'
process.env.ALERT_WEBHOOK_URL = ''
process.env.VELIANPAY_ENABLED = 'true'
process.env.VELIANPAY_API_KEY = 'test-only'
process.env.VELIANPAY_BASE_URL = 'https://velianpay.test'

const realFetch = globalThis.fetch
const { default: db } = await import('../server/db.js')
const { createVelianpayPayment } = await import('../server/lib/velianpay.js')

// Data API dikendalikan per-tes lewat `apiData`; URL endpoint tak relevan.
let apiData: Record<string, unknown> = {}
globalThis.fetch = async () =>
  Response.json({ success: true, data: { reference: 'ref-url-1', final_amount: 1100, ...apiData } })

db.prepare("INSERT INTO users (id,email,password,name) VALUES (1,'url1@example.test','x','URL Test')").run()

let topupId = 0
function seedPendingTopup(): number {
  topupId++
  db.prepare("INSERT INTO runninghub_topup (id,user_id,amount,status) VALUES (?,1,1000,'pending')").run(topupId)
  return topupId
}
function payRow(orderId: string): { checkout_url: string; qris_image: string; payable_amount: number; unique_code: number } {
  return db
    .prepare('SELECT checkout_url, qris_image, payable_amount, unique_code FROM velianpay_payment WHERE order_id = ?')
    .get(orderId) as { checkout_url: string; qris_image: string; payable_amount: number; unique_code: number }
}

after(() => {
  globalThis.fetch = realFetch
  db.close()
})

test('(a) URL valid lolos apa adanya, baris dibuat nominal benar', async () => {
  const id = seedPendingTopup()
  apiData = {
    reference: 'ref-valid-1',
    payment_link: 'https://pay.velianpay.test/abc?x=1',
    qris_branded_image_url: 'https://cdn.velianpay.test/q.png',
  }
  const r = await createVelianpayPayment({ refTable: 'runninghub_topup', refId: id, userId: 1, baseAmount: 1000, description: 'test' })
  assert.ok(r, 'pembayaran harus dibuat')
  assert.equal(r!.checkout_url, 'https://pay.velianpay.test/abc?x=1')
  assert.equal(r!.qris_image, 'https://cdn.velianpay.test/q.png')
  const row = payRow('ref-valid-1')
  assert.equal(row.checkout_url, 'https://pay.velianpay.test/abc?x=1')
  assert.equal(row.qris_image, 'https://cdn.velianpay.test/q.png')
  assert.equal(row.payable_amount, 1100)
  assert.equal(row.unique_code, 100)
})

test("(b) 'bukan-url' → checkout_url '' tapi baris tetap dibuat", async () => {
  const id = seedPendingTopup()
  apiData = { reference: 'ref-bad-link', payment_link: 'bukan-url' }
  const r = await createVelianpayPayment({ refTable: 'runninghub_topup', refId: id, userId: 1, baseAmount: 1000, description: 'test' })
  assert.ok(r, 'field URL tak sah TIDAK boleh menggagalkan pembayaran')
  assert.equal(r!.checkout_url, '')
  const row = payRow('ref-bad-link')
  assert.equal(row.checkout_url, '')
  assert.equal(row.payable_amount, 1100)
  assert.equal(row.unique_code, 100)
})

test('(c) data URI → qris_image menjadi string kosong', async () => {
  const id = seedPendingTopup()
  apiData = { reference: 'ref-data-uri', qris_branded_image_url: 'data:image/png;base64,AAAA' }
  const r = await createVelianpayPayment({ refTable: 'runninghub_topup', refId: id, userId: 1, baseAmount: 1000, description: 'test' })
  assert.ok(r)
  assert.equal(r!.qris_image, '')
  const row = payRow('ref-data-uri')
  assert.equal(row.qris_image, '')
  assert.equal(row.payable_amount, 1100)
  assert.equal(row.unique_code, 100)
})

test('fallback qris_image_url juga divalidasi', async () => {
  const id = seedPendingTopup()
  apiData = { reference: 'ref-fallback', qris_image_url: 'not a url at all' }
  const r = await createVelianpayPayment({ refTable: 'runninghub_topup', refId: id, userId: 1, baseAmount: 1000, description: 'test' })
  assert.ok(r)
  assert.equal(r!.qris_image, '')
  assert.equal(payRow('ref-fallback').qris_image, '')
})
