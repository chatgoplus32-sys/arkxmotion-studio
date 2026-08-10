import type { VercelRequest, VercelResponse } from '@vercel/node'

const G5_BACKEND = 'https://aistudio-backend.calmdesert-ca599847.centralindia.azurecontainerapps.io'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  try {
    const { action, authHeaders, payload, taskId } = req.body || {}

    if (!authHeaders) {
      return res.status(400).json({ ok: false, error: 'Missing authHeaders' })
    }

    const headers = typeof authHeaders === 'string' ? JSON.parse(authHeaders) : authHeaders

    if (action === 'submit') {
      if (!payload) {
        return res.status(400).json({ ok: false, error: 'Missing payload' })
      }

      console.log(`[galleri5-proxy] submit → ${payload.model_path}`)

      const apiRes = await fetch(`${G5_BACKEND}/api/v1/model-garden/submit-form-stream`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000),
      })

      const data = await apiRes.json().catch(() => null)
      console.log(`[galleri5-proxy] submit → ${apiRes.status}`, JSON.stringify(data).slice(0, 300))

      if (!apiRes.ok) {
        return res.status(200).json({ ok: false, error: data?.message || data?.error || `HTTP ${apiRes.status}` })
      }

      return res.json({ ok: true, data })
    }

    if (action === 'status') {
      if (!taskId) {
        return res.status(400).json({ ok: false, error: 'Missing taskId' })
      }

      console.log(`[galleri5-proxy] status → ${taskId.slice(0, 20)}...`)

      const apiRes = await fetch(`${G5_BACKEND}/api/v1/model-garden/prediction/${taskId}`, {
        method: 'GET',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      })

      const data = await apiRes.json().catch(() => null)

      if (!apiRes.ok) {
        return res.status(200).json({ ok: false, error: data?.message || `HTTP ${apiRes.status}`, data })
      }

      return res.json({ ok: true, data })
    }

    return res.status(400).json({ ok: false, error: `Unknown action: ${action}` })
  } catch (err: any) {
    console.error(`[galleri5-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
