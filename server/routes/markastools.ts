import { Router, Request, Response } from 'express'

const router = Router()

/**
 * Relay MarkasTools (ai.markastools.id) untuk ARKXMotion — sisi server lokal.
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
 * Body (JSON maupun multipart) diteruskan apa adanya. Route ini HARUS
 * terdaftar SEBELUM express.json() di server/index.ts supaya body
 * multipart mentah tidak terpotong parser.
 */
const MARKASTOOLS_BASE = (process.env.MARKASTOOLS_BASE || 'https://ai.markastools.id').replace(/\/+$/, '')

router.all('/{*path}', async (req: Request, res: Response) => {
  const cookies = req.headers['x-markastools-cookie'] as string | undefined
  if (!cookies) {
    return res.status(400).json({ ok: false, error: 'Missing X-Markastools-Cookie header — paste cookie session MarkasTools di halaman Providers' })
  }

  // Client memanggil /api/public/markastools/api/... — path dalam
  // request adalah path upstream penuh di ai.markastools.id.
  const subPath = req.path && req.path !== '/' ? req.path : '/'
  const upstreamUrl = `${MARKASTOOLS_BASE}${subPath}`
  console.log(`[markastools-local] ${req.method} ${subPath}`)

  try {
    const headers: Record<string, string> = {
      Cookie: cookies,
      Origin: MARKASTOOLS_BASE,
      Referer: `${MARKASTOOLS_BASE}/`,
      Accept: 'application/json',
    }
    const ct = req.headers['content-type']
    if (ct) headers['Content-Type'] = ct

    // Body mentah (JSON atau multipart) — stream dari client diteruskan apa adanya.
    let body: Blob | undefined
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const buf = Buffer.concat(chunks)
      if (buf.length > 0) body = new Blob([new Uint8Array(buf)])
    }

    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
    })

    const text = await upstreamRes.text()
    console.log(`[markastools-local] ${upstreamRes.status}: ${text.slice(0, 300)}`)
    res.writeHead(upstreamRes.status, {
      'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
    })
    res.end(text)
  } catch (err: any) {
    console.error('[markastools-local] error:', err?.message)
    res.status(502).json({ ok: false, error: err?.message || 'Gagal menghubungi MarkasTools' })
  }
})

export default router
