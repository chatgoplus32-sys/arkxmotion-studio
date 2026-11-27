import { Router, Response } from 'express'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import { museRequest, MuseApiError } from '../lib/museAi.js'

const router = Router()

/**
 * Proxy MuseAI (MusangAPI). Kredensial MUSE2API_KEY dibaca server dari
 * app_settings/env — klien tidak pernah mengirim kunci. Semua endpoint butuh
 * login. Member membayar lewat wallet muse_balance (deduct/refund di
 * /api/muse/deduct|refund), server yang memasang kunci ke MusangAPI.
 */
router.all('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const action = String(req.query.action || req.body?.action || 'chat')
  try {
    if (action === 'chat') {
      const { messages, model, stream, max_tokens } = req.body || {}
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ ok: false, error: 'messages wajib diisi' })
      }
      const body: Record<string, any> = {
        model: model || 'muse-spark',
        messages,
        stream: false,
      }
      if (max_tokens) body.max_tokens = max_tokens
      // MusangAPI mendukung stream SSE, tapi untuk Relay kita pakai non-stream
      // supaya response konsisten & mudah dicatat.
      const data = await museRequest('/chat/completions', body, { timeoutMs: 300000 })
      return res.json({ ok: true, data })
    }
    if (action === 'image') {
      const { prompt, size, n, images } = req.body || {}
      if (!prompt || !String(prompt).trim()) return res.status(400).json({ ok: false, error: 'prompt wajib diisi' })
      const body: Record<string, any> = {
        model: 'muse-image',
        prompt: String(prompt).trim(),
        size: size || '16:9',
        response_format: 'url',
      }
      if (n) body.n = n
      if (Array.isArray(images) && images.length) body.images = images
      const data = await museRequest('/images/generations', body, { timeoutMs: 300000 })
      return res.json({ ok: true, data })
    }
    if (action === 'video-create') {
      const { prompt, duration, size, idempotency_key } = req.body || {}
      if (!prompt || !String(prompt).trim()) return res.status(400).json({ ok: false, error: 'prompt wajib diisi' })
      const body: Record<string, any> = {
        model: 'muse-video',
        prompt: String(prompt).trim(),
        duration: Number(duration) || 10,
        size: size || '16:9',
      }
      const headers: Record<string, string> = {}
      if (idempotency_key) headers['Idempotency-Key'] = String(idempotency_key)
      const data = await museRequest('/videos', body, { timeoutMs: 60000, headers: Object.keys(headers).length ? headers : undefined })
      return res.json({ ok: true, data })
    }
    if (action === 'video-status') {
      const taskId = String(req.query.taskId || req.body?.taskId || '')
      if (!taskId) return res.status(400).json({ ok: false, error: 'taskId wajib diisi' })
      const data = await museRequest(`/videos/${encodeURIComponent(taskId)}`, {}, { method: 'GET', timeoutMs: 60000 })
      return res.json({ ok: true, data })
    }
    return res.status(400).json({ ok: false, error: 'Aksi tidak dikenal' })
  } catch (error: any) {
    if (error instanceof MuseApiError) {
      console.warn('[muse] error:', error.status, error.message)
      return res.status(502).json({ ok: false, error: error.message, status: error.status })
    }
    console.error('[muse] proxy error:', error)
    res.status(502).json({ ok: false, error: error?.message || 'Gagal menghubungi MuseAI' })
  }
})

export default router
