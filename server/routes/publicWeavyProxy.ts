import { Router, Request, Response } from 'express'

const router = Router()
const WEAVY_API = 'https://api.weavy.ai/api'

router.all('/{*path}', async (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const path = req.query.path as string | undefined
  if (!path) return res.status(400).json({ error: 'Missing ?path= query param' })

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || ''
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' })

  try {
    const url = `${WEAVY_API}${path}`
    const r = await fetch(url, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
        'Sec-Ch-Ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        Origin: 'https://app.weavy.ai',
        Referer: 'https://app.weavy.ai/',
      },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(15000),
    })
    const text = await r.text()
    let data: any
    try { data = JSON.parse(text) } catch { data = text }
    return res.status(r.status).json(data)
  } catch (err: any) {
    return res.status(502).json({ error: err.message })
  }
})

export default router
