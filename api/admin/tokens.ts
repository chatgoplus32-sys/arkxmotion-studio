import type { VercelRequest, VercelResponse } from '@vercel/node'
import jwt from 'jsonwebtoken'
import { neon } from '@neondatabase/serverless'

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return neon(url)
}

const JWT_SECRET = process.env.JWT_SECRET || 'arkxmotion-studio-secret-key-2026'

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function verifyAdmin(req: VercelRequest): { id: number; email: string; role: string } | null {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return null
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: number; email: string; role: string }
    return decoded.role === 'admin' ? decoded : null
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const admin = verifyAdmin(req)
  if (!admin) return res.status(403).json({ error: 'Admin access required' })

  try {
    const sql = getSql()
    const urlPath = req.url?.split('?')[0] || ''
    const segments = urlPath.split('/').filter(Boolean)

    // GET /api/admin/tokens or /api/admin/tokens?provider=roboneo
    if (req.method === 'GET' && segments[segments.length - 1] === 'tokens') {
      const provider = req.query.provider as string | undefined
      if (provider && ['roboneo', 'framia', 'weavy'].includes(provider)) {
        const rows = await sql`SELECT * FROM tokens WHERE provider = ${provider} ORDER BY created_at DESC`
        return res.status(200).json({ tokens: rows })
      }
      const rows = await sql`SELECT * FROM tokens ORDER BY created_at DESC`
      return res.status(200).json({ tokens: rows })
    }

    // POST /api/admin/tokens - create single or bulk
    if (req.method === 'POST' && segments[segments.length - 1] === 'tokens') {
      const { provider, name, token_value, price, tokens: bulkTokens } = req.body || {}

      // Bulk upload
      if (bulkTokens && Array.isArray(bulkTokens)) {
        let created = 0
        for (const t of bulkTokens) {
          try {
            await sql`INSERT INTO tokens (provider, name, token_value, price) VALUES (${provider}, ${t.name}, ${t.token_value}, ${price})`
            created++
          } catch {}
        }
        return res.status(201).json({ message: `${created} tokens uploaded`, count: created })
      }

      // Single upload
      if (!provider || !['roboneo', 'framia', 'weavy'].includes(provider)) {
        return res.status(400).json({ error: 'Invalid provider' })
      }
      if (!name || !token_value) {
        return res.status(400).json({ error: 'Name and token_value are required' })
      }
      if (price === undefined || price < 0) {
        return res.status(400).json({ error: 'Valid price is required' })
      }

      const rows = await sql`INSERT INTO tokens (provider, name, token_value, price) VALUES (${provider}, ${name}, ${token_value}, ${price}) RETURNING *`
      return res.status(201).json({ token: rows[0] })
    }

    // PATCH /api/admin/tokens - update token
    if (req.method === 'PATCH' && segments[segments.length - 1] === 'tokens') {
      const { id, name, token_value, price, status } = req.body || {}
      if (!id) return res.status(400).json({ error: 'Token id is required' })

      if (status && ['available', 'sold'].includes(status)) {
        await sql`UPDATE tokens SET status = ${status}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
      }
      if (name) {
        await sql`UPDATE tokens SET name = ${name}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
      }
      if (token_value) {
        await sql`UPDATE tokens SET token_value = ${token_value}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
      }
      if (price !== undefined) {
        await sql`UPDATE tokens SET price = ${price}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
      }

      const rows = await sql`SELECT * FROM tokens WHERE id = ${id}`
      return res.status(200).json({ token: rows[0] })
    }

    // DELETE /api/admin/tokens/:id - delete single token
    if (req.method === 'DELETE' && segments.includes('tokens')) {
      const idFromUrl = segments[segments.length - 1]
      const idFromBody = req.body?.id || req.query?.id
      const id = idFromBody || (idFromUrl && idFromUrl !== 'tokens' ? idFromUrl : null)
      if (!id) return res.status(400).json({ error: 'Token id is required' })

      await sql`DELETE FROM token_orders WHERE token_id = ${id}`
      await sql`DELETE FROM tokens WHERE id = ${id}`
      return res.status(200).json({ message: 'Token deleted' })
    }

    // POST /api/admin/tokens/bulk-delete - bulk delete tokens
    if (req.method === 'POST' && segments.includes('bulk-delete')) {
      const { ids, provider, status } = req.body || {}

      let tokens: { id: number }[] = []

      if (ids && Array.isArray(ids) && ids.length > 0) {
        tokens = await sql`SELECT id FROM tokens WHERE id = ANY(${ids})`
      } else if (provider) {
        if (status) {
          tokens = await sql`SELECT id FROM tokens WHERE provider = ${provider} AND status = ${status}`
        } else {
          tokens = await sql`SELECT id FROM tokens WHERE provider = ${provider}`
        }
      } else {
        return res.status(400).json({ error: 'Provide ids array or provider (+ optional status)' })
      }

      if (tokens.length === 0) return res.status(404).json({ error: 'No tokens found' })

      const tokenIds = tokens.map(t => t.id)
      await sql`DELETE FROM token_orders WHERE token_id = ANY(${tokenIds})`
      const result = await sql`DELETE FROM tokens WHERE id = ANY(${tokenIds})`

      return res.status(200).json({ message: `${tokens.length} tokens deleted`, count: tokens.length })
    }

    // GET /api/admin/tokens/orders - list all orders grouped by bulk_id
    if (req.method === 'GET' && segments.includes('orders')) {
      const rows = await sql`
        SELECT o.*, t.provider, t.name as token_name, t.token_value, t.price, u.email as user_email, u.name as user_name
        FROM token_orders o
        JOIN tokens t ON o.token_id = t.id
        JOIN users u ON o.user_id = u.id
        ORDER BY o.created_at DESC
      `

      // Group by bulk_id
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

      return res.status(200).json({ orders: Array.from(bulkMap.values()) })
    }

    // PATCH /api/admin/tokens/orders - confirm/reject order by bulk_id
    if (req.method === 'PATCH' && segments.includes('orders')) {
      const { id, bulk_id, status } = req.body || {}
      if (!status || !['confirmed', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' })
      }

      const targetBulkId = bulk_id || ''
      if (!targetBulkId) {
        return res.status(400).json({ error: 'bulk_id is required' })
      }

      const orders = await sql`SELECT * FROM token_orders WHERE bulk_id = ${targetBulkId}`
      if (orders.length === 0) return res.status(404).json({ error: 'Orders not found' })

      await sql`UPDATE token_orders SET status = ${status} WHERE bulk_id = ${targetBulkId}`

      if (status === 'confirmed') {
        for (const o of orders) {
          await sql`UPDATE tokens SET status = 'sold', updated_at = CURRENT_TIMESTAMP WHERE id = ${o.token_id}`
        }
      } else if (status === 'rejected') {
        for (const o of orders) {
          await sql`UPDATE tokens SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = ${o.token_id}`
        }
      }

      return res.status(200).json({ message: `Orders ${status}` })
    }

    return res.status(404).json({ error: 'Not found' })
  } catch (err: any) {
    console.error('Admin tokens error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
