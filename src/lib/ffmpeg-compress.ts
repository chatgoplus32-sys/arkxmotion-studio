import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let ffmpegInstance: FFmpeg | null = null

async function getFFmpeg(): Promise<FFmpeg> {
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

export async function compressVideoFFmpeg(
  file: File,
  maxBytes: number = 4 * 1024 * 1024,
  onProgress?: (msg: string, pct?: number) => void
): Promise<File> {
  if (file.size <= maxBytes) {
    console.log(`[ffmpeg] ${formatSize(file.size)} <= ${formatSize(maxBytes)}, skip`)
    return file
  }

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
      onProgress?.(`Compressing (pass ${i + 1}/${presets.length}, ${p.height}p)...`, Math.round((i / presets.length) * 100))

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

      if (byteLength <= maxBytes) {
        onProgress?.(`Done — ${formatSize(byteLength)}`, 100)
        const buf = new ArrayBuffer(byteLength)
        new Uint8Array(buf).set(dataBytes)
        const outName = file.name.replace(/\.[^.]+$/, '.mp4')
        return new File([buf], outName, { type: 'video/mp4' })
      }
    }

    throw new Error(`Video still > ${formatSize(maxBytes)} after maximum compression. Try shortening the video.`)
  } finally {
    await ffmpeg.deleteFile(inputFile).catch(() => {})
  }
}
