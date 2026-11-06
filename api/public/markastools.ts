import type { VercelRequest, VercelResponse } from '@vercel/node'

const MARKASTOOLS_BASE = 'https://ai.markastools.id'

/**
 * Relay MarkasTools (ai.markastools.id) untuk ARKXMotion.
 *
 * MarkasTools adalah dashboard SaaS bertarif langganan: SEMUA endpoint
 * API-nya mengandalkan session cookie login (email/Google) — tidak ada
 * API key publik. Token `MF-…` (hasil "MarkasKeyTool dari seller resmi")
 * dipakai sebagai kunci akun di DALAM dashboard (menu Accounts →
 * Tambah Akun, provider RunningHub yang dilabeli "Markasflow"), bukan
 * sebagai kredensial HTTP. Relay ini meneruskan cookie session pemakai
 * (header X-Markastools-Cookie) ke upstream sebagai header `Cookie`,
 * persis seperti pola X-Nexabot-Cookie untuk NexaBot.
 *
 * Path: /api/public/markastools/<path...> → https://ai.markastools.id/api/<path...>
 * Body (JSON maupun multipart) diteruskan apa adanya.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Markastools-Cookie')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const cookies = req.headers['x-markastools-cookie'] as string | undefined
  if (!cookies) {
    return res.status(400).json({ ok: false, error: 'Missing X-Markastools-Cookie header — paste cookie session MarkasTools di halaman Providers' })
  }

  // Bentuk URL: /api/public/markastools/api/me, /api/public/markastools/api/runninghub/accounts, dst.
  // Sisa path adalah path upstream penuh di ai.markastools.id.
  const urlPath = (req.url || '').split('?')[0]
  const subPath = urlPath.replace(/^\/api\/public\/markastools/, '') || '/'
  const upstreamUrl = `${MARKASTOOLS_BASE}${subPath.startsWith('/') ? subPath : `/${subPath}`}`

  console.log(`[markastools-proxy] ${req.method} ${subPath}`)

  try {
    const headers: Record<string, string> = {
      Cookie: cookies,
      Origin: MARKASTOOLS_BASE,
      Referer: `${MARKASTOOLS_BASE}/`,
      Accept: 'application/json',
    }
    const ct = req.headers['content-type']
    if (ct) headers['Content-Type'] = ct

    // Body mentah (JSON atau multipart) — Vercel mem-parse body JSON otomatis,
    // jadi untuk JSON kita stringify ulang; multipart dikirim ulang sebagai buffer.
    let body: string | Buffer | undefined
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (ct && ct.includes('application/json') && req.body !== undefined) {
        body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
      } else if (req.body !== undefined) {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        const buf = Buffer.concat(chunks)
        if (buf.length > 0) body = buf
      }
    }

    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
    })

    const text = await upstreamRes.text()
    console.log(`[markastools-proxy] ${upstreamRes.status}: ${text.slice(0, 300)}`)
    res.writeHead(upstreamRes.status, {
      'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(text)
  } catch (err: any) {
    console.error('[markastools-proxy] error:', err?.message)
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: err?.message || 'Gagal menghubungi MarkasTools' }))
  }
}
