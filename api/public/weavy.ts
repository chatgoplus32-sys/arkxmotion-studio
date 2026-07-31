import type { VercelRequest, VercelResponse } from '@vercel/node'

const WEAVY_API = 'https://app.weavy.ai/api'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Weavy-Token')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const token = req.headers['x-weavy-token'] as string || ''
  const action = (req.query.action || req.body?.action || '') as string

  if (!token) {
    return res.status(400).json({ ok: false, error: 'Missing X-Weavy-Token header' })
  }

  try {
    if (action === 'balance') {
      const r = await fetch(`${WEAVY_API}/user/credits`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      })
      const data = await r.json().catch(() => null)
      console.log(`[weavy-proxy] balance → ${r.status}`, JSON.stringify(data).slice(0, 300))
      return res.status(r.status).json({ ok: r.ok, data, status: r.status })
    }

    if (action === 'generate') {
      const body = req.body?.payload || req.body
      const r = await fetch(`${WEAVY_API}/videos/generate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })
      const data = await r.json().catch(() => null)
      console.log(`[weavy-proxy] generate → ${r.status}`, JSON.stringify(data).slice(0, 500))
      return res.status(r.status).json({ ok: r.ok, data, status: r.status })
    }

    if (action === 'status') {
      const taskId = req.query.taskId || req.body?.taskId
      if (!taskId) return res.status(400).json({ ok: false, error: 'Missing taskId' })
      const r = await fetch(`${WEAVY_API}/videos/${taskId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      })
      const data = await r.json().catch(() => null)
      console.log(`[weavy-proxy] status/${taskId} → ${r.status}`, JSON.stringify(data).slice(0, 500))
      return res.status(r.status).json({ ok: r.ok, data, status: r.status })
    }

    return res.status(400).json({ ok: false, error: `Unknown action: ${action}` })
  } catch (err: any) {
    console.error(`[weavy-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
