import { Router } from 'express'
import db from '../db.js'
import { authenticateToken, type AuthRequest } from '../middleware/auth.js'

const router = Router()

interface GenerationLogRow {
  id: number
  user_id: number
  page: string
  provider: string
  model: string
  prompt: string
  credits: number
  slot_count: number
  status: string
  result_url: string | null
  error: string | null
  duration_ms: number | null
  created_at: string
}

// POST /api/logs/generation — save a generation event
router.post('/', authenticateToken, (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { page, provider, model, prompt, credits, slot_count, status, result_url, error, duration_ms } = req.body

    if (!page || !provider || !model) {
      return res.status(400).json({ error: 'page, provider, model are required' })
    }

    const stmt = db.prepare(`
      INSERT INTO generation_logs (user_id, page, provider, model, prompt, credits, slot_count, status, result_url, error, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      userId,
      page,
      provider,
      model,
      (prompt || '').slice(0, 2000),
      credits || 0,
      slot_count || 1,
      status || 'pending',
      result_url || null,
      error ? String(error).slice(0, 1000) : null,
      duration_ms || null
    )

    res.json({ ok: true, id: result.lastInsertRowid })
  } catch (err: any) {
    console.error('[generation-logs] insert error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/logs/:id — update status/result of a generation log
router.patch('/:id', authenticateToken, (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const logId = Number(req.params.id)
    if (!logId) return res.status(400).json({ error: 'Invalid log id' })

    const { status, result_url, error, duration_ms } = req.body

    const sets: string[] = []
    const vals: any[] = []

    if (status !== undefined) { sets.push('status = ?'); vals.push(status) }
    if (result_url !== undefined) { sets.push('result_url = ?'); vals.push(result_url) }
    if (error !== undefined) { sets.push('error = ?'); vals.push(String(error).slice(0, 1000)) }
    if (duration_ms !== undefined) { sets.push('duration_ms = ?'); vals.push(duration_ms) }

    if (sets.length === 0) return res.json({ ok: true })

    vals.push(logId, userId)
    db.prepare(`UPDATE generation_logs SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals)

    res.json({ ok: true })
  } catch (err: any) {
    console.error('[generation-logs] update error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/logs/generation — list logs for current user
router.get('/', authenticateToken, (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const offset = Number(req.query.offset) || 0

    const rows = db.prepare(
      'SELECT * FROM generation_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(userId, limit, offset) as GenerationLogRow[]

    const total = (db.prepare(
      'SELECT COUNT(*) as count FROM generation_logs WHERE user_id = ?'
    ).get(userId) as { count: number }).count

    res.json({ logs: rows, total })
  } catch (err: any) {
    console.error('[generation-logs] list error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
