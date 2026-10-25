import { useState, useRef, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, Select, EmptyState } from '@/components/ui'
import {
  Loader2, Download, X, Clapperboard, Sparkles, Eraser,
  Paintbrush, Square, Undo2, RotateCcw, Wand2, Image as ImageIcon,
  BrainCircuit
} from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { initInpainter, inpaint, isReady, getBackend } from '@/lib/migan-inpainter'
import { removeWithSeamCorrection } from '@/lib/inpaint-core'
import { detectWatermarks, type WatermarkCandidate } from '@/lib/watermark-detect'
import { textureFill } from '@/lib/texturefill'
import { loadVideoMetadata, grabFirstFrame, processVideo } from '@/lib/video-watermark-process'
import { processVideoOffline, isOfflineVideoSupported } from '@/lib/video-offline'
import { repairDarkOutlineContourROI } from '@/lib/gemini-contour-repair'
import { createSeamFrameProcessor } from '@/lib/video-frame-cleaner'
import {
  getGeminiWatermarkRegion,
  removeGeminiWatermark,
  createGeminiFramePlan,
  applyReverseAlphaToRegion,
  detectGeminiInVideo,
  type GeminiFramePlan,
} from '@/lib/gemini-watermark'

type Tool = 'rect' | 'brush' | 'eraser'
type InputMode = 'image' | 'video'

/**
 * Pipeline penghapusan lokal (tanpa unggah ke server).
 *
 * Kenapa berubah: pipeline lama menempelkan hasil model dengan alpha-feather
 * dari mask biner, sehingga (a) di tepi, piksel hasil AI dicampur dengan piksel
 * ASLI yang masih mengandung watermark — sisa logo tampak samar/berblur, dan
 * (b) warna patch tidak nyambung dengan sekitarnya sehingga bekasnya terlihat.
 *
 * Sekarang:
 *  1. Jalur cepat — kalau salinan tekstur menemukan padanan hampir identik
 *     (area rata/berulang: langit, dinding, kain), pakai salinan itu apa adanya.
 *     Hasilnya tajam, instan, dan tanpa halusinasi model.
 *  2. Jalur AI — MI-GAN dengan mask yang DILEBARKAN (menelan tepi anti-alias
 *     watermark) + komposit seam-aware (koreksi nada dari ring sekitarnya),
 *     jadi tidak ada piksel ber-watermark yang bocor ke hasil akhir.
 */
const FAST_PATH_CONFIDENCE = 0.93

async function removeWatermarkLocal(
  imageData: ImageData,
  maskData: ImageData,
  quality: string,
  onStage: (stage: string, pct: number) => void,
): Promise<{ result: ImageData; mode: 'fast' | 'ai' }> {
  onStage('Analisis area watermark…', 8)
  const texResult = textureFill(imageData, maskData)

  if (texResult.confidence >= FAST_PATH_CONFIDENCE) {
    const pct = Math.round(texResult.confidence * 100)
    onStage(`Area rata/berulang terdeteksi (${pct}%) — salin tekstur…`, 45)
    const composited = removeWithSeamCorrection(imageData, texResult.result, maskData)
    // Dibuat lewat canvas ImageData + set() supaya tipe buffer-nya tidak
    // menyalahi tipe global ImageData (SharedArrayBuffer vs ArrayBuffer).
    const result = new ImageData(imageData.width, imageData.height)
    result.data.set(composited)
    return { result, mode: 'fast' }
  }

  onStage('AI inpainting (MI-GAN) — melebarkan area mask…', 12)
  const result = await inpaint(imageData, maskData, {
    quality,
    onPass: (i, total) =>
      onStage(`AI inpainting (pass ${i + 1}/${total}) + komposit seam-aware…`, 20 + (i / total) * 75),
  })
  return { result, mode: 'ai' }
}

function imageDataToBlob(img: ImageData): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const c = document.createElement('canvas')
    c.width = img.width; c.height = img.height
    c.getContext('2d')!.putImageData(img, 0, 0)
    c.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Failed to encode')), 'image/png')
  })
}

export default function WatermarkRemoverPage() {
  const addToast = useToastStore((s) => s.addToast)

  const [engineReady, setEngineReady] = useState(false)
  const [engineLoading, setEngineLoading] = useState(false)
  const [engineProgress, setEngineProgress] = useState('')
  const [backend, setBackend] = useState('')

  const [inputMode, setInputMode] = useState<InputMode>('image')
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [imageData, setImageData] = useState<ImageData | null>(null)

  const [tool, setTool] = useState<Tool>('rect')
  const [brushSize, setBrushSize] = useState(20)
  const [maskData, setMaskData] = useState<ImageData | null>(null)
  const [undoStack, setUndoStack] = useState<ImageData[]>([])

  const [candidates, setCandidates] = useState<WatermarkCandidate[]>([])
  const [selectedCandidate, setSelectedCandidate] = useState<number>(0)

  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [quality, setQuality] = useState('standard')
  const [compare, setCompare] = useState<'before' | 'after'>('after')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  const ensureEngine = useCallback(async () => {
    if (isReady()) { setEngineReady(true); setBackend(getBackend()); return true }
    if (engineLoading) return false
    setEngineLoading(true)
    try {
      await initInpainter((msg) => setEngineProgress(msg))
      setEngineReady(true); setBackend(getBackend()); return true
    } catch (e: any) {
      addToast(`❌ Gagal memuat AI engine: ${e.message}`, 'error'); return false
    } finally { setEngineLoading(false) }
  }, [addToast, engineLoading])

  // ── Canvas coordinate mapping (fixed) ──────────────────────────────
  // Use the CANVAS element's own rect + internal resolution for correct mapping.
  // Both image and mask canvases share the same parent container, so their
  // display rects should match. We read from the actual event target's canvas.
  const getCanvasPos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    }
  }, [])

  // ── Shared video offline pipeline (WebCodecs, frame-akurat) ─────────
  // Loop realtime + MediaRecorder dulu bikin masalah di video 30s+:
  // frame ke-skip → patah-patah, bitrate 5Mbps → hasil 4MB vs asli 44MB.
  // Sekarang: decode/encode offline via WebCodecs+mediabunny, bitrate
  // mengikuti file asli. MediaRecorder hanya fallback browser lama.
  const runVideoThrough = useCallback(async (
    f: File,
    frameProcessor: (ctx: CanvasRenderingContext2D, seconds: number) => void,
    label: string,
  ): Promise<number> => {
    if (isOfflineVideoSupported()) {
      try {
        const { blob, frames } = await processVideoOffline(f, frameProcessor, (pct, msg) => {
          setProgress(3 + (pct / 100) * 97)
          setProgressMsg(msg.startsWith('Selesai') || msg.startsWith('Memproses') ? msg : `${label}: ${msg}`)
        })
        setResultUrl(URL.createObjectURL(blob)); setResultBlob(blob)
        return frames
      } catch (e) {
        // WebCodecs gagal di video/browser ini — jangan matikan alur, jatuh ke
        // jalur lama (MediaRecorder) supaya tetap ada hasil yang bisa dipakai.
        console.error('[video-offline] gagal, lanjut jalur lama:', e)
        const detail = String(e instanceof Error ? e.message : e).slice(0, 120)
        addToast(`⚠️ Encoding WebCodecs gagal (${detail}) — pakai jalur cadangan`, 'warning')
      }
    }
    // Fallback realtime untuk browser tanpa WebCodecs.
    const meta = await loadVideoMetadata(f)
    try {
      const blob = await processVideo({
        video: meta.video, frameProcessor,
        onProgress: (pct, msg) => {
          setProgress(3 + (pct / 100) * 97)
          setProgressMsg(pct >= 95 ? msg : `${label}: ${msg}`)
        },
      })
      setResultUrl(URL.createObjectURL(blob)); setResultBlob(blob)
    } finally { URL.revokeObjectURL(meta.url) }
    return 0
  }, [addToast])

  // ── Shared video exact-removal pipeline (used by auto & manual paths) ──
  // Plan berisi posisi + alpha map dari deteksi; tiap frame dibersihkan
  // dengan reverse-alpha sesuai kontennya (tanpa patch beku → tanpa blur).
  //
  // Video panjang (30s+): watermark bisa berpindah posisi atau baru muncul
  // di pertengahan. Probe Balik-ulang MEMALU (mahal: 1-5s utk deteksi full),
  // jadi jarang (tiap 6s, mulai setelah 10s) — hanya kalau wm belum ketemu
  // posisi lain. Kalau tampilan pinggiran TMP DOANG, selip laporan di toast.
  const runGeminiVideo = useCallback(async (
    f: File,
    initialPlan: GeminiFramePlan,
    dims: { width: number; height: number },
  ) => {
    const p0 = initialPlan.position
    addToast(`🔬 Exact: region ${p0.width}×${p0.height} @ (${p0.x},${p0.y}) + inpaint AI`, 'info')
    setProgressMsg('Gemini watermark terdeteksi — bersihkan tiap frame…')

    const plans: GeminiFramePlan[] = [initialPlan]
    const keyOf = (p: GeminiFramePlan) =>
      `${p.position.x},${p.position.y},${p.position.width},${p.position.height}`
    let lastProbe = -99

    // Pembersih inpaint AI per-frame untuk SISA yang tak luruh oleh
    // reverse-alpha (rim gelap varian weak-alpha). Mask = union rect semua
    // plan + padding kecil. Saat plan baru muncul, mask diperbarui.
    const buildCleanupMask = (): ImageData | null => {
      if (plans.length === 0) return null
      const mask = new ImageData(dims.width, dims.height)
      let painted = false
      for (const p of plans) {
        const pad = Math.round(Math.min(p.position.width, p.position.height) * 0.15)
        const x0 = Math.max(0, p.position.x - pad)
        const y0 = Math.max(0, p.position.y - pad)
        const x1 = Math.min(dims.width, p.position.x + p.position.width + pad)
        const y1 = Math.min(dims.height, p.position.y + p.position.height + pad)
        for (let py = y0; py < y1; py++) {
          for (let px = x0; px < x1; px++) {
            const idx = (py * dims.width + px) * 4
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

    let cleanupCleaner = createSeamFrameProcessor(buildCleanupMask() ?? new ImageData(dims.width, dims.height), dims.width, dims.height)
    const rebuildCleaner = () => {
      const mask = buildCleanupMask()
      if (!mask) return
      const next = createSeamFrameProcessor(mask, dims.width, dims.height)
      if (next) cleanupCleaner = next
    }

    const frameProcessor = (ctx: CanvasRenderingContext2D, t: number) => {
      const w = ctx.canvas.width, h = ctx.canvas.height
      for (const p of plans) {
        const { x, y, width, height } = p.position
        const roi = ctx.getImageData(x, y, width, height)
        applyReverseAlphaToRegion(roi, p.alphaMap, p.alphaGain)
        // Bersihkan sisa garis kontur gelap (pola outline V2) supaya hasil
        // reverse-alpha tidak meninggalkan siluet bintang Gemini.
        repairDarkOutlineContourROI(roi, p.alphaMap)
        ctx.putImageData(roi, x, y)
      }
      // Inpaint AI per-frame di region yang sama: menghapus sisa rim/fill
      // yang didn't luruh, dari konteks frame itu sendiri (tanpa patch beku).
      if (cleanupCleaner) cleanupCleaner.process(ctx)
      // Re-detect periodik (mahal — dijalankan jarang; snapshot dibaca
      // SETELAH semua plan dibersihkan, jadi hanya posisi BARU yang match).
      if (t >= 10 && t - lastProbe >= 6 && w > 0 && h > 0) {
        lastProbe = t
        const snap = ctx.getImageData(0, 0, w, h)
        void createGeminiFramePlan(snap).then((np) => {
          if (np && !plans.some((p) => keyOf(p) === keyOf(np))) {
            plans.push(np)
            rebuildCleaner()
            addToast(`🧲 Watermark baru terdeteksi di posisi lain (${t.toFixed(1)}s) — ikut dibersihkan`, 'info')
          }
        }).catch(() => { /* probe hanya bonus */ })
      }
    }

    await runVideoThrough(f, frameProcessor, 'Exact removal')
  }, [addToast, runVideoThrough])

  const handleFile = useCallback((f: File) => {
    const isVideo = /video\//.test(f.type) || /\.(mp4|mov|webm)$/i.test(f.name)
    const isImage = /image\//.test(f.type) || /\.(png|jpe?g|webp|bmp)$/i.test(f.name)
    if (!isVideo && !isImage) {
      addToast('⚠️ Format harus MP4/MOV/WebM atau PNG/JPG/WEBP', 'warning'); return
    }

    setFile(f); setResultUrl(null); setResultBlob(null); setCandidates([])
    setMaskData(null); setUndoStack([]); setFileUrl(URL.createObjectURL(f)); setCompare('after')
    setInputMode(isVideo ? 'video' : 'image')

    if (isImage) {
      const img = new window.Image()
      img.onload = () => {
        const c = canvasRef.current!
        c.width = img.width; c.height = img.height
        c.getContext('2d')!.drawImage(img, 0, 0)
        const data = c.getContext('2d')!.getImageData(0, 0, img.width, img.height)
        setImageData(data)

        const mc = maskCanvasRef.current!
        mc.width = img.width; mc.height = img.height
        // Auto-apply the known Gemini/Veo bottom-right region so the user
        // does not have to draw the mask manually (matches nexabot.id UX).
        const region = getGeminiWatermarkRegion(img.width, img.height)
        const autoMask = new ImageData(img.width, img.height)
        for (let ry = 0; ry < region.height; ry++) {
          for (let rx = 0; rx < region.width; rx++) {
            const px = region.x + rx, py = region.y + ry
            const idx = (py * img.width + px) * 4
            autoMask.data[idx] = 255
            autoMask.data[idx + 1] = 0
            autoMask.data[idx + 2] = 0
            autoMask.data[idx + 3] = 200
          }
        }
        setMaskData(autoMask)
        // Draw it on the visible mask canvas too
        const mctx = mc.getContext('2d')!
        mctx.clearRect(0, 0, mc.width, mc.height)
        mctx.fillStyle = 'rgba(255, 0, 0, 0.5)'
        mctx.fillRect(region.x, region.y, region.width, region.height)

        // Auto-process: nexabot.id UX — scan & clean immediately after upload.
        setProcessing(true); setProgress(5); setProgressMsg('Menganalisis watermark…')
        const gem = removeGeminiWatermark(data)
        if (gem.meta.applied) {
          imageDataToBlob(gem.imageData).then((blob) => {
            setResultUrl(URL.createObjectURL(blob)); setResultBlob(blob)
            addToast('✅ Watermark Gemini dihapus otomatis (exact)!', 'success')
            setProgress(100); setProcessing(false)
          }).catch((e) => { addToast(`❌ ${e.message}`, 'error'); setProcessing(false) })
        } else {
          setProcessing(false); setProgress(0); setProgressMsg('')
          addToast('ℹ️ Bukan watermark Gemini — sesuaikan mask lalu klik Bersihkan.', 'info')
        }
      }
      img.src = URL.createObjectURL(f)
    } else {
      loadVideoMetadata(f).then(async (meta) => {
        const ff = await grabFirstFrame(meta.video)
        const c = canvasRef.current!
        c.width = ff.width; c.height = ff.height
        c.getContext('2d')!.putImageData(ff, 0, 0)
        setImageData(ff)

        const mc = maskCanvasRef.current!
        mc.width = ff.width; mc.height = ff.height
        const region = getGeminiWatermarkRegion(ff.width, ff.height)
        const autoMask = new ImageData(ff.width, ff.height)
        for (let ry = 0; ry < region.height; ry++) {
          for (let rx = 0; rx < region.width; rx++) {
            const px = region.x + rx, py = region.y + ry
            const idx = (py * ff.width + px) * 4
            autoMask.data[idx] = 255
            autoMask.data[idx + 1] = 0
            autoMask.data[idx + 2] = 0
            autoMask.data[idx + 3] = 200
          }
        }
        // Auto-process: nexabot.id UX — scan & clean immediately after upload.
        // Deteksi di frame pertama; kalau belum yakin, sampling titik-titik
        // di tengah video (watermark Gemini selalu ada sepanjang video).
        setProcessing(true); setProgress(3); setProgressMsg('Menganalisis watermark…')
        let plan = await createGeminiFramePlan(ff)
        if (!plan) {
          setProgressMsg('Frame pertama belum yakin — sampling frame lain…')
          plan = await detectGeminiInVideo(meta.video, null, 4)
        }
        URL.revokeObjectURL(meta.url)

        if (!plan) {
          // DIAGNOSTik: beri tahu user jalur fallback yang dipakai.
          const reg = getGeminiWatermarkRegion(ff.width, ff.height)
          addToast(`ℹ️ Deteksi exact gagal → fallback AI (${ff.width}×${ff.height}, region default ${reg.width}×${reg.height})`, 'info')
        }
        if (plan) {
          // Auto-mask di posisi hasil deteksi (bukan default katalog).
          const region = plan.position
          const autoMask = new ImageData(ff.width, ff.height)
          for (let ry = 0; ry < region.height; ry++) {
            for (let rx = 0; rx < region.width; rx++) {
              const idx = ((region.y + ry) * ff.width + (region.x + rx)) * 4
              autoMask.data[idx] = 255
              autoMask.data[idx + 1] = 0
              autoMask.data[idx + 2] = 0
              autoMask.data[idx + 3] = 200
            }
          }
          setMaskData(autoMask)
          const mctx = mc.getContext('2d')!
          mctx.clearRect(0, 0, mc.width, mc.height)
          mctx.fillStyle = 'rgba(255, 0, 0, 0.5)'
          mctx.fillRect(region.x, region.y, region.width, region.height)

          try {
            await runGeminiVideo(f, plan, { width: ff.width, height: ff.height })
            addToast('✅ Watermark Gemini dibersihkan otomatis (per-frame)!', 'success')
            setProgress(100)
          } catch (e: any) { addToast(`❌ ${e.message}`, 'error') }
          setProcessing(false)
        } else {
          // Video panjang / watermark varian baru sering gagal kena pola Gemini
          // persis. Jangan berhenti di toast — lanjut otomatis pakai pembersih
          // seam per-frame dengan auto-mask region kanan-bawah yang sudah ada.
          setProgressMsg('Bukan pola Gemini — bersihkan dengan AI per-frame…')
          try {
            const meta2 = await loadVideoMetadata(f)
            const cleaner = createSeamFrameProcessor(autoMask, meta2.video.videoWidth, meta2.video.videoHeight)
            URL.revokeObjectURL(meta2.url)
            if (cleaner) {
              const frames = await runVideoThrough(f, (ctx) => cleaner.process(ctx), 'Bersih per-frame')
              addToast(
                `✅ Bukan pola Gemini — area watermark dibersihkan dengan AI per-frame (${frames || cleaner.frames()} frame, ${cleaner.avgMs().toFixed(1)} ms/frame)`,
                'success',
              )
              setProgress(100)
            }
          } catch (e: any) {
            addToast(`❌ ${e.message}`, 'error')
            setProgress(0)
          }
          setProcessing(false)
        }
      })
    }
  }, [addToast, runGeminiVideo, runVideoThrough])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f)
  }

  // ── Mask drawing (fixed coordinates) ──────────────────────────────
  const drawOnMask = useCallback((x: number, y: number) => {
    if (!maskData) return
    const mc = maskCanvasRef.current!
    const ctx = mc.getContext('2d')!

    if (tool === 'rect' && lastPos.current) {
      ctx.clearRect(0, 0, mc.width, mc.height)
      ctx.fillStyle = 'rgba(255, 0, 0, 0.5)'
      const lx = Math.min(lastPos.current.x, x)
      const ly = Math.min(lastPos.current.y, y)
      const lw = Math.abs(x - lastPos.current.x)
      const lh = Math.abs(y - lastPos.current.y)
      ctx.fillRect(lx, ly, lw, lh)

      const newMask = new ImageData(new Uint8ClampedArray(maskData.data), mc.width, mc.height)
      const data = newMask.data
      for (let py = 0; py < mc.height; py++) {
        for (let px = 0; px < mc.width; px++) {
          const idx = (py * mc.width + px) * 4
          if (px >= lx && px < lx + lw && py >= ly && py < ly + lh) {
            data[idx] = 255; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 200
          } else {
            data[idx + 3] = 0
          }
        }
      }
      setMaskData(newMask)
    } else if (tool === 'brush' || tool === 'eraser') {
      const r = brushSize
      ctx.globalCompositeOperation = tool === 'brush' ? 'source-over' : 'destination-out'
      ctx.fillStyle = tool === 'brush' ? 'rgba(255, 0, 0, 0.5)' : 'rgba(0,0,0,1)'
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
      if (lastPos.current) {
        ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y)
        ctx.lineTo(x, y); ctx.lineWidth = r * 2; ctx.lineCap = 'round'; ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
      setMaskData(ctx.getImageData(0, 0, mc.width, mc.height))
    }
  }, [maskData, tool, brushSize])

  const onCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!imageData) return
    isDrawing.current = true
    if (maskData) setUndoStack(prev => [...prev.slice(-30), new ImageData(new Uint8ClampedArray(maskData.data), maskData.width, maskData.height)])
    const pos = getCanvasPos(e)
    lastPos.current = pos
    drawOnMask(pos.x, pos.y)
  }

  const onCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return
    const pos = getCanvasPos(e); drawOnMask(pos.x, pos.y); lastPos.current = pos
  }

  const onCanvasMouseUp = () => { isDrawing.current = false; lastPos.current = null }

  const undo = () => {
    if (undoStack.length === 0) return
    const prev = undoStack[undoStack.length - 1]; setUndoStack(s => s.slice(0, -1))
    setMaskData(prev); maskCanvasRef.current?.getContext('2d')!.putImageData(prev, 0, 0)
  }

  const clearMask = () => {
    if (!imageData) return
    maskCanvasRef.current?.getContext('2d')!.clearRect(0, 0, imageData.width, imageData.height)
    setMaskData(new ImageData(imageData.width, imageData.height)); setUndoStack([])
  }

  // ── Auto-detect with padding ──────────────────────────────────────
  const applyCandidateMask = useCallback((c: WatermarkCandidate, imgW: number, imgH: number) => {
    const mc = maskCanvasRef.current!
    const ctx = mc.getContext('2d')!
    ctx.clearRect(0, 0, mc.width, mc.height)
    // Add 30% padding around detected region for better coverage
    const pad = Math.round(Math.max(c.w, c.h) * 0.3)
    const x = Math.max(0, c.x - pad)
    const y = Math.max(0, c.y - pad)
    const w = Math.min(imgW - x, c.w + pad * 2)
    const h = Math.min(imgH - y, c.h + pad * 2)
    ctx.fillStyle = 'rgba(255, 0, 0, 0.5)'
    ctx.fillRect(x, y, w, h)
    setMaskData(ctx.getImageData(0, 0, mc.width, mc.height))
    setUndoStack([])
  }, [])

  const autoDetect = useCallback(async () => {
    if (!imageData) return
    const ok = await ensureEngine(); if (!ok) return
    const results = detectWatermarks(imageData, { maxResults: 4 })
    if (results.length === 0) {
      addToast('⚠️ Tidak ada watermark terdeteksi. Coba mask manual.', 'warning'); return
    }
    setCandidates(results); setSelectedCandidate(0)
    addToast(`✅ ${results.length} kandidat terdeteksi`, 'success')
    applyCandidateMask(results[0], imageData.width, imageData.height)
  }, [imageData, ensureEngine, addToast, applyCandidateMask])

  // ── Main removal pipeline ──────────────────────────────────────────
  // Gemini/Veo path uses exact reverse-alpha-blend (no AI model, no download).
  // Falls back to MI-GAN seam-aware inpainting when the watermark is NOT Gemini/Veo.
  const runRemove = async () => {
    if (!imageData || !maskData) { addToast('⚠️ Upload & buat mask dulu!', 'warning'); return }
    const hasMask = Array.from(maskData.data).some((v, i) => i % 4 === 3 && v > 16)
    if (!hasMask) { addToast('⚠️ Area mask kosong!', 'warning'); return }

    setProcessing(true); setProgress(0); setProgressMsg('Starting…')

    try {
      if (inputMode === 'video' && file) {
        // Video: deteksi plan Gemini per-frame dulu, fallback ke MI-GAN
        // seam-aware inpainting bila watermark bukan Gemini/Veo.
        setProgressMsg('Checking for Gemini/Veo watermark…'); setProgress(3)
        let plan = await createGeminiFramePlan(imageData)
        if (!plan) {
          setProgressMsg('Sampling frame lain untuk deteksi…')
          const probe = await loadVideoMetadata(file)
          plan = await detectGeminiInVideo(probe.video, null, 4)
          URL.revokeObjectURL(probe.url)
        }

        if (plan) {
          await runGeminiVideo(file, plan, { width: imageData.width, height: imageData.height })
          addToast('✅ Watermark Gemini dibersihkan (per-frame)!', 'success')
          setProgress(100)
        } else {
          // Per-frame: area watermark dibersihkan ULANG tiap frame dari konteks
          // frame itu sendiri, jadi tidak ada "patch beku" saat ada gerakan.
          const meta = await loadVideoMetadata(file)
          const cleaner = createSeamFrameProcessor(maskData, meta.video.videoWidth, meta.video.videoHeight)
          URL.revokeObjectURL(meta.url)
          if (!cleaner) {
            addToast('Mask kosong — tandai dulu area watermark.', 'error')
            setProcessing(false); return
          }
          const frames = await runVideoThrough(file, (ctx) => cleaner.process(ctx), 'Bersih per-frame')
          addToast(
            `✅ Video dibersihkan per-frame (${frames || cleaner.frames()} frame, ${cleaner.avgMs().toFixed(1)} ms/frame ≈ ${cleaner.secondsPerMinute().toFixed(1)} s per menit video)`,
            'success',
          )
        }
      } else {
        // Image: exact Gemini removal first (instant, lossless), else local pipeline.
        setProgressMsg('Checking for Gemini/Veo watermark…'); setProgress(5)
        const geminiResult = removeGeminiWatermark(imageData)
        if (geminiResult.meta.applied) {
          const blob = await imageDataToBlob(geminiResult.imageData)
          setResultUrl(URL.createObjectURL(blob)); setResultBlob(blob)
          addToast('✅ Watermark Gemini dihapus (exact)!', 'success')
          setProgress(100)
        } else {
          const ok = await ensureEngine(); if (!ok) { setProcessing(false); return }
          const { result, mode } = await removeWatermarkLocal(imageData, maskData, quality, (stage, pct) => {
            setProgressMsg(stage); setProgress(pct)
          })
          const blob = await imageDataToBlob(result)
          setResultUrl(URL.createObjectURL(blob)); setResultBlob(blob)
          addToast(
            mode === 'fast'
              ? '✅ Dibersihkan instan (salin tekstur + seam-aware)!'
              : '✅ Dibersihkan (AI inpainting + komposit seam-aware)!',
            'success',
          )
          setProgress(100)
        }
      }
    } catch (e: any) { addToast(`❌ ${e.message}`, 'error') }
    finally { setProcessing(false) }
  }

  const downloadResult = () => {
    if (!resultUrl) return
    // Extension must match the real blob type — WebM renamed to .mp4 won't play.
    const videoExt = resultBlob?.type.includes('mp4') ? 'mp4' : 'webm'
    const a = document.createElement('a'); a.href = resultUrl
    a.download = file ? file.name.replace(/\.[^.]+$/, '') + '_nowm.' + (inputMode === 'video' ? videoExt : 'png') : 'result.png'
    a.click()
  }

  return (
    <PageContent>
      <PageHeader
        title="🧽 Watermark Remover"
        highlight="Secepat Kedip"
        desc="Tempel video Gemini/Veo kamu dan biarkan AI membersihkan watermark-nya. Semua proses berjalan di perangkat kamu sendiri — video tidak pernah diunggah ke server."
      />

      {/* Badges ala nexabot.id/watermark-remover */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { icon: '🔒', label: 'Tanpa upload ke server' },
          { icon: '⚡', label: 'Tanpa antrean' },
          { icon: '💪', label: 'GPU/CPU perangkat kamu' },
        ].map((b) => (
          <span key={b.label} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-3 py-1 text-[11px] font-medium text-emerald-400">
            {b.icon} {b.label}
          </span>
        ))}
      </div>

      {/* Langkah 01/02/03 ala nexabot.id */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {[
          { n: '01', title: 'Pilih video', desc: 'Tarik & letakkan atau pilih file MP4/MOV/WebM — disarankan ≤ 10 detik.' },
          { n: '02', title: 'AI membersihkan', desc: 'Model neural network berjalan di browser, frame demi frame — watermark Gemini/Veo (kanan bawah) dibersihkan otomatis.' },
          { n: '03', title: 'Unduh hasil', desc: 'Bandingkan sebelum/sesudah, lalu unduh video/gambar tanpa watermark.' },
        ].map((s) => (
          <div key={s.n} className="rounded-xl border border-border/70 bg-card/30 p-3">
            <div className="text-[11px] font-mono text-muted-foreground tracking-widest mb-1">{s.n}</div>
            <div className="text-sm font-medium text-foreground">{s.title}</div>
            <div className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{s.desc}</div>
          </div>
        ))}
      </div>

      <Section className="!p-4 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className={`flex items-center gap-1.5 text-xs font-medium ${engineReady ? 'text-emerald-400' : 'text-amber-400'}`}>
            <BrainCircuit className="h-3.5 w-3.5" />
            {engineReady ? `LaMa AI ready (${backend})` : engineLoading ? engineProgress : 'Gemini exact ✓ · LaMa AI untuk watermark lain'}
          </div>
          {!engineReady && (
            <Button size="sm" variant="outline" onClick={ensureEngine} disabled={engineLoading}>
              {engineLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <BrainCircuit className="h-3 w-3 mr-1" />}
              {engineLoading ? 'Loading…' : 'Init LaMa AI Engine'}
            </Button>
          )}
          {engineReady && (
            <Select value={quality} onChange={(e) => setQuality(e.target.value)} options={[
              { value: 'fast', label: '⚡ Fast (1 pass)' },
              { value: 'standard', label: '✨ Standard (1 pass)' },
              { value: 'high', label: '🎯 High (2 passes)' },
              { value: 'best', label: '💎 Best (2 passes, slower)' },
            ]} />
          )}
        </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Engine dioptimalkan untuk watermark Gemini / Veo (kanan bawah). Video/gambar di luar itu mungkin tidak terdeteksi — gunakan mask manual. Semua proses berjalan lokal di browser kamu.
          </p>
        </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="🎬 Input & Mask" className="!p-6">
          <div className="mb-4">
            <Label className="mb-2 block">Gambar / Video</Label>
            {file ? (
              <div className="rounded-lg border border-border overflow-hidden bg-surface-secondary">
                <div className="relative inline-block w-full">
                  <canvas ref={canvasRef} className="w-full block" style={{ display: file ? 'block' : 'none' }} />
                  <canvas ref={maskCanvasRef} className="absolute inset-0 w-full h-full cursor-crosshair"
                    style={{ display: file ? 'block' : 'none' }}
                    onMouseDown={onCanvasMouseDown} onMouseMove={onCanvasMouseMove}
                    onMouseUp={onCanvasMouseUp} onMouseLeave={onCanvasMouseUp} />
                </div>
                <div className="flex items-center gap-2 p-2">
                  <span className="text-xs text-muted-foreground truncate flex-1">
                    {file.name} ({(file.size / 1024 / 1024).toFixed(1)}MB)
                    {imageData ? ` · ${imageData.width}×${imageData.height}` : ''}
                  </span>
                  <button onClick={() => { setFile(null); setFileUrl(null); setImageData(null); setMaskData(null); setCandidates([]); setResultUrl(null) }}
                    className="p-1 rounded-full hover:bg-red-500/20 transition-colors"><X className="h-4 w-4" /></button>
                </div>
              </div>
            ) : (
              <div onClick={() => document.getElementById('wm-file-input')?.click()}
                onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors">
                <div className="flex justify-center text-muted-foreground mb-2">
                  {inputMode === 'video' ? <Clapperboard className="h-8 w-8" /> : <ImageIcon className="h-8 w-8" />}
                </div>
                <div className="text-sm text-muted-foreground font-medium">Tarik & letakkan video/gambar</div>
                <div className="text-xs text-muted-foreground mt-1">atau pilih file dari perangkat — disarankan ≤ 10 detik</div>
                <div className="flex justify-center gap-1.5 mt-3 flex-wrap">
                  {['MP4', 'MOV', 'WebM', 'PNG', 'JPG', 'WEBP'].map((f) => (
                    <span key={f} className="rounded-md border border-border bg-card/40 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">{f}</span>
                  ))}
                </div>
                <div className="text-[11px] text-muted-foreground mt-3">Belum ada file dipilih · semua format umum didukung</div>
              </div>
            )}
            <input id="wm-file-input" type="file" accept="image/*,video/*" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </div>

          {file && (
            <div className="mb-4 space-y-3">
              <Label>Masking Tools</Label>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant={tool === 'rect' ? 'default' : 'outline'} onClick={() => setTool('rect')}>
                  <Square className="h-3 w-3 mr-1" /> Rectangle</Button>
                <Button size="sm" variant={tool === 'brush' ? 'default' : 'outline'} onClick={() => setTool('brush')}>
                  <Paintbrush className="h-3 w-3 mr-1" /> Brush</Button>
                <Button size="sm" variant={tool === 'eraser' ? 'default' : 'outline'} onClick={() => setTool('eraser')}>
                  <Eraser className="h-3 w-3 mr-1" /> Eraser</Button>
                <Button size="sm" variant="outline" onClick={undo} disabled={undoStack.length === 0}>
                  <Undo2 className="h-3 w-3 mr-1" /> Undo</Button>
                <Button size="sm" variant="outline" onClick={clearMask}>
                  <RotateCcw className="h-3 w-3 mr-1" /> Clear</Button>
              </div>
              {(tool === 'brush' || tool === 'eraser') && (
                <div>
                  <Label>Brush size: {brushSize}px</Label>
                  <input type="range" min={2} max={100} value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full accent-primary" />
                </div>
              )}
              <Button size="sm" variant="outline" onClick={autoDetect} disabled={!engineReady} className="w-full">
                <Wand2 className="h-3 w-3 mr-1" /> 🔍 Auto-detect Watermark</Button>
              {candidates.length > 0 && (
                <div className="space-y-1">
                  <Label>Detected ({candidates.length}) — click to apply:</Label>
                  {candidates.map((c, i) => (
                    <button key={i}
                      onClick={() => { setSelectedCandidate(i); if (imageData) applyCandidateMask(c, imageData.width, imageData.height) }}
                      className={`block w-full text-left text-xs p-2 rounded border transition-colors ${
                        i === selectedCandidate ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                      }`}>
                      #{i + 1} — {c.region} ({c.w}×{c.h}px) score: {c.score.toFixed(2)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <Button onClick={runRemove} disabled={processing || !file || !maskData} className="w-full" size="lg">
            {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Eraser className="h-4 w-4 mr-2" />}
            {processing ? `Membersihkan… ${progress}%` : '🧽 Bersihkan Watermark'}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Gemini/Veo: reverse-alpha exact (instan). Lainnya: texture + LaMa AI (~93MB, cached).
          </p>
        </Section>

        <Section title="📤 Hasil" className="!p-6">
          <div className="min-h-[200px]">
            {resultUrl ? (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="flex gap-2 p-2 border-b border-border">
                  <button onClick={() => setCompare('before')}
                    className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${compare === 'before' ? 'bg-primary text-primary-foreground' : 'bg-surface-secondary text-muted-foreground'}`}>Sebelum</button>
                  <button onClick={() => setCompare('after')}
                    className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${compare === 'after' ? 'bg-primary text-primary-foreground' : 'bg-surface-secondary text-muted-foreground'}`}>Sesudah ✨</button>
                </div>
                {inputMode === 'video' ? (
                  <video src={compare === 'before' ? (fileUrl || resultUrl) : resultUrl} controls className="w-full" key={compare || 'v'} />
                ) : (
                  <img src={compare === 'before' ? (fileUrl || '') : resultUrl} className="w-full" key={compare} />
                )}
                <div className="p-2 text-center">
                  <Button onClick={downloadResult} size="sm" variant="outline">
                    <Download className="h-3 w-3 mr-1" /> Download Hasil</Button>
                </div>
              </div>
            ) : (
              <EmptyState icon={<Sparkles className="h-12 w-12" />} title="Belum ada hasil"
                description="Upload gambar/video, buat mask, lalu klik Bersihkan." />
            )}
            {processing && (
              <div className="mt-3 space-y-1">
                <div className="text-sm text-blue-400 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> {progressMsg}</div>
                <div className="w-full bg-surface-secondary rounded-full h-2">
                  <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
          </div>
        </Section>
      </div>
    </PageContent>
  )
}
