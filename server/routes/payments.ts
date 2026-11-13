import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.js'
import {
  getPaymentEmailStatus,
  checkPaymentEmailOnce,
  paymentEmailReady,
} from '../lib/paymentEmailWatcher.js'
import { QRIS_TABLES } from '../lib/qrisPayment.js'

/**
 * Panel kontrol verifikasi pembayaran QRIS manual — status koneksi email,
 * trigger cek manual, dan jejak audit pencocokan nominal.
 */
const router = Router()

router.get('/status', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const email = getPaymentEmailStatus()

    // Antrean pending per tabel + yang sudah dibayar menunggu approve.
    const queues = QRIS_TABLES.map((t) => {
      const pending = db.prepare(`SELECT COUNT(*) AS n FROM ${t.table} WHERE status = 'pending'`).get() as { n: number }
      const awaiting = db.prepare(
        `SELECT COUNT(*) AS n FROM ${t.table} WHERE status = 'pending' AND paid_at IS NOT NULL`,
      ).get() as { n: number }
      const verified24h = db.prepare(
        `SELECT COUNT(*) AS n FROM ${t.table} WHERE paid_at >= datetime('now', '-24 hours')`,
      ).get() as { n: number }
      return { table: t.table, label: t.label, pending: pending.n, awaiting_admin: awaiting.n, verified_24h: verified24h.n }
    })

    const unmatched = db.prepare(
      "SELECT COUNT(*) AS n FROM payment_verify_log WHERE action IN ('no_match', 'no_amount') AND created_at >= datetime('now', '-24 hours')",
    ).get() as { n: number }

    res.json({ email, ready: paymentEmailReady(), queues, unmatched_24h: unmatched.n })
  } catch (error) {
    console.error('Payment status error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/check-now', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    if (!paymentEmailReady()) {
      return res.status(400).json({ error: 'Email verifikasi belum dikonfigurasi — isi PAYMENT_IMAP_* di .env' })
    }
    const result = await checkPaymentEmailOnce()
    res.json({ ok: !result.error, ...result })
  } catch (error) {
    console.error('Payment check-now error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/log', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
    const log = db.prepare('SELECT * FROM payment_verify_log ORDER BY created_at DESC LIMIT ?').all(limit)
    res.json({ log })
  } catch (error) {
    console.error('Payment log error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
