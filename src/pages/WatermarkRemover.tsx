import { useState, useRef, useCallback, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, Select, EmptyState } from '@/components/ui'
import {
  Loader2, Download, X, Clapperboard, Sparkles, Eraser,
  Paintbrush, Square, Undo2, RotateCcw, Wand2, Image as ImageIcon,
  BrainCircuit
} from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { initInpainter, inpaint, isReady, getBackend } from '@/lib/migan-inpainter'
import { detectWatermarks, type WatermarkCandidate } from '@/lib/watermark-detect'
import { textureFill } from '@/lib/texturefill'
import { loadVideoMetadata, grabFirstFrame, processVideo } from '@/lib/video-watermark-process'
import { getGeminiWatermarkRegion, removeGeminiWatermark } from '@/lib/gemini-watermark'

type Tool = 'rect' | 'brush' | 'eraser'
type InputMode = 'image' | 'video'

/**
 * Two-stage removal pipeline (matches WatermarkOut / nexabot.id):
 * Stage 1 — Texture fill (exemplar/patch-based copy from nearby real pixels)
 * Stage 2 — MI-GAN generative inpainting (polish edges + fill opaque core)
 */
async function twoStageRemoval(
  imageData: ImageData,
  maskData: ImageData,
  quality: string,
  onStage: (stage: string, pct: number) => void,
): Promise<ImageData> {
  onStage('Stage 1/2: Analisis texture…', 5)
  const texResult = textureFill(imageData, maskData)
  const texPct = Math.round(texResult.confidence * 100)

  if (texResult.confidence > 0.8) {
    onStage(`Stage 1/2: Texture fill (${texPct}%) — polishing edges…`, 25)
    return await inpaint(texResult.result, maskData, {
      quality,
      onPass: (i, total) => onStage(`Stage 2/2: AI polish (pass ${i + 1}/${total})…`, 40 + (i / total) * 55),
    })
  }

  if (texResult.confidence > 0.3) {
    onStage(`Stage 1/2: Texture fill partial (${texPct}%) — AI completing…`, 20)
    return await inpaint(texResult.result, maskData, {
      quality,
      onPass: (i, total) => onStage(`Stage 2/2: AI inpainting (pass ${i + 1}/${total})…`, 35 + (i / total) * 60),
    })
  }

  onStage(`Stage 1/2: Texture minimal (${texPct}%) — AI full inpaint…`, 10)
  return await inpaint(imageData, maskData, {
    quality,
    onPass: (i, total) => onStage(`Stage 2/2: AI inpainting (pass ${i + 1}/${total})…`, 25 + (i / total) * 70),
  })
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

  // ── Shared video exact-removal pipeline (used by auto & manual paths) ──
  const runGeminiVideo = useCallback(async (f: File, region: { x: number; y: number; width: number; height: number }, w: number, h: number) => {
    const meta = await loadVideoMetadata(f)
    setProgressMsg('Gemini watermark terdeteksi — membersihkan exact…')
    const regionMask = new ImageData(w, h)
    for (let ry = 0; ry < region.height; ry++) {
      for (let rx = 0; rx < region.width; rx++) {
        const idx = ((region.y + ry) * w + (region.x + rx)) * 4
        regionMask.data[idx] = 255
        regionMask.data[idx + 3] = 255
      }
    }
    const blob = await processVideo({
      video: meta.video, maskImageData: regionMask,
      inpaintFn: async (img) => removeGeminiWatermark(img).imageData,
      onProgress: (pct, msg) => {
        setProgress(3 + (pct / 100) * 97)
        setProgressMsg(pct >= 95 ? msg : `Exact removal: ${msg}`)
      },
    })
    setResultUrl(URL.createObjectURL(blob)); setResultBlob(blob)
    URL.revokeObjectURL(meta.url)
  }, [])

  const handleFile = useCallback((f: File) => {
    const isVideo = /video\//.test(f.type) || /\.(mp4|mov|webm)$/i.test(f.name)
    const isImage = /image\//.test(f.type) || /\.(png|jpe?g|webp|bmp)$/i.test(f.name)
    if (!isVideo && !isImage) {
      addToast('⚠️ Format harus MP4/MOV/WebM atau PNG/JPG/WEBP', 'warning'); return
    }

    setFile(f); setResultUrl(null); setResultBlob(null); setCandidates([])
    setMaskData(null); setUndoStack([]); setFileUrl(URL.createObjectURL(f))
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
        setMaskData(autoMask)
        const mctx = mc.getContext('2d')!
        mctx.clearRect(0, 0, mc.width, mc.height)
        mctx.fillStyle = 'rgba(255, 0, 0, 0.5)'
        mctx.fillRect(region.x, region.y, region.width, region.height)
        URL.revokeObjectURL(meta.url)

        // Auto-process: nexabot.id UX — scan & clean immediately after upload.
        setProcessing(true); setProgress(3); setProgressMsg('Menganalisis watermark…')
        const gem = removeGeminiWatermark(ff)
        if (gem.meta.applied) {
          try {
            await runGeminiVideo(f, gem.meta.position!, ff.width, ff.height)
            addToast('✅ Watermark Gemini dihapus otomatis (exact)!', 'success')
            setProgress(100)
          } catch (e: any) { addToast(`❌ ${e.message}`, 'error') }
          setProcessing(false)
        } else {
          setProcessing(false); setProgress(0); setProgressMsg('')
          addToast('ℹ️ Bukan watermark Gemini — sesuaikan mask lalu klik Bersihkan.', 'info')
        }
      })
    }
  }, [addToast, runGeminiVideo])

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
  // Falls back to MI-GAN two-stage when the watermark is NOT Gemini/Veo.
  const runRemove = async () => {
    if (!imageData || !maskData) { addToast('⚠️ Upload & buat mask dulu!', 'warning'); return }
    const hasMask = Array.from(maskData.data).some((v, i) => i % 4 === 3 && v > 16)
    if (!hasMask) { addToast('⚠️ Area mask kosong!', 'warning'); return }

    setProcessing(true); setProgress(0); setProgressMsg('Starting…')

    try {
      if (inputMode === 'video' && file) {
        // Video: try exact Gemini removal per-frame first (bottom-right logo is
        // static), then fall back to inpainting if the logo is not detected.
        setProgressMsg('Checking for Gemini/Veo watermark…'); setProgress(3)
        const geminiResult = removeGeminiWatermark(imageData)

        if (geminiResult.meta.applied) {
          await runGeminiVideo(file, geminiResult.meta.position!, imageData.width, imageData.height)
          addToast('✅ Watermark Gemini dihapus (exact)!', 'success')
          setProgress(100)
        } else {
          // Fallback: MI-GAN two-stage inpainting for non-Gemini watermarks.
          const ok = await ensureEngine(); if (!ok) { setProcessing(false); return }
          const meta = await loadVideoMetadata(file)
          setProgressMsg('Stage 1/2: Texture analysis…'); setProgress(3)
          const blob = await processVideo({
            video: meta.video, maskImageData: maskData,
            inpaintFn: async (img, mask) => {
              return await twoStageRemoval(img, mask, quality, (stage, pct) => {
                setProgressMsg(stage); setProgress(Math.max(3, Math.min(pct, 25)))
              })
            },
            onProgress: (pct, msg) => {
              setProgress(25 + (pct / 100) * 75)
              setProgressMsg(pct >= 95 ? msg : `Recording: ${msg}`)
            },
          })
          setResultUrl(URL.createObjectURL(blob)); setResultBlob(blob)
          addToast('✅ Video dibersihkan (two-stage)!', 'success')
          URL.revokeObjectURL(meta.url)
        }
      } else {
        // Image: exact Gemini removal first (instant, lossless), else two-stage.
        setProgressMsg('Checking for Gemini/Veo watermark…'); setProgress(5)
        const geminiResult = removeGeminiWatermark(imageData)
        if (geminiResult.meta.applied) {
          const blob = await imageDataToBlob(geminiResult.imageData)
          setResultUrl(URL.createObjectURL(blob)); setResultBlob(blob)
          addToast('✅ Watermark Gemini dihapus (exact)!', 'success')
          setProgress(100)
        } else {
          const ok = await ensureEngine(); if (!ok) { setProcessing(false); return }
          const result = await twoStageRemoval(imageData, maskData, quality, (stage, pct) => {
            setProgressMsg(stage); setProgress(pct)
          })
          const blob = await imageDataToBlob(result)
          setResultUrl(URL.createObjectURL(blob)); setResultBlob(blob)
          addToast('✅ Watermark dibersihkan (two-stage)!', 'success')
          setProgress(100)
        }
      }
    } catch (e: any) { addToast(`❌ ${e.message}`, 'error') }
    finally { setProcessing(false) }
  }

  const downloadResult = () => {
    if (!resultUrl) return
    const a = document.createElement('a'); a.href = resultUrl
    a.download = file ? file.name.replace(/\.[^.]+$/, '') + '_nowm.' + (inputMode === 'video' ? 'mp4' : 'png') : 'result.png'
    a.click()
  }

  return (
    <PageContent>
      <PageHeader title="🧽 Watermark Remover" desc="Gemini/Veo exact + AI inpainting fallback. 100% lokal di browser." />

      <Section className="!p-4 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className={`flex items-center gap-1.5 text-xs font-medium ${engineReady ? 'text-emerald-400' : 'text-amber-400'}`}>
            <BrainCircuit className="h-3.5 w-3.5" />
            {engineReady ? `MI-GAN ready (${backend})` : engineLoading ? engineProgress : 'Gemini exact ✓ · MI-GAN untuk watermark lain'}
          </div>
          {!engineReady && (
            <Button size="sm" variant="outline" onClick={ensureEngine} disabled={engineLoading}>
              {engineLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <BrainCircuit className="h-3 w-3 mr-1" />}
              {engineLoading ? 'Loading…' : 'Init MI-GAN Engine'}
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
                <div className="text-sm text-muted-foreground font-medium">Tarik & letakkan gambar/video</div>
                <div className="text-xs text-muted-foreground mt-1">PNG/JPG/WEBP atau MP4/MOV/WebM — ≤ 10 detik untuk video</div>
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
                      onClick={() => { setSelectedCandidate(i); imageData && applyCandidateMask(c, imageData.width, imageData.height) }}
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
            Gemini/Veo: reverse-alpha exact (instan). Lainnya: texture + MI-GAN AI (~29MB, cached).
          </p>
        </Section>

        <Section title="📤 Hasil" className="!p-6">
          <div className="min-h-[200px]">
            {resultUrl ? (
              <div className="rounded-lg border border-border overflow-hidden">
                {inputMode === 'image' && (
                  <div className="flex gap-2 p-2 border-b border-border">
                    <button onClick={() => setCompare('before')}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${compare === 'before' ? 'bg-primary text-primary-foreground' : 'bg-surface-secondary text-muted-foreground'}`}>Sebelum</button>
                    <button onClick={() => setCompare('after')}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${compare === 'after' ? 'bg-primary text-primary-foreground' : 'bg-surface-secondary text-muted-foreground'}`}>Sesudah ✨</button>
                  </div>
                )}
                {inputMode === 'video' ? (
                  <video src={resultUrl} controls className="w-full" />
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
