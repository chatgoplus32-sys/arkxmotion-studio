import { Router, Request, Response } from 'express'

/**
 * Proxy gambar remote untuk tampilan di app — dipakai saat gambar diblokir
 * hotlink/CSP (mis. CDN Roboneo/Leonardo) atau saat hostname eksternal tidak
 * mengizinkan hotlink. Dibatasi: hanya konten image/* yang diteruskan.
 *
 * Jalur menolak alamat privat/loopback (SSRF) dan meneruskan header Range
 * (untuk gambar besar). Tidak ada caching sisi klien agresif — hanya 5 menit.
 */
const router = Router()

const isPrivate = (hostname: string) =>
  [/^localhost$/, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./, /^0\./, /^::1$/, /^fc00:/i, /^fe80:/i, /^ff00:/i].some((re) => re.test(hostname))

router.get('/', async (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  // Hanya GET — proxy ini untuk memuat gambar di <img>, bukan unduh.

  const url = req.query.url as string
  if (!url || !url.startsWith('http')) return res.status(400).json({ ok: false, error: 'Missing or invalid url param' })

  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    if (isPrivate(hostname)) {
      return res.status(403).json({ ok: false, error: 'Requests to internal/private addresses are not allowed' })
    }
  } catch { return res.status(400).json({ ok: false, error: 'Invalid URL format' }) }

  try {
    const upstreamHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8',
    }
    const targetUrl = url
    if (/meitudata\.com|roboneo\.com/i.test(targetUrl)) {
      upstreamHeaders['Referer'] = 'https://www.roboneo.com/'
      upstreamHeaders['Origin'] = 'https://www.roboneo.com'
    } else if (/cloud\.leonardo\.ai|cdn\.leonardo\.ai|api\.leonardo\.ai/i.test(targetUrl)) {
      upstreamHeaders['Referer'] = 'https://app.leonardo.ai/'
      upstreamHeaders['Origin'] = 'https://app.leonardo.ai'
    } else if (/frami|framia\./i.test(targetUrl)) {
      upstreamHeaders['Referer'] = 'https://framia.converge.ai/'
      upstreamHeaders['Origin'] = 'https://framia.converge.ai'
    }

    if (req.headers.range) upstreamHeaders['Range'] = req.headers.range

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45000)
    const upstream = await fetch(targetUrl, { headers: upstreamHeaders, redirect: 'follow', signal: controller.signal })
    clearTimeout(timeout)

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({ ok: false, error: `Upstream: ${upstream.status}` })
    }

    const contentType = upstream.headers.get('content-type') || ''
    // Tolak konten non-gambar — proxy ini khusus untuk <img>, bukan unduh ARBITRARY.
    if (contentType && !contentType.includes('image/')) {
      res.status(415).json({ ok: false, error: 'Not an image', contentType })
      return
    }

    res.setHeader('Content-Type', contentType || 'image/jpeg')
    res.setHeader('Accept-Ranges', 'bytes')
    const contentLength = upstream.headers.get('content-length')
    if (contentLength) res.setHeader('Content-Length', contentLength)
    const contentRange = upstream.headers.get('content-range')
    if (contentRange) res.setHeader('Content-Range', contentRange)
    res.setHeader('Cache-Control', 'public, max-age=300, no-transform')

    const body = upstream.body
    if (!body) return res.status(502).json({ ok: false, error: 'No body from upstream' })
    const sendStatus = upstream.status === 206 ? 206 : 200
    const reader = body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!res.headersSent) res.statusCode = sendStatus
        const ok = res.write(value)
        if (!ok) await new Promise<void>((resolve) => res.once('drain', () => resolve()))
      }
    } catch (streamErr: any) {
      if (streamErr?.message?.includes('abort')) return
      console.error('[image-proxy] stream error:', streamErr?.message)
    }
    res.end()
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      if (!res.headersSent) return res.status(504).json({ ok: false, error: 'Upstream timeout' })
      return
    }
    console.error('[image-proxy] error:', err.message)
    if (!res.headersSent) return res.status(502).json({ ok: false, error: err.message?.slice(0, 200) || 'Proxy error' })
  }
})

export default router
