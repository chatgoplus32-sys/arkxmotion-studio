import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return neon(url)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  try {
    const sql = getSql()
    const rows = await sql`SELECT id, email, name, role, approved, LEFT(password, 20) as password_prefix FROM users`
    return res.status(200).json({ users: rows })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
