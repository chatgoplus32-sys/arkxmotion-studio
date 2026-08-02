import type { VercelRequest, VercelResponse } from '@vercel/node'

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
    const proxyRes = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Roboneo-Token': String(token),
      },
      body: JSON.stringify({ path, parameter: parameter || {} }),
    })

    const data = await proxyRes.json().catch(() => null)

    console.log(`[roboneo] proxy ${proxyRes.status}:`, JSON.stringify(data).slice(0, 500))

    if (data?.data?.error_code === 98) {
      return res.status(200).json({
        ok: false,
        error_code: 98,
        error: data?.data?.error_msg || 'Token rejected by gateway',
        debug: {
          tokenLen: String(token).length,
          gatewayStatus: proxyRes.status,
        },
        data: data?.data
      })
    }

    return res.status(200).json(data)
  } catch (err: any) {
    console.error(`[roboneo] proxy error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
