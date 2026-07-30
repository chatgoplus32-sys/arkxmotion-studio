import type { VercelRequest, VercelResponse } from '@vercel/node'

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

  try {
    const upstreamHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    }

    if (isMeitu) {
      upstreamHeaders['Referer'] = 'https://www.roboneo.com/'
      upstreamHeaders['Origin'] = 'https://www.roboneo.com'
    }

    const rangeHeader = req.headers.range
    if (rangeHeader) {
      upstreamHeaders['Range'] = rangeHeader
    }

    const upstream = await fetch(targetUrl, {
      headers: upstreamHeaders,
      redirect: 'follow',
    })

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({ ok: false, error: `Upstream: ${upstream.status}` })
    }

    const contentType = upstream.headers.get('content-type') || 'video/mp4'
    const contentLength = upstream.headers.get('content-length')
    const contentRange = upstream.headers.get('content-range')

    res.setHeader('Content-Type', contentType)
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
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read()
      if (done) {
        res.end()
        return
      }
      res.write(value)
      return pump()
    }
    await pump()
  } catch (err: any) {
    console.error('[video-proxy] error:', err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
