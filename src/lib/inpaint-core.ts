/**
 * Inti komposit penghapusan watermark — murni (tanpa canvas/ONNX/DOM) supaya
 * bisa diuji di Node.
 *
 * Masalah yang diselesaikan: pipeline lama menempelkan hasil model dengan
 * alpha-feather dari mask biner. Dua akibatnya terlihat sebagai "tanda blur":
 * 1. Di tepi, piksel hasil model dicampur dengan piksel ASLI yang masih
 *    mengandung watermark (bukan piksel bersih), jadi sisa logo tetap samar.
 * 2. Warna/pencahayaan patch tidak dijamin nyambung dengan sekelilingnya,
 *    sehingga bekas patch terlihat sebagai bercak.
 *
 * Pendekatan baru (3 langkah):
 * 1. Dilatasi mask — menelan tepi anti-alias watermark yang tidak ikut ter-mask.
 * 2. Pelajari selisih nada (original - generated) pada RING di luar hole, lalu
 *    rambatkan bidang selisih itu mulus ke dalam hole (push-pull pyramid —
 *    pendekatan murah dari harmonic/Poisson interpolation).
 * 3. Komposit: generated + bidang koreksi mulus. Di tepi hole nilainya otomatis
 *    menyambung dengan gambar asli, dan tidak ada pencampuran dengan piksel
 *    ber-watermark.
 */

export interface Raster {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

/** Ambang alpha yang dianggap bagian dari hole (mask digambar oleh user). */
export const MASK_THRESHOLD = 16

/** Nilai tengah — dipakai untuk estimasi bias ring yang tahan outlier. */
function median(values: Float32Array): number {
  return percentile(values, 0.5)
}

/** Persentil (0..1) dari nilai — dipakai untuk mengambil sisi "kecil" selisih. */
function percentile(values: Float32Array, q: number): number {
  if (values.length === 0) return 0
  const arr = Array.from(values).sort((a, b) => a - b)
  const idx = Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * q)))
  return arr[idx]
}

export function maskBounds(mask: Raster, threshold = MASK_THRESHOLD): Bounds | null {
  const { width: w, height: h, data } = mask
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
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

/**
 * Radius pelebaran otomatis: ~3% dari sisi terpanjang mask (min 2px, maks 8px).
 * Cukup untuk menelan tepi anti-alias tanpa memakan konten asli.
 */
export function autoDilateRadius(mask: Raster): number {
  const b = maskBounds(mask)
  if (!b) return 0
  return autoDilateRadiusFor(b)
}

/**
 * Lebar ring SAMPLING nada. Sengaja sempit dan dekat batas: yang kita butuhkan
 * adalah nada tepat di luar patch, bukan rata-rata seluruh gambar.
 */
export function autoRingBand(mask: Raster): number {
  const b = maskBounds(mask)
  if (!b) return 8
  return autoRingBandFor(b)
}

/**
 * Jarak fade koreksi nada dari batas patch ke dalam. Koreksi sengaja TIDAK
 * dibawa sampai tengah patch: selisih (original - generated) di ring sebagian
 * berasal dari error rekonstruksi model di area terlihat, bukan dari bias isi
 * patch. Kalau disebar ke seluruh hole, justru menambah bercak nada.
 */
export function autoFadeBand(mask: Raster): number {
  const b = maskBounds(mask)
  if (!b) return 6
  return autoFadeBandFor(b)
}

// ─── Varian berbasis `bounds` ────────────────────────────────────────────────
// Ketiga angka di bawah hanya bergantung pada bbox mask. Kalau bbox-nya sudah
// diketahui (pembersih video menghitungnya sekali per video), memindai mask
// penuh 1920×1080 tiga kali lagi hanya membuang puluhan ms di 1080p.

export function autoDilateRadiusFor(b: Bounds): number {
  return Math.max(2, Math.min(8, Math.round(Math.max(b.w, b.h) * 0.03)))
}

/**
 * Minimal 6 px: kalau ring terlalu tipis, ring bisa seluruhnya berisi sisa
 * watermark sehingga estimasi nada ikut keracunan.
 */
export function autoRingBandFor(b: Bounds): number {
  return Math.max(6, Math.min(16, Math.round(Math.max(b.w, b.h) * 0.15)))
}

export function autoFadeBandFor(b: Bounds): number {
  return Math.max(5, Math.min(24, Math.round(Math.max(b.w, b.h) * 0.12)))
}

/**
 * Jarak tiap piksel hole ke batas luar hole (chamfer 3/4, satuan = 3 per piksel).
 * Piksel di luar hole bernilai 0. Dipakai sebagai bobot fade koreksi nada.
 */
export function maskDistanceInside(mask: Raster, threshold = MASK_THRESHOLD): Float32Array {
  const { width: w, height: h, data } = mask
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) d[i] = data[i * 4 + 3] > threshold ? INF : 0

  const relax = (i: number, j: number, cost: number) => {
    const v = d[j] + cost
    if (v < d[i]) d[i] = v
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (d[i] === 0) continue
      if (x > 0) relax(i, i - 1, 3)
      if (y > 0) relax(i, i - w, 3)
      if (x > 0 && y > 0) relax(i, i - w - 1, 4)
      if (x < w - 1 && y > 0) relax(i, i - w + 1, 4)
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (d[i] === 0) continue
      if (x < w - 1) relax(i, i + 1, 3)
      if (y < h - 1) relax(i, i + w, 3)
      if (x < w - 1 && y < h - 1) relax(i, i + w + 1, 4)
      if (x > 0 && y < h - 1) relax(i, i + w - 1, 4)
    }
  }
  return d
}

/**
 * Perbesar area mask sebesar `radius` px (separable max over alpha channel).
 * RGB-nya diisi putih; yang dibaca hilir cuma channel alpha.
 */
export function dilateMask(mask: Raster, radius: number): Raster {
  const { width: w, height: h } = mask
  if (radius <= 0) return { width: w, height: h, data: new Uint8ClampedArray(mask.data) }

  // Horizontal pass
  const tmp = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let max = 0
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(w - 1, x + radius)
      for (let k = x0; k <= x1; k++) {
        const a = mask.data[(y * w + k) * 4 + 3]
        if (a > max) max = a
      }
      tmp[y * w + x] = max
    }
  }

  // Vertical pass + tulis RGBA
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let max = 0
      const y0 = Math.max(0, y - radius)
      const y1 = Math.min(h - 1, y + radius)
      for (let k = y0; k <= y1; k++) {
        const a = tmp[k * w + x]
        if (a > max) max = a
      }
      const i = (y * w + x) * 4
      out[i] = max ? 255 : 0
      out[i + 1] = max ? 255 : 0
      out[i + 2] = max ? 255 : 0
      out[i + 3] = max
    }
  }
  return { width: w, height: h, data: out }
}

interface PyramidLevel {
  w: number
  h: number
  vals: Float32Array
  cnt: Float32Array
}

interface PullTable {
  /** Kolom/baris level kasar + timbangan bilinear, dihitung sekali per level. */
  ix0: Int32Array
  ix1: Int32Array
  wx0: Float32Array
  wx1: Float32Array
  iy0: Int32Array
  iy1: Int32Array
  wy0: Float32Array
  wy1: Float32Array
}

export class SmoothFillPyramid {
  private readonly levels: PyramidLevel[] = []
  /**
   * Tabel bilinear untuk fase pull: indeks parent + timbangan tiap kolom/baris.
   * Geometrinya tidak berubah antar frame, jadi menghitungnya sekali di sini
   * menghapus Math.floor/Math.min/Math.max dari loop terpanas (ratusan ribu
   * piksel per frame).
   */
  private readonly pull: PullTable[] = []

  constructor(w: number, h: number) {
    let cw = w
    let ch = h
    this.levels.push({ w: cw, h: ch, vals: new Float32Array(cw * ch * 3), cnt: new Float32Array(cw * ch) })
    while (cw > 1 || ch > 1) {
      const nw = Math.max(1, Math.ceil(cw / 2))
      const nh = Math.max(1, Math.ceil(ch / 2))
      this.levels.push({ w: nw, h: nh, vals: new Float32Array(nw * nh * 3), cnt: new Float32Array(nw * nh) })
      cw = nw
      ch = nh
    }
    for (let l = 1; l < this.levels.length; l++) {
      const fine = this.levels[l - 1]
      const coarse = this.levels[l]
      const tab: PullTable = {
        ix0: new Int32Array(fine.w),
        ix1: new Int32Array(fine.w),
        wx0: new Float32Array(fine.w),
        wx1: new Float32Array(fine.w),
        iy0: new Int32Array(fine.h),
        iy1: new Int32Array(fine.h),
        wy0: new Float32Array(fine.h),
        wy1: new Float32Array(fine.h),
      }
      for (let x = 0; x < fine.w; x++) {
        const s = (x - 0.5) / 2
        const f = Math.floor(s)
        const t = s - f
        tab.ix0[x] = Math.min(coarse.w - 1, Math.max(0, f))
        tab.ix1[x] = Math.min(coarse.w - 1, Math.max(0, f + 1))
        tab.wx0[x] = 1 - t
        tab.wx1[x] = t
      }
      for (let y = 0; y < fine.h; y++) {
        const s = (y - 0.5) / 2
        const f = Math.floor(s)
        const t = s - f
        tab.iy0[y] = Math.min(coarse.h - 1, Math.max(0, f))
        tab.iy1[y] = Math.min(coarse.h - 1, Math.max(0, f + 1))
        tab.wy0[y] = 1 - t
        tab.wy1[y] = t
      }
      this.pull.push(tab)
    }
  }

  get width(): number {
    return this.levels[0].w
  }

  get height(): number {
    return this.levels[0].h
  }

  /** Buffer sumber level-0 (3 kanal). Tulis nilai awal di sini, lalu `fillInput`. */
  source(): Float32Array {
    return this.levels[0].vals
  }

  /**
   * Isi nilai yang belum diketahui (`known[i] === 0`) dengan hasil rambatan
   * mulus dari nilai yang diketahui — push-pull pyramid: turunkan resolusi
   * sambil menjumlah, lalu naikkan lagi untuk mengisi piksel kosong.
   *
   * Cocok untuk memperluas selisih nada di ring ke seluruh bagian dalam hole
   * (penyelesaian rendah-frekuensi ala Poisson) dengan biaya O(n).
   *
   * @param known 0 = piksel kosong, >0 = sumber. Float32Array dihitung sebagai
   *              salinan memori (paling cepat untuk pembersih video per frame).
   * @returns buffer level-0 milik objek ini (ditimpa pemanggilan berikutnya).
   */
  fillInput(known: Uint8Array | Float32Array): Float32Array {
    const base = this.levels[0]
    base.cnt.set(known)

    // ── Push: bangun pyramid ────────────────────────────────────────────────
    for (let l = 1; l < this.levels.length; l++) {
      const fine = this.levels[l - 1]
      const coarse = this.levels[l]
      coarse.vals.fill(0)
      coarse.cnt.fill(0)

      const fv = fine.vals
      const fc = fine.cnt
      const fw = fine.w
      const fh = fine.h
      const cv = coarse.vals
      const cc = coarse.cnt
      const cwid = coarse.w

      for (let y = 0; y < coarse.h; y++) {
        const sy0 = y * 2
        const row0 = sy0 * fw
        const row1 = row0 + fw
        const hasBelow = sy0 + 1 < fh
        const crow = y * cwid
        for (let x = 0; x < cwid; x++) {
          const sx0 = x * 2
          const rightExists = sx0 + 1 < fw
          const di = (crow + x) * 3
          let wsum = 0

          let si = row0 + sx0
          let c = fc[si]
          if (c > 0) {
            wsum += c
            const fi = si * 3
            cv[di] += fv[fi]
            cv[di + 1] += fv[fi + 1]
            cv[di + 2] += fv[fi + 2]
          }
          if (rightExists) {
            si++
            c = fc[si]
            if (c > 0) {
              wsum += c
              const fi = si * 3
              cv[di] += fv[fi]
              cv[di + 1] += fv[fi + 1]
              cv[di + 2] += fv[fi + 2]
            }
          }
          if (hasBelow) {
            si = row1 + sx0
            c = fc[si]
            if (c > 0) {
              wsum += c
              const fi = si * 3
              cv[di] += fv[fi]
              cv[di + 1] += fv[fi + 1]
              cv[di + 2] += fv[fi + 2]
            }
            if (rightExists) {
              si++
              c = fc[si]
              if (c > 0) {
                wsum += c
                const fi = si * 3
                cv[di] += fv[fi]
                cv[di + 1] += fv[fi + 1]
                cv[di + 2] += fv[fi + 2]
              }
            }
          }

          if (wsum > 0) {
            cv[di] /= wsum
            cv[di + 1] /= wsum
            cv[di + 2] /= wsum
            cc[crow + x] = 1
          }
        }
      }
    }

    // ── Pull: isi piksel kosong dari level yang lebih kasar ─────────────────
    // Sampel BILINEAR dari level kasar (bukan nearest): nearest menghasilkan
    // bidang bertingkat/blok, dan blok itu ikut terlihat sebagai pita di hasil
    // akhir. Timbangan nol tidak dilewati — menambahkan 0 tidak mengubah nilai.
    for (let l = this.levels.length - 1; l > 0; l--) {
      const coarse = this.levels[l]
      const fine = this.levels[l - 1]
      const tab = this.pull[l - 1]
      const cv = coarse.vals
      const cwid = coarse.w
      const fv = fine.vals
      const fc = fine.cnt
      const fw = fine.w

      for (let y = 0; y < fine.h; y++) {
        const r0 = tab.iy0[y] * cwid
        const r1 = tab.iy1[y] * cwid
        const wy0 = tab.wy0[y]
        const wy1 = tab.wy1[y]
        const rowBase = y * fw
        for (let x = 0; x < fw; x++) {
          const fi = rowBase + x
          if (fc[fi] > 0) continue

          const c0 = tab.ix0[x]
          const c1 = tab.ix1[x]
          const wx0 = tab.wx0[x]
          const wx1 = tab.wx1[x]
          const w00 = wx0 * wy0
          const w10 = wx1 * wy0
          const w01 = wx0 * wy1
          const w11 = wx1 * wy1
          const i00 = (r0 + c0) * 3
          const i10 = (r0 + c1) * 3
          const i01 = (r1 + c0) * 3
          const i11 = (r1 + c1) * 3
          const p = fi * 3
          fv[p] = cv[i00] * w00 + cv[i10] * w10 + cv[i01] * w01 + cv[i11] * w11
          fv[p + 1] = cv[i00 + 1] * w00 + cv[i10 + 1] * w10 + cv[i01 + 1] * w01 + cv[i11 + 1] * w11
          fv[p + 2] = cv[i00 + 2] * w00 + cv[i10 + 2] * w10 + cv[i01 + 2] * w01 + cv[i11 + 2] * w11
          fc[fi] = 1
        }
      }
    }

    return base.vals
  }

  /** Salin nilai sumber ke buffer pyramid lalu isi piksel kosong. */
  fill(values: Float32Array, known: Uint8Array | Float32Array): Float32Array {
    this.source().set(values)
    return this.fillInput(known)
  }
}
/**
 * Versi sekali-pakai dari {@link SmoothFillPyramid} (dipakai jalur gambar).
 * `values` tidak dimodifikasi.
 */
export function smoothFillField(
  values: Float32Array,
  known: Uint8Array,
  w: number,
  h: number,
): Float32Array {
  return new SmoothFillPyramid(w, h).fill(values, known)
}

/**
 * Komposit "mulus": tempel `generated` ke dalam hole pada `original`, dengan
 * bidang koreksi yang dipelajari dari ring di luar hole.
 *
 * @param dilate  px pelebaran mask (default: otomatis). Wajib > 0 supaya tepi
 *                anti-alias watermark (yang biasanya di luar gambar mask user)
 *                ikut diganti — inilah penyebab utama "tanda blur" dulu.
 * @param band    lebar ring pembelajaran nada.
 * @param fade    px jarak memudarnya koreksi nada dari tepi patch ke dalam.
 *                Infinity = koreksi hole-wide (dipakai hanya untuk eksperimen;
 *                terbukti menambah bercak karena bias rekonstruksi model).
 * @param feather px pelebaran halus di batas hole (default 0 = tempel keras).
 *                Nilai > 0 mencampur hasil model dengan piksel ASLI di tepi;
 *                itu berisiko membocorkan sisa watermark kalau mask user lebih
 *                kecil dari watermark. Karena koreksi nada sudah membuat tepi
 *                menyambung, tempel keras justru yang paling bersih.
 */
export function removeWithSeamCorrection(
  original: Raster,
  generated: Raster,
  holeMask: Raster,
  opts: { dilate?: number; band?: number; feather?: number; fade?: number } = {},
): Uint8ClampedArray {
  const { width: w, height: h } = original
  const out = new Uint8ClampedArray(original.data)

  const bounds = maskBounds(holeMask, MASK_THRESHOLD)
  if (!bounds) return out

  const dilate = opts.dilate ?? autoDilateRadius(holeMask)
  const hole = dilateMask(holeMask, dilate)
  const band = opts.band ?? autoRingBand(holeMask)
  const feather = opts.feather ?? 0
  const fade = opts.fade ?? autoFadeBand(holeMask)

  // Mask yang dipakai untuk menempel hasil (hole yang sudah dilebarkan).
  let pasteMask: Raster = hole
  let softMask: Uint8ClampedArray | null = null
  if (feather > 0) {
    // alpha halus di batas: 1 di dalam, turun ke 0 tepat di tepi terluar.
    const inner = dilateMask(holeMask, Math.max(0, dilate - feather))
    const outer = hole.data
    const sa = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const o = outer[i * 4 + 3]
      const a = inner.data[i * 4 + 3]
      let alpha = 0
      if (o > MASK_THRESHOLD) alpha = a > MASK_THRESHOLD ? 255 : 128
      sa[i * 4 + 3] = alpha
      sa[i * 4] = 255
      sa[i * 4 + 1] = 255
      sa[i * 4 + 2] = 255
    }
    softMask = sa
  }

  // ── 1. Ring di luar hole (piksel bersih) → selisih nada original-generated ─
  const bx0 = Math.max(0, bounds.x - dilate - band)
  const by0 = Math.max(0, bounds.y - dilate - band)
  const bx1 = Math.min(w - 1, bounds.x + bounds.w + dilate + band)
  const by1 = Math.min(h - 1, bounds.y + bounds.h + dilate + band)

  const ringIdx: number[] = []
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const i = y * w + x
      if (pasteMask.data[i * 4 + 3] > MASK_THRESHOLD) continue
      ringIdx.push(i)
    }
  }

  const diff = new Float32Array(w * h * 3)
  const known = new Uint8Array(w * h)
  let ringCount = 0

  if (ringIdx.length >= 8) {
    const n = ringIdx.length
    const chans = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
    for (let k = 0; k < n; k++) {
      const pi = ringIdx[k] * 4
      for (let c = 0; c < 3; c++) chans[c][k] = original.data[pi + c] - generated.data[pi + c]
    }

    // Bias ring = persentil-15 dari |selisih|, tandanya dari median. Piksel ring
    // yang masih mengandung sisa watermark (mask user lebih kecil dari
    // watermark) menambah besar selisih, jadi mengambil sisi kecil membuat
    // estimasi condong ke sisi bersih — kalau tidak, sisa itu ikut terbawa ke
    // dalam hole.
    const bias = chans.map((ch) => {
      const mags = Float32Array.from(ch, (v) => Math.abs(v))
      const p = percentile(mags, 0.15)
      return median(ch) < 0 ? -p : p
    })
    const tol = chans.map((ch, c) => {
      const dev = Float32Array.from(ch, (v) => Math.abs(v - bias[c]))
      // Ambang sengaja LONGGAR: variasi nada model yang wajar harus tetap ikut,
      // sedangkan sisa watermark yang sebenarnya tetap tertolak.
      return Math.max(16, median(dev) * 4 + 8)
    })

    for (let k = 0; k < n; k++) {
      const i = ringIdx[k]
      let inlier = true
      for (let c = 0; c < 3; c++) {
        if (Math.abs(chans[c][k] - bias[c]) > tol[c]) { inlier = false; break }
      }
      if (!inlier) continue
      for (let c = 0; c < 3; c++) diff[i * 3 + c] = chans[c][k]
      known[i] = 1
      ringCount++
    }
  }

  // ── 2. Bidang koreksi mulus (hanya dipakai di dalam hole) ─────────────────
  const field = ringCount > 0 ? smoothFillField(diff, known, w, h) : diff

  // ── 3. Komposit ───────────────────────────────────────────────────────────
  // Koreksi nada hanya dipakai penuh di tepi patch lalu memudar ke dalam
  // (seam blending), jadi tidak mengubah nada isi patch yang sudah benar.
  const dist = maskDistanceInside({ width: w, height: h, data: hole.data })
  const fadeUnits = Math.max(3, fade * 3)

  const maskData = softMask ?? hole.data
  for (let y = bounds.y - dilate - 1; y <= bounds.y + bounds.h + dilate + 1; y++) {
    if (y < 0 || y >= h) continue
    for (let x = bounds.x - dilate - 1; x <= bounds.x + bounds.w + dilate + 1; x++) {
      if (x < 0 || x >= w) continue
      const i = y * w + x
      const a = maskData[i * 4 + 3]
      if (a <= MASK_THRESHOLD) continue
      const alpha = a / 255
      const pi = i * 4
      // Chamfer memberi 3 pada piksel pertama di dalam hole, jadi jarak 3
      // dianggap nol: piksel tepat di batas dapat koreksi penuh. Sisanya
      // meluruh dengan smoothstep supaya tidak muncul pita bertingkat.
      const dIn = dist[i] - 3
      let wgt = 0
      if (dIn <= 0) wgt = 1
      else if (dIn < fadeUnits) {
        const t = 1 - dIn / fadeUnits
        wgt = t * t * (3 - 2 * t)
      }
      for (let c = 0; c < 3; c++) {
        const v = generated.data[pi + c] + field[i * 3 + c] * wgt
        const blended = v * alpha + original.data[pi + c] * (1 - alpha)
        out[pi + c] = blended < 0 ? 0 : blended > 255 ? 255 : blended
      }
      out[pi + 3] = 255
    }
  }

  return out
}
