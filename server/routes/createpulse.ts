import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'

const router = Router()

router.get('/balance', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    let row = db.prepare('SELECT balance FROM createpulse_balance WHERE user_id = ?').get(userId) as { balance: number } | undefined
    if (!row) {
      db.prepare('INSERT INTO createpulse_balance (user_id, balance) VALUES (?, 0)').run(userId)
      row = { balance: 0 }
    }
    res.json({ balance: row.balance })
  } catch (error) {
    console.error('Get balance error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/topup', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { amount, proof_note } = req.body
    if (!amount || amount < 10000) {
      return res.status(400).json({ error: 'Minimal topup Rp 10.000' })
    }

    const result = db.prepare(
      'INSERT INTO createpulse_topup (user_id, amount, proof_note, status) VALUES (?, ?, ?, ?)'
    ).run(userId, amount, proof_note || '', 'pending')

    const topup = db.prepare('SELECT * FROM createpulse_topup WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ topup, message: 'Topup request submitted, waiting admin approval' })
  } catch (error) {
    console.error('Topup error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/topups/mine', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const topups = db.prepare(
      'SELECT * FROM createpulse_topup WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId)
    res.json({ topups })
  } catch (error) {
    console.error('List my topups error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/deduct', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { model, batch_id } = req.body
    const cost = 1500

    let row = db.prepare('SELECT balance FROM createpulse_balance WHERE user_id = ?').get(userId) as { balance: number } | undefined
    if (!row) {
      db.prepare('INSERT INTO createpulse_balance (user_id, balance) VALUES (?, 0)').run(userId)
      row = { balance: 0 }
    }

    if (row.balance < cost) {
      return res.status(400).json({ error: 'Saldo tidak cukup', balance: row.balance, required: cost })
    }

    db.prepare('UPDATE createpulse_balance SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(cost, userId)
    db.prepare('INSERT INTO createpulse_usage (user_id, model, cost, batch_id, status) VALUES (?, ?, ?, ?, ?)').run(userId, model, cost, batch_id || '', 'used')

    const updated = db.prepare('SELECT balance FROM createpulse_balance WHERE user_id = ?').get(userId) as { balance: number }
    res.json({ balance: updated.balance, deducted: cost })
  } catch (error) {
    console.error('Deduct error:', error)
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
        "SELECT * FROM createpulse_usage WHERE user_id = ? AND batch_id = ? AND status = 'used'"
      ).get(userId, batch_id) as { id: number; cost: number } | undefined
    } else if (model) {
      usage = db.prepare(
        "SELECT * FROM createpulse_usage WHERE user_id = ? AND model = ? AND status = 'used' ORDER BY id DESC LIMIT 1"
      ).get(userId, model) as { id: number; cost: number } | undefined
    }

    if (!usage) return res.status(404).json({ error: 'Usage not found' })

    db.prepare('UPDATE createpulse_usage SET status = ? WHERE id = ?').run('refunded', usage.id)
    db.prepare('UPDATE createpulse_balance SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(usage.cost, userId)

    const updated = db.prepare('SELECT balance FROM createpulse_balance WHERE user_id = ?').get(userId) as { balance: number }
    res.json({ balance: updated.balance, refunded: usage.cost })
  } catch (error) {
    console.error('Refund error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
