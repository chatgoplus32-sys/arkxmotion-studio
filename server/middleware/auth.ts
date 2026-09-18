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

/**
 * Identitas wajib. Token hilang ATAU tidak sah/kedaluwarsa sama-sama dijawab
 * **401**, bukan 403.
 *
 * Kenapa ini penting: access token app cuma hidup 15 menit (ACCESS_EXPIRES di
 * routes/auth.ts), jadi "kedaluwarsa" adalah keadaan normal, bukan pelanggaran
 * izin. App memutuskan mau refresh diam-diam atau logout dari kode respons, dan
 * dulu ia hanya menangani 401 — sementara middleware ini menjawab 403, sehingga
 * setiap 15 menit sesi yang masih bisa di-refresh malah dipaksa logout, dan
 * poller auto-sync (7 provider tiap 10 detik) menghujani server dengan 403
 * "Invalid or expired token" yang tidak ada satu pun pemakainya.
 *
 * 403 tetap dipakai untuk arti sebenarnya: sudah terautentikasi tapi memang
 * tidak berhak (`requireAdmin` di bawah), sama seperti versi Vercel
 * (api/sync-tokens.ts) yang sejak awal menjawab 401 untuk kasus ini.
 */
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
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}
