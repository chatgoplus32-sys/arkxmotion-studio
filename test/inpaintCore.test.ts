// ─── Test inti komposit watermark (murni, tanpa canvas/ONNX) ────────────────
// Modul ini yang menentukan apakah hasil akhir "mulus" atau menyisakan tanda
// blur. Tiga perilaku yang dikunci di sini — semuanya pernah rusak di pipeline
// lama (alpha-feather dari mask biner):
//  1. tidak ada piksel ber-watermark yang bocor ke hasil akhir (bekas hantu);
//  2. nada patch menyambung dengan sekelilingnya (tidak ada bercak lebih gelap);
//  3. tepi tempel tidak menambah lompatan warna yang tidak ada di aslinya.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  autoDilateRadius,
  autoRingBand,
  maskDistanceInside,
  dilateMask,
  maskBounds,
  removeWithSeamCorrection,
  smoothFillField,
  type Raster,
} from '../src/lib/inpaint-core.js'

// ── Helper raster (struktural, sama seperti ImageData) ───────────────────────

function raster(w: number, h: number, fill: [number, number, number] = [128, 128, 128]): Raster {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = fill[0]
    data[i * 4 + 1] = fill[1]
    data[i * 4 + 2] = fill[2]
    data[i * 4 + 3] = 255
  }
  return { width: w, height: h, data }
}

/** Mask kosong (alpha 0 di semua piksel) — bukan gambar, jadi tidak boleh
 *  dibuat lewat raster() yang alpha-nya 255. */
function blankMask(w: number, h: number): Raster {
  const m = raster(w, h)
  for (let i = 0; i < w * h; i++) m.data[i * 4 + 3] = 0
  return m
}

function rectMask(w: number, h: number, r: { x: number; y: number; w: number; h: number }): Raster {
  const m = raster(w, h, [255, 255, 255])
  for (let i = 0; i < w * h; i++) m.data[i * 4 + 3] = 0
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * w + x) * 4
      m.data[i] = 255
      m.data[i + 1] = 255
      m.data[i + 2] = 255
      m.data[i + 3] = 255
    }
  }
  return m
}

function setRect(img: Raster, r: { x: number; y: number; w: number; h: number }, v: [number, number, number]) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * img.width + x) * 4
      img.data[i] = v[0]
      img.data[i + 1] = v[1]
      img.data[i + 2] = v[2]
    }
  }
}

function meanInside(img: Raster, r: { x: number; y: number; w: number; h: number }): number {
  let s = 0
  let n = 0
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * img.width + x) * 4
      s += img.data[i]
      n++
    }
  }
  return s / n
}

function maxDeviation(img: Raster, r: { x: number; y: number; w: number; h: number }, value: number): number {
  let max = 0
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * img.width + x) * 4
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(img.data[i + c] - value)
        if (d > max) max = d
      }
    }
  }
  return max
}

// ── maskBounds / autoDilateRadius / autoRingBand ────────────────────────────

test('maskBounds mengembalikan bbox tepat dan null untuk mask kosong', () => {
  const mask = rectMask(40, 30, { x: 10, y: 5, w: 12, h: 7 })
  assert.deepEqual(maskBounds(mask), { x: 10, y: 5, w: 12, h: 7 })
  assert.equal(maskBounds(blankMask(20, 20)), null)
})

test('autoDilateRadius ~3% sisi terpanjang, dijepit 2..8 px', () => {
  // 228 px → 6.84 → 7. Inilah yang menelan tepi anti-alias watermark.
  assert.equal(autoDilateRadius(rectMask(400, 400, { x: 10, y: 10, w: 228, h: 88 })), 7)
  // mask mungil tetap dapat minimal 2 px supaya tepi tetap ikut diganti.
  assert.equal(autoDilateRadius(rectMask(100, 100, { x: 10, y: 10, w: 20, h: 12 })), 2)
  // mask besar tidak melebar tanpa batas (jangan memakan konten asli).
  assert.equal(autoDilateRadius(rectMask(900, 900, { x: 10, y: 10, w: 800, h: 400 })), 8)
  // mask kosong tidak melebar sama sekali
  assert.equal(autoDilateRadius(blankMask(50, 50)), 0)
})

test('autoRingBand dijepit 3..16 px (ring sampling harus dekat batas)', () => {
  assert.equal(autoRingBand(rectMask(400, 400, { x: 10, y: 10, w: 228, h: 88 })), 16)
  assert.equal(autoRingBand(rectMask(100, 100, { x: 10, y: 10, w: 20, h: 12 })), 6)
})

test('maskDistanceInside: 0 di luar hole dan tumbuh ke dalam', () => {
  const mask = rectMask(40, 40, { x: 10, y: 10, w: 20, h: 20 })
  const d = maskDistanceInside(mask)
  assert.equal(d[5 * 40 + 5], 0)
  assert.equal(d[10 * 40 + 15], 3)
  assert.equal(d[12 * 40 + 20], 9)
  assert.ok(d[20 * 40 + 20] > d[12 * 40 + 20])
})

// ── dilateMask ─────────────────────────────────────────────────────────────

test('dilateMask melebar tepat sebesar radius dan tidak menyentuh piksel lain', () => {
  const mask = rectMask(60, 60, { x: 25, y: 25, w: 8, h: 8 })
  const out = dilateMask(mask, 4)

  // Sudut kotak asli kini menjadi bagian dari area melebar
  assert.equal(out.data[(23 * 60 + 23) * 4 + 3], 255)
  assert.equal(out.data[(27 * 60 + 27) * 4 + 3], 255)
  // Di luar radius tidak berubah
  assert.equal(out.data[(20 * 60 + 20) * 4 + 3], 0)
  assert.equal(out.data[(30 * 60 + 38) * 4 + 3], 0)
  // Bbox bertambah radius di tiap sisi
  assert.deepEqual(maskBounds(out), { x: 21, y: 21, w: 16, h: 16 })
})

test('dilateMask radius 0 mengembalikan salinan tak berubah', () => {
  const mask = rectMask(20, 20, { x: 4, y: 4, w: 5, h: 5 })
  const out = dilateMask(mask, 0)
  assert.deepEqual(Array.from(out.data), Array.from(mask.data))
})

// ── smoothFillField ────────────────────────────────────────────────────────

test('smoothFillField mengisi piksel kosong dengan nilai ring yang rata', () => {
  const w = 16
  const h = 16
  const values = new Float32Array(w * h * 3)
  const known = new Uint8Array(w * h)
  // ring: seluruh tepi gambar bernilai 10
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      known[y * w + x] = 1
      values[(y * w + x) * 3] = 10
    }
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) {
      known[y * w + x] = 1
      values[(y * w + x) * 3] = 10
    }
  }

  const field = smoothFillField(values, known, w, h)
  for (let i = 0; i < w * h; i++) {
    if (known[i]) continue
    assert.ok(Math.abs(field[i * 3] - 10) < 0.01, `piksel ${i} = ${field[i * 3]}`)
  }
})

test('smoothFillField tidak pernah melewati rentang nilai yang diketahui', () => {
  const w = 24
  const h = 24
  const values = new Float32Array(w * h * 3)
  const known = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (x === 0 || x === w - 1) {
        known[i] = 1
        values[i * 3] = x === 0 ? -20 : 40
      }
    }
  }

  const field = smoothFillField(values, known, w, h)
  for (let i = 0; i < w * h; i++) {
    assert.ok(field[i * 3] >= -20.001 && field[i * 3] <= 40.001, `nilai ${field[i * 3]} di luar rentang`)
  }
  // di tengah harus berada di antara kedua tepi (bukan menempel ke salah satu)
  const mid = field[((h >> 1) * w + (w >> 1)) * 3]
  assert.ok(mid > -19 && mid < 39)
})

// ── removeWithSeamCorrection ───────────────────────────────────────────────

test('hasil akhir bersih dari sisa watermark (tidak ada hantu di area rata)', () => {
  const W = 120
  const H = 100
  const hole = { x: 40, y: 30, w: 40, h: 30 }

  // Foto: latar rata 128, plus "watermark" terang 255 di dalam area mask.
  const original = raster(W, H, [128, 128, 128])
  setRect(original, hole, [255, 255, 255])
  // Model sempurna: mengembalikan latar rata.
  const generated = raster(W, H, [128, 128, 128])
  const mask = rectMask(W, H, hole)

  const out = removeWithSeamCorrection(original, generated, mask)
  const result: Raster = { width: W, height: H, data: out }

  // Tidak boleh ada sisa watermark terang: deviasi maksimum harus kecil.
  const max = maxDeviation(result, hole, 128)
  assert.ok(max <= 4, `sisa hantu terlalu besar: max deviasi ${max}`)
  // Rata-rata di dalam mask harus ~128 (bukan campuran dengan piksel 255).
  assert.ok(Math.abs(meanInside(result, hole) - 128) < 1)

  // Di luar area yang diperluas, gambar asli tidak boleh berubah sama sekali.
  assert.equal(result.data[(5 * W + 5) * 4], 128)
  assert.equal(result.data[(95 * W + 115) * 4], 128)
})

test('sambungan di tepi patch mulus; isi patch tidak ikut diubah', () => {
  const W = 120
  const H = 100
  const hole = { x: 40, y: 30, w: 40, h: 30 }
  const dilate = autoDilateRadius(rectMask(W, H, hole))

  const original = raster(W, H, [180, 170, 160])
  // Patch 25 level lebih gelap dari sekitarnya — inilah "bercak nada" yang dulu
  // terlihat. Yang wajib mulus adalah SAMBUNGAN di tepinya; isi patch dibiarkan
  // apa adanya, karena kalau seluruh hole dikoreksi, error rekonstruksi model di
  // ring malah ikut disebar ke seluruh isi patch.
  const generated = raster(W, H, [155, 145, 135])
  const out = removeWithSeamCorrection(original, generated, rectMask(W, H, hole))
  const result: Raster = { width: W, height: H, data: out }

  const inRow = { x: hole.x + 4, y: hole.y - dilate, w: hole.w - 8, h: 1 }
  const outRow = { x: hole.x + 4, y: hole.y - dilate - 1, w: hole.w - 8, h: 1 }
  const stepResult = meanInside(result, inRow) - meanInside(result, outRow)
  const stepOriginal = meanInside(original, inRow) - meanInside(original, outRow)
  assert.ok(
    Math.abs(stepResult - stepOriginal) < 4,
    `ada lompatan di batas patch: ${(stepResult - stepOriginal).toFixed(2)}`,
  )

  // Isi patch tetap seperti hasil model.
  const innerMean = meanInside(result, { x: hole.x + 14, y: hole.y + 12, w: 12, h: 8 })
  assert.ok(Math.abs(innerMean - 155) < 3, `isi patch ikut diubah: ${innerMean}`)

  // Peluruhan koreksi mulus — tidak ada lompatan antar baris (pita).
  let maxJump = 0
  for (let y = hole.y - dilate + 1; y < hole.y + hole.h; y++) {
    const a = meanInside(result, { x: hole.x + 4, y, w: hole.w - 8, h: 1 })
    const b = meanInside(result, { x: hole.x + 4, y: y + 1, w: hole.w - 8, h: 1 })
    maxJump = Math.max(maxJump, Math.abs(a - b))
  }
  assert.ok(maxJump < 10, `peluruhan koreksi bertingkat: ${maxJump.toFixed(2)}`)
})

test('fade Infinity = koreksi hole-wide (opsi eksperimen terdokumentasi)', () => {
  const W = 120
  const H = 100
  const hole = { x: 40, y: 30, w: 40, h: 30 }
  const original = raster(W, H, [180, 170, 160])
  const generated = raster(W, H, [155, 145, 135])
  const out = removeWithSeamCorrection(original, generated, rectMask(W, H, hole), { fade: Infinity })
  const mean = meanInside({ width: W, height: H, data: out }, hole)
  assert.ok(Math.abs(mean - 180) < 2, `koreksi hole-wide gagal: ${mean}`)
})

test('tepi tempel tidak menambah lompatan warna (step test)', () => {
  const W = 120
  const H = 100
  const hole = { x: 40, y: 30, w: 40, h: 30 }
  const dilate = autoDilateRadius(rectMask(W, H, hole))

  // Latar bergradien halus, biar lompatan apa pun langsung terlihat.
  const original = raster(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = 100 + Math.round((x / (W - 1)) * 40)
      const i = (y * W + x) * 4
      original.data[i] = v
      original.data[i + 1] = v
      original.data[i + 2] = v
    }
  }
  // Model memberi nada jauh berbeda (patch rata 90) — kasus terburuk.
  const generated = raster(W, H, [90, 90, 90])
  const out = removeWithSeamCorrection(original, generated, rectMask(W, H, hole))
  const result: Raster = { width: W, height: H, data: out }

  // Tepat DI batas tempel (baris pertama di dalam hole yang dilebarkan):
  // langkahnya harus sama dengan langkah aslinya (tidak ada lompatan baru).
  const yIn = hole.y - dilate
  const yOut = yIn - 1
  let maxStep = 0
  for (let x = hole.x + 4; x < hole.x + hole.w - 4; x++) {
    const stepResult = result.data[(yIn * W + x) * 4] - result.data[(yOut * W + x) * 4]
    const stepOriginal = original.data[(yIn * W + x) * 4] - original.data[(yOut * W + x) * 4]
    maxStep = Math.max(maxStep, Math.abs(stepResult - stepOriginal))
  }
  assert.ok(maxStep <= 4, `batas patch terlihat: lompatan ${maxStep}`)
})

test('mask kosong mengembalikan gambar apa adanya', () => {
  const original = raster(40, 40, [12, 34, 56])
  const generated = raster(40, 40, [200, 200, 200])
  const out = removeWithSeamCorrection(original, generated, blankMask(40, 40))
  assert.deepEqual(Array.from(out), Array.from(original.data))
})

test('dilate 0 hanya mengganti piksel mask user; auto ikut menelan tepi', () => {
  const W = 60
  const H = 60
  const hole = { x: 20, y: 20, w: 10, h: 10 }
  // Watermark (terang) sedikit lebih besar dari mask user — persis kasus nyata
  // saat pengguna menggambar mask agak ke dalam. Selisihnya 2 px, masih dalam
  // jangkauan pelebaran otomatis.
  const original = raster(W, H, [30, 30, 30])
  setRect(original, { x: hole.x - 2, y: hole.y - 2, w: hole.w + 4, h: hole.h + 4 }, [250, 250, 250])
  const generated = raster(W, H, [30, 30, 30])
  const mask = rectMask(W, H, hole)

  // dilate 0: piksel tepat di luar mask tetap membawa watermark (tidak dibersihkan)
  const tight = removeWithSeamCorrection(original, generated, mask, { dilate: 0, feather: 0 })
  // (hole.y - 2) = baris tepi watermark, masih di LUAR mask user.
  assert.equal(tight[((hole.y - 2) * W + hole.x + 5) * 4], 250)
  // …tapi di dalam mask sudah bersih
  assert.ok(Math.abs(tight[((hole.y + 5) * W + hole.x + 5) * 4] - 30) <= 2)

  // auto dilate: tepi watermark di luar mask ikut dibersihkan
  const auto = removeWithSeamCorrection(original, generated, mask)
  assert.ok(Math.abs(auto[((hole.y - 2) * W + hole.x + 5) * 4] - 30) <= 3)
})
