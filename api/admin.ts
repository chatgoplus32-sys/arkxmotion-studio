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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

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
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!verifyAdmin(req)) return res.status(403).json({ error: 'Admin access required' })

  try {
    const rawSub = req.query.sub
    const sub = Array.isArray(rawSub) ? rawSub[0] : rawSub
    const rawId = req.query.id
    const id = rawId ? Number(Array.isArray(rawId) ? rawId[0] : rawId) : undefined
    const rawAction = req.query.action
    const action = Array.isArray(rawAction) ? rawAction[0] : rawAction

    if (sub === 'pending' || (!id && !sub && req.url?.includes('pending'))) {
      if (req.method === 'GET') return handlePending(res)
    }

    if (id && action === 'approve' && req.method === 'POST') {
      return handleApprove(res, id)
    }

    if (id && !action && req.method === 'DELETE') {
      return handleDelete(res, id)
    }

    if (!id && !sub && req.method === 'GET') {
      return handleList(res)
    }

    // PATCH /api/admin?id=X&action=reset-password
    if (id && action === 'reset-password' && req.method === 'PATCH') {
      return handleResetPassword(res, id, req.body)
    }

    return res.status(404).json({ error: 'Not found' })
  } catch (err: any) {
    console.error('Admin handler error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

async function handleList(res: VercelResponse) {
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT id, email, name, role, approved, created_at, updated_at
      FROM users ORDER BY created_at DESC
    `
    return res.status(200).json({ users: rows.map(u => ({ ...u, approved: !!u.approved })) })
  } catch (err: any) {
    console.error('List users error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function handlePending(res: VercelResponse) {
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT id, email, name, role, approved, created_at
      FROM users WHERE approved = 0 AND role != 'admin'
      ORDER BY created_at DESC
    `
    return res.status(200).json({ users: rows.map(u => ({ ...u, approved: !!u.approved })) })
  } catch (err: any) {
    console.error('List pending users error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function handleApprove(res: VercelResponse, id: number) {
  try {
    const sql = getSql()
    const rows = await sql`SELECT id, email, name, role FROM users WHERE id = ${id}`
    const user = rows[0]
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.role === 'admin') return res.status(400).json({ error: 'Cannot approve admin users' })

    await sql`UPDATE users SET approved = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
    return res.status(200).json({ message: `User ${user.email} approved successfully` })
  } catch (err: any) {
    console.error('Approve user error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function handleDelete(res: VercelResponse, id: number) {
  try {
    const sql = getSql()
    const rows = await sql`SELECT id, email, role FROM users WHERE id = ${id}`
    const user = rows[0]
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.role === 'admin') return res.status(400).json({ error: 'Cannot delete admin users' })

    await sql`DELETE FROM users WHERE id = ${id}`
    return res.status(200).json({ message: `User ${user.email} deleted successfully` })
  } catch (err: any) {
    console.error('Delete user error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function handleResetPassword(res: VercelResponse, id: number, body: any) {
  try {
    const { new_password } = body || {}
    if (!new_password || new_password.length < 4) {
      return res.status(400).json({ error: 'Password minimal 4 karakter' })
    }

    const sql = getSql()
    const rows = await sql`SELECT id, email, role FROM users WHERE id = ${id}`
    const user = rows[0]
    if (!user) return res.status(404).json({ error: 'User not found' })

    const bcrypt = await import('bcryptjs')
    const hashedPassword = await bcrypt.hash(new_password, 10)
    await sql`UPDATE users SET password = ${hashedPassword}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`

    return res.status(200).json({ message: `Password ${user.email} berhasil direset` })
  } catch (err: any) {
    console.error('Reset password error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
