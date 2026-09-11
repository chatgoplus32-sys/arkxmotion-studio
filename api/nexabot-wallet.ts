// ─── Wallet NexaBot (prepaid Rp) — versi Vercel ─────────────────────────────
// Cermin dari server/routes/nexabotWallet.ts (Express lokal). Dipakai produksi
// lewat rewrite vercel.json: /api/nexabot/* → /api/nexabot-wallet?sub=*.
//
// Sama seperti CreatePulse: saldo Rp per user, top up diajukan ke admin, dan
// tiap generate memotong Rp 250 (flat). Saldo terpisah dari CreatePulse.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import jwt from 'jsonwebtoken'
import { neon } from '@neondatabase/serverless'

/** Harga per generate untuk user (admin bebas — lihat halaman generate). */
const NEXABOT_PRICE_RP = 250
/** Minimal top up, mengikuti CreatePulse supaya seragam. */
const NEXABOT_MIN_TOPUP = 10000

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

async function ensureTables(sql: any) {
  try {
    await sql`CREATE TABLE IF NOT EXISTS nexabot_balance (id SERIAL PRIMARY KEY, user_id INTEGER UNIQUE NOT NULL, balance INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS nexabot_topup (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')), proof_note TEXT NOT NULL DEFAULT '', admin_note TEXT NOT NULL DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS nexabot_usage (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, model TEXT NOT NULL DEFAULT '', cost INTEGER NOT NULL, batch_id TEXT, status TEXT NOT NULL DEFAULT 'used' CHECK(status IN ('used', 'refunded')), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
  } catch (e) { console.warn('[nexabot-wallet] ensureTables:', e) }
}

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

    // GET balance (+ harga & minimal topup supaya UI memakai angka server)
    if (sub === 'balance' || url.includes('/balance')) {
      const rows = await sql`SELECT balance FROM nexabot_balance WHERE user_id = ${user.id}`
      if (rows.length === 0) {
        await sql`INSERT INTO nexabot_balance (user_id, balance) VALUES (${user.id}, 0) ON CONFLICT (user_id) DO NOTHING`
        return res.status(200).json({ balance: 0, price: NEXABOT_PRICE_RP, min_topup: NEXABOT_MIN_TOPUP })
      }
      return res.status(200).json({ balance: rows[0].balance, price: NEXABOT_PRICE_RP, min_topup: NEXABOT_MIN_TOPUP })
    }

    // POST topup
    if (sub === 'topup' || (url.includes('/topup') && !url.includes('/topups'))) {
      const { amount, proof_note } = req.body || {}
      if (!amount || amount < NEXABOT_MIN_TOPUP) {
        return res.status(400).json({ error: `Minimal topup Rp ${NEXABOT_MIN_TOPUP.toLocaleString('id-ID')}` })
      }
      const rows = await sql`INSERT INTO nexabot_topup (user_id, amount, proof_note, status) VALUES (${user.id}, ${amount}, ${proof_note || ''}, 'pending') RETURNING *`
      return res.status(201).json({ topup: rows[0], message: 'Topup request submitted, waiting admin approval' })
    }

    // GET topups mine
    if (sub === 'topups-mine' || url.includes('/topups/mine')) {
      const rows = await sql`SELECT * FROM nexabot_topup WHERE user_id = ${user.id} ORDER BY created_at DESC`
      return res.status(200).json({ topups: rows })
    }

    // POST deduct — harga ditentukan server (flat Rp 250), bukan dari klien.
    if (sub === 'deduct' || url.includes('/deduct')) {
      const { model, batch_id } = req.body || {}
      const cost = NEXABOT_PRICE_RP

      const balRows = await sql`SELECT balance FROM nexabot_balance WHERE user_id = ${user.id}`
      let balance = balRows.length > 0 ? balRows[0].balance : 0
      if (balRows.length === 0) {
        await sql`INSERT INTO nexabot_balance (user_id, balance) VALUES (${user.id}, 0) ON CONFLICT (user_id) DO NOTHING`
        balance = 0
      }

      if (balance < cost) {
        return res.status(400).json({
          error: `Saldo NexaBot tidak cukup (Rp ${balance.toLocaleString('id-ID')}). Butuh Rp ${cost.toLocaleString('id-ID')} — top up dulu.`,
          balance,
          required: cost,
        })
      }

      await sql`UPDATE nexabot_balance SET balance = balance - ${cost}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ${user.id}`
      const inserted = await sql`INSERT INTO nexabot_usage (user_id, model, cost, batch_id, status) VALUES (${user.id}, ${model || ''}, ${cost}, ${batch_id || ''}, 'used') RETURNING id`
      const updated = await sql`SELECT balance FROM nexabot_balance WHERE user_id = ${user.id}`
      return res.status(200).json({ balance: updated[0].balance, deducted: cost, usage_id: inserted[0]?.id })
    }

    // POST refund — pakai usage_id (presisi) atau batch_id sebagai cadangan.
    if (sub === 'refund' || url.includes('/refund')) {
      const { usage_id, batch_id } = req.body || {}

      let usage
      if (usage_id) {
        usage = await sql`SELECT * FROM nexabot_usage WHERE user_id = ${user.id} AND id = ${usage_id} AND status = 'used'`
      } else if (batch_id) {
        usage = await sql`SELECT * FROM nexabot_usage WHERE user_id = ${user.id} AND batch_id = ${batch_id} AND status = 'used'`
      }
      if (!usage || usage.length === 0) return res.status(404).json({ error: 'Usage not found' })

      await sql`UPDATE nexabot_usage SET status = 'refunded' WHERE id = ${usage[0].id}`
      await sql`UPDATE nexabot_balance SET balance = balance + ${usage[0].cost}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ${user.id}`
      const updated = await sql`SELECT balance FROM nexabot_balance WHERE user_id = ${user.id}`
      return res.status(200).json({ balance: updated[0].balance, refunded: usage[0].cost })
    }

    return res.status(404).json({ error: 'Not found: ' + url })
  } catch (err: any) {
    console.error('NexaBot wallet API error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
