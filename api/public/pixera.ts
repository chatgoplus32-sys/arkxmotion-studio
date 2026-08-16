import type { VercelRequest, VercelResponse } from '@vercel/node'

const PIXERA_API = 'https://api-dorax.doraai.id'

async function refreshPixeraToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const r = await fetch(`${PIXERA_API}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) return null
    const data = await r.json().catch(() => ({}))
    if (!data?.accessToken || !data?.refreshToken) return null
    return { accessToken: data.accessToken, refreshToken: data.refreshToken }
  } catch (e: any) {
    console.log(`[pixera-proxy] refresh error:`, e.message)
    return null
  }
}

function extractEmailFromJwt(token: string): string | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.email || null
  } catch {
    return null
  }
}

function isJwtToken(token: string): boolean {
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
}

async function resolveAccessToken(token: string): Promise<{ accessToken: string; refreshToken?: string; email?: string; refreshed: boolean }> {
  const isJwt = isJwtToken(token)
  const email = extractEmailFromJwt(token) || undefined

  // JWT = access token → use directly (do NOT try to refresh with it)
  if (isJwt) {
    return { accessToken: token, email, refreshed: false }
  }

  // Non-JWT = refresh token → exchange for access token
  const refreshed = await refreshPixeraToken(token)
  if (refreshed?.accessToken) {
    return { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, email: extractEmailFromJwt(refreshed.accessToken) || email, refreshed: true }
  }
  return { accessToken: token, email, refreshed: false }
}

async function fetchPixeraCredits(accessToken: string): Promise<number | null> {
  try {
    const r = await fetch(`${PIXERA_API}/credits/balance`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    })
    const text = await r.text()
    let data: any; try { data = JSON.parse(text) } catch { data = null }
    console.log(`[pixera-proxy] /credits/balance → ${r.status}`, text.slice(0, 300))
    if (!r.ok) return null
    return typeof data?.balance === 'number' ? data.balance : null
  } catch (e: any) {
    console.log(`[pixera-proxy] balance error:`, e.message)
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Pixera-Token')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const token = req.headers['x-pixera-token'] as string || ''
  const action = (req.query.action || req.body?.action || '') as string

  console.log(`[pixera-proxy] action=${action}, token=${token.slice(0, 20)}... (isJwt=${isJwtToken(token)})`)

  if (!token) {
    return res.status(400).json({ ok: false, error: 'Missing X-Pixera-Token header' })
  }

  try {
    const { accessToken, refreshToken, email, refreshed } = await resolveAccessToken(token)

    if (!refreshed && !isJwtToken(token)) {
      console.log(`[pixera-proxy] WARN: refresh token could not be refreshed`)
    }

    const authHeaders = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }

    if (action === 'balance') {
      const credits = await fetchPixeraCredits(accessToken)
      return res.status(200).json({
        ok: true,
        data: { credits, email },
        refreshToken: refreshToken || undefined,
      })
    }

    if (action === 'check-pricing') {
      const { model, inputParams } = req.body?.payload || {}
      const r = await fetch(`${PIXERA_API}/credits/check-pricing`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ model, inputParams }),
        signal: AbortSignal.timeout(10000),
      })
      if (!r.ok) return res.status(r.status).json({ ok: false, error: `Pricing check failed (${r.status})` })
      const data = await r.json()
      return res.status(200).json({ ok: true, data })
    }

    if (action === 'generate') {
      const payload = req.body?.payload || req.body
      const { model, input, params, notifyViaEmail } = payload || {}

      const r = await fetch(`${PIXERA_API}/assets/generate`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          model,
          input: input || params,
          params: params || input,
          notifyViaEmail: notifyViaEmail || false,
        }),
        signal: AbortSignal.timeout(60000),
      })

      const text = await r.text()
      let data: any
      try { data = JSON.parse(text) } catch { data = null }

      console.log(`[pixera-proxy] generate → ${r.status}`, text.slice(0, 500))

      if (!r.ok || !data) {
        return res.status(r.status || 500).json({ ok: false, error: data?.message || text.slice(0, 300) || `HTTP ${r.status}` })
      }

      const assetId = data?.assetId || data?.asset_id || data?.id
      const taskId = data?.task_id || data?.taskId

      return res.status(200).json({
        ok: true,
        data: { assetId, taskId, ...data },
        refreshToken: refreshToken || undefined,
      })
    }

    if (action === 'status') {
      const assetId = req.query.assetId as string || req.body?.assetId
      if (!assetId) return res.status(400).json({ ok: false, error: 'Missing assetId' })

      const r = await fetch(`${PIXERA_API}/assets/${assetId}/status`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      })

      if (!r.ok) {
        return res.status(r.status).json({ ok: false, error: `Status check failed (${r.status})` })
      }

      const data = await r.json()
      return res.status(200).json({ ok: true, data })
    }

    if (action === 'task-status') {
      const taskId = req.query.taskId as string || req.body?.taskId
      if (!taskId) return res.status(400).json({ ok: false, error: 'Missing taskId' })

      const r = await fetch(`${PIXERA_API}/assets/task-status?taskId=${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      })

      if (!r.ok) {
        return res.status(r.status).json({ ok: false, error: `Task status check failed (${r.status})` })
      }

      const data = await r.json()
      return res.status(200).json({ ok: true, data })
    }

    if (action === 'asset') {
      const assetId = req.query.assetId as string || req.body?.assetId
      if (!assetId) return res.status(400).json({ ok: false, error: 'Missing assetId' })

      const r = await fetch(`${PIXERA_API}/assets/${assetId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      })

      if (!r.ok) {
        return res.status(r.status).json({ ok: false, error: `Asset fetch failed (${r.status})` })
      }

      const data = await r.json()
      return res.status(200).json({ ok: true, data })
    }

    if (action === 'upload') {
      const contentType = req.headers['content-type'] || ''
      if (!contentType.includes('multipart/form-data')) {
        return res.status(400).json({ ok: false, error: 'Expected multipart/form-data' })
      }
      try {
        const chunks: Buffer[] = []
        for await (const chunk of req) { chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk) }
        const bodyBuffer = Buffer.concat(chunks)

        const r = await fetch(`${PIXERA_API}/assets/upload`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': contentType,
          },
          body: bodyBuffer,
          signal: AbortSignal.timeout(60000),
        })
        const text = await r.text()
        let data: any; try { data = JSON.parse(text) } catch { data = null }
        if (!r.ok || !data) return res.status(r.status || 500).json({ ok: false, error: data?.error || text.slice(0, 300) || `HTTP ${r.status}` })
        return res.status(200).json({ ok: true, data, refreshToken: refreshToken || undefined })
      } catch (err: any) {
        return res.status(500).json({ ok: false, error: err.message })
      }
    }

    return res.status(400).json({ ok: false, error: `Unknown action: ${action}` })
  } catch (err: any) {
    console.error(`[pixera-proxy] error:`, err)
    return res.status(500).json({ ok: false, error: err.message || 'Internal server error' })
  }
}
