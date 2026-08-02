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
      if (provider && ['roboneo', 'framia', 'weavy', 'createpulse'].includes(provider)) {
        const rows = await sql`SELECT id, provider, name, price, credits, credit_group, status, created_at FROM tokens WHERE provider = ${provider} AND status = 'available' ORDER BY created_at DESC`
        return res.status(200).json({ tokens: rows })
      }
      const rows = await sql`SELECT id, provider, name, price, credits, credit_group, status, created_at FROM tokens WHERE status = 'available' ORDER BY created_at DESC`
      return res.status(200).json({ tokens: rows })
    }

    // POST /api/tokens/buy - buy multiple tokens at once
    if (req.method === 'POST' && segments.includes('buy')) {
      const { token_ids } = req.body || {}
      if (!token_ids || !Array.isArray(token_ids) || token_ids.length === 0) {
        return res.status(400).json({ error: 'token_ids array is required' })
      }

      const bulkId = `bulk_${user.id}_${Date.now()}`
      let successCount = 0

      // Atomic: mark as sold only if still available
      for (const tid of token_ids) {
        // Check if token is available first
        const tokenCheck = await sql`SELECT id, status FROM tokens WHERE id = ${tid}`
        if (tokenCheck.length > 0 && tokenCheck[0].status === 'available') {
          // Mark as sold
          await sql`UPDATE tokens SET status = 'sold', updated_at = CURRENT_TIMESTAMP WHERE id = ${tid} AND status = 'available'`
          // Verify it was updated
          const verify = await sql`SELECT status FROM tokens WHERE id = ${tid}`
          if (verify.length > 0 && verify[0].status === 'sold') {
            await sql`INSERT INTO token_orders (user_id, token_id, status, bulk_id) VALUES (${user.id}, ${tid}, 'pending', ${bulkId})`
            successCount++
          }
        }
      }

      if (successCount === 0) {
        return res.status(400).json({ error: 'No tokens available' })
      }

      return res.status(201).json({ bulk_id: bulkId, count: successCount, message: `${successCount} tokens ordered` })
    }

    // GET /api/tokens/orders/mine - user's order history grouped by bulk_id
    if (req.method === 'GET' && segments.includes('mine')) {
      const rows = await sql`
        SELECT o.*, t.provider, t.name as token_name, t.price
        FROM token_orders o
        JOIN tokens t ON o.token_id = t.id
        WHERE o.user_id = ${user.id}
        ORDER BY o.created_at DESC
      `

      // Group by bulk_id
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

      return res.status(200).json({ orders: Array.from(bulkMap.values()) })
    }

    // GET /api/tokens/note/:bulkId - download token note for confirmed bulk order
    if (req.method === 'GET' && segments.includes('note')) {
      const bulkId = segments[segments.length - 1]
      if (!bulkId || bulkId === 'undefined') {
        return res.status(400).json({ error: 'Invalid bulk id' })
      }

      const rows = await sql`
        SELECT o.*, t.provider, t.name as token_name, t.token_value, t.price, u.name as user_name
        FROM token_orders o
        JOIN tokens t ON o.token_id = t.id
        JOIN users u ON o.user_id = u.id
        WHERE o.bulk_id = ${bulkId} AND o.user_id = ${user.id} AND o.status = 'confirmed'
        ORDER BY t.id ASC
      `

      if (rows.length === 0) return res.status(404).json({ error: 'Order not found or not confirmed' })

      const provider = rows[0].provider.toUpperCase()
      const userName = rows[0].user_name
      const total = rows.reduce((sum: number, r: any) => sum + r.price, 0)
      const date = new Date(rows[0].created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })

      let note = `akun_Token_${rows[0].provider}_${rows.length}_${new Date().toISOString().replace(/:/g, '-').slice(0, 19)}.txt
========================================
  ARKXMotion Studio - Token Purchase Note
========================================

User      : ${userName}
Provider  : ${provider}
Jumlah    : ${rows.length} token
Total     : Rp ${total.toLocaleString('id-ID')}
Status    : CONFIRMED
Tanggal   : ${date}

----------------------------------------
TOKEN YANG DIBELI:
----------------------------------------

`

      for (let i = 0; i < rows.length; i++) {
        note += `${rows[i].token_value}
`
      }

      note += `
========================================
Terima kasih telah membeli token!
Gunakan token ini di menu Providers.
========================================
`

      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="akun_Token_${rows[0].provider}_${rows.length}_${new Date().toISOString().replace(/:/g, '-').slice(0, 19)}.txt"`)
      return res.status(200).send(note)
    }

    // DELETE /api/tokens/orders/clear - clear user's order history
    if (req.method === 'DELETE' && segments.includes('clear')) {
      // Get token IDs from pending orders before deleting
      const pendingOrders = await sql`SELECT token_id FROM token_orders WHERE user_id = ${user.id} AND status = 'pending'`
      // Reset tokens back to available
      for (const o of pendingOrders) {
        await sql`UPDATE tokens SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = ${o.token_id}`
      }
      await sql`DELETE FROM token_orders WHERE user_id = ${user.id}`
      return res.status(200).json({ message: 'Order history cleared' })
    }

    return res.status(404).json({ error: 'Not found' })
  } catch (err: any) {
    console.error('Tokens error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
