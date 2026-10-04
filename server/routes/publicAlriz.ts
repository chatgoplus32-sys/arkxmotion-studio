import { fetchWithTimeout } from '../lib/fetchTimeout'
import { Router, Request, Response } from 'express'

const router = Router()
const ALRIZ_UPSTREAM = 'https://alrizmotion.my.id/api'

router.all('/', async (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // Klien mengirim `Authorization: Bearer <key>` (konvensi relay app ini);
  // upstream Alriz memakai header `X-API-Key`.
  const auth = req.headers.authorization || ''
  const key = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : auth.trim()
  if (!key) return res.status(401).json({ ok: false, error: 'Missing Authorization' })

  const subpath = (req.query.path || '') as string
  if (!subpath) return res.status(400).json({ ok: false, error: 'Missing path parameter' })

  try {
    const headers: Record<string, string> = { 'X-API-Key': key, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', Accept: 'application/json' }
    if (req.method === 'POST') headers['Content-Type'] = 'application/json'
    const fetchOpts: RequestInit = { method: req.method, headers }
    if (req.method === 'POST' && req.body) fetchOpts.body = JSON.stringify(req.body)

    const r = await fetchWithTimeout(`${ALRIZ_UPSTREAM}/${subpath}`, fetchOpts)
    const text = await r.text()
    let data: any
    try { data = JSON.parse(text) } catch { data = text }
    return res.status(r.status).json(data)
  } catch (err: any) {
    console.error(`[alriz-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
})

export default router
