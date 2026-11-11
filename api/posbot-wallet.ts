import type { VercelRequest, VercelResponse } from '@vercel/node'
import jwt from 'jsonwebtoken'
import { neon } from '@neondatabase/serverless'
import { POSBOT_MIN_TOPUP, POSBOT_TOPUP_MAX, POSBOT_TOPUP_PRESETS, getPosbotCharge } from '../shared/pricing.js'

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return neon(url)
}

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('JWT_SECRET env var is required')

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

async function ensureTables(sql: ReturnType<typeof neon>) {
  try {
    await sql`CREATE TABLE IF NOT EXISTS posbot_balance (id SERIAL PRIMARY KEY, user_id INTEGER UNIQUE NOT NULL, balance INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS posbot_topup (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', proof_note TEXT NOT NULL DEFAULT '', admin_note TEXT NOT NULL DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS posbot_usage (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, model TEXT NOT NULL DEFAULT '', cost INTEGER NOT NULL, batch_id TEXT, status TEXT NOT NULL DEFAULT 'used', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
  } catch (e) { console.warn('[posbot-wallet] ensureTables:', e) }
}

// Saldo PosBot dalam RUPIAH (bukan token), tapi sistemnya sama dengan Seavi.
// Relay kunci server hanya hidup di Express/VPS, jadi twin Vercel ini tidak
// mengirim tiket usage — jalur server-key member diarahkan ke backend VPS.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = verifyUser(req)
  if (!user) return res.status(403).json({ error: 'Access denied' })

  try {
    const sql = getSql()
    await ensureTables(sql)
    const url = req.url || ''
    const sub = (req.query.sub || '') as string

    // GET balance
    if (sub === 'balance' || url.includes('/balance')) {
      const rows = await sql`SELECT balance FROM posbot_balance WHERE user_id = ${user.id}`
      if (rows.length === 0) {
        await sql`INSERT INTO posbot_balance (user_id, balance) VALUES (${user.id}, 0) ON CONFLICT (user_id) DO NOTHING`
        return res.status(200).json({ balance: 0, presets: POSBOT_TOPUP_PRESETS, min_topup: POSBOT_MIN_TOPUP, max_topup: POSBOT_TOPUP_MAX })
      }
      return res.status(200).json({ balance: rows[0].balance, presets: POSBOT_TOPUP_PRESETS, min_topup: POSBOT_MIN_TOPUP, max_topup: POSBOT_TOPUP_MAX })
    }

    // POST topup (nominal bebas, Rupiah)
    if (sub === 'topup' || (url.includes('/topup') && !url.includes('/topups'))) {
      const { amount, proof_note } = req.body || {}
      const topupAmount = Math.round(Number(amount))
      if (!Number.isInteger(topupAmount) || topupAmount < POSBOT_MIN_TOPUP) {
        return res.status(400).json({ error: `Minimal topup Rp ${POSBOT_MIN_TOPUP.toLocaleString('id-ID')}` })
      }
      if (topupAmount > POSBOT_TOPUP_MAX) {
        return res.status(400).json({ error: `Maksimal topup Rp ${POSBOT_TOPUP_MAX.toLocaleString('id-ID')}` })
      }
      const rows = await sql`INSERT INTO posbot_topup (user_id, amount, proof_note, status) VALUES (${user.id}, ${topupAmount}, ${proof_note || ''}, 'pending') RETURNING *`
      return res.status(201).json({ topup: rows[0], message: 'Topup request submitted, waiting admin approval' })
    }

    // GET topups mine
    if (sub === 'topups-mine' || url.includes('/topups/mine')) {
      const rows = await sql`SELECT * FROM posbot_topup WHERE user_id = ${user.id} ORDER BY created_at DESC`
      return res.status(200).json({ topups: rows })
    }

    // POST deduct
    if (sub === 'deduct' || url.includes('/deduct')) {
      const { model, quantity, batch_id } = req.body || {}
      const units = Math.max(1, Math.min(50, Number(quantity) || 1))
      const cost = getPosbotCharge(model) * units

      const balRows = await sql`SELECT balance FROM posbot_balance WHERE user_id = ${user.id}`
      let balance = balRows.length > 0 ? balRows[0].balance : 0
      if (balRows.length === 0) {
        await sql`INSERT INTO posbot_balance (user_id, balance) VALUES (${user.id}, 0) ON CONFLICT (user_id) DO NOTHING`
        balance = 0
      }

      if (balance < cost) {
        return res.status(400).json({ error: 'Saldo PosBot tidak cukup', balance, required: cost })
      }

      await sql`UPDATE posbot_balance SET balance = balance - ${cost}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ${user.id}`
      await sql`INSERT INTO posbot_usage (user_id, model, cost, batch_id, status) VALUES (${user.id}, ${model || ''}, ${cost}, ${batch_id || ''}, 'used')`

      const updated = await sql`SELECT balance FROM posbot_balance WHERE user_id = ${user.id}`
      return res.status(200).json({ balance: updated[0].balance, deducted: cost })
    }

    // POST refund
    if (sub === 'refund' || url.includes('/refund')) {
      const { batch_id, model } = req.body || {}

      let usage
      if (batch_id) {
        usage = await sql`SELECT * FROM posbot_usage WHERE user_id = ${user.id} AND batch_id = ${batch_id} AND status = 'used'`
      } else if (model) {
        usage = await sql`SELECT * FROM posbot_usage WHERE user_id = ${user.id} AND model = ${model} AND status = 'used' ORDER BY id DESC LIMIT 1`
      }
      if (!usage || usage.length === 0) return res.status(404).json({ error: 'Usage not found' })

      await sql`UPDATE posbot_usage SET status = 'refunded' WHERE id = ${usage[0].id}`
      await sql`UPDATE posbot_balance SET balance = balance + ${usage[0].cost}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ${user.id}`

      const updated = await sql`SELECT balance FROM posbot_balance WHERE user_id = ${user.id}`
      return res.status(200).json({ balance: updated[0].balance, refunded: usage[0].cost })
    }

    return res.status(404).json({ error: 'Not found: ' + url })
  } catch (err: any) {
    console.error('Posbot wallet API error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
