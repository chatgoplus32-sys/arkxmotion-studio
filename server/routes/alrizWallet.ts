// ─── Wallet Alriz (Express + SQLite) ───────────────────────────────────────
// Pola sama dengan CreatePulse/NexaBot: saldo Rp per user, top up
// Rp 5.000–100.000 diajukan → admin approve → kredit 1:1. Generate Motion
// Control memotong harga model per video lewat /deduct (angka dari
// shared/pricing.ts, bukan dari klien) dan mengembalikan lewat /refund kalau
// job upstream gagal / kehabisan kapasitas.
//
// Versi Vercel (api/alriz-wallet.ts) adalah cermin dari router ini.
import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import {
  ALRIZ_MIN_TOPUP,
  ALRIZ_MAX_TOPUP,
  ALRIZ_NOMINALS,
  ALRIZ_MODEL_PRICES,
  ALRIZ_DEFAULT_PRICE,
  isValidAlrizTopup,
  getAlrizCharge,
} from '../../shared/pricing.js'

const router = Router()

router.get('/balance', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    let row = db.prepare('SELECT balance FROM alriz_balance WHERE user_id = ?').get(userId) as { balance: number } | undefined
    if (!row) {
      db.prepare('INSERT INTO alriz_balance (user_id, balance) VALUES (?, 0)').run(userId)
      row = { balance: 0 }
    }
    res.json({
      balance: row.balance,
      min_topup: ALRIZ_MIN_TOPUP,
      max_topup: ALRIZ_MAX_TOPUP,
      nominals: ALRIZ_NOMINALS,
      models: { ...ALRIZ_MODEL_PRICES },
      default_price: ALRIZ_DEFAULT_PRICE,
    })
  } catch (error) {
    console.error('Get alriz balance error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/topup', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { amount, proof_note } = req.body
    if (!isValidAlrizTopup(amount)) {
      return res.status(400).json({
        error: `Nominal top up Rp ${ALRIZ_MIN_TOPUP.toLocaleString('id-ID')}–Rp ${ALRIZ_MAX_TOPUP.toLocaleString('id-ID')}`,
        min_topup: ALRIZ_MIN_TOPUP,
        max_topup: ALRIZ_MAX_TOPUP,
      })
    }

    const result = db.prepare(
      'INSERT INTO alriz_topup (user_id, amount, proof_note, status) VALUES (?, ?, ?, ?)'
    ).run(userId, Number(amount), proof_note || '', 'pending')

    const topup = db.prepare('SELECT * FROM alriz_topup WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ topup, message: 'Topup request submitted, waiting admin approval' })
  } catch (error) {
    console.error('Alriz topup error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/topups/mine', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const topups = db.prepare(
      'SELECT * FROM alriz_topup WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId)
    res.json({ topups })
  } catch (error) {
    console.error('List my alriz topups error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/deduct', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { model, quantity, batch_id } = req.body
    // Tarif per model (Rp) ada di shared/pricing.ts — sama dengan yang
    // dipakai /api/public/pricing, jadi angka yang ditampilkan ke user tidak
    // bisa berbeda dari yang dipotong di sini.
    const units = Math.max(1, Math.min(50, Number(quantity) || 1))
    const cost = getAlrizCharge(model) * units

    let row = db.prepare('SELECT balance FROM alriz_balance WHERE user_id = ?').get(userId) as { balance: number } | undefined
    if (!row) {
      db.prepare('INSERT INTO alriz_balance (user_id, balance) VALUES (?, 0)').run(userId)
      row = { balance: 0 }
    }

    if (row.balance < cost) {
      return res.status(400).json({
        error: `Saldo Alriz tidak cukup (butuh Rp ${cost.toLocaleString('id-ID')})`,
        balance: row.balance,
        required: cost,
      })
    }

    db.prepare('UPDATE alriz_balance SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(cost, userId)
    db.prepare('INSERT INTO alriz_usage (user_id, model, cost, batch_id, status) VALUES (?, ?, ?, ?, ?)').run(userId, model || '', cost, batch_id || '', 'used')

    const updated = db.prepare('SELECT balance FROM alriz_balance WHERE user_id = ?').get(userId) as { balance: number }
    res.json({ balance: updated.balance, deducted: cost })
  } catch (error) {
    console.error('Alriz deduct error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/refund', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { batch_id, model } = req.body

    let usage
    if (batch_id) {
      usage = db.prepare(
        "SELECT * FROM alriz_usage WHERE user_id = ? AND batch_id = ? AND status = 'used'"
      ).get(userId, batch_id) as { id: number; cost: number } | undefined
    } else if (model) {
      usage = db.prepare(
        "SELECT * FROM alriz_usage WHERE user_id = ? AND model = ? AND status = 'used' ORDER BY id DESC LIMIT 1"
      ).get(userId, model) as { id: number; cost: number } | undefined
    }

    if (!usage) return res.status(404).json({ error: 'Usage not found' })

    db.prepare('UPDATE alriz_usage SET status = ? WHERE id = ?').run('refunded', usage.id)
    db.prepare('UPDATE alriz_balance SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(usage.cost, userId)

    const updated = db.prepare('SELECT balance FROM alriz_balance WHERE user_id = ?').get(userId) as { balance: number }
    res.json({ balance: updated.balance, refunded: usage.cost })
  } catch (error) {
    console.error('Alriz refund error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
