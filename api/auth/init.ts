import type { VercelRequest, VercelResponse } from '@vercel/node'
import sql from '../db'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        approved INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    await sql`
      INSERT INTO users (email, password, name, role, approved)
      SELECT 'nuallakoko@gmail.com', '$2a$10$dummy', 'Admin', 'admin', 1
      WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'nuallakoko@gmail.com')
    `

    return res.status(200).json({ message: 'Database initialized' })
  } catch (err: any) {
    console.error('Init error:', err)
    return res.status(500).json({ error: err.message })
  }
}
