import jwt from 'jsonwebtoken'
import type { Request } from 'express'

/**
 * Verifikasi JWT app (access token 15 menit) dan kembalikan id user.
 *
 * Relay publik (NexaBot, Alriz, Seavi) terbuka: klien boleh memakai kredensial
 * provider miliknya sendiri tanpa akun app. Ketiadaan identitas karena itu
 * keadaan sah — pemanggil yang memutuskan apakah identitasnya diperlukan.
 */
export function userIdFromToken(token: string | null | undefined): number | null {
  if (!token) return null
  try {
    const secret = process.env.JWT_SECRET
    if (!secret) return null
    const decoded = jwt.verify(token, secret) as { id?: number }
    return typeof decoded?.id === 'number' ? decoded.id : null
  } catch {
    return null
  }
}

export function userIdFromRequest(req: Request): number | null {
  const header = req.headers['authorization']
  if (typeof header !== 'string') return null
  return userIdFromToken(header.split(' ')[1])
}
