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

export async function checkWeavyBalance(token: string): Promise<{ ok: boolean; balance?: number | null; error?: string }> {
  try {
    const res = await fetch(`${WEAVY_PROXY}?action=balance`, {
      method: 'GET',
      headers: { 'X-Weavy-Token': token },
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.ok) {
      const errMsg = data?.data?.message || data?.error || `HTTP ${res.status}`
      return { ok: false, balance: null, error: errMsg }
    }
    const credits = data?.data?.credits ?? data?.data?.balance ?? data?.data?.remaining ?? null
    return { ok: true, balance: typeof credits === 'number' ? credits : null }
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

  const payload: Record<string, any> = {
    model: resolveModel(model),
    prompt: prompt.trim(),
    aspect_ratio: resolveAspectRatio(aspectRatio),
    duration,
  }

  if (imageUrl) payload.image_url = imageUrl
  if (negativePrompt) payload.negative_prompt = negativePrompt.trim()
  if (quality) payload.quality = quality

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

    const taskId = data?.data?.task_id || data?.data?.id || data?.data?.taskId
    if (!taskId) {
      return { ok: false, error: 'No task_id in response', raw: data }
    }

    return { ok: true, taskId, raw: data }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function pollWeavyStatus(
  token: string,
  taskId: string,
  onProgress?: (status: string, pct: number) => void,
  timeoutMs = 3600000
): Promise<string> {
  const startTime = Date.now()

  function resolveUrls(obj: any, depth = 0): string[] {
    if (depth > 8 || !obj || typeof obj !== 'object') return []
    if (typeof obj === 'string') {
      if (/^https?:\/\//i.test(obj)) return [obj]
      return []
    }
    const urls: string[] = []
    const urlKeys = 'url,video_url,videoUrl,output_url,outputUrl,download_url,downloadUrl,media_url,mediaUrl,src,href,signed_url,signedUrl,play_url,playUrl'
    for (const key of urlKeys.split(',')) {
      const val = obj[key]
      if (typeof val === 'string' && /^https?:\/\//i.test(val)) urls.push(val)
    }
    for (const val of Object.values(obj)) {
      urls.push(...resolveUrls(val, depth + 1))
    }
    return [...new Set(urls)]
  }

  function extractProgress(obj: any, depth = 0): number | null {
    if (depth > 6 || !obj || typeof obj !== 'object') return null
    const keys = ['progress', 'percent', 'rate', 'schedule', 'process']
    for (const [k, v] of Object.entries(obj)) {
      const kl = k.toLowerCase()
      if (keys.some((pk) => kl.includes(pk))) {
        const num = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN
        if (Number.isFinite(num)) {
          const pct = num <= 1 ? num * 100 : num
          if (pct >= 0 && pct <= 100) return pct
        }
      }
    }
    for (const val of Object.values(obj)) {
      const p = extractProgress(val, depth + 1)
      if (p !== null) return p
    }
    return null
  }

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
        body: JSON.stringify({ action: 'status', taskId }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.ok) {
        console.log(`[weavy] poll error:`, data?.error || `HTTP ${res.status}`)
        continue
      }

      const result = data?.data
      const status = (result?.status || '').toLowerCase()
      const realPct = extractProgress(result)
      const elapsedMin = (Date.now() - startTime) / (8 * 60000)
      const fallbackPct = Math.min(0.94, 1 - 1 / (1 + elapsedMin * 1.6))
      const pct = realPct === null ? Math.round(5 + fallbackPct * 89) : Math.round(realPct)

      onProgress?.(status || 'processing', pct)

      const logEntry = `poll #${Math.round((Date.now() - startTime) / 1000)}s status=${status} pct=${pct}`
      if (logEntry !== lastLog) {
        lastLog = logEntry
        console.log(`[weavy] ${logEntry}`)
      }

      if (['completed', 'success', 'done', 'finished'].includes(status)) {
        const allUrls = resolveUrls(result)
        const videoUrl = allUrls.find((u) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u)) ||
          allUrls.find((u) => /video|mp4|mov|webm|m4v|vod/i.test(u)) ||
          allUrls[0]

        if (videoUrl) return videoUrl

        console.log(`[weavy] task done but no url. keys:`, Object.keys(result || {}))
        console.log(`[weavy] result:`, JSON.stringify(result, null, 2).slice(0, 2000))
        throw new Error('Weavy: task completed but no video URL found')
      }

      if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
        const errMsg = result?.error || result?.message || result?.error_message || 'Generation failed'
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
