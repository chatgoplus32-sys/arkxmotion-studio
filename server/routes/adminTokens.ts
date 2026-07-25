import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.js'

const router = Router()

interface TokenRow {
  id: number
  provider: string
  name: string
  token_value: string
  price: number
  status: string
  created_at: string
  updated_at: string
}

router.get('/', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { provider } = req.query
    let tokens: TokenRow[]

    if (provider && ['roboneo', 'framia', 'weavy'].includes(provider as string)) {
      tokens = db.prepare(
        'SELECT * FROM tokens WHERE provider = ? ORDER BY created_at DESC'
      ).all(provider) as TokenRow[]
    } else {
      tokens = db.prepare(
        'SELECT * FROM tokens ORDER BY created_at DESC'
      ).all() as TokenRow[]
    }

    res.json({ tokens })
  } catch (error) {
    console.error('List tokens error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { provider, name, token_value, price } = req.body

    if (!provider || !['roboneo', 'framia', 'weavy'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider. Must be roboneo, framia, or weavy' })
    }
    if (!name || !token_value) {
      return res.status(400).json({ error: 'Name and token_value are required' })
    }
    if (price === undefined || price < 0) {
      return res.status(400).json({ error: 'Valid price is required' })
    }

    const result = db.prepare(
      'INSERT INTO tokens (provider, name, token_value, price) VALUES (?, ?, ?, ?)'
    ).run(provider, name, token_value, price)

    const token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(result.lastInsertRowid) as TokenRow
    res.status(201).json({ token })
  } catch (error) {
    console.error('Create token error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/:id', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const { name, token_value, price, status } = req.body

    const existing = db.prepare('SELECT * FROM tokens WHERE id = ?').get(id) as TokenRow | undefined
    if (!existing) {
      return res.status(404).json({ error: 'Token not found' })
    }

    const updates: string[] = []
    const values: (string | number)[] = []

    if (name !== undefined) { updates.push('name = ?'); values.push(name) }
    if (token_value !== undefined) { updates.push('token_value = ?'); values.push(token_value) }
    if (price !== undefined) { updates.push('price = ?'); values.push(price) }
    if (status !== undefined && ['available', 'sold'].includes(status)) {
      updates.push('status = ?'); values.push(status)
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    updates.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)

    db.prepare(`UPDATE tokens SET ${updates.join(', ')} WHERE id = ?`).run(...values)

    const updated = db.prepare('SELECT * FROM tokens WHERE id = ?').get(id) as TokenRow
    res.json({ token: updated })
  } catch (error) {
    console.error('Update token error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/:id', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params

    const existing = db.prepare('SELECT * FROM tokens WHERE id = ?').get(id) as TokenRow | undefined
    if (!existing) {
      return res.status(404).json({ error: 'Token not found' })
    }

    db.prepare('DELETE FROM token_orders WHERE token_id = ?').run(id)
    db.prepare('DELETE FROM tokens WHERE id = ?').run(id)

    res.json({ message: 'Token deleted successfully' })
  } catch (error) {
    console.error('Delete token error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/orders', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const orders = db.prepare(`
      SELECT o.*, t.provider, t.name as token_name, t.token_value, t.price, u.email as user_email, u.name as user_name
      FROM token_orders o
      JOIN tokens t ON o.token_id = t.id
      JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `).all()

    res.json({ orders })
  } catch (error) {
    console.error('List orders error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/orders/:id', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const { status } = req.body

    if (!status || !['confirmed', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' })
    }

    const order = db.prepare('SELECT * FROM token_orders WHERE id = ?').get(id) as { id: number; token_id: number; status: string } | undefined
    if (!order) {
      return res.status(404).json({ error: 'Order not found' })
    }

    db.prepare('UPDATE token_orders SET status = ? WHERE id = ?').run(status, id)

    if (status === 'confirmed') {
      db.prepare('UPDATE tokens SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('sold', order.token_id)
    }

    res.json({ message: `Order ${status}` })
  } catch (error) {
    console.error('Update order error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
