/**
 * Exemplar fill — repair a hole by copying real texture from the same image.
 *
 * For repetitive textures (wood, brick, fabric, paper, walls), this copies
 * the hole's contents from a nearby matching region instead of inventing pixels.
 * Falls back to MI-GAN when no good exemplar exists.
 */

interface MaskBbox {
  x: number; y: number; w: number; h: number
}

function maskBbox(maskData: ImageData): MaskBbox | null {
  const { width: w, height: h, data } = maskData
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 64) {
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

export interface TextureFillResult {
  result: ImageData
  confidence: number
  offset: { dx: number; dy: number }
}

/**
 * Try to fill the masked region by copying real texture from nearby.
 * Returns the result + confidence (0..1). Low confidence = no good exemplar.
 */
export function textureFill(
  imageData: ImageData,
  maskData: ImageData,
  opts: { searchRadius?: number; band?: number } = {},
): TextureFillResult {
  const { width: W, height: H } = imageData
  const band = opts.band ?? 10
  const bbox = maskBbox(maskData)
  if (!bbox) return { result: imageData, confidence: 0, offset: { dx: 0, dy: 0 } }

  const { x: hx, y: hy, w: hw, h: hh } = bbox
  const searchRadius = opts.searchRadius ?? Math.max(48, Math.round(Math.max(hw, hh) * 4))
  const src = imageData.data
  const msk = maskData.data
  const isHole = (x: number, y: number) => msk[(y * W + x) * 4 + 3] > 64

  // Collect known ring around the hole
  const ring: number[] = []
  for (let y = hy - band; y < hy + hh + band; y++) {
    for (let x = hx - band; x < hx + hw + band; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue
      if (isHole(x, y)) continue
      if (x >= hx && x < hx + hw && y >= hy && y < hy + hh) continue
      ring.push(y * W + x)
    }
  }
  if (ring.length < 40) return { result: imageData, confidence: 0, offset: { dx: 0, dy: 0 } }

  const step = Math.max(1, Math.floor(ring.length / 400))
  const probes: number[] = []
  for (let i = 0; i < ring.length; i += step) probes.push(ring[i])

  let best: { dx: number; dy: number; mse: number } | null = null
  const allErrors: number[] = []

  const evaluate = (dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return
    if (hx + dx < 0 || hy + dy < 0 || hx + dx + hw > W || hy + dy + hh > H) return
    if (Math.abs(dx) < hw && Math.abs(dy) < hh) return
    let sse = 0, n = 0
    for (let k = 0; k < probes.length; k++) {
      const o = probes[k]
      const x = o % W, y = (o / W) | 0
      const sx = x + dx, sy = y + dy
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) return
      if (isHole(sx, sy)) continue
      const a = o * 4, b = (sy * W + sx) * 4
      const dr = src[a] - src[b], dg = src[a + 1] - src[b + 1], db = src[a + 2] - src[b + 2]
      sse += dr * dr + dg * dg + db * db
      n += 3
    }
    if (n < probes.length) return
    const mse = sse / n
    allErrors.push(mse)
    if (!best || mse < best.mse) best = { dx, dy, mse }
  }

  const coarse = Math.max(2, Math.round(searchRadius / 16))
  for (let dy = -searchRadius; dy <= searchRadius; dy += coarse) {
    for (let dx = -searchRadius; dx <= searchRadius; dx += coarse) evaluate(dx, dy)
  }
  if (!best) return { result: imageData, confidence: 0, offset: { dx: 0, dy: 0 } }

  const c = best
  for (let dy = c.dy - coarse; dy <= c.dy + coarse; dy++) {
    for (let dx = c.dx - coarse; dx <= c.dx + coarse; dx++) evaluate(dx, dy)
  }

  // Confidence
  const sorted = allErrors.slice().sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : Infinity
  const confidence = (!median || !Number.isFinite(median))
    ? 0
    : Math.max(0, Math.min(1, 1 - best!.mse / median))

  // Copy the hole
  const out = new Uint8ClampedArray(src)
  for (let y = hy; y < hy + hh; y++) {
    for (let x = hx; x < hx + hw; x++) {
      if (!isHole(x, y)) continue
      const sx = x + best!.dx, sy = y + best!.dy
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue
      const d = (y * W + x) * 4, s = (sy * W + sx) * 4
      out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = 255
    }
  }

  return {
    result: new ImageData(out, W, H),
    confidence,
    offset: { dx: best!.dx, dy: best!.dy },
  }
}
