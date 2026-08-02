import type { VercelRequest, VercelResponse } from '@vercel/node'

const GATEWAY_URL = 'https://ai-engine-gateway-roboneo.meitu.com/roboneo/sync/request'
const PROXY_URL = 'https://roboneo-proxy.chatgoplus32.workers.dev'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Roboneo-Token')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const token = req.headers['x-roboneo-token'] || ''
  const { path, parameter } = req.body || {}

  if (!path) return res.status(400).json({ ok: false, error: 'Missing path' })

  console.log(`[roboneo] path=${path} tokenLen=${String(token).length} tokenPrefix=${String(token).slice(0, 10)}...`)

  try {
    const targetUrl = `${GATEWAY_URL}/${path}`
    const proxyRes = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: targetUrl,
        headers: {
          'access-token': String(token),
          'client-id': '1189857647',
          'Origin': 'https://www.roboneo.com',
          'Referer': 'https://www.roboneo.com/',
        },
        body: { parameter: parameter || {} },
      }),
    })

    const text = await proxyRes.text()
    let data: any = null
    try { data = JSON.parse(text) } catch {}

    console.log(`[roboneo] proxy ${proxyRes.status}:`, text.slice(0, 500))

    if (data?.error_code === 98) {
      return res.status(200).json({
        ok: false,
        error_code: 98,
        error: data?.error_msg || 'Token rejected by gateway',
        debug: {
          tokenLen: String(token).length,
          tokenPrefix: String(token).slice(0, 15),
          gatewayStatus: proxyRes.status,
          bodyKeys: Object.keys(parameter || {}),
        },
        data
      })
    }

    return res.status(200).json({ ok: data?.error_code === 0, status: proxyRes.status, data })
  } catch (err: any) {
    console.error(`[roboneo] gateway error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
