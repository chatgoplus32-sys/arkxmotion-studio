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
// Panjang crossfade di setiap batas klip saat hasil edit digabung ulang —
// cukup untuk menyembunyikan lompatan, cukup pendek agar timeline tidak
// menyusut banyak (dipakai juga untuk menghitung faktor retime audio).
const FADE_SECONDS = 0.3

export interface ClipSpec {
  index: number
  start: number
  duration: number
}

/** Rentang video sumber yang benar-benar diedit (detik). */
export interface TrimRange {
  start: number
  end: number
}

/**
 * Rapikan rentang pilihan user sebelum dipakai menghitung klip & biaya:
 * dijepit ke durasi video, dan minimal `minSeconds` supaya tidak pernah ada
 * generate untuk potongan 0 detik (satu tiket terbakar tanpa hasil).
 */
export function normalizeTrim(
  duration: number,
  start: number,
  end: number,
  minSeconds = 1
): TrimRange {
  const total = Math.max(0, Number(duration) || 0)
  if (total <= minSeconds) return { start: 0, end: Number(total.toFixed(3)) }
  const from = Math.min(Math.max(Number(start) || 0, 0), total - minSeconds)
  const to = Math.min(Math.max(Number(end) || 0, from + minSeconds), total)
  return { start: Number(from.toFixed(3)), end: Number(to.toFixed(3)) }
}

/**
 * Apakah rentang ini benar-benar memotong, bukan seluruh video? Toleransi 0,1
 * detik dipakai supaya sisa pembulatan slider tidak memicu potong sia-sia.
 */
export function isTrimmedRange(duration: number, range: TrimRange | null): boolean {
  if (!range) return false
  return range.start > 0.1 || range.end < duration - 0.1
}

export interface SplitProgress {
  (msg: string, pct?: number): void
}

export function planClips(duration: number, clipSeconds = CLIP_SECONDS, overlap = CLIP_OVERLAP_SECONDS): ClipSpec[] {
  const specs: ClipSpec[] = []
  let start = 0
  while (start < duration - 0.05) {
    const remaining = duration - start
    // Sisa ≤ MIN_TAIL setelah satu klip penuh tidak boleh menjadi klip
    // tersendiri: 1 detik hasil model hanya pemborosan satu tiket. Karena itu
    // selama remaining masih muat ditoleransi (≤ CLIP + MIN_TAIL) seluruh
    // sisanya diambil sebagai SATU klip — termasuk kalau itu berarti klipnya
    // 11–12 detik. `Math.min(clipSeconds, …)` di sini salah: ia memotong
    // kembali ke 10 dan meninggalkan ekor 1 detik untuk iterasi berikutnya.
    const len = remaining > clipSeconds + MIN_TAIL_SECONDS ? clipSeconds : remaining
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
 * Potong satu rentang dari video sumber dan encode ulang dengan parameter yang
 * sama dengan pemecah klip (resolusi, fps, sar, pix_fmt). Re-encode dipakai
 * supaya titik potongnya presisi — `-c copy` hanya bisa memotong di keyframe
 * terdekat, jadi pilihan user bisa bergeser sampai beberapa detik.
 */
export async function trimVideo(
  file: File,
  opts: { range: TrimRange; height?: number; fps?: number; onProgress?: SplitProgress }
): Promise<File> {
  const { range, height = 720, fps = 30, onProgress } = opts
  const durasi = Math.max(0.1, range.end - range.start)
  const ffmpeg = await getFFmpeg()
  const stamp = Date.now()
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase()
  const inputName = `trim_in_${stamp}.${ext}`
  const outName = `trim_${stamp}.mp4`

  onProgress?.('Memuat video ke FFmpeg...', 2)
  await ffmpeg.writeFile(inputName, await fetchFile(file))
  try {
    onProgress?.(`Memotong ${range.start}s → ${range.end}s...`, 25)
    const bytes = await runOnce(ffmpeg, [
      '-ss', String(range.start),
      '-i', inputName,
      '-t', String(Number(durasi.toFixed(3))),
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
    const potongan = toFile(bytes, `potongan_${range.start}-${range.end}s.mp4`)
    onProgress?.(`Potongan siap (${(potongan.size / 1024 / 1024).toFixed(1)}MB)`, 100)
    return potongan
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {})
  }
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
  /** Batas potong dilarutkan crossfade (hanya saat audio ditutup dari sumber). */
  crossfaded: boolean
}

/**
 * Durasi file video lewat elemen <video> — jauh lebih murah daripada probe FFmpeg.
 */
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
 * Frame terakhir satu video sebagai data URI PNG, dipakai sebagai kunci
 * kesinambungan antar klip. Diambil lewat canvas, bukan FFmpeg, jadi murah.
 */
export function lastFrameDataUri(file: File, seekBack = 0.15): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement('video')
    el.muted = true
    el.preload = 'auto'
    const cleanup = () => URL.revokeObjectURL(url)
    el.onloadedmetadata = () => {
      const d = el.duration
      // Durasi tak hingga/NaN bikin perhitungan mundur jatuh ke 0 — itu frame
      // PERTAMA, bukan terakhir. Kirim frame pertama sebagai acuan justru
      // membuat klip berikutnya mengulang awal klip sebelumnya, jadi lebih baik
      // menyerah dan klip berikutnya dirender tanpa acuan.
      if (!isFinite(d) || d <= 0) {
        cleanup()
        reject(new Error('durasi hasil edit tidak terbaca'))
        return
      }
      // Mundur sedikit dari ujung: frame paling akhir sering hitam/patah.
      el.currentTime = Math.max(0, d - seekBack)
    }
    el.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = el.videoWidth || 640
        canvas.height = el.videoHeight || 360
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('canvas tidak tersedia')
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
        const uri = canvas.toDataURL('image/png')
        cleanup()
        resolve(uri)
      } catch (e: any) {
        cleanup()
        reject(e)
      }
    }
    el.onerror = () => {
      cleanup()
      reject(new Error('gagal membaca frame terakhir video'))
    }
    el.src = url
  })
}

/**
 * Rantai xfade: batas antar klip dilarutkan 0,x detik supaya lompatan kecil
 * akibat tiap klip dire-render terpisah tidak terlihat sebagai cut kasar.
 * Perlu re-encode, jadi hanya dipakai saat audio ditutup dari video sumber.
 */
async function crossfadeVideos(
  files: File[],
  durations: number[],
  fadeSeconds: number,
  onProgress?: SplitProgress
): Promise<File> {
  if (files.length < 2) return files[0]
  const ffmpeg = await getFFmpeg()
  const stamp = Date.now()
  const names: string[] = []

  try {
    for (let i = 0; i < files.length; i++) {
      const n = `xf_${stamp}_${i}.mp4`
      await ffmpeg.writeFile(n, await fetchFile(files[i]))
      names.push(n)
    }

    // Offset tiap xfade = total durasi yang sudah tersusun - fade, dan setiap
    // xfade mempersingkat timeline sepanjang fade-nya sendiri.
    const parts: string[] = []
    let running = durations[0]
    let prev = '[0:v]'
    for (let i = 1; i < names.length; i++) {
      const offset = Math.max(0, running - fadeSeconds)
      const out = `[v${i}]`
      parts.push(`${prev}[${i}:v]xfade=transition=fade:duration=${fadeSeconds}:offset=${offset.toFixed(3)}${out}`)
      running = running + durations[i] - fadeSeconds
      prev = out
    }

    const outName = `xf_${stamp}_out.mp4`
    onProgress?.(`Merapikan ${names.length - 1} batas potong (crossfade ${fadeSeconds}s)...`, 40)
    await ffmpeg.exec([
      ...names.flatMap((n) => ['-i', n]),
      '-filter_complex', parts.join(';'),
      '-map', prev,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-an',
      '-movflags', '+faststart',
      outName,
    ])
    const data = await ffmpeg.readFile(outName)
    await ffmpeg.deleteFile(outName).catch(() => {})
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
    return toFile(bytes, 'joined_crossfade.mp4')
  } finally {
    for (const n of names) await ffmpeg.deleteFile(n).catch(() => {})
  }
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
  const usable = measured.map((d, i) => (d > 0 ? d : specs[i]?.duration ?? CLIP_SECONDS))
  let joined: File
  let crossfaded = false
  if (audioMode === 'original' && usable.length > 1) {
    // Crossfade menghilangkan jejak cut di tiap batas; audio memang akan ditempel
    // ulang dari video sumber, jadi jalur ini tidak menambah acrossfade.
    try {
      joined = await crossfadeVideos(editedClips, usable, FADE_SECONDS, onProgress)
      crossfaded = true
    } catch {
      onProgress?.('Crossfade gagal — kembali ke gabung biasa.', 20)
      joined = await concatVideosFFmpeg(editedClips, (msg) => onProgress?.(msg, 20))
    }
  } else {
    joined = await concatVideosFFmpeg(editedClips, (msg) => onProgress?.(msg, 20))
  }

  if (audioMode === 'edited') {
    return { file: joined, editedDuration, retimed: false, audioFrom: 'edited', crossfaded }
  }

  // Crossfade memakan waktu timeline di setiap batas, jadi durasi gabungan
  // lebih pendek daripada total klip — faktor retime harus memakai angka ini.
  const joinedDuration = crossfaded ? editedDuration - FADE_SECONDS * (usable.length - 1) : editedDuration
  const factor = sourceDuration / joinedDuration
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
      return { file: toFile(muxed, 'video-edit-gabungan.mp4'), editedDuration, retimed, audioFrom: 'original', crossfaded }
    } catch {
      // Video sumber tidak punya track suara (atau gagal dipetakan) — hasil
      // tetap dipakai, tanpa audio.
      onProgress?.('Video sumber tidak punya audio — hasil tanpa suara.', 90)
      return { file: joined, editedDuration, retimed, audioFrom: 'none', crossfaded }
    }
  } finally {
    await ffmpeg.deleteFile(inName).catch(() => {})
    await ffmpeg.deleteFile(srcName).catch(() => {})
  }
}
