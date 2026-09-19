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

function buildPatchCanvas(
  inpaintedImage: ImageData,
  maskImage: ImageData,
  featherRadius = 6,
): OffscreenCanvas {
  const { width: w, height: h } = inpaintedImage
  const patch = new ImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    if (maskImage.data[i * 4 + 3] > 16) {
      patch.data[i * 4] = inpaintedImage.data[i * 4]
      patch.data[i * 4 + 1] = inpaintedImage.data[i * 4 + 1]
      patch.data[i * 4 + 2] = inpaintedImage.data[i * 4 + 2]
      patch.data[i * 4 + 3] = 255
    }
  }
  const baseCanvas = new OffscreenCanvas(w, h)
  baseCanvas.getContext('2d')!.putImageData(patch, 0, 0)
  const featherCanvas = new OffscreenCanvas(w, h)
  const fctx = featherCanvas.getContext('2d')!
  fctx.filter = `blur(${featherRadius}px)`
  fctx.drawImage(baseCanvas, 0, 0)
  fctx.filter = 'none'
  return featherCanvas
}

export interface ProcessVideoOpts {
  fps?: number
  includeAudio?: boolean
  mimeType?: string
}

export interface ProcessVideoProgress {
  (pct: number, msg: string): void
}

export async function processVideo({
  video,
  maskImageData,
  inpaintFn,
  onProgress,
  opts = {},
}: {
  video: HTMLVideoElement
  maskImageData: ImageData
  inpaintFn: (imageData: ImageData, maskData: ImageData) => Promise<ImageData>
  onProgress?: ProcessVideoProgress
  opts?: ProcessVideoOpts
}): Promise<Blob> {
  const fps = opts.fps || 30
  const width = video.videoWidth
  const height = video.videoHeight
  const duration = video.duration
  const t0 = performance.now()

  // ===== Step 1: AI on first frame =====
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

  onProgress?.(5, 'Running AI on reference frame (one-time)')
  const inpaintedFirstFrame = await inpaintFn(firstFrameImageData, maskImageData)

  // ===== Step 2: Build patch =====
  onProgress?.(12, 'Preparing patch')
  const patchCanvas = buildPatchCanvas(inpaintedFirstFrame, maskImageData, 6)

  // ===== Step 3: Set up output canvas + recording =====
  const outCanvas = document.createElement('canvas')
  outCanvas.width = width
  outCanvas.height = height
  const outCtx = outCanvas.getContext('2d')!

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
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
  ]
  const mimeType = opts.mimeType || candidates.find(m => MediaRecorder.isTypeSupported(m))
  if (!mimeType) throw new Error('No supported MediaRecorder mime type')

  const recorder = new MediaRecorder(mediaStream, { mimeType, videoBitsPerSecond: 5_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data) }
  const recordingDone = new Promise<void>(r => { recorder.onstop = () => r() })

  // ===== Step 4: Play video and capture =====
  onProgress?.(15, 'Recording — playing through video')

  // Seek to start
  video.currentTime = 0
  await new Promise<void>((resolve) => {
    const handler = () => { video.removeEventListener('seeked', handler); resolve() }
    video.addEventListener('seeked', handler)
  })

  // Draw first frame
  outCtx.drawImage(video, 0, 0, width, height)
  outCtx.drawImage(patchCanvas, 0, 0)

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
      recorder.stop()
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
      outCtx.drawImage(video, 0, 0, width, height)
      outCtx.drawImage(patchCanvas, 0, 0)
      resolve()
    }

    const drawFrame = () => {
      if (stopped) return

      // Time-based end detection (video.ended is unreliable for blob URLs)
      if (video.currentTime >= duration - 0.1 || video.ended || video.paused) {
        finish()
        return
      }

      // Draw video frame + patch overlay
      outCtx.drawImage(video, 0, 0, width, height)
      outCtx.drawImage(patchCanvas, 0, 0)
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
  let frameCount = 0
  onProgress?.(99, 'Encoding final frames')
  await new Promise<void>(r => setTimeout(r, 1000)) // Wait for encoder to flush
  recorder.stop()
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
