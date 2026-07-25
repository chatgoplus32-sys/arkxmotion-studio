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

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err: any) {
    return res.status(502).json({ error: err.message })
  }
}
