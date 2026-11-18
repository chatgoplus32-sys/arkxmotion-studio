/**
 * Pendaftaran baru → bayar QRIS BasuNiPay → akun langsung aktif TANPA admin.
 *
 * Registrasi sengaja membuat `users.approved = 0` (gerbang login 403) plus
 * satu baris `membership_payments` pending. Begitu pembayaran terverifikasi,
 * baris itu disetujui dan user langsung jadi approved=1, plan='pro' — login
 * terbuka dan fitur Pro langsung kepakai.
 *
 * Dua jalur verifikasi diuji di sini:
 *  1. poll API BasuNiPay (dipicu webhook / internal 2 menit) — status selalu
 *     dicek ke API BasuNiPay, body webhook tidak dipercaya;
 *  2. pencocokan nominal `matchIncomingAmount` (email notifikasi bank /
 *     paste mutasi) — jalur fallback bila checkout BasuNiPay gagal.
 *
 * Kedua jalur memakai mesin yang sama: `handleRow` →
 * `approveMembershipPaymentRow`.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'

process.env.ARKXMOTION_DB_PATH = ':memory:'
process.env.ALERT_WEBHOOK_URL = ''
process.env.BASUNIPAY_ENABLED = 'true'
process.env.BASUNIPAY_API_KEY = 'test-only'
const { default: db } = await import('../server/db.js')
const { pollBasunipayPayments } = await import('../server/lib/basunipay.js')
const { matchIncomingAmount } = await import('../server/lib/qrisPayment.js')

// API BasuNiPay selalu menjawab "lunas" — tes ini soal EFEK approve,
// bukan soal parsing response provider.
const originalFetch = globalThis.fetch
globalThis.fetch = async () => Response.json({ success: true, data: { status: 'paid' } })
after(() => { globalThis.fetch = originalFetch; db.close() })

/** Nominal pembayaran member yang berbeda tiap skenario (tidak saling tabrak). */
const FEE = 250000

/**
 * Buat satu registrasi persis seperti `POST /api/auth/register`
 * (approved=0) + pembayaran member pending. `withBasunipay` juga menaruh
 * baris checkout di `basunipay_payment` supaya poller menemukannya.
 */
function seedRegistration(total: number, withBasunipay: boolean) {
  const userId = 900000 + (total % 100000)
  db.prepare(
    "INSERT INTO users (id,email,password,name,role,approved,email_verified) VALUES (?,?,?,'Tester','user',0,1)",
  ).run(userId, `join${userId}@example.test`, 'x')
  const uniqueCode = total - FEE
  db.prepare(
    'INSERT INTO membership_payments (user_id, amount, amount_total, unique_code) VALUES (?, ?, ?, ?)',
  ).run(userId, FEE, total, uniqueCode)
  const payment = db.prepare('SELECT id FROM membership_payments WHERE user_id = ?').get(userId) as { id: number }
  if (withBasunipay) {
    db.prepare(
      `INSERT INTO basunipay_payment (order_id, ref_table, ref_id, user_id, base_amount, unique_code, payable_amount)
       VALUES (?, 'membership_payments', ?, ?, ?, ?, ?)`,
    ).run(`arkx_membership_${userId}`, payment.id, userId, FEE, uniqueCode, total)
  }
  return { userId, paymentId: payment.id }
}

function userRow(id: number) {
  return db.prepare('SELECT approved, plan, email_verified FROM users WHERE id = ?').get(id) as {
    approved: number
    plan: string
    email_verified: number
  }
}

function paymentRow(id: number) {
  return db.prepare('SELECT status FROM membership_payments WHERE id = ?').get(id) as { status: string }
}

function activations() {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM payment_verify_log WHERE ref_table = 'membership_payments' AND action = 'auto_activated'")
    .get() as { n: number }
  return row.n
}

test('sebelum bayar: akun tetap terkunci (approved=0)', () => {
  const { userId } = seedRegistration(250137, false)
  const u = userRow(userId)
  assert.equal(u.approved, 0, 'login harus ditolak 403 sampai pembayaran masuk')
  assert.equal(u.plan, 'free')
})

test('poll BasuNiPay mengaktifkan akun registrasi tanpa sentuh admin', async () => {
  const { userId, paymentId } = seedRegistration(250412, true)

  const r = await pollBasunipayPayments()
  assert.ok(r.paid >= 1, `minimal satu pembayaran lunas (dapat ${r.paid})`)

  assert.equal(paymentRow(paymentId).status, 'approved', 'baris pembayaran disetujui')
  const u = userRow(userId)
  assert.equal(u.approved, 1, 'user langsung boleh login')
  assert.equal(u.plan, 'pro', 'fitur Pro langsung terbuka')
  assert.equal(u.email_verified, 1)
  assert.ok(activations() >= 1, 'tercatat di log audit')
})

test('approve kedua kali tidak menggandakan aktivasi', async () => {
  const { userId, paymentId } = seedRegistration(250555, true)
  await pollBasunipayPayments()
  const before = activations()
  assert.equal(paymentRow(paymentId).status, 'approved')

  // Siklus kedua: baris checkout sudah 'paid' — tidak boleh diproses ulang,
  // dan approve manual/poll ganda tidak boleh menimpa atau dobel-log.
  const again = await pollBasunipayPayments()
  assert.equal(again.paid, 0, 'baris lunas tidak dipilih poller lagi')
  assert.equal(activations(), before, 'tidak ada aktivasi ganda')

  const u = userRow(userId)
  assert.equal(u.approved, 1)
  assert.equal(u.plan, 'pro')
})

test('pencocokan nominal email/paste juga mengaktifkan akun', () => {
  const { userId, paymentId } = seedRegistration(250888, false)

  const r = matchIncomingAmount(250888, { source: 'email', from: 'bank@example.test', subject: 'Dana masuk' })
  assert.equal(r.action, 'auto_activated')
  assert.equal(r.table, 'membership_payments')

  assert.equal(paymentRow(paymentId).status, 'approved')
  const u = userRow(userId)
  assert.equal(u.approved, 1)
  assert.equal(u.plan, 'pro')
})
