import type { VercelRequest, VercelResponse } from '@vercel/node'
import bcrypt from 'bcryptjs'
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const rawPath = req.query.path
    const path = Array.isArray(rawPath) ? rawPath[0] : (rawPath || '')

    if (path === 'init') return handleInit(req, res)
    if (path === 'login') return handleLogin(req, res)
    if (path === 'me') return handleMe(req, res)
    if (path === 'register') return handleRegister(req, res)
    if (path === 'seed') return handleSeed(req, res)
    if (path === 'change-password') return handleChangePassword(req, res)

    return res.status(404).json({ error: 'Not found' })
  } catch (err: any) {
    console.error('Handler error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

async function handleInit(_req: VercelRequest, res: VercelResponse) {
  try {
    const sql = getSql()
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
      CREATE TABLE IF NOT EXISTS tokens (
        id SERIAL PRIMARY KEY,
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        token_value TEXT NOT NULL,
        price INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'available',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS token_orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        token_id INTEGER NOT NULL REFERENCES tokens(id),
        status TEXT NOT NULL DEFAULT 'pending',
        bulk_id TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    // Add bulk_id column if missing (for existing databases)
    try {
      await sql`ALTER TABLE token_orders ADD COLUMN bulk_id TEXT NOT NULL DEFAULT ''`
    } catch { /* column already exists */ }

    return res.status(200).json({ message: 'Database initialized' })
  } catch (err: any) {
    console.error('Init error:', err)
    return res.status(500).json({ error: err.message })
  }
}

async function handleLogin(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  try {
    const sql = getSql()
    const rows = await sql`SELECT * FROM users WHERE email = ${email}`
    const user = rows[0]
    if (!user) return res.status(401).json({ error: 'Invalid email or password' })

    const validPassword = await bcrypt.compare(password, user.password)
    if (!validPassword) return res.status(401).json({ error: 'Invalid email or password' })

    if (user.role !== 'admin' && !user.approved) {
      return res.status(403).json({ error: 'Your account is pending admin approval' })
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    )

    return res.status(200).json({
      token,
      user: {
        id: user.id, email: user.email, name: user.name,
        role: user.role, approved: !!user.approved
      }
    })
  } catch (err: any) {
    console.error('Login error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function handleMe(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'Access token required' })

  try {
    const sql = getSql()
    const decoded = jwt.verify(token, JWT_SECRET) as { id: number; email: string; role: string }
    const rows = await sql`
      SELECT id, email, name, role, approved, created_at
      FROM users WHERE id = ${decoded.id}
    `
    const user = rows[0]
    if (!user) return res.status(404).json({ error: 'User not found' })

    return res.status(200).json({
      user: {
        id: user.id, email: user.email, name: user.name,
        role: user.role, approved: !!user.approved, created_at: user.created_at
      }
    })
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token' })
  }
}

async function handleRegister(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, password, name } = req.body || {}
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password, and name are required' })
  }

  try {
    const sql = getSql()
    const existing = await sql`SELECT id FROM users WHERE email = ${email}`
    if (existing.length > 0) return res.status(409).json({ error: 'Email already registered' })

    const hashedPassword = await bcrypt.hash(password, 10)
    const rows = await sql`
      INSERT INTO users (email, password, name, role, approved)
      VALUES (${email}, ${hashedPassword}, ${name}, 'user', 0)
      RETURNING id, email, name, role, approved
    `
    const user = rows[0]
    return res.status(201).json({
      message: 'Registration successful. Please wait for admin approval.',
      user: { id: user.id, email: user.email, name: user.name, role: user.role, approved: !!user.approved }
    })
  } catch (err: any) {
    console.error('Register error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function handleSeed(_req: VercelRequest, res: VercelResponse) {
  try {
    const sql = getSql()

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
      CREATE TABLE IF NOT EXISTS tokens (
        id SERIAL PRIMARY KEY,
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        token_value TEXT NOT NULL,
        price INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'available',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS token_orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        token_id INTEGER NOT NULL REFERENCES tokens(id),
        status TEXT NOT NULL DEFAULT 'pending',
        bulk_id TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    try {
      await sql`ALTER TABLE token_orders ADD COLUMN bulk_id TEXT NOT NULL DEFAULT ''`
    } catch { /* column already exists */ }

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
      message: 'Admin seeded!',
      email: 'nuallakoko@gmail.com',
      password: 'admin123',
      users
    })
  } catch (err: any) {
    console.error('Seed error:', err)
    return res.status(500).json({ error: err.message })
  }
}

async function handleChangePassword(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'Access token required' })

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: number; email: string }
    const { old_password, new_password } = req.body || {}

    if (!old_password || !new_password) {
      return res.status(400).json({ error: 'Password lama dan baru harus diisi' })
    }
    if (new_password.length < 4) {
      return res.status(400).json({ error: 'Password baru minimal 4 karakter' })
    }

    const sql = getSql()
    const rows = await sql`SELECT * FROM users WHERE id = ${decoded.id}`
    const user = rows[0]
    if (!user) return res.status(404).json({ error: 'User not found' })

    const bcrypt = await import('bcryptjs')
    const validPassword = await bcrypt.compare(old_password, user.password)
    if (!validPassword) return res.status(401).json({ error: 'Password lama salah' })

    const hashedPassword = await bcrypt.hash(new_password, 10)
    await sql`UPDATE users SET password = ${hashedPassword}, updated_at = CURRENT_TIMESTAMP WHERE id = ${decoded.id}`

    return res.status(200).json({ message: 'Password berhasil diubah' })
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token' })
  }
}
