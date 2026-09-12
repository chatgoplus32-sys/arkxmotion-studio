import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.js'

const router = Router()

/**
 * Peta tabel wallet per provider. Nama tabel TIDAK pernah diambil mentah dari
 * request — hanya dipilih dari daftar putih ini, jadi tidak ada jalan untuk
 * menyuntik nama tabel lewat parameter `provider`.
 */
const WALLETS = {
  createpulse: { topup: 'createpulse_topup', balance: 'createpulse_balance' },
  nexabot: { topup: 'nexabot_topup', balance: 'nexabot_balance' },
} as const
type WalletKey = keyof typeof WALLETS

function resolveWallet(value: unknown): (typeof WALLETS)[WalletKey] {
  const key = String(value || 'createpulse')
  return key in WALLETS ? WALLETS[key as WalletKey] : WALLETS.createpulse
}

/** Sisa hari dari DATETIME SQLite (UTC yang disimpan tanpa penanda zona). */
function remainingDays(expiresAt: string | null | undefined): number {
  if (!expiresAt) return 0
  const end = new Date(expiresAt.replace(' ', 'T') + 'Z').getTime()
  if (!Number.isFinite(end)) return 0
  return Math.max(0, Math.ceil((end - Date.now()) / 86400000))
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
    // saldo. Kalau paket sebelumnya masih jalan, masa berlakunya ditumpuk
    // (mulai dari expiry terlama, bukan dari sekarang) supaya user tidak
    // kehilangan sisa hari.
    if (topup.kind === 'unlimited') {
      const days = Number(topup.days) || 7
      // Base masa berlaku = expiry TERJAUH yang sudah disetujui untuk user ini,
      // bukan expiry baris ini (saat pengajuan `expires_at` baris ini masih
      // NULL). Tanpa ini, beli paket baru saat paket lama masih jalan akan
      // menghanguskan sisa harinya, padahal UI menjanjikan ditumpuk.
      const priorExpiry = (db.prepare(`
        SELECT MAX(expires_at) AS expires_at FROM ${w.topup}
        WHERE user_id = ? AND kind = 'unlimited' AND status = 'approved' AND id <> ?
      `).get(topup.user_id, id) as { expires_at: string | null } | undefined)?.expires_at || null

      db.prepare(`
        UPDATE ${w.topup}
        SET status = 'approved',
            admin_note = ?,
            started_at = datetime('now'),
            expires_at = datetime(MAX(COALESCE(?, datetime('now')), datetime('now')), ?),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(admin_note || '', priorExpiry, `+${days} days`, id)

      const activated = db.prepare(`SELECT expires_at FROM ${w.topup} WHERE id = ?`).get(id) as { expires_at: string } | undefined
      const balance = db.prepare(`SELECT balance FROM ${w.balance} WHERE user_id = ?`).get(topup.user_id) as { balance: number } | undefined
      return res.json({
        message: `Paket Unlimited ${days} hari aktif sampai ${activated?.expires_at || '-'}`,
        balance: balance?.balance || 0,
        // days_left = sisa hari SETELAH penumpukan, bukan jumlah hari yang baru
        // dibeli, supaya admin melihat masa berlaku yang sebenarnya.
        unlimited: { active: true, expires_at: activated?.expires_at || null, days_left: remainingDays(activated?.expires_at) },
      })
    }

    db.prepare(`UPDATE ${w.topup} SET status = 'approved', admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(admin_note || '', id)

    let bal = db.prepare(`SELECT balance FROM ${w.balance} WHERE user_id = ?`).get(topup.user_id) as { balance: number } | undefined
    if (!bal) {
      db.prepare(`INSERT INTO ${w.balance} (user_id, balance) VALUES (?, ?)`).run(topup.user_id, topup.amount)
    } else {
      db.prepare(`UPDATE ${w.balance} SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(topup.amount, topup.user_id)
    }

    const updated = db.prepare(`SELECT balance FROM ${w.balance} WHERE user_id = ?`).get(topup.user_id) as { balance: number }
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

export default router
