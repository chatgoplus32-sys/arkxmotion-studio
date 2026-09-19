import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let ffmpegInstance: FFmpeg | null = null

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance
  const ffmpeg = new FFmpeg()
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  ffmpegInstance = ffmpeg
  return ffmpeg
}

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(1)} MB`
}

export async function trimVideoFFmpeg(
  file: File,
  maxDuration: number,
  onProgress?: (msg: string, pct?: number) => void
): Promise<File> {
  onProgress?.('Loading FFmpeg for trim...')
  const ffmpeg = await getFFmpeg()

  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase()
  const inputFile = `trim_in_${Date.now()}.${ext}`
  const outputFile = `trim_out_${Date.now()}.mp4`
  const inputData = await fetchFile(file)
  await ffmpeg.writeFile(inputFile, inputData)

  try {
    onProgress?.(`Trimming to ${maxDuration}s...`, 30)
    await ffmpeg.exec([
      '-i', inputFile,
      '-t', String(maxDuration),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputFile,
    ])

    const data = await ffmpeg.readFile(outputFile)
    await ffmpeg.deleteFile(outputFile).catch(() => {})
    const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    const byteLength = dataBytes.byteLength

    onProgress?.(`Trimmed — ${formatSize(byteLength)}`, 100)
    const buf = new ArrayBuffer(byteLength)
    new Uint8Array(buf).set(dataBytes)
    const outName = file.name.replace(/\.[^.]+$/, '_trimmed.mp4')
    return new File([buf], outName, { type: 'video/mp4' })
  } finally {
    await ffmpeg.deleteFile(inputFile).catch(() => {})
  }
}

export interface DelogoBox {
  /** Koordinat piksel absolut dalam frame video */
  x: number
  y: number
  w: number
  h: number
}

export async function removeWatermarkFFmpeg(
  file: File,
  box: DelogoBox,
  onProgress?: (msg: string, pct?: number) => void
): Promise<File> {
  const x = Math.max(0, Math.round(box.x))
  const y = Math.max(0, Math.round(box.y))
  const w = Math.max(8, Math.round(box.w))
  const h = Math.max(8, Math.round(box.h))

  onProgress?.('Loading FFmpeg...', 5)
  const ffmpeg = await getFFmpeg()

  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase()
  const inputFile = `delogo_in_${Date.now()}.${ext}`
  const outputFile = `delogo_out_${Date.now()}.mp4`
  const inputData = await fetchFile(file)
  await ffmpeg.writeFile(inputFile, inputData)

  try {
    onProgress?.(`Membersihkan area ${w}×${h}...`, 30)
    const onFfmpegProgress = ({ progress }: { progress: number }) => {
      const pct = Math.round(30 + Math.min(Math.max(progress, 0), 1) * 65)
      onProgress?.(`Memproses...`, pct)
    }
    ffmpeg.on('progress', onFfmpegProgress)
    try {
      await ffmpeg.exec([
        '-i', inputFile,
        '-vf', `delogo=x=${x}:y=${y}:w=${w}:h=${h}`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-c:a', 'copy',
        outputFile,
      ])
    } finally {
      ffmpeg.off('progress', onFfmpegProgress)
    }

    const data = await ffmpeg.readFile(outputFile)
    await ffmpeg.deleteFile(outputFile).catch(() => {})
    const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    const byteLength = dataBytes.byteLength

    onProgress?.(`Selesai — ${formatSize(byteLength)}`, 100)
    const buf = new ArrayBuffer(byteLength)
    new Uint8Array(buf).set(dataBytes)
    const outName = file.name.replace(/\.[^.]+$/, '') + '_nowm.mp4'
    return new File([buf], outName, { type: 'video/mp4' })
  } finally {
    await ffmpeg.deleteFile(inputFile).catch(() => {})
  }
}

export async function compressVideoFFmpeg(
  file: File,
  maxBytes: number = 4 * 1024 * 1024,
  onProgress?: (msg: string, pct?: number) => void
): Promise<File> {
  const SMART_FAST_TARGET = 900 * 1024
  const effectiveMax = file.size > SMART_FAST_TARGET && file.size <= maxBytes ? SMART_FAST_TARGET : maxBytes
  if (file.size <= effectiveMax) {
    console.log(`[ffmpeg] ${formatSize(file.size)} <= ${formatSize(effectiveMax)}, skip`)
    return file
  }
  if (effectiveMax !== maxBytes) console.log(`[ffmpeg] Smart fast target ${formatSize(effectiveMax)} (original ${formatSize(file.size)} >0.9MB) → compress 1.3MB→~500KB`)

  onProgress?.('Loading FFmpeg encoder...')
  const ffmpeg = await getFFmpeg()

  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase()
  const inputFile = `in_${Date.now()}.${ext}`
  const inputData = await fetchFile(file)
  await ffmpeg.writeFile(inputFile, inputData)

  const presets = [
    { crf: 28, height: 720, audio: '96k' },
    { crf: 30, height: 640, audio: '80k' },
    { crf: 32, height: 540, audio: '64k' },
    { crf: 34, height: 480, audio: '64k' },
    { crf: 36, height: 360, audio: '48k' },
  ]

  try {
    for (let i = 0; i < presets.length; i++) {
      const p = presets[i]
      const outputFile = `out_${i}.mp4`
      const need = effectiveMax !== maxBytes ? ` → target ${formatSize(effectiveMax)}` : ''
      onProgress?.(`Compressing (pass ${i + 1}/${presets.length}, ${p.height}p${need})...`, Math.round((i / presets.length) * 100))

      await ffmpeg.exec([
        '-i', inputFile,
        '-vf', `scale=-2:'min(${p.height},ih)'`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', String(p.crf),
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-c:a', 'aac',
        '-b:a', p.audio,
        outputFile,
      ])

      const data = await ffmpeg.readFile(outputFile)
      await ffmpeg.deleteFile(outputFile).catch(() => {})

      const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
      const byteLength = dataBytes.byteLength
      console.log(`[ffmpeg] pass ${i + 1}: ${p.height}p crf=${p.crf} → ${formatSize(byteLength)}`)

      if (byteLength <= effectiveMax) {
        onProgress?.(`Done — ${formatSize(byteLength)}`, 100)
        const buf = new ArrayBuffer(byteLength)
        new Uint8Array(buf).set(dataBytes)
        const outName = file.name.replace(/\.[^.]+$/, '.mp4')
        return new File([buf], outName, { type: 'video/mp4' })
      }
    }

    throw new Error(`Video still > ${formatSize(effectiveMax)} after maximum compression. Try shortening the video.`)
  } finally {
    await ffmpeg.deleteFile(inputFile).catch(() => {})
  }
}
