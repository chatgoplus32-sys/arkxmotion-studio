import type { VercelRequest, VercelResponse } from '@vercel/node'
import jwt from 'jsonwebtoken'
import sql from '../db'

const JWT_SECRET = process.env.JWT_SECRET || 'arkxmotion-studio-secret-key-2026'

function verifyAdmin(req: VercelRequest): boolean {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return false
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { role: string }
    return decoded.role === 'admin'
  } catch {
    return false
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!verifyAdmin(req)) return res.status(403).json({ error: 'Admin access required' })

  try {
    const rows = await sql`
      SELECT id, email, name, role, approved, created_at
      FROM users WHERE approved = 0 AND role != 'admin'
      ORDER BY created_at DESC
    `
    return res.status(200).json({
      users: rows.map(u => ({ ...u, approved: !!u.approved }))
    })
  } catch (err: any) {
    console.error('List pending users error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
