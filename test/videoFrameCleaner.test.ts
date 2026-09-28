// ─── Test pembersih watermark video PER-FRAME ────────────────────────────────
// Yang dikunci di sini:
//  1. patch tidak "beku": hasil tiap frame mengikuti konten frame itu sendiri
//     (ini akar masalah video lama — patch dari frame pertama dipakai terus);
//  2. pembersihan tetap seam-aware: tidak ada lompatan warna di tepi patch;
//  3. piksel di luar mask tidak disentuh;
//  4. mask kosong = tidak ada perubahan sama sekali;
//  5. OPTIMASI 1080p tidak mengubah hasil satu bit pun:
//     - mask hasil dilatasi di jendela == hasil dilatasi penuh frame;
//     - komposit cepat == komposit umum (removeWithSeamCorrection);
//     - buffer scratch yang dipakai ulang tidak membocorkan frame sebelumnya.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  cleanFrameData,
  planSeamFrame,
  filledHoleValues,
  type SeamFramePlan,
} from '../src/lib/video-frame-cleaner.js'
import {
  autoDilateRadius,
  dilateMask,
  maskBounds,
  removeWithSeamCorrection,
  type Raster,
} from '../src/lib/inpaint-core.js'

const W = 160
const H = 120
// Kotak watermark di tengah frame.
const WM = { x: 60, y: 50, w: 40, h: 20 }

type PixelFn = (x: number, y: number) => [number, number, number]

/** Bangun frame RGBA penuh (latar halus + watermark kotak putih semi-transparan). */
function makeFrame(bg: PixelFn, withWatermark: boolean): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      let [r, g, b] = bg(x, y)
      if (withWatermark && x >= WM.x && x < WM.x + WM.w && y >= WM.y && y < WM.y + WM.h) {
        const k = 0.7
        r = r * (1 - k) + 255 * k
        g = g * (1 - k) + 255 * k
        b = b * (1 - k) + 255 * k
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
    }
  }
  return data
}

/** Mask kotak solid (alpha 255) — kasus umum mask hasil deteksi/kuas. */
function makeMask(alpha = 255): Raster {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = WM.y; y < WM.y + WM.h; y++) {
    for (let x = WM.x; x < WM.x + WM.w; x++) data[(y * W + x) * 4 + 3] = alpha
  }
  return { width: W, height: H, data }
}

function cropOf(frame: Uint8ClampedArray, plan: SeamFramePlan): Uint8ClampedArray {
  const { x, y, w, h } = plan.crop
  const out = new Uint8ClampedArray(w * h * 4)
  for (let cy = 0; cy < h; cy++) {
    const src = ((y + cy) * W + x) * 4
    out.set(frame.subarray(src, src + w * 4), cy * w * 4)
  }
  return out
}

function pasteCropIntoFull(full: Uint8ClampedArray, crop: Uint8ClampedArray, plan: SeamFramePlan): void {
  const { x, y, w, h } = plan.crop
  for (let cy = 0; cy < h; cy++) {
    const dst = ((y + cy) * W + x) * 4
    full.set(crop.subarray(cy * w * 4, cy * w * 4 + w * 4), dst)
  }
}

/** Bersihkan satu frame penuh (crop → bersihkan → tempel balik). */
function cleanFullFrame(frame: Uint8ClampedArray, plan: SeamFramePlan): Uint8ClampedArray {
  const out = new Uint8ClampedArray(frame)
  const crop = cropOf(out, plan)
  cleanFrameData(crop, plan)
  pasteCropIntoFull(out, crop, plan)
  return out
}

/** MAE di dalam kotak watermark. */
function maeInHole(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0, n = 0
  for (let y = WM.y; y < WM.y + WM.h; y++) {
    for (let x = WM.x; x < WM.x + WM.w; x++) {
      const i = (y * W + x) * 4
      for (let c = 0; c < 3; c++) { sum += Math.abs(a[i + c] - b[i + c]); n++ }
    }
  }
  return sum / n
}

/** Lompatan warna tepat di tepi luar kotak watermark. */
function edgeStep(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0, n = 0
  for (let x = WM.x - 1; x <= WM.x + WM.w; x++) {
    for (const y of [WM.y - 1, WM.y + WM.h]) {
      const i = (y * W + x) * 4
      for (let c = 0; c < 3; c++) { sum += Math.abs(a[i + c] - b[i + c]); n++ }
    }
  }
  return sum / n
}

/** Jumlah byte yang berbeda antara dua buffer. */
function byteDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let d = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++
  return d
}

const SMOOTH: PixelFn = (x, y) => [40 + x, 60 + y * 0.5, 120 - x * 0.2]
const BRIGHT: PixelFn = (x, y) => [190 + x * 0.1, 180, 160 - y * 0.1]
const DARK: PixelFn = (x, y) => [30 + x * 0.1, 40, 60 - y * 0.1]

test('planSeamFrame → null untuk mask kosong', () => {
  const empty: Raster = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) }
  assert.equal(planSeamFrame(empty, W, H), null)
})

test('planSeamFrame → crop mencakup mask + ring, tetap di dalam frame', () => {
  const plan = planSeamFrame(makeMask(), W, H)
  assert.ok(plan)
  assert.ok(plan!.crop.x <= WM.x && plan!.crop.y <= WM.y)
  assert.ok(plan!.crop.x + plan!.crop.w >= WM.x + WM.w)
  assert.ok(plan!.crop.y + plan!.crop.h >= WM.y + WM.h)
  assert.ok(plan!.crop.x >= 0 && plan!.crop.y >= 0)
  assert.ok(plan!.crop.x + plan!.crop.w <= W && plan!.crop.y + plan!.crop.h <= H)
  assert.ok(plan!.holePixels >= WM.w * WM.h)
})

test('cleanFrameData → watermark hilang dari area hole', () => {
  const plan = planSeamFrame(makeMask(), W, H)!
  const clean = makeFrame(SMOOTH, false)
  const dirty = makeFrame(SMOOTH, true)

  const before = maeInHole(dirty, clean)
  const cleaned = cleanFullFrame(dirty, plan)
  const after = maeInHole(cleaned, clean)

  assert.ok(before > 60, `watermark harus jelas sebelum dibersihkan (${before.toFixed(1)})`)
  assert.ok(after < before * 0.35, `sisa watermark harus turun drastis (${after.toFixed(1)} vs ${before.toFixed(1)})`)
})

test('cleanFrameData → tepi patch menyambung (tidak ada lompatan warna)', () => {
  const plan = planSeamFrame(makeMask(), W, H)!
  const clean = makeFrame(SMOOTH, false)
  const cleaned = cleanFullFrame(makeFrame(SMOOTH, true), plan)
  const step = edgeStep(cleaned, clean)
  assert.ok(step < 6, `lompatan tepi harus kecil, dapat ${step.toFixed(2)}`)
})

test('cleanFrameData → piksel di luar mask tidak disentuh', () => {
  const plan = planSeamFrame(makeMask(), W, H)!
  const dirty = makeFrame(SMOOTH, true)
  const snapshot = new Uint8ClampedArray(dirty)
  const cleaned = cleanFullFrame(dirty, plan)
  const { x, y, w, h } = plan.crop

  let changed = 0
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const li = (cy * w + cx) * 4
      if (plan.mask[li + 3] > 16) continue // di dalam hole: boleh berubah
      const fi = ((y + cy) * W + (x + cx)) * 4
      for (let c = 0; c < 3; c++) if (cleaned[fi + c] !== snapshot[fi + c]) changed++
    }
  }
  assert.equal(changed, 0, `piksel di luar mask harus identik (${changed} byte berubah)`)
})

test('per-frame → patch mengikuti frame, bukan beku dari frame pertama', () => {
  const plan = planSeamFrame(makeMask(), W, H)!
  const clean2 = makeFrame(DARK, false)
  const dirty2 = makeFrame(DARK, true)

  // Cara LAMA: bersihkan frame 1 sekali, lalu tempelkan patch itu ke frame 2.
  const cleaned1 = cleanFullFrame(makeFrame(BRIGHT, true), plan)
  const frozen2 = new Uint8ClampedArray(dirty2)
  pasteCropIntoFull(frozen2, cropOf(cleaned1, plan), plan)

  // Cara BARU: bersihkan frame 2 dari konteksnya sendiri.
  const perFrame2 = cleanFullFrame(dirty2, plan)

  const frozenErr = maeInHole(frozen2, clean2)
  const perFrameErr = maeInHole(perFrame2, clean2)

  assert.ok(
    perFrameErr < frozenErr * 0.5,
    `per-frame harus jauh lebih dekat ke ground truth (per-frame=${perFrameErr.toFixed(1)}, beku=${frozenErr.toFixed(1)})`,
  )
})

// ─── Optimasi 1080p: hasil harus tetap identik ───────────────────────────────

test('optimasi: mask hasil dilatasi di jendela = dilatasi penuh frame', () => {
  const mask = makeMask()
  const plan = planSeamFrame(mask, W, H)!
  // Cara LAMA: dilatasikan atas seluruh frame, lalu dipotong.
  const fullHole = dilateMask(mask, autoDilateRadius(mask))
  const bounds = maskBounds(fullHole)!
  const oldCrop = {
    x: Math.max(0, bounds.x - (plan.band)),
    y: Math.max(0, bounds.y - (plan.band)),
  }
  // Bandingkan isi mask di area crop rencana baru (koordinat frame → lokal).
  for (let cy = 0; cy < plan.crop.h; cy++) {
    for (let cx = 0; cx < plan.crop.w; cx++) {
      const fx = plan.crop.x + cx
      const fy = plan.crop.y + cy
      const expected = fullHole.data[(fy * W + fx) * 4 + 3]
      const got = plan.mask[(cy * plan.crop.w + cx) * 4 + 3]
      assert.equal(got, expected, `alpha mask beda di (${fx},${fy})`)
    }
  }
  assert.ok(oldCrop.x >= 0 && oldCrop.y >= 0)
})

test('optimasi: komposit cepat = komposit umum (bit-per-bit)', () => {
  for (const alpha of [255, 180]) {
    const plan = planSeamFrame(makeMask(alpha), W, H)!
    const dirty = makeFrame(SMOOTH, true)

    // Jalur cepat (produksi): nilai isian + komposit in-place.
    const fast = new Uint8ClampedArray(dirty)
    const fastCrop = cropOf(fast, plan)
    cleanFrameData(fastCrop, plan)
    pasteCropIntoFull(fast, fastCrop, plan)

    // Jalur umum lama: generated (isian di dalam hole) → removeWithSeamCorrection.
    const { w, h } = plan.crop
    const crop = cropOf(dirty, plan)
    const filled = filledHoleValues(plan, crop)
    const generated = new Uint8ClampedArray(crop)
    for (let i = 0; i < w * h; i++) {
      if (plan.mask[i * 4 + 3] <= 16) continue
      for (let c = 0; c < 3; c++) generated[i * 4 + c] = Math.min(255, Math.max(0, filled[i * 3 + c]))
    }
    const generalCrop = removeWithSeamCorrection(
      { width: w, height: h, data: crop },
      { width: w, height: h, data: generated },
      { width: w, height: h, data: plan.mask },
      { dilate: 0, band: plan.band, feather: 0, fade: plan.fade },
    )
    const general = new Uint8ClampedArray(dirty)
    pasteCropIntoFull(general, generalCrop, plan)

    assert.equal(byteDiff(fast, general), 0, `alpha ${alpha}: komposit cepat tidak sama dengan komposit umum`)
  }
})

test('optimasi: buffer scratch dipakai ulang tanpa membocorkan frame sebelumnya', () => {
  const shared = planSeamFrame(makeMask(), W, H)!
  const fresh = planSeamFrame(makeMask(), W, H)!

  // Frame pertama mengisi scratch, frame kedua harus tetap bersih dari sisanya.
  cleanFullFrame(makeFrame(BRIGHT, true), shared)
  const second = cleanFullFrame(makeFrame(DARK, true), shared)
  const secondFresh = cleanFullFrame(makeFrame(DARK, true), fresh)

  assert.equal(byteDiff(second, secondFresh), 0, 'scratch bocor antar frame')
})
