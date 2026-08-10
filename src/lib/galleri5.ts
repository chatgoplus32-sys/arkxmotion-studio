const GALLERI5_PROXY = '/api/public/galleri5'
const FIREBASE_API_KEY = 'AIzaSyBejuWIKZ7yQT9bdG_jnb4RrkW3DoFCNNo'
const FIREBASE_TOKEN_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`

// ─── Types ──────────────────────────────────────────────────────────

export interface Galleri5MotionModel {
  key: string
  modelPath: string
  label: string
  sessionName: string
  cr: number
}

export const GALLERI5_MOTION_MODELS: Galleri5MotionModel[] = [
  {
    key: 'g5:kling-v3-std-motion-control',
    modelPath: 'fal-ai/kling-video-v3-standard-motion-control',
    label: 'Kling V3.0 Standard (Galery5)',
    sessionName: 'Kling Video v3 Motion Control [Standard]',
    cr: 100,
  },
  {
    key: 'g5:kling-v2.6-pro-motion-control',
    modelPath: 'fal-ai/kling-video-v2.6-pro-motion-control',
    label: 'Kling V2.6 Pro (Galery5)',
    sessionName: 'Kling Video v2.6 Motion Control [Pro]',
    cr: 120,
  },
  {
    key: 'g5:kling-v2.6-std-motion-control',
    modelPath: 'fal-ai/kling-video-v2.6-standard-motion-control',
    label: 'Kling V2.6 Standard (Galery5)',
    sessionName: 'Kling Video v2.6 Motion Control [Standard]',
    cr: 60,
  },
]

export interface Galleri5MotionControlOptions {
  authHeaders: Record<string, string>
  modelKey: string
  imageUrl: string
  videoUrl: string
  keepOriginalSound?: boolean
  orientation?: 'image' | 'video'
  prompt?: string
  onProgress?: (msg: string, pct?: number) => void
}

// ─── Token Helpers ──────────────────────────────────────────────────

const tokenCache = new Map<string, { accessToken: string; expiry: number }>()

function isJwtToken(s: string): boolean {
  return /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(s.trim())
}

function isRefreshToken(s: string): boolean {
  const t = s.trim()
  return !t.includes('.') && /^[\w-]{60,}$/.test(t)
}

async function refreshFirebaseToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
} | null> {
  try {
    const res = await fetch(FIREBASE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    })
    if (!res.ok) return null
    const data = await res.json()
    return {
      accessToken: data.id_token || data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: Number(data.expires_in) || 3600,
    }
  } catch {
    return null
  }
}

function parseJwtPayload(token: string): Record<string, any> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(decodeURIComponent(escape(decoded)))
  } catch {
    try {
      const payload = token.split('.')[1]
      return JSON.parse(atob(payload))
    } catch {
      return null
    }
  }
}

async function resolveAccessToken(key: string): Promise<string> {
  const trimmed = key.trim()
  if (!trimmed) throw Error('Galery5: token kosong')

  // Already a JWT ID token — use directly
  if (isJwtToken(trimmed)) {
    const payload = parseJwtPayload(trimmed)
    const exp = payload?.exp ? payload.exp * 1000 : undefined
    if (exp && Date.now() > exp) throw Error('Galery5: ID token expired — ambil baru')
    return trimmed
  }

  // Not a refresh token either — error
  if (!isRefreshToken(trimmed)) throw Error('Galery5: format token tidak dikenal')

  // Check cache
  const now = Date.now()
  const cached = tokenCache.get(trimmed)
  if (cached && now < cached.expiry - 60000) return cached.accessToken

  // Refresh the token
  const result = await refreshFirebaseToken(trimmed)
  if (!result) throw Error('Galery5: refresh token tidak valid / kedaluwarsa (login ulang di aistudio.galleri5.com)')

  const expiry = now + result.expiresIn * 1000
  tokenCache.set(trimmed, { accessToken: result.accessToken, expiry })

  // Update stored key if refresh token rotated
  if (result.refreshToken !== trimmed) {
    updateStoredRefreshToken(trimmed, result.refreshToken, result.accessToken, expiry)
  }

  return result.accessToken
}

function updateStoredRefreshToken(oldToken: string, newToken: string, accessToken: string, accessExpiry: number) {
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem('arkxmotion.providers')
    if (!raw) return
    const parsed = JSON.parse(raw)
    const keys = parsed['galleri5'] || []
    const idx = keys.findIndex((k: any) => k.key === oldToken)
    if (idx < 0) return
    keys[idx] = { ...keys[idx], key: newToken, accessToken, accessExpiry }
    localStorage.setItem('arkxmotion.providers', JSON.stringify(parsed))
    tokenCache.set(newToken, { accessToken, expiry: accessExpiry })
    window.dispatchEvent(new Event('aatools:keys-changed'))
  } catch {}
}

// ─── Stored Keys ────────────────────────────────────────────────────

interface StoredGalleri5Key {
  key: string
  status?: string
  balance?: number | null
  email?: string
  plan?: string
  accessToken?: string
  accessExpiry?: number
}

function getStoredKeys(): StoredGalleri5Key[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem('arkxmotion.providers')
    if (!raw) return []
    const parsed = JSON.parse(raw)
    const keys = parsed['galleri5'] || []
    return Array.isArray(keys) ? keys.filter((k: any) => !!k?.key) : []
  } catch {
    return []
  }
}

function getAllStoredKeys(): string[] {
  return getStoredKeys().map((k) => k.key).filter(Boolean)
}

// ─── API Helpers ────────────────────────────────────────────────────

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

function resolveModel(modelKey: string): Galleri5MotionModel {
  return (
    GALLERI5_MOTION_MODELS.find((m) => m.key === modelKey) ||
    GALLERI5_MOTION_MODELS.find((m) => m.modelPath === modelKey) ||
    GALLERI5_MOTION_MODELS[GALLERI5_MOTION_MODELS.length - 1]
  )
}

function generateSessionId(): string {
  const arr = new Uint8Array(32)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr)
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256)
  }
  let b64 = ''
  for (const byte of arr) b64 += String.fromCharCode(byte)
  return btoa(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ─── Public: Get Auth Headers ───────────────────────────────────────

export async function getGalleri5AuthHeaders(): Promise<Record<string, string> | null> {
  const keys = getStoredKeys()
  const active = keys.find((k) => k.status === 'active' || k.status === 'unknown')
  if (!active?.key) return null

  try {
    const accessToken = await resolveAccessToken(active.key)
    return {
      Accept: '*/*',
      Authorization: `Bearer ${accessToken}`,
    }
  } catch {
    return null
  }
}

// Synchronous version — returns cached headers or null
export function getGalleri5Headers(): Record<string, string> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('arkxmotion.providers')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const keys = parsed['galleri5'] || []
    const active = keys.find((k: any) => k.status === 'active' || k.status === 'unknown')
    if (!active?.key) return null

    // Try parsed JSON auth headers first
    try {
      const headers = JSON.parse(active.key)
      if (typeof headers === 'object' && headers !== null) return headers
    } catch {}

    // If it's a refresh token, check for cached access token
    if (isRefreshToken(active.key) && active.accessToken && active.accessExpiry) {
      if (Date.now() < active.accessExpiry - 60000) {
        return {
          Accept: '*/*',
          Authorization: `Bearer ${active.accessToken}`,
        }
      }
    }

    // If it's a JWT, use directly
    if (isJwtToken(active.key)) {
      const payload = parseJwtPayload(active.key)
      const exp = payload?.exp ? payload.exp * 1000 : undefined
      if (!exp || Date.now() < exp) {
        return {
          Accept: '*/*',
          Authorization: `Bearer ${active.key}`,
        }
      }
    }

    return null
  } catch {
    return null
  }
}

// ─── Public: Check Balance ──────────────────────────────────────────

export async function checkGalleri5Balance(
  authHeaders: Record<string, string>
): Promise<{ ok: boolean; balance: number | null; email?: string; plan?: string; error?: string }> {
  try {
    const res = await galleri5Api('info', { authHeaders })
    const data = res.data ?? res
    return {
      ok: true,
      balance: typeof data.available_credits === 'number' ? data.available_credits : null,
      email: data.email,
      plan: data.plan_name,
    }
  } catch (err: any) {
    return { ok: false, balance: null, error: err.message }
  }
}

// ─── Public: Session Workflow ───────────────────────────────────────

export async function createGalleri5Session(
  authHeaders: Record<string, string>,
  modelPath: string,
  orgId: string | null,
  sessionId: string,
  sessionName: string
): Promise<void> {
  await galleri5Api('session-create', {
    authHeaders,
    orgId,
    sessionId,
    payload: {
      unit_type: 'model_garden',
      session_type: 'generation',
      name: sessionName,
      state: { model_path: modelPath },
      session_id: sessionId,
      ...(orgId ? { organization_id: orgId } : {}),
    },
  })
}

export async function linkGalleri5Uploads(
  authHeaders: Record<string, string>,
  uploadIds: (string | null)[],
  sessionId: string,
  orgId: string | null
): Promise<void> {
  const filtered = uploadIds.filter(Boolean)
  if (filtered.length === 0) return
  await galleri5Api('session-link', {
    authHeaders,
    orgId,
    uploadIds: filtered,
    sessionId,
  })
}

export async function estimateGalleri5Credits(
  authHeaders: Record<string, string>,
  modelPath: string,
  formFields: Record<string, any>,
  orgId: string | null
): Promise<number | null> {
  try {
    const res = await galleri5Api('estimate', {
      authHeaders,
      orgId,
      modelPath,
      formFields,
    })
    const data = res.data ?? res
    return typeof data?.credits === 'number' ? data.credits : null
  } catch {
    return null
  }
}

// ─── Public: Submit Motion Control ──────────────────────────────────

export async function submitGalleri5MotionControl(
  opts: Galleri5MotionControlOptions
): Promise<string> {
  const authHeaders = opts.authHeaders
  if (!authHeaders || Object.keys(authHeaders).length === 0) {
    throw Error(
      'Galleri5: auth headers belum diatur. Jalankan Chrome Extension di G5 AI Studio, lalu paste headers ke Providers.'
    )
  }

  const model = resolveModel(opts.modelKey)
  const onProgress = opts.onProgress

  onProgress?.('cek akun...')

  const infoRes = await galleri5Api('info', { authHeaders })
  const infoData = infoRes.data ?? infoRes
  const orgId = infoData.organization_id || infoData.primary_organization_id || null
  const balance = typeof infoData.available_credits === 'number' ? infoData.available_credits : null

  if (balance !== null && balance < model.cr) {
    throw Error(
      `Galery5 credit tidak cukup: sisa ${balance}, butuh ±${model.cr} untuk ${model.label}.`
    )
  }

  const sessionId = generateSessionId()

  onProgress?.('upload image...')
  const imgUpload = await galleri5Api('upload', {
    authHeaders,
    orgId,
    fileUrl: opts.imageUrl,
    fileName: `ref_img_${Date.now()}.jpg`,
    contentType: 'image/jpeg',
  })
  const imgData = imgUpload.data ?? imgUpload
  const imgFileUrl = imgData.file_url || imgData.url
  const imgUploadId = imgData.upload_id ?? null

  onProgress?.('upload video...')
  const vidUpload = await galleri5Api('upload', {
    authHeaders,
    orgId,
    fileUrl: opts.videoUrl,
    fileName: `ref_vid_${Date.now()}.mp4`,
    contentType: 'video/mp4',
  })
  const vidData = vidUpload.data ?? vidUpload
  const vidFileUrl = vidData.file_url || vidData.url
  const vidUploadId = vidData.upload_id ?? null

  onProgress?.('create session...')
  await createGalleri5Session(authHeaders, model.modelPath, orgId, sessionId, model.sessionName).catch(
    () => {}
  )

  onProgress?.('link session...')
  await linkGalleri5Uploads(authHeaders, [imgUploadId, vidUploadId], sessionId, orgId).catch(() => {})

  const formFields: Record<string, any> = {
    keep_original_sound: !!opts.keepSound,
    image_url: imgFileUrl,
    video_url: vidFileUrl,
    character_orientation: opts.orientation || 'video',
    has_video_input: true,
    input_duration: 0,
  }
  if (opts.prompt && opts.prompt.trim()) {
    formFields.prompt = opts.prompt.trim()
  }

  const estCredits = await estimateGalleri5Credits(authHeaders, model.modelPath, formFields, orgId)
  if (estCredits !== null) {
    onProgress?.(`estimasi ${estCredits} credit`)
  }

  onProgress?.('processing')

  const submitRes = await galleri5Api('submit', {
    authHeaders,
    orgId,
    payload: {
      model_path: model.modelPath,
      form_fields: formFields,
      session_id: sessionId,
      error_config: {
        strategy: 'retry_same',
        context: 'interactive',
        max_retries: 3,
      },
    },
  })

  const submitData = submitRes.data ?? submitRes

  if (submitData.success === false) {
    throw Error('Galleri5: submit gagal — ' + (submitData.message || 'unknown'))
  }

  const taskId =
    submitData.prediction_id ||
    submitData.jobrouter_job_id ||
    submitData.task_id ||
    submitData.id
  if (!taskId) {
    throw Error(
      'Galleri5: prediction_id tidak ditemukan — ' + JSON.stringify(submitData).slice(0, 200)
    )
  }

  return taskId
}

// ─── Public: Poll Result ────────────────────────────────────────────

export async function pollGalleri5MotionControl(
  authHeaders: Record<string, string>,
  taskId: string,
  onProgress?: (msg: string, pct?: number) => void
): Promise<string> {
  const startTime = Date.now()
  const MAX_WAIT = 15 * 60 * 1000

  for (; Date.now() - startTime < MAX_WAIT; ) {
    await new Promise((r) => setTimeout(r, 5000))

    const res = await galleri5Api('status', { authHeaders, taskId })
    const data = res.data ?? res
    const status = String(data.status || '').toLowerCase()

    const elapsed = Math.round((Date.now() - startTime) / 1000)
    const isSuccess = /^(succeeded|success|completed|complete|done|finished)$/i.test(status)
    const isFailed = /^(failed|error|cancelled|canceled|rejected)$/i.test(status)

    onProgress?.(
      `G5: ${status || 'checking'}... (${elapsed}s)`,
      isSuccess ? 95 : Math.min(90, 30 + elapsed)
    )

    const videoUrl =
      data.result_url ||
      data.asset_url ||
      data.output_url ||
      data.video_url ||
      data.result?.url ||
      (Array.isArray(data.result_urls) ? data.result_urls[0] : null) ||
      (Array.isArray(data.s3_urls) ? data.s3_urls[0] : null)

    if (videoUrl) {
      onProgress?.('Selesai', 100)
      return videoUrl
    }

    if (isFailed) {
      throw Error('Galleri5: task gagal — ' + (data.error || data.message || 'unknown'))
    }

    if (isSuccess && Date.now() - startTime > 60000) {
      throw Error(
        'Galleri5: job selesai tapi URL hasil tidak ditemukan' +
          (data.error ? ` (${data.error})` : '')
      )
    }
  }

  throw Error('Galleri5: timeout menunggu hasil (15 menit)')
}

// ─── Public: Error Detection ────────────────────────────────────────

export function isGalleri5TokenError(msg: string): boolean {
  const t = (msg || '').toLowerCase()
  return /credit|insufficient|not enough|out of|balance|quota|exhaust|limit|too many|rate.?limit|401|402|403|unauthor|forbidden|expired|invalid.*token|token.*invalid|5\d\d|server error|internal|network|fetch|timeout|timed out|failed|gagal/.test(
    t
  )
}
