// ─── OneOver (Supabase) ─────────────────────────────────────────────────
// Auth: Supabase session refresh_token → auto-refresh to access_token
// Video generate: POST functions/v1/video-generate
// Video poll:     POST functions/v1/video-poll
// Balance:        GET  functions/v1/get-credit-balance?user_id=...

const ONEOVER_SUPABASE_URL = 'https://mjuwtqkfhtpgavwjrual.supabase.co'
const ONEOVER_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdXd0cWtmaHRwZ2F2d2pydWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyMzcxODgsImV4cCI6MjA4MjgxMzE4OH0.h7PCq_fZJ7JfsQtxMuqLyhSvL4JMgOvBumsw2rBwJOc'
const ONEOVER_PROXY = '/api/public/oneover'

// ─── Token Cache (in-memory, like Galleri5) ─────────────────────────────

const tokenCache = new Map<string, { accessToken: string; expiry: number }>()

// ─── Types ───────────────────────────────────────────────────────────────

interface OneOverSubmitRequest {
  prompt?: string
  model: string
  duration?: number
  resolution?: string
  aspect_ratio?: string
  generate_audio?: boolean
  video_draft?: boolean
  reference_image?: string   // base64
  last_frame_image?: string  // base64
  reference_video?: string   // base64
  reference_video_url?: string
  reference_audio?: string   // base64
  keep_audio?: boolean
  omni_task?: 'text_to_video' | 'image_to_video' | 'reference_to_video' | 'edit'
  seed?: number
  project_id?: string
  auto_prompt?: boolean
}

interface OneOverSubmitResponse {
  prediction_url: string
  video_provider: string
  video_model: string
  duration: number
  resolution: string
  aspect_ratio: string
  generate_audio: boolean
  video_draft: boolean
  prompt: string
  source: string
  project_id: string | null
  app_id: string | null
  request_id: string | null
}

interface OneOverPollBody {
  prediction_url: string
  video_provider: string
  video_model: string
  duration: number
  resolution: string
  aspect_ratio: string
  generate_audio: boolean
  video_draft: boolean
  prompt: string
  source: string
  project_id: string | null
  app_id: string | null
  request_id: string | null
}

interface OneOverPollResponse {
  status: 'pending' | 'complete' | 'failed'
  replicate_status?: string
  error?: string
  error_type?: string
  prediction_id?: string
  predict_time?: number
  video_url?: string
  video_urls?: string[]
  [key: string]: any
}

interface GenerateOpts {
  apiKey: string          // stored key: refresh_token or access_token
  prompt: string
  model: string
  duration?: number
  resolution?: string
  aspectRatio?: string
  generateAudio?: boolean
  referenceImageBase64?: string
  lastFrameImageBase64?: string
  referenceVideoBase64?: string
  referenceAudioBase64?: string
  keepAudio?: boolean
  omniTask?: OneOverSubmitRequest['omni_task']
  seed?: number
  projectId?: string
  autoPrompt?: boolean
  onLog?: (msg: string, level?: string) => void
  onStatus?: (text: string, pct: number) => void
}

// ─── Periodic Auto-Refresh ───────────────────────────────────────────────
// Refreshes access_token every 30 minutes to keep it fresh.
// Started on first token resolution, runs in background.

let _autoRefreshStarted = false
let _autoRefreshTimer: ReturnType<typeof setInterval> | null = null

/**
 * Start periodic auto-refresh for all OneOver tokens.
 * Called automatically on first token resolution.
 * Refreshes every 30 minutes (token expires in 60 minutes).
 */
export function startOneOverAutoRefresh() {
  if (_autoRefreshStarted) return
  _autoRefreshStarted = true

  _autoRefreshTimer = setInterval(async () => {
    try {
      // Dynamic import to avoid circular dependency
      const { useProviderManager } = await import('@/stores/providerManager')
      const keys = useProviderManager.getState().keys.oneover || []

      for (const k of keys) {
        if (k.status === 'invalid' || k.status === 'expired') continue
        try {
          const newAccessToken = await resolveOneOverAccessToken(k.key)
          // Update the access token in provider store for fast access
          useProviderManager.getState().updateKeyStatus('oneover', k.id, 'active', k.balance, k.email)
          console.log('[oneover] Auto-refreshed token for', k.name || k.id)
        } catch (err: any) {
          console.warn('[oneover] Auto-refresh failed for', k.name || k.id, ':', err.message)
          // Mark as invalid if refresh fails
          if (err.message?.includes('expired') || err.message?.includes('invalid')) {
            useProviderManager.getState().updateKeyStatus('oneover', k.id, 'expired')
          }
        }
      }
    } catch {}
  }, 30 * 60 * 1000) // every 30 minutes
}

/** Stop periodic auto-refresh */
export function stopOneOverAutoRefresh() {
  if (_autoRefreshTimer) {
    clearInterval(_autoRefreshTimer)
    _autoRefreshTimer = null
    _autoRefreshStarted = false
  }
}

// ─── Model catalog ───────────────────────────────────────────────────────

export const ONEOVER_VIDEO_MODELS = [
  {
    id: 'grok-imagine-video',
    name: 'Grok Imagine Video',
    crPerSec: { '480p': 10, '720p': 14 },
    resolutions: ['480p', '720p'],
    durations: [5, 10, 15],
    supportsAudio: true,
    supportsImageToVideo: true,
  },
  {
    id: 'seedance-2.0',
    name: 'Seedance 2.0',
    crPerSec: { '480p': 14 },
    resolutions: ['480p', '720p'],
    durations: [5, 10],
    supportsAudio: true,
    supportsImageToVideo: false,
  },
  {
    id: 'seedance-2.5',
    name: 'Seedance 2.5',
    crPerSec: { '480p': 21, '720p': 47 },
    resolutions: ['480p', '720p'],
    durations: [5, 10, 15, 20, 30],
    supportsAudio: true,
    supportsImageToVideo: false,
  },
  {
    id: 'gemini-omni-flash-preview',
    name: 'Gemini Omni Flash',
    crPerSec: { '720p': 20 },
    resolutions: ['720p'],
    durations: [4, 6, 8, 10],
    supportsAudio: true,
    supportsImageToVideo: true,
  },
] as const

export type OneOverModelId = (typeof ONEOVER_VIDEO_MODELS)[number]['id']

// ─── JWT Helpers ─────────────────────────────────────────────────────────

function parseJwtPayload(token: string): Record<string, any> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

function isTokenExpiringSoon(token: string, bufferMs = 120_000): boolean {
  const payload = parseJwtPayload(token)
  if (!payload?.exp) return true // no exp claim → assume expiring
  return Date.now() > (payload.exp * 1000) - bufferMs
}

/** Check if a string looks like a Supabase access_token (JWT) */
export function isOneOverJwt(token: string): boolean {
  return /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(token.trim())
}

/** Check if a string looks like a Supabase refresh_token (long alphanumeric, no dots) */
export function isOneOverRefreshToken(token: string): boolean {
  const t = token.trim()
  return !t.includes('.') && /^[\w-]{60,}$/.test(t)
}

// ─── Token Refresh (Supabase) ───────────────────────────────────────────

/**
 * Call Supabase /auth/v1/token?grant_type=refresh_token to get a fresh access_token.
 * Returns the new access_token, rotated refresh_token, and expiry.
 */
async function refreshSupabaseToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
} | null> {
  try {
    const res = await fetch(`${ONEOVER_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ONEOVER_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: Number(data.expires_in) || 3600,
    }
  } catch {
    return null
  }
}

/**
 * Resolve a valid access_token from the stored key.
 *
 * The stored key can be:
 * - A refresh_token (long alphanumeric string) → calls Supabase refresh endpoint
 * - An access_token (JWT eyJ...) → uses directly, refreshes if expired
 *
 * Caches the access_token in memory for fast reuse.
 * If the refresh_token rotates, updates the stored key in localStorage.
 */
export async function resolveOneOverAccessToken(key: string): Promise<string> {
  // Start auto-refresh on first resolution
  startOneOverAutoRefresh()

  const trimmed = key.trim()
  if (!trimmed) throw Error('OneOver: token kosong')

  // ── Case 1: Stored key is a refresh_token ──
  if (isOneOverRefreshToken(trimmed)) {
    // Check cache first (skip if expiring within 2 minutes)
    const now = Date.now()
    const cached = tokenCache.get(trimmed)
    if (cached && now < cached.expiry - 120_000) return cached.accessToken

    // Refresh via Supabase
    const result = await refreshSupabaseToken(trimmed)
    if (!result) throw Error('OneOver: refresh token tidak valid / kedaluwarsa — login ulang di oneover.com')

    const expiry = now + result.expiresIn * 1000
    tokenCache.set(trimmed, { accessToken: result.accessToken, expiry })

    // If refresh_token rotated, update stored key in localStorage
    if (result.refreshToken !== trimmed) {
      updateStoredOneOverToken(trimmed, result.refreshToken, result.accessToken, expiry)
    }

    return result.accessToken
  }

  // ── Case 2: Stored key is an access_token (JWT) ──
  if (isOneOverJwt(trimmed)) {
    // Check cache first
    const now = Date.now()
    const cached = tokenCache.get(trimmed)
    if (cached && now < cached.expiry - 120_000) return cached.accessToken

    // If not expired, use directly and cache
    if (!isTokenExpiringSoon(trimmed)) {
      const payload = parseJwtPayload(trimmed)
      const expiry = payload?.exp ? payload.exp * 1000 : now + 3600_000
      tokenCache.set(trimmed, { accessToken: trimmed, expiry })
      return trimmed
    }

    // Expired — try to find the refresh_token from Supabase session storage
    const refreshToken = extractRefreshFromStorage()
    if (refreshToken) {
      const result = await refreshSupabaseToken(refreshToken)
      if (result) {
        const expiry = now + result.expiresIn * 1000
        tokenCache.set(trimmed, { accessToken: result.accessToken, expiry })
        // Also update the stored key to use the new refresh_token directly
        updateStoredOneOverToken(trimmed, result.refreshToken, result.accessToken, expiry)
        return result.accessToken
      }
    }

    throw Error('OneOver: access token expired — ambil ulang dari oneover.com')
  }

  throw Error('OneOver: format token tidak dikenal (harus refresh_token atau JWT access_token)')
}

/**
 * Update the stored key in localStorage when refresh_token rotates.
 * Follows the same pattern as Galleri5's updateStoredRefreshToken.
 */
function updateStoredOneOverToken(
  oldKey: string,
  newRefreshToken: string,
  accessToken: string,
  accessExpiry: number
) {
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem('arkxmotion.providers')
    if (!raw) return
    const parsed = JSON.parse(raw)
    const keys = parsed['oneover'] || []
    const idx = keys.findIndex((k: any) => k.key === oldKey)
    if (idx < 0) return
    keys[idx] = { ...keys[idx], key: newRefreshToken, accessToken, accessExpiry }
    localStorage.setItem('arkxmotion.providers', JSON.stringify(parsed))
    tokenCache.set(newRefreshToken, { accessToken, expiry: accessExpiry })
    window.dispatchEvent(new Event('aatools:keys-changed'))
  } catch {}
}

// ─── Extract from Supabase Session Storage ───────────────────────────────

/**
 * Try to extract the refresh_token from the Supabase session stored in localStorage.
 * This is a fallback when the stored key is an expired access_token.
 */
function extractRefreshFromStorage(): string | null {
  try {
    const STORAGE_KEY = 'sb-mjuwtqkfhtpgavwjrual-auth-token'
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.current_session?.refresh_token || parsed?.refresh_token || null
  } catch {
    return null
  }
}

// ─── Bookmarklet (extracts BOTH tokens) ──────────────────────────────────

/**
 * Try to extract Supabase access_token + refresh_token from oneover.com localStorage.
 * Must be called from a script running on oneover.com domain.
 */
export function extractTokenFromOneOverStorage(): { accessToken: string; refreshToken: string } | null {
  try {
    const STORAGE_KEY = 'sb-mjuwtqkfhtpgavwjrual-auth-token'
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const session = parsed?.current_session || parsed
    const accessToken = session?.access_token
    const refreshToken = session?.refresh_token
    if (!accessToken) return null
    return { accessToken, refreshToken: refreshToken || '' }
  } catch {
    return null
  }
}

/**
 * Generate a bookmarklet JS snippet that extracts BOTH access_token and
 * refresh_token from oneover.com's Supabase session and copies them
 * as a JSON string to clipboard.
 */
export function getOneOverBookmarklet(): string {
  return `
(function() {
  try {
    var PREFIX = 'sb-mjuwtqkfhtpgavwjrual-auth-token.';
    var accessToken = '', refreshToken = '';

    // 1. Try chunked cookies (Supabase v2 primary storage)
    var allCookies = document.cookie.split(';');
    var chunks = [];
    for (var i = 0; i < allCookies.length; i++) {
      var parts = allCookies[i].trim().split('=');
      var name = parts[0];
      if (name.indexOf(PREFIX) === 0) {
        var idx = parseInt(name.slice(PREFIX.length), 10);
        chunks[idx] = decodeURIComponent(parts.slice(1).join('='));
      }
    }
    if (chunks.length > 0) {
      try {
        var parsed = JSON.parse(chunks.join(''));
        var session = parsed.current_session || parsed;
        accessToken = (session && session.access_token) || '';
        refreshToken = (session && session.refresh_token) || '';
      } catch {}
    }

    // 2. Fallback to localStorage
    if (!accessToken) {
      var KEY = 'sb-mjuwtqkfhtpgavwjrual-auth-token';
      var raw = localStorage.getItem(KEY);
      if (raw) {
        try {
          var parsed2 = JSON.parse(raw);
          var session2 = parsed2.current_session || parsed2;
          accessToken = (session2 && session2.access_token) || '';
          refreshToken = (session2 && session2.refresh_token) || '';
        } catch {}
      }
    }

    // 3. Fallback: scan ALL cookies for raw JWTs
    if (!accessToken) {
      for (var j = 0; j < allCookies.length; j++) {
        var val = allCookies[j].trim().split('=').slice(1).join('=');
        if (val && val.indexOf('eyJ') === 0 && val.indexOf('.') !== -1) {
          accessToken = val;
          break;
        }
      }
    }

    if (!accessToken) {
      alert('OneOver session not found.\\nMake sure you are logged in to oneover.com.');
      return;
    }

    var payload = JSON.stringify({ access_token: accessToken, refresh_token: refreshToken || '' });
    navigator.clipboard.writeText(payload).then(function() {
      alert('✅ Tokens copied!\\n\\n• access_token: ' + accessToken.slice(0, 30) + '...\\n• refresh_token: ' + (refreshToken ? 'yes' : 'none') + '\\n\\nPaste into Freebuff → Providers → OneOver.');
    }, function() {
      prompt('Copy this JSON:', payload);
    });
  } catch(e) { alert('Error: ' + e.message); }
})();`.trim()
}

// ─── Proxy-based API Calls ───────────────────────────────────────────────

async function proxyPost(body: Record<string, any>, accessToken: string, action: string): Promise<any> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${ONEOVER_PROXY}?action=${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      })
      const text = await res.text()
      let data: any
      try { data = JSON.parse(text) } catch { data = { error: text } }
      if (!res.ok) {
        throw new Error(data?.error?.message || data?.error || `HTTP ${res.status}`)
      }
      return data
    } catch (err: any) {
      lastErr = err
      const msg = (err.message || '').toLowerCase()
      const isRetryable = msg.includes('fetch failed') || msg.includes('network') || msg.includes('timeout') || msg.includes('econnreset')
      if (isRetryable && attempt < 2) {
        console.log(`[oneover] proxyPost retry ${attempt + 1}/2: ${err.message}`)
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
        continue
      }
      throw err
    }
  }
  throw lastErr ?? new Error('OneOver request failed')
}

async function proxyGet(action: string, accessToken: string, params?: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ action, ...params }).toString()
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${ONEOVER_PROXY}?${qs}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15000),
      })
      const text = await res.text()
      let data: any
      try { data = JSON.parse(text) } catch { data = { error: text } }
      if (!res.ok) {
        throw new Error(data?.error?.message || data?.error || `HTTP ${res.status}`)
      }
      return data
    } catch (err: any) {
      lastErr = err
      const msg = (err.message || '').toLowerCase()
      const isRetryable = msg.includes('fetch failed') || msg.includes('network') || msg.includes('timeout') || msg.includes('econnreset')
      if (isRetryable && attempt < 2) {
        console.log(`[oneover] proxyGet retry ${attempt + 1}/2: ${err.message}`)
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
        continue
      }
      throw err
    }
  }
  throw lastErr ?? new Error('OneOver balance check failed')
}

// ─── Public API ───────────────────────────────────────────────────────────

/** Submit a video generation job */
export async function submitOneOverVideo(
  accessToken: string,
  request: OneOverSubmitRequest,
  onLog?: (msg: string, level?: string) => void
): Promise<OneOverSubmitResponse> {
  onLog?.(`[oneover] POST video-generate model=${request.model} duration=${request.duration}s res=${request.resolution}`)
  const data = await proxyPost(request as any, accessToken, 'generate')
  onLog?.(`[oneover] response: prediction_url=${data.prediction_url?.slice(0, 60)}...`)
  return data
}

/** Poll video job status */
export async function pollOneOverVideo(
  accessToken: string,
  submitResult: OneOverSubmitResponse,
  onLog?: (msg: string, level?: string) => void
): Promise<OneOverPollResponse> {
  const pollBody: OneOverPollBody = {
    prediction_url: submitResult.prediction_url,
    video_provider: submitResult.video_provider,
    video_model: submitResult.video_model,
    duration: submitResult.duration,
    resolution: submitResult.resolution,
    aspect_ratio: submitResult.aspect_ratio,
    generate_audio: submitResult.generate_audio,
    video_draft: submitResult.video_draft,
    prompt: submitResult.prompt,
    source: submitResult.source || 'studio',
    project_id: submitResult.project_id,
    app_id: submitResult.app_id,
    request_id: submitResult.request_id,
  }
  const data = await proxyPost(pollBody as any, accessToken, 'poll')
  onLog?.(`[oneover] poll: status=${data.status}`)
  return data
}

/** Fetch credit balance */
export async function checkOneOverBalance(
  accessToken: string,
  userId?: string,
  onLog?: (msg: string, level?: string) => void
): Promise<{ ok: boolean; balance?: number; error?: string }> {
  try {
    const params: Record<string, string> = {}
    if (userId) params.user_id = userId
    console.log('[oneover] checkBalance userId:', userId)
    const data = await proxyGet('balance', accessToken, params)
    console.log('[oneover] balance raw response:', JSON.stringify(data))
    // Try multiple possible response formats
    const balance = data?.total_credits ?? data?.current_balance ?? data?.balance ?? data?.credits ?? data?.data?.balance ?? data?.data?.credits ?? data?.available_credits ?? null
    onLog?.(`[oneover] balance: ${balance}`)
    return { ok: true, balance: balance ?? undefined }
  } catch (err: any) {
    console.error('[oneover] balance error:', err.message)
    return { ok: false, error: err.message || 'Failed to check balance' }
  }
}

/** Extract user_id from JWT payload */
export function extractOneOverUserId(accessToken: string): string | null {
  const payload = parseJwtPayload(accessToken)
  return payload?.sub || payload?.user_id || null
}

/** File → base64 data URL */
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Estimate credits for a model + duration + resolution */
export function estimateOneOverCredits(
  model: string,
  duration: number,
  resolution: string
): number {
  const m = ONEOVER_VIDEO_MODELS.find((v) => v.id === model)
  if (!m) return 0
  const crPerSec = (m.crPerSec as Record<string, number>)[resolution] || 10
  return crPerSec * duration
}

/**
 * Full generate flow: resolve token → submit → poll → return video URL.
 * The apiKey is the stored key (refresh_token or access_token).
 * resolveOneOverAccessToken handles the auto-refresh transparently.
 */
export async function generateWithOneOver(opts: GenerateOpts): Promise<string> {
  const {
    apiKey, prompt, model, duration = 5, resolution = '720p', aspectRatio = '16:9',
    generateAudio, referenceImageBase64, lastFrameImageBase64,
    referenceVideoBase64, referenceAudioBase64, keepAudio,
    omniTask, seed, projectId, autoPrompt = true,
    onLog, onStatus,
  } = opts

  if (!apiKey) throw new Error('No OneOver token')

  // Resolve a valid access_token (auto-refreshes if needed)
  onLog?.(`Resolving OneOver access token...`)
  const accessToken = await resolveOneOverAccessToken(apiKey)

  onLog?.(`Submitting to OneOver... model=${model}`)
  onStatus?.('Submitting to OneOver...', 10)

  const body: OneOverSubmitRequest = {
    prompt: prompt.trim() || undefined,
    model,
    duration,
    resolution,
    aspect_ratio: aspectRatio,
    generate_audio: generateAudio ?? false,
    video_draft: false,
    omni_task: omniTask || (referenceImageBase64 ? 'image_to_video' : 'text_to_video'),
    auto_prompt: autoPrompt,
  }
  if (referenceImageBase64) body.reference_image = referenceImageBase64
  if (lastFrameImageBase64) body.last_frame_image = lastFrameImageBase64
  if (referenceVideoBase64) body.reference_video = referenceVideoBase64
  if (referenceAudioBase64) body.reference_audio = referenceAudioBase64
  if (keepAudio !== undefined) body.keep_audio = keepAudio
  if (seed !== undefined) body.seed = seed
  if (projectId) body.project_id = projectId

  const submitResult = await submitOneOverVideo(accessToken, body, onLog)
  onLog?.(`Job created ✓ provider=${submitResult.video_provider} model=${submitResult.video_model}`)
  onStatus?.(`Processing... (${submitResult.video_provider})`, 20)

  // Poll — re-resolve token each time in case it expires during long generation
  const pollInterval = 3000
  const maxSeconds = Math.max(120, duration * 70)
  const maxPolls = Math.ceil(maxSeconds / (pollInterval / 1000))

  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, pollInterval))

    // Re-resolve token for long polls (auto-refresh)
    let pollToken = accessToken
    if (i > 0 && i % 20 === 0) {
      try {
        pollToken = await resolveOneOverAccessToken(apiKey)
      } catch {
        // Token refresh failed — try with cached token, will fail if truly expired
      }
    }

    const pollResult = await pollOneOverVideo(pollToken, submitResult, onLog)
    const pct = Math.min(90, 20 + (i / maxPolls) * 70)
    const statusText = pollResult.replicate_status || pollResult.status || 'processing'
    onStatus?.(`Status: ${statusText}... (${i + 1}/${maxPolls})`, pct)
    onLog?.(`Poll #${i + 1}: status=${pollResult.status} provider=${pollResult.replicate_status || ''}`)

    if (pollResult.status === 'complete') {
      console.log('[oneover] poll complete response:', JSON.stringify(pollResult).slice(0, 500))
      // Try multiple possible URL field names
      const videoUrl = pollResult.video_url
        || pollResult.video_urls?.[0]
        || pollResult.output?.url
        || pollResult.result?.url
        || pollResult.result?.video_url
        || pollResult.data?.video_url
        || pollResult.data?.url
        || pollResult.url
        || pollResult.download_url
        || pollResult.output_url
        || pollResult.media_url
        || pollResult.asset_url
      if (videoUrl) {
        onLog?.(`Done ✓ ${videoUrl.slice(0, 80)}...`)
        onStatus?.('Done!', 100)
        return videoUrl
      }
      throw new Error('Job complete but no video URL returned. Response: ' + JSON.stringify(pollResult).slice(0, 200))
    }

    if (pollResult.status === 'failed') {
      const msg = pollResult.error || 'Generation failed'
      onLog?.(`Failed: ${msg}`, 'error')
      throw new Error(msg)
    }
  }

  throw new Error('Timeout: OneOver generation took too long')
}
