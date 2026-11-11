// `Response` di bawah dipakai sebagai NILAI (new Response(...)) untuk
// meneruskan response dari fetch global. Kalau `Response` di-import sebagai
// nilai dari express, import itu menimpa global dan esbuild tidak boleh
// meng-elide-nya -> server crash saat start ("express does not provide an
// export named 'Response'"). Karena itu tipe express di-import type-only.
import { Router } from 'express'
import type { Request, Response } from 'express'
import { describeFetchError } from '../lib/fetchTimeout.js'

// ── Relay Freebeat AI (pass-through API key milik user) ─────────────────────
// Freebeat web app memakai proxy https://freebeat.ai/api/proxy/ untuk endpoint
// generate gambar (terverifikasi bekerja untuk model config di browser).
// Paket resmi npm freebeat-mcp pakai https://api.freebeatfit.com dengan header
// Authorization: <KEY> mentah (tanpa Bearer).
//
// Kunci dikirim browser tiap request dan DITERUSKAN verbatim ke upstream;
// server ini TIDAK menyimpannya dan TIDAK punya kunci master (kredit dipotong
// langsung di akun freebeat upstream, tanpa penagihan lokal).
//
// Path di-allowlist agar relay ini tidak jadi proxy umum:
//   /v1/ai/cli/createImageBatch   — submit batch gambar (generate/edit)
//   /v1/ai/cli/queryBatch         — poll status batch
//   /v1/user/credits/findCredits  — saldo kredit akun (best-effort)

const router = Router()
const FREEBEAT_BASE = (process.env.FREEBEAT_BASE || 'https://freebeat.ai/api/proxy').replace(/\/+$/, '')

const ALLOWED_PATHS = new Set([
  '/v1/ai/cli/createImageBatch',
  '/v1/ai/cli/queryBatch',
  '/v1/user/credits/findCredits',
])

/** Coba kombinasi base URL + format auth hingga salah satu berhasil. */
async function freebeatFetch(upstreamPath: string, body: Uint8Array | undefined, authKey: string): Promise<any> {
  const bases = [
    (process.env.FREEBEAT_BASE || 'https://freebeat.ai/api/proxy').replace(/\/+$/, ''),
    'https://api.freebeatfit.com',
  ]
  const key = authKey.trim()
  const variants: Array<{ headers: Record<string, string>; label: string }> = [
    {
      headers: {
        'Authorization': `Bearer ${key}`,
        'token': key,
        'udt': key,
        'X-Platform-Type': 'web',
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://freebeat.ai',
        'Referer': 'https://freebeat.ai/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      label: 'Bearer+token+udt',
    },
    {
      headers: {
        'Authorization': key,
        'token': key,
        'udt': key,
        'X-Platform-Type': 'web',
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://freebeat.ai',
        'Referer': 'https://freebeat.ai/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      label: 'raw+token+udt',
    },
  ]

  let lastRes: any = null
  let lastText = ''
  let lastStatus = 0

  for (const base of bases) {
    for (const v of variants) {
      try {
        const res = await fetch(`${base}${upstreamPath}`, {
          method: 'POST',
          headers: v.headers,
          body: body ?? undefined,
          signal: AbortSignal.timeout(120000),
        })
        lastRes = res
        lastStatus = res.status
        lastText = await res.text()
        if (res.status < 400 || (res.status !== 401 && res.status !== 403)) {
          console.log(`[freebeat-proxy] ${v.label} @ ${base} → ${res.status}`)
          return res
        }
        console.log(`[freebeat-proxy] ${v.label} @ ${base} → ${res.status} ${lastText.slice(0, 120)}`)
      } catch {
        continue
      }
    }
  }
  if (lastRes) {
    return new Response(lastText, {
      status: lastRes.status,
      headers: { 'Content-Type': lastRes.headers.get('content-type') || 'application/json' },
    })
  }
  throw new Error('freebeat upstream tidak merespons')
}

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

    console.log(`[freebeat-proxy] ${req.method} ${upstreamPath}`)

    const proxyRes = await freebeatFetch(upstreamPath, rawBody, String(auth))

    const text = await proxyRes.text()
    if (proxyRes.status >= 400) {
      console.log(`[freebeat-proxy] FINAL ${proxyRes.status}: ${text}`)
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
