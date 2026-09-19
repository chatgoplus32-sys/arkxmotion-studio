/**
 * MI-GAN inpainting via ONNX Runtime Web.
 *
 * Model: MI-GAN (Picsart Research, ICCV 2023) — GAN inpainter for browser.
 * Input: [1, 4, 512, 512] float32 (mask-0.5, R*mask, G*mask, B*mask)
 * Output: [1, 3, 512, 512] float32 in [-1, 1]
 *
 * Pipeline per pass:
 * 1. Find mask bbox
 * 2. Square-crop around mask with context × mask size
 * 3. Resize to 512×512
 * 4. Build MI-GAN 4-channel input
 * 5. Run model, map [-1,1] → RGBA
 * 6. Composite back with feathered mask
 */

import * as ort from 'onnxruntime-web'
import { loadModel } from './migan-model-cache'

const MODEL_SIZE = 512
const READBACK: CanvasRenderingContext2DSettings = { willReadFrequently: true }

const QUALITY_PRESETS: Record<string, { contexts: number[]; feather: number }> = {
  standard: { contexts: [3.0], feather: 6 },
  high: { contexts: [3.0, 2.0], feather: 8 },
  fast: { contexts: [3.0], feather: 4 },
  best: { contexts: [3.0, 2.0], feather: 8 },
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
  featherRadius?: number
  onPass?: (passIndex: number, totalPasses: number) => void
}

/** Build MI-GAN 4-channel float32 input — matches Picsart's preprocess() exactly. */
export function buildMIGANInput(imageData: ImageData, maskData: ImageData): Float32Array {
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
function miganOutputToRGBA(chw: Float32Array, w: number, h: number): Uint8ClampedArray {
  const size = w * h
  const out = new Uint8ClampedArray(size * 4)
  for (let i = 0; i < size; i++) {
    out[i * 4] = Math.max(0, Math.min(1, chw[i] * 0.5 + 0.5)) * 255
    out[i * 4 + 1] = Math.max(0, Math.min(1, chw[i + size] * 0.5 + 0.5)) * 255
    out[i * 4 + 2] = Math.max(0, Math.min(1, chw[i + size * 2] * 0.5 + 0.5)) * 255
    out[i * 4 + 3] = 255
  }
  return out
}

export function findMaskBbox(maskData: ImageData): { x: number; y: number; w: number; h: number } | null {
  const { width, height, data } = maskData
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

async function cropImageData(src: ImageData, x: number, y: number, w: number, h: number): Promise<ImageData> {
  const cn = new OffscreenCanvas(w, h)
  const ctx = cn.getContext('2d', READBACK)!
  const srcCn = new OffscreenCanvas(src.width, src.height)
  srcCn.getContext('2d', READBACK)!.putImageData(src, 0, 0)
  ctx.drawImage(srcCn, x, y, w, h, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

async function resizeImageData(imageData: ImageData, w: number, h: number, mode = 'bilinear'): Promise<ImageData> {
  const src = new OffscreenCanvas(imageData.width, imageData.height)
  src.getContext('2d', READBACK)!.putImageData(imageData, 0, 0)
  const dst = new OffscreenCanvas(w, h)
  const ctx = dst.getContext('2d', READBACK)!
  ctx.imageSmoothingEnabled = mode === 'bilinear'
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

function pasteCropWithMask(
  original: ImageData,
  inpaintedCrop: ImageData,
  cropMask: ImageData,
  offsetX: number,
  offsetY: number,
  featherRadius: number,
): ImageData {
  const W = original.width, H = original.height
  const cw = inpaintedCrop.width, ch = inpaintedCrop.height
  const THRESHOLD = 64

  // Binarize mask
  const binary = new ImageData(cw, ch)
  for (let i = 0; i < cw * ch; i++) {
    const a = cropMask.data[i * 4 + 3] > THRESHOLD ? 255 : 0
    binary.data[i * 4] = a
    binary.data[i * 4 + 1] = a
    binary.data[i * 4 + 2] = a
    binary.data[i * 4 + 3] = a
  }

  // Feather via canvas blur
  const maskCv = new OffscreenCanvas(cw, ch)
  maskCv.getContext('2d', READBACK)!.putImageData(binary, 0, 0)
  const featherCv = new OffscreenCanvas(cw, ch)
  const fctx = featherCv.getContext('2d', READBACK)!
  fctx.filter = `blur(${featherRadius}px)`
  fctx.drawImage(maskCv, 0, 0)
  fctx.filter = 'none'
  const feather = fctx.getImageData(0, 0, cw, ch)

  // Composite
  const out = new Uint8ClampedArray(original.data)
  for (let y = 0; y < ch; y++) {
    const oy = offsetY + y
    if (oy < 0 || oy >= H) continue
    for (let x = 0; x < cw; x++) {
      const ox = offsetX + x
      if (ox < 0 || ox >= W) continue
      const a = feather.data[(y * cw + x) * 4 + 3] / 255
      if (a <= 0) continue
      const dst = (oy * W + ox) * 4
      const src = (y * cw + x) * 4
      out[dst] = inpaintedCrop.data[src] * a + out[dst] * (1 - a)
      out[dst + 1] = inpaintedCrop.data[src + 1] * a + out[dst + 1] * (1 - a)
      out[dst + 2] = inpaintedCrop.data[src + 2] * a + out[dst + 2] * (1 - a)
      out[dst + 3] = 255
    }
  }
  return new ImageData(out, W, H)
}

async function runPass(
  imageData: ImageData,
  maskData: ImageData,
  bbox: { x: number; y: number; w: number; h: number },
  opts: { context: number; featherRadius: number; passLabel: string },
): Promise<ImageData> {
  if (!session) throw new Error('Inpainter not initialized')
  const { width: W, height: H } = imageData
  const maskDim = Math.max(bbox.w, bbox.h)
  const needed = Math.round(maskDim * opts.context)
  const cropSize = Math.min(Math.max(MODEL_SIZE, needed), W, H)
  const centerX = bbox.x + bbox.w / 2
  const centerY = bbox.y + bbox.h / 2
  let cropX = Math.round(centerX - cropSize / 2)
  let cropY = Math.round(centerY - cropSize / 2)
  cropX = Math.max(0, Math.min(W - cropSize, cropX))
  cropY = Math.max(0, Math.min(H - cropSize, cropY))

  const cropImage = await cropImageData(imageData, cropX, cropY, cropSize, cropSize)
  const cropMask = await cropImageData(maskData, cropX, cropY, cropSize, cropSize)
  const inferImage = await resizeImageData(cropImage, MODEL_SIZE, MODEL_SIZE)
  const inferMask = await resizeImageData(cropMask, MODEL_SIZE, MODEL_SIZE)

  const inputNames = Array.from(session.inputNames || [])
  const feeds: Record<string, ort.Tensor> = {}
  feeds[inputNames[0]] = new ort.Tensor(
    'float32',
    buildMIGANInput(inferImage, inferMask),
    [1, 4, MODEL_SIZE, MODEL_SIZE],
  )

  const output = await session.run(feeds)
  const outName = Object.keys(output)[0]
  const outTensor = output[outName]
  const outDims = outTensor.dims
  const outH = outDims[2] || MODEL_SIZE
  const outW = outDims[3] || MODEL_SIZE

  const inferResult = new ImageData(miganOutputToRGBA(outTensor.data as unknown as Float32Array, outW, outH) as any, outW, outH)

  const cropResult = (outW === cropSize && outH === cropSize)
    ? inferResult
    : await resizeImageData(inferResult, cropSize, cropSize)

  return pasteCropWithMask(imageData, cropResult, cropMask, cropX, cropY, opts.featherRadius)
}

/**
 * Inpaint the masked region of an image.
 * @param imageData source image
 * @param maskData same dimensions; alpha > 64 = pixels to remove
 * @returns new ImageData (input not mutated)
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
  const featherRadius = opts.featherRadius ?? preset.feather

  const bbox = findMaskBbox(maskData)
  if (!bbox) return imageData

  let current = imageData
  for (let i = 0; i < preset.contexts.length; i++) {
    opts.onPass?.(i, preset.contexts.length)
    current = await runPass(current, maskData, bbox, {
      context: preset.contexts[i],
      featherRadius,
      passLabel: `${i + 1}/${preset.contexts.length}`,
    })
  }
  return current
}
