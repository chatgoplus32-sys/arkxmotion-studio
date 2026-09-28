/**
 * Pembersih watermark **per frame** untuk video (watermark non-Gemini).
 *
 * Masalah yang diselesaikan: jalur lama membangun SATU patch dari frame pertama
 * lalu menempelkannya ke semua frame ("patch beku"). Kalau ada gerakan —
 * kamera geser, orang jalan, rambut bergerak — area di belakang watermark
 * terlihat diam/nempel, dan itu terlihat jelas pada video.
 *
 * Pendekatan: untuk tiap frame, area watermark dibersihkan ulang dari konteks
 * frame ITU sendiri (ring fill + komposit seam-aware dari inpaint-core).
 *
 * ── Kenapa file ini ditulis ulang (kecepatan 1080p) ──────────────────────────
 * Versi pertama bekerja benar tapi boros: tiap frame ia mengalokasi belasan
 * array besar, mengurutkan ribuan nilai untuk estimasi nada, dan menjalankan
 * dua pyramid fill — padahal sebagian besar pekerjaan itu terbukti NOL (lihat
 * catatan komposit di bawah). Untuk video 1080p itu berarti puluhan sampai
 * ratusan ms per frame: jauh lebih lambat dari realtime, jadi frame terbuang.
 *
 * Sekarang semua yang tidak berubah antar frame dihitung SEKALI di
 * `planSeamFrame` (geometri, daftar piksel hole, tabel pyramid, buffer
 * scratch), dan tiap frame hanya melakukan kerja yang bergantung pada isi
 * frame:
 *   1. salin crop → buffer scratch (`pyramid.source()`),
 *   2. pyramid smooth fill ke buffer yang sudah ada,
 *   3. tulis piksel hole langsung ke crop (tanpa alokasi).
 *
 * ── Catatan komposit (ini yang menghapus separuh biaya) ──────────────────────
 * Pada jalur ini `generated` adalah salinan frame yang HANYA berbeda di dalam
 * hole. Karena itu selisih nada (original − generated) di ring luar hole
 * identik nol, jadi bidang koreksi nada hasil `removeWithSeamCorrection` juga
 * nol — seluruh perhitungannya (pemindaian ring, percentile, distance
 * transform, pyramid kedua) tidak pernah mengubah satu piksel pun. Kompositnya
 * menyusut jadi rumus yang benar-benar dipakai:
 *
 *     out = clamp(generated · alpha + original · (1 − alpha))
 *
 * Kesetaraan bit-per-bit dengan `removeWithSeamCorrection` dikunci oleh
 * test/videoFrameCleaner.test.ts ("komposit cepat = komposit umum").
 */

import {
  MASK_THRESHOLD,
  autoDilateRadiusFor,
  autoFadeBandFor,
  autoRingBandFor,
  dilateMask,
  maskBounds,
  SmoothFillPyramid,
  type Bounds,
  type Raster,
} from './inpaint-core.js'

export interface SeamFramePlan {
  /** Wilayah yang dibaca/ditulis ulang tiap frame (koordinat frame penuh). */
  crop: Bounds
  /** Mask hasil dilatasi, koordinat crop, RGBA (alpha = bagian hole). */
  mask: Uint8ClampedArray
  /** Lebar ring untuk belajar nada (dipakai uji kesetaraan komposit). */
  band: number
  /** Jarak memudarnya koreksi nada dari tepi patch ke dalam. */
  fade: number
  /** Jumlah piksel hole di dalam crop (diagnostik). */
  holePixels: number

  // ── Geometri siap pakai (tidak berubah antar frame) ────────────────────────
  /** Indeks piksel hole di dalam crop (koordinat lokal). */
  holeIdx: Int32Array
  /**
   * 1 = piksel asli frame (sumber isian), 0 = hole. Float32Array supaya
   * pyramid bisa menyalinnya dengan satu operasi memori.
   */
  known: Float32Array
  /** True bila semua piksel hole alpha penuh (kasus mask hasil deteksi). */
  binaryAlpha: boolean
  /** Pyramid push-pull yang buffernya dipakai ulang tiap frame. */
  pyramid: SmoothFillPyramid
}

export interface SeamFramePlanOpts {
  /** Pelebaran mask (px). Default: otomatis dari ukuran watermark. */
  dilate?: number
  /** Lebar ring di sekitar hole yang ikut dibaca (px). Default: otomatis. */
  margin?: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * Scratch 1 byte untuk membulatkan nilai isian persis seperti saat disimpan ke
 * ImageData (Uint8ClampedArray) — supaya hasilnya bit-identik dengan jalur
 * lama. Dipakai ulang; bukan untuk pemakaian paralel.
 */
const u8 = new Uint8ClampedArray(1)

/**
 * Hitung rencana pembersihan dari mask yang digambar user.
 *
 * Dilatasi mask dihitung di **jendela** di sekitar watermark, bukan pada
 * seluruh frame: pada 1080p, `dilateMask` atas 2 juta piksel butuh ratusan ms,
 * sedangkan atas crop watermark hanya belasan ms. Hasilnya identik karena
 * dilatasi radius ≤ 8 px tidak bisa dipengaruhi piksel di luar jendela.
 *
 * @returns null bila mask kosong (tidak ada yang perlu dibersihkan).
 */
export function planSeamFrame(
  mask: Raster,
  width: number,
  height: number,
  opts: SeamFramePlanOpts = {},
): SeamFramePlan | null {
  const bounds = maskBounds(mask)
  if (!bounds) return null

  const radius = Math.max(0, Math.round(opts.dilate ?? autoDilateRadiusFor(bounds)))
  const margin = Math.max(2, Math.round(opts.margin ?? autoRingBandFor(bounds) + 2))

  // Jendela kerja: bbox mask + ruang untuk dilatasi + ring.
  const wx = clamp(bounds.x - radius - margin, 0, Math.max(0, width - 1))
  const wy = clamp(bounds.y - radius - margin, 0, Math.max(0, height - 1))
  const wx2 = clamp(bounds.x + bounds.w + radius + margin, wx + 1, width)
  const wy2 = clamp(bounds.y + bounds.h + radius + margin, wy + 1, height)
  const ww = wx2 - wx
  const wh = wy2 - wy

  // Mask lokal (hanya alpha yang dibaca hilir) → dilatasikan di jendela ini.
  const local = new Uint8ClampedArray(ww * wh * 4)
  for (let cy = 0; cy < wh; cy++) {
    const src = ((wy + cy) * width + wx) * 4
    for (let cx = 0; cx < ww; cx++) {
      local[(cy * ww + cx) * 4 + 3] = mask.data[src + cx * 4 + 3]
    }
  }
  const holeLocal = dilateMask({ width: ww, height: wh, data: local }, radius)
  const holeBounds = maskBounds(holeLocal)
  if (!holeBounds) return null

  // Crop = bounds hole (koordinat frame penuh) ± ring, dijepit ke dalam frame.
  const bx = wx + holeBounds.x
  const by = wy + holeBounds.y
  const x = clamp(bx - margin, 0, Math.max(0, width - 1))
  const y = clamp(by - margin, 0, Math.max(0, height - 1))
  const x2 = clamp(bx + holeBounds.w + margin, x + 1, width)
  const y2 = clamp(by + holeBounds.h + margin, y + 1, height)
  const crop: Bounds = { x, y, w: x2 - x, h: y2 - y }

  // Mask hole koordinat crop (dari hasil dilatasi lokal) + daftar pikselnya.
  const n = crop.w * crop.h
  const maskOut = new Uint8ClampedArray(n * 4)
  const known = new Float32Array(n)
  const holeList: number[] = []
  let binaryAlpha = true
  const ox = x - wx
  const oy = y - wy
  for (let cy = 0; cy < crop.h; cy++) {
    for (let cx = 0; cx < crop.w; cx++) {
      const a = holeLocal.data[((oy + cy) * ww + (ox + cx)) * 4 + 3]
      const i = cy * crop.w + cx
      maskOut[i * 4 + 3] = a
      if (a > MASK_THRESHOLD) {
        holeList.push(i)
        if (a !== 255) binaryAlpha = false
      } else {
        known[i] = 1
      }
    }
  }
  if (holeList.length === 0) return null

  return {
    crop,
    mask: maskOut,
    band: autoRingBandFor(bounds) + 2,
    fade: autoFadeBandFor(bounds),
    holePixels: holeList.length,
    holeIdx: Int32Array.from(holeList),
    known,
    binaryAlpha,
    pyramid: new SmoothFillPyramid(crop.w, crop.h),
  }
}

/**
 * Isi hole dari ring di sekitarnya (pyramid smooth fill).
 *
 * Nilai RGB crop disalin ke buffer sumber milik pyramid (tanpa alokasi) dan
 * hasil isian ditulis ke buffer level-0 milik pyramid yang sama.
 *
 * @returns buffer hasil (dimiliki `plan.pyramid` — ditimpa pemanggilan berikutnya).
 */
export function filledHoleValues(plan: SeamFramePlan, data: Uint8ClampedArray): Float32Array {
  const n = plan.crop.w * plan.crop.h
  const src = plan.pyramid.source()
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    src[i * 3] = data[j]
    src[i * 3 + 1] = data[j + 1]
    src[i * 3 + 2] = data[j + 2]
  }
  return plan.pyramid.fillInput(plan.known)
}

/**
 * Tempel hasil isian ke piksel hole **di tempat** (in-place).
 *
 * `field` (koreksi nada) tidak dihitung: pada jalur ini nilainya identik nol,
 * sehingga rumusnya cukup campuran alpha antara hasil isian dan piksel asli.
 * Kesetaraannya dengan komposit umum diuji di test/videoFrameCleaner.test.ts.
 */
export function compositeHoleInPlace(
  data: Uint8ClampedArray,
  plan: SeamFramePlan,
  filled: Float32Array,
): void {
  const { holeIdx } = plan
  if (plan.binaryAlpha) {
    // alpha 255 → 1·isian + 0·asli = isian, jadi nilai bisa disalin langsung.
    for (let k = 0; k < holeIdx.length; k++) {
      const pi = holeIdx[k] * 4
      const fi = holeIdx[k] * 3
      data[pi] = filled[fi]
      data[pi + 1] = filled[fi + 1]
      data[pi + 2] = filled[fi + 2]
      data[pi + 3] = 255
    }
    return
  }

  // Mask ber-alpha halus: tiru jalur lama PERSIS — nilai isian dibulatkan ke
  // 0..255 dulu (seperti saat disimpan ke ImageData `generated`), baru dicampur.
  const mask = plan.mask
  for (let k = 0; k < holeIdx.length; k++) {
    const i = holeIdx[k]
    const pi = i * 4
    const fi = i * 3
    const alpha = mask[pi + 3] / 255
    for (let c = 0; c < 3; c++) {
      u8[0] = filled[fi + c]
      const v = u8[0] * alpha + data[pi + c] * (1 - alpha)
      data[pi + c] = v < 0 ? 0 : v > 255 ? 255 : v
    }
    data[pi + 3] = 255
  }
}

/**
 * Bersihkan satu crop frame **di tempat** (in-place).
 *
 * `data` adalah RGBA crop berukuran `plan.crop.w × plan.crop.h`.
 * Murni: tidak menyentuh DOM, jadi bisa diuji di Node. Aman dipanggil berurutan
 * untuk banyak frame (buffer scratch dipakai ulang, tidak ada state sisa).
 */
export function cleanFrameData(data: Uint8ClampedArray, plan: SeamFramePlan): void {
  const filled = filledHoleValues(plan, data)
  compositeHoleInPlace(data, plan, filled)
}

export interface SeamFrameProcessor {
  plan: SeamFramePlan
  /** Panggil setelah frame video digambar ke ctx. */
  process: (ctx: CanvasRenderingContext2D) => void
  /** Jumlah frame yang sudah dibersihkan. */
  frames: () => number
  /** Rata-rata waktu bersih per frame (ms) — untuk laporan progres. */
  avgMs: () => number
  /**
   * Perkiraan waktu pemrosesan untuk 1 MENIT video (detik), dihitung dari
   * kecepatan pembersihan rata-rata yang sudah terukur pada video yang jalan.
   */
  secondsPerMinute: (fps?: number) => number
}

/**
 * Buat pembersih yang dipakai `processVideo({ frameProcessor })`.
 *
 * @returns null bila mask kosong.
 */
export function createSeamFrameProcessor(
  mask: Raster,
  width: number,
  height: number,
  opts: SeamFramePlanOpts = {},
): SeamFrameProcessor | null {
  const plan = planSeamFrame(mask, width, height, opts)
  if (!plan) return null

  let count = 0
  let totalMs = 0
  const { x, y, w, h } = plan.crop

  return {
    plan,
    process(ctx) {
      const t0 = performance.now()
      // Satu-satunya I/O canvas di jalur ini: baca crop, bersihkan di tempat,
      // tulis balik. Tidak ada kopi penuh-frame 1080p per frame.
      const frame = ctx.getImageData(x, y, w, h)
      cleanFrameData(frame.data, plan)
      ctx.putImageData(frame, x, y)
      totalMs += performance.now() - t0
      count++
    },
    frames: () => count,
    avgMs: () => (count > 0 ? totalMs / count : 0),
    secondsPerMinute: (fps = 30) => (count > 0 ? ((totalMs / count) * fps * 60) / 1000 : 0),
  }
}
