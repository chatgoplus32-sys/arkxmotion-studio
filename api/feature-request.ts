import type { VercelRequest, VercelResponse } from '@vercel/node'
import jwt from 'jsonwebtoken'
import { neon } from '@neondatabase/serverless'

const JWT_SECRET = process.env.JWT_SECRET

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!JWT_SECRET) return res.status(500).json({ error: 'Server misconfigured' })

  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'Access token required' })

  let user: { id: number; email: string; role: string }
  try {
    user = jwt.verify(token, JWT_SECRET) as { id: number; email: string; role: string }
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  try {
    const text = String(req.body?.text ?? '').trim()
    if (text.length < 10) return res.status(400).json({ error: 'Tulis minimal 10 karakter' })
    if (text.length > 2000) return res.status(400).json({ error: 'Maksimal 2000 karakter' })

    const url = process.env.DATABASE_URL
    if (!url) return res.status(500).json({ error: 'DATABASE_URL is not set' })
    const sql = neon(url)

    await sql`CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      target TEXT NOT NULL DEFAULT 'all',
      user_id INTEGER DEFAULT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`

    const head = text.split('\n')[0].slice(0, 80)
    await sql`INSERT INTO notifications (title, message, type, target, user_id)
      VALUES (${`Request Fitur: ${head}`}, ${`${text}\n\n— ${user.email}`}, 'announcement', 'admins', ${user.id})`

    return res.status(201).json({ ok: true })
  } catch (err) {
    console.error('[feature-request] error:', err)
    return res.status(500).json({ error: 'Gagal menyimpan request fitur' })
  }
}
