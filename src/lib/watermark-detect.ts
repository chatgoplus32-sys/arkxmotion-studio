/**
 * Automatic watermark detection.
 *
 * Detects semi-transparent badges (Gemini, Veo, etc.) by looking for
 * compact, corner-anchored blobs that stand out from their surroundings.
 *
 * Approach: band-pass filtering → adaptive threshold → connected components → scoring.
 */

const CORNER_FRAC = 0.34
const WORK_MAX = 360
const MIN_AREA_FRAC = 0.00008
const MAX_AREA_FRAC = 0.06

export interface WatermarkCandidate {
  x: number
  y: number
  w: number
  h: number
  score: number
  region: string
}

interface Region {
  name: string
  x: number
  y: number
  w: number
  h: number
  ax: number
  ay: number
}

function buildRegions(W: number, H: number): Region[] {
  const cw = Math.round(W * CORNER_FRAC)
  const ch = Math.round(H * CORNER_FRAC)
  return [
    { name: 'bottom-right', x: W - cw, y: H - ch, w: cw, h: ch, ax: 1, ay: 1 },
    { name: 'bottom-left', x: 0, y: H - ch, w: cw, h: ch, ax: 0, ay: 1 },
    { name: 'top-right', x: W - cw, y: 0, w: cw, h: ch, ax: 1, ay: 0 },
    { name: 'top-left', x: 0, y: 0, w: cw, h: ch, ax: 0, ay: 0 },
  ].filter(r => r.w > 8 && r.h > 8)
}

/** Mean over a (2r+1) square window via integral image. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const iw = w + 1
  const I = new Float64Array(iw * (h + 1))
  for (let y = 0; y < h; y++) {
    let rowSum = 0
    for (let x = 0; x < w; x++) {
      rowSum += src[y * w + x]
      I[(y + 1) * iw + (x + 1)] = I[y * iw + (x + 1)] + rowSum
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r)
      const sum = I[(y1 + 1) * iw + (x1 + 1)] - I[y0 * iw + (x1 + 1)]
        - I[(y1 + 1) * iw + x0] + I[y0 * iw + x0]
      out[y * w + x] = sum / ((x1 - x0 + 1) * (y1 - y0 + 1))
    }
  }
  return out
}

function percentile(arr: Float32Array, p: number): number {
  const sorted = Array.from(arr).sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0
}

function dilate(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(bin.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bin[y * w + x]) continue
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r)
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r)
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) out[yy * w + xx] = 1
      }
    }
  }
  return out
}

interface Component {
  minX: number; minY: number; maxX: number; maxY: number; count: number
}

function components(bin: Uint8Array, w: number, h: number): Component[] {
  const seen = new Uint8Array(bin.length)
  const comps: Component[] = []
  const stack: number[] = []
  for (let s = 0; s < bin.length; s++) {
    if (!bin[s] || seen[s]) continue
    let minX = w, minY = h, maxX = -1, maxY = -1, count = 0
    stack.length = 0
    stack.push(s)
    seen[s] = 1
    while (stack.length) {
      const o = stack.pop()!
      const x = o % w, y = (o / w) | 0
      count++
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (x > 0 && bin[o - 1] && !seen[o - 1]) { seen[o - 1] = 1; stack.push(o - 1) }
      if (x < w - 1 && bin[o + 1] && !seen[o + 1]) { seen[o + 1] = 1; stack.push(o + 1) }
      if (y > 0 && bin[o - w] && !seen[o - w]) { seen[o - w] = 1; stack.push(o - w) }
      if (y < h - 1 && bin[o + w] && !seen[o + w]) { seen[o + w] = 1; stack.push(o + w) }
    }
    comps.push({ minX, minY, maxX, maxY, count })
  }
  return comps
}

function iou(a: WatermarkCandidate, b: WatermarkCandidate): number {
  const ix = Math.max(a.x, b.x), iy = Math.max(a.y, b.y)
  const ax = Math.min(a.x + a.w, b.x + b.w), ay = Math.min(a.y + a.h, b.y + b.h)
  if (ix >= ax || iy >= ay) return 0
  const inter = (ax - ix) * (ay - iy)
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

function scanRegion(imageData: ImageData, region: Region, W: number, H: number): WatermarkCandidate[] {
  const { data: src } = imageData
  const scale = Math.min(1, WORK_MAX / Math.max(region.w, region.h))
  const rw = Math.max(8, Math.round(region.w * scale))
  const rh = Math.max(8, Math.round(region.h * scale))
  const n = rw * rh
  const gray = new Float32Array(n)
  const sat = new Float32Array(n)

  for (let y = 0; y < rh; y++) {
    const sy = Math.min(H - 1, region.y + Math.floor(y / scale))
    for (let x = 0; x < rw; x++) {
      const sx = Math.min(W - 1, region.x + Math.floor(x / scale))
      const i = (sy * W + sx) * 4
      const r = src[i], g = src[i + 1], b = src[i + 2]
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      gray[y * rw + x] = 0.299 * r + 0.587 * g + 0.114 * b
      sat[y * rw + x] = mx === 0 ? 0 : (mx - mn) / mx
    }
  }

  const shortSide = Math.min(rw, rh)
  const r1 = Math.max(1, Math.round(shortSide * 0.012))
  const r2 = Math.max(r1 + 3, Math.round(shortSide * 0.18))
  const near = boxBlur(gray, rw, rh, r1)
  const far = boxBlur(gray, rw, rh, r2)
  const resid = new Float32Array(n)
  for (let i = 0; i < n; i++) resid[i] = near[i] - far[i]

  const absResid = new Float32Array(n)
  for (let i = 0; i < n; i++) absResid[i] = Math.abs(resid[i])
  const thr = Math.max(6, percentile(absResid, 0.965))

  const pos = new Uint8Array(n)
  const neg = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (resid[i] >= thr) pos[i] = 1
    else if (resid[i] <= -thr) neg[i] = 1
  }
  const masks = [dilate(pos, rw, rh, 2), dilate(neg, rw, rh, 2)]

  const imageArea = W * H
  const out: WatermarkCandidate[] = []
  for (const mask of masks) {
    for (const comp of components(mask, rw, rh)) {
      const bx = region.x + comp.minX / scale
      const by = region.y + comp.minY / scale
      const bw = (comp.maxX - comp.minX + 1) / scale
      const bh = (comp.maxY - comp.minY + 1) / scale
      const areaFrac = (bw * bh) / imageArea
      if (areaFrac < MIN_AREA_FRAC || areaFrac > MAX_AREA_FRAC) continue
      const aspect = bw / bh
      if (aspect < 0.08 || aspect > 14) continue
      const fill = comp.count / ((comp.maxX - comp.minX + 1) * (comp.maxY - comp.minY + 1))
      if (fill < 0.12) continue

      let strengthSum = 0, satSum = 0, px = 0
      for (let y = comp.minY; y <= comp.maxY; y++) {
        for (let x = comp.minX; x <= comp.maxX; x++) {
          strengthSum += absResid[y * rw + x]
          satSum += sat[y * rw + x]
          px++
        }
      }
      const strength = strengthSum / Math.max(1, px)
      const meanSat = satSum / Math.max(1, px)
      const cxFrac = (bx + bw / 2) / W
      const cyFrac = (by + bh / 2) / H
      const dx = Math.abs(cxFrac - region.ax)
      const dy = Math.abs(cyFrac - region.ay)
      const cornerDist = Math.hypot(dx, dy)

      let score = 0
      score += Math.min(1, strength / 14) * 2.2
      score += Math.min(1, fill / 0.5) * 1.0
      score += Math.max(0, 1 - cornerDist / 0.28) * 1.8
      const sizeIdeal = 0.0025
      score += Math.max(0, 1 - Math.abs(Math.log(areaFrac / sizeIdeal)) / 3.2) * 1.2
      score += (1 - Math.min(1, meanSat / 0.5)) * 0.5

      out.push({
        x: Math.max(0, Math.round(bx)),
        y: Math.max(0, Math.round(by)),
        w: Math.min(W, Math.round(bw)),
        h: Math.min(H, Math.round(bh)),
        score,
        region: region.name,
      })
    }
  }
  return out
}

/**
 * Find likely watermark badges in the image.
 * Returns ranked candidates (best first) in original pixel coordinates.
 */
export function detectWatermarks(
  imageData: ImageData,
  opts: { region?: string; maxResults?: number } = {},
): WatermarkCandidate[] {
  const { width: W, height: H } = imageData
  const maxResults = opts.maxResults ?? 4
  const regions = buildRegions(W, H).filter(r => !opts.region || r.name === opts.region)
  const candidates: WatermarkCandidate[] = []
  for (const region of regions) {
    for (const c of scanRegion(imageData, region, W, H)) candidates.push(c)
  }
  candidates.sort((a, b) => b.score - a.score)

  const kept: WatermarkCandidate[] = []
  for (const c of candidates) {
    if (kept.some(k => iou(k, c) > 0.35)) continue
    kept.push(c)
    if (kept.length >= maxResults) break
  }
  return kept
}
