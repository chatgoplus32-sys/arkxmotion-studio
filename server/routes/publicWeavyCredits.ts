import { Router, Request, Response } from 'express'

const router = Router()
const WEAVY_API = 'https://api.weavy.ai/api'
const FIREBASE_KEY = process.env.FIREBASE_KEY || ''

async function refreshWeavyToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
  if (!FIREBASE_KEY) return null
  try {
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      signal: AbortSignal.timeout(10000),
    })
    const data: any = await r.json().catch(() => ({}))
    if (!r.ok || !data.id_token) return null
    return { accessToken: data.id_token, refreshToken: data.refresh_token || refreshToken, expiresIn: Number(data.expires_in) || 3600 }
  } catch { return null }
}

async function fetchWeavyCredits(accessToken: string): Promise<{ credits: number | null; raw: Record<string, any> }> {
  const browserHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
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
  }
  const endpoints = [
    ['workspaces', `${WEAVY_API}/v1/workspaces`],
    ['credits', `${WEAVY_API}/v1/credits`],
    ['user-credits', `${WEAVY_API}/v1/user/credits`],
    ['user-balance', `${WEAVY_API}/v1/user/balance`],
    ['user', `${WEAVY_API}/v1/user`],
    ['account', `${WEAVY_API}/v1/account`],
    ['workspace', `${WEAVY_API}/v1/workspace`],
    ['billing', `${WEAVY_API}/v1/billing`],
  ] as const
  const raw: Record<string, any> = {}
  for (const [name, url] of endpoints) {
    try {
      const r = await fetch(url, { headers: browserHeaders, signal: AbortSignal.timeout(10000) })
      const text = await r.text().catch(() => '')
      let data: any; try { data = JSON.parse(text) } catch { data = text?.slice(0, 500) }
      raw[name] = { status: r.status, data }
      if (!r.ok) continue
      if (!data || typeof data === 'string') continue
      const ws = Array.isArray(data) ? data[0] : (data.workspaces?.[0] ?? data)
      const credits = ws?.credits ?? data.credits ?? data.balance ?? data.totalCredits ?? data.creditsRemaining ?? data.quota ?? data.usage?.credits ?? data.plan?.credits ?? data.data?.credits ?? data.user?.credits ?? null
      if (typeof credits === 'number') return { credits, raw }
    } catch (e: any) { raw[name] = { error: e.message } }
  }
  return { credits: null, raw }
}

router.post('/', async (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const { accessToken: rawToken } = req.body || {}
  if (!rawToken) return res.status(400).json({ ok: false, error: 'Missing accessToken' })
  try {
    let accessToken = rawToken
    if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(rawToken)) {
      const refreshed = await refreshWeavyToken(rawToken)
      if (refreshed?.accessToken) accessToken = refreshed.accessToken
    }
    const result = await fetchWeavyCredits(accessToken)
    return res.status(200).json({ credits: result.credits, _raw: result.raw })
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message, credits: null })
  }
})

router.options('/{*path}', (_req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  return res.status(200).end()
})

export default router
