import {
  autoDilateRadius,
  dilateMask,
  MASK_THRESHOLD,
  removeWithSeamCorrection,
} from './inpaint-core'

/**
 * Video watermark removal pipeline — pure browser, no ffmpeg.
 *
 * Strategy:
 * 1. Run AI inpainting ONCE on the first frame to get clean pixels
 * 2. Build a transparent patch canvas with the cleaned region
 * 3. Play source video at 1× and composite patch on each frame
 * 4. MediaRecorder captures via captureStream(30) + requestAnimationFrame drawing
 *
 * Key fix: video.ended event is unreliable for blob URLs. Use time-based
 * end detection (currentTime >= duration - 0.1) and force-stop as fallback.
 */

export interface VideoMeta {
  video: HTMLVideoElement
  url: string
  width: number
  height: number
  duration: number
}

export async function loadVideoMetadata(file: File): Promise<VideoMeta> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  await new Promise<void>((resolve, reject) => {
    video.addEventListener('loadedmetadata', () => resolve(), { once: true })
    video.addEventListener('error', () => reject(new Error('Could not decode video')), { once: true })
  })
  return { video, url, width: video.videoWidth, height: video.videoHeight, duration: video.duration }
}

export async function grabFirstFrame(video: HTMLVideoElement): Promise<ImageData> {
  if (video.readyState < 2) {
    await new Promise<void>(r => video.addEventListener('loadeddata', () => r(), { once: true }))
  }
  video.currentTime = 0
  await new Promise<void>(r => video.addEventListener('seeked', () => r(), { once: true }))
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(video, 0, 0)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/**
 * Patch RGBA untuk jalur inpaint: hanya piksel di dalam hole yang dipakai
 * (area lain transparan supaya frame asli yang terlihat).
 *
 * Nada patch sudah dikoreksi lewat removeWithSeamCorrection dan hole-nya
 * dilebarkan otomatis, jadi saat ditempel ke setiap frame tidak ada bekas
 * garis/blur di tepi patch.
 */
function buildPatchCanvas(
  originalFrame: ImageData,
  inpaintedImage: ImageData,
  maskImage: ImageData,
): OffscreenCanvas {
  const { width: w, height: h } = maskImage
  const composited = removeWithSeamCorrection(originalFrame, inpaintedImage, maskImage)
  const hole = dilateMask(maskImage, autoDilateRadius(maskImage))
  const patch = new ImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    if (hole.data[i * 4 + 3] > MASK_THRESHOLD) {
      patch.data[i * 4] = composited[i * 4]
      patch.data[i * 4 + 1] = composited[i * 4 + 1]
      patch.data[i * 4 + 2] = composited[i * 4 + 2]
      patch.data[i * 4 + 3] = 255
    }
  }
  const cn = new OffscreenCanvas(w, h)
  cn.getContext('2d')!.putImageData(patch, 0, 0)
  return cn
}

export interface ProcessVideoOpts {
  fps?: number
  includeAudio?: boolean
  mimeType?: string
}

export interface ProcessVideoProgress {
  (pct: number, msg: string): void
}

/**
 * @param frameProcessor Diproses tiap frame (mis. reverse-alpha Gemini) —
 *   hasilnya selalu ikut konten frame, bukan patch beku.
 * @param inpaintFn Legacy: hasilkan patch dari frame pertama lalu composite
 *   ke semua frame (fallback MI-GAN untuk watermark non-Gemini).
 */
export async function processVideo({
  video,
  maskImageData,
  inpaintFn,
  frameProcessor,
  onProgress,
  opts = {},
}: {
  video: HTMLVideoElement
  maskImageData?: ImageData | null
  inpaintFn?: (imageData: ImageData, maskData: ImageData) => Promise<ImageData>
  frameProcessor?: (ctx: CanvasRenderingContext2D) => void
  onProgress?: ProcessVideoProgress
  opts?: ProcessVideoOpts
}): Promise<Blob> {
  if (!frameProcessor && (!inpaintFn || !maskImageData)) {
    throw new Error('processVideo: butuh frameProcessor atau inpaintFn + mask')
  }
  const fps = opts.fps || 30
  const width = video.videoWidth
  const height = video.videoHeight
  const duration = video.duration
  const t0 = performance.now()

  // ===== Step 1: seek to start =====
  onProgress?.(2, 'Decoding first frame')
  video.muted = true
  video.currentTime = 0
  await new Promise<void>((resolve) => {
    const handler = () => { video.removeEventListener('seeked', handler); resolve() }
    video.addEventListener('seeked', handler)
  })

  const refCanvas = document.createElement('canvas')
  refCanvas.width = width
  refCanvas.height = height
  const refCtx = refCanvas.getContext('2d', { willReadFrequently: true })!
  refCtx.drawImage(video, 0, 0)
  const firstFrameImageData = refCtx.getImageData(0, 0, width, height)

  // Patch statis hanya untuk jalur inpaintFn (fallback MI-GAN).
  let patchCanvas: OffscreenCanvas | null = null
  if (!frameProcessor && inpaintFn && maskImageData) {
    onProgress?.(5, 'Running AI on reference frame (one-time)')
    const inpaintedFirstFrame = await inpaintFn(firstFrameImageData, maskImageData)
    onProgress?.(12, 'Preparing patch')
    patchCanvas = buildPatchCanvas(firstFrameImageData, inpaintedFirstFrame, maskImageData)
  } else {
    onProgress?.(5, 'Preparing per-frame cleaner')
  }

  // ===== Step 3: Set up output canvas + recording =====
  const outCanvas = document.createElement('canvas')
  outCanvas.width = width
  outCanvas.height = height
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true })!

  const drawClean = () => {
    outCtx.drawImage(video, 0, 0, width, height)
    if (frameProcessor) frameProcessor(outCtx)
    else if (patchCanvas) outCtx.drawImage(patchCanvas, 0, 0)
  }

  // captureStream(fps) — auto-capture at the specified rate
  const canvasStream = outCanvas.captureStream(fps)
  const videoTrack = canvasStream.getVideoTracks()[0]
  if (!videoTrack) throw new Error('captureStream returned no video track')

  // Audio: try to capture from source video
  let audioTrack: MediaStreamTrack | null = null
  if (opts.includeAudio !== false) {
    try {
      const srcStream = (video as any).captureStream?.() || (video as any).mozCaptureStream?.()
      if (srcStream) {
        const at = srcStream.getAudioTracks()[0]
        if (at) audioTrack = at
      }
    } catch (e) {
      console.warn('[video] Could not capture audio:', e)
    }
  }

  const mediaStream = new MediaStream()
  mediaStream.addTrack(videoTrack)
  if (audioTrack) mediaStream.addTrack(audioTrack)

  const candidates = [
    // Prefer MP4 — most players (Windows Media Player, HP) can't play WebM.
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  const mimeType = opts.mimeType || candidates.find(m => MediaRecorder.isTypeSupported(m))
  if (!mimeType) throw new Error('No supported MediaRecorder mime type')

  const recorder = new MediaRecorder(mediaStream, { mimeType, videoBitsPerSecond: 5_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data) }
  let resolveRecordingDone!: () => void
  const recordingDone = new Promise<void>(r => { resolveRecordingDone = r })
  let recorderStopped = false
  const stopRecorderOnce = () => {
    if (recorderStopped) return
    recorderStopped = true
    try {
      recorder.onstop = () => resolveRecordingDone()
      if (recorder.state !== 'inactive') recorder.stop()
      else resolveRecordingDone()
    } catch { resolveRecordingDone() }
  }

  let frameCount = 0

  // ===== Step 4: Play video and capture =====
  onProgress?.(15, 'Recording — playing through video')

  // Seek to start
  video.currentTime = 0
  await new Promise<void>((resolve) => {
    const handler = () => { video.removeEventListener('seeked', handler); resolve() }
    video.addEventListener('seeked', handler)
  })

  // Draw first frame
  drawClean()

  // Start recorder
  recorder.start()

  // ===== Force-stop timer: video.ended is unreliable for blob URLs =====
  const FORCE_STOP_MS = Math.max((duration + 2) * 1000, 5000)
  let stopped = false
  const forceStopTimer = setTimeout(() => {
    if (!stopped) {
      stopped = true
      console.warn('[video] Force-stop timer triggered')
      video.pause()
      stopRecorderOnce()
    }
  }, FORCE_STOP_MS)

  await new Promise<void>((resolve, reject) => {
    let lastReportedPct = 15
    let animId = 0
  
    const finish = () => {
      if (stopped) return
      stopped = true
      clearTimeout(forceStopTimer)
      cancelAnimationFrame(animId)
      // Draw final frame one last time
      drawClean()
      resolve()
    }

    const drawFrame = () => {
      if (stopped) return

      // Time-based end detection (video.ended is unreliable for blob URLs)
      if (video.currentTime >= duration - 0.1 || video.ended || video.paused) {
        finish()
        return
      }

      // Draw video frame + per-frame cleaning (bukan patch statis)
      drawClean()
      frameCount++

      const progress = Math.min(98, 15 + (video.currentTime / Math.max(duration, 0.01)) * 83)
      if (progress - lastReportedPct >= 1) {
        onProgress?.(progress, `Recording ${video.currentTime.toFixed(1)}s / ${duration.toFixed(1)}s`)
        lastReportedPct = progress
      }

      animId = requestAnimationFrame(drawFrame)
    }

    video.addEventListener('ended', finish, { once: true })

    video.play().then(() => {
      animId = requestAnimationFrame(drawFrame)
    }).catch((e) => {
      clearTimeout(forceStopTimer)
      cancelAnimationFrame(animId)
      reject(new Error('Could not play video: ' + (e.message || e)))
    })
  })

  // ===== Step 5: Finalize =====
  onProgress?.(99, 'Encoding final frames')
  await new Promise<void>(r => setTimeout(r, 1000)) // Wait for encoder to flush
  stopRecorderOnce()
  await recordingDone
  video.pause()

  const totalSec = ((performance.now() - t0) / 1000).toFixed(1)
  onProgress?.(100, `Done in ${totalSec}s`)

  const blob = new Blob(chunks, { type: mimeType })
  console.log(`[video] Output: ${(blob.size / 1024).toFixed(1)}KB, ${totalSec}s total, ${frameCount} frames`)

  if (blob.size === 0) {
    throw new Error('MediaRecorder produced empty output. Try a different browser or shorter video.')
  }

  return blob
}
