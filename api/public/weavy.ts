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
    console.log(`[weavy-proxy] firebase refresh → ${r.status}`, JSON.stringify(data).slice(0, 300))
    if (!r.ok || !data.id_token) return null
    return {
      accessToken: data.id_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: Number(data.expires_in) || 3600,
    }
  } catch (e: any) {
    console.log(`[weavy-proxy] firebase refresh error:`, e.message)
    return null
  }
}

function extractEmailFromJwt(token: string): string | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1]))
    return payload.email || payload.user_id || null
  } catch {
    return null
  }
}

function isJwtToken(token: string): boolean {
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
}

async function resolveAccessToken(token: string): Promise<{ accessToken: string; refreshToken?: string; email?: string }> {
  const isJwt = isJwtToken(token)
  console.log(`[weavy-proxy] resolveAccessToken: isJwt=${isJwt} tokenLen=${token.length} tokenStart=${token.slice(0, 20)}`)

  if (isJwt) {
    const email = extractEmailFromJwt(token)
    console.log(`[weavy-proxy] JWT detected, email=${email}, trying refresh...`)
    const refreshed = await refreshWeavyToken(token)
    if (refreshed?.accessToken) {
      console.log(`[weavy-proxy] JWT → refreshed OK, newEmail=${extractEmailFromJwt(refreshed.accessToken)}`)
      return { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, email: extractEmailFromJwt(refreshed.accessToken) || email || undefined }
    }
    console.log(`[weavy-proxy] JWT → refresh FAILED, using raw JWT token (may be expired)`)
    return { accessToken: token, email: email || undefined }
  }

  console.log(`[weavy-proxy] RefreshToken detected, trying refresh...`)
  const refreshed = await refreshWeavyToken(token)
  if (refreshed?.accessToken) {
    console.log(`[weavy-proxy] refreshToken → refreshed OK, email=${extractEmailFromJwt(refreshed.accessToken)}`)
    return { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, email: extractEmailFromJwt(refreshed.accessToken) || undefined }
  }
  console.log(`[weavy-proxy] refreshToken → refresh FAILED, using raw token`)
  return { accessToken: token, email: extractEmailFromJwt(token) || undefined }
}

async function fetchWeavyCredits(accessToken: string): Promise<number | null> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
  }
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
        headers,
        signal: AbortSignal.timeout(8000),
      })
      const text = await r.text().catch(() => '')
      console.log(`[weavy-proxy] credits ${url} → ${r.status} body=${text.slice(0, 400)}`)
      if (!r.ok) continue
      let data: any
      try { data = JSON.parse(text) } catch { continue }

      const credits = data?.credits ?? data?.balance ?? data?.totalCredits ?? data?.creditsRemaining ?? data?.quota ?? data?.usage?.credits ?? data?.plan?.credits ?? data?.data?.credits ?? data?.user?.credits ?? null
      if (typeof credits === 'number') return credits

      if (data && typeof data === 'object') {
        const flatKeys = Object.keys(data).filter(k => typeof data[k] === 'number')
        console.log(`[weavy-proxy] credits ${url} → numeric keys:`, flatKeys)
      }
    } catch {
      continue
    }
  }

  try {
    const r = await fetch(`${WEAVY_API}/v1/workspaces`, {
      headers,
      signal: AbortSignal.timeout(8000),
    })
    const text = await r.text().catch(() => '')
    console.log(`[weavy-proxy] credits ${WEAVY_API}/v1/workspaces → ${r.status} body=${text.slice(0, 400)}`)
    if (r.ok) {
      let data: any
      try { data = JSON.parse(text) } catch { return null }
      const workspaces = data?.workspaces || data
      const ws = Array.isArray(workspaces) ? workspaces[0] : workspaces
      if (typeof ws?.credits === 'number') return ws.credits
      if (ws && typeof ws === 'object') {
        console.log(`[weavy-proxy] workspaces[0] keys:`, Object.keys(ws))
      }
    }
  } catch {}

  return null
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
    const { accessToken, refreshToken, email } = await resolveAccessToken(token)
    console.log(`[weavy-proxy] resolved token: email=${email} tokenLen=${accessToken?.length}`)

    const authHeaders = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    }

    if (action === 'balance') {
      const credits = await fetchWeavyCredits(accessToken)
      console.log(`[weavy-proxy] balance → credits=${credits} email=${email}`)
      return res.status(200).json({
        ok: true,
        data: { credits, email },
        refreshToken: refreshToken || undefined,
      })
    }

    if (action === 'generate') {
      const payload = req.body?.payload || req.body
      const { model, prompt, imageUrl, aspectRatio, duration, negativePrompt, quality } = payload || {}

      const nodeData: any = {
        model: model || 'kling-2.1',
        prompt: prompt || '',
        image_url: imageUrl || null,
        aspect_ratio: aspectRatio || '9:16',
        negative_prompt: negativePrompt || null,
        quality: quality || null,
      }

      // Only include duration for video models (not null/undefined)
      if (duration != null) {
        nodeData.duration = duration
      }

      const nodes = [
        {
          id: 'input',
          type: 'input',
          data: nodeData,
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

    // === Image Generation Actions (recipe-based) ===

    if (action === 'image-create-recipe') {
      const r = await fetch(`${WEAVY_API}/v1/recipes/create`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ scope: 'PERSONAL' }),
        signal: AbortSignal.timeout(15000),
      })
      const text = await r.text()
      let data: any; try { data = JSON.parse(text) } catch { data = null }
      console.log(`[weavy-proxy] image-create-recipe → ${r.status}`, text.slice(0, 300))
      if (!r.ok || !data) return res.status(r.status || 500).json({ ok: false, error: data?.error || text.slice(0, 200) || `HTTP ${r.status}` })
      return res.status(200).json({ ok: true, data: { recipeId: data?.id || data?.recipeId, v3: data?.v3 } })
    }

    if (action === 'image-save-recipe') {
      const { recipeId, nodes, edges, v3 } = req.body || {}
      if (!recipeId) return res.status(400).json({ ok: false, error: 'Missing recipeId' })
      const r = await fetch(`${WEAVY_API}/v1/recipes/${recipeId}/save`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ nodes: nodes || [], edges: edges || [], v3: v3 || '', lastUpdatedAt: new Date().toISOString() }),
        signal: AbortSignal.timeout(15000),
      })
      const text = await r.text()
      console.log(`[weavy-proxy] image-save-recipe → ${r.status}`, text.slice(0, 300))
      if (!r.ok) return res.status(r.status).json({ ok: false, error: text.slice(0, 200) || `HTTP ${r.status}` })
      return res.status(200).json({ ok: true })
    }

    if (action === 'image-approve-model') {
      const { modelId } = req.body || {}
      if (!modelId) return res.status(400).json({ ok: false, error: 'Missing modelId' })
      try {
        await fetch(`${WEAVY_API}/v1/workspaces/models/approve`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ modelIds: [modelId] }),
          signal: AbortSignal.timeout(10000),
        })
      } catch {}
      return res.status(200).json({ ok: true })
    }

    if (action === 'image-execute') {
      const { recipeId, nodes, edges, numberOfRuns } = req.body || {}
      if (!recipeId) return res.status(400).json({ ok: false, error: 'Missing recipeId' })
      console.log(`[weavy-proxy] image-execute: recipeId=${recipeId} nodes=${nodes?.length} edges=${edges?.length}`)
      const r = await fetch(`${WEAVY_API}/v1/batches/recipes/${recipeId}/execute`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ nodes: nodes || [], edges: edges || [], numberOfRuns: numberOfRuns || 1 }),
        signal: AbortSignal.timeout(30000),
      })
      const text = await r.text()
      let data: any; try { data = JSON.parse(text) } catch { data = null }
      console.log(`[weavy-proxy] image-execute → ${r.status}`, text.slice(0, 500))
      if (!r.ok || !data) return res.status(r.status || 500).json({ ok: false, error: data?.error || text.slice(0, 500) || `HTTP ${r.status}` })
      const batchId = data?.batchId || data?.id
      if (!batchId) return res.status(500).json({ ok: false, error: 'No batchId returned', data })
      return res.status(200).json({ ok: true, data: { batchId, ...data } })
    }

    // Direct execute without recipe creation (bypass Cloudflare on /recipes/create)
    if (action === 'image-direct-execute') {
      const { nodes, edges, numberOfRuns } = req.body || {}
      console.log(`[weavy-proxy] image-direct-execute: nodes=${nodes?.length} edges=${edges?.length}`)
      const r = await fetch(`${WEAVY_API}/v1/batches/recipes/execute`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ nodes: nodes || [], edges: edges || [], numberOfRuns: numberOfRuns || 1 }),
        signal: AbortSignal.timeout(60000),
      })
      const text = await r.text()
      let data: any; try { data = JSON.parse(text) } catch { data = null }
      console.log(`[weavy-proxy] image-direct-execute → ${r.status}`, text.slice(0, 500))
      if (!r.ok || !data) return res.status(r.status || 500).json({ ok: false, error: data?.error || text.slice(0, 500) || `HTTP ${r.status}` })
      const batchId = data?.batchId || data?.id
      if (!batchId) return res.status(500).json({ ok: false, error: 'No batchId returned', data })
      return res.status(200).json({ ok: true, data: { batchId, ...data } })
    }

    if (action === 'image-status') {
      const { recipeId, batchId } = req.body || {}
      if (!recipeId || !batchId) return res.status(400).json({ ok: false, error: 'Missing recipeId or batchId' })
      const r = await fetch(`${WEAVY_API}/v1/batches/recipes/${recipeId}/batches/${batchId}/status`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        return res.status(r.status).json({ ok: false, error: `Status check failed (${r.status}): ${text.slice(0, 200)}` })
      }
      const data = await r.json()
      console.log(`[weavy-proxy] image-status → ${r.status}`, JSON.stringify(data).slice(0, 500))
      return res.status(200).json({ ok: true, data })
    }

    return res.status(400).json({ ok: false, error: `Unknown action: ${action}` })
  } catch (err: any) {
    console.error(`[weavy-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
