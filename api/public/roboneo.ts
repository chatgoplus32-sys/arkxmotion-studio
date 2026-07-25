import type { VercelRequest, VercelResponse } from '@vercel/node'

const ROBONEO_ENDPOINTS = [
  'https://webapi.roboneo.com',
  'https://ai-engine-gateway-roboneo.meitu.com',
]

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
  const { path, parameter } = req.body || {}

  if (!path) {
    return res.status(400).json({ ok: false, error: 'Missing path' })
  }

  console.log(`[roboneo] ${path} (tokenLen=${String(token).length})`)

  for (const base of ROBONEO_ENDPOINTS) {
    try {
      const url = `${base}/${path}`
      console.log(`[roboneo] trying ${url}`)

      const roboneoRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'access-token': String(token),
          'client-id': '1189857684',
        },
        body: JSON.stringify(parameter || {}),
      })

      const text = await roboneoRes.text()
      let data: any = null
      try { data = JSON.parse(text) } catch {}

      console.log(`[roboneo] ${base} → ${roboneoRes.status}:`, text.slice(0, 300))

      if (roboneoRes.ok && data && data.error_code === 0) {
        return res.status(200).json({ ok: true, status: roboneoRes.status, data })
      }

      if (roboneoRes.status === 400 && base === ROBONEO_ENDPOINTS[0]) {
        console.log(`[roboneo] webapi returned 400, trying gateway...`)
        continue
      }

      return res.status(200).json({ ok: roboneoRes.ok, status: roboneoRes.status, data })
    } catch (err: any) {
      console.error(`[roboneo] ${base} error:`, err.message)
      continue
    }
  }

  return res.status(502).json({ ok: false, error: 'All Roboneo endpoints failed' })
}
