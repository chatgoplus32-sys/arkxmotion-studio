// Seavi Labs REST API client — api.seavilabs.site via relay /api/public/seavi
// Kontrak terverifikasi dari docs resmi + probe nyata (submit 202 → poll progress → result.url).
// Model aktif diverifikasi via GET /models (16 model, bukan 70 di docs).
const SEAVI_PROXY = '/api/public/seavi'

export interface SeaviModelSpec {
  id: string
  label: string
  category: 'video_generation' | 'image_generation' | 'motion_control' | 'upscaler'
  inputType: string
  tokens: number
  imageMode: 'none' | 'single' | 'multi'
  imageMin?: number
  imageMax?: number
  videoMode: 'none' | 'single' | 'multi'
  videoMax?: number
  audio?: boolean
  durations?: number[]
  aspects?: string[] // kosong = parameter aspect_ratio tidak ada di model ini
  promptMax?: number
  promptRequired?: boolean
}

const mc = (id: string, label: string, tokens: number, promptMax: number): SeaviModelSpec => ({
  id,
  label,
  category: 'motion_control',
  inputType: 'image_plus_video',
  tokens,
  imageMode: 'single',
  imageMin: 1,
  imageMax: 1,
  videoMode: 'single',
  videoMax: 1,
  durations: [],
  aspects: [], // MC: tanpa aspect_ratio
  promptMax,
  promptRequired: false,
})

const i2v = (id: string, label: string, tokens: number, durations: number[], aspects: string[], promptMax = 2000): SeaviModelSpec => ({
  id,
  label,
  category: 'video_generation',
  inputType: 'image_to_video',
  tokens,
  imageMode: 'single',
  imageMin: 1,
  imageMax: 1,
  videoMode: 'none',
  durations,
  aspects,
  promptMax,
  promptRequired: true,
})

export const SEAVI_MODELS: Record<string, SeaviModelSpec> = {
  // ── Motion Control (gambar + video referensi) ──
  motion_control_v3_server10_30dtk: mc('motion_control_v3_server10_30dtk', 'Motion Control V3 · Server 10 (30 dtk)', 1, 0),
  motion_control_v3_server16: mc('motion_control_v3_server16', 'Motion Control V3 · Server 16 (10 dtk)', 1, 0),
  motion_control_v3_server17: mc('motion_control_v3_server17', 'Motion Control V3 · Server 17 (15 dtk)', 1, 250),

  // ── Video generation: image to video ──
  veo31_s9: i2v('veo31_s9', 'Veo 3.1 · Server 9', 1, [8], ['9:16', '16:9']),
  kling3_server10: i2v('kling3_server10', 'Kling 3 · Server 10', 1, [6, 10], ['9:16', '16:9']),
  kling21pro_server10: i2v('kling21pro_server10', 'Kling 2.1 Pro · Server 10', 1, [5, 10], ['9:16', '16:9']),
  grok_imagine_s15: i2v('grok_imagine_s15', 'Grok Imagine · Server 15', 1, [10], ['9:16', '16:9', '1:1', '4:3']),

  // ── Video generation: multi-image / multimodal ──
  seedance2_multi_s15: {
    id: 'seedance2_multi_s15',
    label: 'Seedance 2 Multi · Server 15',
    category: 'video_generation',
    inputType: 'images_to_video',
    tokens: 1,
    imageMode: 'multi',
    imageMin: 1,
    imageMax: 3,
    videoMode: 'none',
    durations: [5, 10],
    aspects: ['9:16', '16:9', '1:1', '4:3'],
    promptMax: 2000,
    promptRequired: true,
  },
  seedance25_server19: {
    id: 'seedance25_server19',
    label: 'Seedance 2.5 · Server 19',
    category: 'video_generation',
    inputType: 'multimodal_to_video',
    tokens: 1,
    imageMode: 'multi',
    imageMin: 0,
    imageMax: 9,
    videoMode: 'multi',
    videoMax: 3,
    audio: true,
    durations: [5, 10],
    aspects: ['9:16', '16:9', '1:1', '3:4', '4:3'],
    promptMax: 2000,
    promptRequired: false,
  },
  wan30_server19: {
    id: 'wan30_server19',
    label: 'Wan 3.0 · Server 19',
    category: 'video_generation',
    inputType: 'image_to_video',
    tokens: 2,
    imageMode: 'single',
    imageMin: 1,
    imageMax: 1,
    videoMode: 'none',
    audio: true,
    durations: [5, 10, 15],
    aspects: [], // Wan 3.0: tanpa aspect_ratio
    promptMax: 1500,
    promptRequired: true,
  },
  gemini_omni_server19: {
    id: 'gemini_omni_server19',
    label: 'Gemini Omni · Server 19',
    category: 'video_generation',
    inputType: 'multimodal_to_video',
    tokens: 2,
    imageMode: 'multi',
    imageMin: 1,
    imageMax: 9,
    videoMode: 'multi',
    videoMax: 3,
    audio: true,
    durations: [5, 10, 15],
    aspects: ['9:16', '16:9', '1:1', '3:4', '4:3'],
    promptMax: 20000,
    promptRequired: true,
  },
}

// ── Image generation (halaman Edit Image) ──
// Input: image_urls 0-8 referensi; output png. 1 token.
const seaviImage = (id: string, label: string, maxRefs: number, aspects: string[]): SeaviModelSpec => ({
  id,
  label,
  category: 'image_generation',
  inputType: 'text_or_images_to_image',
  tokens: 1,
  imageMode: 'multi',
  imageMin: 0,
  imageMax: maxRefs,
  videoMode: 'none',
  aspects,
  promptMax: 2000,
  promptRequired: true,
})

export const SEAVI_IMAGE_MODELS: Record<string, SeaviModelSpec> = {
  gpt_image2_s9: seaviImage('gpt_image2_s9', 'GPT Image 2 · S9', 8, ['9:16', '16:9', '1:1', '4:3']),
  grok_imagine_gambar_s9: seaviImage('grok_imagine_gambar_s9', 'Grok Imagine Gambar · S9', 5, ['9:16', '16:9', '1:1', '4:3']),
  nano_banana_2_server9: seaviImage('nano_banana_2_server9', 'Nano Banana 2 · S9', 8, ['9:16', '16:9', '1:1', '4:3']),
  seedream5_s9: seaviImage('seedream5_s9', 'Seedream 5 · S9', 8, ['9:16', '16:9', '1:1', '4:3']),
}

// ── Upscaler (halaman Video Upscaler) ──
export const SEAVI_VIDEO_UPSCALER: SeaviModelSpec = {
  id: 'upscale_video_server7',
  label: 'Upscale Video · S7',
  category: 'upscaler',
  inputType: 'video_upscale',
  tokens: 1,
  imageMode: 'none',
  videoMode: 'single',
  videoMax: 1,
}

export function getSeaviSpec(id: string): SeaviModelSpec | undefined {
  return SEAVI_MODELS[id]
}

export function listSeaviModelIds(): string[] {
  return Object.keys(SEAVI_MODELS)
}

export interface SeaviPayloadInput {
  imageUrls?: string[]
  videoUrls?: string[]
  audioUrl?: string
  prompt?: string
  aspectRatio?: string
  duration?: number
}

/** Bangun body POST /generate dengan validasi ketat per model. */
export function buildSeaviPayload(spec: SeaviModelSpec, media: SeaviPayloadInput): {
  model: string
  input: Record<string, unknown>
  params: Record<string, unknown>
} {
  const images = (media.imageUrls || []).filter(Boolean)
  const videos = (media.videoUrls || []).filter(Boolean)
  const prompt = (media.prompt || '').trim()

  // gambar
  if (spec.imageMode === 'single') {
    if (images.length !== 1) {
      throw new Error(`${spec.label} membutuhkan tepat 1 gambar (diterima: ${images.length})`)
    }
  } else if (spec.imageMode === 'multi') {
    const max = spec.imageMax ?? 0
    const min = spec.imageMin ?? 0
    if (images.length < min || images.length > max) {
      throw new Error(`${spec.label} menerima ${min}-${max} gambar (diterima: ${images.length})`)
    }
  } else if (images.length > 0) {
    throw new Error(`${spec.label} tidak menerima gambar`)
  }

  // video
  if (spec.videoMode === 'single') {
    if (videos.length !== 1) {
      throw new Error(`${spec.label} membutuhkan tepat 1 video referensi (diterima: ${videos.length})`)
    }
  } else if (spec.videoMode === 'multi') {
    const max = spec.videoMax ?? 0
    if (videos.length > max) {
      throw new Error(`${spec.label} maksimal ${max} video referensi (diterima: ${videos.length})`)
    }
  } else if (videos.length > 0) {
    throw new Error(`${spec.label} tidak menerima video referensi`)
  }

  // audio
  const audio = media.audioUrl ? [media.audioUrl].filter(Boolean) : []
  if (!spec.audio && audio.length > 0) {
    throw new Error(`${spec.label} tidak menerima audio`)
  }
  if (spec.audio && audio.length > 1) {
    throw new Error(`${spec.label} maksimal 1 audio`)
  }

  // prompt
  // Wajib hanya bila ditandai eksplisit, atau tak ditandai tapi ada batas prompt (model teks).
  const promptRequired = spec.promptRequired === true || (spec.promptRequired === undefined && !!spec.promptMax)
  if (promptRequired && !prompt) {
    throw new Error('Prompt wajib diisi')
  }
  if (prompt && spec.promptMax && prompt.length > spec.promptMax) {
    throw new Error(`Prompt maksimal ${spec.promptMax} karakter (saat ini: ${prompt.length})`)
  }

  const input: Record<string, unknown> = {}
  if (spec.imageMode === 'single') input.image_url = images[0]
  if (spec.imageMode === 'multi' && images.length > 0) input.image_urls = images
  if (spec.videoMode !== 'none' && videos.length > 0) input.video_url = videos[0]
  if (spec.audio && audio.length === 1) input.audio_url = audio[0]

  const params: Record<string, unknown> = {}
  if (prompt) params.prompt = prompt
  if (spec.aspects && spec.aspects.length > 0 && media.aspectRatio && spec.aspects.includes(media.aspectRatio)) {
    params.aspect_ratio = media.aspectRatio
  }
  if (spec.durations && spec.durations.length > 0 && media.duration && spec.durations.includes(media.duration)) {
    params.duration = media.duration
  }

  return { model: spec.id, input, params }
}

export interface SeaviLogOpts {
  onLog?: (msg: string, level?: string) => void
  onStatus?: (text: string, pct: number) => void
}

/** Cek saldo kunci (token tersisa). */
export async function fetchSeaviBalance(apiKey: string): Promise<{ ok: boolean; balance?: number; used?: number; error?: string }> {
  try {
    const res = await fetch(`${SEAVI_PROXY}?path=balance`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const text = await res.text()
    let data: any
    try { data = JSON.parse(text) } catch { data = null }
    if (res.status === 401 || res.status === 403) {
      const msg = data?.error?.message || data?.message || `HTTP ${res.status}`
      return { ok: false, error: `Kunci tidak valid: ${msg}` }
    }
    if (!res.ok || !data) {
      return { ok: false, error: data?.error?.message || `HTTP ${res.status}` }
    }
    return { ok: true, balance: typeof data.token_remaining === 'number' ? data.token_remaining : undefined, used: data.token_used }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Gagal cek saldo' }
  }
}

/** POST /generate image: hasil PNG di result.url. */
export async function generateSeaviImage(
  apiKey: string,
  payload: { model: string; input: Record<string, unknown>; params: Record<string, unknown> },
): Promise<string> {
  const id = await submitSeaviGeneration(apiKey, payload)
  const maxPolls = 120 // 4s x 120 = 8 menit (image jauh lebih cepat dari video)
  for (let i = 0; i < maxPolls; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 4000))
    const res = await fetch(`${SEAVI_PROXY}?path=generate/${encodeURIComponent(id)}/status`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) continue
    const j = await res.json().catch(() => null)
    if (!j) continue
    const status = String(j.status || '').toLowerCase()
    if (status === 'completed') {
      const url = j.result?.url
      if (!url) throw new Error('Seavi: job completed tanpa URL hasil')
      return String(url)
    }
    if (status === 'failed') {
      const code = j.error?.code || 'GENERATION_FAILED'
      const msg = j.error?.message || ''
      throw new Error(
        code === 'CONTENT_SAFETY_REJECTED'
          ? `Ditolak content safety Seavi — revisi prompt / ganti media referensi${msg ? ` (${msg})` : ''}`
          : `Seavi job gagal: ${code}${msg ? ` — ${msg}` : ''} (biaya direfund otomatis)`,
      )
    }
    if (status === 'cancelled') throw new Error('Seavi job dibatalkan')
  }
  throw new Error('Seavi: timeout menunggu gambar (>8 menit)')
}

export async function submitSeaviGeneration(
  apiKey: string,
  payload: { model: string; input: Record<string, unknown>; params: Record<string, unknown> },
): Promise<string> {
  const res = await fetch(`${SEAVI_PROXY}?path=generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = null }
  if (!res.ok || !data) {
    const code = data?.error?.code || ''
    const msg = data?.error?.message || text.slice(0, 200) || `HTTP ${res.status}`
    throw new Error(`Seavi ${res.status}${code ? ` ${code}` : ''}: ${msg}`)
  }
  const id = data.id || data.request_id
  if (!id) throw new Error(`Seavi: respons tanpa id — ${text.slice(0, 200)}`)
  return String(id)
}

export interface SeaviPollResult {
  url: string
  format: string
}

/** POST /generate → request id (202). Error upstream dilempar dengan kode + pesan. */
const SEAVI_TERMINAL = new Set(['completed', 'failed', 'cancelled'])

/** Poll /generate/{id}/status sampai selesai. Hasil gagal upstream = refund otomatis (di sisi Seavi). */
export async function pollSeaviStatus(apiKey: string, id: string, opts: SeaviLogOpts = {}): Promise<SeaviPollResult> {
  const { onLog, onStatus } = opts
  const maxPolls = 150 // 5s × 150 = 12.5 menit
  for (let i = 0; i < maxPolls; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 5000))
    const res = await fetch(`${SEAVI_PROXY}?path=generate/${encodeURIComponent(id)}/status`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      onLog?.(`Poll #${i + 1}: HTTP ${res.status} (dicoba ulang...)`, 'warn')
      continue
    }
    const j = await res.json().catch(() => null)
    if (!j) {
      onLog?.(`Poll #${i + 1}: respons tidak valid (dicoba ulang...)`, 'warn')
      continue
    }
    const status = String(j.status || '').toLowerCase()
    const progress = typeof j.progress === 'number' ? j.progress : 0
    if (status === 'completed') {
      const url = j.result?.url
      if (!url) throw new Error('Seavi: job completed tanpa URL hasil')
      return { url, format: j.result?.format || 'mp4' }
    }
    if (status === 'failed') {
      const code = j.error?.code || 'GENERATION_FAILED'
      const msg = j.error?.message || ''
      throw new Error(
        code === 'CONTENT_SAFETY_REJECTED'
          ? `Ditolak content safety Seavi — revisi prompt / ganti media referensi${msg ? ` (${msg})` : ''}`
          : `Seavi job gagal: ${code}${msg ? ` — ${msg}` : ''} (biaya direfund otomatis)`,
      )
    }
    if (status === 'cancelled') {
      throw new Error('Seavi job dibatalkan')
    }
    if (!SEAVI_TERMINAL.has(status)) {
      const pct = Math.max(6, Math.min(97, progress || 5))
      onStatus?.(`Memproses... ${progress}%`, pct)
      if (i % 6 === 5) onLog?.(`⏳ Seavi ${status} (${progress}%)`, 'debug')
    }
  }
  throw new Error('Seavi: timeout menunggu hasil (>12 menit)')
}

export interface SeaviGenerateOptions extends SeaviLogOpts {
  apiKey: string
  spec: SeaviModelSpec
  imageUrls?: string[]
  videoUrls?: string[]
  audioUrl?: string
  prompt?: string
  aspectRatio?: string
  duration?: number
}

/** End-to-end: validasi → submit → poll → URL hasil. */
export async function generateWithSeavi(opts: SeaviGenerateOptions): Promise<string> {
  const { apiKey, spec, onLog, onStatus } = opts
  const payload = buildSeaviPayload(spec, {
    imageUrls: opts.imageUrls,
    videoUrls: opts.videoUrls,
    audioUrl: opts.audioUrl,
    prompt: opts.prompt,
    aspectRatio: opts.aspectRatio,
    duration: opts.duration,
  })
  onLog?.(`[2/3] 🚀 Submit ${spec.label} (${spec.tokens} token)...`, 'info')
  onStatus?.(`Submit ${spec.label}...`, 5)
  const id = await submitSeaviGeneration(apiKey, payload)
  onLog?.(`[2/3] ✅ Job dibuat ✓ id=${id}`, 'success')
  onLog?.(`[3/3] ⏳ Polling hasil...`, 'info')
  const { url } = await pollSeaviStatus(apiKey, id, { onLog, onStatus })
  onLog?.(`✅ Video selesai ✓`, 'success')
  onStatus?.('Done!', 100)
  return url
}
