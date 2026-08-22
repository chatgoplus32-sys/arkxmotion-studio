import type { VercelRequest, VercelResponse } from '@vercel/node'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { neon } from '@neondatabase/serverless'
import { sendEmail, appUrl } from './mailer.js'

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return neon(url)
}

function getClientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for']
  if (fwd) {
    const first = String(fwd).split(',')[0].trim()
    if (first) return first
  }
  return (req.headers['x-real-ip'] as string) || 'unknown'
}

const REGISTER_LIMIT_PER_HOUR = 5

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
    if (path === 'status') return handleStatus(req, res)
    if (path === 'forgot-password') return handleForgotPassword(req, res)
    if (path === 'reset-password') return handleResetPassword(req, res)
    if (path === 'verify-email') return handleVerifyEmail(req, res)

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
        email_verified INTEGER NOT NULL DEFAULT 0,
        email_verify_token TEXT,
        email_verify_expires TIMESTAMP,
        reset_token TEXT,
        reset_expires TIMESTAMP,
        payment_token TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    // Kolom email verification & reset (untuk database lama)
    try { await sql`ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0` } catch {}
    try { await sql`ALTER TABLE users ADD COLUMN email_verify_token TEXT` } catch {}
    try { await sql`ALTER TABLE users ADD COLUMN email_verify_expires TIMESTAMP` } catch {}
    try { await sql`ALTER TABLE users ADD COLUMN reset_token TEXT` } catch {}
    try { await sql`ALTER TABLE users ADD COLUMN reset_expires TIMESTAMP` } catch {}
    try { await sql`ALTER TABLE users ADD COLUMN payment_token TEXT` } catch {}
    // Akun yang sudah ada sebelum fitur ini dianggap sudah terverifikasi
    try { await sql`UPDATE users SET email_verified = 1` } catch {}
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

    // CreatePulse tables
    await sql`
      CREATE TABLE IF NOT EXISTS createpulse_balance (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
        balance INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS createpulse_topup (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        proof_note TEXT NOT NULL DEFAULT '',
        admin_note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS createpulse_usage (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        model TEXT NOT NULL,
        cost INTEGER NOT NULL,
        batch_id TEXT,
        status TEXT NOT NULL DEFAULT 'used',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS register_attempts (
        id SERIAL PRIMARY KEY,
        ip TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    try { await sql`CREATE INDEX IF NOT EXISTS idx_register_attempts_ip_time ON register_attempts(ip, created_at)` } catch {}
    await sql`
      CREATE TABLE IF NOT EXISTS membership_payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
        proof_note TEXT NOT NULL DEFAULT '',
        admin_note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    try { await sql`CREATE INDEX IF NOT EXISTS idx_membership_payments_user ON membership_payments(user_id)` } catch {}

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

  try {
    const sql = getSql()

    // Anti-spam: maks 5 percobaan daftar per jam per IP
    const ip = getClientIp(req)
    await sql`DELETE FROM register_attempts WHERE created_at < now() - interval '1 hour'`
    const cnt = await sql`SELECT COUNT(*) AS c FROM register_attempts WHERE ip = ${ip} AND created_at >= now() - interval '1 hour'`
    if (Number(cnt[0]?.c || 0) >= REGISTER_LIMIT_PER_HOUR) {
      return res.status(429).json({
        error: `Terlalu banyak percobaan daftar dari IP ini (maks ${REGISTER_LIMIT_PER_HOUR}/jam). Coba lagi nanti.`,
      })
    }
    await sql`INSERT INTO register_attempts (ip) VALUES (${ip})`

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' })
    }

    const existing = await sql`SELECT id FROM users WHERE email = ${email}`
    if (existing.length > 0) return res.status(409).json({ error: 'Email already registered' })

    const hashedPassword = await bcrypt.hash(password, 10)
    const paymentToken = generateToken()
    const rows = await sql`
      INSERT INTO users (email, password, name, role, approved, email_verified, payment_token)
      VALUES (${email}, ${hashedPassword}, ${name}, 'user', 0, 0, ${paymentToken})
      RETURNING id, email, name, role, approved, email_verified
    `
    const user = rows[0]

    // Kirim email verifikasi (link dikembalikan bila email tidak terkirim — mode dev)
    let devVerifyLink: string | null = null
    try {
      devVerifyLink = await createAndSendVerificationEmail(sql, user.id, user.email, user.name)
    } catch (err: any) {
      console.error('Send verification email error:', err.message)
    }

    return res.status(201).json({
      message: 'Registration successful. Please check your email to verify, then wait for admin approval.',
      needsApproval: true,
      devVerifyLink,
      paymentToken,
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
        email_verified INTEGER NOT NULL DEFAULT 0,
        email_verify_token TEXT,
        email_verify_expires TIMESTAMP,
        reset_token TEXT,
        reset_expires TIMESTAMP,
        payment_token TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    // Kolom email verification & reset (untuk database lama)
    try { await sql`ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0` } catch {}
    try { await sql`ALTER TABLE users ADD COLUMN email_verify_token TEXT` } catch {}
    try { await sql`ALTER TABLE users ADD COLUMN email_verify_expires TIMESTAMP` } catch {}
    try { await sql`ALTER TABLE users ADD COLUMN reset_token TEXT` } catch {}
    try { await sql`ALTER TABLE users ADD COLUMN reset_expires TIMESTAMP` } catch {}
    try { await sql`ALTER TABLE users ADD COLUMN payment_token TEXT` } catch {}
    // Akun yang sudah ada sebelum fitur ini dianggap sudah terverifikasi
    try { await sql`UPDATE users SET email_verified = 1` } catch {}
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

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

async function createAndSendVerificationEmail(sql: any, userId: number, email: string, name: string): Promise<string | null> {
  const token = generateToken()
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  await sql`UPDATE users SET email_verify_token = ${token}, email_verify_expires = ${expires} WHERE id = ${userId}`

  const link = `${appUrl()}/api/auth/verify-email?token=${token}`
  const { sent } = await sendEmail({
    to: email,
    subject: 'Verifikasi Email — ARKXMotion Studio',
    text: `Halo ${name},\n\nKlik link berikut untuk memverifikasi email kamu:\n${link}\n\nLink berlaku 24 jam.\n— ARKXMotion Studio`,
    html: `<p>Halo <b>${name}</b>,</p><p>Klik tombol di bawah untuk memverifikasi email kamu:</p><p><a href="${link}" style="background:#E5A93B;color:#000;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Verifikasi Email</a></p><p>Atau buka link ini: <a href="${link}">${link}</a></p><p>Link berlaku 24 jam.</p>`,
  })
  return sent ? null : link
}

// ─── Status pendaftaran (tanpa login) ───────────────────────────────────
async function handleStatus(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email } = req.body || {}
  if (!email) return res.status(400).json({ error: 'Email is required' })

  try {
    const sql = getSql()
    const rows = await sql`SELECT id, approved, email_verified, role FROM users WHERE email = ${String(email).toLowerCase()}`
    const user = rows[0]
    if (!user) return res.status(200).json({ found: false })

    let payment: any = null
    try {
      const pays = await sql`SELECT amount, status, proof_note, admin_note, created_at FROM membership_payments WHERE user_id = ${user.id} ORDER BY id DESC LIMIT 1`
      if (pays[0]) {
        payment = {
          amount: pays[0].amount,
          status: pays[0].status,
          proofNote: pays[0].proof_note,
          adminNote: pays[0].admin_note,
          createdAt: pays[0].created_at,
        }
      }
    } catch {}

    return res.status(200).json({
      found: true,
      approved: !!user.approved,
      emailVerified: !!user.email_verified,
      isAdmin: user.role === 'admin',
      payment,
    })
  } catch (err: any) {
    console.error('Status error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

// ─── Lupa password ──────────────────────────────────────────────────────
async function handleForgotPassword(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email } = req.body || {}
  if (!email) return res.status(400).json({ error: 'Email is required' })

  try {
    const sql = getSql()
    const rows = await sql`SELECT * FROM users WHERE email = ${String(email).toLowerCase()}`
    const user = rows[0]

    // Respons selalu sama agar email tidak bisa "ditebak" ada/tidak
    if (!user) return res.status(200).json({ ok: true })

    const token = generateToken()
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString()
    await sql`UPDATE users SET reset_token = ${token}, reset_expires = ${expires} WHERE id = ${user.id}`

    const link = `${appUrl()}/reset-password?token=${token}`
    const { sent } = await sendEmail({
      to: user.email,
      subject: 'Reset Password — ARKXMotion Studio',
      text: `Halo ${user.name},\n\nKlik link berikut untuk mereset password kamu:\n${link}\n\nLink berlaku 15 menit.\n— ARKXMotion Studio`,
      html: `<p>Halo <b>${user.name}</b>,</p><p>Klik tombol di bawah untuk mereset password kamu:</p><p><a href="${link}" style="background:#E5A93B;color:#000;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Reset Password</a></p><p>Atau buka link ini: <a href="${link}">${link}</a></p><p>Link berlaku 15 menit.</p>`,
    })

    return res.status(200).json({ ok: true, devResetLink: sent ? null : link })
  } catch (err: any) {
    console.error('Forgot password error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function handleResetPassword(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { token, password } = req.body || {}
  if (!token || !password) return res.status(400).json({ error: 'Token and password are required' })
  if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' })

  try {
    const sql = getSql()
    const rows = await sql`SELECT * FROM users WHERE reset_token = ${token}`
    const user = rows[0]
    if (!user) return res.status(400).json({ error: 'Token reset tidak valid' })

    const expires = user.reset_expires ? new Date(user.reset_expires).getTime() : 0
    if (Date.now() > expires) {
      return res.status(400).json({ error: 'Token reset sudah kedaluwarsa. Minta ulang link baru.' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    await sql`UPDATE users SET password = ${hashedPassword}, reset_token = NULL, reset_expires = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ${user.id}`

    return res.status(200).json({ ok: true, message: 'Password berhasil direset. Silakan login.' })
  } catch (err: any) {
    console.error('Reset password error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

// ─── Verifikasi email (dari link di email) ──────────────────────────────
async function handleVerifyEmail(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const token = String(req.query.token || '')
  if (!token) return res.redirect(`${appUrl()}/login?verified=0`)

  try {
    const sql = getSql()
    const rows = await sql`SELECT * FROM users WHERE email_verify_token = ${token}`
    const user = rows[0]
    if (!user) return res.redirect(`${appUrl()}/login?verified=0`)

    const expires = user.email_verify_expires ? new Date(user.email_verify_expires).getTime() : 0
    if (Date.now() > expires) return res.redirect(`${appUrl()}/login?verified=0`)

    await sql`UPDATE users SET email_verified = 1, email_verify_token = NULL, email_verify_expires = NULL WHERE id = ${user.id}`
    return res.redirect(`${appUrl()}/login?verified=1`)
  } catch (err: any) {
    console.error('Verify email error:', err)
    return res.redirect(`${appUrl()}/login?verified=0`)
  }
}
