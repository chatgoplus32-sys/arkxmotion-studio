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
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!['POST', 'DELETE'].includes(req.method!)) return res.status(405).json({ error: 'Method not allowed' })
  if (!verifyAdmin(req)) return res.status(403).json({ error: 'Admin access required' })

  const { id } = req.query

  try {
    const rows = await sql`SELECT id, email, role FROM users WHERE id = ${Number(id)}`
    const user = rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Cannot delete admin users' })
    }

    await sql`DELETE FROM users WHERE id = ${Number(id)}`

    return res.status(200).json({ message: `User ${user.email} deleted successfully` })
  } catch (err: any) {
    console.error('Delete user error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
