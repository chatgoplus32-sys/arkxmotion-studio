const GENSPARK_BASE = '/api/public/genspark'

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

export function getGensparkApiKey(): string | null {
  return getStoredProviderKey('genspark')
}

export function getGensparkCookies(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('arkxmotion.providers')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const gensparkData = parsed['genspark']
    if (!gensparkData || !Array.isArray(gensparkData)) return null
    const active = gensparkData.find((item: any) => item.cookies && (item.status === 'active' || item.status === 'unknown'))
    return active?.cookies || gensparkData[0]?.cookies || null
  } catch { return null }
}

// ─── Balance Check ─────────────────────────────────────
export async function checkGensparkBalance(apiKey: string): Promise<{
  ok: boolean
  balance: number | null
  email: string | null
  plan: string | null
  error?: string
}> {
  try {
    const res = await fetch(`${GENSPARK_BASE}/api/tool_cli/me`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        'X-GSK-CLI-Caps': 'video_generation',
        'X-GSK-CLI-Version': '1.7.1',
      },
    })
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { ok: false, balance: null, email: null, plan: null, error: 'API key tidak valid' }
      }
      return { ok: false, balance: null, email: null, plan: null, error: `HTTP ${res.status}` }
    }
    const data = await res.json()
    console.log('[genspark] me raw:', JSON.stringify(data).slice(0, 1200))
    const user = data?.data || data
    function findBalance(obj: any, depth = 0): number | null {
      if (!obj || typeof obj !== 'object' || depth > 4) return null
      const keys = ['credits', 'balance', 'remaining_credits', 'remaining', 'quota', 'points', 'coins', 'amount', 'left', 'available', 'total_credits', 'credit_balance']
      for (const k of keys) {
        const v = obj[k]
        if (typeof v === 'number' && Number.isFinite(v)) return v
        if (typeof v === 'string') {
          const cleaned = v.replace(/,/g, '').trim()
          if (/^-?\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned)
        }
      }
      for (const v of Object.values(obj)) {
        if (v && typeof v === 'object') { const r = findBalance(v, depth + 1); if (r !== null) return r }
      }
      return null
    }
    const balance = findBalance(user)
    return {
      ok: true,
      balance,
      email: user?.email || user?.user_email || null,
      plan: user?.plan || user?.subscription || null,
    }
  } catch (err: any) {
    return { ok: false, balance: null, email: null, plan: null, error: err.message || 'Network error' }
  }
}

// ═══════════════════════════════════════════════════════════════════
// UPLOAD (server-side proxy handles API key → session → Azure SAS)
// ═══════════════════════════════════════════════════════════════════

export async function uploadToGenspark(file: File): Promise<string> {
  const apiKey = getGensparkApiKey()
  if (!apiKey) throw new Error('No Genspark API key')
  console.log(`[genspark] Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB) via server proxy...`)
  const formData = new FormData()
  formData.append('file', file, file.name)
  const res = await fetch('/api/public/genspark-upload', {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
    body: formData,
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Genspark upload failed: HTTP ${res.status} ${errText.slice(0, 200)}`)
  }
  const data = await res.json()
  if (!data.ok || !data.file_url) {
    throw new Error(data.error || 'No file URL returned from Genspark upload')
  }
  console.log(`[genspark] Upload done: ${data.file_url}`)
  return data.file_url
}

// ═══════════════════════════════════════════════════════════════════
// VIDEO GENERATION
// ═══════════════════════════════════════════════════════════════════

export interface GensparkVideoParams {
  prompt?: string
  model: string
  aspectRatio?: string
  duration?: number
  imageUrl?: string
  videoUrl?: string
  audioUrl?: string
  extraParams?: Record<string, any>
}

export interface GensparkVideoResult {
  status: 'ok' | 'error' | string
  data?: {
    video_url?: string
    video_urls?: string[]
    generated_videos?: Array<{
      task_id?: string
      status?: string
      video_url?: string
      video_urls?: string[]
      source_video_uris?: string[]
      poster_urls?: string[]
      last_frame_urls?: string[]
      duration?: number
      tier?: string
      try_count?: number
      failure_reason?: string
      error_code?: string
    }>
  }
  message?: string
  version?: number
}

/**
 * Build payload per Genspark Kling V3 Motion Control spec.
 * Whitelist params: aspect_ratio, duration, video_size, tier, character_orientation,
 *   audio_enable, keep_audio (boolean), fast_mode, ref_mode (boolean).
 * IMPORTANT: Do NOT send fast_mode with tier (they conflict).
 */
function buildMotionControlPayload(params: GensparkVideoParams): Record<string, any> {
  const tier = params.extraParams?.tier || 'standard'
  const orientation = params.extraParams?.character_orientation || 'video'
  const audioEnable = params.extraParams?.audio_enable ?? false
  const keepAudio = params.extraParams?.keep_audio ?? false

  const request: Record<string, any> = {
    aspect_ratio: params.aspectRatio || '9:16',
    duration: params.duration || 5,
    video_size: 'auto',
    tier,
    character_orientation: orientation,
    audio_enable: audioEnable,
  }
  // Only send keep_audio if true (not in default state)
  if (keepAudio) request.keep_audio = true

  return {
    videos: [{
      model: params.model,
      prompt: params.prompt || 'animate this character with the motion from the reference video',
      image_urls: params.imageUrl ? [params.imageUrl] : [],
      video_url: params.videoUrl || '',
      request,
    }],
  }
}

/**
 * Build flat payload for tool_cli/video_generation.
 */
function buildToolCliPayload(params: GensparkVideoParams): Record<string, any> {
  const tier = params.extraParams?.tier || 'standard'
  const orientation = params.extraParams?.character_orientation || 'video'
  const audioEnable = params.extraParams?.audio_enable ?? false
  const keepAudio = params.extraParams?.keep_audio ?? false

  const args: Record<string, any> = {
    query: params.prompt || 'animate this character with the motion from the reference video',
    model: params.model,
    aspect_ratio: params.aspectRatio || '9:16',
    duration: params.duration || 5,
    video_size: 'auto',
    tier,
    character_orientation: orientation,
    audio_enable: audioEnable,
  }
  if (params.imageUrl) args.image_urls = [params.imageUrl]
  if (params.videoUrl) args.video_url = params.videoUrl
  if (keepAudio) args.keep_audio = true
  return args
}

export async function submitGensparkVideo(params: GensparkVideoParams): Promise<GensparkVideoResult> {
  const apiKey = getGensparkApiKey()
  if (!apiKey) throw new Error('No Genspark API key')

  // ── 1. Try ask_proxy first (web UI path, uses cookies + AI agent) ──
  try {
    console.log(`[genspark] [1/3] Trying ask_proxy (web UI path)...`)
    const result = await submitViaAskProxy(params, apiKey)
    return result
  } catch (askErr: any) {
    console.log(`[genspark] [1/3] ask_proxy failed: ${askErr.message?.slice(0, 100)}`)
  }

  // ── 2. Try media_canvas/direct_generate (non-agent direct path) ──
  try {
    console.log(`[genspark] [2/3] Trying direct_generate (non-agent path)...`)
    const result = await submitViaDirectGenerate(params, apiKey)
    return result
  } catch (dgErr: any) {
    console.log(`[genspark] [2/3] direct_generate failed: ${dgErr.message?.slice(0, 100)}`)
  }

  // ── 3. Fallback: tool_cli/video_generation (direct API key) ──
  console.log(`[genspark] [3/3] Using tool_cli/video_generation fallback`)
  return submitViaToolCli(params, apiKey)
}

// ═══════════════════════════════════════════════════════════════════
// PATH 1: ASK_PROXY (same as Genspark web UI)
// Uses session cookies + AI agent (Claude/GPT-4.1)
// ═══════════════════════════════════════════════════════════════════

async function submitViaAskProxy(params: GensparkVideoParams, apiKey: string): Promise<GensparkVideoResult> {
  const cookies = getGensparkCookies()
  if (!cookies) throw new Error('No Genspark session cookies')

  const tier = params.extraParams?.tier || 'standard'
  const orientation = params.extraParams?.character_orientation || 'video'

  // Build content array with private_file refs
  const content: any[] = []
  if (params.imageUrl) {
    content.push({ type: 'private_file', private_file: { name: 'character.png', private_storage_url: params.imageUrl.replace('https://www.genspark.ai/', 'genspark.ai/') } })
  }
  if (params.videoUrl) {
    content.push({ type: 'private_file', private_file: { name: 'motion.mp4', private_storage_url: params.videoUrl.replace('https://www.genspark.ai/', 'genspark.ai/') } })
  }

  const body = {
    models: ['gpt-4.1'],
    model_params: {
      type: 'video',
      model: params.model,
      aspect_ratio: params.aspectRatio || '9:16',
      duration: String(params.duration || 5),
      tier,
      character_orientation: orientation,
      video_size: 'auto',
      generation_count: 1,
    },
    type: 'video_generation_agent',
    messages: [{ role: 'user', content }],
  }

  console.log(`[genspark] POST /api/agent/ask_proxy`)
  console.log(`[genspark] model: ${body.model_params.model} tier: ${tier} orientation: ${orientation}`)
  console.log(`[genspark] cookies: ${cookies.length} chars`)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120000)

  try {
    const res = await fetch(`${GENSPARK_BASE}/api/agent/ask_proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`ask_proxy HTTP ${res.status}: ${errText.slice(0, 200)}`)
    }

    // Parse SSE stream
    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''
    let finalVideoUrl = ''
    let taskId = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const events = buffer.split('\n\n')
      buffer = events.pop() || ''

      for (const evt of events) {
        const dataLines = evt.split('\n').filter(l => l.startsWith('data: '))
        for (const dl of dataLines) {
          const jsonStr = dl.slice(6)
          if (!jsonStr || jsonStr === '[DONE]') continue
          try {
            const data = JSON.parse(jsonStr)
            // Extract video URLs from any format
            const resultStr = JSON.stringify(data)
            const falMatch = resultStr.match(/https?:\/\/v3b\.fal\.media\/[^\\s"'<>]+/g)
            if (falMatch?.length) finalVideoUrl = falMatch[falMatch.length - 1]
            const gensparkMatch = resultStr.match(/https?:\/\/www\.genspark\.ai\/api\/files\/s\/[^\\s"'<>]+/g)
            if (gensparkMatch?.length) finalVideoUrl = gensparkMatch[gensparkMatch.length - 1]
            const mp4Match = resultStr.match(/https?:\/\/[^\\s"'<>]+\.mp4[^\\s"'<>]*/g)
            if (mp4Match?.length && !finalVideoUrl) finalVideoUrl = mp4Match[mp4Match.length - 1]
            if (data.task_id) taskId = data.task_id
          } catch {}
        }
      }
    }

    console.log(`[genspark] ask_proxy done. videoUrl: ${finalVideoUrl ? 'yes' : 'no'} taskId: ${taskId || 'none'}`)

    if (!finalVideoUrl) throw new Error('No video URL found in ask_proxy response')

    return {
      status: 'ok',
      data: {
        generated_videos: [{
          task_id: taskId || undefined,
          status: 'SUCCESS',
          video_url: finalVideoUrl,
          video_urls: [finalVideoUrl],
        }],
      },
    }
  } catch (err: any) {
    clearTimeout(timeout)
    throw err
  }
}

// ═══════════════════════════════════════════════════════════════════
// PATH 2: MEDIA_CANVAS DIRECT_GENERATE (non-agent, direct)
// No AI agent overhead — sends generate_videos payload directly
// ═══════════════════════════════════════════════════════════════════

async function submitViaDirectGenerate(params: GensparkVideoParams, apiKey: string): Promise<GensparkVideoResult> {
  const payload = buildMotionControlPayload(params)

  console.log(`[genspark] POST /api/media_canvas/direct_generate`)
  console.log(`[genspark] payload:`, JSON.stringify(payload).slice(0, 500))

  const res = await fetch(`${GENSPARK_BASE}/api/media_canvas/direct_generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      'X-GSK-CLI-Caps': 'video_generation',
      'X-GSK-CLI-Version': '1.7.1',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`direct_generate HTTP ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = await res.json()
  console.log(`[genspark] direct_generate response:`, JSON.stringify(data).slice(0, 1500))

  // Response might have generated_videos or task_id at top level
  const gv = data?.generated_videos?.[0] || data?.data?.generated_videos?.[0]
  if (gv?.video_url || gv?.video_urls?.length || data?.video_url) {
    return {
      status: 'ok',
      data: {
        generated_videos: [gv || { video_url: data.video_url }],
      },
    }
  }

  // Return raw result for polling
  return data
}

// ═══════════════════════════════════════════════════════════════════
// PATH 3: TOOL_CLI/VIDEO_GENERATION (API key, direct — fallback)
// ═══════════════════════════════════════════════════════════════════

async function submitViaToolCli(params: GensparkVideoParams, apiKey: string): Promise<GensparkVideoResult> {
  const args = buildToolCliPayload(params)

  console.log(`[genspark] POST /api/tool_cli/video_generation`)
  console.log(`[genspark] model: "${args.model}" orientation: "${args.character_orientation}" duration: ${args.duration}`)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 900000)

  try {
    const res = await fetch(`${GENSPARK_BASE}/api/tool_cli/video_generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        'X-GSK-CLI-Caps': 'video_generation',
        'X-GSK-CLI-Version': '1.7.1',
      },
      body: JSON.stringify(args),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`tool_cli HTTP ${res.status}: ${errText.slice(0, 200)}`)
    }

    const text = await res.text()
    console.log(`[genspark] Response: ${text.length} chars, status: ${res.status}`)

    // Parse multi-line SSE-style response
    const lines = text.trim().split('\n')
    let finalResult: GensparkVideoResult | null = null
    for (const line of lines) {
      if (!line || !line.startsWith('{')) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed.status || parsed.version !== undefined) finalResult = parsed
      } catch {}
    }
    if (!finalResult) {
      try { finalResult = JSON.parse(text) } catch {}
    }

    if (!finalResult) throw new Error('No valid result from Genspark API')

    const gv = finalResult.data?.generated_videos?.[0] as any
    if (gv) {
      console.log(`[genspark] task_id: ${gv.task_id} status: ${gv.status} try_count: ${gv.try_count ?? '?'}${gv.error_code ? ` error: ${gv.error_code}` : ''}`)
    }

    return finalResult
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') throw new Error('Genspark API timeout (15 min)')
    throw err
  }
}

// ═══════════════════════════════════════════════════════════════════
// URL Extraction
// ═══════════════════════════════════════════════════════════════════

export function extractGensparkVideoUrl(result: GensparkVideoResult, inputUrls?: { imageUrl?: string; videoUrl?: string }): string | null {
  if (result.status === 'error') return null
  const d = result.data
  if (!d) return null

  console.log('[genspark] extractGensparkVideoUrl data keys:', Object.keys(d), 'generated_videos:', d.generated_videos?.length ?? 0)

  const extractToken = (url?: string | null): string => {
    if (!url) return ''
    try { const u = new URL(url); return u.searchParams.get('token') ? u.search : '' } catch { return '' }
  }
  const firstVideo = d.generated_videos?.[0] as any
  const tokenFromVideoUrl = extractToken(firstVideo?.video_url) || extractToken(d.video_url)

  const inputVidPart = inputUrls?.videoUrl?.split('/s/')[1]?.split('?')[0] || '___none___'
  const inputImgPart = inputUrls?.imageUrl?.split('/s/')[1]?.split('?')[0] || '___none2___'

  const isInput = (u: string) => {
    if (!u || !inputUrls) return false
    return u === inputUrls.imageUrl || u === inputUrls.videoUrl || u.includes(inputVidPart) || u.includes(inputImgPart)
  }

  const withToken = (url: string) => {
    if (tokenFromVideoUrl && !url.includes('?token=') && url.includes('genspark.ai')) {
      return url + tokenFromVideoUrl
    }
    return url
  }

  if (d.generated_videos?.length) {
    for (const v of d.generated_videos) {
      const candidates = [...(v.source_video_uris || []), ...(v.video_urls || []), ...(v.poster_urls || []), ...(v.last_frame_urls || []), v.video_url, v.url, v.result_url].filter(Boolean) as string[]
      for (const url of candidates) {
        if (url && !isInput(url) && !url.includes('/poster') && !url.includes('/last_frame')) return withToken(url)
      }
      if (v.video_urls?.[0]) {
        const alt = v.video_urls[0]
        if (!isInput(alt)) return withToken(alt)
      }
      const statusLower = String(v.status || '').toLowerCase()
      if (v.status && !['success', 'completed', 'done', 'finished'].includes(statusLower)) {
        console.warn('[genspark] generated_videos status not done:', v.status, '→ need polling')
        return null
      }
    }
  }

  const direct = d.video_url || d.result_url || d.url || d.output?.video_url || d.video_urls?.[0]
  if (direct && !isInput(direct)) return withToken(direct)
  return null
}

// ═══════════════════════════════════════════════════════════════════
// Polling — uses /api/vg_tasks_status (batch, API key auth)
// NOTE: tool_cli/video_generation/{id} does NOT exist (404)
// ═══════════════════════════════════════════════════════════════════

export async function pollGensparkVideo(taskId: string, onProgress?: (msg: string) => void): Promise<string> {
  const apiKey = getGensparkApiKey()
  if (!apiKey) throw new Error('No Genspark API key')

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000))
    onProgress?.(`Polling Genspark ${i + 1}/60 (${(i + 1) * 5}s)...`)

    try {
      const pollUrl = `${GENSPARK_BASE}/api/vg_tasks_status`
      const res = await fetch(pollUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
          'X-GSK-CLI-Caps': 'video_generation',
          'X-GSK-CLI-Version': '1.7.1',
        },
        body: JSON.stringify({ task_ids: [taskId] }),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        console.warn(`[genspark] poll ${i + 1} HTTP ${res.status}:`, errText.slice(0, 200))
        continue
      }

      // Response may be streaming (SSE/newline-delimited JSON) — read all text first
      const rawText = await res.text()
      if (!rawText || !rawText.trim()) { console.warn(`[genspark] poll ${i + 1} empty response`); continue }

      // Parse: try JSON first, then SSE "data: {...}" lines, then newline-delimited JSON
      let j: any = null
      try {
        j = JSON.parse(rawText)
      } catch {
        // Try SSE format: data: {...}
        const lines = rawText.split('\n').filter(l => l.startsWith('data: ') && l.length > 6)
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line.slice(6))
            // Take the last valid JSON object (latest status)
            if (parsed?.generated_videos || parsed?.tasks || parsed?.status) j = parsed
          } catch {}
        }
        // Try newline-delimited JSON
        if (!j) {
          for (const line of rawText.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('{')) continue
            try {
              const parsed = JSON.parse(trimmed)
              if (parsed?.generated_videos || parsed?.tasks || parsed?.status) j = parsed
            } catch {}
          }
        }
      }
      if (!j) { console.warn(`[genspark] poll ${i + 1} unparseable:`, rawText.slice(0, 200)); continue }

      console.log(`[genspark] poll ${i + 1}:`, JSON.stringify(j).slice(0, 1000))

      // Normalize: response may be { tasks: [...] } or { generated_videos: [...] }
      const tasks = j.tasks || j.data?.tasks || j.generated_videos || [j]
      const gv = tasks?.[0]
      const videoUrl = gv?.video_urls?.[0] || gv?.source_video_uris?.[0] || gv?.video_url
      const status = (gv?.status || '').toUpperCase()

      if (videoUrl && ['SUCCESS', 'COMPLETED', 'DONE', 'FINISHED'].includes(status)) {
        return videoUrl
      }
      if (videoUrl && !['PENDING', 'RUNNING', 'PROCESSING', 'QUEUED', ''].includes(status)) {
        return videoUrl
      }
      if (['FAILURE', 'FAILED', 'ERROR'].includes(status)) {
        const tryCount = gv?.try_count || 0
        throw new Error(`Genspark task failed (${tryCount}x): ${gv?.failure_reason || gv?.error_message || 'generation_failed'}`)
      }
    } catch (e: any) {
      if (e.message?.includes('task failed')) throw e
      console.warn(`[genspark] poll ${i + 1} error:`, e.message)
    }
  }
  throw new Error('Genspark polling timeout 5min')
}
