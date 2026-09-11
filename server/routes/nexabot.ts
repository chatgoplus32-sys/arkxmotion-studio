import { Router, Request, Response } from 'express'

const router = Router()
const NEXABOT_BASE = 'https://nexabot.id'

// NexaBot kadang menggantung tanpa response (khususnya /credit & /api). Batasi
// durasi tiap call upstream supaya request klien tidak nge-hang selamanya.
const NEXABOT_CREDIT_TIMEOUT_MS = 20_000
// Submit bisa lambat saat NexaBot sedang ramai (pernah >2 menit), jadi longgar.
const NEXABOT_SUBMIT_TIMEOUT_MS = 180_000
const NEXABOT_JOB_TIMEOUT_MS = 20_000

function isTimeout(err: any) {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError'
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

  try {
    console.log(`[nexabot-local] GET /api/v1/api/credit`)
    const upstreamRes = await fetch(`${NEXABOT_BASE}/api/v1/api/credit`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json',
      },
      // NexaBot /credit kadang menggantung tanpa response — jangan biarkan
      // request klien ikut nge-hang.
      signal: AbortSignal.timeout(NEXABOT_CREDIT_TIMEOUT_MS),
    })
    const text = await upstreamRes.text()
    console.log(`[nexabot-local] credit ${upstreamRes.status}: ${text.slice(0, 300)}`)
    res.writeHead(upstreamRes.status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(text)
  } catch (err: any) {
    console.error(`[nexabot-local] credit error:`, err.message)
    res.status(504).json({
      ok: false,
      error: isTimeout(err) ? 'NexaBot timeout saat cek saldo (20s)' : err.message,
    })
  }
})

// ── Session info (mode cookie) ──
// Probe status sesi & paket Unlimited lewat endpoint web /api/v1/credits.
router.get('/session', async (req: Request, res: Response) => {
  const cookies = req.headers['x-nexabot-cookie'] as string
  if (!cookies) {
    return res.status(400).json({ ok: false, error: 'Missing X-Nexabot-Cookie header' })
  }

  try {
    console.log(`[nexabot-local] GET /api/v1/credits (session probe)`)
    const upstreamRes = await fetch(`${NEXABOT_BASE}/api/v1/credits`, {
      method: 'GET',
      headers: {
        ...sessionHeaders(cookies),
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(NEXABOT_CREDIT_TIMEOUT_MS),
    })
    const text = await upstreamRes.text()
    console.log(`[nexabot-local] session ${upstreamRes.status}: ${text.slice(0, 300)}`)
    res.writeHead(upstreamRes.status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(text)
  } catch (err: any) {
    console.error(`[nexabot-local] session error:`, err.message)
    res.status(504).json({
      ok: false,
      error: isTimeout(err) ? 'NexaBot timeout saat cek sesi (20s)' : err.message,
    })
  }
})

// ── Submit job ──
router.post('/submit', async (req: Request, res: Response) => {
  const apiKey = req.headers['x-api-key'] as string
  if (!apiKey) {
    return res.status(400).json({ ok: false, error: 'Missing X-Api-Key header' })
  }

  const body = req.body
  console.log(`[nexabot-local] POST /api/v1/api (mode: ${body.mode})`)

  try {
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

    const upstreamRes = await fetch(`${NEXABOT_BASE}/api/v1/api`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(NEXABOT_SUBMIT_TIMEOUT_MS),
    })
    const text = await upstreamRes.text()
    console.log(`[nexabot-local] submit ${upstreamRes.status}: ${text.slice(0, 300)}`)
    res.writeHead(upstreamRes.status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(text)
  } catch (err: any) {
    console.error(`[nexabot-local] submit error:`, err.message)
    res.status(504).json({
      ok: false,
      error: isTimeout(err) ? 'NexaBot timeout saat submit (90s) — coba lagi' : err.message,
    })
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

  try {
    const upstreamBody: Record<string, any> = {
      mode: body.mode,
      prompt: body.prompt,
    }
    if (body.ratio !== undefined) upstreamBody.ratio = body.ratio
    if (body.aspect !== undefined) upstreamBody.aspect = body.aspect
    if (body.voice) upstreamBody.voice = body.voice
    if (body.media) upstreamBody.media = body.media
    if (body.telegram_id) upstreamBody.telegram_id = body.telegram_id

    const upstreamRes = await fetch(`${NEXABOT_BASE}/api/v1/generate`, {
      method: 'POST',
      headers: {
        ...sessionHeaders(cookies),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(NEXABOT_SUBMIT_TIMEOUT_MS),
    })
    const text = await upstreamRes.text()
    console.log(`[nexabot-local] generate ${upstreamRes.status}: ${text.slice(0, 300)}`)
    res.writeHead(upstreamRes.status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(text)
  } catch (err: any) {
    console.error(`[nexabot-local] generate error:`, err.message)
    res.status(504).json({
      ok: false,
      error: isTimeout(err) ? 'NexaBot timeout saat generate via session (180s) — coba lagi' : err.message,
    })
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

  try {
    console.log(`[nexabot-local] GET /api/v1/jobs/${jobId}`)
    const upstreamRes = await fetch(`${NEXABOT_BASE}/api/v1/jobs/${jobId}`, {
      method: 'GET',
      headers: {
        ...auth,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(NEXABOT_JOB_TIMEOUT_MS),
    })
    const text = await upstreamRes.text()
    console.log(`[nexabot-local] job ${upstreamRes.status}: ${text.slice(0, 300)}`)
    res.writeHead(upstreamRes.status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(text)
  } catch (err: any) {
    console.error(`[nexabot-local] job error:`, err.message)
    res.status(502).json({ ok: false, error: err.message })
  }
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
    const upstreamRes = await fetch(`${NEXABOT_BASE}/api/v1/jobs/${jobId}/download`, {
      method: 'GET',
      headers: auth,
      redirect: 'follow',
    })

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
    console.error(`[nexabot-local] download error:`, err.message)
    res.status(502).json({ ok: false, error: err.message })
  }
})


// ── Daftar mode/model yang tersedia ─────────────────────────────────────
router.get('/modes', async (req: Request, res: Response) => {
  const apiKey = req.headers['x-api-key'] as string
  if (!apiKey) {
    return res.status(400).json({ ok: false, error: 'Missing X-Api-Key header' })
  }

  try {
    console.log(`[nexabot-local] GET /api/v1/modes`)
    const upstreamRes = await fetch(`${NEXABOT_BASE}/api/v1/modes`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json',
      },
    })
    const text = await upstreamRes.text()
    console.log(`[nexabot-local] modes ${upstreamRes.status}: ${text.slice(0, 300)}`)
    res.writeHead(upstreamRes.status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(text)
  } catch (err: any) {
    console.error(`[nexabot-local] modes error:`, err.message)
    res.status(502).json({ ok: false, error: err.message })
  }
})

export default router
