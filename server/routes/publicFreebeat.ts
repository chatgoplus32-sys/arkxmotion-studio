import { Router, Request, Response } from 'express'
import { describeFetchError } from '../lib/fetchTimeout.js'

// ── Relay Freebeat AI (pass-through API key milik user) ─────────────────────
// Freebeat mengautentikasi CLI/OpenRPC dengan header `Authorization: <KEY>`
// MENTAH (tanpa "Bearer") — persis seperti paket resmi npm freebeat-mcp.
// Kunci dikirim browser tiap request dan DITERUSKAN verbatim ke upstream;
// server ini TIDAK menyimpannya dan TIDAK punya kunci master (kredit dipotong
// langsung di akun freebeat upstream, tanpa penagihan lokal).
//
// Path di-allowlist agar relay ini tidak jadi proxy umum:
//   /v1/ai/cli/createImageBatch   — submit batch gambar (generate/edit)
//   /v1/ai/cli/queryBatch         — poll status batch
//   /v1/user/credits/findCredits  — saldo kredit akun (best-effort)

const router = Router()
const FREEBEAT_BASE = (process.env.FREEBEAT_BASE || 'https://api.freebeatfit.com').replace(/\/+$/, '')

const ALLOWED_PATHS = new Set([
  '/v1/ai/cli/createImageBatch',
  '/v1/ai/cli/queryBatch',
  '/v1/user/credits/findCredits',
])

router.all('/{*path}', async (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const subpath = (req.url || '/').split('?')[0].replace(/^\//, '')
  const upstreamPath = '/' + subpath
  if (!ALLOWED_PATHS.has(upstreamPath)) {
    return res.writeHead(404, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ ok: false, error: `Path freebeat tidak diizinkan: ${upstreamPath}` }),
    )
  }

  const auth = req.headers.authorization
  if (!auth || !String(auth).trim()) {
    return res.writeHead(401, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ ok: false, error: 'API key freebeat wajib di header Authorization' }),
    )
  }

  try {
    const chunks: Uint8Array[] = []
    for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk as unknown as Uint8Array)
    const rawBody = Buffer.concat(chunks)

    const upstreamUrl = `${FREEBEAT_BASE}${upstreamPath}`
    console.log(`[freebeat-proxy] ${req.method} ${upstreamPath}`)

    const proxyRes = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        // MENTAH — tanpa prefix "Bearer" (kontrak freebeat CLI).
        'Authorization': String(auth).trim(),
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? rawBody : undefined,
      signal: AbortSignal.timeout(120000),
    })

    const text = await proxyRes.text()
    if (proxyRes.status >= 400) {
      console.log(`[freebeat-proxy] ${proxyRes.status}: ${text.slice(0, 200)}`)
    }
    res.writeHead(proxyRes.status, {
      'Content-Type': proxyRes.headers.get('content-type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(text)
  } catch (err: any) {
    console.error(`[freebeat-proxy] error: ${describeFetchError(err)}`)
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: describeFetchError(err) || err?.message || 'upstream error' }))
  }
})

export default router
