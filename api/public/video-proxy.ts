import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Range')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const url = req.query.url as string
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ ok: false, error: 'Missing or invalid url param' })
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://multi-agent-release.meitudata.com/',
      },
    })

    if (!upstream.ok) {
      return res.status(upstream.status).json({ ok: false, error: `Upstream: ${upstream.status}` })
    }

    const contentType = upstream.headers.get('content-type') || 'video/mp4'
    const contentLength = upstream.headers.get('content-length')

    res.setHeader('Content-Type', contentType)
    if (contentLength) res.setHeader('Content-Length', contentLength)
    res.setHeader('Cache-Control', 'public, max-age=86400')

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
