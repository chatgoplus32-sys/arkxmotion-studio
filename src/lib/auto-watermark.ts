/**
 * Pembersih watermark sekali klik untuk hasil di galeri.
 *
 * Alur ini SAMA PERSIS dengan halaman Watermark Remover (yang sudah terbukti
 * menghapus watermarknya):
 *
 *  1. Deteksi plan Gemini/Veo di frame pertama; kalau belum yakin, sampling
 *     4 titik di tengah video (`detectGeminiInVideo`).
 *  2. Ada plan → reverse-alpha exact per frame + perbaikan kontur + pembersih
 *     seam per frame, dengan re-deteksi periodik untuk posisi watermark baru.
 *  3. Tidak ada plan → pembersih seam per frame dengan mask region katalog
 *     kanan-bawah (posisi watermark provider).
 *
 * Encoding memakai jalur offline WebCodecs (bitrate & durasi ikut asli), lalu
 * MediaRecorder sebagai cadangan untuk browser tanpa WebCodecs.
 *
 * Sengaja TIDAK memakai deteksi heuristik `detectWatermarks`: pada video nyata
 * kandidat sudut bisa salah sasaran (objek terang di sudut), sehingga area
 * dibersihkan di tempat yang keliru dan watermark asli tertinggal.
 */
import {
  applyReverseAlphaToRegion,
  createGeminiFramePlan,
  detectGeminiInVideo,
  getGeminiWatermarkRegion,
  type GeminiFramePlan,
} from './gemini-watermark'
import { repairDarkOutlineContourROI } from './gemini-contour-repair'
import { createSeamFrameProcessor } from './video-frame-cleaner'
import { grabFirstFrame, loadVideoMetadata, processVideo } from './video-watermark-process'
import { isOfflineVideoSupported, processVideoOffline } from './video-offline'
import { detectWatermarks } from './watermark-detect'

/** Skor minimal kandidat sudut sebelum dipakai melebarkan region katalog. */
const MIN_CANDIDATE_SCORE = 2.5

export interface AutoWatermarkRect {
  x: number
  y: number
  width: number
  height: number
}

export interface AutoWatermarkResult {
  blob: Blob
  frames: number
  /** exact = pola Gemini/Veo, fallback = region kanan-bawah katalog. */
  mode: 'exact' | 'fallback'
  region: AutoWatermarkRect
}

export type AutoWatermarkProgress = (stage: string, pct: number) => void

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Region katalog Gemini hanya kotak kecil (48–96 px) di sudut. Watermark
 * provider bisa lebih lebar dari itu, jadi kalau ada kandidat watermark yang
 * kuat di kuadran kanan-bawah, gabungkan dengan region katalog agar tidak
 * tersisa. Kandidat di sudut LAIN diabaikan — objek terang di sudut lain
 * pernah membuat area yang dibersihkan salah sasaran.
 */
function expandCatalogRegion(frame: ImageData, catalog: Rect): Rect {
  const width = frame.width
  const height = frame.height
  const candidates = detectWatermarks(frame, { region: 'bottom-right', maxResults: 8 })
    .filter((c) => c.score >= MIN_CANDIDATE_SCORE)

  let x0 = catalog.x
  let y0 = catalog.y
  let x1 = catalog.x + catalog.width
  let y1 = catalog.y + catalog.height
  for (const c of candidates) {
    x0 = Math.min(x0, c.x)
    y0 = Math.min(y0, c.y)
    x1 = Math.max(x1, c.x + c.w)
    y1 = Math.max(y1, c.y + c.h)
  }

  // Batas aman: jangan sampai objek besar di sudut ikut termakan.
  if ((x1 - x0) * (y1 - y0) > 0.08 * width * height) return catalog

  const pad = 8
  const px = Math.max(0, x0 - pad)
  const py = Math.max(0, y0 - pad)
  return {
    x: px,
    y: py,
    width: Math.min(width, x1 + pad) - px,
    height: Math.min(height, y1 + pad) - py,
  }
}

export async function autoRemoveWatermarkFromVideo(
  source: Blob,
  onProgress: AutoWatermarkProgress = () => {},
): Promise<AutoWatermarkResult> {
  const file = source instanceof File
    ? source
    : new File([source], 'video.mp4', { type: source.type || 'video/mp4' })

  onProgress('Menganalisis watermark…', 2)
  const meta = await loadVideoMetadata(file)

  let plan: GeminiFramePlan | null = null
  let ff: ImageData | null = null
  try {
    ff = await grabFirstFrame(meta.video)
    if (!ff.width || !ff.height) throw new Error('Video tidak bisa dibaca')

    plan = await createGeminiFramePlan(ff)
    if (!plan) {
      onProgress('Frame pertama belum yakin — sampling frame lain…', 4)
      plan = await detectGeminiInVideo(meta.video, null, 4)
    }
  } finally {
    URL.revokeObjectURL(meta.url)
  }
  if (!ff) throw new Error('Video tidak bisa dibaca')

  const width = ff.width
  const height = ff.height

  const runVideoThrough = async (
    frameProcessor: (ctx: CanvasRenderingContext2D, seconds: number) => void,
    fallbackFrames: () => number,
  ): Promise<{ blob: Blob; frames: number }> => {
    const report = (pct: number, msg: string) => onProgress(msg, Math.min(99, 4 + (pct / 100) * 94))
    if (isOfflineVideoSupported()) {
      try {
        return await processVideoOffline(file, frameProcessor, report)
      } catch (e) {
        // Codec video ini tidak bisa di-decode WebCodecs — pakai jalur lama.
        console.warn('[auto-watermark] WebCodecs gagal, lanjut jalur lama:', e)
      }
    }
    const fallbackMeta = await loadVideoMetadata(file)
    try {
      const blob = await processVideo({ video: fallbackMeta.video, frameProcessor, onProgress: report })
      return { blob, frames: fallbackFrames() }
    } finally {
      URL.revokeObjectURL(fallbackMeta.url)
    }
  }

  if (plan) {
    // ── Jalur exact (identik dengan runGeminiVideo di halaman) ──────────
    const plans: GeminiFramePlan[] = [plan]
    const keyOf = (p: GeminiFramePlan) =>
      `${p.position.x},${p.position.y},${p.position.width},${p.position.height}`
    let lastProbe = -99

    const buildCleanupMask = (): ImageData | null => {
      if (plans.length === 0) return null
      const mask = new ImageData(width, height)
      let painted = false
      for (const p of plans) {
        const pad = Math.round(Math.min(p.position.width, p.position.height) * 0.15)
        const x0 = Math.max(0, p.position.x - pad)
        const y0 = Math.max(0, p.position.y - pad)
        const x1 = Math.min(width, p.position.x + p.position.width + pad)
        const y1 = Math.min(height, p.position.y + p.position.height + pad)
        for (let py = y0; py < y1; py++) {
          for (let px = x0; px < x1; px++) {
            const idx = (py * width + px) * 4
            mask.data[idx] = 255
            mask.data[idx + 1] = 0
            mask.data[idx + 2] = 0
            mask.data[idx + 3] = 255
          }
        }
        painted = true
      }
      return painted ? mask : null
    }

    let cleanupCleaner = createSeamFrameProcessor(
      buildCleanupMask() ?? new ImageData(width, height),
      width,
      height,
    )
    const rebuildCleaner = () => {
      const mask = buildCleanupMask()
      if (!mask) return
      const next = createSeamFrameProcessor(mask, width, height)
      if (next) cleanupCleaner = next
    }

    const frameProcessor = (ctx: CanvasRenderingContext2D, t: number) => {
      const w = ctx.canvas.width
      const h = ctx.canvas.height
      for (const p of plans) {
        const { x, y, width: pw, height: ph } = p.position
        const roi = ctx.getImageData(x, y, pw, ph)
        applyReverseAlphaToRegion(roi, p.alphaMap, p.alphaGain)
        repairDarkOutlineContourROI(roi, p.alphaMap)
        ctx.putImageData(roi, x, y)
      }
      if (cleanupCleaner) cleanupCleaner.process(ctx)
      // Re-deteksi jarang: watermark bisa muncul/pindah di pertengahan video.
      if (t >= 10 && t - lastProbe >= 6 && w > 0 && h > 0) {
        lastProbe = t
        const snap = ctx.getImageData(0, 0, w, h)
        void createGeminiFramePlan(snap).then((np) => {
          if (np && !plans.some((p) => keyOf(p) === keyOf(np))) {
            plans.push(np)
            rebuildCleaner()
          }
        }).catch(() => { /* probe hanya bonus */ })
      }
    }

    onProgress('Watermark Gemini terdeteksi — bersihkan tiap frame…', 6)
    const { blob, frames } = await runVideoThrough(frameProcessor, () => 0)
    const p0 = plan.position
    return {
      blob,
      frames,
      mode: 'exact',
      region: { x: p0.x, y: p0.y, width: p0.width, height: p0.height },
    }
  }

  // ── Jalur fallback (identik dengan cabang "bukan pola Gemini") ───────
  const region = expandCatalogRegion(ff, getGeminiWatermarkRegion(width, height))
  const mask = new ImageData(width, height)
  const x1 = Math.min(width, region.x + region.width)
  const y1 = Math.min(height, region.y + region.height)
  for (let y = Math.max(0, region.y); y < y1; y++) {
    for (let x = Math.max(0, region.x); x < x1; x++) {
      const idx = (y * width + x) * 4
      mask.data[idx] = 255
      mask.data[idx + 1] = 0
      mask.data[idx + 2] = 0
      mask.data[idx + 3] = 200
    }
  }

  const cleaner = createSeamFrameProcessor(mask, width, height)
  if (!cleaner) throw new Error('Area watermark kosong — tidak ada yang dibersihkan')

  onProgress('Membersihkan area watermark per frame…', 6)
  const { blob, frames } = await runVideoThrough((ctx) => cleaner.process(ctx), () => cleaner.frames())
  return { blob, frames, mode: 'fallback', region }
}
