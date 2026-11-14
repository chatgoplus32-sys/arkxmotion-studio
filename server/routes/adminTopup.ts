import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.js'
import { activateUnlimitedTopup } from '../lib/unlimitedActivation.js'

const router = Router()

/**
 * Peta tabel wallet per provider. Nama tabel TIDAK pernah diambil mentah dari
 * request — hanya dipilih dari daftar putih ini, jadi tidak ada jalan untuk
 * menyuntik nama tabel lewat parameter `provider`.
 */
const WALLETS = {
  createpulse: { topup: 'createpulse_topup', balance: 'createpulse_balance', credit: 'amount' },
  nexabot: { topup: 'nexabot_topup', balance: 'nexabot_balance', credit: 'amount' },
  // Seavi: saldo dalam TOKEN — approve menambah `tokens`, bukan `amount` (Rp).
  seavi: { topup: 'seavi_topup', balance: 'seavi_balance', credit: 'tokens' },
  // PosBot: saldo dalam RUPIAH seperti CreatePulse/NexaBot (kredit via `amount`).
  posbot: { topup: 'posbot_topup', balance: 'posbot_balance', credit: 'amount' },
  // RunningHub: saldo Rupiah, tarif flat per generate (pool token master operator).
  runninghub: { topup: 'runninghub_topup', balance: 'runninghub_balance', credit: 'amount' },
} as const
type WalletKey = keyof typeof WALLETS

function resolveWallet(value: unknown): (typeof WALLETS)[WalletKey] {
  const key = String(value || 'createpulse')
  return key in WALLETS ? WALLETS[key as WalletKey] : WALLETS.createpulse
}

router.get('/pending', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const w = resolveWallet(req.query.provider)
    const topups = db.prepare(`
      SELECT t.*, u.email, u.name as user_name
      FROM ${w.topup} t
      JOIN users u ON t.user_id = u.id
      WHERE t.status = 'pending'
      ORDER BY t.created_at ASC
    `).all()
    res.json({ topups, provider: req.query.provider || 'createpulse' })
  } catch (error) {
    console.error('List pending topups error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/all', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const w = resolveWallet(req.query.provider)
    const topups = db.prepare(`
      SELECT t.*, u.email, u.name as user_name
      FROM ${w.topup} t
      JOIN users u ON t.user_id = u.id
      ORDER BY t.created_at DESC
    `).all()
    res.json({ topups, provider: req.query.provider || 'createpulse' })
  } catch (error) {
    console.error('List all topups error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/approve', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const w = resolveWallet(req.body?.provider)
    const { id, admin_note } = req.body
    if (!id) return res.status(400).json({ error: 'Topup id required' })

    const topup = db.prepare(`SELECT * FROM ${w.topup} WHERE id = ? AND status = ?`).get(id, 'pending') as any
    if (!topup) return res.status(404).json({ error: 'Pending topup not found' })

    // Paket Unlimited NexaBot: approve = aktifkan masa berlaku, BUKAN menambah
    // saldo. Logika identik dengan aktivasi otomatis via BasuniPay — satu
    // sumber kebenaran di server/lib/unlimitedActivation.ts.
    if (topup.kind === 'unlimited') {
      const act = activateUnlimitedTopup(topup, admin_note || '')
      const balance = db.prepare(`SELECT balance FROM ${w.balance} WHERE user_id = ?`).get(topup.user_id) as { balance: number } | undefined
      try {
        db.prepare("INSERT INTO notifications (title, message, type, target, user_id) VALUES (?, ?, 'success', 'users', ?)").run(
          'Paket Unlimited Aktif ✅',
          `Paket ${act.name} aktif sampai ${act.expires_at || '-'} (${act.days_left} hari). Selamat menikmati!`,
          topup.user_id,
        )
      } catch (e) { console.warn('[adminTopup] Gagal kirim notifikasi paket:', e) }
      return res.json({
        message: `Paket ${act.name} aktif sampai ${act.expires_at || '-'}`,
        balance: balance?.balance || 0,
        unlimited: { active: true, expires_at: act.expires_at, days_left: act.days_left },
      })
    }

    db.prepare(`UPDATE ${w.topup} SET status = 'approved', admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(admin_note || '', id)

    // Seavi dikredit dalam token (`tokens`), wallet lain dalam Rupiah. Kalau
    // pembayaran dengan kode unik, user membayar amount_total (nominal + kode);
    // itulah yang dikredit supaya nominal yang masuk = saldo yang masuk.
    const credit =
      w.credit === 'tokens'
        ? Number((topup as any)[w.credit]) || 0
        : Number((topup as any).amount_total) || Number((topup as any)[w.credit]) || 0
    let bal = db.prepare(`SELECT balance FROM ${w.balance} WHERE user_id = ?`).get(topup.user_id) as { balance: number } | undefined
    if (!bal) {
      db.prepare(`INSERT INTO ${w.balance} (user_id, balance) VALUES (?, ?)`).run(topup.user_id, credit)
    } else {
      db.prepare(`UPDATE ${w.balance} SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(credit, topup.user_id)
    }

    const updated = db.prepare(`SELECT balance FROM ${w.balance} WHERE user_id = ?`).get(topup.user_id) as { balance: number }
    try {
      db.prepare("INSERT INTO notifications (title, message, type, target, user_id) VALUES (?, ?, 'success', 'users', ?)").run(
        'Topup Disetujui — Saldo Masuk ✅',
        `Topup kamu senilai Rp ${Number(topup.paid_amount ?? topup.amount_total ?? topup.amount ?? 0).toLocaleString('id-ID')} disetujui. Saldo sudah masuk ke akun kamu.`,
        topup.user_id,
      )
    } catch (e) { console.warn('[adminTopup] Gagal kirim notifikasi topup:', e) }
    res.json({ message: 'Topup approved', balance: updated.balance })
  } catch (error) {
    console.error('Approve topup error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/reject', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const w = resolveWallet(req.body?.provider)
    const { id, admin_note } = req.body
    if (!id) return res.status(400).json({ error: 'Topup id required' })

    const topup = db.prepare(`SELECT * FROM ${w.topup} WHERE id = ? AND status = ?`).get(id, 'pending') as any
    if (!topup) return res.status(404).json({ error: 'Pending topup not found' })

    db.prepare(`UPDATE ${w.topup} SET status = 'rejected', admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(admin_note || '', id)

    res.json({ message: 'Topup rejected' })
  } catch (error) {
    console.error('Reject topup error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/balance/:userId', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const w = resolveWallet(req.query.provider)
    const userId = parseInt(String(req.params.userId), 10)
    let bal = db.prepare(`SELECT balance FROM ${w.balance} WHERE user_id = ?`).get(userId) as { balance: number } | undefined
    if (!bal) bal = { balance: 0 }
    res.json({ balance: bal.balance })
  } catch (error) {
    console.error('Get user balance error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/** Batas penyuntikan saldo manual — anti salah ketik nominal raksasa. */
const INJECT_MAX_RP = 100_000_000
const INJECT_MAX_TOKENS = 100_000

/**
 * Inject saldo langsung oleh admin (di luar alur top-up member) — mis. promo.
 * Hanya provider yang punya dompet member (createpulse/nexabot/seavi) yang bisa
 * di-inject; provider berbasis kunci sendiri tidak punya saldo untuk ditambah.
 * Tabel diambil dari whitelist WALLETS, jadi `provider` tak pernah mentah.
 */
router.post('/inject', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const providerKey = String(req.body?.provider || '')
    if (!(providerKey in WALLETS)) {
      return res.status(400).json({ error: 'Provider ini tidak punya saldo layanan — yang bisa di-inject hanya CreatePulse / NexaBot / PosBot / RunningHub (Rp) atau Seavi (token).' })
    }
    const w = WALLETS[providerKey as WalletKey]
    const isSeavi = providerKey === 'seavi'
    const unit = isSeavi ? 'token' : 'Rp'
    const max = isSeavi ? INJECT_MAX_TOKENS : INJECT_MAX_RP

    const userId = Number(req.body?.user_id)
    const credit = Math.round(Number(req.body?.amount))
    const note = String(req.body?.note || '').trim().slice(0, 300)

    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Member tidak valid' })
    if (!Number.isInteger(credit) || credit <= 0) return res.status(400).json({ error: `Nominal harus bilangan bulat positif (${unit})` })
    if (credit > max) return res.status(400).json({ error: `Nominal terlalu besar (maks ${max.toLocaleString('id-ID')} ${unit})` })

    const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(userId) as { id: number; email: string; name: string } | undefined
    if (!user) return res.status(404).json({ error: 'Member tidak ditemukan' })

    const adminNote = note || 'Inject saldo oleh admin'
    db.transaction(() => {
      const bal = db.prepare(`SELECT balance FROM ${w.balance} WHERE user_id = ?`).get(userId) as { balance: number } | undefined
      if (!bal) db.prepare(`INSERT INTO ${w.balance} (user_id, balance) VALUES (?, ?)`).run(userId, credit)
      else db.prepare(`UPDATE ${w.balance} SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(credit, userId)

      // Jejak audit di tabel topup provider — tampil di riwayat approval admin.
      if (isSeavi) {
        db.prepare(`INSERT INTO ${w.topup} (user_id, amount, tokens, status, proof_note, admin_note) VALUES (?, 0, ?, 'approved', '[inject]', ?)`).run(userId, credit, adminNote)
      } else {
        db.prepare(`INSERT INTO ${w.topup} (user_id, amount, status, proof_note, admin_note) VALUES (?, ?, 'approved', '[inject]', ?)`).run(userId, credit, adminNote)
      }
    })()

    const updated = db.prepare(`SELECT balance FROM ${w.balance} WHERE user_id = ?`).get(userId) as { balance: number }
    res.json({
      message: `Berhasil inject ${credit.toLocaleString('id-ID')} ${unit} ke ${user.name || user.email}`,
      provider: providerKey,
      user_id: userId,
      credited: credit,
      balance: updated.balance,
    })
  } catch (error) {
    console.error('Inject balance error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
