import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import { nextUniqueCode } from '../lib/qrisPayment.js'
import { createBasunipayPayment } from '../lib/basunipay.js'

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
    'SELECT id, amount, unique_code, amount_total, status, proof_note, admin_note, created_at FROM pro_payments WHERE user_id = ? ORDER BY id DESC LIMIT 1'
  ).get(userId) as
    | { id: number; amount: number; unique_code: number | null; amount_total: number | null; status: string; proof_note: string; admin_note: string; created_at: string }
    | undefined
}

function proPayload(user: ProUserRow) {
  const payment = latestProPayment(user.id)
  return {
    plan: user.role === 'admin' || user.plan === 'pro' ? 'pro' : 'free',
    isAdmin: user.role === 'admin',
    proSince: user.pro_since,
    payment: payment
      ? (() => {
          // Sertakan checkout BasuniPay terbaru bila ada — gambar QR tetap
          // tampil walau halaman di-refresh.
          const bp = db.prepare(
            "SELECT checkout_url, qris_image FROM basunipay_payment WHERE ref_table = 'pro_payments' AND ref_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
          ).get(payment.id) as { checkout_url?: string; qris_image?: string } | undefined
          return {
            id: payment.id,
            amount: payment.amount,
            amountTotal: payment.amount_total,
            uniqueCode: payment.unique_code,
            status: payment.status,
            proofNote: payment.proof_note,
            adminNote: payment.admin_note,
            createdAt: payment.created_at,
            checkoutUrl: bp?.checkout_url || null,
            qrisImage: bp?.qris_image || null,
          }
        })()
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
router.post('/payment', async (req, res: Response) => {
  try {
    const { token, proof_note } = req.body || {}

    if (!token) return res.status(400).json({ error: 'Token pembayaran diperlukan' })
    // Nominal DIKUNCI server — klien tidak mengirim amount (anti bayar kurang).
    const amt = getMembershipFee()

    const user = db.prepare('SELECT id, email, approved, payment_token FROM users WHERE payment_token = ?').get(token) as
      | { id: number; email: string; approved: number; payment_token: string | null }
      | undefined
    if (!user) return res.status(400).json({ error: 'Token pembayaran tidak valid' })

    if (user.approved) {
      return res.status(400).json({ error: 'Akun kamu sudah aktif — tidak perlu konfirmasi pembayaran' })
    }

    const pending = db.prepare(
      "SELECT id, amount_total, unique_code FROM membership_payments WHERE user_id = ? AND status = 'pending'"
    ).get(user.id) as { id: number; amount_total: number | null; unique_code: number | null } | undefined
    if (pending) {
      // Idempoten: panggilan berulang (mis. halaman dimuat ulang) mengembalikan
      // data yang sama, bukan error — user perlu link & nominal yang sama.
      const bp = db.prepare(
        "SELECT checkout_url, payable_amount, unique_code, qris_image FROM basunipay_payment WHERE ref_table = 'membership_payments' AND ref_id = ? ORDER BY id DESC LIMIT 1",
      ).get(pending.id) as { checkout_url: string; payable_amount: number; unique_code: number; qris_image?: string } | undefined
      return res.json({
        ok: true,
        message: 'Pembayaranmu sudah tercatat — gunakan link/QR di bawah.',
        paymentId: pending.id,
        amount: amt,
        amountTotal: pending.amount_total ?? amt,
        uniqueCode: pending.unique_code,
        basunipay: bp ? { checkout_url: bp.checkout_url, payable_amount: bp.payable_amount, unique_code: bp.unique_code, qris_image: bp.qris_image || '' } : null,
        pending: true,
      })
    }

    const { unique_code, amount_total } = nextUniqueCode(amt)
    const result = db.prepare(
      'INSERT INTO membership_payments (user_id, amount, unique_code, amount_total, status, proof_note) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user.id, amt, unique_code, amount_total, 'pending', String(proof_note || '').slice(0, 500))
    const refId = Number(result.lastInsertRowid)

    const basunipay = await createBasunipayPayment({
      refTable: 'membership_payments',
      refId,
      userId: user.id,
      baseAmount: amt,
      description: `Join Pro — ${user.email}`,
    })
    const payment = db.prepare('SELECT id, amount, amount_total, unique_code FROM membership_payments WHERE id = ?').get(refId) as
      | { id: number; amount: number; amount_total: number | null; unique_code: number | null }
      | undefined

    res.status(201).json({
      ok: true,
      message: 'Konfirmasi pembayaran diterima. Akun akan otomatis aktif begitu pembayaran masuk.',
      paymentId: refId,
      amount: amt,
      amountTotal: payment?.amount_total ?? amount_total,
      uniqueCode: payment?.unique_code ?? unique_code,
      basunipay,
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
router.post('/pro/payment', authenticateToken, async (req: AuthRequest, res: Response) => {
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
    const { unique_code, amount_total } = nextUniqueCode(amount)
    const result = db.prepare(
      "INSERT INTO pro_payments (user_id, amount, unique_code, amount_total, status, proof_note) VALUES (?, ?, ?, ?, 'pending', ?)"
    ).run(user.id, amount, unique_code, amount_total, proofNote)
    const refId = Number(result.lastInsertRowid)

    const basunipay = await createBasunipayPayment({
      refTable: 'pro_payments',
      refId,
      userId: user.id,
      baseAmount: amount,
      description: `Upgrade Pro — ${user.email}`,
    })
    const payment = db.prepare('SELECT amount_total, unique_code FROM pro_payments WHERE id = ?').get(refId) as
      | { amount_total: number | null; unique_code: number | null }
      | undefined

    db.prepare(
      "INSERT INTO notifications (title, message, type, target) VALUES (?, ?, 'warning', 'admins')"
    ).run(
      'Permintaan Upgrade Pro',
      `${user.name} (${user.email}) mengajukan upgrade Pro ${formatRp(amount)} — menunggu approval.`,
    )

    res.status(201).json({
      ok: true,
      message: `Konfirmasi pembayaran ${formatRp(amount)} diterima. Akun akan otomatis Pro begitu pembayaran masuk.`,
      payment: {
        id: refId,
        amount,
        amountTotal: payment?.amount_total ?? amount_total,
        uniqueCode: payment?.unique_code ?? unique_code,
        status: 'pending',
        proofNote,
        adminNote: '',
        createdAt: new Date().toISOString(),
      },
      basunipay,
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
