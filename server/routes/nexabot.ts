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
import { isMasterKey, masterKey, memberMayUseMasterKey, underDailyCap } from '../lib/nexabotMasterKey.js'
import { recordUpstreamUsage, userIdFromRequest, type ResolvedCredential } from '../lib/nexabotUpstreamUsage.js'

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

interface ResolvedUpstreamAuth {
  headers: Record<string, string>
  credential: ResolvedCredential | null
  /** Pesan untuk klien kalau tidak ada kredensial yang bisa dipakai. */
  error?: string
}

/** Boleh tidaknya member ini memakai kunci induk milik server. */
function bolehPakaiKunciInduk(req: Request): { ok: boolean; reason: string } {
  const userId = userIdFromRequest(req)
  if (!userId) {
    return {
      ok: false,
      reason:
        'Kunci NexaBot milik server hanya untuk member yang login (Authorization: Bearer <token app>). ' +
        'Tanpa itu, pakai kunci NexaBot Anda sendiri lewat header X-Api-Key.',
    }
  }
  const izin = memberMayUseMasterKey(userId)
  if (!izin.ok) return izin
  return underDailyCap(userId)
}

/** Boleh tidaknya member ini memakai kunci induk untuk rute BACA. */
function bolehBacaDenganKunciInduk(req: Request): { ok: boolean; reason: string } {
  const userId = userIdFromRequest(req)
  if (!userId) {
    return {
      ok: false,
      reason:
        'Kunci NexaBot milik server hanya untuk member yang login (Authorization: Bearer <token app>). ' +
        'Tanpa itu, pakai kunci NexaBot Anda sendiri lewat header X-Api-Key.',
    }
  }
  // Rute baca tidak memakai kredit, dan menolaknya bisa memutus polling job yang
  // SUDAH berjalan sah — misalnya paket member habis di tengah job. Karena itu
  // yang diwajibkan di sini hanya identitas, bukan kelayakan.
  return { ok: true, reason: 'Rute baca: hanya butuh identitas' }
}

/** Kunci induk yang disuntikkan relay — klien tidak pernah melihatnya. */
function kunciIndukAuth(req: Request, bacaSaja = false): ResolvedUpstreamAuth {
  const kunci = masterKey()
  if (!kunci) return { headers: {}, credential: null, error: 'Missing X-Api-Key header' }
  const izin = bacaSaja ? bolehBacaDenganKunciInduk(req) : bolehPakaiKunciInduk(req)
  if (!izin.ok) return { headers: {}, credential: null, error: izin.reason }
  return { headers: { 'x-api-key': kunci }, credential: { kind: 'api-key', source: 'master', secret: kunci } }
}

/**
 * Satu tempat resolusi kredensial ke upstream. Urutannya:
 *   1. cookie sesi dari klien (jalur Unlimited — tidak pernah digantikan);
 *   2. kunci yang dikirim klien;
 *   3. kunci induk milik server, kalau membernya berhak.
 *
 * Kunci induk yang MASIH dikirim klien tidak diperlakukan sebagai kunci pribadi:
 * artinya kunci itu beredar di browser, jadi ia tetap harus lolos kebijakan yang
 * sama, dan sidik jarinya dicatat sebagai 'client-master' — jejak kunci yang
 * perlu dihabiskan, bukan kunci yang dianggap aman.
 */
function resolveUpstreamAuth(req: Request, opts: { bacaSaja?: boolean } = {}): ResolvedUpstreamAuth {
  const cookieMentah = req.headers['x-nexabot-cookie']
  if (typeof cookieMentah === 'string' && cookieMentah.trim()) {
    const cookies = cookieMentah.trim()
    return {
      headers: sessionHeaders(cookies),
      credential: { kind: 'cookie', source: 'own-cookie', secret: cookies },
    }
  }

  const kunciKlien = req.headers['x-api-key']
  if (typeof kunciKlien === 'string' && kunciKlien.trim()) {
    const kunci = kunciKlien.trim()
    if (isMasterKey(kunci)) {
      const izin = opts.bacaSaja ? bolehBacaDenganKunciInduk(req) : bolehPakaiKunciInduk(req)
      if (!izin.ok) return { headers: {}, credential: null, error: izin.reason }
      return { headers: { 'x-api-key': kunci }, credential: { kind: 'api-key', source: 'client-master', secret: kunci } }
    }
    return { headers: { 'x-api-key': kunci }, credential: { kind: 'api-key', source: 'own-key', secret: kunci } }
  }

  return kunciIndukAuth(req, !!opts.bacaSaja)
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
  const auth = resolveUpstreamAuth(req)
  if (Object.keys(auth.headers).length === 0) {
    return res.status(400).json({ ok: false, error: auth.error || 'Missing X-Api-Key header' })
  }

  console.log(`[nexabot-local] GET /api/v1/api/credit`)
  // /credit sering menggantung di sisi NexaBot — timeout 25s × 3 percobaan
  // dengan backoff jauh lebih jarang berakhir 504 daripada sekali 20s.
  await relayUpstream(res, 'credit', `${NEXABOT_BASE}/api/v1/api/credit`, {
    method: 'GET',
    headers: {
      ...auth.headers,
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
  const auth = resolveUpstreamAuth(req)
  if (Object.keys(auth.headers).length === 0) {
    return res.status(400).json({ ok: false, error: auth.error || 'Missing X-Api-Key header' })
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
      ...auth.headers,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(upstreamBody),
  })
  // Dicatat setelah respons upstream diterima: rute inilah yang memakai kuota.
  if (hasil) {
    recordUpstreamUsage({ req, route: 'submit', statusCode: hasil.status, bodyText: hasil.text, credential: auth.credential })
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
    recordUpstreamUsage({
      req,
      route: 'generate',
      statusCode: hasil.status,
      bodyText: hasil.text,
      credential: { kind: 'cookie', source: 'own-cookie', secret: cookies },
    })
  }
})

// ── Poll job status ──
router.get('/job/:id', async (req: Request, res: Response) => {
  const auth = resolveUpstreamAuth(req, { bacaSaja: true })
  const jobId = req.params.id
  if (Object.keys(auth.headers).length === 0) {
    return res.status(400).json({ ok: false, error: auth.error || 'Missing X-Api-Key / X-Nexabot-Cookie header' })
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
      ...auth.headers,
      'Accept': 'application/json',
    },
  })
})

// ── Download result ──
router.get('/download/:id', async (req: Request, res: Response) => {
  const auth = resolveUpstreamAuth(req, { bacaSaja: true })
  const jobId = req.params.id
  if (Object.keys(auth.headers).length === 0) {
    return res.status(400).json({ ok: false, error: auth.error || 'Missing X-Api-Key / X-Nexabot-Cookie header' })
  }
  if (!jobId) {
    return res.status(400).json({ ok: false, error: 'Missing job id' })
  }

  try {
    console.log(`[nexabot-local] GET /api/v1/jobs/${jobId}/download`)
    const { response: upstreamRes } = await fetchNexabotUpstream(`${NEXABOT_BASE}/api/v1/jobs/${jobId}/download`, {
      method: 'GET',
      headers: { ...auth.headers, 'Accept': 'application/json' },
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
  const auth = resolveUpstreamAuth(req, { bacaSaja: true })
  if (Object.keys(auth.headers).length === 0) {
    return res.status(400).json({ ok: false, error: auth.error || 'Missing X-Api-Key header' })
  }

  console.log(`[nexabot-local] GET /api/v1/modes`)
  await relayUpstream(res, 'modes', `${NEXABOT_BASE}/api/v1/modes`, {
    method: 'GET',
    headers: {
      ...auth.headers,
      'Accept': 'application/json',
    },
  })
})

export default router
