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
    const res = await fetch(`${WEAVY_PROXY}?action=balance`, {
      method: 'GET',
      headers: { 'X-Weavy-Token': token },
    })
    const data = await res.json().catch(() => null)

    if (data?.ok) {
      const credits = data?.data?.credits ?? null
      const email = data?.data?.email ?? undefined
      return { ok: true, balance: typeof credits === 'number' ? credits : null, email }
    }

    const errMsg = data?.data?.message || data?.error || `HTTP ${res.status}`
    return { ok: false, balance: null, error: errMsg }
  } catch (err: any) {
    return { ok: true, balance: null, error: err.message }
  }
}

export async function checkWeavyBalanceDirect(token: string): Promise<{ ok: boolean; balance?: number | null; email?: string; error?: string }> {
  try {
    const isJwt = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
    if (!isJwt) return { ok: false, balance: null, error: 'Not a JWT token' }

    let email: string | undefined
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      email = payload.email || payload.user_id || undefined
    } catch {}

    const endpoints = [
      'https://api.weavy.ai/api/v1/credits',
      'https://api.weavy.ai/api/v1/user/credits',
      'https://api.weavy.ai/api/v1/user/balance',
      'https://api.weavy.ai/api/v1/user',
      'https://api.weavy.ai/api/v1/account',
      'https://api.weavy.ai/api/v1/subscription',
      'https://api.weavy.ai/api/v1/workspaces',
    ]

    for (const url of endpoints) {
      try {
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(8000),
        })
        if (!r.ok) continue
        const data = await r.json().catch(() => null)
        let credits = data?.credits ?? data?.balance ?? data?.totalCredits ?? data?.creditsRemaining ?? data?.quota ?? data?.usage?.credits ?? data?.plan?.credits ?? data?.data?.credits ?? data?.user?.credits ?? null
        if (credits === null) {
          const workspaces = data?.workspaces || data
          const ws = Array.isArray(workspaces) ? workspaces[0] : workspaces
          if (typeof ws?.credits === 'number') credits = ws.credits
        }
        if (typeof credits === 'number') return { ok: true, balance: credits, email }
      } catch { continue }
    }
    return { ok: false, balance: null, error: 'No credits endpoint responded', email }
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
