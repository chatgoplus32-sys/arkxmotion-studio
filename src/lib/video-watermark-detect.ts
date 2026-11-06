/**
 * Deteksi watermark video Gemini/Veo berbasis bukti multi-frame.
 *
 * Port dari @pilio/gemini-watermark-remover (MIT):
 *   src/video/videoWatermarkDetector.js
 *   src/core/adaptiveDetector.js (korelasi spasial/gradien)
 *
 * Kenapa bukan sekadar "cari kotak di sudut kanan bawah":
 *  - Satu frame bisa menipu (objek terang, subtitle, noise). Deteksi di sini
 *    memberi suara pada 12 frame lalu menilai konsistensi kandidat.
 *  - Polaritas watermark bisa positif (logo putih) atau negatif/gray. Probe
 *    polaritas + kontras alpha menolak kandidat yang hanya "kebetulan cocok".
 *  - Alpha tidak selalu 1. Seed gain diestimasi per frame (median), lalu
 *    opsional dihaluskan lagi per frame saat pembersihan.
 *  - Kandidat inset/relocated (margin 144) ikut diuji, bukan cuma margin 108.
 */

import { getEngineAlphaMap } from './gemini-watermark'
import {
  resolveVideoWatermarkCandidates,
  type VideoWatermarkCandidate,
} from './video-watermark-catalog'

export interface WatermarkRect {
  x: number
  y: number
  width: number
  height: number
}

export interface RasterLike {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface VideoDetectionFrame {
  timestamp: number
  imageData: ImageData | RasterLike
}

export interface VideoAlphaOptions {
  profile?: string | number
  alphaProfile?: string | number
  edgeBoost?: number
  lowAlphaScale?: number
  bodyAlphaScale?: number
  localLowAlphaScale?: number
  localBodyAlphaScale?: number
  localRegion?: string
  /** Matikan pemilihan bentuk alpha otomatis (untuk debugging/benchmark). */
  autoAlphaProfile?: boolean
}

export interface VideoAlphaSeed {
  seedGain: number
  estimates: number[]
  estimateCount: number
}

export interface VideoFrameScore {
  spatial: number
  gradient: number
  confidence: number
}

export interface VideoWatermarkEvidenceSummary {
  frames: number
  meanSpatial: number
  meanAbsSpatial: number
  meanGradient: number
  meanConfidence: number
  maxConfidence: number
  maxAbsSpatial: number
  positiveSpatialFrames: number
  negativeSpatialFrames: number
  positivePolarityFrames: number
  negativePolarityFrames: number
  grayPolarityFrames: number
  processCandidateFrames: number
  confidentFrames: number
  weakFrames: number
  likelyAbsentFrames: number
}

export interface VideoWatermarkCandidateSummary {
  candidateId: string
  label: string
  x: number
  y: number
  size: number
  meanSpatial: number
  meanGradient: number
  meanConfidence: number
  maxConfidence: number
  votes: number
}

export interface VideoWatermarkTrack {
  id: string
  watermarkKind: 'diamond'
  position: WatermarkRect
  alphaMap: Float32Array
  alphaSeed: number
  candidate: VideoWatermarkCandidate
  meanConfidence: number
  votes: number
  voteRatio: number
}

export interface VideoWatermarkDetection {
  watermarkKind: 'diamond'
  position: WatermarkRect
  alphaMap: Float32Array
  alphaSeed: number
  candidate: VideoWatermarkCandidate
  detections: VideoWatermarkTrack[]
  isConfident: boolean
  summary: {
    frameCount: number
    minConfidence: number
    alphaSeed: number
    alphaShape?: {
      accepted: boolean
      baseline: { name: string; meanConfidence: number }
      selected: { name: string; meanConfidence: number }
    } | null
    best: {
      candidateId: string
      label: string
      meanSpatial: number
      meanGradient: number
      meanConfidence: number
      maxConfidence: number
      votes: number
    }
    candidates: VideoWatermarkCandidateSummary[]
    evidence?: VideoWatermarkEvidenceSummary
    evidenceClass?: string
    polarity?: string
  }
}

interface InternalCandidateSummary {
  candidate: VideoWatermarkCandidate
  frames: number
  meanSpatial: number
  meanGradient: number
  meanConfidence: number
  maxConfidence: number
  votes: number
}

interface AlphaShapeOption {
  name: string
  profile: string | number
  edgeBoost: number
  options: VideoAlphaOptions
}

interface FrameWinner {
  timestamp: number
  candidateId: string
  confidence: number
}

const DEFAULT_MIN_CONFIDENCE = 0.18
const DEFAULT_ALPHA_SEED_GAIN = 1
const VIDEO_ALPHA_PROFILE = '96-20260520'
const VIDEO_ALPHA_EDGE_BOOST = 0.045
const VIDEO_INSET_ALPHA_EDGE_BOOST = 0.035
const ALPHA_REFINEMENT_ROUNDS = 5
const LOGO_VALUE = 255
const AUTO_ALPHA_SHAPE_MIN_SIZE = 40
const VIDEO_V1_ALPHA_MAX_SIZE = AUTO_ALPHA_SHAPE_MIN_SIZE - 1
const AUTO_ALPHA_SHAPE_MIN_IMPROVEMENT = 0.04
const AUTO_ALPHA_SHAPE_MIN_RELATIVE_IMPROVEMENT = 0.08
const AUTO_ALPHA_SHAPE_MAX_EDGE_BOOST = 0.12
const EPSILON = 1e-12

// ─── Alpha map ──────────────────────────────────────────────────────────────

function inferSquareAlphaSize(alphaMap: Float32Array, fallbackSize: number): number {
  const size = Math.round(Math.sqrt(alphaMap.length))
  return size > 0 && size * size === alphaMap.length ? size : fallbackSize
}

function normalizeVideoAlphaProfile(profile: string | number | undefined): string | number {
  if (profile === undefined || profile === null || profile === '') return VIDEO_ALPHA_PROFILE
  const text = String(profile).trim()
  const numeric = Number(text)
  return Number.isInteger(numeric) && String(numeric) === text ? numeric : text
}

function resizeAlphaMapArea(
  source: Float32Array,
  sourceSize: number,
  targetSize: number,
): Float32Array {
  if (targetSize <= 0) return new Float32Array(0)
  if (sourceSize === targetSize) return new Float32Array(source)
  const out = new Float32Array(targetSize * targetSize)
  const scale = (sourceSize - 1) / Math.max(1, targetSize - 1)
  for (let y = 0; y < targetSize; y++) {
    const sy = y * scale
    const y0 = Math.floor(sy)
    const y1 = Math.min(sourceSize - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < targetSize; x++) {
      const sx = x * scale
      const x0 = Math.floor(sx)
      const x1 = Math.min(sourceSize - 1, x0 + 1)
      const fx = sx - x0
      const p00 = source[y0 * sourceSize + x0]
      const p10 = source[y0 * sourceSize + x1]
      const p01 = source[y1 * sourceSize + x0]
      const p11 = source[y1 * sourceSize + x1]
      const top = p00 + (p10 - p00) * fx
      const bottom = p01 + (p11 - p01) * fx
      out[y * targetSize + x] = top + (bottom - top) * fy
    }
  }
  return out
}

function matchesVideoAlphaLocalRegion(
  x: number,
  y: number,
  size: number,
  region: string,
): boolean {
  if (!region || region === 'all') return true
  const center = (size - 1) / 2
  if (region === 'top') return y < center
  if (region === 'bottom') return y >= center
  if (region === 'left') return x < center
  if (region === 'right') return x >= center
  if (region === 'top-left') return y < center && x < center
  if (region === 'top-right') return y < center && x >= center
  if (region === 'bottom-left') return y >= center && x < center
  if (region === 'bottom-right') return y >= center && x >= center
  return true
}

export function enhanceVideoAlphaEdges(
  alphaMap: Float32Array,
  size: number,
  strength: number,
): Float32Array {
  if (!Number.isFinite(strength) || strength <= 0 || size <= 2) {
    return new Float32Array(alphaMap)
  }
  const gradient = new Float32Array(alphaMap.length)
  let maxGradient = 0
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x
      const gx =
        -alphaMap[i - size - 1] -
        2 * alphaMap[i - 1] -
        alphaMap[i + size - 1] +
        alphaMap[i - size + 1] +
        2 * alphaMap[i + 1] +
        alphaMap[i + size + 1]
      const gy =
        -alphaMap[i - size - 1] -
        2 * alphaMap[i - size] -
        alphaMap[i - size + 1] +
        alphaMap[i + size - 1] +
        2 * alphaMap[i + size] +
        alphaMap[i + size + 1]
      const value = Math.sqrt(gx * gx + gy * gy)
      gradient[i] = value
      if (value > maxGradient) maxGradient = value
    }
  }
  if (maxGradient <= 0) return new Float32Array(alphaMap)
  const out = new Float32Array(alphaMap.length)
  for (let i = 0; i < alphaMap.length; i++) {
    const edge = Math.sqrt(gradient[i] / maxGradient)
    out[i] = Math.min(0.99, alphaMap[i] + edge * strength)
  }
  return out
}

export function resolveVideoAlphaEdgeBoost(
  candidate: VideoWatermarkCandidate | null = null,
): number {
  const size = Number(candidate?.size ?? candidate?.width ?? candidate?.height)
  const marginRight = Number(candidate?.marginRight)
  const marginBottom = Number(candidate?.marginBottom)
  const isInsetByGeometry =
    Number.isFinite(size) &&
    size > 0 &&
    Number.isFinite(marginRight) &&
    Number.isFinite(marginBottom) &&
    marginRight / size >= 1.85 &&
    marginBottom / size >= 1.85
  if (candidate?.id === 'veo-1080p-inset' || isInsetByGeometry) {
    return VIDEO_INSET_ALPHA_EDGE_BOOST
  }
  return VIDEO_ALPHA_EDGE_BOOST
}

function applyVideoAlphaShapeOptions(
  alphaMap: Float32Array,
  options: VideoAlphaOptions = {},
): Float32Array {
  const lowAlphaScale = Number.isFinite(options.lowAlphaScale)
    ? Math.max(0.5, Math.min(1.5, options.lowAlphaScale as number))
    : 1
  const bodyAlphaScale = Number.isFinite(options.bodyAlphaScale)
    ? Math.max(0.5, Math.min(1.5, options.bodyAlphaScale as number))
    : 1
  const localLowAlphaScale = Number.isFinite(options.localLowAlphaScale)
    ? Math.max(0.5, Math.min(1.5, options.localLowAlphaScale as number))
    : 1
  const localBodyAlphaScale = Number.isFinite(options.localBodyAlphaScale)
    ? Math.max(0.5, Math.min(1.5, options.localBodyAlphaScale as number))
    : 1
  const localRegion = typeof options.localRegion === 'string' ? options.localRegion : 'all'
  if (
    Math.abs(lowAlphaScale - 1) < 0.0001 &&
    Math.abs(bodyAlphaScale - 1) < 0.0001 &&
    Math.abs(localLowAlphaScale - 1) < 0.0001 &&
    Math.abs(localBodyAlphaScale - 1) < 0.0001
  ) {
    return alphaMap
  }

  const size = Math.round(Math.sqrt(alphaMap.length))
  const out = new Float32Array(alphaMap.length)
  for (let i = 0; i < alphaMap.length; i++) {
    const alpha = alphaMap[i] || 0
    const x = size > 0 ? i % size : 0
    const y = size > 0 ? Math.floor(i / size) : 0
    const inLocalRegion = matchesVideoAlphaLocalRegion(x, y, size, localRegion)
    if (alpha > 0 && alpha < 0.12) {
      const scale = lowAlphaScale * (inLocalRegion ? localLowAlphaScale : 1)
      out[i] = Math.min(0.99, alpha * scale)
    } else if (alpha >= 0.12) {
      const scale = bodyAlphaScale * (inLocalRegion ? localBodyAlphaScale : 1)
      out[i] = Math.min(0.99, alpha * scale)
    } else {
      out[i] = alpha
    }
  }
  return out
}

const videoAlphaMapCache = new Map<string, Promise<Float32Array | null>>()

function alphaOptionsKey(size: number, options: VideoAlphaOptions, edgeBoost: number): string {
  return [
    size,
    options.profile ?? options.alphaProfile ?? '',
    edgeBoost,
    options.lowAlphaScale ?? 1,
    options.bodyAlphaScale ?? 1,
    options.localLowAlphaScale ?? 1,
    options.localBodyAlphaScale ?? 1,
    options.localRegion ?? 'all',
  ].join('|')
}

/** Alpha map video: profil 96/48 bawaan engine, diskalakan + edge-boosted. */
export function getVideoAlphaMap(
  size: number,
  options: VideoAlphaOptions = {},
  candidate: VideoWatermarkCandidate | null = null,
): Promise<Float32Array | null> {
  const requestedProfile = options.profile ?? options.alphaProfile
  const profile =
    requestedProfile === undefined || requestedProfile === null || requestedProfile === ''
      ? size <= VIDEO_V1_ALPHA_MAX_SIZE
        ? 48
        : VIDEO_ALPHA_PROFILE
      : normalizeVideoAlphaProfile(requestedProfile)
  const edgeBoost = Number.isFinite(options.edgeBoost)
    ? (options.edgeBoost as number)
    : resolveVideoAlphaEdgeBoost(candidate)
  const key = alphaOptionsKey(size, options, edgeBoost)
  const cached = videoAlphaMapCache.get(key)
  if (cached) return cached

  const request = (async () => {
    const source =
      (await getEngineAlphaMap(profile)) ??
      (await getEngineAlphaMap(VIDEO_ALPHA_PROFILE)) ??
      (await getEngineAlphaMap(96))
    if (!source) return null
    const sourceSize = inferSquareAlphaSize(source, 96)
    const resized =
      size === sourceSize ? new Float32Array(source) : resizeAlphaMapArea(source, sourceSize, size)
    const enhanced = enhanceVideoAlphaEdges(resized, size, edgeBoost)
    return applyVideoAlphaShapeOptions(enhanced, options)
  })()

  videoAlphaMapCache.set(key, request)
  return request
}

// ─── Korelasi & skor frame ──────────────────────────────────────────────────

function meanAndVariance(values: Float32Array): { mean: number; variance: number } {
  let mean = 0
  for (let i = 0; i < values.length; i++) mean += values[i]
  mean /= values.length
  let sq = 0
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - mean
    sq += d * d
  }
  return { mean, variance: sq / values.length }
}

function normalizedCrossCorrelation(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0
  const statsA = meanAndVariance(a)
  const statsB = meanAndVariance(b)
  const den = Math.sqrt(statsA.variance * statsB.variance) * a.length
  if (den < EPSILON) return 0
  let num = 0
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - statsA.mean) * (b[i] - statsB.mean)
  }
  return num / den
}

function toRegionGrayscale(
  imageData: RasterLike,
  region: { x: number; y: number; size: number },
): Float32Array {
  const { width, height, data } = imageData
  const size = region.size
  if (!size || size <= 0) return new Float32Array(0)
  if (region.x < 0 || region.y < 0 || region.x + size > width || region.y + size > height) {
    return new Float32Array(0)
  }
  const out = new Float32Array(size * size)
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const idx = ((region.y + row) * width + (region.x + col)) * 4
      out[row * size + col] =
        (0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2]) / 255
    }
  }
  return out
}

function sobelMagnitude(gray: Float32Array, width: number, height: number): Float32Array {
  const grad = new Float32Array(width * height)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const gx =
        -gray[i - width - 1] -
        2 * gray[i - 1] -
        gray[i + width - 1] +
        gray[i - width + 1] +
        2 * gray[i + 1] +
        gray[i + width + 1]
      const gy =
        -gray[i - width - 1] -
        2 * gray[i - width] -
        gray[i - width + 1] +
        gray[i + width - 1] +
        2 * gray[i + width] +
        gray[i + width + 1]
      grad[i] = Math.sqrt(gx * gx + gy * gy)
    }
  }
  return grad
}

/** NCC spasial persegi (alphaMap sudah berukuran width*height). */
export function computeRectangularSpatialCorrelation({
  imageData,
  alphaMap,
  region,
  activeThreshold = 0.02,
}: {
  imageData: RasterLike
  alphaMap: Float32Array
  region: { x: number; y: number; width: number; height: number }
  activeThreshold?: number
}): number {
  if (!imageData || !alphaMap || !region) return 0
  const width = region.width
  const height = region.height
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    alphaMap.length !== width * height ||
    region.x < 0 ||
    region.y < 0 ||
    region.x + width > imageData.width ||
    region.y + height > imageData.height
  ) {
    return 0
  }

  let imageSum = 0
  let templateSum = 0
  let count = 0
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const template = alphaMap[row * width + col] || 0
      if (Math.abs(template) <= activeThreshold) continue
      const idx = ((region.y + row) * imageData.width + region.x + col) * 4
      imageSum +=
        (0.2126 * imageData.data[idx] +
          0.7152 * imageData.data[idx + 1] +
          0.0722 * imageData.data[idx + 2]) /
        255
      templateSum += template
      count++
    }
  }
  if (count <= 1) return 0
  const imageMean = imageSum / count
  const templateMean = templateSum / count
  let numerator = 0
  let imageEnergy = 0
  let templateEnergy = 0
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const template = alphaMap[row * width + col] || 0
      if (Math.abs(template) <= activeThreshold) continue
      const idx = ((region.y + row) * imageData.width + region.x + col) * 4
      const imageDelta =
        (0.2126 * imageData.data[idx] +
          0.7152 * imageData.data[idx + 1] +
          0.0722 * imageData.data[idx + 2]) /
          255 -
        imageMean
      const templateDelta = template - templateMean
      numerator += imageDelta * templateDelta
      imageEnergy += imageDelta * imageDelta
      templateEnergy += templateDelta * templateDelta
    }
  }
  const denominator = Math.sqrt(imageEnergy * templateEnergy)
  return denominator > 0 ? numerator / denominator : 0
}

export function scoreVideoWatermarkFrame(
  imageData: RasterLike,
  position: WatermarkRect,
  alphaMap: Float32Array,
): VideoFrameScore {
  const width = position.width
  const height = position.height
  if (width !== height || alphaMap.length !== width * width) {
    const spatial = computeRectangularSpatialCorrelation({
      imageData,
      alphaMap,
      region: { x: position.x, y: position.y, width, height },
    })
    return { spatial, gradient: 0, confidence: Math.max(0, spatial) }
  }

  const region = { x: position.x, y: position.y, size: width }
  const patch = toRegionGrayscale(imageData, region)
  const spatial =
    patch.length === alphaMap.length ? normalizedCrossCorrelation(patch, alphaMap) : 0
  const patchGrad = patch.length ? sobelMagnitude(patch, width, height) : new Float32Array(0)
  const alphaGrad = sobelMagnitude(alphaMap, width, height)
  const gradient =
    patchGrad.length === alphaGrad.length && patchGrad.length > 0
      ? normalizedCrossCorrelation(patchGrad, alphaGrad)
      : 0
  const confidence = Math.max(0, spatial) * 0.35 + Math.max(0, gradient) * 0.65
  return { spatial, gradient, confidence }
}

export function computeVideoBackgroundNormalizedAlphaContrast(
  imageData: RasterLike,
  position: WatermarkRect,
  alphaMap: Float32Array,
  {
    highAlphaThreshold = 0.18,
    lowAlphaThreshold = 0.035,
  }: { highAlphaThreshold?: number; lowAlphaThreshold?: number } = {},
): {
  alphaContrast: number
  normalizedAlphaContrast: number
  foregroundMean: number | null
  backgroundMean: number | null
  backgroundStdDev: number
} {
  if (!imageData || !position || !alphaMap || alphaMap.length === 0) {
    return {
      alphaContrast: 0,
      normalizedAlphaContrast: 0,
      foregroundMean: null,
      backgroundMean: null,
      backgroundStdDev: 0,
    }
  }
  const width = position.width
  const height = position.height
  let foregroundSum = 0
  let foregroundWeight = 0
  let backgroundSum = 0
  let backgroundSq = 0
  let backgroundWeight = 0

  for (let y = 0; y < height; y++) {
    const imageY = position.y + y
    if (imageY < 0 || imageY >= imageData.height) continue
    for (let x = 0; x < width; x++) {
      const imageX = position.x + x
      if (imageX < 0 || imageX >= imageData.width) continue
      const alpha = alphaMap[y * width + x] || 0
      const idx = (imageY * imageData.width + imageX) * 4
      const luma =
        (0.2126 * imageData.data[idx] +
          0.7152 * imageData.data[idx + 1] +
          0.0722 * imageData.data[idx + 2]) /
        255
      if (alpha >= highAlphaThreshold) {
        foregroundSum += luma * alpha
        foregroundWeight += alpha
      } else if (alpha <= lowAlphaThreshold) {
        backgroundSum += luma
        backgroundSq += luma * luma
        backgroundWeight++
      }
    }
  }

  const foregroundMean = foregroundWeight > 0 ? foregroundSum / foregroundWeight : null
  const backgroundMean = backgroundWeight > 0 ? backgroundSum / backgroundWeight : null
  const backgroundVariance =
    backgroundWeight > 0 && backgroundMean !== null
      ? Math.max(0, backgroundSq / backgroundWeight - backgroundMean * backgroundMean)
      : 0
  const backgroundStdDev = Math.sqrt(backgroundVariance)
  const alphaContrast =
    foregroundMean !== null && backgroundMean !== null ? foregroundMean - backgroundMean : 0
  return {
    alphaContrast,
    normalizedAlphaContrast: alphaContrast / Math.max(0.015, backgroundStdDev),
    foregroundMean,
    backgroundMean,
    backgroundStdDev,
  }
}

export function buildVideoWatermarkPolarityProbe(
  score: VideoFrameScore,
  backgroundProbe: { alphaContrast?: number; normalizedAlphaContrast?: number },
) {
  const spatial = Number.isFinite(score?.spatial) ? score.spatial : 0
  const gradient = Number.isFinite(score?.gradient) ? score.gradient : 0
  const confidence = Number.isFinite(score?.confidence) ? score.confidence : 0
  const positiveScore = Math.max(0, spatial) * 0.65 + Math.max(0, gradient) * 0.35
  const negativeScore = Math.max(0, -spatial) * 0.65 + Math.max(0, gradient) * 0.35
  const backgroundNormalizedScore = Math.abs(backgroundProbe.normalizedAlphaContrast || 0)
  const bestPolarity =
    positiveScore >= 0.14 && positiveScore >= negativeScore
      ? 'positive'
      : negativeScore >= 0.14 && negativeScore > positiveScore
        ? 'negative'
        : backgroundNormalizedScore >= 0.5
          ? 'gray'
          : 'ambiguous'
  return {
    positiveScore,
    negativeScore,
    absSpatialScore: Math.abs(spatial),
    backgroundNormalizedScore,
    backgroundAlphaContrast: backgroundProbe.alphaContrast || 0,
    normalizedAlphaContrast: backgroundProbe.normalizedAlphaContrast || 0,
    bestPolarity,
    polarityMargin: Math.abs(positiveScore - negativeScore),
    shouldProcessCandidate:
      (bestPolarity === 'positive' || bestPolarity === 'negative' || bestPolarity === 'gray') &&
      Math.max(positiveScore, negativeScore, backgroundNormalizedScore * 0.2, confidence) >= 0.14,
  }
}

export function scoreVideoWatermarkFramePolarity(
  imageData: RasterLike,
  position: WatermarkRect,
  alphaMap: Float32Array,
) {
  const score = scoreVideoWatermarkFrame(imageData, position, alphaMap)
  const backgroundProbe = computeVideoBackgroundNormalizedAlphaContrast(
    imageData,
    position,
    alphaMap,
  )
  const polarityProbe = buildVideoWatermarkPolarityProbe(score, backgroundProbe)
  return { ...score, ...polarityProbe, backgroundProbe }
}

export function summarizeVideoWatermarkFrameEvidence(
  frameScores: Array<VideoFrameScore & { bestPolarity?: string; shouldProcessCandidate?: boolean }>,
): VideoWatermarkEvidenceSummary {
  const scores = Array.isArray(frameScores) ? frameScores : []
  const summary: VideoWatermarkEvidenceSummary = {
    frames: scores.length,
    meanSpatial: 0,
    meanAbsSpatial: 0,
    meanGradient: 0,
    meanConfidence: 0,
    maxConfidence: 0,
    maxAbsSpatial: 0,
    positiveSpatialFrames: 0,
    negativeSpatialFrames: 0,
    positivePolarityFrames: 0,
    negativePolarityFrames: 0,
    grayPolarityFrames: 0,
    processCandidateFrames: 0,
    confidentFrames: 0,
    weakFrames: 0,
    likelyAbsentFrames: 0,
  }
  if (!scores.length) return summary

  for (const score of scores) {
    const confidence = Number.isFinite(score.confidence) ? score.confidence : 0
    const spatial = Number.isFinite(score.spatial) ? score.spatial : 0
    const absSpatial = Math.abs(spatial)
    summary.meanSpatial += spatial
    summary.meanAbsSpatial += absSpatial
    summary.meanGradient += Number.isFinite(score.gradient) ? score.gradient : 0
    summary.meanConfidence += confidence
    summary.maxConfidence = Math.max(summary.maxConfidence, confidence)
    summary.maxAbsSpatial = Math.max(summary.maxAbsSpatial, absSpatial)
    if (spatial >= 0.14) summary.positiveSpatialFrames++
    else if (spatial <= -0.14) summary.negativeSpatialFrames++
    if (score.bestPolarity === 'positive') summary.positivePolarityFrames++
    if (score.bestPolarity === 'negative') summary.negativePolarityFrames++
    if (score.bestPolarity === 'gray') summary.grayPolarityFrames++
    if (score.shouldProcessCandidate === true) summary.processCandidateFrames++
    if (confidence >= 0.14) summary.confidentFrames++
    else if (confidence >= 0.035) summary.weakFrames++
    else summary.likelyAbsentFrames++
  }
  summary.meanSpatial /= scores.length
  summary.meanAbsSpatial /= scores.length
  summary.meanGradient /= scores.length
  summary.meanConfidence /= scores.length
  return summary
}

export function classifyVideoWatermarkEvidenceSummary(summary: VideoWatermarkEvidenceSummary) {
  const frames = Number.isFinite(summary?.frames) ? summary.frames : 0
  if (frames <= 0) {
    return { class: 'unknown', shortLabel: 'unknown', label: 'unknown evidence', polarity: 'unknown' }
  }
  const strongFrameCount = Math.max(2, Math.ceil(frames * 0.6))
  const halfFrameCount = Math.ceil(frames * 0.5)
  const confidentFrames = summary.confidentFrames || 0
  const likelyAbsentFrames = summary.likelyAbsentFrames || 0
  const negativeSpatialFrames = summary.negativeSpatialFrames || 0
  const positiveSpatialFrames = summary.positiveSpatialFrames || 0
  const meanAbsSpatial = summary.meanAbsSpatial || 0
  const meanSpatial = summary.meanSpatial || 0

  if (
    confidentFrames >= strongFrameCount &&
    positiveSpatialFrames >= strongFrameCount &&
    meanSpatial >= 0.14
  ) {
    return {
      class: 'positive-high-confidence',
      shortLabel: 'positive-high',
      label: 'positive high-confidence watermark',
      polarity: 'positive',
    }
  }
  if (negativeSpatialFrames >= strongFrameCount && meanAbsSpatial >= 0.18) {
    return {
      class: 'negative-or-gray-polarity',
      shortLabel: 'negative-gray',
      label: 'negative/gray polarity evidence',
      polarity: 'negative-or-gray',
    }
  }
  if (confidentFrames > 0 && likelyAbsentFrames >= halfFrameCount) {
    return {
      class: 'intermittent-low-visible',
      shortLabel: 'intermittent',
      label: 'intermittent or low-visible watermark',
      polarity: negativeSpatialFrames > 0 ? 'mixed' : 'positive',
    }
  }
  if (likelyAbsentFrames >= strongFrameCount && meanAbsSpatial < 0.12) {
    return {
      class: 'likely-absent-or-off-anchor',
      shortLabel: 'likely-absent',
      label: 'likely absent or off-anchor',
      polarity: 'none',
    }
  }
  return {
    class: 'ambiguous',
    shortLabel: 'ambiguous',
    label: 'ambiguous evidence',
    polarity: negativeSpatialFrames > positiveSpatialFrames ? 'mixed-negative' : 'mixed',
  }
}

// ─── Estimasi alpha & pemilihan bentuk alpha ────────────────────────────────

function lumaAt(data: Uint8ClampedArray, idx: number): number {
  return 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2]
}

function computeBackgroundMeanFromImageData(
  imageData: RasterLike,
  position: WatermarkRect,
  alphaMap: Float32Array,
  padding = 18,
): number | null {
  const padX = Math.max(0, position.x - padding)
  const padY = Math.max(0, position.y - padding)
  const padRight = Math.min(imageData.width, position.x + position.width + padding)
  const padBottom = Math.min(imageData.height, position.y + position.height + padding)
  let sum = 0
  let weightSum = 0
  const lowAlphaThreshold = 0.015

  for (let y = padY; y < padBottom; y++) {
    for (let x = padX; x < padRight; x++) {
      const inRoi =
        x >= position.x &&
        x < position.x + position.width &&
        y >= position.y &&
        y < position.y + position.height
      let weight = inRoi ? 0 : 1
      if (inRoi) {
        const rx = x - position.x
        const ry = y - position.y
        const alpha = alphaMap[ry * position.width + rx] || 0
        if (alpha <= lowAlphaThreshold) weight = 0.35
      }
      if (weight <= 0) continue
      const idx = (y * imageData.width + x) * 4
      sum += lumaAt(imageData.data, idx) * weight
      weightSum += weight
    }
  }
  return weightSum > 0 ? sum / weightSum : null
}

function scoreGainAgainstBackground(
  imageData: RasterLike,
  position: WatermarkRect,
  alphaMap: Float32Array,
  gain: number,
  backgroundMean: number,
): number | null {
  if (!Number.isFinite(backgroundMean)) return null
  let sum = 0
  let weightSum = 0
  for (let y = 0; y < position.height; y++) {
    for (let x = 0; x < position.width; x++) {
      const rawAlpha = alphaMap[y * position.width + x] || 0
      if (rawAlpha <= 0.025) continue
      const alpha = Math.min(rawAlpha * gain, 0.99)
      const oneMinusAlpha = 1 - alpha
      const idx = ((position.y + y) * imageData.width + position.x + x) * 4
      const weight = Math.min(1, Math.max(0, rawAlpha * 8))
      const r = (imageData.data[idx] - alpha * LOGO_VALUE) / oneMinusAlpha
      const g = (imageData.data[idx + 1] - alpha * LOGO_VALUE) / oneMinusAlpha
      const b = (imageData.data[idx + 2] - alpha * LOGO_VALUE) / oneMinusAlpha
      sum += (0.2126 * r + 0.7152 * g + 0.0722 * b) * weight
      weightSum += weight
    }
  }
  if (weightSum <= 0) return null
  return sum / weightSum - backgroundMean
}

export function estimateFrameAlphaGain(
  imageData: RasterLike,
  position: WatermarkRect,
  alphaMap: Float32Array,
  seedGain = DEFAULT_ALPHA_SEED_GAIN,
): { gain: number; residualDelta: number } | null {
  const backgroundMean = computeBackgroundMeanFromImageData(imageData, position, alphaMap)
  if (backgroundMean === null) return null
  let lo = Math.max(0.35, seedGain - 0.45)
  let hi = Math.min(1.35, seedGain + 0.45)
  let bestGain = seedGain
  let bestAbsDelta = Number.POSITIVE_INFINITY

  for (let i = 0; i < ALPHA_REFINEMENT_ROUNDS; i++) {
    const gain = (lo + hi) / 2
    const delta = scoreGainAgainstBackground(imageData, position, alphaMap, gain, backgroundMean)
    if (delta === null) return null
    const absDelta = Math.abs(delta)
    if (absDelta < bestAbsDelta) {
      bestAbsDelta = absDelta
      bestGain = gain
    }
    if (delta > 0) lo = gain
    else hi = gain
  }
  return { gain: bestGain, residualDelta: bestAbsDelta }
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function estimateAlphaSeedFromFrames(
  frames: VideoDetectionFrame[],
  position: WatermarkRect,
  alphaMap: Float32Array,
  frameWinners: FrameWinner[],
  candidateId: string,
): VideoAlphaSeed {
  const winnerByTimestamp = new Map(frameWinners.map((winner) => [winner.timestamp, winner]))
  const estimates: number[] = []
  for (const frame of frames) {
    const winner = winnerByTimestamp.get(frame.timestamp)
    if (winner && winner.candidateId !== candidateId && winner.confidence > 0.08) continue
    const estimate = estimateFrameAlphaGain(frame.imageData, position, alphaMap)
    if (!estimate) continue
    if (estimate.gain < 0.35 || estimate.gain > 1.35) continue
    estimates.push(estimate.gain)
  }
  return {
    seedGain: median(estimates) ?? DEFAULT_ALPHA_SEED_GAIN,
    estimates,
    estimateCount: estimates.length,
  }
}

function clampChannel(value: number): number {
  if (value <= 0) return 0
  if (value >= 255) return 255
  return Math.round(value)
}

function createRestoredVideoRoi(
  imageData: RasterLike,
  position: WatermarkRect,
  alphaMap: Float32Array,
  alphaGain: number,
): { imageData: RasterLike; meanAbsDelta: number; changedRatio: number } {
  const width = position.width
  const height = position.height
  const out = new Uint8ClampedArray(width * height * 4)
  let deltaSum = 0
  let changed = 0
  let total = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceIdx = ((position.y + y) * imageData.width + position.x + x) * 4
      const targetIdx = (y * width + x) * 4
      const rawAlpha = alphaMap[y * width + x] || 0
      const alpha = rawAlpha > 0.025 ? Math.min(rawAlpha * alphaGain, 0.99) : 0
      if (alpha <= 0) {
        out[targetIdx] = imageData.data[sourceIdx]
        out[targetIdx + 1] = imageData.data[sourceIdx + 1]
        out[targetIdx + 2] = imageData.data[sourceIdx + 2]
        out[targetIdx + 3] = imageData.data[sourceIdx + 3] ?? 255
      } else {
        const oneMinusAlpha = 1 - alpha
        out[targetIdx] = clampChannel(
          (imageData.data[sourceIdx] - alpha * LOGO_VALUE) / oneMinusAlpha,
        )
        out[targetIdx + 1] = clampChannel(
          (imageData.data[sourceIdx + 1] - alpha * LOGO_VALUE) / oneMinusAlpha,
        )
        out[targetIdx + 2] = clampChannel(
          (imageData.data[sourceIdx + 2] - alpha * LOGO_VALUE) / oneMinusAlpha,
        )
        out[targetIdx + 3] = imageData.data[sourceIdx + 3] ?? 255
      }
      for (let channel = 0; channel < 3; channel++) {
        const delta = Math.abs(out[targetIdx + channel] - imageData.data[sourceIdx + channel])
        deltaSum += delta
        if (delta > 1) changed++
        total++
      }
    }
  }
  return {
    imageData: { width, height, data: out },
    meanAbsDelta: total > 0 ? deltaSum / total : 0,
    changedRatio: total > 0 ? changed / total : 0,
  }
}

function hasExplicitAlphaShapeOptions(options: VideoAlphaOptions = {}): boolean {
  return (
    options.profile !== undefined ||
    options.alphaProfile !== undefined ||
    options.edgeBoost !== undefined ||
    options.lowAlphaScale !== undefined ||
    options.bodyAlphaScale !== undefined ||
    options.localLowAlphaScale !== undefined ||
    options.localBodyAlphaScale !== undefined ||
    options.localRegion !== undefined
  )
}

function buildAutoAlphaShapeOptions(
  candidate: VideoWatermarkCandidate,
  alphaMapOptions: VideoAlphaOptions = {},
): AlphaShapeOption[] {
  const defaultEdgeBoost = resolveVideoAlphaEdgeBoost(candidate)
  return [
    {
      name: 'default',
      profile: normalizeVideoAlphaProfile(alphaMapOptions.profile ?? alphaMapOptions.alphaProfile),
      edgeBoost: Number.isFinite(alphaMapOptions.edgeBoost)
        ? (alphaMapOptions.edgeBoost as number)
        : defaultEdgeBoost,
      options: {},
    },
    {
      name: `96-edge${defaultEdgeBoost.toFixed(3)}`,
      profile: '96',
      edgeBoost: defaultEdgeBoost,
      options: { alphaProfile: '96', edgeBoost: defaultEdgeBoost },
    },
    ...[0.08, 0.1, AUTO_ALPHA_SHAPE_MAX_EDGE_BOOST].map((edgeBoost) => ({
      name: `96-edge${edgeBoost.toFixed(3)}`,
      profile: '96',
      edgeBoost,
      options: { alphaProfile: '96', edgeBoost },
    })),
  ]
}

function shouldAutoSelectAlphaShape({
  candidate,
  best,
  voteRatio,
  alphaMapOptions,
}: {
  candidate: VideoWatermarkCandidate
  best: InternalCandidateSummary
  voteRatio: number
  alphaMapOptions: VideoAlphaOptions
}): boolean {
  if (alphaMapOptions.autoAlphaProfile === false) return false
  if (hasExplicitAlphaShapeOptions(alphaMapOptions)) return false
  if (!candidate || !best) return false
  if ((candidate.size ?? candidate.width ?? 0) < AUTO_ALPHA_SHAPE_MIN_SIZE) return false
  if (voteRatio < 0.6) return false
  return best.meanConfidence >= DEFAULT_MIN_CONFIDENCE
}

async function selectVideoAlphaShapeForDetection({
  frames,
  position,
  candidate,
  best,
  voteRatio,
  frameWinners,
  alphaMapOptions,
}: {
  frames: VideoDetectionFrame[]
  position: WatermarkRect
  candidate: VideoWatermarkCandidate
  best: InternalCandidateSummary
  voteRatio: number
  frameWinners: FrameWinner[]
  alphaMapOptions: VideoAlphaOptions
}): Promise<{
  alphaMap: Float32Array
  alphaSeed: VideoAlphaSeed
  alphaShape: VideoWatermarkDetection['summary']['alphaShape']
}> {
  const fallbackAlphaMap = await getVideoAlphaMap(candidate.size, alphaMapOptions, candidate)
  if (!fallbackAlphaMap) throw new Error('Alpha map Gemini tidak tersedia')
  const fallbackAlphaSeed = estimateAlphaSeedFromFrames(
    frames,
    position,
    fallbackAlphaMap,
    frameWinners,
    candidate.id,
  )
  if (!shouldAutoSelectAlphaShape({ candidate, best, voteRatio, alphaMapOptions })) {
    return { alphaMap: fallbackAlphaMap, alphaSeed: fallbackAlphaSeed, alphaShape: null }
  }

  const scoreAlphaMap = fallbackAlphaMap
  const winnerByTimestamp = new Map(frameWinners.map((winner) => [winner.timestamp, winner]))
  const options = buildAutoAlphaShapeOptions(candidate, alphaMapOptions)
  const evaluations: Array<{
    name: string
    profile: string | number
    edgeBoost: number
    alphaMap: Float32Array
    alphaSeed: VideoAlphaSeed
    meanConfidence: number
    meanAbsDelta: number
    changedRatio: number
    priorityIndex: number
  }> = []

  for (let index = 0; index < options.length; index++) {
    const option = options[index]
    const alphaMap = await getVideoAlphaMap(candidate.size, {
      ...alphaMapOptions,
      ...option.options,
    }, candidate)
    if (!alphaMap) continue
    const alphaSeed = estimateAlphaSeedFromFrames(
      frames,
      position,
      alphaMap,
      frameWinners,
      candidate.id,
    )
    let confidenceSum = 0
    let absDeltaSum = 0
    let changedSum = 0
    let count = 0
    for (const frame of frames) {
      const winner = winnerByTimestamp.get(frame.timestamp)
      if (winner && winner.candidateId !== candidate.id && winner.confidence > 0.08) continue
      const restored = createRestoredVideoRoi(
        frame.imageData,
        position,
        alphaMap,
        alphaSeed.seedGain,
      )
      const residual = scoreVideoWatermarkFrame(
        restored.imageData,
        { x: 0, y: 0, width: position.width, height: position.height },
        scoreAlphaMap,
      )
      confidenceSum += residual.confidence
      absDeltaSum += restored.meanAbsDelta
      changedSum += restored.changedRatio
      count++
    }
    evaluations.push({
      name: option.name,
      profile: option.profile,
      edgeBoost: option.edgeBoost,
      alphaMap,
      alphaSeed,
      meanConfidence: count > 0 ? confidenceSum / count : 1,
      meanAbsDelta: count > 0 ? absDeltaSum / count : 0,
      changedRatio: count > 0 ? changedSum / count : 0,
      priorityIndex: index,
    })
  }

  evaluations.sort((a, b) => {
    const rank = (e: typeof a) =>
      e.meanConfidence +
      Math.max(0, e.meanAbsDelta - 32) * 0.003 +
      Math.max(0, e.changedRatio - 0.92) * 0.15 +
      e.priorityIndex * 0.001
    return rank(a) - rank(b)
  })

  const baseline = evaluations.find((e) => e.name === 'default') || evaluations[0]
  if (!baseline) {
    return { alphaMap: fallbackAlphaMap, alphaSeed: fallbackAlphaSeed, alphaShape: null }
  }
  const selected = evaluations[0] || baseline
  const absoluteImprovement = baseline.meanConfidence - selected.meanConfidence
  const relativeImprovement =
    baseline.meanConfidence > 0 ? absoluteImprovement / baseline.meanConfidence : 0
  const accepted =
    selected !== baseline &&
    absoluteImprovement >= AUTO_ALPHA_SHAPE_MIN_IMPROVEMENT &&
    relativeImprovement >= AUTO_ALPHA_SHAPE_MIN_RELATIVE_IMPROVEMENT
  const finalSelection = accepted ? selected : baseline

  return {
    alphaMap: finalSelection.alphaMap,
    alphaSeed: finalSelection.alphaSeed,
    alphaShape: {
      accepted,
      baseline: { name: baseline.name, meanConfidence: baseline.meanConfidence },
      selected: { name: finalSelection.name, meanConfidence: finalSelection.meanConfidence },
    },
  }
}

// ─── Pemilihan track independen ─────────────────────────────────────────────

export function selectIndependentVideoWatermarkTracks(
  summaries: InternalCandidateSummary[],
  { minConfidence = DEFAULT_MIN_CONFIDENCE }: { minConfidence?: number } = {},
): InternalCandidateSummary[] {
  if (!Array.isArray(summaries) || summaries.length === 0) return []
  const qualified = summaries.filter((summary, index) => {
    if (index === 0) return true
    const primary = summaries[0]
    const unanimousPrimary = primary.frames > 0 && primary.votes === primary.frames
    return summary.meanConfidence >= minConfidence && (!unanimousPrimary || summary.votes > 0)
  })
  const selected: InternalCandidateSummary[] = []

  for (const summary of qualified) {
    const candidate = summary.candidate
    const candidateSize = Number(candidate?.size)
    const candidateArea = candidateSize * candidateSize
    const overlapsSelected = selected.some((selectedSummary) => {
      const selectedCandidate = selectedSummary.candidate
      const selectedSize = Number(selectedCandidate?.size)
      const overlapWidth = Math.max(
        0,
        Math.min(candidate.x + candidateSize, selectedCandidate.x + selectedSize) -
          Math.max(candidate.x, selectedCandidate.x),
      )
      const overlapHeight = Math.max(
        0,
        Math.min(candidate.y + candidateSize, selectedCandidate.y + selectedSize) -
          Math.max(candidate.y, selectedCandidate.y),
      )
      const smallerArea = Math.min(candidateArea, selectedSize * selectedSize)
      return smallerArea > 0 && (overlapWidth * overlapHeight) / smallerArea >= 0.5
    })
    if (!overlapsSelected) selected.push(summary)
  }
  return selected
}

// ─── Deteksi utama ──────────────────────────────────────────────────────────

export interface DetectVideoWatermarkOptions {
  candidates?: VideoWatermarkCandidate[]
  minConfidence?: number
  alphaMapOptions?: VideoAlphaOptions
  onProgress?: (pct: number, message: string) => void
  /** Yield ke main thread setiap N frame (default 1). */
  yieldEvery?: number
  yieldToMainThread?: () => Promise<void>
}

const nextYield = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * Deteksi watermark dari beberapa frame. Mengembalikan null jika tidak ada
 * kandidat yang didukung untuk resolusi ini (mis. video sangat kecil).
 *
 * `isConfident` tetap dihitung walau hasil tidak yakin — pemanggil bisa
 * memutuskan memakai fallback manual, seperti website referensi.
 */
export async function detectVideoWatermarkFromFrames({
  frames,
  width,
  height,
  candidates = resolveVideoWatermarkCandidates(width, height),
  minConfidence = DEFAULT_MIN_CONFIDENCE,
  alphaMapOptions = {},
  onProgress,
  yieldEvery = 1,
  yieldToMainThread,
}: {
  frames: VideoDetectionFrame[]
  width: number
  height: number
} & DetectVideoWatermarkOptions): Promise<VideoWatermarkDetection | null> {
  if (!Array.isArray(frames) || frames.length === 0) return null
  if (!Array.isArray(candidates) || candidates.length === 0) return null

  const alphaMaps = new Map<string, Float32Array>()
  for (const candidate of candidates) {
    const map = await getVideoAlphaMap(candidate.size, alphaMapOptions, candidate)
    if (map) alphaMaps.set(candidate.id, map)
  }
  const usableCandidates = candidates.filter((candidate) => alphaMaps.has(candidate.id))
  if (!usableCandidates.length) return null

  const perCandidate = new Map<
    string,
    { candidate: VideoWatermarkCandidate; scores: VideoFrameScore[]; votes: number }
  >(
    usableCandidates.map((candidate) => [
      candidate.id,
      { candidate, scores: [], votes: 0 },
    ]),
  )
  const frameWinners: FrameWinner[] = []
  const frameEvidence: Array<
    VideoFrameScore & { bestPolarity?: string; shouldProcessCandidate?: boolean }
  > = []
  const yieldFn = yieldToMainThread ?? nextYield
  const safeYieldEvery = Math.max(1, Math.round(yieldEvery || 1))

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    const frame = frames[frameIndex]
    const scored = usableCandidates
      .map((candidate) => {
        const alphaMap = alphaMaps.get(candidate.id)!
        const score = scoreVideoWatermarkFrame(
          frame.imageData,
          { x: candidate.x, y: candidate.y, width: candidate.size, height: candidate.size },
          alphaMap,
        )
        return { candidate, alphaMap, score }
      })
      .sort((a, b) => b.score.confidence - a.score.confidence)

    const winner = scored[0] || null
    if (winner) {
      frameWinners.push({
        timestamp: frame.timestamp,
        candidateId: winner.candidate.id,
        confidence: winner.score.confidence,
      })
    }
    for (const entry of scored) {
      perCandidate.get(entry.candidate.id)?.scores.push(entry.score)
    }
    if (winner) {
      const polarity = scoreVideoWatermarkFramePolarity(
        frame.imageData,
        { x: winner.candidate.x, y: winner.candidate.y, width: winner.candidate.size, height: winner.candidate.size },
        winner.alphaMap,
      )
      frameEvidence.push({
        spatial: polarity.spatial,
        gradient: polarity.gradient,
        confidence: polarity.confidence,
        bestPolarity: polarity.bestPolarity,
        shouldProcessCandidate: polarity.shouldProcessCandidate,
      })
    }

    onProgress?.(
      2 + Math.round(((frameIndex + 1) / frames.length) * 52),
      `Analisis frame ${frameIndex + 1}/${frames.length}…`,
    )
    if ((frameIndex + 1) % safeYieldEvery === 0) await yieldFn()
  }

  for (const winner of frameWinners) {
    const entry = perCandidate.get(winner.candidateId)
    if (entry) entry.votes++
  }

  const summaries: InternalCandidateSummary[] = [...perCandidate.values()]
    .map((entry) => {
      const scores = entry.scores
      if (!scores.length) {
        return {
          candidate: entry.candidate,
          frames: 0,
          meanSpatial: 0,
          meanGradient: 0,
          meanConfidence: 0,
          maxConfidence: 0,
          votes: entry.votes,
        }
      }
      let spatial = 0
      let gradient = 0
      let confidence = 0
      let maxConfidence = 0
      for (const score of scores) {
        spatial += score.spatial
        gradient += score.gradient
        confidence += score.confidence
        maxConfidence = Math.max(maxConfidence, score.confidence)
      }
      return {
        candidate: entry.candidate,
        frames: scores.length,
        meanSpatial: spatial / scores.length,
        meanGradient: gradient / scores.length,
        meanConfidence: confidence / scores.length,
        maxConfidence,
        votes: entry.votes,
      }
    })
    .sort((a, b) => {
      if (b.votes !== a.votes) return b.votes - a.votes
      return b.meanConfidence - a.meanConfidence
    })

  const best = summaries[0]
  if (!best) return null
  const trackSummaries = selectIndependentVideoWatermarkTracks(summaries, { minConfidence })
  const voteRatio = frames.length > 0 ? best.votes / frames.length : 0
  const combinedVoteRatio =
    frames.length > 0
      ? Math.min(
          1,
          trackSummaries.reduce((sum, summary) => sum + summary.votes, 0) / frames.length,
        )
      : 0
  const isConfident =
    best.meanConfidence >= minConfidence &&
    (voteRatio >= 0.6 || (trackSummaries.length > 1 && combinedVoteRatio >= 0.6))

  const position: WatermarkRect = {
    x: best.candidate.x,
    y: best.candidate.y,
    width: best.candidate.size,
    height: best.candidate.size,
  }
  onProgress?.(60, 'Menghitung alpha & konsistensi…')

  const alphaSelection = await selectVideoAlphaShapeForDetection({
    frames,
    position,
    candidate: best.candidate,
    best,
    voteRatio,
    frameWinners,
    alphaMapOptions,
  })
  const { alphaMap, alphaSeed } = alphaSelection

  const detections: VideoWatermarkTrack[] = [
    {
      id: best.candidate.id,
      watermarkKind: 'diamond',
      position,
      alphaMap,
      alphaSeed: alphaSeed.seedGain,
      candidate: best.candidate,
      meanConfidence: best.meanConfidence,
      votes: best.votes,
      voteRatio,
    },
  ]

  for (const summary of trackSummaries.slice(1)) {
    const candidatePosition: WatermarkRect = {
      x: summary.candidate.x,
      y: summary.candidate.y,
      width: summary.candidate.size,
      height: summary.candidate.size,
    }
    const candidateAlpha = await selectVideoAlphaShapeForDetection({
      frames,
      position: candidatePosition,
      candidate: summary.candidate,
      best: summary,
      voteRatio: frames.length > 0 ? summary.votes / frames.length : 0,
      frameWinners,
      alphaMapOptions,
    })
    detections.push({
      id: summary.candidate.id,
      watermarkKind: 'diamond',
      position: candidatePosition,
      alphaMap: candidateAlpha.alphaMap,
      alphaSeed: candidateAlpha.alphaSeed.seedGain,
      candidate: summary.candidate,
      meanConfidence: summary.meanConfidence,
      votes: summary.votes,
      voteRatio: frames.length > 0 ? summary.votes / frames.length : 0,
    })
  }

  const evidence = summarizeVideoWatermarkFrameEvidence(frameEvidence)
  const evidenceClass = classifyVideoWatermarkEvidenceSummary(evidence)
  onProgress?.(64, 'Deteksi selesai')

  return {
    watermarkKind: 'diamond',
    position,
    alphaMap,
    alphaSeed: alphaSeed.seedGain,
    candidate: best.candidate,
    detections,
    isConfident,
    summary: {
      frameCount: frames.length,
      minConfidence,
      alphaSeed: alphaSeed.seedGain,
      alphaShape: alphaSelection.alphaShape,
      best: {
        candidateId: best.candidate.id,
        label: best.candidate.label,
        meanSpatial: best.meanSpatial,
        meanGradient: best.meanGradient,
        meanConfidence: best.meanConfidence,
        maxConfidence: best.maxConfidence,
        votes: best.votes,
      },
      candidates: summaries.map((summary) => ({
        candidateId: summary.candidate.id,
        label: summary.candidate.label,
        x: summary.candidate.x,
        y: summary.candidate.y,
        size: summary.candidate.size,
        meanSpatial: summary.meanSpatial,
        meanGradient: summary.meanGradient,
        meanConfidence: summary.meanConfidence,
        maxConfidence: summary.maxConfidence,
        votes: summary.votes,
      })),
      evidence,
      evidenceClass: evidenceClass.class,
      polarity: evidenceClass.polarity,
    },
  }
}

/**
 * Pilih track yang paling cocok untuk frame saat ini. Dipakai saat watermark
 * berpindah posisi di tengah video: tiap track dinormalisasi dengan
 * meanConfidence-nya sendiri supaya track yang memang sedang muncul menang.
 */
export function selectVideoWatermarkDetectionForFrame(
  imageSource: RasterLike,
  detection: VideoWatermarkDetection,
): { track: VideoWatermarkTrack; score: VideoFrameScore; normalizedConfidence: number } | null {
  const tracks =
    Array.isArray(detection.detections) && detection.detections.length > 0
      ? detection.detections
      : [
          {
            id: detection.candidate?.id ?? 'primary',
            watermarkKind: 'diamond' as const,
            position: detection.position,
            alphaMap: detection.alphaMap,
            alphaSeed: detection.alphaSeed,
            candidate: detection.candidate,
            meanConfidence: detection.summary?.best?.meanConfidence ?? 0,
            votes: detection.summary?.best?.votes ?? 0,
            voteRatio: 1,
          },
        ]

  let selected: {
    track: VideoWatermarkTrack
    score: VideoFrameScore
    normalizedConfidence: number
  } | null = null
  for (const track of tracks) {
    if (!track?.position || !track?.alphaMap) continue
    const score = scoreVideoWatermarkFrame(imageSource, track.position, track.alphaMap)
    const meanConfidence = Math.max(0.01, Number(track.meanConfidence) || 0.01)
    const normalizedConfidence = score.confidence / meanConfidence
    if (
      !selected ||
      normalizedConfidence > selected.normalizedConfidence ||
      (normalizedConfidence === selected.normalizedConfidence &&
        score.confidence > selected.score.confidence)
    ) {
      selected = { track, score, normalizedConfidence }
    }
  }
  return selected
}
