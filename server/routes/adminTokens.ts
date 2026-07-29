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

    if (provider && ['roboneo', 'framia', 'weavy', 'createpulse'].includes(provider as string)) {
      tokens = db.prepare('SELECT * FROM tokens WHERE provider = ? ORDER BY created_at DESC').all(provider) as TokenRow[]
    } else {
      tokens = db.prepare('SELECT * FROM tokens ORDER BY created_at DESC').all() as TokenRow[]
    }

    res.json({ tokens })
  } catch (error) {
    console.error('List tokens error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { provider, name, token_value, price, tokens: bulkTokens } = req.body

    if (bulkTokens && Array.isArray(bulkTokens)) {
      let created = 0
      for (const t of bulkTokens) {
        try {
          db.prepare('INSERT INTO tokens (provider, name, token_value, price) VALUES (?, ?, ?, ?)').run(provider, t.name, t.token_value, price)
          created++
        } catch {}
      }
      return res.status(201).json({ message: `${created} tokens uploaded`, count: created })
    }

    if (!provider || !['roboneo', 'framia', 'weavy', 'createpulse'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' })
    }
    if (!name || !token_value) {
      return res.status(400).json({ error: 'Name and token_value are required' })
    }

    const result = db.prepare('INSERT INTO tokens (provider, name, token_value, price) VALUES (?, ?, ?, ?)').run(provider, name, token_value, price || 0)
    const token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(result.lastInsertRowid) as TokenRow
    res.status(201).json({ token })
  } catch (error) {
    console.error('Create token error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Orders routes BEFORE /:id to avoid conflict
router.get('/orders', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT o.*, t.provider, t.name as token_name, t.token_value, t.price, u.email as user_email, u.name as user_name
      FROM token_orders o
      JOIN tokens t ON o.token_id = t.id
      JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `).all() as any[]

    const bulkMap = new Map<string, any>()
    for (const row of rows) {
      const bid = row.bulk_id || `single_${row.id}`
      if (!bulkMap.has(bid)) {
        bulkMap.set(bid, {
          bulk_id: bid,
          user_name: row.user_name,
          user_email: row.user_email,
          provider: row.provider,
          status: row.status,
          created_at: row.created_at,
          tokens: [],
          total_price: 0,
        })
      }
      const bulk = bulkMap.get(bid)!
      bulk.tokens.push({ id: row.token_id, name: row.token_name, token_value: row.token_value, price: row.price })
      bulk.total_price += row.price
    }

    res.json({ orders: Array.from(bulkMap.values()) })
  } catch (error) {
    console.error('List orders error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/orders', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { bulk_id, status } = req.body
    if (!bulk_id || !status || !['confirmed', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'bulk_id and valid status required' })
    }

    const orders = db.prepare('SELECT * FROM token_orders WHERE bulk_id = ?').all(bulk_id) as { id: number; token_id: number }[]
    if (orders.length === 0) return res.status(404).json({ error: 'Orders not found' })

    db.prepare('UPDATE token_orders SET status = ? WHERE bulk_id = ?').run(status, bulk_id)

    for (const o of orders) {
      if (status === 'confirmed') {
        db.prepare('UPDATE tokens SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('sold', o.token_id)
      } else if (status === 'rejected') {
        db.prepare('UPDATE tokens SET status = ?, updated_at = CURRENT_timestamp WHERE id = ?').run('available', o.token_id)
      }
    }

    res.json({ message: `Orders ${status}` })
  } catch (error) {
    console.error('Update order error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/orders', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  res.status(405).json({ error: 'Not supported' })
})

// Bulk update price by provider
router.post('/bulk-update-price', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { provider, price, status } = req.body
    if (!provider || price === undefined || price < 0) {
      return res.status(400).json({ error: 'provider and valid price are required' })
    }

    let where = 'provider = ?'
    const params: (string | number)[] = [provider]
    if (status) {
      where += ' AND status = ?'
      params.push(status)
    }

    const result = db.prepare(`UPDATE tokens SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE ${where}`).run(price, ...params)
    res.json({ message: `${result.changes} tokens price updated`, count: result.changes })
  } catch (error) {
    console.error('Bulk update price error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Bulk delete tokens
router.post('/bulk-delete', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { ids, provider, status } = req.body

    let whereClauses: string[] = []
    let params: (string | number)[] = []

    if (ids && Array.isArray(ids) && ids.length > 0) {
      whereClauses.push(`id IN (${ids.map(() => '?').join(',')})`)
      params.push(...ids)
    } else if (provider) {
      whereClauses.push('provider = ?')
      params.push(provider)
      if (status) {
        whereClauses.push('status = ?')
        params.push(status)
      }
    } else {
      return res.status(400).json({ error: 'Provide ids array or provider (+ optional status)' })
    }

    const where = whereClauses.join(' AND ')
    const tokens = db.prepare(`SELECT id FROM tokens WHERE ${where}`).all(...params) as { id: number }[]
    if (tokens.length === 0) return res.status(404).json({ error: 'No tokens found' })

    const tokenIds = tokens.map(t => t.id)
    db.prepare(`DELETE FROM token_orders WHERE token_id IN (${tokenIds.map(() => '?').join(',')})`).run(...tokenIds)
    const result = db.prepare(`DELETE FROM tokens WHERE id IN (${tokenIds.map(() => '?').join(',')})`).run(...tokenIds)

    res.json({ message: `${result.changes} tokens deleted`, count: result.changes })
  } catch (error) {
    console.error('Bulk delete tokens error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Token CRUD routes
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
    if (price !== undefined && price >= 0) { updates.push('price = ?'); values.push(price) }
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

export default router
