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

// ══════════════════════════════════════════════════════════════
// MUSIC AVATAR STORYBOARD — split audio + concat video
// ══════════════════════════════════════════════════════════════

/** Durasi audio (detik) via Web Audio API — tanpa perlu ffprobe. */
export async function getAudioDuration(file: File): Promise<number> {
  const buf = await file.arrayBuffer()
  const Ctx = window.AudioContext || (window as any).webkitAudioContext
  if (!Ctx) throw new Error('Web Audio API tidak tersedia di browser ini')
  const ctx = new Ctx()
  try {
    const audio = await ctx.decodeAudioData(buf.slice(0))
    return audio.duration
  } finally {
    ctx.close().catch(() => {})
  }
}

/**
 * Pecah audio menjadi N segmen mp3 berdurasi sama (re-encode libmp3lame
 * supaya titik potong akurat untuk semua format input: mp3/m4a/wav/ogg).
 */
export async function splitAudioFFmpeg(
  file: File,
  segmentCount: number,
  onProgress?: (msg: string) => void
): Promise<File[]> {
  const duration = await getAudioDuration(file)
  if (!isFinite(duration) || duration <= 0) throw new Error('Gagal membaca durasi audio')
  const segDur = duration / segmentCount

  onProgress?.(`Memuat FFmpeg — durasi audio ${duration.toFixed(1)}s → ${segmentCount} segmen (@${segDur.toFixed(1)}s)`)
  const ffmpeg = await getFFmpeg()

  const ext = (file.name.split('.').pop() || 'mp3').toLowerCase()
  const inputName = `split_in_${Date.now()}.${ext}`
  await ffmpeg.writeFile(inputName, await fetchFile(file))

  const out: File[] = []
  try {
    for (let i = 0; i < segmentCount; i++) {
      const ss = (i * segDur).toFixed(3)
      const t = (i === segmentCount - 1 ? duration - i * segDur : segDur).toFixed(3)
      const outName = `split_seg_${Date.now()}_${i}.mp3`
      onProgress?.(`Memecah audio ${i + 1}/${segmentCount} (${ss}s → ${t}s)...`)
      await ffmpeg.exec([
        '-ss', ss,
        '-t', t,
        '-i', inputName,
        '-c:a', 'libmp3lame',
        '-b:a', '192k',
        outName,
      ])
      const data = await ffmpeg.readFile(outName)
      await ffmpeg.deleteFile(outName).catch(() => {})
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
      const buf = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(buf).set(bytes)
      out.push(new File([buf], `segment_${i + 1}.mp3`, { type: 'audio/mpeg' }))
    }
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
  }
  return out
}

/**
 * Gabungkan beberapa mp4 menjadi satu file (concat demuxer, -c copy —
 * tanpa re-encode). Fallback re-encode libx264 kalau parameter codec
 * segmen tidak identik.
 */
export async function concatVideosFFmpeg(
  files: File[],
  onProgress?: (msg: string) => void
): Promise<File> {
  if (files.length < 2) return files[0]
  const ffmpeg = await getFFmpeg()
  const stamp = Date.now()

  onProgress?.(`Menyiapkan ${files.length} segmen untuk digabung...`)
  const list: string[] = []
  for (let i = 0; i < files.length; i++) {
    const name = `cat_${stamp}_${i}.mp4`
    await ffmpeg.writeFile(name, await fetchFile(files[i]))
    list.push(`file '${name}'`)
  }
  const listName = `cat_${stamp}_list.txt`
  await ffmpeg.writeFile(listName, new TextEncoder().encode(list.join('\n')))
  const outName = `cat_${stamp}_out.mp4`

  const cleanup = async () => {
    await ffmpeg.deleteFile(listName).catch(() => {})
    await ffmpeg.deleteFile(outName).catch(() => {})
    for (let i = 0; i < files.length; i++) {
      await ffmpeg.deleteFile(`cat_${stamp}_${i}.mp4`).catch(() => {})
    }
  }

  try {
    onProgress?.('Menggabungkan video (concat tanpa re-encode)...')
    try {
      await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', listName, '-c', 'copy', outName])
    } catch {
      // Codec/param segmen beda → concat copy gagal. Re-encode sebagai fallback.
      onProgress?.('Concat copy gagal — re-encode (lebih lambat)...')
      await ffmpeg.exec([
        '-f', 'concat', '-safe', '0', '-i', listName,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outName,
      ])
    }
    const data = await ffmpeg.readFile(outName)
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    const buf = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buf).set(bytes)
    onProgress?.(`Gabungan selesai — ${formatSize(bytes.byteLength)}`)
    return new File([buf], `music_avatar_storyboard_${stamp}.mp4`, { type: 'video/mp4' })
  } finally {
    await cleanup()
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


// ── Metadata Cleaner (REA) ──────────────────────────────────────────────
// Hapus jejak metadata AI (C2PA/EXIF/XMP/timestamps/prompt/encoder) lewat
// remux tanpa re-encode — container ISO-BMFF ditulis ulang tanpa tag/udta.

const stripAnsi = (s: string) => s.replace(/\[[0-9;]*m/g, '')

/** Jalankan ffmpeg -i (tanpa output) dan parse blok "Metadata:" dari stderr. */
export async function scanMetadataFFmpeg(file: File): Promise<string[]> {
  const ffmpeg = await getFFmpeg()
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase()
  const inputFile = `scan_in_${Date.now()}.${ext}`
  const inputData = await fetchFile(file)
  await ffmpeg.writeFile(inputFile, inputData)

  const lines: string[] = []
  const handler = ({ message }: { type: string; message: string }) => lines.push(stripAnsi(message))
  ffmpeg.on('log', handler)
  try {
    // -i tanpa output sengaja error (exit != 0) — stderr-nya yang kita mau
    await ffmpeg.exec(['-i', inputFile]).catch(() => {})
  } finally {
    ffmpeg.off('log', handler)
    await ffmpeg.deleteFile(inputFile).catch(() => {})
  }

  const start = lines.findIndex((l) => /^\s*Metadata:/.test(l))
  if (start === -1) return []
  const found: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s{4,}([\w ()/\-]+?)\s*:\s+(.*)$/)
    if (!m) break
    found.push(`${m[1].trim()}: ${m[2].trim()}`)
  }
  return found
}

/** Remux dengan -map_metadata -1: buang semua tag, udta, dan atom metadata. */
export async function stripMetadataFFmpeg(
  file: File,
  onProgress?: (msg: string, pct: number) => void
): Promise<File> {
  onProgress?.('Loading FFmpeg...', 5)
  const ffmpeg = await getFFmpeg()

  const rawExt = (file.name.split('.').pop() || 'mp4').toLowerCase()
  const ext = ['mp4', 'mov', 'm4v', 'webm', 'mkv'].includes(rawExt) ? rawExt : 'mp4'
  const isIsobmff = ['mp4', 'mov', 'm4v'].includes(ext)
  const inputFile = `clean_in_${Date.now()}.${ext}`
  const outputFile = `clean_out_${Date.now()}.${ext}`
  const inputData = await fetchFile(file)
  await ffmpeg.writeFile(inputFile, inputData)

  try {
    onProgress?.('Menyusun ulang container tanpa metadata...', 25)
    const args = [
      '-i', inputFile,
      '-map_metadata', '-1',
      '-map_chapters', '-1',
      '-c', 'copy',
      '-fflags', '+bitexact',
    ]
    if (isIsobmff) args.push('-movflags', '+faststart')
    args.push(outputFile)
    const code = await ffmpeg.exec(args)
    if (code !== 0) throw new Error(`ffmpeg exec gagal (kode ${code})`)

    onProgress?.('Membaca hasil...', 85)
    const data = await ffmpeg.readFile(outputFile)
    await ffmpeg.deleteFile(outputFile).catch(() => {})
    const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    const byteLength = dataBytes.byteLength
    const buf = new ArrayBuffer(byteLength)
    new Uint8Array(buf).set(dataBytes)
    const outName = file.name.replace(/\.[^.]+$/, '_clean.' + ext)
    onProgress?.(`Selesai — ${formatSize(byteLength)}`, 100)
    return new File([buf], outName, { type: file.type || 'video/mp4' })
  } finally {
    await ffmpeg.deleteFile(inputFile).catch(() => {})
  }
}
