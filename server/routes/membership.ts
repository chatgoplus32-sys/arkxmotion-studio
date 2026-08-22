import { Router, Response } from 'express'
import db from '../db.js'

const router = Router()

const DEFAULT_FEE = 150000

export function getMembershipFee(): number {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'membership_fee'").get() as { value: string } | undefined
  const fee = Number(row?.value)
  return Number.isFinite(fee) && fee > 0 ? fee : DEFAULT_FEE
}

export function setMembershipFee(fee: number) {
  db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES ('membership_fee', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"
  ).run(String(fee))
}

// Konfigurasi membership publik (harga) — dipakai halaman Register / Status
router.get('/config', (_req, res: Response) => {
  try {
    res.json({ ok: true, membershipFee: getMembershipFee() })
  } catch (error) {
    console.error('Get membership config error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Konfirmasi pembayaran member baru — publik, dipakai lewat payment token
// yang diberikan saat registrasi (user pending belum bisa login).
router.post('/payment', (req, res: Response) => {
  try {
    const { token, amount, proof_note } = req.body || {}

    if (!token) return res.status(400).json({ error: 'Token pembayaran diperlukan' })
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Nominal pembayaran tidak valid' })
    }

    const user = db.prepare('SELECT id, email, approved, payment_token FROM users WHERE payment_token = ?').get(token) as
      | { id: number; email: string; approved: number; payment_token: string | null }
      | undefined
    if (!user) return res.status(400).json({ error: 'Token pembayaran tidak valid' })

    if (user.approved) {
      return res.status(400).json({ error: 'Akun kamu sudah aktif — tidak perlu konfirmasi pembayaran' })
    }

    const pending = db.prepare(
      "SELECT id FROM membership_payments WHERE user_id = ? AND status = 'pending'"
    ).get(user.id) as { id: number } | undefined
    if (pending) {
      return res.status(400).json({ error: 'Masih ada konfirmasi pembayaran yang belum diproses admin' })
    }

    const result = db.prepare(
      'INSERT INTO membership_payments (user_id, amount, status, proof_note) VALUES (?, ?, ?, ?)'
    ).run(user.id, amt, 'pending', String(proof_note || '').slice(0, 500))

    res.status(201).json({
      ok: true,
      message: 'Konfirmasi pembayaran diterima. Admin akan memprosesnya.',
      paymentId: result.lastInsertRowid,
    })
  } catch (error) {
    console.error('Membership payment error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
