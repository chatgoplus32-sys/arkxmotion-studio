// ─── Relay AI ARKX AUTO Studio (kunci Gemini milik server) ──────────────────
// Studio sebelumnya memanggil generativelanguage.googleapis.com langsung dari
// browser dengan API key member sendiri. Relay ini menggantinya supaya member
// Pro/Unlimited tidak perlu punya kunci Google: kunci disimpan di server
// (app_settings 'studio_gemini_key' atau env GEMINI_API_KEY), dan setiap
// panggilan dicatat untuk batas harian.
//
// Bentuk request/response sengaja identik dengan endpoint Gemini asli supaya
// bundle Studio cukup dialihkan URL-nya oleh shim di index.html.
import { Router, Response } from 'express'
import { Readable } from 'node:stream'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import {
  GEMINI_BASE,
  markStudioModelUnavailable,
  parseStudioTarget,
  recordStudioUsage,
  studioDailyCap,
  studioEntitlement,
  studioGeminiKey,
  studioModelOrder,
  studioUsageToday,
} from '../lib/studioAi.js'

const router = Router()

function geminiError(code: number, message: string, status: string) {
  return { error: { code, message, status } }
}

router.get('/status', (_req, res: Response) => {
  res.json({
    ok: true,
    configured: !!studioGeminiKey(),
    dailyCap: studioDailyCap(),
  })
})

router.get('/usage', authenticateToken, (req: AuthRequest, res: Response) => {
  const userId = req.user?.id
  const ent = studioEntitlement(userId)
  const dailyCap = studioDailyCap()
  const used = userId ? studioUsageToday(userId) : 0
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    ok: true,
    configured: !!studioGeminiKey(),
    eligible: ent.ok,
    reason: ent.reason,
    dailyCap,
    used,
    remaining: Math.max(0, dailyCap - used),
  })
})

/**
 * POST /api/public/studio-ai/v1beta/models/:target
 *
 * `:target` berbentuk `<model>:<method>`, mis. `gemini-3-flash-preview:generateContent`.
 * Query string klien (mis. `?alt=sse`) diteruskan apa adanya.
 */
router.post('/v1beta/models/:target', authenticateToken, async (req: AuthRequest, res: Response) => {
  const rawTarget = Array.isArray(req.params.target) ? req.params.target[0] : req.params.target
  const target = parseStudioTarget(rawTarget ?? '')
  if (!target) {
    return res
      .status(400)
      .json(geminiError(400, 'Model/method Gemini ini tidak didukung relay Studio.', 'INVALID_ARGUMENT'))
  }

  const userId = req.user?.id
  const ent = studioEntitlement(userId)
  if (!ent.ok) {
    if (ent.reason === 'login') {
      return res.status(401).json(geminiError(401, 'Sesi login tidak dikenali — muat ulang aplikasi lalu coba lagi.', 'UNAUTHENTICATED'))
    }
    return res
      .status(402)
      .json(geminiError(402, 'AI Studio memakai kunci server dan hanya tersedia untuk member Pro / Unlimited. Upgrade dulu untuk memakainya.', 'PERMISSION_DENIED'))
  }

  const apiKey = studioGeminiKey()
  if (!apiKey) {
    return res
      .status(503)
      .json(geminiError(503, 'Kunci Gemini server belum diisi admin. Tambahkan "studio_gemini_key" di System Settings.', 'UNAVAILABLE'))
  }

  const cap = studioDailyCap()
  if (userId) {
    const used = studioUsageToday(userId)
    if (used >= cap) {
      return res
        .status(429)
        .json(geminiError(429, `Batas AI Studio hari ini tercapai (${used}/${cap}). Coba lagi besok.`, 'RESOURCE_EXHAUSTED'))
    }
  }

  const queryIndex = req.originalUrl.indexOf('?')
  const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : ''
  const startedAt = Date.now()
  let usedModel = target.model

  try {
    // Model yang dipaku Studio bisa ditolak kuota/404 pada kunci server; coba
    // model cadangan hanya untuk dua status itu dan hanya bila belum ada byte
    // yang dikirim ke klien.
    const models = studioModelOrder(target.model)
    let upstream: globalThis.Response | null = null
    for (let i = 0; i < models.length; i++) {
      const model = models[i]
      const attempt = await fetch(`${GEMINI_BASE}/v1beta/models/${model}:${target.method}${query}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          Accept: String(req.headers.accept || 'application/json'),
        },
        body: JSON.stringify(req.body ?? {}),
      })
      usedModel = model
      const bisaCadangan = i < models.length - 1 && (attempt.status === 404 || attempt.status === 429)
      if (!bisaCadangan) { upstream = attempt; break }
      // Body wajib dibaca supaya koneksi upstream tidak menggantung.
      await attempt.text().catch(() => '')
      markStudioModelUnavailable(model)
      console.warn(`[studio-ai] model ${model} ditolak (HTTP ${attempt.status}) — mencoba ${models[i + 1]}`)
    }
    if (!upstream) {
      return res
        .status(502)
        .json(geminiError(502, 'Semua model Gemini untuk AI Studio sedang menolak permintaan.', 'UNAVAILABLE'))
    }

    const ms = Date.now() - startedAt
    if (userId) recordStudioUsage(userId, usedModel, target.method, upstream.status, ms)

    const contentType = upstream.headers.get('content-type') || 'application/json'
    res.status(upstream.status)
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'no-store')

    const isStream = contentType.includes('text/event-stream') || target.method === 'streamGenerateContent'
    if (isStream && upstream.body) {
      Readable.fromWeb(upstream.body as any).pipe(res)
      return
    }
    const text = await upstream.text()
    res.send(text)
  } catch (err) {
    const ms = Date.now() - startedAt
    if (userId) recordStudioUsage(userId, usedModel, target.method, 0, ms)
    console.error('[studio-ai] upstream error:', (err as Error)?.message)
    res
      .status(502)
      .json(geminiError(502, 'Gagal menghubungi Gemini dari server. Coba lagi sebentar lagi.', 'UNAVAILABLE'))
  }
})

export default router
