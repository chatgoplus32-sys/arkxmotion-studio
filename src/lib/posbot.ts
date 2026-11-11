// PosBot Developer API v1 — api.posbot.web.id via relay /api/public/posbot
// Kontrak dari dokumen resmi (60 model aktif, saldo IDR, auto-refund 100%).
// Harga di katalog ini adalah tarif developer dalam Rupiah, bukan "credit"
// aplikasi: PosBot memotong saldo_generate milik akun pemilik API key.
import { relayAuthHeaders } from './providerServerKey.js'

const POSBOT_PROXY = '/api/public/posbot'

export type PosbotCategory =
  | 'image'
  | 'image_edit'
  | 'video'
  | 'lipsync'
  | 'motion'
  | 'r2v'
  | 'upscale'
  | 'tts'
  | 'music'

/**
 * Matriks kemampuan tiap model. Dinilai dari katalog developer §5:
 * - t2v/i2v/sfv/f2f/r2v : mode video (teks, gambar, start-frame, frame→frame,
 *   referensi video+gambar).
 * - v2v : video masuk → video keluar (motion control, upscale, watermark).
 * - t2i/i2i : generasi gambar dari teks / acuan gambar.
 * - face_swap/upscale/lipsync/music/tts : kategori non-video.
 */
export type PosbotMode =
  | 't2v'
  | 'i2v'
  | 'sfv'
  | 'f2f'
  | 'r2v'
  | 'v2v'
  | 't2i'
  | 'i2i'
  | 'face_swap'
  | 'upscale'
  | 'lipsync'
  | 'music'
  | 'tts'

/** Label pendek mode — dipakai UI untuk menjelaskan kebutuhan input model. */
export const POSBOT_MODE_LABELS: Record<PosbotMode, string> = {
  t2v: 'T2V',
  i2v: 'I2V',
  sfv: 'SFV',
  f2f: 'F2F',
  r2v: 'R2V',
  v2v: 'V2V',
  t2i: 'T2I',
  i2i: 'I2I',
  face_swap: 'FACE SWAP',
  upscale: 'UPSCALE',
  lipsync: 'LIPSYNC',
  music: 'MUSIC',
  tts: 'TTS',
}

export interface PosbotModelSpec {
  id: string
  label: string
  category: PosbotCategory
  /** Tarif developer dalam Rupiah. */
  price: number
  promptMax: number
  promptRequired: boolean
  /** Panjang prompt minimum (Seedance T2V: 3 karakter). */
  promptMin?: number
  imageMode: 'none' | 'single' | 'multi'
  imageMin?: number
  imageMax?: number
  videoMode: 'none' | 'single'
  /** Video referensi opsional walau videoMode single (Omni Flash 1.1/1.2). */
  videoOptional?: boolean
  audio?: boolean
  swap?: boolean
  lyrics?: boolean
  aspects?: string[]
  /** Output duration yang diketahui; hanya dikirim bila `sendDuration`. */
  durations?: number[]
  sendDuration?: boolean
  /** Seluruh kemampuan model (UI), bukan hanya mode yang dikirim upstream. */
  modes?: PosbotMode[]
  /**
   * Upstream hanya menerima parameter `mode` untuk Seedance 2.0/2.5 dan Omni
   * Flash 1.1/1.2 (dokumen §3). Model lain: mode hanya memandu UI.
   */
  sendMode?: boolean
}

/** "T2V · I2V · F2F" — detail mode yang ditampilkan di samping nama model. */
export function posbotModeSummary(spec: PosbotModelSpec): string {
  return (spec.modes ?? []).map((m) => POSBOT_MODE_LABELS[m] ?? m).join(' · ')
}

const IMAGE_ASPECTS = ['9:16', '16:9', '1:1', '3:4', '4:3', '2:3', '3:2', '21:9']
const VIDEO_ASPECTS = ['9:16', '16:9', '1:1']

interface ImageOpts {
  promptMax?: number
  /** Maksimum foto referensi opsional. */
  refs?: number
  /** Model yang mewajibkan satu gambar acuan (krea2_2k). */
  imageRequired?: boolean
}

const imageGen = (id: string, label: string, opts: ImageOpts = {}): PosbotModelSpec => ({
  id,
  label,
  category: 'image',
  price: 350,
  promptMax: opts.promptMax ?? 2000,
  promptRequired: true,
  imageMode: opts.imageRequired ? 'single' : opts.refs ? 'multi' : 'none',
  imageMin: opts.imageRequired ? 1 : 0,
  imageMax: opts.imageRequired ? 1 : opts.refs,
  videoMode: 'none',
  aspects: IMAGE_ASPECTS,
  // Krea 2 wajib gambar acuan (i2i); sisanya bisa teks murni atau acuan gambar.
  modes: opts.imageRequired ? ['i2i'] : ['t2i', 'i2i'],
})

interface VideoOpts {
  price: number
  promptMax?: number
  promptRequired?: boolean
  image?: 'none' | 'required' | 'optional'
  /** Maksimum total gambar (termasuk gambar utama). */
  images?: number
  /** Minimum gambar saat `image` required tetapi menerima lebih dari satu. */
  imageMin?: number
  video?: boolean
  videoOptional?: boolean
  aspects?: string[]
  durations?: number[]
  sendDuration?: boolean
  modes?: PosbotMode[]
  sendMode?: boolean
  promptMin?: number
}

const videoSpec = (id: string, label: string, opts: VideoOpts): PosbotModelSpec => {
  const image = opts.image ?? 'required'
  const imageCount = opts.images ?? 1
  const imageMode: PosbotModelSpec['imageMode'] =
    image === 'none' ? 'none' : image === 'required' && imageCount === 1 ? 'single' : 'multi'
  return {
    id,
    label,
    category: 'video',
    price: opts.price,
    promptMax: opts.promptMax ?? 2500,
    promptRequired: opts.promptRequired ?? false,
    promptMin: opts.promptMin,
    imageMode,
    imageMin: image === 'none' ? 0 : (opts.imageMin ?? (image === 'required' ? 1 : 0)),
    imageMax: image === 'none' ? 0 : imageCount,
    videoMode: opts.video ? 'single' : 'none',
    videoOptional: opts.videoOptional,
    aspects: opts.aspects ?? [],
    durations: opts.durations,
    sendDuration: opts.sendDuration,
    modes: opts.modes,
    sendMode: opts.sendMode,
  }
}

const motionSpec = (id: string, label: string, price: number, sendDuration = false): PosbotModelSpec => ({
  id,
  label,
  category: 'motion',
  price,
  promptMax: 2500,
  promptRequired: false,
  imageMode: 'single',
  imageMin: 1,
  imageMax: 1,
  videoMode: 'single',
  aspects: [],
  durations: sendDuration ? [10, 15, 30] : undefined,
  sendDuration,
  // Salin gerakan video acuan ke gambar karakter = video-to-video.
  modes: ['v2v'],
})

const r2vSpec = (
  id: string,
  label: string,
  price: number,
  opts: {
    promptMax: number
    promptRequired: boolean
    images: number
    durations: number[]
    imageMin?: number
    videoOptional?: boolean
    aspects?: string[]
    modes?: PosbotMode[]
  },
): PosbotModelSpec => ({
  id,
  label,
  category: 'r2v',
  price,
  promptMax: opts.promptMax,
  promptRequired: opts.promptRequired,
  imageMode: 'multi',
  imageMin: opts.imageMin ?? 1,
  imageMax: opts.images,
  videoMode: 'single',
  videoOptional: opts.videoOptional,
  aspects: opts.aspects ?? [],
  durations: opts.durations,
  modes: opts.modes ?? ['r2v', 'v2v'],
})

const musicSpec = (id: string, label: string, price = 500, lyrics = true): PosbotModelSpec => ({
  id,
  label,
  category: 'music',
  price,
  promptMax: 2000,
  promptRequired: true,
  imageMode: 'none',
  imageMax: 0,
  videoMode: 'none',
  lyrics,
  modes: ['music'],
})

const ttsSpec = (id: string, label: string, price = 500): PosbotModelSpec => ({
  id,
  label,
  category: 'tts',
  price,
  promptMax: 2000,
  promptRequired: true,
  imageMode: 'none',
  imageMax: 0,
  videoMode: 'none',
  modes: ['tts'],
})

const add = (list: PosbotModelSpec[]): Record<string, PosbotModelSpec> =>
  Object.fromEntries(list.map((m) => [m.id, m]))

export const POSBOT_MODELS: Record<string, PosbotModelSpec> = {
  // ── Image generation ──
  ...add([
    imageGen('krea2_2k', 'Krea 2 (2K)', { imageRequired: true }),
    imageGen('nano_banana_2_4k', 'Nano Banana 2 (2.5K)', { refs: 4 }),
    imageGen('nano_banana_pro_4k', 'Nano Banana Pro (2.5K)', { refs: 4 }),
    imageGen('gpt_image_2_high', 'GPT Image 2 High (4K)', { refs: 5 }),
    imageGen('gpt_image_25', 'GPT Image 2.5 Flare (2K)', { refs: 16, promptMax: 20000 }),
    imageGen('gpt_image_25_sunburst', 'GPT Image 2.5 Sunburst (2K)', { refs: 16, promptMax: 20000 }),
    imageGen('flux_2_pro', 'Flux 2 Pro (2K)', { refs: 6 }),
    imageGen('seedream_50_lite', 'Seedream 5.0 Lite (3K)', { refs: 4 }),
    imageGen('seedream_50_pro', 'Seedream 5.0 Pro (3K)', { refs: 4 }),
    imageGen('seedream_45', 'Seedream 4.5 (4K)', { refs: 3 }),
    imageGen('seedream_5_fast_2k', 'Seedream 5 Fast 2K', { refs: 4 }),
    imageGen('seedream_5_pro_2k', 'Seedream 5 Pro 2K', { refs: 10, promptMax: 3000 }),
  ]),

  // ── Image edit ──
  face_swap: {
    id: 'face_swap',
    label: 'Face Swap (HD)',
    category: 'image_edit',
    price: 350,
    promptMax: 2500,
    promptRequired: false,
    imageMode: 'single',
    imageMin: 1,
    imageMax: 1,
    videoMode: 'none',
    swap: true,
    aspects: [],
    modes: ['face_swap'],
  },
  upscale_4k: {
    id: 'upscale_4k',
    label: 'Upscale 4K',
    category: 'image_edit',
    price: 350,
    promptMax: 2000,
    promptRequired: false,
    imageMode: 'single',
    imageMin: 1,
    imageMax: 1,
    videoMode: 'none',
    aspects: [],
    modes: ['upscale'],
  },

  // ── Video generation ──
  ...add([
    videoSpec('grok_imagine_2_15s', 'Grok Imagine 2 · 15 dtk', {
      price: 2500, promptMax: 5000, promptRequired: true, image: 'optional',
      aspects: VIDEO_ASPECTS, durations: [15], modes: ['t2v', 'i2v'],
    }),
    videoSpec('grok_imagine_2_30s', 'Grok Imagine 2 · 30 dtk', {
      price: 4000, promptMax: 5000, promptRequired: true, image: 'optional',
      aspects: VIDEO_ASPECTS, durations: [30], modes: ['t2v', 'i2v'],
    }),
    videoSpec('grok_imagine_15_video_720p', 'Grok Imagine 1.5 · 15 dtk', {
      price: 1500, promptMax: 2500, image: 'required', aspects: VIDEO_ASPECTS, durations: [15],
      modes: ['i2v'],
    }),
    videoSpec('betagrok_15s', 'BetaGrok 1.5 1080p · 15 dtk', {
      price: 1000, promptMax: 2500, image: 'required', images: 4, aspects: VIDEO_ASPECTS, durations: [15],
      modes: ['i2v'],
    }),
    videoSpec('s2_seedance_25_30s', 'Seedance 2.5 · 30 dtk', {
      price: 5000, promptMax: 8000, promptRequired: true, image: 'optional', images: 2,
      aspects: VIDEO_ASPECTS, durations: [30], modes: ['t2v', 'i2v', 'f2f'], sendMode: true, promptMin: 3,
    }),
    videoSpec('seedance_25_30s_strict', 'Seedance 2.5 Lite · 30 dtk', {
      price: 5000, promptMax: 8000, promptRequired: true, image: 'optional', images: 6,
      aspects: VIDEO_ASPECTS, durations: [30], modes: ['t2v', 'i2v'], sendMode: true, promptMin: 3,
    }),
    videoSpec('seedance_20_15s', 'Seedance 2.0 720p · 15 dtk', {
      price: 5000, promptMax: 8000, promptRequired: true, image: 'optional', images: 2,
      aspects: VIDEO_ASPECTS, durations: [15], modes: ['t2v', 'i2v'], sendMode: true, promptMin: 3,
    }),
    videoSpec('seedance_20_mini', 'Seedance 2.0 Mini · 15 dtk', {
      price: 2500, promptMax: 8000, image: 'required', durations: [15], modes: ['i2v'],
    }),
    videoSpec('wan_30_hd', 'Wan 3.0 HD · 15 dtk', {
      price: 3000, promptMax: 10000, image: 'required', durations: [15], modes: ['i2v'],
    }),
    videoSpec('wan_remix_720p', 'Wan Remix 720p · 10 dtk', {
      price: 1000, promptMax: 2500, image: 'required', durations: [10], modes: ['i2v'],
    }),
    videoSpec('minimax_h3', 'MiniMax H3 1080p · 15 dtk', {
      price: 2000, promptMax: 5000, image: 'required', aspects: VIDEO_ASPECTS, durations: [15], modes: ['i2v'],
    }),
    videoSpec('minimax_h3_720p', 'MiniMax H3 720p · 15 dtk', {
      price: 1500, promptMax: 5000, image: 'required', durations: [15], modes: ['i2v'],
    }),
    videoSpec('kling_25_turbo', 'Kling 2.5 Turbo 720p · 10 dtk', {
      price: 2500, promptMax: 2500, image: 'required', durations: [10], modes: ['i2v'],
    }),
    videoSpec('kling_26_pro_1080p', 'Kling 2.6 Pro 1080p · 10 dtk', {
      price: 3000, promptMax: 2500, image: 'required', durations: [10], modes: ['i2v'],
    }),
    videoSpec('kling_30_turbo', 'Kling 3.0 Turbo · 15 dtk', {
      price: 3000, promptMax: 2500, image: 'required', durations: [15], modes: ['i2v'],
    }),
    videoSpec('omni_flash_t2v', 'Omni Flash 720p T2V · 10 dtk', {
      price: 1000, promptMax: 2500, promptRequired: true, image: 'none', aspects: VIDEO_ASPECTS, durations: [10],
      modes: ['t2v'],
    }),
    videoSpec('omni_flash_sfv', 'Omni Flash 720p SFV · 10 dtk', {
      price: 1000, promptMax: 2500, promptRequired: true, image: 'required', aspects: VIDEO_ASPECTS, durations: [10],
      modes: ['sfv'],
    }),
    videoSpec('omni_flash_i2v', 'Omni Flash 720p I2V · 10 dtk', {
      price: 1000, promptMax: 2500, promptRequired: true, image: 'required', aspects: VIDEO_ASPECTS, durations: [10],
      modes: ['i2v'],
    }),
    videoSpec('omni_flash_r2v', 'Omni Flash 720p R2V · 10 dtk', {
      price: 1000, promptMax: 2500, promptRequired: true, image: 'required', video: true,
      aspects: VIDEO_ASPECTS, durations: [10], modes: ['r2v', 'v2v'],
    }),
    videoSpec('omni_flash_11_720p', 'Omni Flash 1.1 720p · 10 dtk', {
      price: 1000, promptMax: 2500, promptRequired: true, image: 'optional', images: 3,
      video: true, videoOptional: true, aspects: ['16:9', '9:16'], durations: [10],
      modes: ['t2v', 'sfv', 'i2v', 'r2v'], sendMode: true,
    }),
    videoSpec('omni_flash_12_1080p', 'Omni Flash 1.2 1080p · 15 dtk', {
      price: 1000, promptMax: 2500, promptRequired: true, image: 'optional', images: 3,
      video: true, videoOptional: true, aspects: ['16:9', '9:16'], durations: [15],
      modes: ['t2v', 'sfv', 'i2v', 'r2v'], sendMode: true,
    }),
    videoSpec('watermark_remover', 'Remove Watermark', {
      price: 1000, promptMax: 2500, image: 'none', video: true, modes: ['v2v'],
    }),
  ]),

  // ── LipSync ──
  minimax_lipsync: {
    id: 'minimax_lipsync',
    label: 'MiniMax H3 LipSync · 30 dtk',
    category: 'lipsync',
    price: 1000,
    promptMax: 0,
    promptRequired: false,
    imageMode: 'single',
    imageMin: 1,
    imageMax: 1,
    videoMode: 'none',
    audio: true,
    aspects: [],
    modes: ['lipsync'],
  },
  ltx_lipsync: {
    id: 'ltx_lipsync',
    label: 'LTX 2.5 LipSync 1080p · 30 dtk',
    category: 'lipsync',
    price: 2000,
    promptMax: 0,
    promptRequired: false,
    imageMode: 'single',
    imageMin: 1,
    imageMax: 1,
    videoMode: 'none',
    audio: true,
    aspects: [],
    modes: ['lipsync'],
  },

  // ── Motion control ──
  ...add([
    motionSpec('betamotion_hd', 'BetaMotion HD · 30 dtk', 1000),
    motionSpec('betamotion_1080p', 'BetaMotion 1080p · 30 dtk', 1500),
    motionSpec('betamotion_1080p_pro', 'BetaMotion 1080p Pro 60fps', 2000),
    motionSpec('betamotion_1080p_max', 'BetaMotion 1080p Max', 2500),
    motionSpec('motion_control_std', 'Kling 2.6 Std MC · 30 dtk', 1000),
    motionSpec('motion_control_pro', 'Kling 2.6 Pro MC · 30 dtk', 2500),
    motionSpec('kling_30_std', 'Kling 3.0 MC Std', 2000, true),
    motionSpec('kling_30_pro', 'Kling 3.0 MC Pro', 3000, true),
  ]),

  // ── Video upscale ──
  upscale_2k_60fps: {
    id: 'upscale_2k_60fps',
    label: 'Upscale 2K 60FPS',
    category: 'upscale',
    price: 1000,
    promptMax: 2500,
    promptRequired: false,
    imageMode: 'none',
    imageMax: 0,
    videoMode: 'single',
    aspects: [],
    modes: ['v2v'],
  },

  // ── Reference-to-video ──
  // Video acuan (video_url) + foto karakter (image_url + image_urls); hasilnya
  // mentransfer gerakan video ke subjek foto — R2V sekaligus V2V.
  ...add([
    r2vSpec('seedance_25_30s_r2v', 'Seedance 2.5 R2V Pro · 30 dtk', 6500, {
      promptMax: 8000, promptRequired: true, images: 9, durations: [30],
      // Dokumen §5: hanya prompt yang wajib; video & foto acuan opsional.
      imageMin: 0, videoOptional: true, aspects: VIDEO_ASPECTS,
      modes: ['t2v', 'i2v', 'r2v'],
    }),
    r2vSpec('seedance_20_mini_r2v', 'Seedance 2.0 Mini R2V · 15 dtk', 3000, {
      promptMax: 8000, promptRequired: false, images: 7, durations: [15],
    }),
    r2vSpec('kling_30_omni_r2v', 'Kling 3.0 Omni R2V · 15 dtk', 3500, {
      promptMax: 2500, promptRequired: false, images: 5, durations: [15],
    }),
    r2vSpec('wan_30_r2v', 'Wan 3.0 R2V HD · 15 dtk', 3000, {
      promptMax: 10000, promptRequired: false, images: 10, durations: [15],
    }),
    r2vSpec('minimax_h3_r2v', 'MiniMax H3 R2V HD · 15 dtk', 2500, {
      promptMax: 5000, promptRequired: false, images: 10, durations: [15],
    }),
  ]),

  // ── Audio, TTS & music ──
  ...add([
    ttsSpec('google_tts', 'Google TTS'),
    musicSpec('suno_v6', 'Suno v6 Studio'),
    musicSpec('suno_v6_wild', 'Suno v6 Wild'),
    musicSpec('suno_v6_mini', 'Suno v6 Mini'),
    musicSpec('lyria_35', 'Google Lyria 3.5', 500, false),
    musicSpec('minimax_music_3', 'MiniMax Music 3', 500, false),
    musicSpec('mureka_95', 'Mureka V9.5'),
    musicSpec('sonauto_3', 'Sonauto V3', 400),
    musicSpec('acestep_15', 'ACE STEP V1.5', 400, false),
  ]),
}

export function getPosbotSpec(id: string): PosbotModelSpec | undefined {
  return POSBOT_MODELS[id]
}

export function listPosbotModelIds(): string[] {
  return Object.keys(POSBOT_MODELS)
}

export function posbotModelsByCategory(...categories: PosbotCategory[]): PosbotModelSpec[] {
  return Object.values(POSBOT_MODELS).filter((m) => categories.includes(m.category))
}

export function formatPosbotRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString('id-ID')}`
}

/** Buang prefix "Bearer " yang mungkin ikut tersalin dari dokumentasi. */
export function normalizePosbotKey(raw: string): string {
  return String(raw || '').trim().replace(/^bearer\s+/i, '').trim()
}

export function isValidPosbotKey(raw: string): boolean {
  const key = normalizePosbotKey(raw)
  return /^pb_[A-Za-z0-9_-]{8,}$/.test(key)
}

export interface PosbotPayloadInput {
  prompt?: string
  imageUrl?: string
  imageUrls?: string[]
  videoUrl?: string
  audioUrl?: string
  swapImage?: string
  aspectRatio?: string
  duration?: number
  mode?: string
  lyrics?: string
  instrumental?: boolean
  negativePrompt?: string
  voice?: string
}

/**
 * Susun body POST /generate dan validasi ketat per model.
 * Dipanggil SEBELUM submit supaya kesalahan input tidak memotong saldo.
 */
export function buildPosbotPayload(spec: PosbotModelSpec, media: PosbotPayloadInput): Record<string, unknown> {
  const prompt = (media.prompt || '').trim()
  const images: string[] = []
  for (const url of [media.imageUrl, ...(media.imageUrls || [])]) {
    const v = String(url || '').trim()
    if (v && !images.includes(v)) images.push(v)
  }
  const video = String(media.videoUrl || '').trim()
  const audio = String(media.audioUrl || '').trim()
  const swap = String(media.swapImage || '').trim()

  // gambar
  if (spec.imageMode === 'single') {
    if (images.length !== 1) throw new Error(`${spec.label} membutuhkan tepat 1 gambar (diterima: ${images.length})`)
  } else if (spec.imageMode === 'multi') {
    const min = spec.imageMin ?? 0
    const max = spec.imageMax ?? 1
    if (images.length < min || images.length > max) {
      throw new Error(`${spec.label} menerima ${min}-${max} gambar (diterima: ${images.length})`)
    }
  } else if (images.length > 0) {
    throw new Error(`${spec.label} tidak menerima gambar`)
  }

  // video
  if (spec.videoMode === 'single') {
    if (!spec.videoOptional && !video) throw new Error(`${spec.label} membutuhkan 1 video referensi`)
  } else if (video) {
    throw new Error(`${spec.label} tidak menerima video referensi`)
  }

  // audio & swap
  if (spec.audio && !audio) throw new Error(`${spec.label} membutuhkan file audio`)
  if (!spec.audio && audio) throw new Error(`${spec.label} tidak menerima audio`)
  if (spec.swap && !swap) throw new Error(`${spec.label} membutuhkan gambar wajah sumber (swap)`)
  if (!spec.swap && swap) throw new Error(`${spec.label} tidak menerima parameter swap`)

  // prompt
  if (spec.promptRequired && !prompt) throw new Error('Prompt wajib diisi')
  if (prompt && spec.promptMin && prompt.length < spec.promptMin) {
    throw new Error(`Prompt minimal ${spec.promptMin} karakter`)
  }
  if (prompt && spec.promptMax && prompt.length > spec.promptMax) {
    throw new Error(`Prompt maksimal ${spec.promptMax} karakter (saat ini: ${prompt.length})`)
  }

  // Mode kondisional: Seedance 2.0/2.5 & Omni Flash 1.1/1.2 memilih
  // t2v/sfv/i2v/f2f/r2v. Model lain tetap divalidasi walau `mode` tidak dikirim.
  const mode = String(media.mode || '').trim().toLowerCase() as PosbotMode | ''
  if (mode && spec.modes && spec.modes.length > 0) {
    if (!spec.modes.includes(mode)) throw new Error(`Mode ${mode} tidak dikenal untuk ${spec.label}`)
    if (mode === 't2v') {
      if (images.length > 0) throw new Error('Mode t2v tidak menerima gambar')
      if (video) throw new Error('Mode t2v tidak menerima video')
    }
    if (mode === 'sfv') {
      if (images.length !== 1) throw new Error('Mode sfv membutuhkan tepat 1 gambar')
      if (video) throw new Error('Mode sfv tidak menerima video')
    }
    if (mode === 'i2v') {
      if (images.length < 1) throw new Error('Mode i2v membutuhkan minimal 1 gambar')
      if (video) throw new Error('Mode i2v tidak menerima video')
    }
    if (mode === 'f2f') {
      if (images.length < 1) throw new Error('Mode f2f membutuhkan 1-2 gambar (frame awal & akhir)')
      if (video) throw new Error('Mode f2f tidak menerima video')
    }
    if (mode === 'r2v') {
      if (!video) throw new Error('Mode r2v membutuhkan video referensi')
      // Omni Flash r2v: 1 video gerakan + opsional 1 gambar pendamping.
      if (spec.category === 'video' && images.length > 1) {
        throw new Error('Mode r2v menerima maksimal 1 gambar pendamping')
      }
    }
    if (mode === 'v2v' && !video) throw new Error('Mode v2v membutuhkan video referensi')
  }

  const body: Record<string, unknown> = { model: spec.id, notify_telegram: false }
  if (prompt) body.prompt = prompt
  if (images.length > 0) {
    body.image_url = images[0]
    if (images.length > 1) body.image_urls = images
  }
  if (video) body.video_url = video
  if (audio) body.audio_url = audio
  if (swap) body.swap_image = swap
  if (media.aspectRatio && spec.aspects && spec.aspects.includes(media.aspectRatio)) {
    body.aspect_ratio = media.aspectRatio
  }
  // Hanya model yang memang menerima parameter `mode` upstream (lihat
  // PosbotModelSpec.sendMode); model lain cukup memakai mode untuk validasi.
  if (mode && spec.sendMode && spec.modes?.includes(mode)) body.mode = mode
  if (spec.sendDuration && media.duration && spec.durations?.includes(media.duration)) {
    body.duration = media.duration
  }
  if (spec.lyrics && media.lyrics) body.lyrics = media.lyrics
  if (spec.lyrics && typeof media.instrumental === 'boolean') body.instrumental = media.instrumental
  if (media.negativePrompt) body.negative_prompt = media.negativePrompt
  if (spec.category === 'tts' && media.voice) body.voice = media.voice

  return body
}

export interface PosbotBalance {
  ok: boolean
  balance?: number
  userId?: number
  currency?: string
  error?: string
}

/** GET /balance — saldo_generate dalam Rupiah. */
export async function fetchPosbotBalance(apiKey: string): Promise<PosbotBalance> {
  try {
    const res = await fetch(`${POSBOT_PROXY}?path=balance`, { headers: relayAuthHeaders(apiKey) })
    const text = await res.text()
    let data: any
    try { data = JSON.parse(text) } catch { data = null }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: data?.error || data?.message || `HTTP ${res.status}` }
    }
    if (!res.ok || !data || data.success === false) {
      return { ok: false, error: data?.error || data?.message || `HTTP ${res.status}` }
    }
    const balance = Number(data.saldo_generate)
    return {
      ok: true,
      balance: Number.isFinite(balance) ? balance : undefined,
      userId: data.user_id,
      currency: data.currency || 'IDR',
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Gagal cek saldo PosBot' }
  }
}

export interface PosbotModelStatus {
  model_key: string
  name: string
  status: string
  price: number
  reason?: string | null
  updated_at?: string
}

export interface PosbotModelsStatusResult {
  ok: boolean
  models?: PosbotModelStatus[]
  byKey?: Record<string, PosbotModelStatus>
  error?: string
}

/** GET /models/status — status operasional live tiap model. */
export async function fetchPosbotModelsStatus(apiKey: string): Promise<PosbotModelsStatusResult> {
  try {
    const res = await fetch(`${POSBOT_PROXY}?path=models/status`, { headers: relayAuthHeaders(apiKey) })
    const text = await res.text()
    let data: any
    try { data = JSON.parse(text) } catch { data = null }
    if (!res.ok || !data || data.success === false) {
      return { ok: false, error: data?.error || data?.message || `HTTP ${res.status}` }
    }
    const models: PosbotModelStatus[] = Array.isArray(data.models) ? data.models : []
    const byKey: Record<string, PosbotModelStatus> = {}
    for (const m of models) if (m?.model_key) byKey[m.model_key] = m
    return { ok: true, models, byKey }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Gagal ambil status model PosBot' }
  }
}

/** POST /generate → job_code. Saldo dipotong di sini (HTTP 200). */
export async function submitPosbotGeneration(
  apiKey: string,
  payload: Record<string, unknown>,
  chargeId?: number | null,
): Promise<string> {
  const res = await fetch(`${POSBOT_PROXY}?path=generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...relayAuthHeaders(apiKey, chargeId) },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = null }
  if (!res.ok || !data || data.success === false) {
    const code = data?.error?.code || data?.code || ''
    const msg = data?.error?.message || data?.error || data?.message || text.slice(0, 200) || `HTTP ${res.status}`
    throw new Error(`PosBot ${res.status}${code ? ` ${code}` : ''}: ${msg}`)
  }
  const id = data.job_code || data.jobCode || data.job_id || data.id || data.data?.job_code
  if (!id) throw new Error(`PosBot: respons tanpa job_code — ${text.slice(0, 200)}`)
  return String(id)
}

export interface PosbotStatusResult {
  url: string
  model?: string
}

export interface PosbotLogOpts {
  onLog?: (msg: string, level?: string) => void
  onStatus?: (text: string, pct: number) => void
}

/** Poll GET /status/<job_code> sampai completed. Gagal = refund 100% otomatis. */
export async function pollPosbotStatus(apiKey: string, jobCode: string, opts: PosbotLogOpts = {}): Promise<PosbotStatusResult> {
  const { onLog, onStatus } = opts
  const maxPolls = 240 // 5s × 240 = 20 menit (video/MC bisa >3 menit)
  for (let i = 0; i < maxPolls; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 5000))
    const res = await fetch(`${POSBOT_PROXY}?path=status/${encodeURIComponent(jobCode)}`, {
      headers: relayAuthHeaders(apiKey),
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
      const url = j.result_url || j.result?.url
      if (!url) throw new Error('PosBot: job completed tanpa result_url')
      return { url: String(url), model: j.model }
    }
    if (status === 'failed') {
      throw new Error(`PosBot job gagal — saldo direfund otomatis${j.error ? `: ${typeof j.error === 'string' ? j.error : j.error?.message}` : ''}`)
    }
    const pct = Math.max(6, Math.min(97, progress || 5))
    onStatus?.(`Memproses... ${progress}%`, pct)
    if (i % 6 === 5) onLog?.(`⏳ PosBot ${status || 'processing'} (${progress}%)`, 'debug')
  }
  throw new Error('PosBot: timeout menunggu hasil (>20 menit)')
}

export interface PosbotGenerateOptions extends PosbotLogOpts {
  apiKey: string
  spec: PosbotModelSpec
  prompt?: string
  imageUrl?: string
  imageUrls?: string[]
  videoUrl?: string
  audioUrl?: string
  swapImage?: string
  aspectRatio?: string
  duration?: number
  mode?: string
  lyrics?: string
  instrumental?: boolean
  negativePrompt?: string
  voice?: string
  /** usage_id dari /api/posbot/deduct — tiket relay untuk jalur kunci server. */
  chargeId?: number | null
}

/** End-to-end: validasi → submit → poll → URL hasil. */
export async function generateWithPosbot(opts: PosbotGenerateOptions): Promise<string> {
  const { apiKey, spec, onLog, onStatus } = opts
  const payload = buildPosbotPayload(spec, {
    prompt: opts.prompt,
    imageUrl: opts.imageUrl,
    imageUrls: opts.imageUrls,
    videoUrl: opts.videoUrl,
    audioUrl: opts.audioUrl,
    swapImage: opts.swapImage,
    aspectRatio: opts.aspectRatio,
    duration: opts.duration,
    mode: opts.mode,
    lyrics: opts.lyrics,
    instrumental: opts.instrumental,
    negativePrompt: opts.negativePrompt,
    voice: opts.voice,
  })
  onLog?.(`[2/3] 🚀 Submit ${spec.label} (${formatPosbotRupiah(spec.price)})...`, 'info')
  onStatus?.(`Submit ${spec.label}...`, 5)
  const jobCode = await submitPosbotGeneration(apiKey, payload, opts.chargeId)
  onLog?.(`[2/3] ✅ Job dibuat ✓ ${jobCode}`, 'success')
  onLog?.(`[3/3] ⏳ Polling hasil...`, 'info')
  const { url } = await pollPosbotStatus(apiKey, jobCode, { onLog, onStatus })
  onLog?.(`✅ Selesai ✓`, 'success')
  onStatus?.('Done!', 100)
  return url
}
