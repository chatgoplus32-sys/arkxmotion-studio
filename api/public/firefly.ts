import type { VercelRequest, VercelResponse } from '@vercel/node'

const FIREFLY_API = 'https://firefly.adobe.io'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key, X-Account-Id, X-Firefly-Token, X-Firefly-Api-Key, X-Firefly-Account, X-Firefly-Session, X-Firefly-Nonce, X-Firefly-Arp')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const path = req.query.path as string || ''

  if (path) {
    const authHeader = req.headers.authorization || ''
    const apiKey = req.headers['x-api-key'] as string || ''
    const accountId = req.headers['x-account-id'] as string || ''

    const fetchHeaders: Record<string, string> = {
      'accept': '*/*',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'origin': 'https://firefly.adobe.com',
      'referer': 'https://firefly.adobe.com/',
    }
    if (authHeader) fetchHeaders['authorization'] = authHeader
    if (apiKey) fetchHeaders['x-api-key'] = apiKey
    if (accountId) fetchHeaders['x-account-id'] = accountId

    try {
      const r = await fetch(`${FIREFLY_API}/v1/${path}`, {
        method: req.method,
        headers: fetchHeaders,
      })
      const text = await r.text()
      let data: any
      try { data = JSON.parse(text) } catch { data = { raw: text } }
      console.log(`[firefly-proxy] ${req.method} /v1/${path} → ${r.status}`)
      if (!r.ok) return res.status(r.status).json({ ok: false, error: text.slice(0, 300) })
      return res.json(data)
    } catch (err: any) {
      return res.status(502).json({ ok: false, error: err.message })
    }
  }

  const token = req.headers['x-firefly-token'] as string || ''
  const apiKey = req.headers['x-firefly-api-key'] as string || ''
  const account = req.headers['x-firefly-account'] as string || ''
  const session = req.headers['x-firefly-session'] as string || ''
  const nonce = req.headers['x-firefly-nonce'] as string || ''
  const arpSession = req.headers['x-firefly-arp'] as string || ''

  const { url, method, body, headers: customHeaders, pollMode } = req.body || {}

  if (!url) {
    return res.status(400).json({ ok: false, error: 'Missing url or path' })
  }

  try {
    const isPoll = pollMode === true

    const fetchHeaders: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'accept': '*/*',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
      'origin': 'https://firefly.adobe.com',
      'referer': 'https://firefly.adobe.com/',
    }

    if (!isPoll) {
      if (apiKey) fetchHeaders['x-api-key'] = apiKey
      if (nonce) fetchHeaders['x-nonce'] = nonce
      if (arpSession) fetchHeaders['x-arp-session-id'] = arpSession
      if (account) fetchHeaders['x-gw-ims-user-id'] = account
      if (session && !arpSession) fetchHeaders['x-arp-session-id'] = session
      fetchHeaders['sec-fetch-site'] = 'cross-site'
      fetchHeaders['sec-fetch-mode'] = 'cors'
      fetchHeaders['sec-fetch-dest'] = 'empty'
    }
    if (customHeaders) Object.assign(fetchHeaders, customHeaders)

    const fetchOpts: RequestInit = {
      method: method || 'POST',
      headers: fetchHeaders,
    }
    if (body && method !== 'GET') {
      if (body.base64Body && body.binaryContentType) {
        const binaryStr = atob(body.base64Body)
        const bytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
        fetchOpts.body = bytes
        fetchHeaders['content-type'] = body.binaryContentType
      } else {
        fetchHeaders['content-type'] = 'application/json'
        fetchOpts.body = JSON.stringify(body)
      }
    }

    const r = await fetch(url, fetchOpts)
    const text = await r.text()
    console.log(`[firefly-proxy] ${isPoll ? 'POLL' : 'SUBMIT'} ${method || 'POST'} ${url} → ${r.status}`)

    let data: any
    try { data = JSON.parse(text) } catch { data = { raw: text } }

    if (isPoll) {
      const taskStatus = r.headers.get('x-task-status') || ''
      if (taskStatus) res.setHeader('X-Task-Status', taskStatus)
      const accessError = r.headers.get('x-access-error') || ''
      if (accessError) res.setHeader('X-Access-Error', accessError)
    }

    if (!r.ok) {
      return res.status(r.status).json({ ok: false, status: r.status, data, error: text.slice(0, 300) })
    }

    return res.json({ ok: true, data })
  } catch (err: any) {
    console.error(`[firefly-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
