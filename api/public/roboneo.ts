import type { VercelRequest, VercelResponse } from '@vercel/node'

const GATEWAY_URL = 'https://ai-engine-gateway-roboneo.meitu.com/roboneo/sync/request'

function parseSSE(raw: string): any {
  const lines = raw.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data: ')) continue
    const jsonStr = trimmed.slice(6)
    try {
      const obj = JSON.parse(jsonStr)
      if (obj.type === 'resp' || obj.task_id || obj.room_id) return obj
    } catch {}
  }
  try { return JSON.parse(raw) } catch {}
  return null
}

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
    console.log(`[roboneo] gateway ${gatewayRes.status} path=${path}:`, rawText.slice(0, 500))

    const data = parseSSE(rawText)

    if (!data) {
      return res.status(200).json({ ok: false, error: 'Failed to parse response', raw: rawText.slice(0, 300) })
    }

    if (data.error_code === 98) {
      return res.status(200).json({ ok: false, error_code: 98, error: data.error_msg || 'Token rejected', data })
    }

    const hasError = data.error_code && data.error_code !== 0
    const ok = !hasError && gatewayRes.ok

    return res.status(200).json({ ok, data })
  } catch (err: any) {
    console.error(`[roboneo] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
