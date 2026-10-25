import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  canEncodeVideo,
  type VideoSample,
} from 'mediabunny'
import type { ProcessVideoProgress } from './video-watermark-process'

/**
 * Pipeline video offline frame-akurat — WebCodecs + mediabunny.
 *
 * Kenapa: jalur lama (playback realtime + MediaRecorder + captureStream)
 * punya tiga masalah fatal pada video panjang:
 *  1. Frame di-skip saat main thread sibuk → hasil patah-patah.
 *  2. Bitrate encoder kecil (fixed 5 Mbps) → file hasil jauh lebih kecil
 *     dari aslinya (44MB → 4MB) dan buram.
 *  3. Terikat kecepatan realtime → 1 menit video butuh 1 menit proses.
 *
 * Jalur baru: demux → decode frame-per-frame (WebCodecs) → bersihkan tiap
 * frame di canvas → encode ulang dengan bitrate ≈ aslinya → mux mp4/webm.
 * Tidak realtime, frame TIDAK PERNAH skip, kualitas & ukuran ≈ asli.
 *
 * Ketangguhan: kodec output dicoba bertahap (mp4/avc → webm/vp9 → webm/vp8).
 * Kalau SEMUA gagal — termasuk kasus trek video dibuang oleh mediabunny
 * (yang dulu menghasilkan mp4 "berisi mp3") — error dilempar dengan alasan
 * jelas; pemanggil memakai jalur MediaRecorder cadangkan.
 */

export function isOfflineVideoSupported(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as Record<string, unknown>
  return typeof w.VideoEncoder === 'function' && typeof w.VideoDecoder === 'function'
}

export interface OfflineVideoResult {
  blob: Blob
  frames: number
}

interface Candidate {
  webm: boolean
  codec: 'avc' | 'vp9' | 'vp8'
}

export async function processVideoOffline(
  file: File | Blob,
  frameProcessor: (ctx: CanvasRenderingContext2D, seconds: number) => void,
  onProgress?: ProcessVideoProgress,
  opts: { includeAudio?: boolean } = {},
): Promise<OfflineVideoResult> {
  // ── Probe ringan: ukuran, durasi, codec audio, decodability ──
  const probe = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  const probeVideo = await probe.getPrimaryVideoTrack()
  if (!probeVideo) throw new Error('Tidak ada trek video di file ini')
  const probeAudio = opts.includeAudio === false ? null : await probe.getPrimaryAudioTrack()

  const width = await probeVideo.getDisplayWidth()
  const height = await probeVideo.getDisplayHeight()

  // Durasi: metadata dulu (cepat); kalau tidak ada, hitung dari paket.
  let duration = await probe.getDurationFromMetadata()
  if (!duration || duration <= 0) {
    const stats = await probeVideo.computePacketStats()
    duration = Math.max(stats.packetCount / Math.max(stats.averagePacketRate, 1), 0.5)
  }
  duration = Math.max(duration, 0.5)

  if (!(await probeVideo.canDecode().catch(() => false))) {
    throw new Error('WebCodecs tidak bisa men-decode codec video ini')
  }

  const audioCodec = probeAudio ? await probeAudio.getCodec() : null

  // Rekayasa bitrate: samakan dengan aslinya (±85% karena re-encode),
  // clamp 2.5–20 Mbps supaya tidak absurd di video kualitas aneh.
  const origBps = (file.size * 8) / duration
  const targetBps = Math.min(20_000_000, Math.max(2_500_000, Math.round(origBps * 0.85)))

  // Vorbis dkk hanya bisa masuk WebM — mulai daftar kandidat dari sana.
  const audioNeedsWebm = audioCodec ? !['aac', 'mp3', 'opus', 'flac'].includes(audioCodec) : false
  const allCandidates: Candidate[] = audioNeedsWebm
    ? [{ webm: true, codec: 'vp9' }, { webm: true, codec: 'vp8' }]
    : [
      { webm: false, codec: 'avc' },
      { webm: true, codec: 'vp9' },
      { webm: true, codec: 'vp8' },
    ]

  let lastError: unknown = null
  for (const cand of allCandidates) {
    const encodable = await canEncodeVideo(cand.codec, { width, height, bitrate: targetBps }).catch(() => false)
    if (!encodable) continue

    try {
      const result = await runAttempt(cand, file, frameProcessor, {
        audioTrack: opts.includeAudio === false ? false : probeAudio !== null,
        audioDiscard: opts.includeAudio === false || !probeAudio,
        width, height, duration, targetBps, onProgress,
      })
      return result
    } catch (e) {
      lastError = e
      // Lanjut ke kandidat berikutnya.
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error('Semua upaya encoding WebCodecs gagal: ' + msg)
}

async function runAttempt(
  cand: Candidate,
  file: File | Blob,
  frameProcessor: (ctx: CanvasRenderingContext2D, seconds: number) => void,
  cfg: {
    audioTrack: boolean
    audioDiscard: boolean
    width: number
    height: number
    duration: number
    targetBps: number
    onProgress?: ProcessVideoProgress
  },
): Promise<OfflineVideoResult> {
  // Satu Input segar per percobaan — konversi mengelola siklus demux sendiri.
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  const videoTrack = await input.getPrimaryVideoTrack()
  if (!videoTrack) throw new Error('Tidak ada trek video di file ini')

  const canvas = document.createElement('canvas')
  canvas.width = cfg.width
  canvas.height = cfg.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  let frames = 0
  const onSample = (sample: VideoSample) => {
    if (sample.displayWidth !== canvas.width || sample.displayHeight !== canvas.height) {
      canvas.width = sample.displayWidth
      canvas.height = sample.displayHeight
    }
    sample.draw(ctx, 0, 0)
    frameProcessor(ctx, Math.max(0, sample.timestamp))
    frames++
    return canvas
  }

  const output = new Output({
    format: cand.webm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  })

  const conversion = await Conversion.init({
    input,
    output,
    tracks: 'primary',
    video: {
      codec: cand.codec,
      quality: new Quality({ bitrate: cfg.targetBps, bitrateMode: 'variable' }),
      keyFrameInterval: 2,
      forceTranscode: true,
      process: onSample,
    },
    audio: cfg.audioDiscard ? { discard: true } : cfg.audioTrack ? {} : { discard: true },
  })

  // KRITIS: mediabunny menganggap konversi "valid" bahkan bila trek video
  // gagal di-encode (dan hanya audio yang ditulis) — hasilnya mp4 "aneh"
  // berisi suara saja. Cegah dan biarkan kandidat berikutnya mencoba.
  const videoDiscarded = conversion.discardedTracks.find(
    t => t.track.type === 'video' && t.reason !== 'discarded_by_user',
  )
  if (videoDiscarded) {
    throw new Error('Trek video diabaikan (' + videoDiscarded.reason + ')')
  }
  if (!conversion.isValid) {
    throw new Error('Konfigurasi konversi tidak valid (' + JSON.stringify(conversion.discardedTracks.map(t => t.reason)) + ')')
  }

  let done = false
  conversion.onProgress = (progress, processedTime) => {
    if (done) return
    const pct = Math.min(97, Math.round(progress * 92) + 3)
    cfg.onProgress?.(pct, `Memproses ${processedTime.toFixed(1)}s / ${cfg.duration.toFixed(1)}s`)
  }

  await conversion.execute()
  done = true

  const buffer = output.target instanceof BufferTarget ? output.target.buffer : null
  if (!buffer || buffer.byteLength === 0) throw new Error('Hasil encoding kosong')

  const mime = cand.webm ? 'video/webm' : 'video/mp4'
  cfg.onProgress?.(100, `Selesai — ${frames} frame`)
  return { blob: new Blob([buffer], { type: mime }), frames }
}
