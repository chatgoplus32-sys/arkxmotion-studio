// ─── Job generasi yang bertahan lintas-tab ────────────────────────────────
//
// Sebelumnya task hanya hidup di memori browser: begitu tab ditutup, job
// NexaBot/PosBot tidak bisa dilanjutkan walau job-nya masih jalan di upstream.
// Browser sekarang mencatat jobId ke tabel ini saat mulai polling; halaman yang
// dibuka lagi memanggil resume lalu melanjutkan polling sampai hasil tersimpan.
//
// Token/kunci provider TIDAK disimpan di sini — hanya jobId dan metadata
// tampilan. Resume memakai kunci server (relay), jadi job yang dulu memakai
// kunci pribadi member akan berhenti dengan pesan jelas, bukan diam-diam.
import { Router, type Response } from 'express'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(authenticateToken)

const PROVIDERS = new Set(['nexabot', 'posbot'])
/** Job lebih tua dari ini dianggap basi dan tidak ditawarkan untuk resume. */
const RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface GenerationJobRow {
  id: number
  user_id: number
  provider: string
  job_id: string
  page: string
  model: string
  prompt: string
  status: string
  result_url: string
  last_error: string
  created_at: number
  updated_at: number
}

function userIdOf(req: AuthRequest, res: Response): number | null {
  const userId = req.user?.id
  if (!userId) {
    res.status(401).json({ error: 'Access token required' })
    return null
  }
  return userId
}

/** POST /api/generation-jobs — catat job yang mulai dipoll (idempoten per job). */
router.post('/', (req: AuthRequest, res: Response) => {
  const userId = userIdOf(req, res)
  if (!userId) return
  const provider = String(req.body?.provider || '')
  const jobId = String(req.body?.jobId || '').trim()
  if (!PROVIDERS.has(provider) || !jobId) {
    return res.status(400).json({ error: 'provider/jobId tidak valid' })
  }
  const now = Date.now()
  try {
    db.prepare(
      `INSERT INTO generation_job (user_id, provider, job_id, page, model, prompt, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(user_id, provider, job_id) DO UPDATE SET
         page = excluded.page,
         model = excluded.model,
         prompt = excluded.prompt,
         status = CASE WHEN generation_job.status = 'done' THEN 'done' ELSE 'pending' END,
         updated_at = excluded.updated_at`,
    ).run(
      userId,
      provider,
      jobId,
      String(req.body?.page || '').slice(0, 40),
      String(req.body?.model || '').slice(0, 80),
      String(req.body?.prompt || '').slice(0, 500),
      now,
      now,
    )
    res.json({ ok: true })
  } catch (error: any) {
    console.error('[generation-jobs] track gagal:', error?.message || error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/** GET /api/generation-jobs — job yang masih bisa dilanjutkan. */
router.get('/', (req: AuthRequest, res: Response) => {
  const userId = userIdOf(req, res)
  if (!userId) return
  try {
    const rows = db
      .prepare(
        `SELECT id, provider, job_id, page, model, prompt, status, result_url, created_at, updated_at
         FROM generation_job
         WHERE user_id = ? AND status IN ('pending', 'processing') AND updated_at > ?
         ORDER BY updated_at DESC LIMIT 20`,
      )
      .all(userId, Date.now() - RESUME_MAX_AGE_MS) as GenerationJobRow[]
    res.json({ ok: true, jobs: rows })
  } catch (error: any) {
    console.error('[generation-jobs] list gagal:', error?.message || error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/** PATCH /api/generation-jobs/:id — tandai selesai/gagal beserta URL hasil. */
router.patch('/:id', (req: AuthRequest, res: Response) => {
  const userId = userIdOf(req, res)
  if (!userId) return
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID tidak valid' })
  const status = String(req.body?.status || '')
  if (!['pending', 'processing', 'done', 'failed'].includes(status)) {
    return res.status(400).json({ error: 'status tidak valid' })
  }
  try {
    const hasil = db
      .prepare(
        `UPDATE generation_job SET status = ?, result_url = ?, last_error = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(
        status,
        String(req.body?.resultUrl || '').slice(0, 500),
        String(req.body?.error || '').slice(0, 300),
        Date.now(),
        id,
        userId,
      )
    if (!hasil.changes) return res.status(404).json({ error: 'Job tidak ditemukan' })
    res.json({ ok: true })
  } catch (error: any) {
    console.error('[generation-jobs] update gagal:', error?.message || error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/** DELETE /api/generation-jobs/:id — user membuang job dari daftar resume. */
router.delete('/:id', (req: AuthRequest, res: Response) => {
  const userId = userIdOf(req, res)
  if (!userId) return
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID tidak valid' })
  try {
    db.prepare('DELETE FROM generation_job WHERE id = ? AND user_id = ?').run(id, userId)
    res.json({ ok: true })
  } catch (error: any) {
    console.error('[generation-jobs] hapus gagal:', error?.message || error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
