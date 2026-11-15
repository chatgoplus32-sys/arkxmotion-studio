// ─── Gemini TTS untuk ARKX AUTO Motion (Explainer Studio) ───────────────────
// Halaman statis /auto-motion/ memanggil endpoint same-origin ini untuk membuat
// voice-over Gemini (naskah dikirim ke server HANYA saat pengguna menekan
// "Buat voice-over"). Kunci memakai gerbang yang sama dengan AI Studio:
// app_settings 'studio_gemini_key' dengan cadangan env GEMINI_API_KEY, dan
// pencatatan pemakaian di studio_ai_usage (ikut batas harian AI Studio).
//
// Port dari worker.mjs paket source (auto-motion-source/worker.mjs) ke Express,
// dengan dua penyesuaian:
//   1. Gerbang akses memakai cookie httpOnly `arkx_session` (refresh JWT) +
//      plan Pro/admin — sama seperti requireProPage, tapi jawaban JSON.
//   2. Tidak ada pemeriksaan Origin yang ketat: halaman dilayani same-origin
//      di belakang gate; klien tidak mengirim header Origin yang bisa dipercaya
//      di semua browser.
import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import db from '../db.js'
import { recordStudioUsage, studioDailyCap, studioGeminiKey, studioUsageToday } from '../lib/studioAi.js'

const router = Router()

const REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || (process.env.JWT_SECRET || '') + '-refresh'

const ALLOWED_VOICES = new Set([
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
])

// Arah pembacaan TIDAK PERNAH jadi narasi — dipisah dari teks.
const DELIVERY: Record<string, string> = {
  natural: 'natural, clear, conversational',
  warm: 'warm, friendly, sincere',
  energetic: 'energetic, confident, lively',
  calm: 'calm, gentle, unhurried',
  professional: 'professional, clear, confident',
  storytelling: 'expressive, engaging storytelling',
}

const TTS_MODEL = 'gemini-3.8-flash-tts'
const MAX_TEXT_CHARS = 2500
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT = 6
const rateBuckets = new Map<string, { start: number; count: number }>()

type ProContext = { id: number; ok: boolean }

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = req.headers.cookie
  if (typeof raw !== 'string') return out
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) {
      try { out[k] = decodeURIComponent(v) } catch { out[k] = v }
    }
  }
  return out
}

/**
 * Gerbang Pro via cookie httpOnly `arkx_session` (refresh JWT). Jawaban JSON
 * karena endpoint ini dikonsumsi fetch() dari halaman statis, bukan navigasi.
 * Mengembalikan konteks user bila lolos, atau null (respons sudah dikirim).
 */
function requireProApi(req: Request, res: Response): ProContext | null {
  const raw = parseCookies(req)['arkx_session']
  if (!raw) {
    res.status(401).json({ error: 'unauthenticated' })
    return null
  }
  try {
    const payload = jwt.verify(raw, REFRESH_SECRET) as { kind?: string; id?: number }
    if (payload.kind !== 'refresh' || !payload.id) {
      res.status(401).json({ error: 'unauthenticated' })
      return null
    }
    const row = db
      .prepare('SELECT role, plan, approved, refresh_token FROM users WHERE id = ?')
      .get(payload.id) as
      | { role?: string; plan?: string; approved?: number; refresh_token?: string }
      | undefined
    if (!row || row.refresh_token !== raw) {
      res.status(401).json({ error: 'unauthenticated' })
      return null
    }
    const isPro = row.role === 'admin' || row.plan === 'pro'
    if (!isPro) {
      res.status(403).json({ error: 'pro_required' })
      return null
    }
    return { id: payload.id, ok: true }
  } catch {
    res.status(401).json({ error: 'unauthenticated' })
    return null
  }
}

function rateLimit(key: string): number {
  const now = Date.now()
  const prior = rateBuckets.get(key)
  if (!prior || now - prior.start >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { start: now, count: 1 })
    return 0
  }
  if (prior.count >= RATE_LIMIT) {
    return Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - prior.start)) / 1000))
  }
  prior.count += 1
  if (rateBuckets.size > 3000) {
    for (const [k, v] of rateBuckets) {
      if (now - v.start >= RATE_WINDOW_MS) rateBuckets.delete(k)
      if (rateBuckets.size <= 2500) break
    }
  }
  return 0
}

function jsonError(res: Response, status: number, code: string, extra?: Record<string, unknown>) {
  res.status(status).setHeader('Cache-Control', 'no-store, private').json({ error: code, ...extra })
}

function isWav(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 44 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WAVE'
  )
}

function wrapPcmAsWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  if (!pcm.length || pcm.length % 2) throw new Error('invalid-pcm')
  const wav = new Uint8Array(44 + pcm.length)
  const view = new DataView(wav.buffer)
  const write = (offset: number, value: string) =>
    [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  write(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); write(8, 'WAVE')
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true)
  view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, pcm.length, true)
  wav.set(pcm, 44)
  return wav
}

// Status TTS — aman dipanggil tanpa auth (hanya boolean "configured").
router.get('/tts/status', (_req, res: Response) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ configured: !!studioGeminiKey(), maxChars: MAX_TEXT_CHARS })
})

router.post('/tts', async (req, res: Response) => {
  const ctx = requireProApi(req, res)
  if (!ctx) return

  const apiKey = studioGeminiKey()
  if (!apiKey) return jsonError(res, 503, 'tts_not_configured')

  const cap = studioDailyCap()
  const used = studioUsageToday(ctx.id)
  if (used >= cap) return jsonError(res, 429, 'rate_limited', { retryAfter: 3600 })

  const retryAfter = rateLimit(String(ctx.id))
  if (retryAfter) {
    res.setHeader('Retry-After', String(retryAfter))
    return jsonError(res, 429, 'rate_limited', { retryAfter })
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return jsonError(res, 400, 'invalid_json')
  }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const voice = typeof body.voice === 'string' ? body.voice : ''
  const delivery = typeof body.delivery === 'string' ? body.delivery : 'natural'
  if (!text) return jsonError(res, 400, 'text_required')
  if (text.length > MAX_TEXT_CHARS) return jsonError(res, 413, 'text_too_long', { maxChars: MAX_TEXT_CHARS })
  if (!ALLOWED_VOICES.has(voice)) return jsonError(res, 400, 'voice_invalid')
  if (!Object.prototype.hasOwnProperty.call(DELIVERY, delivery)) {
    return jsonError(res, 400, 'delivery_invalid')
  }

  const startedAt = Date.now()
  let upstream: globalThis.Response
  try {
    upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text, speech_metadata: { style: DELIVERY[delivery] } }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            responseFormat: { audio: { mimeType: 'AUDIO_WAV', sampleRate: 24000 } },
            speechConfig: { voiceConfig: { voice } },
          },
        }),
        signal: AbortSignal.timeout(75000),
      },
    )
  } catch (error) {
    recordStudioUsage(ctx.id, TTS_MODEL, 'tts', 0, Date.now() - startedAt)
    const name = (error as Error)?.name
    return jsonError(res, 502, name === 'TimeoutError' || name === 'AbortError' ? 'tts_timeout' : 'tts_unavailable')
  }

  const ms = Date.now() - startedAt
  recordStudioUsage(ctx.id, TTS_MODEL, 'tts', upstream.status, ms)

  if (!upstream.ok) {
    // Jangan pernah meneruskan body upstream (bisa memuat detail sensitif).
    if (upstream.status === 429) {
      res.setHeader('Retry-After', '30')
      return jsonError(res, 429, 'tts_quota')
    }
    if (upstream.status === 401 || upstream.status === 403) return jsonError(res, 502, 'tts_permission_denied')
    if (upstream.status === 404) return jsonError(res, 502, 'tts_model_unavailable')
    if (upstream.status === 400) return jsonError(res, 422, 'tts_request_rejected')
    return jsonError(res, 502, 'tts_unavailable')
  }

  let response: any
  try {
    response = await upstream.json()
  } catch {
    return jsonError(res, 502, 'tts_empty')
  }
  const parts = response?.candidates?.[0]?.content?.parts || []
  const audioPart = parts.find((part: any) => part?.inlineData?.data || part?.inline_data?.data)
  const encoded = audioPart?.inlineData?.data || audioPart?.inline_data?.data
  if (!encoded) return jsonError(res, 502, 'tts_empty')

  try {
    const binary = Buffer.from(encoded, 'base64')
    let bytes: Uint8Array = new Uint8Array(binary)
    const mime = String(
      audioPart?.inlineData?.mimeType || audioPart?.inline_data?.mime_type || '',
    ).toLowerCase()
    if (!isWav(bytes) && /^audio\/(l16|pcm)(;|$)/.test(mime)) {
      const rate = Number(mime.match(/rate=(\d+)/)?.[1] || 24000)
      bytes = wrapPcmAsWav(
        bytes,
        [8000, 16000, 22050, 24000, 44100, 48000].includes(rate) ? rate : 24000,
      )
    }
    if (!isWav(bytes)) return jsonError(res, 502, 'tts_format_invalid')
    res.setHeader('Content-Type', 'audio/wav')
    res.setHeader('Content-Length', String(bytes.byteLength))
    res.setHeader('Cache-Control', 'no-store, private')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Disposition', 'inline; filename="arkx-auto-motion-voice-over.wav"')
    res.send(Buffer.from(bytes))
  } catch {
    return jsonError(res, 502, 'tts_format_invalid')
  }
})

export default router
