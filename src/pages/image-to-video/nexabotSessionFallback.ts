/**
 * Fallback jalur NexaBot: session (Unlimited) → API key (pay-as-you-go).
 *
 * NexaBot punya dua jalur yang sangat berbeda konsekuensinya:
 *  - cookie session login nexabot.id → web /api/v1/generate, akun Unlimited
 *    tidak dipotong kredit;
 *  - API key nxb_… → /api/v1/api, selalu pay-as-you-go 0.25 cr/request.
 *
 * Cookie session bisa mati di tengah job (job NexaBot bisa berjalan menit-an).
 * Dulu itu langsung menggagalkan generate. Sekarang:
 *  1. job diulang sekali dengan cookie yang diambil ulang (extension NexaBot
 *     lewat antrian sync, atau cookie yang lebih baru di penyimpanan) — kalau
 *     berhasil, tetap lewat paket Unlimited tanpa potong kredit;
 *  2. kalau cookie baru tidak ada / tetap ditolak, generate otomatis beralih ke
 *     API key pay-as-you-go milik key yang sama (kalau ada), dengan notifikasi
 *     ke user bahwa kredit 0.25 cr akan terpotong dan job dibuat ulang.
 *
 * Dipisah dari halaman supaya logikanya bisa diuji & dipakai ulang tanpa
 * merender halaman (halaman itu menyentuh banyak store).
 */
import { useProviderManager } from '@/stores/providerManager'
import {
  checkNexabotSession,
  getNexabotCookies,
  isNexabotSessionError,
  parseNexabotApiKeyInput,
  parseNexabotCookieInput,
} from '@/lib/nexabot'
import { pollSyncQueueImmediate } from '@/lib/tokenAutoSync'
import { sendNotification } from '@/lib/notify'

/** Auth yang dipahami submitNexabot/pollNexabotJob/downloadNexabotResult. */
export interface NexabotJobAuth {
  apiKey?: string | null
  cookies?: string | null
}

export interface NexabotFallbackHooks {
  /** Log ke panel log halaman generate. */
  log: (msg: string, level?: 'debug' | 'info' | 'warn' | 'error' | 'success', provider?: string) => void
  /** Toast notifikasi ke user. */
  notify: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void
}

export interface NexabotCookieRecovery {
  ok: boolean
  cookies?: string
  /** Dari mana cookie baru didapat. */
  source?: 'storage' | 'sync-queue'
  note: string
}

/** Berapa kali mencoba menarik cookie baru sebelum menyerah & beralih ke API key. */
const RECOVERY_ATTEMPTS = 3
/** Jeda antar percobaan — memberi waktu extension mengirim cookie baru. */
const RECOVERY_DELAY_MS = 1500

function normalizeCookie(raw: string | null | undefined): string {
  if (!raw) return ''
  return parseNexabotCookieInput(String(raw)).trim()
}

/**
 * Coba ambil ulang cookie session NexaBot:
 *  1. cookie di penyimpanan app (hasil auto-sync/manual paste, mungkin sudah
 *     diperbarui sejak job dimulai — mis. cookie dari tab lain);
 *  2. antrian sync extension NexaBot (`pollSyncQueueImmediate`).
 *
 * Setiap kandidat divalidasi dulu (GET /api/v1/credits lewat probe sesi) supaya
 * kita tidak mengulang job dengan cookie yang sama-sama mati. Kalau valid, cookie
 * ditulis ke key yang gagal agar badge jalur & generate berikutnya ikut memakainya.
 */
export async function recoverNexabotSessionCookie(
  keyId: string,
  failedCookies?: string | null
): Promise<NexabotCookieRecovery> {
  const failed = normalizeCookie(failedCookies)
  let note = 'Belum ada cookie session baru (extension belum mengirim / login belum diperbarui)'

  for (let attempt = 1; attempt <= RECOVERY_ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, RECOVERY_DELAY_MS))

    const candidates: { value: string; source: 'storage' | 'sync-queue' }[] = []

    const stored = normalizeCookie(getNexabotCookies())
    if (stored && stored !== failed) candidates.push({ value: stored, source: 'storage' })

    const queued = normalizeCookie(await pollSyncQueueImmediate('nexabot').catch(() => null))
    if (queued && queued !== failed) candidates.push({ value: queued, source: 'sync-queue' })

    for (const candidate of candidates) {
      const info = await checkNexabotSession(candidate.value)
      if (info.ok && info.active) {
        // Simpan supaya jalur generate & badge status langsung memakai cookie ini.
        useProviderManager.getState().setKeyCookies('nexabot', keyId, candidate.value)
        const from = candidate.source === 'sync-queue' ? 'Cookie baru dari extension' : 'Cookie lebih baru di penyimpanan'
        return {
          ok: true,
          cookies: candidate.value,
          source: candidate.source,
          note: `${from}${info.unlimited ? ' · Unlimited aktif' : info.plan ? ` · ${info.plan}` : ''}`,
        }
      }
      note = info.error || 'Cookie baru ditolak / masa berlakunya habis'
    }
  }

  return { ok: false, note }
}

/**
 * Jalankan satu job NexaBot dengan pemulihan otomatis bila sesi Unlimited mati.
 *
 * `run` adalah closure pemanggil (submit → poll → download) yang menerima auth
 * mana yang harus dipakai. Closure boleh dipanggil beberapa kali; pemanggil
 * bertanggung jawab menyimpan media/param yang sudah dihitung agar tidak
 * mengunggah ulang.
 */
export async function runNexabotJobWithSessionFallback<T>(
  run: (auth: NexabotJobAuth, via: string) => Promise<T>,
  opts: {
    /** Cookie sesi key yang sedang dipakai (kosong = langsung jalur API key). */
    sessionCookies?: string | null
    /** API key milik key yang sama, dipakai untuk fallback pay-as-you-go. */
    apiKey?: string | null
    /** ID key di providerManager — dipakai untuk menyimpan cookie hasil recovery. */
    keyId: string
    hooks: NexabotFallbackHooks
  }
): Promise<T> {
  const { hooks } = opts
  const sessionCookies = normalizeCookie(opts.sessionCookies)
  const apiKey = parseNexabotApiKeyInput(opts.apiKey || '')

  // Tanpa cookie: perilaku lama — langsung lewat API key (pay-as-you-go).
  if (!sessionCookies) return run({ apiKey }, 'API key (pay-as-you-go)')

  try {
    return await run({ cookies: sessionCookies }, 'session Unlimited')
  } catch (err: any) {
    if (!isNexabotSessionError(err)) throw err

    hooks.log(
      `⚠️ Sesi Unlimited NexaBot bermasalah di tengah job: ${err.message} — mencoba ambil ulang cookie...`,
      'warn',
      'nexabot'
    )
    hooks.notify('⚠️ Sesi Unlimited NexaBot bermasalah — mencoba ambil ulang cookie session…', 'warning')

    const recovered = await recoverNexabotSessionCookie(opts.keyId, sessionCookies)

    if (recovered.ok && recovered.cookies) {
      hooks.log(`🍪 ${recovered.note} — job diulang lewat jalur Unlimited`, 'success', 'nexabot')
      hooks.notify('🍪 Cookie session NexaBot baru terpasang — job diulang lewat Unlimited (tanpa potong kredit)', 'success')
      sendNotification('🍪 Sesi NexaBot dipulihkan', {
        body: 'Cookie session baru terpasang; generate lanjut lewat paket Unlimited.',
      })
      try {
        return await run({ cookies: recovered.cookies }, 'session Unlimited (cookie baru)')
      } catch (err2: any) {
        if (!isNexabotSessionError(err2)) throw err2
        hooks.log(`⚠️ Cookie baru juga ditolak: ${err2.message}`, 'warn', 'nexabot')
      }
    } else {
      hooks.log(`🍪 Ambil ulang cookie gagal: ${recovered.note}`, 'warn', 'nexabot')
    }

    if (!apiKey) {
      throw new Error(
        `Sesi Unlimited NexaBot kedaluwarsa dan key ini tidak punya API key (nxb_…) untuk fallback pay-as-you-go. ${recovered.note}`
      )
    }

    hooks.log(
      '💳 Beralih ke API key NexaBot — pay-as-you-go 0.25 cr/request (job baru dibuat ulang, job sesi lama ditinggalkan)',
      'warn',
      'nexabot'
    )
    hooks.notify('💳 Beralih ke API key NexaBot (pay-as-you-go 0.25 cr) karena sesi Unlimited kedaluwarsa', 'warning')
    sendNotification('💳 NexaBot beralih ke API key', {
      body: 'Sesi Unlimited kedaluwarsa; generate dilanjutkan lewat API key pay-as-you-go (0.25 cr).',
    })
    return run({ apiKey }, 'API key (fallback pay-as-you-go)')
  }
}
