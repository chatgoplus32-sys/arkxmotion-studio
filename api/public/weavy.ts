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
    if (!r.ok) return null
    const data = await r.json()
    return {
      accessToken: data.id_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: Number(data.expires_in) || 3600,
    }
  } catch {
    return null
  }
}

function extractEmailFromJwt(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.email || payload.user_id || null
  } catch {
    return null
  }
}

async function getValidAccessToken(token: string): Promise<{ accessToken: string; email?: string }> {
  const refreshed = await refreshWeavyToken(token)
  if (refreshed?.accessToken) {
    return { accessToken: refreshed.accessToken, email: extractEmailFromJwt(refreshed.accessToken) || undefined }
  }
  return { accessToken: token, email: extractEmailFromJwt(token) || undefined }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Weavy-Token')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const token = req.headers['x-weavy-token'] as string || ''
  const action = (req.query.action || req.body?.action || '') as string

  if (!token) {
    return res.status(400).json({ ok: false, error: 'Missing X-Weavy-Token header' })
  }

  try {
    const { accessToken, email } = await getValidAccessToken(token)

    const authHeaders = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }

    if (action === 'balance') {
      const endpoints = [
        `${WEAVY_API}/v1/credits`,
        `${WEAVY_API}/v1/user/credits`,
        `${WEAVY_API}/v1/user/balance`,
        `${WEAVY_API}/v1/user`,
        `${WEAVY_API}/v1/account`,
        `${WEAVY_API}/v1/subscription`,
      ]

      for (const url of endpoints) {
        try {
          const r = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(8000),
          })

          if (!r.ok) continue

          const data = await r.json().catch(() => null)
          console.log(`[weavy-proxy] balance ${url} → ${r.status}`, JSON.stringify(data).slice(0, 300))

          const credits = data?.credits ?? data?.balance ?? data?.totalCredits ?? data?.creditsRemaining ?? data?.quota ?? data?.usage?.credits ?? data?.plan?.credits ?? data?.data?.credits ?? data?.user?.credits ?? null

          if (typeof credits === 'number') {
            return res.status(200).json({ ok: true, data: { credits, email }, status: r.status })
          }
        } catch (e: any) {
          continue
        }
      }

      try {
        const r = await fetch(`${WEAVY_API}/v1/workspaces`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8000),
        })
        if (r.ok) {
          const data = await r.json().catch(() => null)
          const workspaces = data?.workspaces || data
          const ws = Array.isArray(workspaces) ? workspaces[0] : workspaces
          if (typeof ws?.credits === 'number') {
            return res.status(200).json({ ok: true, data: { credits: ws.credits, email }, status: r.status })
          }
        }
      } catch (e: any) {
        // continue
      }

      console.log(`[weavy-proxy] balance → all endpoints failed`)
      return res.status(200).json({ ok: true, data: { credits: null, email }, status: 200 })
    }

    if (action === 'generate') {
      const payload = req.body?.payload || req.body
      const { model, prompt, imageUrl, aspectRatio, duration, negativePrompt, quality } = payload || {}

      const nodes = [
        {
          id: 'input',
          type: 'input',
          data: {
            model: model || 'kling-2.1',
            prompt: prompt || '',
            image_url: imageUrl || null,
            aspect_ratio: aspectRatio || '9:16',
            duration: duration || 5,
            negative_prompt: negativePrompt || null,
            quality: quality || null,
          },
        },
      ]

      const r = await fetch(`${WEAVY_API}/v1/batches/recipes/execute`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ nodes, numberOfRuns: 1 }),
        signal: AbortSignal.timeout(30000),
      })

      const text = await r.text()
      if (!r.ok) {
        console.log(`[weavy-proxy] generate → ${r.status}`, text.slice(0, 300))
        return res.status(r.status).json({ ok: false, error: `Weavy generate failed (${r.status}): ${text.slice(0, 200)}` })
      }

      const data = JSON.parse(text)
      const batchId = data?.batchId || data?.id
      console.log(`[weavy-proxy] generate → ${r.status}`, JSON.stringify(data).slice(0, 500))

      if (!batchId) {
        return res.status(500).json({ ok: false, error: 'No batchId returned', data })
      }

      return res.status(200).json({ ok: true, data: { batchId, ...data }, status: r.status })
    }

    if (action === 'status') {
      const batchId = req.query.batchId || req.body?.batchId
      if (!batchId) return res.status(400).json({ ok: false, error: 'Missing batchId' })

      const r = await fetch(`${WEAVY_API}/v1/batches/${batchId}/status`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      })

      if (!r.ok) {
        return res.status(r.status).json({ ok: false, error: `Status check failed (${r.status})` })
      }

      const data = await r.json()
      console.log(`[weavy-proxy] status → ${r.status}`, JSON.stringify(data).slice(0, 500))
      return res.status(200).json({ ok: true, data, status: r.status })
    }

    return res.status(400).json({ ok: false, error: `Unknown action: ${action}` })
  } catch (err: any) {
    console.error(`[weavy-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
