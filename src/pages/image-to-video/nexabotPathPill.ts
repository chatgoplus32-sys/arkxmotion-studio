import {
  NEXABOT_EXPIRING_WINDOW_MS,
  formatNexabotDuration,
  type NexabotSessionInfo,
} from '../../lib/nexabot'

/**
 * Badge jalur NexaBot untuk kartu provider di halaman Image to Video.
 *
 * NexaBot punya dua jalur yang sangat berbeda konsekuensinya:
 *  - session cookie login nexabot.id → web /api/v1/generate, paket Unlimited
 *    tidak dipotong kredit;
 *  - API key nxb_… → /api/v1/api, selalu pay-as-you-go 0.25 cr/request.
 *
 * Dipisah ke modul sendiri supaya logikanya bisa diuji tanpa merender halaman
 * (halaman itu menarik banyak store yang menyentuh localStorage).
 */
export interface NexabotPathPill {
  text: string
  className: string
  title: string
}

const BASE_CLASS = 'block mt-1 text-[9px] sm:text-[10px] font-medium'

export function nexabotPathPill(
  nexabotKeys: { cookies?: string; key?: string }[] | undefined,
  session: NexabotSessionInfo | null,
  checking: boolean
): NexabotPathPill {
  // Ada API key di pool? Kalau ya, sesi yang mati saat job berjalan bisa
  // ditutup otomatis lewat jalur pay-as-you-go (lihat nexabotSessionFallback).
  const hasApiKey = !!nexabotKeys?.some((k) => !!k.key)

  // Tanpa cookie session, app otomatis memakai jalur API key.
  if (!nexabotKeys?.some((k) => !!k.cookies)) {
    return {
      text: '🔑 API key · pay-as-you-go',
      className: `${BASE_CLASS} text-amber-400`,
      title:
        'Belum ada cookie session. Generate lewat /api/v1/api dan NexaBot memotong 0.25 cr/request. ' +
        'Tambahkan session di Providers → NexaBot (atau lewat extension) untuk memakai paket Unlimited.',
    }
  }

  // Cookie ada tapi status sesi belum diketahui (probe jalan / gagal senyap).
  if (!session) {
    return {
      text: checking ? '⏳ Memeriksa sesi…' : '🍪 Sesi tersimpan',
      className: `${BASE_CLASS} text-muted-foreground`,
      title: checking
        ? 'Sedang memeriksa status sesi & paket Unlimited di nexabot.id'
        : 'Cookie session tersimpan, status paket belum diperiksa.',
    }
  }

  // Probe-nya sendiri gagal (backend lama/404, jaringan, cookie ditolak) — beda
  // dari sesi yang terbukti kedaluwarsa, jadi jangan bilang "kedaluwarsa".
  if (!session.ok) {
    return {
      text: '🍪 Sesi tersimpan · status tidak terbaca',
      className: `${BASE_CLASS} text-amber-300`,
      title: session.error || 'Cookie sesi tersimpan, tapi status sesi & paket tidak bisa dibaca — generate mungkin tetap jalan.',
    }
  }

  // Sesi terbaca dan masa berlakunya sudah habis → generate pasti ditolak.
  if (!session.active) {
    return {
      text: '⚠️ Sesi kedaluwarsa',
      className: `${BASE_CLASS} text-rose-400`,
      title: (session.error || 'Masa berlaku cookie sesi sudah berakhir — login ulang di nexabot.id.') +
        (hasApiKey
          ? ' Kalau sesi ini mati di tengah job, generate otomatis beralih ke API key (pay-as-you-go 0.25 cr).'
          : ' Belum ada API key (nxb_…) di pool untuk fallback pay-as-you-go.'),
    }
  }

  const detail = [session.plan, session.until, session.email].filter(Boolean).join(' · ')
  const fallbackNote = hasApiKey
    ? ' Kalau sesi kedaluwarsa di tengah job, generate otomatis beralih ke API key (pay-as-you-go 0.25 cr).'
    : ' Belum ada API key (nxb_…) untuk fallback bila sesi kedaluwarsa di tengah job.'

  // Peringatan dini: paket berakhir < 24 jam lagi (pemantau latar belakang juga
  // sudah mengirim toast untuk kondisi ini; badge ini agar terlihat saat memilih
  // provider, sebelum menekan Generate).
  const remainingMs = session.untilMs != null ? session.untilMs - Date.now() : null
  const nearExpiry = remainingMs != null && remainingMs <= NEXABOT_EXPIRING_WINDOW_MS

  if (session.unlimited) {
    return {
      text: nearExpiry
        ? `⏳ UNLIMITED · sisa ${formatNexabotDuration(remainingMs!)}`
        : '🍪 UNLIMITED aktif',
      className: `${BASE_CLASS} ${nearExpiry ? 'text-amber-300' : 'text-emerald-400'}`,
      title: (nearExpiry
        ? `Sesi Unlimited NexaBot berakhir ${formatNexabotDuration(remainingMs!)} lagi${session.until ? ` (${session.until})` : ''} — perbarui cookie sebelum generate panjang. Generate tetap lewat /api/v1/generate (tanpa potong kredit) selama sesi hidup.`
        : `Generate lewat /api/v1/generate — tidak dipotong kredit NexaBot${detail ? ` — ${detail}` : ''}`) +
        fallbackNote,
    }
  }

  // Sesi hidup tapi paket Unlimited tidak terdeteksi: tetap jujur, jangan
  // bilang unlimited kalau probe tidak menemukan buktinya.
  return {
    text: '🍪 Sesi aktif · Unlimited belum terverifikasi',
    className: `${BASE_CLASS} text-amber-300`,
    title:
      'Cookie session terpasang, tapi paket Unlimited tidak terdeteksi — generate bisa tetap dipotong kredit.' +
      `${session.error ? ` ${session.error}` : ''}${detail ? ` — ${detail}` : ''}`,
  }
}
