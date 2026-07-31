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
