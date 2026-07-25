import type { VercelRequest, VercelResponse } from '@vercel/node'
import bcrypt from 'bcryptjs'
import sql from '../db'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const password = 'admin123'
    const hashedPassword = await bcrypt.hash(password, 10)

    const existing = await sql`SELECT id FROM users WHERE email = 'nuallakoko@gmail.com'`

    if (existing.length > 0) {
      await sql`
        UPDATE users SET password = ${hashedPassword}, role = 'admin', approved = 1
        WHERE email = 'nuallakoko@gmail.com'
      `
    } else {
      await sql`
        INSERT INTO users (email, password, name, role, approved)
        VALUES ('nuallakoko@gmail.com', ${hashedPassword}, 'Admin', 'admin', 1)
      `
    }

    const users = await sql`SELECT id, email, name, role, approved FROM users`

    return res.status(200).json({
      message: 'Admin seeded successfully',
      email: 'nuallakoko@gmail.com',
      password: 'admin123',
      users
    })
  } catch (err: any) {
    console.error('Seed error:', err)
    return res.status(500).json({ error: err.message })
  }
}
