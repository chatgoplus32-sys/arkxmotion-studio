const GALLERI5_PROXY = '/api/public/galleri5'

export interface Galleri5MotionControlOptions {
  firebaseToken: string
  orgId?: string
  imageUrl: string
  videoUrl: string
  keepOriginalSound?: boolean
  orientation?: 'image' | 'video'
  safetyTolerance?: number
  onProgress?: (msg: string, pct?: number) => void
}

async function galleri5Api(action: string, params: Record<string, any>): Promise<any> {
  const res = await fetch(GALLERI5_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Error(data?.error || `Galleri5 ${res.status}`)
  return data
}

function getStoredGalleri5Credentials(): { firebaseToken: string; orgId?: string } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('arkxmotion.providers')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const keys = parsed['galleri5'] || []
    const active = keys.find((k: any) => k.status === 'active' || k.status === 'unknown')
    if (!active?.key) return null
    const creds = JSON.parse(active.key)
    if (creds.firebaseToken) return creds
    return null
  } catch { return null }
}

export function getGalleri5Credentials(): { firebaseToken: string; orgId?: string } | null {
  return getStoredGalleri5Credentials()
}

export async function submitGalleri5MotionControl(opts: Galleri5MotionControlOptions): Promise<string> {
  const firebaseToken = opts.firebaseToken
  if (!firebaseToken) {
    throw Error('Galleri5: Firebase token belum diatur. Dapatkan dari G5 AI Studio → Providers → G5 AI Studio.')
  }

  opts.onProgress?.('Submit ke G5 AI Studio...')

  const res = await galleri5Api('submit', {
    firebaseToken,
    orgId: opts.orgId,
    payload: {
      model_path: 'fal-ai/kling-video-v2.6-standard-motion-control',
      form_fields: {
        keep_original_sound: opts.keepOriginalSound ?? true,
        image_url: opts.imageUrl,
        video_url: opts.videoUrl,
        character_orientation: opts.orientation || 'video',
        safety_tolerance: opts.safetyTolerance ?? 5,
      },
      error_config: {
        strategy: 'retry_same',
        context: 'interactive',
        max_retries: 3,
      },
    },
  })

  const data = res.data ?? res

  if (data.success === false) {
    throw Error('Galleri5: submit gagal — ' + (data.message || 'unknown'))
  }

  const taskId = data.prediction_id || data.jobrouter_job_id || data.task_id || data.id
  if (!taskId) throw Error('Galleri5: prediction_id tidak ditemukan — ' + JSON.stringify(data).slice(0, 200))

  return taskId
}

export async function pollGalleri5MotionControl(
  firebaseToken: string,
  orgId: string | undefined,
  taskId: string,
  onProgress?: (msg: string, pct?: number) => void
): Promise<string> {
  const startTime = Date.now()
  const MAX_WAIT = 10 * 60 * 1000

  for (; Date.now() - startTime < MAX_WAIT;) {
    await new Promise(r => setTimeout(r, 5000))

    const res = await galleri5Api('status', { firebaseToken, orgId, taskId })
    const data = res.data ?? res
    const status = String(data.status || '').toUpperCase()

    const elapsed = Math.round((Date.now() - startTime) / 1000)
    onProgress?.(`G5: ${status || 'checking'}... (${elapsed}s)`, status === 'COMPLETED' ? 95 : Math.min(90, 30 + elapsed))

    if (['COMPLETED', 'SUCCESS', 'SUCCEEDED', 'DONE', 'FINISHED'].includes(status)) {
      const videoUrl = data.output_url || data.result_url || data.video_url || data.result?.url || data.result_urls?.[0]
      if (videoUrl) {
        onProgress?.('Selesai', 100)
        return videoUrl
      }
      throw Error('Galleri5: status COMPLETED tapi URL tidak ditemukan')
    }

    if (['FAILED', 'ERROR', 'CANCELED', 'CANCELLED'].includes(status)) {
      throw Error('Galleri5: task gagal — ' + (data.error || data.message || 'unknown'))
    }
  }

  throw Error('Galleri5: timeout menunggu hasil')
}

export function isGalleri5TokenError(msg: string): boolean {
  return /unauthorized|forbidden|invalid.*token|expired|401|403|auth/i.test(msg)
}
