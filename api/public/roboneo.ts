import type { VercelRequest, VercelResponse } from '@vercel/node'

const GATEWAY_URL = 'https://ai-engine-gateway-roboneo.meitu.com/roboneo/sync/request'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Roboneo-Token')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const token = req.headers['x-roboneo-token'] || ''
  const { path, parameter } = req.body || {}

  if (!path) return res.status(400).json({ ok: false, error: 'Missing path' })

  console.log(`[roboneo] path=${path} tokenLen=${String(token).length}`)

  try {
    const gatewayRes = await fetch(`${GATEWAY_URL}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access-token': String(token),
        'client-id': '1189857684',
        'Origin': 'https://www.roboneo.com',
        'Referer': 'https://www.roboneo.com/',
      },
      body: JSON.stringify({ parameter: parameter || {} }),
    })

    const rawText = await gatewayRes.text()
    let data: any
    try { data = JSON.parse(rawText) } catch { data = null }

    console.log(`[roboneo] gateway ${gatewayRes.status} path=${path}:`, rawText.slice(0, 500))

    if (!data) {
      return res.status(200).json({ ok: false, error: 'Invalid JSON from gateway', raw: rawText.slice(0, 200) })
    }

    if (data.error_code === 98) {
      return res.status(200).json({ ok: false, error_code: 98, error: data.error_msg || 'Token rejected', data })
    }

    const hasError = data.error_code && data.error_code !== 0
    const innerData = data.parameter || data
    const ok = !hasError && gatewayRes.ok

    return res.status(200).json({ ok, data: innerData })
  } catch (err: any) {
    console.error(`[roboneo] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
