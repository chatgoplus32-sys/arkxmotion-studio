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

function getStoredMagnificKey(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('aatools.magnific.keys')
    return raw && JSON.parse(raw)?.[0]?.key || null
  } catch { return null }
}

function getStoredProviderKey(provider: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('arkxmotion.providers')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const keys = parsed[provider] || []
    const active = keys.find((k: any) => k.status === 'active' || k.status === 'unknown')
    return active?.key || keys[0]?.key || null
  } catch { return null }
}

export function getMagnificApiKey(): string | null {
  return getStoredMagnificKey() || getStoredProviderKey('magnific')
}

async function compressImage(file: File, maxDim = 2048, quality = 0.9): Promise<File> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let w = img.width
        let h = img.height
        if (w > maxDim) { h = h * maxDim / w; w = maxDim }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        canvas.toBlob(
          (blob) => resolve(blob ? new File([blob], file.name, { type: 'image/jpeg' }) : file),
          'image/jpeg',
          quality
        )
      }
      img.onerror = () => resolve(file)
      img.src = String(reader.result || '')
    }
    reader.readAsDataURL(file)
  })
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await (file.size > 6 * 1024 * 1024 ? await compressImage(file, 2048, 0.9) : file).arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 32768
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function magnificApi(action: string, params: Record<string, any>): Promise<any> {
  const res = await fetch(MAGNIFIC_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Error(data?.error || `Magnific ${res.status}`)
  return data
}

export interface MagnificSettings {
  scale_factor: string
  engine: MagnificEngine
  optimized_for: MagnificOptimizedFor
  creativity: number
  hdr: number
  resemblance: number
  fractality: number
  prompt?: string
}

export async function runMagnificUpscale(
  file: File,
  mode: 'upscale' | 'enhance',
  settings: MagnificSettings,
  onLog?: (msg: string) => void
): Promise<string> {
  const apiKey = getMagnificApiKey()
  if (!apiKey) throw Error('Belum ada Magnific API key di Kelola Token')

  const modelKey = mode === 'enhance' ? 'mag:image-upscaler-precision-v2' : 'mag:image-upscaler-creative'

  onLog?.('Encode base64...')
  const payload: Record<string, any> = {
    image: await fileToBase64(file),
    scale_factor: settings.scale_factor,
    optimized_for: settings.optimized_for,
    engine: settings.engine,
    creativity: settings.creativity,
    hdr: settings.hdr,
    resemblance: settings.resemblance,
    fractality: settings.fractality,
  }
  if (settings.prompt) payload.prompt = settings.prompt

  onLog?.(`Submit ke Magnific (${mode})...`)
  const submitRes = await magnificApi('submit', { apiKey, modelKey, payload })
  const taskData = submitRes.data ?? submitRes
  const taskId = taskData.task_id || taskData.id || taskData.taskId
  if (!taskId) throw Error('Magnific: task id tidak ditemukan')

  const startTime = Date.now()
  for (; Date.now() - startTime < 900000;) {
    await new Promise(r => setTimeout(r, 5000))
    const statusRes = await magnificApi('status', { apiKey, modelKey, taskId })
    const statusData = statusRes.data ?? statusRes
    const status = String(statusData.status || statusData.state || '').toUpperCase()

    onLog?.(`Poll: ${status || 'unknown'}`)

    if (['COMPLETED', 'SUCCESS', 'SUCCEEDED', 'DONE', 'FINISHED'].includes(status)) {
      const generated = statusData.generated
      if (Array.isArray(generated) && generated.length > 0 && typeof generated[0] === 'string') {
        return generated[0]
      }
      const url = statusData.image_url || statusData.output_url || statusData.result?.url
      if (url) return url
      throw Error('Magnific: URL hasil tidak ditemukan')
    }

    if (['FAILED', 'ERROR', 'CANCELED', 'CANCELLED'].includes(status)) {
      throw Error('Magnific: task gagal — ' + (statusData.error || statusData.message || 'unknown'))
    }
  }

  throw Error('Magnific: timeout menunggu hasil')
}

export function isMagnificTokenError(msg: string): boolean {
  return /api.?key|unauthorized|forbidden|invalid.*key|key.*invalid|expired|401|403|auth/i.test(msg)
}

export type MagnificMotionModel = 'kling-v3-motion-control-pro' | 'kling-v3-motion-control-std' | 'kling-v2-6-motion-control-pro' | 'kling-v2-6-motion-control-std'

const MAGNIFIC_MOTION_ENDPOINTS: Record<MagnificMotionModel, string> = {
  'kling-v3-motion-control-pro': '/v1/ai/video/kling-v3-motion-control-pro',
  'kling-v3-motion-control-std': '/v1/ai/video/kling-v3-motion-control-std',
  'kling-v2-6-motion-control-pro': '/v1/ai/video/kling-v2-6-motion-control-pro',
  'kling-v2-6-motion-control-std': '/v1/ai/video/kling-v2-6-motion-control-std',
}

const MAGNIFIC_MOTION_POLL_ENDPOINTS: Record<MagnificMotionModel, string> = {
  'kling-v3-motion-control-pro': '/v1/ai/video/kling-v3-motion-control-pro',
  'kling-v3-motion-control-std': '/v1/ai/video/kling-v3-motion-control-std',
  'kling-v2-6-motion-control-pro': '/v1/ai/video/kling-v2-6-motion-control-pro',
  'kling-v2-6-motion-control-std': '/v1/ai/video/kling-v2-6-motion-control-std',
}

export interface MagnificMotionOptions {
  apiKey: string
  model: MagnificMotionModel
  imageUrl: string
  videoUrl: string
  prompt?: string
  orientation?: 'video' | 'image'
  cfgScale?: number
  onProgress?: (msg: string, pct?: number) => void
}

export async function submitMagnificMotion(opts: MagnificMotionOptions): Promise<string> {
  const endpoint = MAGNIFIC_MOTION_ENDPOINTS[opts.model]
  if (!endpoint) throw Error(`Magnific: model tidak dikenal (${opts.model})`)

  opts.onProgress?.('Submit ke Magnific...', 10)
  const res = await magnificApi('submit-motion', {
    apiKey: opts.apiKey,
    endpoint,
    payload: {
      image_url: opts.imageUrl,
      video_url: opts.videoUrl,
      ...(opts.prompt ? { prompt: opts.prompt } : {}),
      character_orientation: opts.orientation || 'video',
      cfg_scale: opts.cfgScale ?? 0.5,
    },
  })

  const taskData = res.data ?? res
  const taskId = taskData.id || taskData.task_id || taskData.taskId
  if (!taskId) throw Error('Magnific: task id tidak ditemukan — ' + JSON.stringify(taskData).slice(0, 200))

  return taskId
}

export async function pollMagnificMotion(
  apiKey: string,
  model: MagnificMotionModel,
  taskId: string,
  onProgress?: (msg: string, pct?: number) => void
): Promise<string> {
  const endpoint = MAGNIFIC_MOTION_POLL_ENDPOINTS[model]
  if (!endpoint) throw Error(`Magnific: model tidak dikenal (${model})`)

  const startTime = Date.now()
  const MAX_WAIT = 10 * 60 * 1000

  for (; Date.now() - startTime < MAX_WAIT;) {
    await new Promise(r => setTimeout(r, 5000))

    const res = await magnificApi('poll-motion', { apiKey, endpoint, taskId })
    const data = res.data ?? res
    const status = String(data.status || data.state || '').toUpperCase()

    const elapsed = Math.round((Date.now() - startTime) / 1000)
    onProgress?.(`Magnific: ${status || 'checking'}... (${elapsed}s)`, status === 'COMPLETED' ? 95 : Math.min(90, 30 + elapsed))

    if (['COMPLETED', 'SUCCESS', 'SUCCEEDED', 'DONE', 'FINISHED'].includes(status)) {
      const videoUrl = data.video_url || data.output_url || data.result?.url || data.output?.video_url
      if (videoUrl) {
        onProgress?.('Selesai', 100)
        return videoUrl
      }
      const generated = data.generated
      if (Array.isArray(generated) && generated.length > 0) return generated[0]
      throw Error('Magnific: status COMPLETED tapi URL tidak ditemukan')
    }

    if (['FAILED', 'ERROR', 'CANCELED', 'CANCELLED'].includes(status)) {
      throw Error('Magnific: task gagal — ' + (data.error || data.message || 'unknown'))
    }
  }

  throw Error('Magnific: timeout menunggu hasil')
}
