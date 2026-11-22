import { Router, Response } from 'express'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import { createTiktokTask, getTiktokTask, TiktokApiError } from '../lib/tiktokSymphony.js'

const router = Router()

/**
 * Proxy generate TikTok Symphony. Kredensial (Access-Token + tto_id) dibaca
 * server dari app_settings — klien tidak pernah mengirim/menyimpan kunci.
 * Semua endpoint butuh login supaya tidak dipakai pihak tanpa akun.
 */
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  const action = String(req.query.action || req.body?.action || 'generate')
  try {
    if (action === 'generate') {
      const { prompt, model, imageUrl, endFrameUrl, referenceImageUrls, duration, ratio, resolution, generateAudio } = req.body || {}
      if (!prompt || String(prompt).trim().length < 3) {
        return res.status(400).json({ ok: false, error: 'Prompt wajib diisi' })
      }
      const taskId = await createTiktokTask({
        prompt: String(prompt).trim(),
        model: model || 'SEEDANCE_2_0_FAST',
        imageUrl: imageUrl || null,
        endFrameUrl: endFrameUrl || null,
        referenceImageUrls: Array.isArray(referenceImageUrls) ? referenceImageUrls : [],
        duration: Number(duration) || 5,
        ratio: ratio || undefined,
        resolution: resolution || undefined,
        generateAudio: typeof generateAudio === 'boolean' ? generateAudio : true,
      })
      return res.json({ ok: true, taskId })
    }
    if (action === 'status') {
      const taskId = String(req.query.taskId || req.body?.taskId || '')
      if (!taskId) return res.status(400).json({ ok: false, error: 'taskId wajib diisi' })
      const status = await getTiktokTask(taskId)
      return res.json({ ok: true, ...status })
    }
    return res.status(400).json({ ok: false, error: 'Aksi tidak dikenal' })
  } catch (error: any) {
    if (error instanceof TiktokApiError) {
      console.warn('[tiktok] error:', error.code, error.subcode, error.message)
      return res.status(502).json({ ok: false, error: error.message, code: error.code, subcode: error.subcode })
    }
    console.error('[tiktok] proxy error:', error)
    res.status(502).json({ ok: false, error: error?.message || 'Gagal menghubungi TikTok Symphony' })
  }
})

export default router
