import type { VercelRequest, VercelResponse } from '@vercel/node'
import bcrypt from 'bcryptjs'
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
    const rows = await sql`SELECT * FROM users WHERE email = 'nuallakoko@gmail.com'`
    const user = rows[0]

    if (!user) {
      return res.status(200).json({ step1_user_found: false })
    }

    const password = 'admin123'
    const validPassword = await bcrypt.compare(password, user.password)

    return res.status(200).json({
      step1_user_found: true,
      step2_user_id: user.id,
      step2_user_email: user.email,
      step2_user_role: user.role,
      step2_user_approved: user.approved,
      step3_password_valid: validPassword,
      password_hash_first_20: user.password.substring(0, 20)
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
