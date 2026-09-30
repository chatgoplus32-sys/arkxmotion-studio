import type { VercelRequest, VercelResponse } from '@vercel/node'

const SEAVI_UPSTREAM = 'https://api.seavilabs.site/v1'

const FETCH_TIMEOUT_MS = 30000
async function fetchWithTimeout(url: string | URL, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? FETCH_TIMEOUT_MS
  const ac = new AbortController()
  const tid = setTimeout(() => ac.abort(), timeoutMs)
  try { return await fetch(url, { ...init, signal: ac.signal }) } finally { clearTimeout(tid) }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const auth = req.headers.authorization || ''
  if (!auth) return res.status(401).json({ ok: false, error: 'Missing Authorization' })

  const subpath = (req.query.path || '') as string
  if (!subpath) return res.status(400).json({ ok: false, error: 'Missing path parameter' })

  try {
    const headers: Record<string, string> = { Authorization: auth, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', Accept: 'application/json' }
    if (req.method === 'POST') headers['Content-Type'] = 'application/json'

    const fetchOpts: RequestInit = { method: req.method, headers }
    if (req.method === 'POST' && req.body) fetchOpts.body = JSON.stringify(req.body)

    const r = await fetchWithTimeout(`${SEAVI_UPSTREAM}/${subpath}`, fetchOpts)
    const text = await r.text()
    console.log(`[seavi-proxy] ${req.method} ${subpath} → ${r.status}`)

    let data: any
    try { data = JSON.parse(text) } catch { data = text }

    return res.status(r.status).json(data)
  } catch (err: any) {
    console.error(`[seavi-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
