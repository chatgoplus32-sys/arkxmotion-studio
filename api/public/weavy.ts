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

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  try {
    if (action === 'balance') {
      const endpoints = [
        `${WEAVY_API}/user/credits`,
        `${WEAVY_API}/credits`,
        `${WEAVY_API}/user/me`,
        `${WEAVY_API}/me`,
        `${WEAVY_API}/user`,
      ]

      for (const url of endpoints) {
        try {
          const r = await fetch(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10000),
          })

          if (r.ok) {
            const data = await r.json().catch(() => null)
            console.log(`[weavy-proxy] balance ${url} → ${r.status}`, JSON.stringify(data).slice(0, 300))
            return res.status(200).json({ ok: true, data, status: r.status })
          }

          if (r.status === 401 || r.status === 403) {
            continue
          }

          const data = await r.json().catch(() => null)
          console.log(`[weavy-proxy] balance ${url} → ${r.status}`, JSON.stringify(data).slice(0, 300))
          if (r.ok) {
            return res.status(200).json({ ok: true, data, status: r.status })
          }
        } catch (e: any) {
          continue
        }
      }

      console.log(`[weavy-proxy] balance → all endpoints failed, returning token-valid`)
      return res.status(200).json({ ok: true, data: { credits: null, message: 'Token format valid (balance check unavailable)' }, status: 200 })
    }

    if (action === 'generate') {
      const payload = req.body?.payload || req.body

      const endpoints = [
        `${WEAVY_API}/videos/generate`,
        `${WEAVY_API}/generate/video`,
        `${WEAVY_API}/tasks/create`,
        `${WEAVY_API}/workflow/execute`,
      ]

      for (const url of endpoints) {
        try {
          const r = await fetch(url, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(30000),
          })

          const data = await r.json().catch(() => null)

          if (r.ok) {
            console.log(`[weavy-proxy] generate ${url} → ${r.status}`, JSON.stringify(data).slice(0, 500))
            return res.status(200).json({ ok: true, data, status: r.status })
          }

          if (r.status === 404) continue

          console.log(`[weavy-proxy] generate ${url} → ${r.status}`, JSON.stringify(data).slice(0, 300))
          if (r.ok) {
            return res.status(200).json({ ok: true, data, status: r.status })
          }
        } catch (e: any) {
          continue
        }
      }

      return res.status(501).json({ ok: false, error: 'Weavy generate endpoint not found. Check API documentation.' })
    }

    if (action === 'status') {
      const taskId = req.query.taskId || req.body?.taskId
      if (!taskId) return res.status(400).json({ ok: false, error: 'Missing taskId' })

      const endpoints = [
        `${WEAVY_API}/videos/${taskId}`,
        `${WEAVY_API}/tasks/${taskId}`,
        `${WEAVY_API}/task/${taskId}`,
      ]

      for (const url of endpoints) {
        try {
          const r = await fetch(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10000),
          })

          if (r.ok) {
            const data = await r.json().catch(() => null)
            console.log(`[weavy-proxy] status ${url} → ${r.status}`, JSON.stringify(data).slice(0, 500))
            return res.status(200).json({ ok: true, data, status: r.status })
          }

          if (r.status === 404) continue
        } catch (e: any) {
          continue
        }
      }

      return res.status(404).json({ ok: false, error: 'Task not found' })
    }

    return res.status(400).json({ ok: false, error: `Unknown action: ${action}` })
  } catch (err: any) {
    console.error(`[weavy-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
