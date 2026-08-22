import type { VercelRequest, VercelResponse } from '@vercel/node'

const FRAMIA_UPSTREAM = 'https://api.framia.pro/video/api'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const auth = req.headers.authorization || ''
  const subpath = (req.query.path || '') as string

  if (!subpath) {
    return res.status(400).json({ ok: false, error: 'Missing path parameter' })
  }

  const upstreamUrl = `${FRAMIA_UPSTREAM}/${subpath}`

  try {
    const headers: Record<string, string> = { Authorization: auth }

    if (req.method === 'POST') {
      headers['Content-Type'] = 'application/json'
    }

    const fetchOpts: RequestInit = { method: req.method, headers }

    if (req.method === 'POST' && req.body) {
      fetchOpts.body = JSON.stringify(req.body)
    }

    const r = await fetch(upstreamUrl, fetchOpts)
    const text = await r.text()
    console.log(`[framia-proxy] ${req.method} ${subpath} → ${r.status}`)

    let data: any
    try { data = JSON.parse(text) } catch { data = text }

    return res.status(r.status).json(data)
  } catch (err: any) {
    console.error(`[framia-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
