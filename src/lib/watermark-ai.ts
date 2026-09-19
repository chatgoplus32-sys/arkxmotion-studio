import { fetchFile } from '@ffmpeg/util'
import { getFFmpeg } from './ffmpeg-compress'

// Engine "AI" ala NexaBot: inpainting canvas per frame (OpenCV Telea) untuk
// area watermark, lalu remux via ffmpeg.wasm. Semua lokal di browser.
//
// OpenCV.js dimuat runtime dari CDN (seperti ffmpeg core) supaya tidak
// membengkakkan bundle — unduh sekali (~8MB), lalu tersimpan di cache browser.

declare global {
  interface Window { cv?: any }
}

const OPENCV_URL = 'https://docs.opencv.org/4.10.0/opencv.js'

let cvPromise: Promise<any> | null = null

export function loadOpenCV(onProgress?: (msg: string) => void): Promise<any> {
  if (typeof window !== 'undefined' && (window as any).cv?.Mat) {
    return Promise.resolve((window as any).cv)
  }
  if (!cvPromise) {
    cvPromise = new Promise((resolve, reject) => {
      onProgress?.('Mengunduh OpenCV.js (~8MB, sekali saja)...')
      const s = document.createElement('script')
      s.src = OPENCV_URL
      s.async = true
      const timeout = setTimeout(() => reject(new Error('Timeout memuat OpenCV.js — periksa koneksi lalu coba lagi')), 120000)
      s.onload = () => {
        const check = () => {
          if ((window as any).cv?.Mat) {
            clearTimeout(timeout)
            resolve((window as any).cv)
          } else {
            setTimeout(check, 150)
          }
        }
        check()
      }
      s.onerror = () => {
        clearTimeout(timeout)
        cvPromise = null
        reject(new Error('Gagal memuat OpenCV.js dari CDN'))
      }
      document.head.appendChild(s)
    })
  }
  return cvPromise
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Gagal decode frame PNG'))
    }
    img.src = url
  })
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('Gagal encode frame PNG'))
        return
      }
      resolve(new Uint8Array(await blob.arrayBuffer()))
    }, 'image/png')
  })
}

/** Inpaint satu frame PNG pada rect (koordinat piksel absolut). */
export async function inpaintFrame(
  cv: any,
  pngBytes: Uint8Array,
  rect: { x: number; y: number; w: number; h: number },
  radius = 3,
): Promise<Uint8Array> {
  const imgEl = await blobToImage(new Blob([pngBytes as BlobPart], { type: 'image/png' }))
  const src = cv.imread(imgEl)
  try {
    const W = src.cols
    const H = src.rows
    const x = Math.max(0, Math.min(rect.x, W - 1))
    const y = Math.max(0, Math.min(rect.y, H - 1))
    const w = Math.max(1, Math.min(rect.w, W - x))
    const h = Math.max(1, Math.min(rect.h, H - y))

    const mask = cv.Mat.zeros(H, W, cv.CV_8UC1)
    try {
      cv.rectangle(mask, new cv.Point(x, y), new cv.Point(x + w, y + h), new cv.Scalar(255, 255, 255, 255), -1)
      const dst = new cv.Mat()
      try {
        cv.inpaint(src, mask, dst, radius, cv.INPAINT_TELEA)
        const canvas = document.createElement('canvas')
        canvas.width = W
        canvas.height = H
        cv.imshow(canvas, dst)
        return await canvasToPngBytes(canvas)
      } finally {
        dst.delete()
      }
    } finally {
      mask.delete()
    }
  } finally {
    src.delete()
  }
}

export interface AiWatermarkOptions {
  inpaintRadius?: number
}

async function listDir(ffmpeg: any, path: string): Promise<string[]> {
  try {
    const entries: any = await ffmpeg.listDir(path)
    return (Array.isArray(entries) ? entries : [])
      .map((e: any) => (typeof e === 'string' ? e : e?.name))
      .filter((n: string) => n && /^f_\d+\.png$/.test(n))
      .sort()
  } catch {
    return []
  }
}

/**
 * Hapus watermark via AI inpaint per frame:
 * 1. extract semua frame → PNG
 * 2. inpaint area watermark tiap frame (OpenCV Telea)
 * 3. encode ulang + audio asli → MP4
 */
export async function removeWatermarkAI(
  file: File,
  box: { x: number; y: number; w: number; h: number },
  durationSec: number,
  opts: AiWatermarkOptions = {},
  onProgress?: (msg: string, pct?: number) => void,
): Promise<File> {
  const radius = Math.max(1, Math.min(10, opts.inpaintRadius ?? 3))
  const tag = `aiwm_${Date.now()}`
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase()
  const inputFile = `${tag}_in.${ext}`
  const framesDir = `/${tag}_frames`
  const outputFile = `${tag}_out.mp4`

  onProgress?.('Memuat OpenCV.js...', 2)
  const cv = await loadOpenCV((m) => onProgress?.(m, 4))
  onProgress?.('Memuat FFmpeg...', 6)
  const ffmpeg = await getFFmpeg()

  // Normalisasi box ke piksel absolut (clamp dilakukan per frame di inpaintFrame)
  const rect = {
    x: Math.max(0, Math.round(box.x)),
    y: Math.max(0, Math.round(box.y)),
    w: Math.max(8, Math.round(box.w)),
    h: Math.max(8, Math.round(box.h)),
  }

  try {
    await ffmpeg.createDir(framesDir)
    await ffmpeg.writeFile(inputFile, await fetchFile(file))

    // 1. Extract semua frame
    onProgress?.('Ekstrak frame video...', 8)
    await ffmpeg.exec(['-i', inputFile, '-vsync', '0', `${framesDir}/f_%04d.png`])
    let frames = await listDir(ffmpeg, framesDir)
    if (frames.length === 0) throw new Error('Gagal ekstrak frame video')
    const fps = durationSec > 0 ? frames.length / durationSec : 24
    onProgress?.(`${frames.length} frame @~${fps.toFixed(1)}fps`, 12)
    console.log(`[watermark-ai] ${frames.length} frames, fps≈${fps.toFixed(2)}, rect=${rect.w}x${rect.h}@${rect.x},${rect.y} r=${radius}`)

    // 2. Inpaint per frame (baca → proses → tulis ulang → lanjut; hemat memori)
    for (let i = 0; i < frames.length; i++) {
      const name = `${framesDir}/${frames[i]}`
      const raw: any = await ffmpeg.readFile(name)
      const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw
      const out = await inpaintFrame(cv, bytes as Uint8Array, rect, radius)
      await ffmpeg.writeFile(name, out)
      if ((i + 1) % 10 === 0 || i === frames.length - 1) {
        const pct = Math.round(12 + ((i + 1) / frames.length) * 73)
        onProgress?.(`Inpaint frame ${i + 1}/${frames.length}...`, pct)
      }
    }

    // 3. Encode ulang + audio asli
    onProgress?.('Encode video hasil...', 88)
    await ffmpeg.exec([
      '-framerate', String(Math.max(1, Math.round(fps))),
      '-i', `${framesDir}/f_%04d.png`,
      '-i', inputFile,
      '-map', '0:v',
      '-map', '1:a?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-shortest',
      outputFile,
    ])

    const data: any = await ffmpeg.readFile(outputFile)
    await ffmpeg.deleteFile(outputFile).catch(() => {})
    const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    const buf = new ArrayBuffer(dataBytes.byteLength)
    new Uint8Array(buf).set(dataBytes)
    onProgress?.(`Selesai — ${(dataBytes.byteLength / 1024 / 1024).toFixed(1)} MB`, 100)
    const outName = file.name.replace(/\.[^.]+$/, '') + '_ai-clean.mp4'
    return new File([buf], outName, { type: 'video/mp4' })
  } finally {
    // Bersihkan frame + input (output sudah dibaca)
    try {
      const leftovers = await listDir(ffmpeg, framesDir)
      for (const f of leftovers) await ffmpeg.deleteFile(`${framesDir}/${f}`).catch(() => {})
      await ffmpeg.deleteDir(framesDir).catch(() => {})
    } catch { /* abaikan */ }
    await ffmpeg.deleteFile(inputFile).catch(() => {})
  }
}
