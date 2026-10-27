import db from '../db.js'
import {
  hasActiveUnlimited,
  masterDailyCap,
  masterKeyMode,
  underDailyCap,
  type Kelayakan,
} from './nexabotMasterKey.js'

/**
 * Sesi login nexabot.id milik operator (jalur Unlimited).
 *
 * Bedanya dengan kunci induk
 * --------------------------
 * API key selalu pay-as-you-go (0.15 cr/request) walau akunnya punya paket
 * Unlimited. Hanya cookie login web yang dihormati paket Unlimited — generate
 * lewat /api/v1/generate tidak memotong kredit. Karena itu operator bisa
 * menyimpan SATU cookie sesi di server, dan member dengan Paket Unlimited aktif
 * memakainya tanpa pernah melihat nilainya.
 *
 * Siapa yang boleh memakainya
 * ---------------------------
 * Hanya member dengan Paket Unlimited aktif (`nexabot_topup` yang disetujui dan
 * belum kedaluwarsa) — sesuai gunanya: "khusus paket Unlimited". Member yang
 * cuma punya saldo tetap memakai jalur kunci induk / kunci sendiri.
 *
 * Cookie disimpan di `app_settings` dan TIDAK pernah dikirim balik ke browser,
 * termasuk ke browser admin. Dashboard hanya menampilkan status + hasil cek.
 */

export const MASTER_COOKIE_SETTING = 'nexabot_master_cookie'

/** Sama seperti relay: bisa diarahkan ke upstream tiruan saat tes. */
const NEXABOT_BASE = (process.env.NEXABOT_BASE || 'https://nexabot.id').replace(/\/+$/, '')

/**
 * Normalisasi paste cookie dari berbagai bentuk:
 *  - cookie mentah:            `session=abc; x=1`
 *  - header dump:              `Cookie: session=abc; x=1`
 *  - "Copy as cURL (bash)":    `curl '…' -H 'cookie: session=abc' …`
 *  - "Copy as fetch" / JSON:   `{"cookie":"session=abc"}`
 *
 * Cermin `parseNexabotCookieInput` di klien. Nilai disimpan sebagai header
 * Cookie satu baris — newline dibuang supaya tidak bisa dipakai menyusupkan
 * header lain.
 */
export function parseCookieInput(raw: string): string {
  const bersih = (value: string) => value.replace(/[\r\n]+/g, ' ').trim()

  let s = bersih(raw || '')
  if (!s) return ''

  const headerMatch = s.match(/(?:^|[\s'"-])(?:cookie|Cookie):\s*([^'"\r\n\s][^'"\r\n]*)/)
  if (headerMatch?.[1]?.trim()) return bersih(headerMatch[1])

  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const obj = JSON.parse(s)
      const c = obj?.cookie || obj?.Cookie || obj?.headers?.cookie || obj?.headers?.Cookie
      if (typeof c === 'string' && c.trim()) return bersih(c)
    } catch { /* bukan JSON valid — lanjut sebagai string biasa */ }
  }

  const looseMatch = s.match(/cookie\s*:\s*['"]?\s*([^'"\r\n;\s][^'"\r\n]*)/i)
  if (looseMatch?.[1]?.trim()) return bersih(looseMatch[1])

  s = s.replace(/^-+[Hh]?\s*/, '').replace(/^['"]+|['"]+$/g, '').trim()
  // Header Cookie WAJIB satu baris; karakter di luar ASCII juga ditolak klien.
  return s.replace(/[^\x20-\x7E]/g, '').trim()
}

/** Apakah hasil parse layak disimpan sebagai header Cookie. */
export function isValidCookie(value: string): boolean {
  return value.length >= 8 && value.length <= 4096 && value.includes('=') && !/\s{2,}/.test(value)
}

function storedMasterCookie(): string | null {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(MASTER_COOKIE_SETTING) as
      | { value: string }
      | undefined
    const nilai = (row?.value || '').trim()
    return nilai || null
  } catch {
    return null
  }
}

/**
 * Cookie efektif. Tidak ada fallback .env: cookie sesi kedaluwarsa lebih cepat
 * daripada kunci, dan menyimpannya di berkas .env membuat rotasinya menyakitkan.
 */
export function masterCookie(): string | null {
  if (masterKeyMode() === 'off') return null
  return storedMasterCookie()
}

export interface MasterCookieStatus {
  configured: boolean
  source: 'database' | 'none'
  mode: ReturnType<typeof masterKeyMode>
  daily_cap: number
}

/** Status untuk dashboard admin. Nilai cookie TIDAK pernah ikut dikembalikan. */
export function masterCookieStatus(): MasterCookieStatus {
  return {
    configured: !!masterCookie(),
    source: masterCookie() ? 'database' : 'none',
    mode: masterKeyMode(),
    daily_cap: masterDailyCap(),
  }
}

/** Kebijakan relay: cookie server khusus member dengan Paket Unlimited aktif. */
export function memberMayUseMasterCookie(userId: number): Kelayakan {
  if (masterKeyMode() === 'off') return { ok: false, reason: 'Kunci induk NexaBot dimatikan di server' }
  if (!hasActiveUnlimited(userId)) {
    return {
      ok: false,
      reason: 'Sesi Unlimited milik server hanya untuk member dengan Paket Unlimited aktif',
    }
  }
  return { ok: true, reason: 'Paket Unlimited aktif' }
}

/** Kelayakan lengkap (konfigurasi + paket + batas harian), dipakai relay & wallet. */
export function masterCookieEligibility(userId: number): Kelayakan {
  if (!masterCookie()) {
    return { ok: false, reason: 'Sesi Unlimited NexaBot milik server belum diatur admin' }
  }
  const izin = memberMayUseMasterCookie(userId)
  if (!izin.ok) return izin
  const cap = underDailyCap(userId)
  if (!cap.ok) return cap
  return { ok: true, reason: masterDailyCap() > 0 ? `${izin.reason} · ${cap.reason}` : izin.reason }
}

export interface MasterCookieCheck {
  ok: boolean
  active: boolean
  unlimited: boolean
  plan: string | null
  until: string | null
  balance: number | null
  email: string | null
  telegram_id: string | null
  status: number | null
  /** true = gangguan gateway (timeout/429/5xx), cookie belum tentu mati. */
  transient?: boolean
  error?: string
}

function findDeep(obj: any, test: (key: string, value: any) => boolean, depth = 0): any {
  if (!obj || typeof obj !== 'object' || depth > 5) return undefined
  for (const [k, v] of Object.entries(obj)) {
    if (test(k, v)) return v
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const r = findDeep(v, test, depth + 1)
      if (r !== undefined) return r
    }
  }
  return undefined
}

const pickString = (obj: any, re: RegExp): string | null => {
  const v = findDeep(obj, (k, val) => re.test(k) && (typeof val === 'string' || typeof val === 'number'))
  return v != null && v !== '' ? String(v) : null
}

const pickNumber = (obj: any, re: RegExp): number | null => {
  const v = findDeep(obj, (k, val) =>
    re.test(k) && (typeof val === 'number' || (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val.trim()))),
  )
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const pickBool = (obj: any, re: RegExp): boolean | null => {
  const v = findDeep(obj, (k, val) => re.test(k) && (typeof val === 'boolean' || val === 0 || val === 1))
  if (typeof v === 'boolean') return v
  if (v === 1) return true
  if (v === 0) return false
  return null
}

const KOSONG: MasterCookieCheck = {
  ok: false, active: false, unlimited: false, plan: null, until: null,
  balance: null, email: null, telegram_id: null, status: null,
}

/**
 * Probe status sesi tersimpan lewat GET /api/v1/credits (endpoint yang sama
 * dipakai klien saat memeriksa cookie sendiri). Parsing heuristik: bentuk
 * respons web NexaBot bisa berubah, jadi field yang tidak dikenali dibiarkan
 * null dan panel admin menampilkannya sebagai "tidak terverifikasi".
 */
export async function checkMasterCookie(timeoutMs = 20000): Promise<MasterCookieCheck> {
  const cookies = masterCookie()
  if (!cookies) return { ...KOSONG, error: 'Sesi Unlimited server belum diatur' }

  try {
    const res = await fetch(`${NEXABOT_BASE}/api/v1/credits`, {
      method: 'GET',
      headers: { Cookie: cookies, Origin: NEXABOT_BASE, Referer: `${NEXABOT_BASE}/`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 401 || res.status === 403) {
      return {
        ...KOSONG,
        status: res.status,
        error: 'Cookie sesi ditolak / kedaluwarsa — login ulang di nexabot.id lalu paste cookie baru',
      }
    }
    if (!res.ok) {
      return {
        ...KOSONG,
        status: res.status,
        transient: res.status === 408 || res.status === 429 || res.status >= 500,
        error: `Cek sesi gagal: HTTP ${res.status}`,
      }
    }

    const raw = await res.json().catch(() => null) as any
    if (!raw || raw.ok === false) {
      return { ...KOSONG, status: res.status, error: (raw as any)?.error || 'Respons sesi tidak dikenali' }
    }

    const body = raw?.data && typeof raw.data === 'object' ? { ...raw, ...raw.data } : raw
    const unlimitedFlag = pickBool(body, /^(is_?)?unlimited(_active|_access)?$/i)
    const plan = pickString(body, /^(plan|plan_name|package|package_name|subscription|subscription_type|tier|product)$/i)

    return {
      ok: true,
      active: true,
      unlimited: unlimitedFlag === true || /unlimited/i.test(plan || ''),
      plan,
      until: pickString(body, /(unlimited_until|expire[sd]?_at|expiry|valid_until|active_until|end_date|until)$/i),
      balance: pickNumber(body, /^(credit|credits|balance|remaining_credits|credit_balance)$/i),
      email: pickString(body, /^(email|mail)$/i),
      telegram_id: pickString(body, /^(telegram_id|telegram_?user_?id|user_id)$/i),
      status: res.status,
    }
  } catch (err: any) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ...KOSONG,
      transient: true,
      error: timeout ? 'Cek sesi timeout — upstream tidak menjawab' : `Cek sesi gagal: ${err?.message || err}`,
    }
  }
}
