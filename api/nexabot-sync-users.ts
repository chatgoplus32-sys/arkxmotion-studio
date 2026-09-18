import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql } from '@vercel/postgres'

/**
 * GET /api/nexabot-sync-users
 * 
 * Endpoint untuk Nexabot Proxy sync — mengembalikan daftar user Arkx
 * yang memiliki paket nexabot aktif (kind='unlimited' atau kind='balance').
 * 
 * Query params:
 *   - secret: string (wajib) — secret key untuk autentikasi
 *   - since: ISO timestamp (opsional) — hanya ambil data dari waktu tertentu
 * 
 * Response:
 *   {
 *     users: [
 *       {
 *         id: number,           // user_id di Arkx
 *         email: string,
 *         name: string,
 *         package_kind: 'balance' | 'unlimited',
 *         package_slug: string,  // e.g. 'unlimited_weekly', 'unlimited_monthly'
 *         days: number,
 *         expires_at: string | null,
 *         status: 'pending' | 'approved' | 'rejected',
 *         created_at: string
 *       }
 *     ]
 *   }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const url = process.env.DATABASE_URL
  if (!url) return res.status(500).json({ error: 'DATABASE_URL not configured' })

  // Autentikasi — hanya izinkan Nexabot Proxy yang punya secret
  const secret = req.query.secret || req.headers['x-sync-secret']
  if (secret !== process.env.NEXABOT_SYNC_SECRET) {
    return res.status(403).json({ error: 'Invalid sync secret' })
  }

  try {
    const since = req.query.since as string | undefined

    let result
    if (since) {
      result = await sql`
        SELECT 
          u.id,
          u.email,
          u.name,
          t.kind as package_kind,
          t.package_slug,
          t.days,
          t.expires_at::text,
          t.status,
          t.created_at::text
        FROM users u
        JOIN nexabot_topup t ON u.id = t.user_id
        WHERE t.created_at >= ${since}
        ORDER BY t.created_at DESC
      `
    } else {
      result = await sql`
        SELECT 
          u.id,
          u.email,
          u.name,
          t.kind as package_kind,
          t.package_slug,
          t.days,
          t.expires_at::text,
          t.status,
          t.created_at::text
        FROM users u
        JOIN nexabot_topup t ON u.id = t.user_id
        ORDER BY t.created_at DESC
      `
    }

    return res.status(200).json({ users: result.rows })
  } catch (err: any) {
    console.error('[nexabot-sync-users] Error:', err)
    return res.status(500).json({ error: err.message })
  }
}
