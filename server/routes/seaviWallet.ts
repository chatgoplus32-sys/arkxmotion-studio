import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import { SEAVI_MIN_TOPUP, SEAVI_PACKAGES, SEAVI_TOKEN_PRICE, findSeaviPackage, getSeaviCharge } from '../../shared/pricing.js'

const router = Router()

router.get('/balance', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    let row = db.prepare('SELECT balance FROM seavi_balance WHERE user_id = ?').get(userId) as { balance: number } | undefined
    if (!row) {
      db.prepare('INSERT INTO seavi_balance (user_id, balance) VALUES (?, 0)').run(userId)
      row = { balance: 0 }
    }
    res.json({
      balance: row.balance,
      tokens: row.balance,
      packages: SEAVI_PACKAGES,
      min_topup: SEAVI_MIN_TOPUP,
      token_price: SEAVI_TOKEN_PRICE,
    })
  } catch (error) {
    console.error('Get seavi balance error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/topup', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { package_slug, proof_note } = req.body
    const plan = findSeaviPackage(package_slug)
    if (!plan) {
      return res.status(400).json({ error: 'Paket tidak dikenal. Pilih 2–5 Token (Rp 4.000–Rp 10.000).' })
    }
    if (plan.price < SEAVI_MIN_TOPUP) {
      return res.status(400).json({ error: `Minimal topup Rp ${SEAVI_MIN_TOPUP.toLocaleString('id-ID')}` })
    }

    const result = db.prepare(
      'INSERT INTO seavi_topup (user_id, amount, tokens, package_slug, proof_note, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, plan.price, plan.tokens, plan.slug, proof_note || '', 'pending')

    const topup = db.prepare('SELECT * FROM seavi_topup WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ topup, message: 'Topup request submitted, waiting admin approval' })
  } catch (error) {
    console.error('Seavi topup error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/topups/mine', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const topups = db.prepare(
      'SELECT * FROM seavi_topup WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId)
    res.json({ topups })
  } catch (error) {
    console.error('List my seavi topups error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/deduct', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { model, quantity, batch_id } = req.body
    // Tarif per model (token) ada di shared/pricing.ts — sama dengan yang
    // dipakai endpoint publik /api/public/pricing, jadi angka yang
    // ditampilkan ke user tidak bisa berbeda dari yang dipotong di sini.
    const units = Math.max(1, Math.min(50, Number(quantity) || 1))
    const cost = getSeaviCharge(model) * units

    let row = db.prepare('SELECT balance FROM seavi_balance WHERE user_id = ?').get(userId) as { balance: number } | undefined
    if (!row) {
      db.prepare('INSERT INTO seavi_balance (user_id, balance) VALUES (?, 0)').run(userId)
      row = { balance: 0 }
    }

    if (row.balance < cost) {
      return res.status(400).json({ error: 'Token Seavi tidak cukup', balance: row.balance, tokens: row.balance, required: cost })
    }

    db.prepare('UPDATE seavi_balance SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(cost, userId)
    db.prepare('INSERT INTO seavi_usage (user_id, model, cost, batch_id, status) VALUES (?, ?, ?, ?, ?)').run(userId, model || '', cost, batch_id || '', 'used')

    const updated = db.prepare('SELECT balance FROM seavi_balance WHERE user_id = ?').get(userId) as { balance: number }
    res.json({ balance: updated.balance, tokens: updated.balance, deducted: cost })
  } catch (error) {
    console.error('Seavi deduct error:', error)
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
        "SELECT * FROM seavi_usage WHERE user_id = ? AND batch_id = ? AND status = 'used'"
      ).get(userId, batch_id) as { id: number; cost: number } | undefined
    } else if (model) {
      usage = db.prepare(
        "SELECT * FROM seavi_usage WHERE user_id = ? AND model = ? AND status = 'used' ORDER BY id DESC LIMIT 1"
      ).get(userId, model) as { id: number; cost: number } | undefined
    }

    if (!usage) return res.status(404).json({ error: 'Usage not found' })

    db.prepare('UPDATE seavi_usage SET status = ? WHERE id = ?').run('refunded', usage.id)
    db.prepare('UPDATE seavi_balance SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(usage.cost, userId)

    const updated = db.prepare('SELECT balance FROM seavi_balance WHERE user_id = ?').get(userId) as { balance: number }
    res.json({ balance: updated.balance, tokens: updated.balance, refunded: usage.cost })
  } catch (error) {
    console.error('Seavi refund error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
