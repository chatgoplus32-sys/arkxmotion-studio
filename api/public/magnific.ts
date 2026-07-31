import type { VercelRequest, VercelResponse } from '@vercel/node'

const MAGNIFIC_API = 'https://api.magnific.com'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Magnific-Api-Key')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const apiKey = (req.headers['x-magnific-api-key'] as string) || ''
  if (!apiKey) {
    return res.status(400).json({ ok: false, error: 'Missing X-Magnific-Api-Key header' })
  }

  try {
    if (req.method === 'POST') {
      const { endpoint, body } = req.body || {}
      if (!endpoint) {
        return res.status(400).json({ ok: false, error: 'Missing endpoint in body' })
      }

      const url = `${MAGNIFIC_API}${endpoint}`
      console.log(`[magnific-proxy] POST ${endpoint}`)

      const apiRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-magnific-api-key': apiKey,
        },
        body: JSON.stringify(body || {}),
        signal: AbortSignal.timeout(60000),
      })

      const data = await apiRes.json().catch(() => null)
      console.log(`[magnific-proxy] POST ${endpoint} → ${apiRes.status}`)

      return res.status(apiRes.status).json({ ok: apiRes.ok, data, status: apiRes.status })
    }

    if (req.method === 'GET') {
      const { endpoint } = req.query
      if (!endpoint || typeof endpoint !== 'string') {
        return res.status(400).json({ ok: false, error: 'Missing endpoint query param' })
      }

      const url = `${MAGNIFIC_API}${endpoint}`
      console.log(`[magnific-proxy] GET ${endpoint}`)

      const apiRes = await fetch(url, {
        method: 'GET',
        headers: {
          'x-magnific-api-key': apiKey,
        },
        signal: AbortSignal.timeout(15000),
      })

      const data = await apiRes.json().catch(() => null)
      console.log(`[magnific-proxy] GET ${endpoint} → ${apiRes.status}`)

      return res.status(apiRes.status).json({ ok: apiRes.ok, data, status: apiRes.status })
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  } catch (err: any) {
    console.error(`[magnific-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
