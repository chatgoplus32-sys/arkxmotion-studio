import type { VercelRequest, VercelResponse } from '@vercel/node'

export const config = { maxDuration: 60 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const url = req.query.url as string
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ ok: false, error: 'Missing or invalid url param' })
  }

  let targetUrl = url
  if (/^https?:\/\/localhost:\d+/i.test(url)) {
    targetUrl = url.replace(/^https?:\/\/localhost:\d+/i, 'https://createpulse.online')
  }

  const isMeitu = /meitudata\.com/i.test(targetUrl)
  const isCatbox = /catbox\.moe|litter\.box|files\.catbox/i.test(targetUrl)

  try {
    const upstreamHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': '*/*',
    }

    if (isMeitu) {
      upstreamHeaders['Referer'] = 'https://www.roboneo.com/'
      upstreamHeaders['Origin'] = 'https://www.roboneo.com'
    }

    if (isCatbox) {
      upstreamHeaders['Accept'] = '*/*'
    }

    const rangeHeader = req.headers.range
    if (rangeHeader) {
      upstreamHeaders['Range'] = rangeHeader
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 55000)

    const upstream = await fetch(targetUrl, {
      headers: upstreamHeaders,
      redirect: 'follow',
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!upstream.ok && upstream.status !== 206) {
      const errText = await upstream.text().catch(() => `Upstream: ${upstream.status}`)
      return res.status(upstream.status).json({ ok: false, error: errText.slice(0, 500) })
    }

    const contentType = upstream.headers.get('content-type') || ''
    const contentLength = upstream.headers.get('content-length')
    const contentRange = upstream.headers.get('content-range')

    const resolvedType = contentType.includes('video') ? contentType
      : contentType.includes('octet-stream') ? 'video/mp4'
      : 'video/mp4'

    res.setHeader('Content-Type', resolvedType)
    if (contentLength) res.setHeader('Content-Length', contentLength)
    if (contentRange) res.setHeader('Content-Range', contentRange)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Cache-Control', 'public, max-age=300, no-transform')

    if (req.method === 'HEAD') {
      return res.status(200).end()
    }

    const body = upstream.body
    if (!body) {
      return res.status(502).json({ ok: false, error: 'No body from upstream' })
    }

    const reader = body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const ok = res.write(value)
        if (!ok) {
          await new Promise<void>((resolve) => res.once('drain', () => resolve()))
        }
      }
    } catch (streamErr: any) {
      if (streamErr?.name === 'AbortError' || streamErr?.message?.includes('abort')) {
        return
      }
      console.error('[video-proxy] stream error:', streamErr.message)
    }

    res.end()
  } catch (err: any) {
    if (err?.name === 'AbortError' || err?.message?.includes('abort')) {
      if (!res.headersSent) {
        return res.status(504).json({ ok: false, error: 'Upstream timeout' })
      }
      return
    }
    console.error('[video-proxy] error:', err.message)
    if (!res.headersSent) {
      return res.status(502).json({ ok: false, error: err.message?.slice(0, 500) || 'Proxy error' })
    }
  }
}
