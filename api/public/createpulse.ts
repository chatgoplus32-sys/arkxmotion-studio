import type { VercelRequest, VercelResponse } from '@vercel/node'

const CP_API = 'https://createpulse.online/api'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const apiKey = req.headers['x-api-key'] || ''
  const action = (req.query.action || req.body?.action || 'generate') as string

  try {
    if (action === 'generate' && req.method === 'POST') {
      const { action: _, ...body } = req.body || {}
      const r = await fetch(`${CP_API}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': String(apiKey) },
        body: JSON.stringify(body),
      })
      const data = await r.json().catch(() => ({}))
      return res.status(r.status).json(data)
    }

    if (action === 'status') {
      const batchId = req.query.batchId || req.body?.batchId
      const r = await fetch(`${CP_API}/status?batchId=${batchId}`, {
        headers: { 'X-API-Key': String(apiKey) },
      })
      const data = await r.json().catch(() => ({}))
      return res.status(r.status).json(data)
    }

    if (action === 'download') {
      const videoUrl = req.query.url || req.body?.url
      if (!videoUrl || typeof videoUrl !== 'string') {
        return res.status(400).json({ error: 'Missing url parameter' })
      }
      let fullUrl = videoUrl.startsWith('http') ? videoUrl : `https://createpulse.online${videoUrl}`
      if (/^https?:\/\/localhost:\d+\/backend\/api\/video\//i.test(fullUrl)) {
        fullUrl = fullUrl.replace(/^https?:\/\/localhost:\d+/, 'https://createpulse.online')
      }
      const r = await fetch(fullUrl, { redirect: 'follow' })
      if (!r.ok) {
        return res.status(r.status).json({ error: `Upstream returned ${r.status}` })
      }
      const contentType = r.headers.get('content-type') || 'video/mp4'
      const contentLength = r.headers.get('content-length')
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Content-Disposition': 'attachment',
      }
      if (contentLength) headers['Content-Length'] = contentLength
      res.writeHead(200, headers)
      if (r.body) {
        const reader = r.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(value)
        }
      }
      return res.end()
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err: any) {
    return res.status(502).json({ error: err.message })
  }
}
