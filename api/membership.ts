import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return neon(url)
}

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

const DEFAULT_FEE = 150000

async function getMembershipFee(sql: any): Promise<number> {
  try {
    const rows = await sql`SELECT value FROM app_settings WHERE key = 'membership_fee'`
    const fee = Number(rows[0]?.value)
    return Number.isFinite(fee) && fee > 0 ? fee : DEFAULT_FEE
  } catch {
    return DEFAULT_FEE
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const action = String(req.query.action || '')

  // GET /api/membership/config — harga membership (publik)
  if (action === 'config' && req.method === 'GET') {
    try {
      const sql = getSql()
      const fee = await getMembershipFee(sql)
      return res.status(200).json({ ok: true, membershipFee: fee })
    } catch (err: any) {
      console.error('Get membership config error:', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { token, amount, proof_note } = req.body || {}

    if (!token) return res.status(400).json({ error: 'Token pembayaran diperlukan' })
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Nominal pembayaran tidak valid' })
    }

    const sql = getSql()
    const users = await sql`SELECT id, email, approved FROM users WHERE payment_token = ${token}`
    const user = users[0]
    if (!user) return res.status(400).json({ error: 'Token pembayaran tidak valid' })
    if (user.approved) {
      return res.status(400).json({ error: 'Akun kamu sudah aktif — tidak perlu konfirmasi pembayaran' })
    }

    const pending = await sql`SELECT id FROM membership_payments WHERE user_id = ${user.id} AND status = 'pending'`
    if (pending.length > 0) {
      return res.status(400).json({ error: 'Masih ada konfirmasi pembayaran yang belum diproses admin' })
    }

    const rows = await sql`
      INSERT INTO membership_payments (user_id, amount, status, proof_note)
      VALUES (${user.id}, ${amt}, 'pending', ${String(proof_note || '').slice(0, 500)})
      RETURNING id
    `

    return res.status(201).json({
      ok: true,
      message: 'Konfirmasi pembayaran diterima. Admin akan memprosesnya.',
      paymentId: rows[0].id,
    })
  } catch (err: any) {
    console.error('Membership payment error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
