import { fetchFile } from '@ffmpeg/util'
import { concatVideosFFmpeg, getFFmpeg } from './ffmpeg-compress'

// Pemecah video untuk "mode potong otomatis" di halaman AI Video Edit.
// Provider mere-render satu klip per generate, jadi video panjang dipecah di
// browser, tiap klip diedit terpisah, lalu digabung kembali. Semua klip dibuat
// dengan parameter codec identik (resolusi, fps, sar, pix_fmt) supaya penggabungan
// bisa pakai concat demuxer tanpa re-encode.

export const CLIP_SECONDS = 10
// 0 = potongan rata. Tumpang-tindih memang membantu kesinambungan gerak, tapi
// gabungan naive akan menduplikasi frame di setiap batas (kelihatan mundur
// 0,5 detik per potong), dan kita tidak bisa memotongnya kembali karena durasi
// hasil model tidak persis sama dengan durasi klip masuk.
export const CLIP_OVERLAP_SECONDS = 0
const MIN_TAIL_SECONDS = 2

export interface ClipSpec {
  index: number
  start: number
  duration: number
}

export interface SplitProgress {
  (msg: string, pct?: number): void
}

export function planClips(duration: number, clipSeconds = CLIP_SECONDS, overlap = CLIP_OVERLAP_SECONDS): ClipSpec[] {
  const specs: ClipSpec[] = []
  let start = 0
  while (start < duration - 0.05) {
    const remaining = duration - start
    // Ekor yang terlalu pendek diserap ke klip terakhir — model tidak bisa
    // dipakai mengedit potongan < 2 detik secara berguna.
    const len = Math.min(clipSeconds, remaining > clipSeconds + MIN_TAIL_SECONDS ? clipSeconds : remaining)
    specs.push({ index: specs.length, start: Number(start.toFixed(3)), duration: Number(len.toFixed(3)) })
    if (start + len >= duration - 0.05) break
    start += clipSeconds - overlap
  }
  return specs
}

async function runOnce(
  ffmpeg: Awaited<ReturnType<typeof getFFmpeg>>,
  args: string[],
  outName: string
): Promise<Uint8Array> {
  await ffmpeg.exec(args)
  const data = await ffmpeg.readFile(outName)
  await ffmpeg.deleteFile(outName).catch(() => {})
  return typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
}

function toFile(bytes: Uint8Array, name: string): File {
  const buf = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buf).set(bytes)
  return new File([buf], name, { type: 'video/mp4' })
}

/**
 * Pecah satu video menjadi N klip mp4 siap kirim.
 */
export async function splitVideoIntoClips(
  file: File,
  opts: { specs: ClipSpec[]; height?: number; fps?: number; onProgress?: SplitProgress }
): Promise<File[]> {
  const { specs, height = 720, fps = 30, onProgress } = opts
  const ffmpeg = await getFFmpeg()
  const stamp = Date.now()
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase()
  const inputName = `chunk_in_${stamp}.${ext}`

  onProgress?.('Memuat video ke FFmpeg...', 2)
  await ffmpeg.writeFile(inputName, await fetchFile(file))

  const clips: File[] = []
  try {
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i]
      const outName = `chunk_${stamp}_${i}.mp4`
      onProgress?.(`Memotong klip ${i + 1}/${specs.length} (${s.start}s → ${s.duration}s)...`, 5 + (i / specs.length) * 90)
      const bytes = await runOnce(ffmpeg, [
        '-ss', String(s.start),
        '-i', inputName,
        '-t', String(s.duration),
        '-vf', `scale=-2:'min(${height},ih)',fps=${fps},setsar=1`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '28',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '96k',
        '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        outName,
      ], outName)
      const clip = toFile(bytes, `clip_${String(i + 1).padStart(2, '0')}.mp4`)
      clips.push(clip)
      onProgress?.(`Klip ${i + 1}/${specs.length} — ${(clip.size / 1024 / 1024).toFixed(1)}MB`, 5 + ((i + 1) / specs.length) * 95)
    }
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
  }
  return clips
}

/**
 * Ambil video dari URL hasil. Eksternal CDN bisa diblokir CORS, jadi ada
 * fallback proxy same-origin yang sama dengan yang dipakai penghapus watermark.
 */
export async function fetchVideoFile(url: string, name: string): Promise<File> {
  let blob: Blob | null = null
  if (url.startsWith('blob:') || url.startsWith('/')) {
    const res = await fetch(url)
    if (res.ok) blob = await res.blob()
  } else {
    try {
      const res = await fetch(url)
      const ct = (res.headers.get('content-type') || '').toLowerCase()
      if (res.ok && !ct.includes('html')) blob = await res.blob()
    } catch {
      /* CORS — lanjut ke proxy */
    }
    if (!blob) {
      const res = await fetch(`/api/public/video-proxy?url=${encodeURIComponent(url)}`)
      if (res.ok) blob = await res.blob()
    }
  }
  if (!blob || blob.size < 1024) throw new Error(`Gagal mengunduh ${name}`)
  return new File([blob], name, { type: blob.type || 'video/mp4' })
}

export interface JoinResult {
  file: File
  /** Durasi gabungan versi klip diedit, sebelum/dan sesudah koreksi waktu. */
  editedDuration: number
  retimed: boolean
  audioFrom: 'original' | 'edited' | 'none'
}

/** Durasi file video lewat elemen <video> — jauh lebih murah daripada probe FFmpeg. */
export function measureVideoDuration(file: File): Promise<number> {
  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement('video')
    el.preload = 'metadata'
    el.muted = true
    const done = (value: number) => {
      URL.revokeObjectURL(url)
      resolve(value)
    }
    el.onloadedmetadata = () => done(el.duration || 0)
    el.onerror = () => done(0)
    el.src = url
  })
}

/**
 * Gabungkan klip hasil edit. `audioMode: 'original'` menempel kembali track
 * suara video sumber supaya tidak patah di tiap batas potong; kalau durasi
 * total hasil edit melenceng >3%, video diperlambat/dipercepat (setpts) dulu
 * agar tetap sinkron.
 */
export async function joinEditedClips(
  editedClips: File[],
  specs: ClipSpec[],
  sourceVideo: File,
  sourceDuration: number,
  opts: { audioMode: 'original' | 'edited'; onProgress?: SplitProgress }
): Promise<JoinResult> {
  const { audioMode, onProgress } = opts
  // Durasi klip masuk bukan jaminan durasi klip keluar — model bisa mengembalikan
  // panjang berbeda, jadi yang diukur adalah file hasilnya.
  const measured = await Promise.all(editedClips.map((f) => measureVideoDuration(f)))
  const editedDuration = measured.reduce((sum, d, i) => sum + (d > 0 ? d : specs[i]?.duration ?? 0), 0)

  onProgress?.('Menggabungkan klip hasil edit...', 0)
  let joined = await concatVideosFFmpeg(editedClips, (msg) => onProgress?.(msg, 20))

  if (audioMode === 'edited') {
    return { file: joined, editedDuration, retimed: false, audioFrom: 'edited' }
  }

  const factor = sourceDuration / editedDuration
  const drift = Math.abs(factor - 1)
  let retimed = false

  const ffmpeg = await getFFmpeg()
  const stamp = Date.now()
  const inName = `join_${stamp}.mp4`
  const srcName = `join_src_${stamp}.mp4`
  try {
    if (drift > 0.03) {
      onProgress?.(`Durasi hasil edit melenceng ${(drift * 100).toFixed(0)}% — menyesuaikan waktu (×${factor.toFixed(3)})...`, 45)
      await ffmpeg.writeFile(inName, await fetchFile(joined))
      const retimedBytes = await runOnce(ffmpeg, [
        '-i', inName,
        '-filter:v', `setpts=PTS*${factor.toFixed(5)}`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '25',
        '-an',
        `join_${stamp}_rt.mp4`,
      ], `join_${stamp}_rt.mp4`)
      joined = toFile(retimedBytes, 'joined_retimed.mp4')
      retimed = true
      await ffmpeg.deleteFile(inName).catch(() => {})
      await ffmpeg.writeFile(inName, await fetchFile(joined))
    } else {
      await ffmpeg.writeFile(inName, await fetchFile(joined))
    }

    await ffmpeg.writeFile(srcName, await fetchFile(sourceVideo))
    onProgress?.('Menempelkan audio asli...', 75)
    try {
      const muxed = await runOnce(ffmpeg, [
        '-i', inName,
        '-i', srcName,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-shortest',
        '-movflags', '+faststart',
        `join_${stamp}_final.mp4`,
      ], `join_${stamp}_final.mp4`)
      return { file: toFile(muxed, 'video-edit-gabungan.mp4'), editedDuration, retimed, audioFrom: 'original' }
    } catch {
      // Video sumber tidak punya track suara (atau gagal dipetakan) — hasil
      // tetap dipakai, tanpa audio.
      onProgress?.('Video sumber tidak punya audio — hasil tanpa suara.', 90)
      return { file: joined, editedDuration, retimed, audioFrom: 'none' }
    }
  } finally {
    await ffmpeg.deleteFile(inName).catch(() => {})
    await ffmpeg.deleteFile(srcName).catch(() => {})
  }
}
