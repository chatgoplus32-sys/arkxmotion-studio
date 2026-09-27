/**
 * Gemini/Veo watermark removal — exact math via @pilio/gemini-watermark-remover.
 *
 * Uses Reverse Alpha Blending: the Gemini watermark is a known logo rendered
 * with a known alpha map at a known position (bottom-right). The engine
 * mathematically inverts the blend instead of hallucinating pixels like
 * inpainting does, so results are lossless on supported outputs.
 *
 * No ONNX / WASM runtime needed — pure JS, works in any modern browser.
 */

import {
  removeWatermarkFromImageDataSync,
  detectWatermarkConfig,
  calculateWatermarkPosition,
  WatermarkEngine,
} from '@pilio/gemini-watermark-remover'

export interface GeminiRemovalMeta {
  applied: boolean
  skipReason: string | null
  size: number | null
  position: { x: number; y: number; width: number; height: number } | null
  passCount: number
}

export interface GeminiRemovalResult {
  imageData: ImageData
  meta: GeminiRemovalMeta
}

/**
 * Geometry + alpha map hasil deteksi frame pertama — dipakai untuk memproses
 * SEMUA frame berikutnya tanpa menjalankan deteksi ulang (murah, realtime).
 */
export interface GeminiFramePlan {
  position: { x: number; y: number; width: number; height: number }
  alphaMap: Float32Array
  alphaGain: number
}

// Konstanta identik dengan blendModes.js di engine — Reverse Alpha Blending:
// original = (watermarked - alpha * logo) / (1 - alpha)
const ALPHA_NOISE_FLOOR = 3 / 255
const ALPHA_THRESHOLD = 0.002
const MAX_ALPHA = 0.99

/**
 * Terapkan reverse-alpha-blend HANYA pada satu region (crop frame).
 * In-place, tanpa clone — aman dipanggil tiap frame saat playback.
 */
export function applyReverseAlphaToRegion(
  region: ImageData,
  alphaMap: Float32Array,
  alphaGain = 1,
): void {
  const { width, height, data } = region
  if (alphaMap.length !== width * height) return
  for (let i = 0; i < alphaMap.length; i++) {
    const rawAlpha = alphaMap[i]
    const magnitude = Math.abs(rawAlpha)
    const logoValue = rawAlpha < 0 ? 0 : 255
    const signalAlpha = Math.max(0, magnitude - ALPHA_NOISE_FLOOR) * alphaGain
    if (signalAlpha < ALPHA_THRESHOLD) continue
    const alpha = Math.min(magnitude * alphaGain, MAX_ALPHA)
    const oneMinusAlpha = 1 - alpha
    const px = i * 4
    for (let c = 0; c < 3; c++) {
      const original = (data[px + c] - alpha * logoValue) / oneMinusAlpha
      data[px + c] = Math.max(0, Math.min(255, Math.round(original)))
    }
  }
}

/**
 * Frame processor untuk pipeline video: bersihkan region watermark di SETIAP
 * frame (crop → reverse-alpha → tulis balik). Tidak ada patch statis, jadi
 * tidak ada bekas blur beku di atas gerakan video.
 */
export function createGeminiFrameProcessor(
  plan: GeminiFramePlan,
): (ctx: CanvasRenderingContext2D) => void {
  const { position, alphaMap, alphaGain } = plan
  return (ctx) => {
    const roi = ctx.getImageData(position.x, position.y, position.width, position.height)
    applyReverseAlphaToRegion(roi, alphaMap, alphaGain)
    ctx.putImageData(roi, position.x, position.y)
  }
}

let enginePromise: Promise<WatermarkEngine> | null = null
function getEngine(): Promise<WatermarkEngine> {
  if (!enginePromise) {
    enginePromise = WatermarkEngine.create().catch((e) => {
      enginePromise = null
      throw e
    })
  }
  return enginePromise
}

/** Resolve alpha map yang benar untuk variant yang terdeteksi (null = tak tersedia). */
async function resolveAlphaMap(
  size: number | null,
  variant: string | undefined,
): Promise<Float32Array | null> {
  if (!size) return null
  // Variant non-standar tidak punya alpha map publik → fallback jalur lama.
  if (variant === 'v2') return null
  // getAlphaMap menerima key string ('96-20260520', dst) di runtime, walau
  // typedef publiknya hanya number — cast dibolehkan di sini.
  const getMap = (key: number | string) =>
    (getEngine() as Promise<{ getAlphaMap(k: number | string): Promise<Float32Array> }>)
      .then((e) => e.getAlphaMap(key))
  if (variant === '20260520' && size === 96) return getMap('96-20260520')
  if (variant === 'outline-light') return getMap('96-outline-light')
  if (variant === 'outline-dark') return getMap('96-outline-dark')
  if (variant && size !== 48 && size !== 96) return null
  if (size !== 48 && size !== 96) return null
  return getMap(size)
}

/**
 * Get the expected watermark region for an image of the given size.
 * Used to auto-apply the mask so the user does not have to draw it.
 */
export function getGeminiWatermarkRegion(
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const config = detectWatermarkConfig(width, height)
  return calculateWatermarkPosition(width, height, config)
}

/**
 * Remove the Gemini/Veo watermark from raw pixel data.
 * Returns the cleaned ImageData plus metadata about what was done.
 * Never throws on "no watermark" — check `meta.applied` instead.
 */
export function removeGeminiWatermark(imageData: ImageData): GeminiRemovalResult {
  const result = removeWatermarkFromImageDataSync(imageData)
  return {
    imageData: result.imageData as ImageData,
    meta: {
      applied: result.meta.applied,
      skipReason: result.meta.skipReason,
      size: result.meta.size,
      position: result.meta.position,
      passCount: result.meta.passCount,
    },
  }
}

/**
 * Deteksi watermark di satu frame → siapkan plan (posisi + alpha map) untuk
 * pemrosesan frame-by-frame. Return null kalau frame ini tidak mengandung
 * watermark Gemini atau variant-nya tak didukung.
 */
export async function createGeminiFramePlan(
  frame: ImageData,
): Promise<GeminiFramePlan | null> {
  const result = removeWatermarkFromImageDataSync(frame)
  const meta = result.meta
  if (!meta.applied || !meta.position || !meta.size) return null

  const variant =
    (meta.config as { alphaVariant?: string } | null)?.alphaVariant
  const alphaMap = await resolveAlphaMap(meta.size, variant)
  if (!alphaMap) return null

  const { x, y, width, height } = meta.position
  if (
    alphaMap.length !== width * height ||
    x < 0 || y < 0 ||
    x + width > frame.width ||
    y + height > frame.height
  ) {
    return null
  }

  const alphaGain =
    Number.isFinite(meta.alphaGain) && meta.alphaGain > 0 ? meta.alphaGain : 1
  return { position: { x, y, width, height }, alphaMap, alphaGain }
}

/**
 * Deteksi watermark Gemini/Veo dari video: coba frame pertama, lalu sampling
 * beberapa titik di tengah video bila frame pertama belum yakin (watermark
 * Gemini memang selalu ada sepanjang video, jadi salah satu sample pasti kena).
 */
export async function detectGeminiInVideo(
  video: HTMLVideoElement,
  firstFrame?: ImageData | null,
  samples = 4,
): Promise<GeminiFramePlan | null> {
  if (firstFrame) {
    const plan = await createGeminiFramePlan(firstFrame)
    if (plan) return plan
  }

  const duration = video.duration
  if (!Number.isFinite(duration) || duration <= 0) return null

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  const originalTime = video.currentTime
  try {
    for (let i = 1; i <= samples; i++) {
      const t = Math.min(duration - 0.1, (duration * i) / (samples + 1))
      await new Promise<void>((resolve) => {
        const onSeek = () => { video.removeEventListener('seeked', onSeek); resolve() }
        video.addEventListener('seeked', onSeek)
        video.currentTime = Math.max(0, t)
      })
      if (video.readyState < 2) {
        await new Promise<void>((r) => {
          const onData = () => { video.removeEventListener('loadeddata', onData); r() }
          video.addEventListener('loadeddata', onData)
        })
      }
      if (!canvas.width || !canvas.height) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
      ctx.drawImage(video, 0, 0)
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const plan = await createGeminiFramePlan(frame)
      if (plan) return plan
    }
  } finally {
    video.currentTime = originalTime
  }
  return null
}
