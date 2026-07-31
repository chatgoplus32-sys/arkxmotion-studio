const MAGNIFIC_PROXY = '/api/public/magnific'

export type MagnificEngine = 'automatic' | 'magnific_illusio' | 'magnific_sharpy' | 'magnific_sparkle'
export type MagnificOptimizedFor =
  | 'standard'
  | 'soft_portraits'
  | 'hard_portraits'
  | 'art_n_illustration'
  | 'videogame_assets'
  | 'nature_n_landscapes'
  | 'films_n_photography'
  | '3d_renders'
  | 'science_fiction_n_horror'
export type MagnificFlavor = 'sublime' | 'photo' | 'photo_denoiser'

export interface MagnificUpscaleParams {
  imageBase64: string
  scaleFactor: '2x' | '4x' | '8x' | '16x'
  mode: 'creative' | 'precision'
  prompt?: string
  creativity?: number
  hdr?: number
  resemblance?: number
  fractality?: number
  engine?: MagnificEngine
  optimizedFor?: MagnificOptimizedFor
  filterNsfw?: boolean
  sharpen?: number
  smartGrain?: number
  ultraDetail?: number
  flavor?: MagnificFlavor
}

export interface MagnificSubmitResult {
  ok: boolean
  taskId?: string
  error?: string
  raw?: any
}

export async function submitMagnificUpscale(
  apiKey: string,
  params: MagnificUpscaleParams
): Promise<MagnificSubmitResult> {
  const {
    imageBase64,
    scaleFactor,
    mode,
    prompt,
    creativity,
    hdr,
    resemblance,
    fractality,
    engine,
    optimizedFor,
    filterNsfw,
    sharpen,
    smartGrain,
    ultraDetail,
    flavor,
  } = params

  const apiEndpoint = mode === 'creative'
    ? '/v1/ai/image-upscaler'
    : '/v1/ai/image-upscaler-precision-v2'

  const body: Record<string, any> = {
    image: imageBase64,
    scale_factor: scaleFactor,
  }

  if (mode === 'creative') {
    if (prompt) body.prompt = prompt
    if (creativity !== undefined) body.creativity = creativity
    if (hdr !== undefined) body.hdr = hdr
    if (resemblance !== undefined) body.resemblance = resemblance
    if (fractality !== undefined) body.fractality = fractality
    if (engine) body.engine = engine
    if (optimizedFor) body.optimized_for = optimizedFor
  } else {
    if (sharpen !== undefined) body.sharpen = sharpen
    if (smartGrain !== undefined) body.smart_grain = smartGrain
    if (ultraDetail !== undefined) body.ultra_detail = ultraDetail
    if (flavor) body.flavor = flavor
  }

  if (filterNsfw !== undefined) body.filter_nsfw = filterNsfw

  try {
    const res = await fetch(MAGNIFIC_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Magnific-Api-Key': apiKey,
      },
      body: JSON.stringify({ endpoint: apiEndpoint, body }),
    })

    const data = await res.json().catch(() => null)
    console.log(`[magnific] upscale → ${res.status}`, JSON.stringify(data).slice(0, 500))

    if (!data?.ok || !data?.data?.data?.task_id) {
      const errMsg = data?.data?.message || data?.data?.error || data?.error || `HTTP ${res.status}`
      return { ok: false, error: errMsg, raw: data }
    }

    return { ok: true, taskId: data.data.data.task_id, raw: data }
  } catch (err: any) {
    console.error(`[magnific] submit error:`, err.message)
    return { ok: false, error: err.message }
  }
}

export async function pollMagnificTask(
  apiKey: string,
  taskId: string,
  mode: 'creative' | 'precision',
  onProgress?: (status: string, pct: number) => void,
  timeoutMs = 3600000
): Promise<string> {
  const startTime = Date.now()
  const apiEndpoint = mode === 'creative'
    ? `/v1/ai/image-upscaler/${taskId}`
    : `/v1/ai/image-upscaler-precision-v2/${taskId}`

  let lastLog = ''

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5000))

    try {
      const res = await fetch(`${MAGNIFIC_PROXY}?endpoint=${encodeURIComponent(apiEndpoint)}`, {
        method: 'GET',
        headers: {
          'X-Magnific-Api-Key': apiKey,
        },
      })

      const data = await res.json().catch(() => null)

      if (!data?.ok || !data?.data?.data) {
        console.log(`[magnific] poll error:`, data?.error || data?.data?.message || `HTTP ${res.status}`)
        continue
      }

      const task = data.data.data
      const status = (task.status || '').toUpperCase()
      const elapsedSec = Math.round((Date.now() - startTime) / 1000)
      const elapsedMin = elapsedSec / 60
      const fallbackPct = Math.min(0.94, 1 - 1 / (1 + elapsedMin * 1.6))
      const pct = Math.round(5 + fallbackPct * 89)

      onProgress?.(status || 'IN_PROGRESS', status === 'COMPLETED' ? 95 : pct)

      const logEntry = `poll #${elapsedSec}s status=${status}`
      if (logEntry !== lastLog) {
        lastLog = logEntry
        console.log(`[magnific] ${logEntry}`)
      }

      if (status === 'COMPLETED') {
        const generated = task.generated || []
        const imageUrl = generated.find((url: string) => typeof url === 'string' && url.startsWith('http'))
        if (imageUrl) return imageUrl
        throw new Error('Magnific: task completed but no image URL found')
      }

      if (status === 'FAILED') {
        throw new Error('Magnific: upscaling task failed')
      }
    } catch (err: any) {
      if (/timeout|fetch|network/i.test(err.message)) {
        console.log(`[magnific] network error, retrying:`, err.message)
        continue
      }
      throw err
    }
  }

  throw new Error('Magnific: timeout')
}

export function isMagnificTokenError(msg: string): boolean {
  return /api.?key|unauthorized|forbidden|invalid.*key|key.*invalid|expired|401|403|auth/i.test(msg)
}
