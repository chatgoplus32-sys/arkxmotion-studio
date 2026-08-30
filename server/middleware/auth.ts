import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET env var is required')
  return secret
}

export interface AuthRequest extends Request {
  user?: {
    id: number
    email: string
    role: string
  }
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'Access token required' })
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { id: number; email: string; role: string }
    req.user = decoded
    next()
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token' })
  }
}

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}
