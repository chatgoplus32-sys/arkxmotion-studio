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
    const url = req.url || ''
    const sub = (req.query.sub || '') as string

    // GET balance
    if (sub === 'balance' || url.includes('/balance')) {
      const rows = await sql`SELECT balance FROM createpulse_balance WHERE user_id = ${user.id}`
      if (rows.length === 0) {
        await sql`INSERT INTO createpulse_balance (user_id, balance) VALUES (${user.id}, 0) ON CONFLICT (user_id) DO NOTHING`
        return res.status(200).json({ balance: 0 })
      }
      return res.status(200).json({ balance: rows[0].balance })
    }

    // POST topup
    if (sub === 'topup' || (url.includes('/topup') && !url.includes('/topups'))) {
      const { amount, proof_note } = req.body || {}
      if (!amount || amount < 10000) {
        return res.status(400).json({ error: 'Minimal topup Rp 10.000' })
      }
      const rows = await sql`INSERT INTO createpulse_topup (user_id, amount, proof_note, status) VALUES (${user.id}, ${amount}, ${proof_note || ''}, 'pending') RETURNING *`
      return res.status(201).json({ topup: rows[0], message: 'Topup request submitted, waiting admin approval' })
    }

    // GET topups mine
    if (sub === 'topups-mine' || url.includes('/topups/mine')) {
      const rows = await sql`SELECT * FROM createpulse_topup WHERE user_id = ${user.id} ORDER BY created_at DESC`
      return res.status(200).json({ topups: rows })
    }

    // POST deduct
    if (sub === 'deduct' || url.includes('/deduct')) {
      const { model, batch_id } = req.body || {}
      const cost = 1500

      const balRows = await sql`SELECT balance FROM createpulse_balance WHERE user_id = ${user.id}`
      let balance = balRows.length > 0 ? balRows[0].balance : 0
      if (balRows.length === 0) {
        await sql`INSERT INTO createpulse_balance (user_id, balance) VALUES (${user.id}, 0) ON CONFLICT (user_id) DO NOTHING`
        balance = 0
      }

      if (balance < cost) {
        return res.status(400).json({ error: 'Saldo tidak cukup', balance, required: cost })
      }

      await sql`UPDATE createpulse_balance SET balance = balance - ${cost}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ${user.id}`
      await sql`INSERT INTO createpulse_usage (user_id, model, cost, batch_id, status) VALUES (${user.id}, ${model}, ${cost}, ${batch_id || ''}, 'used')`

      const updated = await sql`SELECT balance FROM createpulse_balance WHERE user_id = ${user.id}`
      return res.status(200).json({ balance: updated[0].balance, deducted: cost })
    }

    // POST refund
    if (sub === 'refund' || url.includes('/refund')) {
      const { batch_id, model } = req.body || {}

      let usage
      if (batch_id) {
        usage = await sql`SELECT * FROM createpulse_usage WHERE user_id = ${user.id} AND batch_id = ${batch_id} AND status = 'used'`
      } else if (model) {
        usage = await sql`SELECT * FROM createpulse_usage WHERE user_id = ${user.id} AND model = ${model} AND status = 'used' ORDER BY id DESC LIMIT 1`
      }
      if (!usage || usage.length === 0) return res.status(404).json({ error: 'Usage not found' })

      await sql`UPDATE createpulse_usage SET status = 'refunded' WHERE id = ${usage[0].id}`
      await sql`UPDATE createpulse_balance SET balance = balance + ${usage[0].cost}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ${user.id}`

      const updated = await sql`SELECT balance FROM createpulse_balance WHERE user_id = ${user.id}`
      return res.status(200).json({ balance: updated[0].balance, refunded: usage[0].cost })
    }

    return res.status(404).json({ error: 'Not found: ' + url })
  } catch (err: any) {
    console.error('CreatePulse API error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
