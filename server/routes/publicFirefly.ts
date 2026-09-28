import { Router, Request, Response } from 'express'

// Proxy Firefly (Adobe).
//
// Ini dulu hidup di stack Vercel (api/public/firefly.ts) yang kini mati, jadi di
// produksi VPS jalan ini menjawab 404 dan tombol "Cek saldo Firefly" selalu gagal.
// Dipindahkan apa adanya: dua mode, alur, dan bentuk respons yang sama seperti
// versi lamanya supaya frontend tidak perlu berubah.
//
//   GET  ?path=<endpoint>  → teruskan ke /v1/<endpoint> dengan header auth klien
//   POST { url, method, body, headers, pollMode } → teruskan request apa adanya
const router = Router()

const FIREFLY_API = 'https://firefly.adobe.io'

function header(req: Request, name: string): string {
  const value = req.headers[name]
  return typeof value === 'string' ? value : ''
}

// Mode 1: balance / endpoint GET sederhana.
router.get('/', async (req: Request, res: Response) => {
  const path = typeof req.query.path === 'string' ? req.query.path : ''
  if (!path) return res.status(400).json({ ok: false, error: 'Missing url or path' })

  const authHeader = header(req, 'authorization')
  const apiKey = header(req, 'x-api-key')
  const accountId = header(req, 'x-account-id')

  const fetchHeaders: Record<string, string> = {
    accept: '*/*',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    origin: 'https://firefly.adobe.com',
    referer: 'https://firefly.adobe.com/',
  }
  if (authHeader) fetchHeaders['authorization'] = authHeader
  if (apiKey) fetchHeaders['x-api-key'] = apiKey
  if (accountId) fetchHeaders['x-account-id'] = accountId

  try {
    const r = await fetch(`${FIREFLY_API}/v1/${path}`, { method: 'GET', headers: fetchHeaders })
    const text = await r.text()
    let data: any
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    console.log(`[firefly-proxy] GET /v1/${path} → ${r.status}`)
    if (!r.ok) return res.status(r.status).json({ ok: false, error: text.slice(0, 300) })
    return res.json(data)
  } catch (err: any) {
    return res.status(502).json({ ok: false, error: err.message })
  }
})

// Mode 2: generate/poll — request diteruskan apa adanya ke URL yang dikirim klien.
router.post('/', async (req: Request, res: Response) => {
  const token = header(req, 'x-firefly-token')
  const apiKey = header(req, 'x-firefly-api-key')
  const account = header(req, 'x-firefly-account')
  const session = header(req, 'x-firefly-session')
  const nonce = header(req, 'x-firefly-nonce')
  const arpSession = header(req, 'x-firefly-arp')

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
        fetchOpts.body = Buffer.from(body.base64Body, 'base64')
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
    console.error('[firefly-proxy] error:', err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
})

export default router
