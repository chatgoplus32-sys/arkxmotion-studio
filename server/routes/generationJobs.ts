// ─── Job generasi yang bertahan lintas-tab ────────────────────────────────
//
// Task dulu hanya hidup di memori browser: begitu tab ditutup, job NexaBot/
// PosBot tidak bisa dilanjutkan walau job-nya masih jalan di upstream. Browser
// mencatat jobId ke tabel ini saat mulai polling; aplikasi yang dibuka lagi
// mengklaim job (atomik, jadi dua tab tidak memoll job yang sama) lalu
// melanjutkan polling sampai hasil tersimpan.
//
// Kunci provider TIDAK disimpan di sini — hanya jobId + halaman asal. Resume
// memakai kunci server lewat relay. Queue worker mengimpor konstanta waktu di
// atas supaya grace/klaim/TTL tidak punya dua sumber kebenaran.
import { Router, type Response } from 'express'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(authenticateToken)

const PROVIDERS = new Set(['nexabot', 'posbot'])
/** Job lebih tua dari ini dianggap basi dan tidak ditawarkan untuk resume. */
export const RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000
/**
 * Job yang baru saja dicatat berarti halamannya masih memoll sendiri; resume
 * tidak boleh menyalip dan memoll job yang sama dua kali.
 */
export const TRACK_GRACE_MS = 90 * 1000
/**
 * Klaim dianggap milik tab yang sudah mati setelah ini. Sengaja lebih panjang
 * dari durasi polling resume (±15 menit) supaya polling yang sah tidak direbut
 * tab lain di tengah jalan.
 */
export const CLAIM_TTL_MS = 30 * 60 * 1000

function userIdOf(req: AuthRequest, res: Response): number | null {
  const userId = req.user?.id
  if (!userId) {
    res.status(401).json({ error: 'Access token required' })
    return null
  }
  return userId
}

/** POST /api/generation-jobs — catat job yang mulai dipoll (idempoten). */
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
      `INSERT INTO generation_job (user_id, provider, job_id, page, prompt, status, credential_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
       ON CONFLICT(user_id, provider, job_id) DO UPDATE SET
         page = excluded.page,
         prompt = excluded.prompt,
         status = CASE WHEN generation_job.status IN ('done', 'processing') THEN generation_job.status ELSE 'pending' END,
         credential_source = COALESCE(NULLIF(generation_job.credential_source, ''), excluded.credential_source),
         updated_at = excluded.updated_at`,
    ).run(
      userId,
      provider,
      jobId,
      String(req.body?.page || '').slice(0, 40),
      String(req.body?.prompt || '').slice(0, 500),
      // Default aman 'client': worker TIDAK PERNAH mem-poll upstream tanpa
      // pernyataan eksplisit bahwa job memakai kunci server.
      String(req.body?.credentialSource || '') === 'server' ? 'server' : 'client',
      now,
      now,
    )
    res.json({ ok: true })
  } catch (error: any) {
    console.error('[generation-jobs] track gagal:', error?.message || error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/** GET /api/generation-jobs — job yang bisa dilanjutkan (pending atau klaim basi). */
router.get('/', (req: AuthRequest, res: Response) => {
  const userId = userIdOf(req, res)
  if (!userId) return
  try {
    const now = Date.now()
    const rows = db
      .prepare(
        `SELECT id, provider, job_id, page, prompt, status, result_url, created_at, updated_at
         FROM generation_job
         WHERE user_id = ? AND updated_at > ?
           AND updated_at <= ?
           AND (status = 'pending' OR (status = 'processing' AND updated_at < ?))
         ORDER BY updated_at DESC LIMIT 20`,
      )
      .all(userId, now - RESUME_MAX_AGE_MS, now - TRACK_GRACE_MS, now - CLAIM_TTL_MS)
    res.json({ ok: true, jobs: rows })
  } catch (error: any) {
    console.error('[generation-jobs] list gagal:', error?.message || error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /api/generation-jobs/all — daftar lengkap antrean milik user (semua
 * status), terbaru dulu. GET / di atas hanya mengembalikan job resumable,
 * tidak cukup untuk halaman Antrean. Query: ?status=pending|processing|
 * done|failed&limit=20&offset=0.
 */
router.get('/all', (req: AuthRequest, res: Response) => {
  const userId = userIdOf(req, res)
  if (!userId) return
  const status = String(req.query.status || '')
  if (status && !['pending', 'processing', 'done', 'failed'].includes(status)) {
    return res.status(400).json({ error: 'status tidak valid' })
  }
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20))
  const offset = Math.max(0, Number(req.query.offset) || 0)
  try {
    const where = status ? 'AND status = ?' : ''
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM generation_job WHERE user_id = ? ${where}`)
        .get(status ? [userId, status] : [userId]) as { n: number }
    ).n
    const rows = db
      .prepare(
        `SELECT id, user_id, provider, job_id, page, model, prompt, status, result_url,
                last_error, credential_source, server_poll, poll_misses, notified_at,
                created_at, updated_at
         FROM generation_job
         WHERE user_id = ? ${where}
         ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      )
      .all(status ? [userId, status, limit, offset] : [userId, limit, offset])
    res.json({ ok: true, jobs: rows, total })
  } catch (error: any) {
    console.error('[generation-jobs] antrean gagal:', error?.message || error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /api/generation-jobs/claim/:provider/:jobId — ambil hak melanjutkan job.
 * `claimed: false` berarti tab/perangkat lain sudah memegangnya.
 */
router.post('/claim/:provider/:jobId', (req: AuthRequest, res: Response) => {
  const userId = userIdOf(req, res)
  if (!userId) return
  const provider = String(req.params.provider || '')
  const jobId = String(req.params.jobId || '')
  if (!PROVIDERS.has(provider) || !jobId) return res.status(400).json({ error: 'provider/jobId tidak valid' })
  try {
    const now = Date.now()
    const hasil = db
      .prepare(
        `UPDATE generation_job SET status = 'processing', updated_at = ?
         WHERE user_id = ? AND provider = ? AND job_id = ?
           AND (status = 'pending' OR (status = 'processing' AND updated_at < ?))`,
      )
      .run(now, userId, provider, jobId, now - CLAIM_TTL_MS)
    res.json({ ok: true, claimed: hasil.changes > 0 })
  } catch (error: any) {
    console.error('[generation-jobs] claim gagal:', error?.message || error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/** PATCH /api/generation-jobs/:provider/:jobId — tandai selesai/gagal. */
router.patch('/:provider/:jobId', (req: AuthRequest, res: Response) => {
  const userId = userIdOf(req, res)
  if (!userId) return
  const provider = String(req.params.provider || '')
  const jobId = String(req.params.jobId || '')
  const status = String(req.body?.status || '')
  if (!PROVIDERS.has(provider) || !jobId) return res.status(400).json({ error: 'provider/jobId tidak valid' })
  if (!['done', 'failed', 'pending'].includes(status)) return res.status(400).json({ error: 'status tidak valid' })
  try {
    const hasil = db
      .prepare(
        `UPDATE generation_job SET status = ?, result_url = ?, last_error = ?, updated_at = ?
         WHERE user_id = ? AND provider = ? AND job_id = ? AND status NOT IN ('done', 'failed')`,
      )
      .run(
        status,
        String(req.body?.resultUrl || '').slice(0, 500),
        String(req.body?.error || '').slice(0, 300),
        Date.now(),
        userId,
        provider,
        jobId,
      )
    if (!hasil.changes) return res.status(404).json({ error: 'Job tidak ditemukan' })
    res.json({ ok: true })
  } catch (error: any) {
    console.error('[generation-jobs] update gagal:', error?.message || error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * DELETE /api/generation-jobs/:provider/:jobId — hapus baris job dari antrean.
 * Hanya milik sendiri; tidak menyentuh job di provider (job yang sedang jalan
 * di upstream tetap berjalan sampai selesai/kedaluwarsa di sana).
 */
router.delete('/:provider/:jobId', (req: AuthRequest, res: Response) => {
  const userId = userIdOf(req, res)
  if (!userId) return
  const provider = String(req.params.provider || '')
  const jobId = String(req.params.jobId || '')
  if (!PROVIDERS.has(provider) || !jobId) return res.status(400).json({ error: 'provider/jobId tidak valid' })
  try {
    const hasil = db
      .prepare('DELETE FROM generation_job WHERE user_id = ? AND provider = ? AND job_id = ?')
      .run(userId, provider, jobId)
    if (!hasil.changes) return res.status(404).json({ error: 'Job tidak ditemukan' })
    res.json({ ok: true })
  } catch (error: any) {
    console.error('[generation-jobs] hapus gagal:', error?.message || error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
