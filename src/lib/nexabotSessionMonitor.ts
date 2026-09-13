/**
 * Pemantau latar belakang sesi NexaBot (mode cookie / paket Unlimited).
 *
 * Cookie sesi nexabot.id bisa mati tanpa aba-aba — dan kalau mati saat job
 * sedang berjalan, generate harus beralih ke API key pay-as-you-go (lihat
 * nexabotSessionFallback.ts). Modul ini memberi PERINGATAN LEBIH AWAL: sebelum
 * user menekan Generate, sesi di-probe berkala dan user diberi tahu kalau:
 *
 *  - `expired`  : masa berlaku paket Unlimited sudah lewat → sesi pasti ditolak;
 *  - `expiring` : paket berakhir < 24 jam lagi → perbarui cookie dulu sebelum
 *                 job panjang (job NexaBot bisa berjalan menit-an);
 *  - `stale`    : cookie sudah tersimpan > 24 jam tanpa pernah diperbarui —
 *                 heuristik "extension mungkin tidak jalan lagi".
 *
 * Deteksi berbasis data yang benar-benar tersedia dari probe sesi
 * (GET /api/v1/credits lewat proxy `/session`): `until`/`untilMs` adalah tanggal
 * berakhir paket, sedangkan cookie sesi sendiri tidak mengirim `Expires`. Jadi
 * selain tanggal paket, umur cookie (`cookiesAt` di providerManager) dipakai
 * sebagai proxy — sengaja dipisah levelnya supaya UI tidak berbohong.
 *
 * Anti-spam: peringatan yang sama tidak diulang sampai tanda tangan statusnya
 * berubah (mis. cookie baru masuk) atau masa re-notify level tsb lewat.
 */
import { useProviderManager } from '@/stores/providerManager'
import { useToastStore } from '@/stores/toastStore'
import {
  checkNexabotSession,
  getNexabotCookies,
  nexabotSessionWarning,
  type NexabotSessionInfo,
  type NexabotSessionWarning,
  type NexabotSessionWarningLevel,
} from '@/lib/nexabot'
import { NEXABOT_CHECK_TIMEOUT_MS } from '@/lib/nexabot-constants'
import { sendNotification } from '@/lib/notify'

/** Interval probe berkala. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000
/** Jeda minimum antar probe (menahan burst event keys-changed). */
const MIN_RECHECK_MS = 60 * 1000
/** Event keys-changed → tunggu sesaat agar cookie baru selesai ditulis. */
const EVENT_DEBOUNCE_MS = 1500

const STORAGE_KEY = 'arkxmotion.nexabot.sessionWarn'

function signatureOf(level: NexabotSessionWarningLevel | 'ok', session: NexabotSessionInfo, cookiesAt: number | null): string {
  // Cookie baru (cookiesAt berubah) atau tanggal paket berbeda = status baru →
  // peringatan boleh dikirim ulang tanpa menunggu masa re-notify.
  return [level, session.until ?? '', cookiesAt ?? ''].join('|')
}

/** Level ringan hanya di-ingatkan sekali per 12 jam; sisanya per 6 jam. */
function renotifyMsFor(level: NexabotSessionWarningLevel): number {
  return level === 'stale' ? 12 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000
}

interface WarnState {
  sig: string
  at: number
}

function readWarnState(): WarnState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.sig === 'string' && typeof parsed?.at === 'number') return parsed
    return null
  } catch {
    return null
  }
}

function writeWarnState(state: WarnState | null) {
  try {
    if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* storage penuh / private mode — abaikan */ }
}

export interface NexabotSessionHealth {
  session: NexabotSessionInfo
  warning: NexabotSessionWarning | null
  /** true kalau peringatan ini layak dikirim sekarang (bukan duplikat). */
  shouldNotify: boolean
  /** Tanda tangan status — dipakai pemanggil untuk mencatat anti-spam. */
  sig: string
}

/**
 * Probe sesi NexaBot sekali + tentukan peringatannya. Read-only terhadap status
 * anti-spam: pencatatannya dilakukan pemanggil setelah peringatan benar-benar
 * dikirim, supaya peringatan tidak "termakan" oleh pemanggil yang hanya ingin
 * membaca status.
 */
export async function checkNexabotSessionHealth(): Promise<NexabotSessionHealth | null> {
  const cookies = getNexabotCookies()
  if (!cookies) return null

  const key = (useProviderManager.getState().keys.nexabot || []).find((k) => !!k.cookies)
  // Probe latar (bukan jalur user menunggu) → pakai anggaran panjang supaya
  // /credits yang lambat (~30s) tidak berakhir jadi peringatan palsu "sesi mati".
  const session = await checkNexabotSession(cookies, { timeoutMs: NEXABOT_CHECK_TIMEOUT_MS })
  const warning = nexabotSessionWarning(session, { cookiesAt: key?.cookiesAt ?? null })
  const sig = signatureOf(warning?.level ?? 'ok', session, key?.cookiesAt ?? null)

  if (!warning) return { session, warning: null, shouldNotify: false, sig }

  const prev = readWarnState()
  const shouldNotify = !prev || prev.sig !== sig || Date.now() - prev.at >= renotifyMsFor(warning.level)
  return { session, warning, shouldNotify, sig }
}

let timer: ReturnType<typeof setInterval> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let checking = false
let lastCheckAt = 0

async function runCheck(force = false): Promise<void> {
  if (checking) return
  if (!force && Date.now() - lastCheckAt < MIN_RECHECK_MS) return

  checking = true
  try {
    lastCheckAt = Date.now()
    const health = await checkNexabotSessionHealth()
    // Tanpa cookie / tidak ada masalah → hapus riwayat supaya degradasi
    // berikutnya (walau tanda tangannya sama) langsung diingatkan lagi.
    if (!health) return
    if (!health.warning) { writeWarnState(null); return }
    if (!health.shouldNotify) return

    const { warning, sig } = health
    useToastStore.getState().addToast(warning.message, warning.level === 'stale' ? 'info' : 'warning')
    if (warning.level !== 'stale') {
      sendNotification('⚠️ Sesi NexaBot hampir berakhir', { body: warning.body })
    }
    writeWarnState({ sig, at: Date.now() })
  } catch (err: any) {
    console.warn('[nexabot-session-monitor] check gagal:', err?.message || err)
  } finally {
    checking = false
  }
}

/** Cookie/key berubah (auto-sync extension, paste manual) → cek ulang segera. */
function onKeysChanged() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { void runCheck(true) }, EVENT_DEBOUNCE_MS)
}

/**
 * Nyalakan pemantau: cek pertama saat app dibuka, lalu tiap 5 menit, plus
 * langsung begitu cookie session berubah (event `aatools:keys-changed` dari
 * auto-sync extension) — supaya peringatan hilang/berubah tanpa menunggu tick.
 *
 * Idempotent: pemanggilan kedua membersihkan yang lama dulu, jadi tidak ada
 * interval/listener ganda (mis. React StrictMode yang memanggil effect 2x).
 * Mengembalikan fungsi stop untuk dipakai sebagai cleanup useEffect.
 */
export function startNexabotSessionMonitor(): () => void {
  stopNexabotSessionMonitor()

  void runCheck(true)
  timer = setInterval(() => { void runCheck() }, CHECK_INTERVAL_MS)
  window.addEventListener('aatools:keys-changed', onKeysChanged)
  window.addEventListener('storage', onKeysChanged)

  return stopNexabotSessionMonitor
}

export function stopNexabotSessionMonitor(): void {
  if (timer) { clearInterval(timer); timer = null }
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
  window.removeEventListener('aatools:keys-changed', onKeysChanged)
  window.removeEventListener('storage', onKeysChanged)
}

/** Dipakai halaman Providers: paksa cek sekarang (mis. setelah paste cookie). */
export async function refreshNexabotSessionMonitor(force = true): Promise<void> {
  await runCheck(force)
}
