import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import { sendEmail, appUrl } from '../mailer.js'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'arkxmotion-studio-secret-key-2026'

interface UserRow {
  id: number
  email: string
  password: string
  name: string
  role: string
  approved: number
  email_verified?: number
  email_verify_token?: string | null
  email_verify_expires?: string | null
  reset_token?: string | null
  reset_expires?: string | null
  created_at: string
  updated_at: string
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/** Kirim email verifikasi; kembalikan link bila email tidak terkirim (mode dev). */
export async function sendVerificationEmail(user: { id: number; email: string; name: string }): Promise<string | null> {
  const token = generateToken()
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 jam
  db.prepare(
    'UPDATE users SET email_verify_token = ?, email_verify_expires = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(token, expires, user.id)

  const link = `${appUrl()}/api/auth/verify-email?token=${token}`
  const { sent } = await sendEmail({
    to: user.email,
    subject: 'Verifikasi Email — ARKXMotion Studio',
    text: `Halo ${user.name},\n\nKlik link berikut untuk memverifikasi email kamu:\n${link}\n\nLink berlaku 24 jam.\n— ARKXMotion Studio`,
    html: `<p>Halo <b>${user.name}</b>,</p><p>Klik tombol di bawah untuk memverifikasi email kamu:</p><p><a href="${link}" style="background:#E5A93B;color:#000;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Verifikasi Email</a></p><p>Atau buka link ini: <a href="${link}">${link}</a></p><p>Link berlaku 24 jam.</p>`,
  })
  return sent ? null : link
}

/** Kirim email reset password; kembalikan link bila email tidak terkirim (mode dev). */
async function sendResetEmail(user: UserRow): Promise<string | null> {
  const token = generateToken()
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 menit
  db.prepare(
    'UPDATE users SET reset_token = ?, reset_expires = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(token, expires, user.id)

  const link = `${appUrl()}/reset-password?token=${token}`
  const { sent } = await sendEmail({
    to: user.email,
    subject: 'Reset Password — ARKXMotion Studio',
    text: `Halo ${user.name},\n\nKlik link berikut untuk mereset password kamu:\n${link}\n\nLink berlaku 15 menit.\n— ARKXMotion Studio`,
    html: `<p>Halo <b>${user.name}</b>,</p><p>Klik tombol di bawah untuk mereset password kamu:</p><p><a href="${link}" style="background:#E5A93B;color:#000;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Reset Password</a></p><p>Atau buka link ini: <a href="${link}">${link}</a></p><p>Link berlaku 15 menit.</p>`,
  })
  return sent ? null : link
}

const REGISTER_LIMIT_PER_HOUR = 5

function clientIp(req: any): string {
  const fwd = req.headers?.['x-forwarded-for']
  if (fwd) {
    const first = String(fwd).split(',')[0].trim()
    if (first) return first
  }
  return req.ip || 'unknown'
}

router.post('/register', async (req, res: Response) => {
  try {
    const { email, password, name } = req.body

    // Anti-spam: maks 5 percobaan daftar per jam per IP
    const ip = clientIp(req)
    db.prepare("DELETE FROM register_attempts WHERE created_at < datetime('now', '-1 hour')").run()
    const attemptRow = db.prepare(
      "SELECT COUNT(*) AS c FROM register_attempts WHERE ip = ? AND created_at >= datetime('now', '-1 hour')"
    ).get(ip) as { c: number }
    if (attemptRow.c >= REGISTER_LIMIT_PER_HOUR) {
      return res.status(429).json({
        error: `Terlalu banyak percobaan daftar dari IP ini (maks ${REGISTER_LIMIT_PER_HOUR}/jam). Coba lagi nanti.`,
      })
    }
    db.prepare('INSERT INTO register_attempts (ip) VALUES (?)').run(ip)

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' })
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as UserRow | undefined
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const paymentToken = generateToken()

    const result = db.prepare(
      'INSERT INTO users (email, password, name, role, approved, email_verified, payment_token) VALUES (?, ?, ?, ?, 0, 1, ?)'
    ).run(email, hashedPassword, name, 'user', paymentToken)

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as UserRow

    // Kirim email verifikasi (link dikembalikan bila email tidak terkirim — mode dev)
    let devLink: string | null = null
    try {
      devLink = await sendVerificationEmail(user)
    } catch (err: any) {
      console.error('Send verification email error:', err.message)
    }

    res.status(201).json({
      message: 'Registration successful. Please check your email to verify, then wait for admin approval.',
      needsApproval: true,
      devVerifyLink: devLink,
      paymentToken,
      user: {
        id: user.id,
        email,
        name,
        role: 'user',
        approved: false
      }
    })
  } catch (error) {
    console.error('Register error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/login', async (req, res: Response) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const validPassword = await bcrypt.compare(password, user.password)
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    if (user.role !== 'admin' && !user.approved) {
      return res.status(403).json({ error: 'Your account is pending admin approval' })
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        approved: !!user.approved
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/me', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const user = db.prepare('SELECT id, email, name, role, approved, created_at FROM users WHERE id = ?').get(req.user!.id) as Omit<UserRow, 'password'> | undefined

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json({ user: { ...user, approved: !!user.approved } })
  } catch (error) {
    console.error('Get me error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/logout', (_req, res: Response) => {
  res.json({ message: 'Logged out successfully' })
})

// ─── Status pendaftaran (tanpa login) ───────────────────────────────────
router.post('/status', (req, res: Response) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ error: 'Email is required' })

    const user = db.prepare('SELECT id, approved, email_verified, role FROM users WHERE email = ?').get(String(email).toLowerCase()) as
      | { id: number; approved: number; email_verified?: number; role: string }
      | undefined

    if (!user) return res.json({ found: false })

    // Info pembayaran member (terbaru) untuk ditampilkan di halaman status
    const payment = db.prepare(
      'SELECT amount, status, proof_note, admin_note, created_at FROM membership_payments WHERE user_id = ? ORDER BY id DESC LIMIT 1'
    ).get(user.id) as { amount: number; status: string; proof_note: string; admin_note: string; created_at: string } | undefined

    res.json({
      found: true,
      approved: !!user.approved,
      emailVerified: !!user.email_verified,
      isAdmin: user.role === 'admin',
      payment: payment
        ? {
            amount: payment.amount,
            status: payment.status,
            proofNote: payment.proof_note,
            adminNote: payment.admin_note,
            createdAt: payment.created_at,
          }
        : null,
    })
  } catch (error) {
    console.error('Status error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── Lupa password ──────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res: Response) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ error: 'Email is required' })

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase()) as UserRow | undefined

    // Respons selalu sama agar email tidak bisa "ditebak" ada/tidak
    if (!user) return res.json({ ok: true })

    let devLink: string | null = null
    try {
      devLink = await sendResetEmail(user)
    } catch (err: any) {
      console.error('Send reset email error:', err.message)
    }

    res.json({ ok: true, devResetLink: devLink })
  } catch (error) {
    console.error('Forgot password error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/reset-password', async (req, res: Response) => {
  try {
    const { token, password } = req.body
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' })
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter' })
    }

    const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token) as UserRow | undefined
    if (!user) return res.status(400).json({ error: 'Token reset tidak valid' })

    const expires = user.reset_expires ? new Date(user.reset_expires).getTime() : 0
    if (Date.now() > expires) {
      return res.status(400).json({ error: 'Token reset sudah kedaluwarsa. Minta ulang link baru.' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    db.prepare(
      'UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(hashedPassword, user.id)

    res.json({ ok: true, message: 'Password berhasil direset. Silakan login.' })
  } catch (error) {
    console.error('Reset password error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── Verifikasi email (dari link di email) ──────────────────────────────
router.get('/verify-email', (req, res: Response) => {
  try {
    const token = String(req.query.token || '')
    if (!token) return res.redirect(`${appUrl()}/login?verified=0`)

    const user = db.prepare('SELECT * FROM users WHERE email_verify_token = ?').get(token) as UserRow | undefined
    if (!user) return res.redirect(`${appUrl()}/login?verified=0`)

    const expires = user.email_verify_expires ? new Date(user.email_verify_expires).getTime() : 0
    if (Date.now() > expires) {
      return res.redirect(`${appUrl()}/login?verified=0`)
    }

    db.prepare(
      'UPDATE users SET email_verified = 1, email_verify_token = NULL, email_verify_expires = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(user.id)

    res.redirect(`${appUrl()}/login?verified=1`)
  } catch (error) {
    console.error('Verify email error:', error)
    res.redirect(`${appUrl()}/login?verified=0`)
  }
})

export default router
