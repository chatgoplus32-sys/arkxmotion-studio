const GALLERI5_PROXY = '/api/public/galleri5'
const GALLERI5_BASE = 'https://aistudio-backend.calmdesert-ca599847.centralindia.azurecontainerapps.io/api/v1'
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
    key: 'g5:kling-v3-pro-motion-control',
    modelPath: 'fal-ai/kling-video-v3-pro-motion-control',
    label: 'Kling V3.0 Pro (Galery5)',
    sessionName: 'Kling Video v3 Motion Control [Pro]',
    cr: 200,
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
  {
    key: 'g5:wan-motion',
    modelPath: 'fal-ai/wan-motion',
    label: 'Wan Motion (Galery5)',
    sessionName: 'Wan Motion',
    cr: 30,
  },
]

export interface Galleri5MotionControlOptions {
  authHeaders: Record<string, string>
  modelKey: string
  imageUrl: string
  videoUrl: string
  imageFile?: File | Blob
  videoFile?: File | Blob
  keepOriginalSound?: boolean
  adaptMotion?: boolean
  safetyChecker?: boolean
  enhanceIdentity?: boolean
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

function getValidKeysWithBalance(minCredits: number): StoredGalleri5Key[] {
  const keys = getStoredKeys()
  return keys.filter((k) => {
    if (k.status === 'invalid' || k.status === 'expired') return false
    if (k.balance !== null && k.balance !== undefined && k.balance < minCredits) return false
    return true
  })
}

function getValidKeyStringsWithBalance(minCredits: number): string[] {
  return getValidKeysWithBalance(minCredits).map((k) => k.key).filter(Boolean)
}

// ─── API Helpers ────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchWithRetry(
  url: string,
  opts: RequestInit,
  retries = 2,
  delayMs = 1500
): Promise<Response> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, opts)
      return res
    } catch (err: any) {
      lastErr = err
      const msg = (err.message || '').toLowerCase()
      const isRetryable =
        err.name === 'TypeError' || // fetch failed
        err.name === 'AbortError' ||
        msg.includes('fetch failed') ||
        msg.includes('network') ||
        msg.includes('econnreset') ||
        msg.includes('econnrefused') ||
        msg.includes('etimedout') ||
        msg.includes('socket hang up') ||
        msg.includes('enotfound') ||
        msg.includes('timeout')
      if (isRetryable && attempt < retries) {
        console.log(`[galleri5] fetch retry ${attempt + 1}/${retries} after ${delayMs}ms: ${err.message}`)
        await sleep(delayMs * (attempt + 1))
        continue
      }
      throw err
    }
  }
  throw lastErr ?? new Error('fetch gagal')
}

async function galleri5Api(action: string, params: Record<string, any>): Promise<any> {
  const res = await fetchWithRetry(GALLERI5_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  }, 2, 1500)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Error(data?.error || `Galleri5 ${res.status}`)
  return data
}

// ─── Direct G5 Backend API (client → G5, no proxy) ─────────────────

async function g5DirectHeaders(accessToken: string, orgId?: string | null): Promise<Record<string, string>> {
  const h: Record<string, string> = { Accept: '*/*', Authorization: `Bearer ${accessToken}` }
  if (orgId) h['x-organization-id'] = orgId
  return h
}

async function g5DirectFetch(accessToken: string, path: string, opts: { method?: string; body?: any; orgId?: string | null } = {}): Promise<any> {
  const { method = 'GET', body, orgId } = opts
  const headers = await g5DirectHeaders(accessToken, orgId)
  if (method !== 'GET') headers['Content-Type'] = 'application/json'
  const res = await fetch(`${GALLERI5_BASE}${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  const text = await res.text()
  let data: any = null
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) {
    const detail = (typeof data === 'object' && data !== null) ? (data.detail || data.message || '') : String(data).slice(0, 200)
    throw Error(`G5 HTTP ${res.status}: ${detail || 'request gagal'}`)
  }
  return data
}

async function g5UploadFile(accessToken: string, file: File | Blob, fileName?: string, orgId?: string | null): Promise<{ fileUrl: string; uploadId: string | null }> {
  const headers = await g5DirectHeaders(accessToken, orgId)
  const formData = new FormData()
  formData.append('file', file, fileName || (file instanceof File ? file.name : 'upload.bin'))
  
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${GALLERI5_BASE}/file-upload`, {
        method: 'POST',
        headers,
        body: formData,
        signal: AbortSignal.timeout(120000),
      })
      const text = await res.text()
      let data: any = null
      try { data = JSON.parse(text) } catch { data = text }
      if (!res.ok || !(data?.file_url || data?.url)) {
        throw Error(`G5 upload gagal (${res.status}): ${data?.detail || text.slice(0, 160)}`)
      }
      return { fileUrl: data.file_url || data.url, uploadId: data.upload_id ?? null }
    } catch (err: any) {
      lastErr = err
      if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
        throw Error(`G5 upload timeout (>120s). Coba gambar yang lebih kecil atau koneksi lebih stabil.`)
      }
      const msg = (err.message || '').toLowerCase()
      const isRetryable = msg.includes('fetch failed') || msg.includes('network') || msg.includes('econnreset') || msg.includes('socket hang up')
      if (isRetryable && attempt < 2) {
        console.log(`[g5UploadFile] retry ${attempt + 1}/2: ${err.message}`)
        await sleep(2000 * (attempt + 1))
        continue
      }
      throw err
    }
  }
  throw lastErr ?? new Error('G5 upload gagal')
}

async function g5UploadUrl(accessToken: string, url: string, fileName: string, orgId?: string | null): Promise<{ fileUrl: string; uploadId: string | null }> {
  const authHeaders = await g5DirectHeaders(accessToken, orgId)

  const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg'
  const contentTypeMap: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
  }
  const contentType = contentTypeMap[ext] || 'image/jpeg'

  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await galleri5Api('upload', {
        authHeaders: JSON.stringify(authHeaders),
        fileUrl: url,
        fileName,
        contentType,
        orgId,
      })

      if (!res.ok || !res.data?.file_url) {
        throw Error(res.error || 'Upload gagal via proxy')
      }

      return {
        fileUrl: res.data.file_url,
        uploadId: res.data.upload_id ?? null,
      }
    } catch (err: any) {
      lastErr = err
      const msg = (err.message || '').toLowerCase()
      const isRetryable =
        msg.includes('fetch failed') ||
        msg.includes('download gagal') ||
        msg.includes('network') ||
        msg.includes('timeout') ||
        msg.includes('econnreset') ||
        msg.includes('socket hang up')
      if (isRetryable && attempt < 2) {
        console.log(`[g5UploadUrl] retry ${attempt + 1}/2: ${err.message}`)
        await sleep(2000 * (attempt + 1))
        continue
      }
      throw err
    }
  }
  throw lastErr ?? new Error('G5 upload via proxy gagal')
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

// ─── Public: Resolve Access Token from Key ─────────────────────────

export async function resolveAccessTokenFromKey(key: string): Promise<string | null> {
  try {
    return await resolveAccessToken(key)
  } catch {
    return null
  }
}

// ─── Public: Get Auth Headers ───────────────────────────────────────

export async function getGalleri5AuthHeaders(tokenKey?: string, minCredits?: number): Promise<Record<string, string> | null> {
  const keys = getStoredKeys()
  let active: StoredGalleri5Key | undefined
  
  if (tokenKey) {
    active = keys.find((k) => k.key === tokenKey)
  } else {
    if (minCredits && minCredits > 0) {
      active = keys.find((k) => 
        (k.status === 'active' || k.status === 'unknown') && 
        k.balance !== null && k.balance !== undefined && 
        k.balance >= minCredits
      )
    }
    if (!active) {
      active = keys.find((k) => k.status === 'active' || k.status === 'unknown')
    }
  }
  
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

// ─── SSE Stream Helpers ───────────────────────────────────────────

function tryParseJson(s: string): any {
  try { return JSON.parse(s) } catch { return null }
}

function extractVideoUrl(data: any, depth = 0): string | null {
  if (depth > 8 || data == null) return null
  if (typeof data === 'string') return /^https?:\/\/\S+\.(mp4|mov|webm|m4v)(\?|$)/i.test(data.trim()) ? data.trim() : null
  if (Array.isArray(data)) {
    for (const item of data) {
      const url = extractVideoUrl(item, depth + 1)
      if (url) return url
    }
    return null
  }
  if (typeof data === 'object') {
    for (const val of Object.values(data)) {
      const url = extractVideoUrl(val, depth + 1)
      if (url) return url
    }
  }
  return null
}

function extractTaskId(data: any): string | null {
  if (!data || typeof data !== 'object') return null
  for (const key of ['task_id', 'taskId', 'id', 'session_id', 'sessionId', 'request_id']) {
    const val = data[key]
    if (typeof val === 'string' && val.trim()) return val.trim()
  }
  return null
}

function extractSseStatus(data: any): string {
  if (typeof data === 'object' && data !== null) {
    const val = data.status ?? data.event
    return typeof val === 'string' ? val : ''
  }
  return ''
}

// ─── Public: Submit + Stream SSE ───────────────────────────────────

export async function submitGalleri5MotionControl(
  opts: Galleri5MotionControlOptions
): Promise<{ taskId: string; sessionId: string; orgId: string | null }> {
  const authHeaders = opts.authHeaders
  if (!authHeaders || Object.keys(authHeaders).length === 0) {
    throw Error(
      'Galleri5: auth headers belum diatur.'
    )
  }

  const model = resolveModel(opts.modelKey)
  const onProgress = opts.onProgress

  // Resolve access token from auth headers
  const authVal = authHeaders['Authorization'] || authHeaders['authorization'] || ''
  const accessToken = authVal.replace(/^Bearer\s+/i, '').trim()
  if (!accessToken) throw Error('Galery5: access token tidak ditemukan di authHeaders')

  onProgress?.('cek akun...')

  const infoData = await g5DirectFetch(accessToken, '/auth/me/info', { method: 'POST', body: {} })
  const orgId = infoData.organization_id || infoData.primary_organization_id || null
  const balance = typeof infoData.available_credits === 'number' ? infoData.available_credits : null

  if (balance !== null && balance < model.cr) {
    throw Error(
      `Galery5 credit tidak cukup: sisa ${balance}, butuh ±${model.cr} untuk ${model.label}.`
    )
  }

  const sessionId = generateSessionId()

  onProgress?.('upload image...')
  let imgFileUrl = opts.imageUrl
  let imgUploadId: string | null = null
  try {
    let imgResult: { fileUrl: string; uploadId: string | null }
    if (opts.imageFile) {
      imgResult = await g5UploadFile(accessToken, opts.imageFile, `ref_img_${Date.now()}.jpg`, orgId)
    } else {
      imgResult = await g5UploadUrl(accessToken, opts.imageUrl, `ref_img_${Date.now()}.jpg`, orgId)
    }
    imgFileUrl = imgResult.fileUrl || opts.imageUrl
    imgUploadId = imgResult.uploadId
    onProgress?.('upload image done')
  } catch (e: any) {
    onProgress?.(`upload image skip: ${e.message}`)
  }

  onProgress?.('upload video...')
  let vidFileUrl = opts.videoUrl
  let vidUploadId: string | null = null
  try {
    let vidResult: { fileUrl: string; uploadId: string | null }
    if (opts.videoFile) {
      vidResult = await g5UploadFile(accessToken, opts.videoFile, `ref_vid_${Date.now()}.mp4`, orgId)
    } else {
      vidResult = await g5UploadUrl(accessToken, opts.videoUrl, `ref_vid_${Date.now()}.mp4`, orgId)
    }
    vidFileUrl = vidResult.fileUrl || opts.videoUrl
    vidUploadId = vidResult.uploadId
    onProgress?.('upload video done')
  } catch (e: any) {
    onProgress?.(`upload video skip: ${e.message}`)
  }

  onProgress?.('create session...')
  await g5DirectFetch(accessToken, '/unit-sessions', {
    method: 'POST',
    orgId,
    body: {
      unit_type: 'model_garden',
      session_type: 'generation',
      name: model.sessionName,
      state: { model_path: model.modelPath },
      session_id: sessionId,
      ...(orgId ? { organization_id: orgId } : {}),
    },
  })

  onProgress?.('link session...')
  const filteredIds = [imgUploadId, vidUploadId].filter(Boolean)
  if (filteredIds.length > 0) {
    await g5DirectFetch(accessToken, '/uploads/link-session', {
      method: 'PATCH',
      orgId,
      body: { upload_ids: filteredIds, session_id: sessionId },
    }).catch(() => {})
  }

  const formFields: Record<string, any> = {
    keep_original_sound: !!opts.keepOriginalSound,
    image_url: imgFileUrl,
    video_url: vidFileUrl,
    character_orientation: opts.orientation || 'video',
  }
  if (opts.prompt && opts.prompt.trim()) {
    formFields.prompt = opts.prompt.trim()
  }
  // Wan Motion specific options
  if (opts.adaptMotion !== undefined) {
    formFields.adapt_motion = opts.adaptMotion
  }
  if (opts.safetyChecker !== undefined) {
    formFields.enable_safety_checker = opts.safetyChecker
  }
  if (opts.enhanceIdentity !== undefined) {
    formFields.enhance_identity = opts.enhanceIdentity
  }

  onProgress?.('estimate...')
  const estData = await g5DirectFetch(accessToken, '/model-garden/estimate-credits', {
    method: 'POST',
    orgId,
    body: { model_path: model.modelPath, form_fields: { ...formFields, has_video_input: true, input_duration: 0 } },
  }).catch(() => null)
  const estCredits = estData?.credits ?? null
  if (estCredits !== null) {
    onProgress?.(`estimasi ${estCredits} credit`)
  }

  onProgress?.('submit...')

  // Submit with SSE streaming — read response as stream
  const headers = await g5DirectHeaders(accessToken, orgId)
  headers['Content-Type'] = 'application/json'

  const submitRes = await fetch(`${GALLERI5_BASE}/model-garden/submit-form-stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model_path: model.modelPath,
      form_fields: formFields,
      session_id: sessionId,
      error_config: {
        strategy: 'retry_same',
        context: 'interactive',
        max_retries: 3,
      },
    }),
  })

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => '')
    let errDetail = errText.slice(0, 200)
    try { const p = JSON.parse(errText); errDetail = p.detail || p.message || errDetail } catch {}
    throw Error(`G5 submit HTTP ${submitRes.status}: ${errDetail}`)
  }

  // If no streaming body, try parse as JSON text → extract URL or fallback to poll
  if (!submitRes.body) {
    const text = await submitRes.text()
    const parsed = tryParseJson(text)
    const url = extractVideoUrl(parsed) || extractVideoUrl(text)
    if (url) return { taskId: url, sessionId, orgId }
    // Fallback: poll using sessionId
    onProgress?.('polling...')
    const pollUrl = await pollGalleri5Result(accessToken, sessionId, orgId, onProgress)
    return { taskId: pollUrl, sessionId, orgId }
  }

  // Read SSE stream line by line
  const reader = submitRes.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let lastStatus = ''

  const processLine = (line: string): string | null => {
    const parsed = tryParseJson(line.startsWith('data:') ? line.slice(5).trim() : line)
    const status = extractSseStatus(parsed)
    if (status && status !== lastStatus) {
      lastStatus = status
      onProgress?.(status)
    }
    const url = extractVideoUrl(parsed) || extractVideoUrl(line)
    if (url) return url
    return null
  }

  for (; ;) {
    const { done, value } = await reader.read()
    if (value) {
      buffer += decoder.decode(value, { stream: true })
      let idx = buffer.indexOf('\n')
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (line) {
          const url = processLine(line)
          if (url) {
            try { await reader.cancel() } catch {}
            return { taskId: url, sessionId, orgId }
          }
        }
        idx = buffer.indexOf('\n')
      }
    }
    if (done) break
  }

  // Process remaining buffer
  const remaining = buffer.trim()
  if (remaining) {
    const url = processLine(remaining.startsWith('data:') ? remaining.slice(5).trim() : remaining)
    if (url) return { taskId: url, sessionId, orgId }
  }

  // Stream ended without URL → fallback to polling
  onProgress?.('queued')
  const pollUrl = await pollGalleri5Result(accessToken, sessionId, orgId, onProgress)
  return { taskId: pollUrl, sessionId, orgId }
}

// ─── Public: Poll Result (using sessionId) ─────────────────────────

async function pollGalleri5Result(
  accessToken: string,
  sessionId: string,
  orgId: string | null,
  onProgress?: (msg: string, pct?: number) => void,
  timeoutMs = 30 * 60 * 1000
): Promise<string> {
  const startTime = Date.now()

  for (; Date.now() - startTime < timeoutMs; ) {
    await new Promise((r) => setTimeout(r, 5000))

    let data: any = null
    try {
      data = await g5DirectFetch(accessToken, `/unit-sessions/${encodeURIComponent(sessionId)}`, { orgId })
    } catch (e: any) {
      onProgress?.(`retry: ${e.message}`)
      continue
    }

    const inference = data?.latest_inference ?? data
    const status = String(inference.status || '').toLowerCase()
    const errorMsg = inference.error_message || inference.error || null
    const elapsed = Math.round((Date.now() - startTime) / 1000)

    // Log response keys for debugging (first 3 times)
    if (elapsed < 20) {
      const keys = Object.keys(inference).join(',')
      onProgress?.(`G5: ${status || 'checking'}... (${elapsed}s) keys=[${keys}]`, Math.min(95, 30 + elapsed))
    } else {
      onProgress?.(`G5: ${status || 'checking'}... (${elapsed}s)`, Math.min(95, 30 + elapsed))
    }

    const videoUrl =
      inference.result_url ||
      inference.asset_url ||
      inference.output_url ||
      inference.video_url ||
      inference.result?.url ||
      (Array.isArray(inference.result_urls) ? inference.result_urls[0] : null) ||
      (Array.isArray(inference.s3_urls) ? inference.s3_urls[0] : null)

    if (videoUrl) {
      onProgress?.('Selesai', 100)
      return videoUrl
    }

    if (/^(failed|error|cancelled|canceled|rejected)$/i.test(status)) {
      throw Error('Galleri5: task gagal — ' + (errorMsg || 'unknown'))
    }

    if (/^(succeeded|success|completed|complete|done|finished)$/i.test(status)) {
      if (Date.now() - startTime > 60000) {
        throw Error('Galleri5: job selesai tapi URL hasil tidak ditemukan' + (errorMsg ? ` (${errorMsg})` : ''))
      }
    }
  }

  throw Error('Galleri5: timeout menunggu hasil (30 menit)')
}

// ─── Public: Poll Result (legacy interface) ────────────────────────

export async function pollGalleri5MotionControl(
  authHeaders: Record<string, string>,
  taskId: string,
  onProgress?: (msg: string, pct?: number) => void,
  orgId?: string | null
): Promise<string> {
  const authVal = authHeaders['Authorization'] || authHeaders['authorization'] || ''
  const accessToken = authVal.replace(/^Bearer\s+/i, '').trim()
  if (!accessToken) throw Error('Galery5: access token tidak ditemukan di authHeaders')

  // If taskId is a URL (video URL extracted from SSE), return directly
  if (/^https?:\/\/\S+\.(mp4|mov|webm|m4v)(\?|$)/i.test(taskId)) {
    onProgress?.('Selesai', 100)
    return taskId
  }

  // Otherwise use as sessionId for polling
  return pollGalleri5Result(accessToken, taskId, orgId ?? null, onProgress)
}

// ─── Public: Submit G5 I2V (Image to Video) ─────────────────────────

export interface Galleri5I2VOptions {
  authHeaders: Record<string, string>
  modelKey: string
  imageUrl: string
  imageFile?: File | Blob
  prompt?: string
  duration?: number
  onProgress?: (msg: string, pct?: number) => void
}

export const GALLERI5_I2V_MODELS: Galleri5MotionModel[] = [
  {
    key: 'g5:gemini-omni-flash-i2v',
    modelPath: 'fal-ai/gemini-omni-flash-image-to-video',
    label: 'Gemini Omni Flash I2V (Galery5)',
    sessionName: 'Gemini Omni Flash Image to Video',
    cr: 134,
  },
  {
    key: 'g5:wan-2.7-i2v',
    modelPath: 'fal-ai/wan-v2.7-i2v',
    label: 'Wan 2.7 Image to Video (Galery5)',
    sessionName: 'Wan 2.7 I2V',
    cr: 200,
  },
]

export async function submitGalleri5I2V(
  opts: Galleri5I2VOptions
): Promise<{ taskId: string; sessionId: string; orgId: string | null }> {
  const authHeaders = opts.authHeaders
  if (!authHeaders || Object.keys(authHeaders).length === 0) {
    throw Error('Galleri5: auth headers belum diatur.')
  }

  const model = GALLERI5_I2V_MODELS.find((m) => m.key === opts.modelKey) || GALLERI5_I2V_MODELS[0]
  const onProgress = opts.onProgress

  // Resolve access token from auth headers
  const authVal = authHeaders['Authorization'] || authHeaders['authorization'] || ''
  const accessToken = authVal.replace(/^Bearer\s+/i, '').trim()
  if (!accessToken) throw Error('Galery5: access token tidak ditemukan di authHeaders')

  onProgress?.('cek akun...')

  const infoData = await g5DirectFetch(accessToken, '/auth/me/info', { method: 'POST', body: {} })
  const orgId = infoData.organization_id || infoData.primary_organization_id || null
  const balance = typeof infoData.available_credits === 'number' ? infoData.available_credits : null

  if (balance !== null && balance < model.cr) {
    throw Error(`Galery5 credit tidak cukup: sisa ${balance}, butuh ±${model.cr} untuk ${model.label}.`)
  }

  const sessionId = generateSessionId()

  onProgress?.('upload image...')
  let imgResult: { fileUrl: string; uploadId: string | null }
  if (opts.imageFile) {
    imgResult = await g5UploadFile(accessToken, opts.imageFile, `i2v_img_${Date.now()}.jpg`, orgId)
  } else {
    imgResult = await g5UploadUrl(accessToken, opts.imageUrl, `i2v_img_${Date.now()}.jpg`, orgId)
  }
  const imgFileUrl = imgResult.fileUrl
  const imgUploadId = imgResult.uploadId

  onProgress?.('create session...')
  try {
    await g5DirectFetch(accessToken, '/unit-sessions', {
      method: 'POST',
      orgId,
      body: {
        unit_type: 'model_garden',
        session_type: 'generation',
        name: model.sessionName,
        state: { model_path: model.modelPath },
        session_id: sessionId,
        ...(orgId ? { organization_id: orgId } : {}),
      },
    })
  } catch (e: any) {
    onProgress?.(`create session warning: ${e.message}`)
  }

  onProgress?.('link session...')
  if (imgUploadId) {
    try {
      await g5DirectFetch(accessToken, '/uploads/link-session', {
        method: 'PATCH',
        orgId,
        body: { upload_ids: [imgUploadId], session_id: sessionId },
      })
    } catch (e: any) {
      onProgress?.(`link session warning: ${e.message}`)
    }
  }

  const formFields: Record<string, any> = {
    image_url: imgFileUrl,
  }
  if (opts.prompt && opts.prompt.trim()) {
    formFields.prompt = opts.prompt.trim()
  }
  if (opts.duration && opts.duration > 0) {
    formFields.duration = opts.duration
  }

  onProgress?.('estimate...')
  const estData = await g5DirectFetch(accessToken, '/model-garden/estimate-credits', {
    method: 'POST',
    orgId,
    body: { model_path: model.modelPath, form_fields: formFields },
  }).catch(() => null)
  const estCredits = estData?.credits ?? null
  if (estCredits !== null) {
    onProgress?.(`estimasi ${estCredits} credit`)
  }

  onProgress?.('submit...')

  const headers = await g5DirectHeaders(accessToken, orgId)
  headers['Content-Type'] = 'application/json'

  const submitRes = await fetch(`${GALLERI5_BASE}/model-garden/submit-form-stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model_path: model.modelPath,
      form_fields: formFields,
      session_id: sessionId,
      error_config: {
        strategy: 'retry_same',
        context: 'interactive',
        max_retries: 3,
      },
    }),
  })

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => '')
    let errDetail = errText.slice(0, 200)
    try { const p = JSON.parse(errText); errDetail = p.detail || p.message || errDetail } catch {}
    throw Error(`G5 submit HTTP ${submitRes.status}: ${errDetail}`)
  }

  if (!submitRes.body) {
    const text = await submitRes.text()
    const parsed = tryParseJson(text)
    const url = extractVideoUrl(parsed) || extractVideoUrl(text)
    if (url) return { taskId: url, sessionId, orgId }
    return { taskId: sessionId, sessionId, orgId }
  }

  const reader = submitRes.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let lastStatus = ''
  let extractedTaskId: string | null = null

  for (;;) {
    const { done, value } = await reader.read()
    if (value) {
      buffer += decoder.decode(value, { stream: true })
    }
    let newlineIdx = buffer.indexOf('\n')
    while (newlineIdx >= 0) {
      const line = buffer.slice(0, newlineIdx).trim()
      buffer = buffer.slice(newlineIdx + 1)
      if (!line) continue
      const raw = line.startsWith('data:') ? line.slice(5).trim() : line
      if (!raw || raw === '[DONE]') continue
      const parsed = tryParseJson(raw)
      const videoUrl = extractVideoUrl(parsed) || extractVideoUrl(raw)
      if (videoUrl) {
        try { await reader.cancel() } catch {}
        return { taskId: videoUrl, sessionId, orgId }
      }
      const sts = extractSseStatus(parsed)
      if (sts && sts !== lastStatus) {
        lastStatus = sts
        onProgress?.(sts)
      }
      const tid = extractTaskId(parsed)
      if (tid && tid !== sessionId) {
        extractedTaskId = tid
        onProgress?.(`task id: ${tid}`)
      }
    }
    if (done) break
  }

  const remainder = buffer.trim()
  if (remainder) {
    const raw = remainder.startsWith('data:') ? remainder.slice(5).trim() : remainder
    const videoUrl = extractVideoUrl(tryParseJson(raw)) || extractVideoUrl(raw)
    if (videoUrl) return { taskId: videoUrl, sessionId, orgId }
  }

  onProgress?.('queued')
  const finalTaskId = extractedTaskId || sessionId
  return { taskId: finalTaskId, sessionId: finalTaskId, orgId }
}

export async function runGalleri5I2V(
  execute: (token: string) => Promise<string>,
  opts?: {
    minCredits?: number
    onRotate?: (index: number, total: number, reason: string) => void
  }
): Promise<string> {
  const minCr = opts?.minCredits || 200
  let allKeys = getValidKeyStringsWithBalance(minCr)
  
  if (allKeys.length === 0) {
    allKeys = getAllStoredKeys()
    if (allKeys.length === 0) {
      throw Error('Belum ada token Galery5. Buka Manage → Tokens → Galery5 dan tambahkan Firebase refresh token.')
    }
  }

  let lastError: Error | null = null
  for (let i = 0; i < allKeys.length; i++) {
    const token = allKeys[i]
    try {
      return await execute(token)
    } catch (err: any) {
      const msg = err.message || String(err)
      lastError = err
      if (i < allKeys.length - 1 && isGalleri5TokenError(msg)) {
        opts?.onRotate?.(i + 2, allKeys.length, msg)
      } else {
        throw err
      }
    }
  }
  throw lastError ?? Error('Galleri5: semua token gagal')
}

// ─── Public: Error Detection ────────────────────────────────────────

export function isGalleri5ModelRestricted(msg: string): boolean {
  return /model.*restricted|restricted.*model|contact.*admin.*enable/i.test(msg || '')
}

export function isGalleri5InsufficientBalance(msg: string): boolean {
  return /credit tidak cukup|sisa.*butuh|insufficient.*credit|not enough.*credit/i.test(msg || '')
}

export function isGalleri5TokenError(msg: string): boolean {
  const t = (msg || '').toLowerCase()
  
  // Model restriction is NOT a token error - don't rotate
  if (isGalleri5ModelRestricted(msg)) {
    return false
  }
  
  // Network/fetch errors are NOT token errors - rotating won't help
  if (
    t.includes('fetch failed') ||
    t.includes('network') ||
    t.includes('econnreset') ||
    t.includes('econnrefused') ||
    t.includes('etimedout') ||
    t.includes('socket hang up') ||
    t.includes('enotfound') ||
    t.includes('timeout') ||
    t.includes('download gagal') ||
    t.includes('upload via proxy gagal')
  ) {
    return false
  }
  
  // Insufficient balance IS a token error - rotate to try other tokens
  // Different tokens may have different credit balances
  
  return /credit|insufficient|not enough|out of|balance|quota|exhaust|limit|too many|rate.?limit|401|402|unauthor|forbidden|expired|invalid.*token|token.*invalid|5\d\d|server error|internal/.test(
    t
  )
}

export function getGalleri5ErrorMessage(error: any): string {
  const msg = error?.message || String(error)
  
  if (isGalleri5ModelRestricted(msg)) {
    const modelMatch = msg.match(/Model '([^']+)'/i)
    const modelName = modelMatch ? modelMatch[1] : 'ini'
    
    return `Model ${modelName} tidak tersedia di akun G5 Anda. Coba model lain (Kling V2.6 Standard biasanya tersedia untuk semua akun) atau upgrade subscription di aistudio.galleri5.com`
  }
  
  if (isGalleri5InsufficientBalance(msg)) {
    return `${msg}. Gunakan model yang lebih murah (Kling V2.6 Standard = 60 cr) atau isi ulang credit di aistudio.galleri5.com`
  }
  
  const t = msg.toLowerCase()
  if (t.includes('fetch failed') || t.includes('network') || t.includes('timeout') || t.includes('download gagal')) {
    return `Koneksi ke G5 gagal: ${msg}. Coba lagi dalam beberapa saat atau gunakan gambar/video yang lebih kecil.`
  }
  
  return msg
}

// ─── Public: With Token Rotation ────────────────────────────────────

export interface Galleri5RunOptions extends Omit<Galleri5MotionControlOptions, 'authHeaders'> {
  onRotate?: (index: number, total: number, reason: string) => void
}

export async function runGalleri5WithRotation(
  execute: (token: string) => Promise<string>,
  opts?: {
    minCredits?: number
    onRotate?: (index: number, total: number, reason: string) => void
  }
): Promise<string> {
  const minCr = opts?.minCredits || 60
  let allKeys = getValidKeyStringsWithBalance(minCr)
  
  if (allKeys.length === 0) {
    allKeys = getAllStoredKeys()
    if (allKeys.length === 0) {
      throw Error('Belum ada token Galery5. Buka Manage → Tokens → Galery5 dan tambahkan Firebase refresh token (AMf-...).')
    }
  }

  let lastError: Error | null = null
  for (let i = 0; i < allKeys.length; i++) {
    const token = allKeys[i]
    try {
      return await execute(token)
    } catch (err: any) {
      const msg = err.message || String(err)
      lastError = err
      if (i < allKeys.length - 1 && isGalleri5TokenError(msg)) {
        opts?.onRotate?.(i + 2, allKeys.length, msg)
      } else {
        throw err
      }
    }
  }
  throw lastError ?? Error('Galleri5: semua token gagal')
}
