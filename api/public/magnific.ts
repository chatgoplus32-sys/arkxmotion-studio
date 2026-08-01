import type { VercelRequest, VercelResponse } from '@vercel/node'

const MAGNIFIC_API = 'https://api.magnific.com'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  try {
    const { action, apiKey, modelKey, payload, taskId } = req.body || {}

    if (!apiKey) {
      return res.status(400).json({ ok: false, error: 'Missing apiKey' })
    }

    if (action === 'submit') {
      if (!modelKey || !payload) {
        return res.status(400).json({ ok: false, error: 'Missing modelKey or payload' })
      }

      const endpoint = modelKey === 'mag:image-upscaler-precision-v2'
        ? '/v1/ai/image-upscaler-precision-v2'
        : '/v1/ai/image-upscaler'

      console.log(`[magnific-proxy] submit → ${endpoint}`)

      const apiRes = await fetch(`${MAGNIFIC_API}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-magnific-api-key': apiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      })

      const data = await apiRes.json().catch(() => null)
      console.log(`[magnific-proxy] submit → ${apiRes.status}`, JSON.stringify(data).slice(0, 300))

      if (!apiRes.ok) {
        return res.status(200).json({ ok: false, error: data?.message || data?.error || `HTTP ${apiRes.status}`, data })
      }

      return res.json({ ok: true, data: data?.data || data })
    }

    if (action === 'status') {
      if (!modelKey || !taskId) {
        return res.status(400).json({ ok: false, error: 'Missing modelKey or taskId' })
      }

      const endpoint = modelKey === 'mag:image-upscaler-precision-v2'
        ? `/v1/ai/image-upscaler-precision-v2/${taskId}`
        : `/v1/ai/image-upscaler/${taskId}`

      const apiRes = await fetch(`${MAGNIFIC_API}${endpoint}`, {
        method: 'GET',
        headers: {
          'x-magnific-api-key': apiKey,
        },
        signal: AbortSignal.timeout(15000),
      })

      const data = await apiRes.json().catch(() => null)

      if (!apiRes.ok) {
        return res.status(200).json({ ok: false, error: data?.message || `HTTP ${apiRes.status}`, data })
      }

      return res.json({ ok: true, data: data?.data || data })
    }

    if (action === 'submit-motion') {
      const { endpoint, payload } = req.body || {}
      if (!endpoint || !payload) {
        return res.status(400).json({ ok: false, error: 'Missing endpoint or payload' })
      }

      console.log(`[magnific-proxy] submit-motion → ${endpoint}`)

      const apiRes = await fetch(`${MAGNIFIC_API}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-magnific-api-key': apiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      })

      const data = await apiRes.json().catch(() => null)
      console.log(`[magnific-proxy] submit-motion → ${apiRes.status}`, JSON.stringify(data).slice(0, 300))

      if (!apiRes.ok) {
        return res.status(200).json({ ok: false, error: data?.message || data?.error || `HTTP ${apiRes.status}`, data })
      }

      return res.json({ ok: true, data: data?.data || data })
    }

    if (action === 'poll-motion') {
      const { endpoint, taskId } = req.body || {}
      if (!endpoint || !taskId) {
        return res.status(400).json({ ok: false, error: 'Missing endpoint or taskId' })
      }

      const apiRes = await fetch(`${MAGNIFIC_API}${endpoint}/${taskId}`, {
        method: 'GET',
        headers: {
          'x-magnific-api-key': apiKey,
        },
        signal: AbortSignal.timeout(15000),
      })

      const data = await apiRes.json().catch(() => null)

      if (!apiRes.ok) {
        return res.status(200).json({ ok: false, error: data?.message || `HTTP ${apiRes.status}`, data })
      }

      return res.json({ ok: true, data: data?.data || data })
    }

    return res.status(400).json({ ok: false, error: `Unknown action: ${action}` })
  } catch (err: any) {
    console.error(`[magnific-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
