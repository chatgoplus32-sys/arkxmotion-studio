import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firefly-Token, X-Firefly-Api-Key, X-Firefly-Account, X-Firefly-Session')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const token = req.headers['x-firefly-token'] as string || ''
  const apiKey = req.headers['x-firefly-api-key'] as string || 'SunbreakWebUI1'
  const account = req.headers['x-firefly-account'] as string || ''
  const session = req.headers['x-firefly-session'] as string || ''

  const { url, method, body, headers: customHeaders } = req.body || {}

  if (!url) {
    return res.status(400).json({ ok: false, error: 'Missing url' })
  }

  try {
    const fetchHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-api-key': apiKey,
    }
    if (account) fetchHeaders['x-gw-ims-user-id'] = account
    if (session) fetchHeaders['x-arp-session-id'] = session
    if (customHeaders) Object.assign(fetchHeaders, customHeaders)

    const fetchOpts: RequestInit = {
      method: method || 'POST',
      headers: fetchHeaders,
    }
    if (body && method !== 'GET') {
      fetchOpts.body = JSON.stringify(body)
    }

    const r = await fetch(url, fetchOpts)
    const text = await r.text()
    console.log(`[firefly-proxy] ${method || 'POST'} ${url} → ${r.status}`)

    let data: any
    try { data = JSON.parse(text) } catch { data = { raw: text } }

    if (!r.ok) {
      return res.status(r.status).json({ ok: false, status: r.status, data, error: text.slice(0, 200) })
    }

    return res.json({ ok: true, data })
  } catch (err: any) {
    console.error(`[firefly-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
