import type { VercelRequest, VercelResponse } from '@vercel/node'
import jwt from 'jsonwebtoken'
import { neon } from '@neondatabase/serverless'

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return neon(url)
}

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('JWT_SECRET env var is required')

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function verifyUser(req: VercelRequest): { id: number; email: string; role: string } | null {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return null
  try {
    return jwt.verify(token, JWT_SECRET) as { id: number; email: string; role: string }
  } catch {
    return null
  }
}

let tableReady = false

async function ensureTable(sql: ReturnType<typeof neon>) {
  if (tableReady) return
  try {
    await sql`CREATE TABLE IF NOT EXISTS generation_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      page TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      credits INTEGER DEFAULT 0,
      slot_count INTEGER DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      result_url TEXT DEFAULT NULL,
      error TEXT DEFAULT NULL,
      duration_ms INTEGER DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
    await sql`CREATE INDEX IF NOT EXISTS idx_generation_logs_user_id ON generation_logs(user_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_generation_logs_created_at ON generation_logs(created_at)`
    tableReady = true
  } catch (e) {
    console.error('[generation-logs] ensureTable failed:', e)
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = verifyUser(req)
  if (!user) return res.status(403).json({ error: 'Access denied' })

  try {
    const sql = getSql()
    await ensureTable(sql)

    const urlPath = req.url?.split('?')[0] || ''
    const segments = urlPath.split('/').filter(Boolean)
    const logId = segments.length >= 4 ? parseInt(segments[3]) : null

    // POST /api/logs/generation — create new log
    if (req.method === 'POST') {
      const { page, provider, model, prompt, credits, slot_count, status } = req.body || {}
      if (!page || !provider || !model) {
        return res.status(400).json({ error: 'page, provider, model are required' })
      }
      const rows: any[] = await sql`
        INSERT INTO generation_logs (user_id, page, provider, model, prompt, credits, slot_count, status)
        VALUES (${user.id}, ${page}, ${provider}, ${model}, ${prompt || ''}, ${credits || 0}, ${slot_count || 1}, ${status || 'pending'})
        RETURNING id
      `
      return res.status(200).json({ id: rows[0]?.id ?? null })
    }

    // PATCH /api/logs/generation/:id — update log
    if (req.method === 'PATCH' && logId) {
      const updates = req.body || {}
      const { status, result_url, error, duration_ms, credits } = updates

      if (status !== undefined) {
        await sql`UPDATE generation_logs SET status = ${status} WHERE id = ${logId} AND user_id = ${user.id}`
      }
      if (result_url !== undefined) {
        await sql`UPDATE generation_logs SET result_url = ${result_url} WHERE id = ${logId} AND user_id = ${user.id}`
      }
      if (error !== undefined) {
        await sql`UPDATE generation_logs SET error = ${error} WHERE id = ${logId} AND user_id = ${user.id}`
      }
      if (duration_ms !== undefined) {
        await sql`UPDATE generation_logs SET duration_ms = ${duration_ms} WHERE id = ${logId} AND user_id = ${user.id}`
      }
      if (credits !== undefined) {
        await sql`UPDATE generation_logs SET credits = ${credits} WHERE id = ${logId} AND user_id = ${user.id}`
      }
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    console.error('[generation-logs] error:', e?.message || e)
    return res.status(200).json({ ok: false, error: e?.message || 'Internal error' })
  }
}
