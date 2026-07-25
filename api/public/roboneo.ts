import type { VercelRequest, VercelResponse } from '@vercel/node'

const GATEWAY_URL = 'https://ai-engine-gateway-roboneo.meitu.com/roboneo/sync/request'
const RELAY_URL = 'https://aacreative.vercel.app/api/public/roboneo'

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
    const roboneoRes = await fetch(`${GATEWAY_URL}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access-token': String(token),
        'client-id': '1189857684',
        'Origin': 'https://www.roboneo.com',
        'Referer': 'https://www.roboneo.com/',
      },
      body: JSON.stringify(parameter || {}),
    })

    const text = await roboneoRes.text()
    let data: any = null
    try { data = JSON.parse(text) } catch {}

    console.log(`[roboneo] gateway ${roboneoRes.status}:`, text.slice(0, 500))

    if (data?.error_code === 98) {
      console.log(`[roboneo] direct gateway rejected (error 98), trying relay...`)
      const relayRes = await fetch(RELAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Roboneo-Token': token,
        },
        body: JSON.stringify({ path, parameter }),
      })
      const relayText = await relayRes.text()
      let relayData: any = null
      try { relayData = JSON.parse(relayText) } catch {}
      console.log(`[roboneo] relay response:`, relayText.slice(0, 500))
      return res.status(200).json({ ok: relayData?.ok ?? false, status: relayData?.status ?? relayRes.status, data: relayData?.data ?? relayData })
    }

    return res.status(200).json({ ok: data?.error_code === 0, status: roboneoRes.status, data })
  } catch (err: any) {
    console.error(`[roboneo] gateway error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
