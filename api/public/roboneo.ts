import type { VercelRequest, VercelResponse } from '@vercel/node'

const GATEWAY_URL = 'https://ai-engine-gateway-roboneo.meitu.com/roboneo/sync/request'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Roboneo-Token')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const token = req.headers['x-roboneo-token'] || ''
  const cookies = req.headers['x-roboneo-cookies'] || ''
  const clientId = req.headers['x-roboneo-client-id'] || '1189857684'
  const { path, parameter } = req.body || {}

  if (!path) {
    return res.status(400).json({ ok: false, error: 'Missing path' })
  }

  console.log(`[roboneo] path=${path} tokenLen=${String(token).length} clientId=${clientId}`)

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'access-token': String(token),
      'client-id': String(clientId),
      'Origin': 'https://www.roboneo.com',
      'Referer': 'https://www.roboneo.com/',
    }

    if (cookies) {
      headers['Cookie'] = String(cookies)
    }

    const roboneoRes = await fetch(`${GATEWAY_URL}/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(parameter || {}),
    })

    const text = await roboneoRes.text()
    let data: any = null
    try { data = JSON.parse(text) } catch {}

    console.log(`[roboneo] gateway ${roboneoRes.status}:`, text.slice(0, 500))

    if (!roboneoRes.ok) {
      return res.status(200).json({ ok: false, status: roboneoRes.status, data, error: `HTTP ${roboneoRes.status}` })
    }

    return res.status(200).json({ ok: true, status: roboneoRes.status, data })
  } catch (err: any) {
    console.error(`[roboneo] gateway error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
