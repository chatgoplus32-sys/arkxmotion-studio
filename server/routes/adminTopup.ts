import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.js'

const router = Router()

router.get('/pending', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const topups = db.prepare(`
      SELECT t.*, u.email, u.name as user_name
      FROM createpulse_topup t
      JOIN users u ON t.user_id = u.id
      WHERE t.status = 'pending'
      ORDER BY t.created_at ASC
    `).all()
    res.json({ topups })
  } catch (error) {
    console.error('List pending topups error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/all', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const topups = db.prepare(`
      SELECT t.*, u.email, u.name as user_name
      FROM createpulse_topup t
      JOIN users u ON t.user_id = u.id
      ORDER BY t.created_at DESC
    `).all()
    res.json({ topups })
  } catch (error) {
    console.error('List all topups error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/approve', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { id, admin_note } = req.body
    if (!id) return res.status(400).json({ error: 'Topup id required' })

    const topup = db.prepare('SELECT * FROM createpulse_topup WHERE id = ? AND status = ?').get(id, 'pending') as any
    if (!topup) return res.status(404).json({ error: 'Pending topup not found' })

    db.prepare("UPDATE createpulse_topup SET status = 'approved', admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(admin_note || '', id)

    let bal = db.prepare('SELECT balance FROM createpulse_balance WHERE user_id = ?').get(topup.user_id) as { balance: number } | undefined
    if (!bal) {
      db.prepare('INSERT INTO createpulse_balance (user_id, balance) VALUES (?, ?)').run(topup.user_id, topup.amount)
    } else {
      db.prepare('UPDATE createpulse_balance SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(topup.amount, topup.user_id)
    }

    const updated = db.prepare('SELECT balance FROM createpulse_balance WHERE user_id = ?').get(topup.user_id) as { balance: number }
    res.json({ message: 'Topup approved', balance: updated.balance })
  } catch (error) {
    console.error('Approve topup error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/reject', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { id, admin_note } = req.body
    if (!id) return res.status(400).json({ error: 'Topup id required' })

    const topup = db.prepare('SELECT * FROM createpulse_topup WHERE id = ? AND status = ?').get(id, 'pending') as any
    if (!topup) return res.status(404).json({ error: 'Pending topup not found' })

    db.prepare("UPDATE createpulse_topup SET status = 'rejected', admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(admin_note || '', id)

    res.json({ message: 'Topup rejected' })
  } catch (error) {
    console.error('Reject topup error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/balance/:userId', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const userId = parseInt(req.params.userId)
    let bal = db.prepare('SELECT balance FROM createpulse_balance WHERE user_id = ?').get(userId) as { balance: number } | undefined
    if (!bal) bal = { balance: 0 }
    res.json({ balance: bal.balance })
  } catch (error) {
    console.error('Get user balance error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
