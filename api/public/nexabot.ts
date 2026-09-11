import type { VercelRequest, VercelResponse } from '@vercel/node'

const NEXABOT_BASE = 'https://nexabot.id'

// NexaBot kadang menggantung tanpa response — batasi durasi call upstream.
const CREDIT_TIMEOUT_MS = 20_000
// Submit bisa lambat saat NexaBot sedang ramai (pernah >2 menit), jadi longgar.
const SUBMIT_TIMEOUT_MS = 180_000
const JOB_TIMEOUT_MS = 20_000

function isTimeout(err: any) {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key, X-Nexabot-Cookie, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const apiKey = req.headers['x-api-key'] as string | undefined
    // Mode session: cookie login nexabot.id dikirim sebagai X-Nexabot-Cookie
    // (browser melarang set header `Cookie`), lalu diterjemahkan ke `Cookie`
    // upstream. Hanya jalur web /generate yang menghormati paket Unlimited.
    const cookies = req.headers['x-nexabot-cookie'] as string | undefined
    if (!apiKey && !cookies) {
      return res.status(400).json({ ok: false, error: 'Missing X-Api-Key / X-Nexabot-Cookie header' })
    }

    const sessionHeaders = (): Record<string, string> => ({
      'Cookie': cookies as string,
      'Origin': NEXABOT_BASE,
      'Referer': `${NEXABOT_BASE}/`,
    })
    const authHeaders = (): Record<string, string> => (cookies ? sessionHeaders() : { 'x-api-key': apiKey as string })
    const requireApiKey = (what: string) => {
      if (!apiKey) return res.status(400).json({ ok: false, error: `${what} butuh X-Api-Key (mode API key)` })
      return null
    }

    // Dukung dua bentuk URL: ?action=credit (gaya lama) dan path-based
    // /credit, /generate, /submit, /job/:id, /download/:id — bentuk kedua yang
    // dipakai klien ARKXMotion (src/lib/nexabot.ts) & backend Express lokal,
    // agar satu klien jalan di lokal maupun produksi.
    const urlPath = (req.url || '').split('?')[0]
    const pathAction = urlPath.match(/\/(credit|submit|generate|session|job|download)(?:\/|$)/)?.[1]
    const jobIdFromPath = urlPath.match(/\/(?:job|download)\/([^/?]+)/)?.[1]
    const action = (req.query.action || req.body?.action || pathAction) as string

    // ── Action: credit (check balance) ──
    if (action === 'credit' || req.url?.includes('action=credit')) {
      const missing = requireApiKey('Cek saldo')
      if (missing) return missing
      console.log(`[nexabot-proxy] GET /api/v1/api/credit`)
      const upstreamRes = await fetch(`${NEXABOT_BASE}/api/v1/api/credit`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey as string,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(CREDIT_TIMEOUT_MS),
      })
      const text = await upstreamRes.text()
      console.log(`[nexabot-proxy] credit ${upstreamRes.status}: ${text.slice(0, 300)}`)
      res.writeHead(upstreamRes.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(text)
      return
    }

    // ── Action: session (mode cookie → status sesi & paket Unlimited) ──
    // Probe read-only ke endpoint web /api/v1/credits.
    if (action === 'session') {
      if (!cookies) {
        return res.status(400).json({ ok: false, error: 'Cek sesi butuh X-Nexabot-Cookie header' })
      }
      console.log(`[nexabot-proxy] GET /api/v1/credits (session probe)`)
      const upstreamRes = await fetch(`${NEXABOT_BASE}/api/v1/credits`, {
        method: 'GET',
        headers: {
          ...sessionHeaders(),
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(CREDIT_TIMEOUT_MS),
      })
      const text = await upstreamRes.text()
      console.log(`[nexabot-proxy] session ${upstreamRes.status}: ${text.slice(0, 300)}`)
      res.writeHead(upstreamRes.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(text)
      return
    }

    // ── Action: generate (mode session / cookie → web endpoint) ──
    // POST /api/v1/generate dengan cookie login. Kalau akun punya paket
    // Unlimited, generate tidak dipotong kredit (beda dari API key).
    if (action === 'generate') {
      if (!cookies) {
        return res.status(400).json({ ok: false, error: 'Mode session butuh X-Nexabot-Cookie header' })
      }
      const body = req.body
      console.log(`[nexabot-proxy] POST /api/v1/generate (session, mode: ${body.mode})`)

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
          ...sessionHeaders(),
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(upstreamBody),
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      })
      const text = await upstreamRes.text()
      console.log(`[nexabot-proxy] generate ${upstreamRes.status}: ${text.slice(0, 300)}`)
      res.writeHead(upstreamRes.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(text)
      return
    }

    // ── Action: submit (generate video/image/music/tts via API key) ──
    if (action === 'submit') {
      const missing = requireApiKey('Submit')
      if (missing) return missing
      const body = req.body
      console.log(`[nexabot-proxy] POST /api/v1/api (mode: ${body.mode})`)

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
          'x-api-key': apiKey as string,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(upstreamBody),
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      })
      const text = await upstreamRes.text()
      console.log(`[nexabot-proxy] submit ${upstreamRes.status}: ${text.slice(0, 300)}`)
      res.writeHead(upstreamRes.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(text)
      return
    }

    // ── Action: job (poll status) ──
    if (action === 'job') {
      const jobId = (req.query.id || jobIdFromPath) as string
      if (!jobId) {
        return res.status(400).json({ ok: false, error: 'Missing job id' })
      }
      console.log(`[nexabot-proxy] GET /api/v1/jobs/${jobId}`)
      const upstreamRes = await fetch(`${NEXABOT_BASE}/api/v1/jobs/${jobId}`, {
        method: 'GET',
        headers: {
          ...authHeaders(),
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
      })
      const text = await upstreamRes.text()
      console.log(`[nexabot-proxy] job ${upstreamRes.status}: ${text.slice(0, 300)}`)
      res.writeHead(upstreamRes.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(text)
      return
    }

    // ── Action: download (get result file) ──
    if (action === 'download') {
      const jobId = (req.query.id || jobIdFromPath) as string
      if (!jobId) {
        return res.status(400).json({ ok: false, error: 'Missing job id' })
      }
      console.log(`[nexabot-proxy] GET /api/v1/jobs/${jobId}/download`)
      const upstreamRes = await fetch(`${NEXABOT_BASE}/api/v1/jobs/${jobId}/download`, {
        method: 'GET',
        headers: authHeaders(),
        redirect: 'follow',
      })

      if (!upstreamRes.ok) {
        const errText = await upstreamRes.text().catch(() => '')
        console.log(`[nexabot-proxy] download ${upstreamRes.status}: ${errText.slice(0, 200)}`)
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
        console.log(`[nexabot-proxy] download json: ${text.slice(0, 300)}`)
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        })
        res.end(text)
        return
      }

      // Stream binary response
      const finalUrl = upstreamRes.url || `${NEXABOT_BASE}/api/v1/jobs/${jobId}/download`
      console.log(`[nexabot-proxy] download redirect final: ${finalUrl}`)

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
      return
    }

    // ── Default: proxy generic requests ──
    console.log(`[nexabot-proxy] ${req.method} ${req.url}`)
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const rawBody = Buffer.concat(chunks)

    const headers: Record<string, string> = {
      ...authHeaders(),
      'Accept': 'application/json',
    }
    const ct = req.headers['content-type']
    if (ct) headers['Content-Type'] = ct

    const upstreamRes = await fetch(`${NEXABOT_BASE}${req.url || '/'}`, {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? rawBody : undefined,
    })

    const text = await upstreamRes.text()
    console.log(`[nexabot-proxy] ${upstreamRes.status}: ${text.slice(0, 300)}`)
    res.writeHead(upstreamRes.status, {
      'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(text)
  } catch (err: any) {
    console.error(`[nexabot-proxy] error:`, err.message)
    res.writeHead(isTimeout(err) ? 504 : 502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: false,
      error: isTimeout(err) ? 'NexaBot timeout — server mereka tidak merespons' : err.message,
    }))
  }
}
