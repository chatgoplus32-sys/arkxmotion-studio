import { probeMedia, fetchAsVideoFile, muxReferenceAudioFFmpeg } from '@/lib/ffmpeg-compress'
import { uploadBlobToCdn } from '@/lib/cdn'
import { uploadToCatbox } from '@/lib/roboneo'

/**
 * Tempel kembali audio video referensi ke hasil Motion Control yang senyap.
 *
 * Motion Control V3 · Server 23 (15 dtk) dari Seavi menjawab dengan mp4 tanpa
 * stream audio, padahal Server 10 (30 dtk) tetap membawa suara referensi — model
 * tidak punya parameter audio (supported_params kosong), jadi suaranya tidak bisa
 * diminta. Yang hilang dipasang kembali di browser: audio video referensi di-mux
 * ke hasil, lalu hasil baru diunggah ulang.
 *
 * Tahap ini selalu boleh gagal tanpa membatalkan generate — token sudah terpotong
 * dan hasil senyap lebih baik daripada tidak ada hasil sama sekali.
 *
 * Dipakai dua tempat:
 *  - Motion.tsx (otomatis setelah generate Seavi MC)
 *  - Assets.tsx (tombol "Perbaiki Suara" untuk hasil senyap yang sudah terlanjur)
 */
export interface MotionAudioIO {
  log: (msg: string, level?: string) => void
  status: (text: string) => void
}

export interface VoicedResult {
  url: string
  /** true = file sudah tinggal di penyimpanan sendiri (R2/disk) — tidak perlu dicerminkan lagi. */
  selfHosted: boolean
}

/**
 * Simpan hasil bersuara. Penyimpanan sendiri dipakai lebih dulu: host sementara
 * (uguu/catbox/tmpfiles) ada yang kedaluwarsa dalam hitungan jam dan ada yang
 * hanya mengembalikan halaman HTML, padahal URL ini jadi isi galeri.
 */
export async function uploadVoicedVideo(file: File, onProgress?: (msg: string) => void): Promise<VoicedResult> {
  const up = await uploadBlobToCdn(file, `motion-audio-${Date.now()}.mp4`, (pct) =>
    onProgress?.(`Upload hasil bersuara ${pct}%`),
  )
  if (up.ok && up.url) return { url: up.url, selfHosted: true }

  onProgress?.(`Penyimpanan sendiri gagal (${up.error || 'tanpa URL'}) — coba host eksternal...`)
  const url = await uploadToCatbox(file, 'video', (msg) => onProgress?.(msg))
  return { url, selfHosted: false }
}

export async function restoreMotionAudio(
  url: string,
  reference: File,
  io: MotionAudioIO,
): Promise<VoicedResult> {
  try {
    // Cek referensi lebih dulu: kalau sumbernya memang bisu, tidak usah unduh hasil.
    if (!(await probeMedia(reference)).hasAudio) {
      io.log('🔇 Video referensi tidak punya audio — hasil tetap senyap', 'warn')
      return { url, selfHosted: false }
    }
    io.status('Mengunduh hasil untuk menempel audio...')
    const generated = await fetchAsVideoFile(url, 'motion_result')
    const result = await probeMedia(generated)
    if (result.hasAudio) {
      io.log('🔊 Hasil sudah bersuara — tidak diubah')
      return { url, selfHosted: false }
    }
    io.status('Menempel audio referensi...')
    const muxed = await muxReferenceAudioFFmpeg(generated, reference, result.durationSec, (msg, pct) =>
      io.status(`${msg}${pct != null ? ` ${Math.round(pct)}%` : ''}`),
    )
    const voiced = await uploadVoicedVideo(muxed, (text) => io.status(text))
    io.log(`🔊 Audio referensi menempel ✓ ${voiced.url.slice(0, 60)}...`, 'success')
    return voiced
  } catch (err: any) {
    io.log(`🔇 Gagal menempel audio (${err?.message || err}) — hasil senyap dipakai`, 'warn')
    return { url, selfHosted: false }
  }
}
