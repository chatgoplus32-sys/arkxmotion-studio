import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'

const router = Router()

interface TokenRow {
  id: number
  provider: string
  name: string
  token_value: string
  price: number
  status: string
  created_at: string
}

router.get('/:provider', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const { provider } = req.params

    if (!['roboneo', 'framia', 'weavy'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' })
    }

    const tokens = db.prepare(
      'SELECT id, provider, name, price, status, created_at FROM tokens WHERE provider = ? AND status = ? ORDER BY created_at DESC'
    ).all(provider, 'available') as Omit<TokenRow, 'token_value'>[]

    res.json({ tokens })
  } catch (error) {
    console.error('List tokens error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/:id/buy', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const userId = req.user?.id

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(id) as TokenRow | undefined
    if (!token) {
      return res.status(404).json({ error: 'Token not found' })
    }

    if (token.status !== 'available') {
      return res.status(400).json({ error: 'Token already sold' })
    }

    const existingOrder = db.prepare(
      'SELECT id FROM token_orders WHERE user_id = ? AND token_id = ? AND status = ?'
    ).get(userId, id, 'pending') as { id: number } | undefined

    if (existingOrder) {
      return res.status(400).json({ error: 'You already have a pending order for this token' })
    }

    const result = db.prepare(
      'INSERT INTO token_orders (user_id, token_id, status) VALUES (?, ?, ?)'
    ).run(userId, id, 'pending')

    db.prepare('UPDATE tokens SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('sold', id)

    const order = db.prepare('SELECT * FROM token_orders WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ order, message: 'Order created. Waiting for admin confirmation.' })
  } catch (error) {
    console.error('Buy token error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/orders/mine', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const orders = db.prepare(`
      SELECT o.*, t.provider, t.name as token_name, t.price
      FROM token_orders o
      JOIN tokens t ON o.token_id = t.id
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC
    `).all(userId)

    res.json({ orders })
  } catch (error) {
    console.error('List orders error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
