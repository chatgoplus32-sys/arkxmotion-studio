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

// Specific routes FIRST (before /:provider)
router.get('/', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const tokens = db.prepare(
      'SELECT id, provider, name, price, status, created_at FROM tokens WHERE status = ? ORDER BY created_at DESC'
    ).all('available') as Omit<TokenRow, 'token_value'>[]
    res.json({ tokens })
  } catch (error) {
    console.error('List tokens error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/orders/mine', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const rows = db.prepare(`
      SELECT o.*, t.provider, t.name as token_name, t.price
      FROM token_orders o
      JOIN tokens t ON o.token_id = t.id
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC
    `).all(userId) as any[]

    const bulkMap = new Map<string, any>()
    for (const row of rows) {
      const bid = row.bulk_id || `single_${row.id}`
      if (!bulkMap.has(bid)) {
        bulkMap.set(bid, {
          bulk_id: bid,
          provider: row.provider,
          status: row.status,
          created_at: row.created_at,
          token_name: row.token_name,
          total_price: 0,
          count: 0,
        })
      }
      const bulk = bulkMap.get(bid)!
      bulk.total_price += row.price
      bulk.count++
    }

    res.json({ orders: Array.from(bulkMap.values()) })
  } catch (error) {
    console.error('List orders error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/orders/clear', authenticateToken, (_req: AuthRequest, res: Response) => {
  res.status(405).json({ error: 'Use DELETE method' })
})

router.delete('/orders/clear', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const pendingOrders = db.prepare('SELECT token_id FROM token_orders WHERE user_id = ? AND status = ?').all(userId, 'pending') as { token_id: number }[]
    for (const o of pendingOrders) {
      db.prepare('UPDATE tokens SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('available', o.token_id)
    }
    db.prepare('DELETE FROM token_orders WHERE user_id = ?').run(userId)
    res.json({ message: 'Order history cleared' })
  } catch (error) {
    console.error('Clear orders error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/note/:bulkId', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    const { bulkId } = req.params
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const rows = db.prepare(`
      SELECT o.*, t.provider, t.name as token_name, t.token_value, t.price, u.name as user_name
      FROM token_orders o
      JOIN tokens t ON o.token_id = t.id
      JOIN users u ON o.user_id = u.id
      WHERE o.bulk_id = ? AND o.user_id = ? AND o.status = 'confirmed'
      ORDER BY t.id ASC
    `).all(bulkId, userId) as any[]

    if (rows.length === 0) return res.status(404).json({ error: 'Order not found' })

    const provider = rows[0].provider.toUpperCase()
    const userName = rows[0].user_name
    const total = rows.reduce((sum: number, r: any) => sum + r.price, 0)
    const date = new Date(rows[0].created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })

    let note = `akun_Token_${rows[0].provider}_${rows.length}_${new Date().toISOString().replace(/:/g, '-').slice(0, 19)}.txt\n`
    note += `========================================\n`
    note += `  ARKXMotion Studio - Token Purchase Note\n`
    note += `========================================\n\n`
    note += `User      : ${userName}\n`
    note += `Provider  : ${provider}\n`
    note += `Jumlah    : ${rows.length} token\n`
    note += `Total     : Rp ${total.toLocaleString('id-ID')}\n`
    note += `Status    : CONFIRMED\n`
    note += `Tanggal   : ${date}\n\n`
    note += `----------------------------------------\n`
    note += `TOKEN YANG DIBELI:\n`
    note += `----------------------------------------\n\n`

    for (const r of rows) {
      note += `${r.token_value}\n`
    }

    note += `\n========================================\n`
    note += `Terima kasih telah membeli token!\n`
    note += `Gunakan token ini di menu Providers.\n`
    note += `========================================\n`

    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="akun_Token_${rows[0].provider}_${rows.length}_${new Date().toISOString().replace(/:/g, '-').slice(0, 19)}.txt"`)
    res.send(note)
  } catch (error) {
    console.error('Note error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST buy - bulk tokens
router.post('/buy', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { token_ids } = req.body || {}
    if (!token_ids || !Array.isArray(token_ids) || token_ids.length === 0) {
      return res.status(400).json({ error: 'token_ids array is required' })
    }

    const bulkId = `bulk_${userId}_${Date.now()}`
    let successCount = 0

    for (const tid of token_ids) {
      const result = db.prepare("UPDATE tokens SET status = 'sold', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'available'").run(tid)
      if (result.changes > 0) {
        db.prepare('INSERT INTO token_orders (user_id, token_id, status, bulk_id) VALUES (?, ?, ?, ?)').run(userId, tid, 'pending', bulkId)
        successCount++
      }
    }

    if (successCount === 0) return res.status(400).json({ error: 'No tokens available' })
    res.status(201).json({ bulk_id: bulkId, count: successCount, message: `${successCount} tokens ordered` })
  } catch (error) {
    console.error('Buy token error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Parameterized routes LAST
router.get('/:provider', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const { provider } = req.params
    if (!['roboneo', 'framia', 'weavy', 'createpulse'].includes(provider)) {
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

export default router
