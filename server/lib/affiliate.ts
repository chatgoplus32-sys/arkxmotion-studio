/**
 * Afiliasi member — komisi 25% dari pembayaran join Pro yang datang lewat
 * link referral member lain. Saldo afiliasi TERPISAH dari saldo generate
 * provider; pencairan diproses manual oleh admin.
 */
import { randomInt } from 'node:crypto'
import db from '../db.js'
import { logPaymentVerify } from './qrisPayment.js'

/** Persen komisi dari nominal join (base fee, bukan nominal + kode unik). */
export const AFFILIATE_RATE = 25
/** Minimal penarikan supaya admin tidak dibanjiri permintaan kecil. */
export const MIN_WITHDRAWAL = 50000

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

export interface AffiliateOverview {
  referralCode: string
  balance: number
  totalEarned: number
  totalWithdrawn: number
  totalReferrals: number
  commissions: Array<{ id: number; amount: number; rate: number; source: string; createdAt: string; referredName: string }>
  withdrawals: Array<{ id: number; amount: number; destination: string; note: string; status: string; adminNote: string; createdAt: string; processedAt: string | null }>
}

function generateCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return `ARKX-${out}`
}

/** Beri kode referral ke user (dipanggil saat daftar & saat /me kalau belum ada). */
export function assignReferralCode(userId: number): string {
  const existing = db.prepare('SELECT referral_code FROM users WHERE id = ?').get(userId) as { referral_code: string | null } | undefined
  if (existing?.referral_code) return existing.referral_code
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = generateCode()
    const used = db.prepare('SELECT 1 FROM users WHERE referral_code = ?').get(code)
    if (used) continue
    db.prepare('UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL').run(code, userId)
    const saved = db.prepare('SELECT referral_code FROM users WHERE id = ?').get(userId) as { referral_code: string }
    if (saved.referral_code) return saved.referral_code
  }
  throw new Error('Gagal membuat kode referral yang unik')
}

/** Cari pemilik kode; kode invalid diabaikan saat registrasi. */
export function resolveReferralCode(code: unknown): number | null {
  const clean = String(code ?? '').trim().toUpperCase()
  if (!clean || clean.length > 32) return null
  const row = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(clean) as { id: number } | undefined
  return row?.id ?? null
}

export function ensureAffiliateAccount(userId: number): void {
  db.prepare('INSERT OR IGNORE INTO affiliate_accounts (user_id) VALUES (?)').run(userId)
}

/**
 * Kredit komisi untuk SATU pembayaran join. Dipanggil dari dalam transaksi
 * approveMembershipPaymentRow supaya approval & komisi menjadi satu transaksi
 * (atomik). UNIQUE payment_id mencegah komisi dobel walaupun dipanggil dua kali.
 */
export function creditCommissionForPayment(paymentId: number, source: string): number | null {
  const payment = db.prepare(
    `SELECT mp.id, mp.amount, mp.user_id, u.referred_by, u.name AS referred_name
       FROM membership_payments mp JOIN users u ON u.id = mp.user_id WHERE mp.id = ?`,
  ).get(paymentId) as { id: number; amount: number; user_id: number; referred_by: number | null; referred_name: string } | undefined
  if (!payment?.referred_by || payment.referred_by === payment.user_id) return null

  const amount = Math.round((payment.amount * AFFILIATE_RATE) / 100)
  if (amount <= 0) return null

  const inserted = db.prepare(
    `INSERT OR IGNORE INTO affiliate_commissions
       (affiliate_user_id, referred_user_id, payment_id, amount, rate, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(payment.referred_by, payment.user_id, payment.id, amount, AFFILIATE_RATE, source || 'manual')
  if (!inserted.changes) return null

  ensureAffiliateAccount(payment.referred_by)
  db.prepare(
    `UPDATE affiliate_accounts
        SET balance = balance + ?, total_earned = total_earned + ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?`,
  ).run(amount, amount, payment.referred_by)
  try {
    db.prepare(
      "INSERT INTO notifications (title, message, type, target, user_id) VALUES (?, ?, 'success', 'users', ?)",
    ).run(
      'Komisi Afiliasi Masuk',
      `Member ${payment.referred_name} bergabung lewat link kamu. Komisi Rp ${amount.toLocaleString('id-ID')} ditambahkan ke saldo afiliasi.`,
      payment.referred_by,
    )
  } catch (e) {
    console.warn('[affiliate] notifikasi gagal:', e)
  }
  logPaymentVerify({
    source: 'affiliate',
    refTable: 'membership_payments',
    refId: payment.id,
    amount,
    action: 'affiliate_commission',
    detail: `Komisi ${AFFILIATE_RATE}% dari join ${payment.referred_name} untuk user #${payment.referred_by}`,
  })
  return amount
}

export function getAffiliateOverview(userId: number): AffiliateOverview {
  const code = assignReferralCode(userId)
  ensureAffiliateAccount(userId)
  const acc = db.prepare('SELECT balance, total_earned, total_withdrawn FROM affiliate_accounts WHERE user_id = ?').get(userId) as {
    balance: number
    total_earned: number
    total_withdrawn: number
  }
  const totalReferrals = (db.prepare('SELECT COUNT(*) AS n FROM affiliate_commissions WHERE affiliate_user_id = ?').get(userId) as { n: number }).n
  const commissions = db.prepare(
    `SELECT ac.id, ac.amount, ac.rate, ac.source, ac.created_at AS createdAt, u.name AS referredName
       FROM affiliate_commissions ac JOIN users u ON u.id = ac.referred_user_id
      WHERE ac.affiliate_user_id = ? ORDER BY ac.id DESC LIMIT 50`,
  ).all(userId) as AffiliateOverview['commissions']
  const withdrawals = db.prepare(
    `SELECT id, amount, destination, note, status, admin_note AS adminNote, created_at AS createdAt, processed_at AS processedAt
       FROM affiliate_withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
  ).all(userId) as AffiliateOverview['withdrawals']
  return {
    referralCode: code,
    balance: acc.balance,
    totalEarned: acc.total_earned,
    totalWithdrawn: acc.total_withdrawn,
    totalReferrals,
    commissions,
    withdrawals,
  }
}

export class AffiliateError extends Error {}

export function requestWithdrawal(userId: number, amount: number, destination: string, note: string) {
  ensureAffiliateAccount(userId)
  if (!Number.isInteger(amount) || amount < MIN_WITHDRAWAL) {
    throw new AffiliateError(`Minimal penarikan ${MIN_WITHDRAWAL.toLocaleString('id-ID')} Rupiah`)
  }
  const dest = String(destination ?? '').trim().slice(0, 200)
  if (dest.length < 5) throw new AffiliateError('Nomor/tujuan pencairan wajib diisi (min. 5 karakter)')
  const catatan = String(note ?? '').trim().slice(0, 300)
  let id = 0
  db.transaction(() => {
    const acc = db.prepare('SELECT balance FROM affiliate_accounts WHERE user_id = ?').get(userId) as { balance: number }
    if (acc.balance < amount) throw new AffiliateError('Saldo afiliasi tidak cukup')
    db.prepare('UPDATE affiliate_accounts SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(amount, userId)
    const res = db.prepare(
      'INSERT INTO affiliate_withdrawals (user_id, amount, destination, note) VALUES (?, ?, ?, ?)',
    ).run(userId, amount, dest, catatan)
    id = Number(res.lastInsertRowid)
  })()
  return id
}

export function listAdminWithdrawals(status?: string) {
  const where = status === 'pending' || status === 'paid' || status === 'rejected' ? 'WHERE w.status = ?' : ''
  const params = where ? [status] : []
  return db.prepare(
    `SELECT w.id, w.user_id AS userId, u.email, u.name, w.amount, w.destination, w.note,
            w.status, w.admin_note AS adminNote, w.created_at AS createdAt, w.processed_at AS processedAt
       FROM affiliate_withdrawals w JOIN users u ON u.id = w.user_id
       ${where} ORDER BY w.id DESC LIMIT 100`,
  ).all(...params)
}

export function processWithdrawal(id: number, action: 'paid' | 'rejected', adminNote: string) {
  const row = db.prepare('SELECT * FROM affiliate_withdrawals WHERE id = ?').get(id) as
    | { id: number; user_id: number; amount: number; status: string }
    | undefined
  if (!row) throw new AffiliateError('Permintaan tidak ditemukan')
  if (row.status !== 'pending') throw new AffiliateError('Permintaan sudah diproses')
  const note = String(adminNote ?? '').trim().slice(0, 300)
  db.transaction(() => {
    db.prepare(
      "UPDATE affiliate_withdrawals SET status = ?, admin_note = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
    ).run(action, note, id)
    if (action === 'rejected') {
      db.prepare(
        'UPDATE affiliate_accounts SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      ).run(row.amount, row.user_id)
    } else {
      db.prepare(
        'UPDATE affiliate_accounts SET total_withdrawn = total_withdrawn + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      ).run(row.amount, row.user_id)
    }
  })()
  return row.user_id
}
