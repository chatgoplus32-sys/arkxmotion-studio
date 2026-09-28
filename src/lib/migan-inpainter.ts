/**
 * MI-GAN inpainting via ONNX Runtime Web.
 *
 * Model: MI-GAN (Picsart Research, ICCV 2023) — GAN inpainter untuk browser.
 * Input: [1, 4, 512, 512] float32 (mask-0.5, R*mask, G*mask, B*mask)
 * Output: [1, 3, 512, 512] float32 in [-1, 1]
 *
 * Catatan penting soal resolusi: model ini punya bentuk input TETAP 512×512
 * (bukan dynamic shape — sudah diverifikasi lewat probe runtime). Jadi kualitas
 * hasil hanya bisa dijaga dengan dua cara:
 *   1. crop dibiarkan se-NATIVE mungkin (tidak diperbesar-paksa ke 512 lalu
 *      dikecilkan lagi), dan
 *   2. komposit akhir tidak mencampur piksel ber-watermark (lihat inpaint-core).
 *
 * Pipeline per pass:
 * 1. Dilatasi mask (menelan tepi anti-alias watermark)
 * 2. Cari bbox hole → square crop dengan konteks × ukuran mask
 * 3. Skala crop ke 512×512 (satu kali, hanya bila crop > 512)
 * 4. Bangun input MI-GAN 4-channel
 * 5. Run model, map [-1,1] → RGBA
 * 6. Komposit seam-aware: bidang koreksi nada dipelajari dari ring sekitarnya
 */

import * as ort from 'onnxruntime-web'
import { loadModel } from './migan-model-cache'
import {
  autoDilateRadius,
  dilateMask,
  maskBounds,
  removeWithSeamCorrection,
  type Bounds,
  type Raster,
} from './inpaint-core'

const MODEL_SIZE = 512
/** Batas crop supaya satu pass tidak memakan waktu terlalu lama. */
const MAX_CROP = 1280
const READBACK: CanvasRenderingContext2DSettings = { willReadFrequently: true }

const QUALITY_PRESETS: Record<string, { contexts: number[] }> = {
  fast: { contexts: [2.0] },
  standard: { contexts: [3.0] },
  high: { contexts: [3.0, 2.0] },
  best: { contexts: [3.5, 2.5] },
}

let session: ort.InferenceSession | null = null
let activeBackend = 'unknown'

export function getBackend(): string { return activeBackend }
export function isReady(): boolean { return session !== null }
export function getPassCount(quality: string): number {
  return (QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.standard).contexts.length
}

export async function initInpainter(onProgress?: (msg: string) => void): Promise<void> {
  if (session) return

  ort.env.wasm!.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/'
  ort.env.wasm!.numThreads = Math.min(navigator.hardwareConcurrency || 4, 4)
  ort.env.wasm!.simd = true
  // Disable proxy mode — it detaches ArrayBuffer which causes errors with cached models
  ort.env.wasm!.proxy = false
  ;(ort.env as any).logLevel = 'warning'

  onProgress?.('Loading MI-GAN model (~29 MB)…')
  const rawBytes = await loadModel((p) => {
    if (p.stage) onProgress?.(`[${p.stage}] ${p.total > 0 ? `${(p.done / 1024 / 1024).toFixed(1)}/${(p.total / 1024 / 1024).toFixed(1)} MB` : ''}`)
  })

  // Clone the buffer — ORT may detach it, and we need the original to stay intact
  const modelBytes = new Uint8Array(rawBytes)

  const providers = ['wasm'] as const
  for (const ep of providers) {
    try {
      onProgress?.(`Initializing ${ep.toUpperCase()}…`)
      session = await ort.InferenceSession.create(modelBytes, {
        executionProviders: [ep],
        graphOptimizationLevel: 'all',
      })
      activeBackend = ep
      console.log(`[inpainter] Active backend: ${ep}`)
      onProgress?.(`✓ Ready (${ep})`)
      return
    } catch (e) {
      console.info(`[inpainter] ${ep} not available:`, (e as Error)?.message)
    }
  }
  throw new Error('No usable ONNX backend found')
}

export interface InpaintImageOpts {
  quality?: string
  /** Pelebaran mask (px) sebelum proses; default otomatis (~3% sisi mask). */
  dilate?: number
  /** Pelebaran halus di batas tempel (px). Default 0 = tempel keras. */
  feather?: number
  /** Jarak fade koreksi nada dari tepi patch ke dalam (px). */
  fade?: number
  onPass?: (passIndex: number, totalPasses: number) => void
}

/** Build MI-GAN 4-channel float32 input — matches Picsart's preprocess() exactly. */
export function buildMIGANInput(imageData: Raster, maskData: Raster): Float32Array {
  const { width, height, data: img } = imageData
  const maskBytes = maskData.data
  const size = width * height
  const out = new Float32Array(4 * size)
  for (let i = 0; i < size; i++) {
    const isInpaint = maskBytes[i * 4 + 3] > 64
    const mask = isInpaint ? 0.0 : 1.0
    const r = (img[i * 4] / 255) * 2 - 1
    const g = (img[i * 4 + 1] / 255) * 2 - 1
    const b = (img[i * 4 + 2] / 255) * 2 - 1
    out[i] = mask - 0.5
    out[i + size] = r * mask
    out[i + size * 2] = g * mask
    out[i + size * 3] = b * mask
  }
  return out
}

/** Convert MI-GAN [-1,1] float32 CHW output to RGBA ImageData. */
function miganOutputToRGBA(chw: Float32Array, w: number, h: number): ImageData {
  const size = w * h
  const out = new Uint8ClampedArray(size * 4)
  for (let i = 0; i < size; i++) {
    out[i * 4] = Math.max(0, Math.min(1, chw[i] * 0.5 + 0.5)) * 255
    out[i * 4 + 1] = Math.max(0, Math.min(1, chw[i + size] * 0.5 + 0.5)) * 255
    out[i * 4 + 2] = Math.max(0, Math.min(1, chw[i + size * 2] * 0.5 + 0.5)) * 255
    out[i * 4 + 3] = 255
  }
  return new ImageData(out, w, h)
}

/** Kompatibilitas: bbox mask (delegasi ke inpaint-core). */
export function findMaskBbox(maskData: Raster, threshold = 16): Bounds | null {
  return maskBounds(maskData, threshold)
}

function cropImageData(src: ImageData, x: number, y: number, w: number, h: number): ImageData {
  const cn = new OffscreenCanvas(w, h)
  const ctx = cn.getContext('2d', READBACK)!
  const srcCn = new OffscreenCanvas(src.width, src.height)
  srcCn.getContext('2d', READBACK)!.putImageData(src, 0, 0)
  ctx.drawImage(srcCn, x, y, w, h, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

function resizeImageData(imageData: ImageData, w: number, h: number): ImageData {
  const src = new OffscreenCanvas(imageData.width, imageData.height)
  src.getContext('2d', READBACK)!.putImageData(imageData, 0, 0)
  const dst = new OffscreenCanvas(w, h)
  const ctx = dst.getContext('2d', READBACK)!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/**
 * Ukuran crop persegi untuk satu pass. Prioritas: pastikan crop ≥ 512 supaya
 * crop bisa diumpankan 1:1 ke model (tanpa resampling), lalu tumbuh mengikuti
 * kebutuhan konteks. Dibatasi MAX_CROP agar biaya inference tetap wajar.
 */
function pickCropSize(maskDim: number, context: number, W: number, H: number): number {
  const needed = Math.round(maskDim * context)
  const limit = Math.min(W, H, MAX_CROP)
  const size = Math.max(MODEL_SIZE, Math.min(needed, limit))
  // bulatkan ke kelipatan 8 (aman untuk conv padding) dan jangan melewati limit
  const rounded = Math.round(size / 8) * 8
  return Math.max(8, Math.min(rounded, limit))
}

async function runPass(
  imageData: ImageData,
  holeMask: ImageData,
  bbox: Bounds,
  context: number,
  feather: number,
  fade: number | undefined,
): Promise<ImageData> {
  if (!session) throw new Error('Inpainter not initialized')
  const { width: W, height: H } = imageData
  const maskDim = Math.max(bbox.w, bbox.h)
  const cropSize = pickCropSize(maskDim, context, W, H)

  const centerX = bbox.x + bbox.w / 2
  const centerY = bbox.y + bbox.h / 2
  const cropX = Math.max(0, Math.min(W - cropSize, Math.round(centerX - cropSize / 2)))
  const cropY = Math.max(0, Math.min(H - cropSize, Math.round(centerY - cropSize / 2)))

  const cropImage = cropImageData(imageData, cropX, cropY, cropSize, cropSize)
  const cropMask = cropImageData(holeMask, cropX, cropY, cropSize, cropSize)

  // 1:1 bila crop sudah 512 — tidak ada downscale/upscale yang membuang detail.
  const inferImage = cropSize === MODEL_SIZE ? cropImage : resizeImageData(cropImage, MODEL_SIZE, MODEL_SIZE)
  const inferMask = cropSize === MODEL_SIZE ? cropMask : resizeImageData(cropMask, MODEL_SIZE, MODEL_SIZE)

  const inputNames = Array.from(session.inputNames || [])
  const feeds: Record<string, ort.Tensor> = {}
  feeds[inputNames[0]] = new ort.Tensor(
    'float32',
    buildMIGANInput(inferImage, inferMask),
    [1, 4, MODEL_SIZE, MODEL_SIZE],
  )

  const output = await session.run(feeds)
  const outTensor = output[Object.keys(output)[0]]
  const dims = outTensor.dims
  const outH = dims[2] || MODEL_SIZE
  const outW = dims[3] || MODEL_SIZE

  const inferResult = miganOutputToRGBA(outTensor.data as unknown as Float32Array, outW, outH)
  const cropResult = (outW === cropSize && outH === cropSize)
    ? inferResult
    : resizeImageData(inferResult, cropSize, cropSize)

  // Komposit seam-aware di ruang crop, lalu tempel kembali ke gambar penuh.
  const composited = removeWithSeamCorrection(cropImage, cropResult, cropMask, { dilate: 0, feather, fade })

  const out = new ImageData(new Uint8ClampedArray(imageData.data), W, H)
  for (let y = 0; y < cropSize; y++) {
    const dy = cropY + y
    if (dy < 0 || dy >= H) continue
    let si = (y * cropSize) * 4
    let di = (dy * W + cropX) * 4
    out.data.set(composited.subarray(si, si + cropSize * 4), di)
  }
  return out
}

/**
 * Inpaint area bermask pada sebuah gambar.
 *
 * @param maskData dimensi sama dengan gambar; alpha > 64 = piksel yang dibuang
 * @returns ImageData baru (input tidak diubah)
 */
export async function inpaint(
  imageData: ImageData,
  maskData: ImageData,
  opts: InpaintImageOpts = {},
): Promise<ImageData> {
  if (!session) throw new Error('Inpainter not initialized — call initInpainter() first')
  if (imageData.width !== maskData.width || imageData.height !== maskData.height) {
    throw new Error('Image and mask dimensions must match')
  }

  const preset = QUALITY_PRESETS[opts.quality ?? 'standard'] ?? QUALITY_PRESETS.standard

  // Mask dilebarkan sekali di sini: menelan tepi anti-alias watermark sehingga
  // tidak ada piksel ber-watermark yang tersisa untuk "bocor" ke hasil akhir.
  const dilate = opts.dilate ?? autoDilateRadius(maskData)
  const dilated = dilateMask(maskData, dilate) as unknown as ImageData
  const holeMask = new ImageData(new Uint8ClampedArray(dilated.data), dilated.width, dilated.height)

  const feather = opts.feather ?? 0
  const bbox = maskBounds(holeMask)
  if (!bbox) return imageData

  let current = imageData
  for (let i = 0; i < preset.contexts.length; i++) {
    opts.onPass?.(i, preset.contexts.length)
    current = await runPass(current, holeMask, bbox, preset.contexts[i], feather, opts.fade)
  }
  return current
}
