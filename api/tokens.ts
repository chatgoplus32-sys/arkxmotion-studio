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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function verifyUser(req: VercelRequest): { id: number; email: string; role: string } | null {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return null
  try {
    return jwt.verify(token, JWT_SECRET) as { id: number; email: string; role: string }
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = verifyUser(req)
  if (!user) return res.status(403).json({ error: 'Access denied' })

  try {
    const sql = getSql()
    const urlPath = req.url?.split('?')[0] || ''
    const segments = urlPath.split('/').filter(Boolean)

    // GET /api/tokens?provider=roboneo - list available tokens
    if (req.method === 'GET' && segments[segments.length - 1] === 'tokens') {
      const provider = req.query.provider as string | undefined
      if (provider && ['roboneo', 'framia', 'weavy'].includes(provider)) {
        const rows = await sql`SELECT id, provider, name, price, status, created_at FROM tokens WHERE provider = ${provider} AND status = 'available' ORDER BY created_at DESC`
        return res.status(200).json({ tokens: rows })
      }
      const rows = await sql`SELECT id, provider, name, price, status, created_at FROM tokens WHERE status = 'available' ORDER BY created_at DESC`
      return res.status(200).json({ tokens: rows })
    }

    // POST /api/tokens/buy - buy token
    if (req.method === 'POST' && segments.includes('buy')) {
      const { token_id } = req.body || {}
      if (!token_id) return res.status(400).json({ error: 'token_id is required' })

      const rows = await sql`SELECT * FROM tokens WHERE id = ${token_id}`
      const token = rows[0]
      if (!token) return res.status(404).json({ error: 'Token not found' })
      if (token.status !== 'available') return res.status(400).json({ error: 'Token already sold' })

      const existing = await sql`SELECT id FROM token_orders WHERE user_id = ${user.id} AND token_id = ${token_id} AND status = 'pending'`
      if (existing.length > 0) return res.status(400).json({ error: 'Pending order already exists' })

      await sql`UPDATE tokens SET status = 'sold', updated_at = CURRENT_TIMESTAMP WHERE id = ${token_id}`
      const orderRows = await sql`INSERT INTO token_orders (user_id, token_id, status) VALUES (${user.id}, ${token_id}, 'pending') RETURNING *`

      return res.status(201).json({ order: orderRows[0], message: 'Order created' })
    }

    // GET /api/tokens/orders/mine - user's order history
    if (req.method === 'GET' && segments.includes('mine')) {
      const rows = await sql`
        SELECT o.*, t.provider, t.name as token_name, t.price
        FROM token_orders o
        JOIN tokens t ON o.token_id = t.id
        WHERE o.user_id = ${user.id}
        ORDER BY o.created_at DESC
      `
      return res.status(200).json({ orders: rows })
    }

    return res.status(404).json({ error: 'Not found' })
  } catch (err: any) {
    console.error('Tokens error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
