import { Router, Request, Response } from 'express'
import {
  NEXABOT_PROXY_POLICY,
  NexabotUpstreamError,
  fetchNexabotUpstream,
  nexabotErrorAdvice,
  nexabotErrorCause,
  nexabotRelayHeaders,
  type NexabotProxyAction,
} from '../../shared/nexabotProxy.js'
import { recordUpstreamUsage } from '../lib/nexabotUpstreamUsage.js'

const router = Router()
// Bisa diarahkan ke host lain: tes menembak upstream tiruan, dan operator bisa
// memakainya untuk staging. Tanpa env, perilakunya sama seperti sebelumnya.
const NEXABOT_BASE = (process.env.NEXABOT_BASE || 'https://nexabot.id').replace(/\/+$/, '')

/**
 * Satu call upstream ke NexaBot dengan timeout & retry sesuai jenis request
 * (lihat shared/nexabotProxy.ts), lalu teruskan status + body apa adanya ke
 * klien. Read-only (saldo/sesi/job/mode) boleh diulang; submit/generate tidak.
 */
async function relayUpstream(
  res: Response,
  action: NexabotProxyAction,
  url: string,
  init: RequestInit,
): Promise<{ status: number; text: string } | null> {
  const { label } = NEXABOT_PROXY_POLICY[action]
  try {
    const { response, attempts, shared } = await fetchNexabotUpstream(url, init, {
      action,
      onRetry: ({ attempt, status, delayMs, message }) =>
        console.warn(
          `[nexabot-local] ${action} percobaan ${attempt} gagal (${message}${status ? ` HTTP ${status}` : ''}) — coba lagi dalam ${delayMs}ms`,
        ),
    })
    const text = await response.text()
    const sharedNote = shared ? ' (single-flight: respons dipakai bersama)' : ''
    console.log(`[nexabot-local] ${action} ${response.status}${attempts > 1 ? ` (percobaan ke-${attempts})` : ''}${sharedNote}: ${text.slice(0, 300)}`)
    res.writeHead(response.status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      // Teruskan Retry-After upstream supaya klien menunggu sesuai anjuran mereka.
      ...nexabotRelayHeaders(response),
    })
    res.end(text)
    // Dikembalikan supaya rute yang mengonsumsi kuota bisa mencatat biaya
    // upstream-nya tanpa membaca body untuk kedua kalinya.
    return { status: response.status, text }
  } catch (err: any) {
    const upstream = err instanceof NexabotUpstreamError ? err : null
    // `cause` = alasan asli dari undici (ECONNRESET, UND_ERR_SOCKET, dst) yang
    // tanpa ini hilang menjadi cuma "fetch failed".
    const cause = nexabotErrorCause(err)
    console.error(`[nexabot-local] ${label} error:`, err?.message, cause ? `(cause: ${cause})` : '')
    res.status(upstream?.timeout ? 504 : 502).json({
      ok: false,
      error: upstream
        ? `${upstream.message} — ${nexabotErrorAdvice(action)}`
        : `${err?.message || `Gagal ${label}`}${cause ? ` (${cause})` : ''}`,
    })
  }
  return null
}

// Mode session: request ditandai dengan cookie login nexabot.id (dikirim klien
// sebagai header X-Nexabot-Cookie karena browser melarang set header `Cookie`).
function sessionHeaders(cookies: string): Record<string, string> {
  return {
    'Cookie': cookies,
    'Origin': NEXABOT_BASE,
    'Referer': `${NEXABOT_BASE}/`,
  }
}

function upstreamAuthHeaders(req: Request): Record<string, string> {
  const cookies = req.headers['x-nexabot-cookie'] as string
  const apiKey = req.headers['x-api-key'] as string
  if (cookies) return sessionHeaders(cookies)
  return apiKey ? { 'x-api-key': apiKey } : {}
}

// Alias query → path: /api/public/nexabot?action=session (juga credit,
// generate, job&id=…, download&id=…) dipetakan ke route path-based di bawah.
// Fallback untuk host/rewrite yang memangkas path (mis. Vercel).
router.use((req: Request, _res: Response, next) => {
  const action = req.query.action as string | undefined
  if (!action || req.path !== '/') return next()
  const id = req.query.id as string | undefined
  if ((action === 'job' || action === 'download') && id) req.url = `/${action}/${id}`
  else req.url = `/${action}`
  next()
})

// ── Health check ──
router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, provider: 'nexabot', timestamp: new Date().toISOString() })
})

// ── Credit check ──
router.get('/credit', async (req: Request, res: Response) => {
  const apiKey = req.headers['x-api-key'] as string
  if (!apiKey) {
    return res.status(400).json({ ok: false, error: 'Missing X-Api-Key header' })
  }

  console.log(`[nexabot-local] GET /api/v1/api/credit`)
  // /credit sering menggantung di sisi NexaBot — timeout 25s × 3 percobaan
  // dengan backoff jauh lebih jarang berakhir 504 daripada sekali 20s.
  await relayUpstream(res, 'credit', `${NEXABOT_BASE}/api/v1/api/credit`, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'Accept': 'application/json',
    },
  })
})

// ── Session info (mode cookie) ──
// Probe status sesi & paket Unlimited lewat endpoint web /api/v1/credits.
router.get('/session', async (req: Request, res: Response) => {
  const cookies = req.headers['x-nexabot-cookie'] as string
  if (!cookies) {
    return res.status(400).json({ ok: false, error: 'Missing X-Nexabot-Cookie header' })
  }

  console.log(`[nexabot-local] GET /api/v1/credits (session probe)`)
  await relayUpstream(res, 'session', `${NEXABOT_BASE}/api/v1/credits`, {
    method: 'GET',
    headers: {
      ...sessionHeaders(cookies),
      'Accept': 'application/json',
    },
  })
})

// ── Submit job ──
router.post('/submit', async (req: Request, res: Response) => {
  const apiKey = req.headers['x-api-key'] as string
  if (!apiKey) {
    return res.status(400).json({ ok: false, error: 'Missing X-Api-Key header' })
  }

  const body = req.body
  console.log(`[nexabot-local] POST /api/v1/api (mode: ${body.mode})`)

  const upstreamBody: Record<string, any> = {
    mode: body.mode,
    prompt: body.prompt,
  }
  if (body.ratio !== undefined) upstreamBody.ratio = body.ratio
  if (body.aspect !== undefined) upstreamBody.aspect = body.aspect
  if (body.voice) upstreamBody.voice = body.voice
  if (body.media) upstreamBody.media = body.media
  // telegram_id = "user id for credit billing" (docs NexaBot) — menentukan
  // akun mana yang ditagih 0.25 cr/request.
  if (body.telegram_id) upstreamBody.telegram_id = body.telegram_id

  // Sengaja TANPA retry: kalau responsnya hilang, job bisa saja sudah terbentuk
  // dan kredit 0.25 sudah terpotong.
  const hasil = await relayUpstream(res, 'submit', `${NEXABOT_BASE}/api/v1/api`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(upstreamBody),
  })
  // Dicatat setelah respons upstream diterima: rute inilah yang memakai kuota.
  if (hasil) {
    recordUpstreamUsage({ req, route: 'submit', statusCode: hasil.status, bodyText: hasil.text })
  }
})

// ── Submit job (mode session / cookie) ──
// Jalur web nexabot.id: POST /api/v1/generate dengan cookie login. Kalau akun
// punya paket Unlimited, generate tidak dipotong kredit (beda dengan API key).
router.post('/generate', async (req: Request, res: Response) => {
  const cookies = req.headers['x-nexabot-cookie'] as string
  if (!cookies) {
    return res.status(400).json({ ok: false, error: 'Missing X-Nexabot-Cookie header' })
  }

  const body = req.body
  console.log(`[nexabot-local] POST /api/v1/generate (session, mode: ${body.mode})`)

  const upstreamBody: Record<string, any> = {
    mode: body.mode,
    prompt: body.prompt,
  }
  if (body.ratio !== undefined) upstreamBody.ratio = body.ratio
  if (body.aspect !== undefined) upstreamBody.aspect = body.aspect
  if (body.voice) upstreamBody.voice = body.voice
  if (body.media) upstreamBody.media = body.media
  if (body.telegram_id) upstreamBody.telegram_id = body.telegram_id

  // Tanpa retry, sama alasannya dengan /submit: hindari job & kredit ganda.
  const hasil = await relayUpstream(res, 'generate', `${NEXABOT_BASE}/api/v1/generate`, {
    method: 'POST',
    headers: {
      ...sessionHeaders(cookies),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(upstreamBody),
  })
  // Dicatat setelah respons upstream diterima: rute inilah yang memakai kuota.
  if (hasil) {
    recordUpstreamUsage({ req, route: 'generate', statusCode: hasil.status, bodyText: hasil.text })
  }
})

// ── Poll job status ──
router.get('/job/:id', async (req: Request, res: Response) => {
  const auth = upstreamAuthHeaders(req)
  const jobId = req.params.id
  if (Object.keys(auth).length === 0) {
    return res.status(400).json({ ok: false, error: 'Missing X-Api-Key / X-Nexabot-Cookie header' })
  }
  if (!jobId) {
    return res.status(400).json({ ok: false, error: 'Missing job id' })
  }

  console.log(`[nexabot-local] GET /api/v1/jobs/${jobId}`)
  // Poll status bersifat read-only → aman diulang; satu hiccup gateway tidak
  // lagi terlihat oleh klien sebagai "job hilang".
  await relayUpstream(res, 'job', `${NEXABOT_BASE}/api/v1/jobs/${jobId}`, {
    method: 'GET',
    headers: {
      ...auth,
      'Accept': 'application/json',
    },
  })
})

// ── Download result ──
router.get('/download/:id', async (req: Request, res: Response) => {
  const auth = upstreamAuthHeaders(req)
  const jobId = req.params.id
  if (Object.keys(auth).length === 0) {
    return res.status(400).json({ ok: false, error: 'Missing X-Api-Key / X-Nexabot-Cookie header' })
  }
  if (!jobId) {
    return res.status(400).json({ ok: false, error: 'Missing job id' })
  }

  try {
    console.log(`[nexabot-local] GET /api/v1/jobs/${jobId}/download`)
    const { response: upstreamRes } = await fetchNexabotUpstream(`${NEXABOT_BASE}/api/v1/jobs/${jobId}/download`, {
      method: 'GET',
      headers: auth,
      redirect: 'follow',
    }, { action: 'download' })

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text().catch(() => '')
      console.log(`[nexabot-local] download ${upstreamRes.status}: ${errText.slice(0, 200)}`)
      res.writeHead(upstreamRes.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(JSON.stringify({ ok: false, error: `Download gagal: HTTP ${upstreamRes.status}` }))
      return
    }

    // Check if response is JSON (error) or binary (file)
    const contentType = upstreamRes.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const text = await upstreamRes.text()
      console.log(`[nexabot-local] download json: ${text.slice(0, 300)}`)
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(text)
      return
    }

    // Stream binary response
    const finalUrl = upstreamRes.url || `${NEXABOT_BASE}/api/v1/jobs/${jobId}/download`
    console.log(`[nexabot-local] download redirect final: ${finalUrl}`)

    res.writeHead(200, {
      'Content-Type': contentType || 'video/mp4',
      'Access-Control-Allow-Origin': '*',
      'Content-Disposition': `attachment; filename="nexabot-${jobId}.mp4"`,
    })

    const reader = upstreamRes.body?.getReader()
    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    }
    res.end()
  } catch (err: any) {
    const cause = nexabotErrorCause(err)
    console.error(`[nexabot-local] download error:`, err.message, cause ? `(cause: ${cause})` : '')
    const upstream = err instanceof NexabotUpstreamError ? err : null
    res.status(upstream?.timeout ? 504 : 502).json({
      ok: false,
      error: upstream ? `${upstream.message} — ${nexabotErrorAdvice('download')}` : err.message,
    })
  }
})


// ── Daftar mode/model yang tersedia ─────────────────────────────────────
router.get('/modes', async (req: Request, res: Response) => {
  const apiKey = req.headers['x-api-key'] as string
  if (!apiKey) {
    return res.status(400).json({ ok: false, error: 'Missing X-Api-Key header' })
  }

  console.log(`[nexabot-local] GET /api/v1/modes`)
  await relayUpstream(res, 'modes', `${NEXABOT_BASE}/api/v1/modes`, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'Accept': 'application/json',
    },
  })
})

export default router
