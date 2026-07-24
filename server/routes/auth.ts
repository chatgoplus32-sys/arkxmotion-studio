import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'arkxmotion-studio-secret-key-2026'

interface UserRow {
  id: number
  email: string
  password: string
  name: string
  role: string
  approved: number
  created_at: string
  updated_at: string
}

router.post('/register', async (req, res: Response) => {
  try {
    const { email, password, name } = req.body

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' })
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as UserRow | undefined
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const result = db.prepare(
      'INSERT INTO users (email, password, name, role, approved) VALUES (?, ?, ?, ?, ?)'
    ).run(email, hashedPassword, name, 'user', 0)

    res.status(201).json({
      message: 'Registration successful. Please wait for admin approval.',
      user: {
        id: result.lastInsertRowid,
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

export default router
