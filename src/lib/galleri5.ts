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

async function g5UploadFile(accessToken: string, file: File, orgId?: string | null): Promise<{ fileUrl: string; uploadId: string | null }> {
  const headers = await g5DirectHeaders(accessToken, orgId)
  const formData = new FormData()
  formData.append('file', file, file.name || 'upload.bin')
  const res = await fetch(`${GALLERI5_BASE}/file-upload`, {
    method: 'POST',
    headers,
    body: formData,
  })
  const text = await res.text()
  let data: any = null
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok || !(data?.file_url || data?.url)) {
    throw Error(`G5 upload gagal (${res.status}): ${data?.detail || text.slice(0, 160)}`)
  }
  return { fileUrl: data.file_url || data.url, uploadId: data.upload_id ?? null }
}

async function g5UploadUrl(accessToken: string, url: string, fileName: string, orgId?: string | null): Promise<{ fileUrl: string; uploadId: string | null }> {
  const fileRes = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!fileRes.ok) throw Error(`Download gagal: HTTP ${fileRes.status}`)
  const blob = await fileRes.blob()
  const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' })
  return g5UploadFile(accessToken, file, orgId)
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

function extractError(data: any, depth = 0): string | null {
  if (depth > 6 || typeof data !== 'object' || !data) return null
  for (const key of ['error', 'error_message', 'detail', 'message']) {
    const val = data[key]
    if (typeof val === 'string' && val.trim() && !/^(ok|success|completed)$/i.test(val.trim())) {
      return val.trim()
    }
  }
  for (const val of Object.values(data)) {
    const err = extractError(val, depth + 1)
    if (err) return err
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

  const keys = getValidKeysWithBalance(model.cr)
  if (keys.length === 0) {
    throw Error(`Galery5: tidak ada token dengan balance cukup (min ${model.cr} cr untuk ${model.label})`)
  }
  
  const active = keys[0]
  const accessToken = await resolveAccessToken(active.key)

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
  const imgResult = await g5UploadUrl(accessToken, opts.imageUrl, `ref_img_${Date.now()}.jpg`, orgId)
  const imgFileUrl = imgResult.fileUrl
  const imgUploadId = imgResult.uploadId

  onProgress?.('upload video...')
  const vidResult = await g5UploadUrl(accessToken, opts.videoUrl, `ref_vid_${Date.now()}.mp4`, orgId)
  const vidFileUrl = vidResult.fileUrl
  const vidUploadId = vidResult.uploadId

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
  let lastError: string | null = null
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
    const err = extractError(parsed)
    if (err) lastError = err
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
  prompt?: string
  onProgress?: (msg: string, pct?: number) => void
}

export const GALLERI5_I2V_MODELS: Galleri5MotionModel[] = [
  {
    key: 'g5:gemini-omni-flash-i2v',
    modelPath: 'gemini-omni-flash-image-to-video',
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

  const keys = getValidKeysWithBalance(model.cr)
  if (keys.length === 0) {
    throw Error(`Galery5: tidak ada token dengan balance cukup (min ${model.cr} cr untuk ${model.label})`)
  }
  
  const active = keys[0]
  const accessToken = await resolveAccessToken(active.key)

  onProgress?.('cek akun...')

  const infoData = await g5DirectFetch(accessToken, '/auth/me/info', { method: 'POST', body: {} })
  const orgId = infoData.organization_id || infoData.primary_organization_id || null
  const balance = typeof infoData.available_credits === 'number' ? infoData.available_credits : null

  if (balance !== null && balance < model.cr) {
    throw Error(`Galery5 credit tidak cukup: sisa ${balance}, butuh ±${model.cr} untuk ${model.label}.`)
  }

  const sessionId = generateSessionId()

  onProgress?.('upload image...')
  const imgResult = await g5UploadUrl(accessToken, opts.imageUrl, `i2v_img_${Date.now()}.jpg`, orgId)
  const imgFileUrl = imgResult.fileUrl
  const imgUploadId = imgResult.uploadId

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
  }).catch(() => {})

  onProgress?.('link session...')
  if (imgUploadId) {
    await g5DirectFetch(accessToken, '/uploads/link-session', {
      method: 'PATCH',
      orgId,
      body: { upload_ids: [imgUploadId], session_id: sessionId },
    }).catch(() => {})
  }

  const formFields: Record<string, any> = {
    image_url: imgFileUrl,
  }
  if (opts.prompt && opts.prompt.trim()) {
    formFields.prompt = opts.prompt.trim()
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
  let lastError: string | null = null

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
      const errStr = extractError(parsed)
      if (errStr) lastError = errStr
      const sts = extractSseStatus(parsed)
      if (sts && sts !== lastStatus) {
        lastStatus = sts
        onProgress?.(sts)
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
  return { taskId: sessionId, sessionId, orgId }
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
  
  // Insufficient balance is NOT a token error if all tokens have same issue - don't rotate
  if (isGalleri5InsufficientBalance(msg)) {
    return false
  }
  
  return /credit|insufficient|not enough|out of|balance|quota|exhaust|limit|too many|rate.?limit|401|402|unauthor|forbidden|expired|invalid.*token|token.*invalid|5\d\d|server error|internal|network|fetch|timeout|timed out/.test(
    t
  )
}

export function getGalleri5ErrorMessage(error: any): string {
  const msg = error?.message || String(error)
  
  if (isGalleri5ModelRestricted(msg)) {
    // Extract model name if available
    const modelMatch = msg.match(/Model '([^']+)'/i)
    const modelName = modelMatch ? modelMatch[1] : 'ini'
    
    return `Model ${modelName} tidak tersedia di akun G5 Anda. Coba model lain (Kling V2.6 Standard biasanya tersedia untuk semua akun) atau upgrade subscription di aistudio.galleri5.com`
  }
  
  if (isGalleri5InsufficientBalance(msg)) {
    return `${msg}. Gunakan model yang lebih murah (Kling V2.6 Standard = 60 cr) atau isi ulang credit di aistudio.galleri5.com`
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
