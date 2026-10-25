import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'

const router = Router()

const DEFAULT_FEE = 250000
const DEFAULT_FEE_ORIGINAL = 350000
const DEFAULT_PRO_FEE = 50000

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

export function getMembershipFeeOriginal(): number {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'membership_fee_original'").get() as { value: string } | undefined
  const fee = Number(row?.value)
  return Number.isFinite(fee) && fee > 0 ? fee : DEFAULT_FEE_ORIGINAL
}

export function setMembershipFeeOriginal(fee: number) {
  db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES ('membership_fee_original', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"
  ).run(String(fee))
}

export function getProFee(): number {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'pro_fee'").get() as { value: string } | undefined
  const fee = Number(row?.value)
  return Number.isFinite(fee) && fee > 0 ? fee : DEFAULT_PRO_FEE
}

export function setProFee(fee: number) {
  db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES ('pro_fee', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"
  ).run(String(fee))
}

interface ProUserRow {
  id: number
  email: string
  name: string
  role: string
  plan: string
  pro_since: string | null
}

function latestProPayment(userId: number) {
  return db.prepare(
    'SELECT id, amount, status, proof_note, admin_note, created_at FROM pro_payments WHERE user_id = ? ORDER BY id DESC LIMIT 1'
  ).get(userId) as
    | { id: number; amount: number; status: string; proof_note: string; admin_note: string; created_at: string }
    | undefined
}

function proPayload(user: ProUserRow) {
  const payment = latestProPayment(user.id)
  return {
    plan: user.role === 'admin' || user.plan === 'pro' ? 'pro' : 'free',
    isAdmin: user.role === 'admin',
    proSince: user.pro_since,
    payment: payment
      ? {
          id: payment.id,
          amount: payment.amount,
          status: payment.status,
          proofNote: payment.proof_note,
          adminNote: payment.admin_note,
          createdAt: payment.created_at,
        }
      : null,
  }
}

// Konfigurasi membership publik (harga) — dipakai halaman Register / Status
router.get('/config', (_req, res: Response) => {
  try {
    res.json({
      ok: true,
      membershipFee: getMembershipFee(),
      membershipFeeOriginal: getMembershipFeeOriginal(),
      proFee: getProFee(),
    })
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

// Status Pro user yang sedang login — dipakai halaman Upgrade Pro & gerbang
// Gemini Tools untuk menentukan terkunci atau tidak.
router.get('/pro/status', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const user = db.prepare('SELECT id, email, name, role, plan, pro_since FROM users WHERE id = ?').get(req.user!.id) as ProUserRow | undefined
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json({ ok: true, ...proPayload(user) })
  } catch (error) {
    console.error('Get pro status error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Ajukan upgrade Pro. Nominal diambil dari server (bukan dari klien) supaya
// harga tidak bisa diturunkan dari browser; satu user hanya boleh punya satu
// pengajuan pending.
router.post('/pro/payment', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const user = db.prepare('SELECT id, email, name, role, plan, pro_since FROM users WHERE id = ?').get(req.user!.id) as ProUserRow | undefined
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.role === 'admin' || user.plan === 'pro') {
      return res.status(400).json({ error: 'Akun kamu sudah Pro' })
    }

    const pending = db.prepare(
      "SELECT id FROM pro_payments WHERE user_id = ? AND status = 'pending'"
    ).get(user.id) as { id: number } | undefined
    if (pending) {
      return res.status(400).json({ error: 'Masih ada konfirmasi pembayaran Pro yang menunggu approval admin' })
    }

    const amount = getProFee()
    const proofNote = String((req.body as any)?.proof_note || '').slice(0, 500)
    const result = db.prepare(
      "INSERT INTO pro_payments (user_id, amount, status, proof_note) VALUES (?, ?, 'pending', ?)"
    ).run(user.id, amount, proofNote)

    db.prepare(
      "INSERT INTO notifications (title, message, type, target) VALUES (?, ?, 'warning', 'admins')"
    ).run(
      'Permintaan Upgrade Pro',
      `${user.name} (${user.email}) mengajukan upgrade Pro ${formatRp(amount)} — menunggu approval.`,
    )

    res.status(201).json({
      ok: true,
      message: `Konfirmasi pembayaran ${formatRp(amount)} diterima. Admin akan mengaktifkan Pro setelah pembayaran dicek.`,
      payment: {
        id: result.lastInsertRowid,
        amount,
        status: 'pending',
        proofNote,
        adminNote: '',
        createdAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Pro payment error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

function formatRp(value: number): string {
  return `Rp ${value.toLocaleString('id-ID')}`
}

export default router
