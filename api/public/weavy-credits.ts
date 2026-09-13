import type { VercelRequest, VercelResponse } from '@vercel/node'

const WEAVY_API = 'https://api.weavy.ai/api'
const FIREBASE_KEY = 'AIzaSyC-qLy3TFyXMogJPfMkZJ9H_q46hEu1sxI'

async function refreshWeavyToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
  try {
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      signal: AbortSignal.timeout(10000),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok || !data.id_token) return null
    return {
      accessToken: data.id_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: Number(data.expires_in) || 3600,
    }
  } catch { return null }
}

async function fetchWeavyCredits(accessToken: string): Promise<number | null> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    'Origin': 'https://app.weavy.ai',
    'Referer': 'https://app.weavy.ai/',
  }

  const endpoints = [
    ['workspaces', `${WEAVY_API}/v1/workspaces`],
    ['credits', `${WEAVY_API}/v1/credits`],
    ['user-credits', `${WEAVY_API}/v1/user/credits`],
    ['user-balance', `${WEAVY_API}/v1/user/balance`],
  ] as const

  for (const [name, url] of endpoints) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) })
      console.log(`[weavy-credits] /${name} → ${r.status}`)
      if (!r.ok) continue
      const data = await r.json().catch(() => null)
      if (!data) continue

      const ws = Array.isArray(data) ? data[0] : (data.workspaces?.[0] ?? data)
      const credits = ws?.credits ?? data.credits ?? data.balance ?? data.totalCredits ??
        data.creditsRemaining ?? data.quota ?? data.usage?.credits ?? data.plan?.credits ??
        data.data?.credits ?? data.user?.credits ?? null

      console.log(`[weavy-credits] /${name} → credits=${credits}`)
      if (typeof credits === 'number') return credits
    } catch (e: any) {
      console.log(`[weavy-credits] /${name} error:`, e.message)
    }
  }
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const { accessToken: rawToken } = req.body || {}
  if (!rawToken) return res.status(400).json({ ok: false, error: 'Missing accessToken' })

  try {
    let accessToken = rawToken

    // If it's a refresh token, try to refresh first
    if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(rawToken)) {
      const refreshed = await refreshWeavyToken(rawToken)
      if (refreshed?.accessToken) {
        accessToken = refreshed.accessToken
        console.log(`[weavy-credits] token refreshed OK`)
      } else {
        console.log(`[weavy-credits] token refresh failed, trying raw token`)
      }
    }

    const credits = await fetchWeavyCredits(accessToken)
    console.log(`[weavy-credits] final credits=${credits}`)

    return res.status(200).json({ credits })
  } catch (err: any) {
    console.error(`[weavy-credits] error:`, err.message)
    return res.status(500).json({ ok: false, error: err.message, credits: null })
  }
}
