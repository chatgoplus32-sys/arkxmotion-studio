/**
 * Afiliasi member — komisi 25% hanya dari pembayaran JOIN Pro, sekali per
 * pembayaran, dan saldo afiliasi terpisah dari saldo generate.
 *
 * Kenapa tes ini ada: kalau hook komisi lepas dari `approveMembershipPaymentRow`,
 * atau kalau idempotensinya hilang, member bisa dapat komisi dobel/nyasar.
 * Tes ini mengunci:
 *  1. statis — hook ada di SATU tempat (approval), registrasi menyimpan
 *     `referred_by`, dan `MIN_WITHDRAWAL` klien = server;
 *  2. perilaku — commission 25% dari `amount`, sekali saja walau approve
 *     dipanggil dua kali, tanpa referrer = tanpa komisi;
 *  3. pencairan — saldo dikunci saat diajukan, lunas menambah total
 *     dicairkan, tolak mengembalikan saldo, tidak bisa diproses dua kali.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.ARKXMOTION_DB_PATH = ':memory:'
process.env.ALERT_WEBHOOK_URL = ''
const { default: db } = await import('../server/db.js')
const {
  AFFILIATE_RATE,
  MIN_WITHDRAWAL,
  AffiliateError,
  assignReferralCode,
  creditCommissionForPayment,
  getAffiliateOverview,
  processWithdrawal,
  requestWithdrawal,
  resolveReferralCode,
} = await import('../server/lib/affiliate.js')
const { approveMembershipPaymentRow } = await import('../server/lib/membershipActivation.js')

after(() => db.close())

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

let seq = 0
function seedUser(opts: { referredBy?: number; referralCode?: string | null } = {}) {
  seq += 1
  const id = 800000 + seq
  db.prepare(
    'INSERT INTO users (id,email,password,name,role,approved,email_verified,referred_by,referral_code) VALUES (?,?,?,?,?,1,1,?,?)',
  ).run(id, `aff${id}@example.test`, 'x', `Member ${id}`, 'user', opts.referredBy ?? null, opts.referralCode ?? null)
  return id
}

function seedJoinPayment(userId: number, amount = 250000) {
  const res = db.prepare('INSERT INTO membership_payments (user_id, amount) VALUES (?, ?)').run(userId, amount)
  return Number(res.lastInsertRowid)
}

test('statis: hook komisi hanya di approval membership + registrasi menyimpan referred_by', () => {
  const activation = read('server/lib/membershipActivation.ts')
  assert.match(activation, /creditCommissionForPayment\(pid, source\)/)
  // Hook harus berada di fungsi approval, bukan di route admin/webhook.
  assert.match(activation, /export function approveMembershipPaymentRow[\s\S]*creditCommissionForPayment/)

  const auth = read('server/routes/auth.ts')
  assert.match(auth, /referred_by/)
  assert.match(auth, /resolveReferralCode\(/)

  const admin = read('server/routes/admin.ts')
  assert.doesNotMatch(admin, /creditCommissionForPayment/)
})

test('statis: MIN_WITHDRAWAL & rate klien sama dengan server', () => {
  assert.equal(AFFILIATE_RATE, 25)
  const client = read('src/lib/affiliate.ts')
  assert.match(client, new RegExp(`MIN_WITHDRAWAL = ${MIN_WITHDRAWAL}`))
})

test('kode referral: unik, idempoten, dan bisa dicari tanpa peduli huruf besar/kecil', () => {
  const a = seedUser()
  const b = seedUser()
  const codeA = assignReferralCode(a)
  assert.match(codeA, /^ARKX-[A-Z2-9]{6}$/)
  assert.equal(assignReferralCode(a), codeA, 'kode tidak boleh berubah')
  const codeB = assignReferralCode(b)
  assert.notEqual(codeA, codeB)
  assert.equal(resolveReferralCode(codeA.toLowerCase()), a)
  assert.equal(resolveReferralCode(' ARKX-TIDAKADA '), null)
  assert.equal(resolveReferralCode(''), null)
})

test('approve join Pro mengkredit 25% sekali saja', () => {
  const referrer = seedUser()
  assignReferralCode(referrer)
  const referred = seedUser({ referredBy: referrer })
  const paymentId = seedJoinPayment(referred, 250000)

  const r = approveMembershipPaymentRow(paymentId, 'velianpay')
  assert.equal(r.ok, true)

  const commission = db.prepare('SELECT * FROM affiliate_commissions WHERE payment_id = ?').get(paymentId) as
    | { affiliate_user_id: number; amount: number; rate: number; source: string }
    | undefined
  assert.ok(commission, 'komisi wajib dibuat')
  assert.equal(commission.affiliate_user_id, referrer)
  assert.equal(commission.amount, 62500)
  assert.equal(commission.rate, 25)
  assert.equal(commission.source, 'velianpay')

  const acc = db.prepare('SELECT balance, total_earned FROM affiliate_accounts WHERE user_id = ?').get(referrer) as {
    balance: number
    total_earned: number
  }
  assert.equal(acc.balance, 62500)
  assert.equal(acc.total_earned, 62500)

  // Approve ulang (mis. webhook + poller bersamaan) tidak boleh menambah komisi.
  const again = approveMembershipPaymentRow(paymentId, 'manual')
  assert.equal(again.ok, false)
  assert.equal(creditCommissionForPayment(paymentId, 'manual'), null)
  const rows = db.prepare('SELECT COUNT(*) AS n FROM affiliate_commissions WHERE payment_id = ?').get(paymentId) as { n: number }
  assert.equal(rows.n, 1)
  const acc2 = db.prepare('SELECT balance FROM affiliate_accounts WHERE user_id = ?').get(referrer) as { balance: number }
  assert.equal(acc2.balance, 62500)
})

test('member tanpa referrer tidak menghasilkan komisi', () => {
  const user = seedUser()
  const paymentId = seedJoinPayment(user)
  assert.equal(approveMembershipPaymentRow(paymentId, 'manual').ok, true)
  const n = db.prepare('SELECT COUNT(*) AS n FROM affiliate_commissions WHERE referred_user_id = ?').get(user) as { n: number }
  assert.equal(n.n, 0)
})

test('overview hanya memuat komisi & pencairan milik sendiri', () => {
  const owner = seedUser()
  const other = seedUser()
  assignReferralCode(owner)
  const referred = seedUser({ referredBy: owner })
  approveMembershipPaymentRow(seedJoinPayment(referred, 200000), 'manual')

  const view = getAffiliateOverview(owner)
  assert.equal(view.referralCode, assignReferralCode(owner))
  assert.equal(view.balance, 50000)
  assert.equal(view.totalEarned, 50000)
  assert.equal(view.totalReferrals, 1)
  assert.equal(view.commissions.length, 1)
  assert.equal(view.commissions[0].amount, 50000)
  assert.equal(view.commissions[0].referredName, `Member ${referred}`)
  assert.equal(getAffiliateOverview(other).commissions.length, 0)
})

test('pencairan: saldo dikunci, lunas/tolak konsisten, tidak bisa dobel proses', () => {
  const user = seedUser()
  assignReferralCode(user)
  const referred = seedUser({ referredBy: user })
  approveMembershipPaymentRow(seedJoinPayment(referred, 400000), 'manual') // komisi 100.000

  assert.throws(() => requestWithdrawal(user, MIN_WITHDRAWAL - 1, 'DANA 08123456789', ''), AffiliateError)
  assert.throws(() => requestWithdrawal(user, 100001, 'DANA 08123456789', ''), AffiliateError)
  assert.throws(() => requestWithdrawal(user, 50000, 'abc', ''), AffiliateError)

  const paidId = requestWithdrawal(user, 50000, 'DANA 08123456789 a.n. Tester', 'cairkan')
  let view = getAffiliateOverview(user)
  assert.equal(view.balance, 50000, 'saldo berkurang saat pengajuan')
  assert.equal(view.withdrawals[0].status, 'pending')

  processWithdrawal(paidId, 'paid', 'transfer ok')
  view = getAffiliateOverview(user)
  assert.equal(view.withdrawals[0].status, 'paid')
  assert.equal(view.totalWithdrawn, 50000)
  assert.equal(view.balance, 50000)
  assert.throws(() => processWithdrawal(paidId, 'paid', 'lagi'), AffiliateError)

  const rejectId = requestWithdrawal(user, 50000, 'DANA 08123456789 a.n. Tester', '')
  processWithdrawal(rejectId, 'rejected', 'nomor salah')
  view = getAffiliateOverview(user)
  assert.equal(view.balance, 50000, 'saldo kembali setelah ditolak')
  assert.equal(view.totalWithdrawn, 50000)
  assert.equal(view.withdrawals[0].status, 'rejected')
})
