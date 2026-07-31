const WEAVY_API = 'https://api.weavy.ai/api'
const FIREBASE_KEY = 'AIzaSyC-qLy3TFyXMogJPfMkZJ9H_q46hEu1sxI'

async function refreshWeavyToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
  try {
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    })
    if (!r.ok) return null
    const data = await r.json()
    if (!data.id_token) return null
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
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1]))
    return payload.email || payload.user_id || null
  } catch {
    return null
  }
}

function isRefreshToken(token: string): boolean {
  return !/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) && token.length > 40
}

async function fetchWeavyCreditsClient(accessToken: string): Promise<number | null> {
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
      })
      if (!r.ok) continue
      const data = await r.json().catch(() => null)
      const credits = data?.credits ?? data?.balance ?? data?.totalCredits ?? data?.creditsRemaining ?? data?.quota ?? data?.usage?.credits ?? data?.plan?.credits ?? data?.data?.credits ?? data?.user?.credits ?? null
      if (typeof credits === 'number') return credits
    } catch { continue }
  }

  try {
    const r = await fetch(`${WEAVY_API}/v1/workspaces`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (r.ok) {
      const data = await r.json().catch(() => null)
      const workspaces = data?.workspaces || data
      const ws = Array.isArray(workspaces) ? workspaces[0] : workspaces
      if (typeof ws?.credits === 'number') return ws.credits
    }
  } catch {}

  return null
}

async function resolveAndFetchCredits(token: string): Promise<{ ok: boolean; credits: number | null; email?: string }> {
  if (isRefreshToken(token)) {
    const refreshed = await refreshWeavyToken(token)
    if (refreshed?.accessToken) {
      const email = extractEmailFromJwt(refreshed.accessToken) || undefined
      const credits = await fetchWeavyCreditsClient(refreshed.accessToken)
      return { ok: true, credits, email }
    }
  }
  const email = extractEmailFromJwt(token) || undefined
  const credits = await fetchWeavyCreditsClient(token)
  return { ok: true, credits, email }
}

const WEAVY_PROXY = '/api/public/weavy'

export interface WeavyGenerateParams {
  token: string
  model: string
  prompt: string
  imageUrl?: string
  aspectRatio?: string
  duration?: number
  negativePrompt?: string
  quality?: string
}

export interface WeavyGenerateResult {
  ok: boolean
  taskId?: string
  error?: string
  raw?: any
}

export interface WeavyStatusResult {
  ok: boolean
  status?: string
  videoUrl?: string
  progress?: number
  error?: string
  raw?: any
}

export async function checkWeavyBalance(token: string): Promise<{ ok: boolean; balance?: number | null; email?: string; error?: string }> {
  try {
    const result = await resolveAndFetchCredits(token)
    return { ok: result.ok, balance: result.credits, email: result.email }
  } catch (err: any) {
    return { ok: true, balance: null, error: err.message }
  }
}

export async function checkWeavyBalanceDirect(token: string): Promise<{ ok: boolean; balance?: number | null; email?: string; error?: string }> {
  try {
    const result = await resolveAndFetchCredits(token)
    return { ok: result.ok, balance: result.credits, email: result.email }
  } catch (err: any) {
    return { ok: false, balance: null, error: err.message }
  }
}

function resolveAspectRatio(ratio: string): string {
  const map: Record<string, string> = {
    '9:16': '9:16',
    '16:9': '16:9',
    '1:1': '1:1',
    '4:3': '4:3',
    '3:4': '3:4',
  }
  return map[ratio] || '9:16'
}

function resolveModel(modelKey: string): string {
  const map: Record<string, string> = {
    'kling-2.1': 'kling-2.1',
    'kling-1.6-standard': 'kling-1.6-standard',
    'kling-1.6-pro': 'kling-1.6-pro',
    'kling-3-pro': 'kling-3-pro',
    'sora-2': 'sora-2',
    'veo-3': 'veo-3',
    'veo-3.1': 'veo-3.1',
    'seedance': 'seedance',
    'seedance-2': 'seedance-2',
    'wan-i2v': 'wan-i2v',
    'wan-t2v': 'wan-t2v',
    'hailuo-02-pro': 'hailuo-02-pro',
  }
  return map[modelKey] || modelKey
}

export async function submitWeavyVideo(params: WeavyGenerateParams): Promise<WeavyGenerateResult> {
  const { token, model, prompt, imageUrl, aspectRatio = '9:16', duration = 5, negativePrompt, quality } = params

  const payload = {
    model: resolveModel(model),
    prompt: prompt.trim(),
    imageUrl: imageUrl || null,
    aspectRatio: resolveAspectRatio(aspectRatio),
    duration,
    negativePrompt: negativePrompt?.trim() || null,
    quality: quality || null,
  }

  try {
    const res = await fetch(WEAVY_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Weavy-Token': token,
      },
      body: JSON.stringify({ action: 'generate', payload }),
    })

    const data = await res.json().catch(() => null)

    if (!res.ok || !data?.ok) {
      const errMsg = data?.data?.message || data?.data?.error || data?.error || `HTTP ${res.status}`
      return { ok: false, error: errMsg, raw: data }
    }

    const batchId = data?.data?.batchId || data?.data?.id
    if (!batchId) {
      return { ok: false, error: 'No batchId in response', raw: data }
    }

    return { ok: true, taskId: batchId, raw: data }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function pollWeavyStatus(
  token: string,
  batchId: string,
  onProgress?: (status: string, pct: number) => void,
  timeoutMs = 3600000
): Promise<string> {
  const startTime = Date.now()

  let lastLog = ''

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5000))

    try {
      const res = await fetch(WEAVY_PROXY, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Weavy-Token': token,
        },
        body: JSON.stringify({ action: 'status', batchId }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.ok) {
        console.log(`[weavy] poll error:`, data?.error || `HTTP ${res.status}`)
        continue
      }

      const result = data?.data
      const status = (result?.status || result?.state || '').toLowerCase()
      const elapsedMin = (Date.now() - startTime) / (8 * 60000)
      const fallbackPct = Math.min(0.94, 1 - 1 / (1 + elapsedMin * 1.6))
      const pct = Math.round(5 + fallbackPct * 89)

      onProgress?.(status || 'processing', pct)

      const logEntry = `poll #${Math.round((Date.now() - startTime) / 1000)}s status=${status} pct=${pct}`
      if (logEntry !== lastLog) {
        lastLog = logEntry
        console.log(`[weavy] ${logEntry}`)
      }

      if (['completed', 'success', 'done', 'finished'].includes(status)) {
        const videoUrl = result?.output?.video_url || result?.output?.url || result?.video_url || result?.url ||
          result?.recipeRuns?.[0]?.nodeRuns?.[0]?.result?.[0]?.url ||
          result?.recipeRuns?.[0]?.nodeRuns?.[0]?.result?.[0]?.video_url

        if (videoUrl) return videoUrl

        console.log(`[weavy] task done but no url:`, JSON.stringify(result, null, 2).slice(0, 2000))
        throw new Error('Weavy: task completed but no video URL found')
      }

      if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
        const errMsg = result?.error || result?.message || result?.recipeRuns?.[0]?.nodeRuns?.[0]?.error || 'Generation failed'
        throw new Error(`Weavy failed: ${errMsg}`)
      }
    } catch (err: any) {
      if (/timeout|fetch|network/i.test(err.message)) {
        console.log(`[weavy] network error, retrying:`, err.message)
        continue
      }
      throw err
    }
  }

  throw new Error('Weavy timeout')
}

export function isWeavyTokenError(msg: string): boolean {
  return /token|auth|log\s*in|login|expired|unauth|401|403|invalid.*token|token.*invalid|insufficient|balance|credit|quota|no output URL|output tidak ditemukan/i.test(msg)
}
