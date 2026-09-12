// Relatif + ekstensi .js: modul ini juga dimuat test Node (tsx) yang memakai
// resolusi nodenext dan tidak tahu alias `@/`, sedangkan Vite memetakan
// './x.js' ke './x.ts' saat build.
import {
  describeNexabotStatus,
  nexabotHttpVerdict,
  nexabotRetryDelayMs,
  parseRetryAfterMs,
  type NexabotBackoffOptions,
} from './nexabotRetry.js'

const NEXABOT_BASE = '/api/public/nexabot'

/**
 * Opsi ketahanan untuk submit/poll NexaBot. Nilai default = perilaku produksi;
 * test mengecilkan jedanya supaya tidak menunggu detik-an.
 */
export interface NexabotRetryOptions extends NexabotBackoffOptions {
  /** Total percobaan (1 = tanpa retry). */
  maxAttempts?: number
  /** Diberi tahu setiap kali kita menunggu sebelum mencoba lagi. */
  onRetry?: (info: { attempt: number; status: number | null; delayMs: number; message: string }) => void
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))

/** Hint dari header `Retry-After` untuk pesan error, mis. " (tunggu ±30s)". */
function retryAfterHint(res: Response): string {
  const ms = parseRetryAfterMs(res.headers.get('retry-after'))
  if (ms == null) return ''
  return ` (disarankan tunggu ±${Math.max(1, Math.round(ms / 1000))}s)`
}

function getStoredProviderKey(provider: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('arkxmotion.providers')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const keys = parsed[provider] || []
    const active = keys.find((k: any) => k.status === 'active' || k.status === 'unknown')
    return active?.key || keys[0]?.key || null
  } catch { return null }
}

export function getNexabotApiKey(): string | null {
  return getStoredProviderKey('nexabot')
}

/**
 * Cookie sesi login nexabot.id (mode session). Dipakai untuk generate lewat
 * endpoint web `/api/v1/generate` — kalau akun punya paket Unlimited, generate
 * jalan tanpa dipotong kredit seperti jalur API key (pay-as-you-go).
 */
export function getNexabotCookies(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('arkxmotion.providers')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const keys = parsed['nexabot'] || []
    const active = keys.find((k: any) => k.cookies && (k.status === 'active' || k.status === 'unknown'))
    return active?.cookies || keys.find((k: any) => k.cookies)?.cookies || null
  } catch { return null }
}

/**
 * Normalisasi input cookie session dari berbagai bentuk paste:
 *  - string cookie mentah:      `session=abc; x=1`
 *  - header dump:               `Cookie: session=abc; x=1`
 *  - "Copy as cURL (bash)":     `curl '...' -H 'cookie: session=abc; x=1' ...`
 *  - "Copy as fetch" (JS):      `fetch('...', { headers: { cookie: 'session=abc' } })`
 *  - JSON:                      `{"cookie":"session=abc"}`
 *
 * Ini penting karena cookie sesi biasanya HttpOnly sehingga `document.cookie`
 * TIDAK memuatnya — "Copy as cURL" dari tab Network adalah cara yang andal.
 */
export function parseNexabotCookieInput(raw: string): string {
  let s = (raw || '').trim()
  if (!s) return ''

  // Header Cookie di cURL / header dump (boleh dibungkus tanda kutip).
  // Capture wajib mulai dengan non-spasi supaya backtracking `\s*` tidak
  // menghasilkan nilai kosong (mis. `cookie: "..."` → spasi ikut tertangkap).
  const headerMatch = s.match(/(?:^|[\s'"-])(?:cookie|Cookie):\s*([^'"\r\n\s][^'"\r\n]*)/)
  if (headerMatch?.[1]?.trim()) return headerMatch[1].trim()

  // JSON (Copy as fetch / Node).
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const obj = JSON.parse(s)
      const c = obj?.cookie || obj?.Cookie || obj?.headers?.cookie || obj?.headers?.Cookie
      if (typeof c === 'string' && c.trim()) return c.trim()
    } catch { /* bukan JSON valid — lanjut sebagai string biasa */ }
  }

  // "Copy as fetch" tapi bukan JSON valid (kutip tunggal) — ambil setelah cookie:.
  const looseMatch = s.match(/cookie\s*:\s*['"]?\s*([^'"\r\n;\s][^'"\r\n]*)/i)
  if (looseMatch?.[1]?.trim()) return looseMatch[1].trim()

  // Bersihkan sisa prefix/quotes.
  s = s.replace(/^-+[Hh]?\s*/, '').replace(/^['"]+|['"]+$/g, '').trim()
  return s
}

/**
 * Normalisasi input API key NexaBot dari berbagai bentuk paste:
 *  - key mentah:             `nxb_abc123…`
 *  - header:                 `x-api-key: nxb_abc123…`
 *  - "Copy as cURL (bash)":  `curl '…' -H 'x-api-key: nxb_abc123…' …`
 *  - "Copy as fetch" (JSON): `{"headers":{"x-api-key":"nxb_abc123…"}}`
 *
 * Mengembalikan '' kalau input jelas bukan API key (mis. cURL cookie) supaya UI
 * menolak dengan pesan ramah, bukan menembak header invalid ke fetch().
 */
export function parseNexabotApiKeyInput(raw: string): string {
  let s = (raw || '').trim()
  if (!s) return ''

  // JSON (Copy as fetch / Node).
  if (s.startsWith('{')) {
    try {
      const obj = JSON.parse(s)
      const h = obj?.headers || obj?.Headers || obj
      const k = h?.['x-api-key'] || h?.['X-Api-Key'] || obj?.api_key || obj?.apiKey
      if (typeof k === 'string' && k.trim()) return k.trim().replace(/^["']+|["']+$/g, '')
    } catch { /* bukan JSON valid — lanjut */ }
  }

  // Header x-api-key di cURL / header dump (boleh dibungkus tanda kutip).
  const header = s.match(/(?:x-api-key|api[-_]?key)\s*[:=]\s*['"]?([A-Za-z0-9_.-]{6,})/i)
  if (header) return header[1]

  // Token NexaBot yang dikenali (nxb_… / nxa_live_…).
  const token = s.match(/\b(nxa_[A-Za-z0-9_-]{6,}|nxb_[A-Za-z0-9_-]{6,})\b/)
  if (token) return token[1]

  // Jelas bukan API key (cURL cookie / URL) — jangan menebak.
  if (/(^|\s)curl\b/i.test(s) || /(^|\s)-H\s/.test(s) || /cookie\s*:/i.test(s) || /https?:\/\//i.test(s)) {
    return ''
  }

  // Key mentah: buang newline/kutip/bullet, tolak yang masih multi-token.
  s = s.replace(/[\r\n]+/g, ' ').trim().replace(/^[•*\s-]+|[•*\s-]+$/g, '').replace(/^["']+|["']+$/g, '').trim()
  if (!s || /\s/.test(s)) return ''
  return s
}

/**
 * Nilai header HTTP WAJIB satu baris & tanpa karakter kontrol. Kalau tidak,
 * browser melempar `Failed to execute 'fetch' on 'Window': Invalid value`.
 */
function safeHeaderValue(value: string): string {
  return String(value).replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7E]/g, '').trim()
}

/** Auth NexaBot: pilih salah satu (atau keduanya) — cookie sesi atau API key. */
export interface NexabotAuth {
  apiKey?: string | null
  cookies?: string | null
}

function normalizeAuth(auth: NexabotAuth | string | undefined): NexabotAuth {
  if (typeof auth === 'string') return { apiKey: auth }
  return auth ? { ...auth } : {}
}

function fillAuthFromStorage(auth: NexabotAuth): NexabotAuth {
  if (auth.apiKey || auth.cookies) return auth
  return { apiKey: getNexabotApiKey(), cookies: getNexabotCookies() }
}

/**
 * Header auth untuk proxy ARKXMotion. Browsers TIDAK boleh men-set header
 * `Cookie` langsung, jadi cookie dikirim sebagai `X-Nexabot-Cookie` dan proxy
 * yang menerjemahkannya ke header `Cookie` upstream.
 * Mode session (cookie) menang atas API key karena hanya jalur web yang
 * menghormati paket Unlimited.
 */
function normalizeValues(auth: NexabotAuth): { apiKey: string; cookies: string } {
  const cookies = auth.cookies ? safeHeaderValue(parseNexabotCookieInput(String(auth.cookies))) : ''
  const apiKey = auth.apiKey ? safeHeaderValue(parseNexabotApiKeyInput(String(auth.apiKey))) : ''
  return { cookies, apiKey }
}

function authHeaders(auth: NexabotAuth): Record<string, string> {
  const { cookies, apiKey } = normalizeValues(auth)
  if (cookies) return { 'X-Nexabot-Cookie': cookies }
  if (apiKey) return { 'X-Api-Key': apiKey }
  return {}
}

/**
 * Apakah error ini berarti cookie sesi (jalur Unlimited) tidak lagi valid?
 *
 * Dipakai untuk memicu fallback otomatis session → API key di tengah job:
 *  - pesan eksplisit dari submitNexabot (401/403 / "session cookie kedaluwarsa");
 *  - halaman HTML login yang diteruskan proxy apa adanya saat polling/download —
 *    cookie kedaluwarsa membuat upstream membalas HTML, sehingga klien gagal
 *    parse JSON ("bukan JSON"). Gejala inilah yang paling sering muncul kalau
 *    sesi habis saat job sedang berjalan.
 *
 * Sengaja TIDAK menganggap error API key (mis. "API key tidak valid") sebagai
 * masalah sesi supaya fallback tidak berputar-putar.
 */
export function isNexabotSessionError(err: unknown): boolean {
  const msg = typeof err === 'string' ? err : (err as any)?.message || ''
  if (!msg) return false
  if (/session|cookie|kedaluwarsa|login ulang|sign\s*in/i.test(msg)) return true
  if (/\b(401|403)\b/.test(msg)) return true
  if (/unauthorized|forbidden|not authenticated/i.test(msg)) return true
  if (/bukan JSON|<html|<!doctype/i.test(msg)) return true
  return false
}

// ═══════════════════════════════════════════════════════════════════
// BALANCE CHECK
// ═══════════════════════════════════════════════════════════════════

export async function checkNexabotBalance(apiKey: string): Promise<{
  ok: boolean
  balance: number | null
  creditCost: number | null
  /** Telegram ID yang terikat ke API key ini — NexaBot menagihkan biaya ke akun ini. */
  telegramId?: string | null
  registered?: boolean
  error?: string
}> {
  const key = parseNexabotApiKeyInput(apiKey)
  if (!key) {
    return {
      ok: false, balance: null, creditCost: null,
      error: apiKey
        ? 'Format API key NexaBot tidak dikenali (bukan nxb_…). Kalau yang kamu tempel adalah cURL cookie, pakai panel Session.'
        : 'Tidak ada API key — baris ini sepertinya mode session (cookie). Cek lewat panel Session, bukan cek saldo.',
    }
  }
  try {
    const res = await fetch(`${NEXABOT_BASE}/credit`, {
      method: 'GET',
      headers: { 'X-Api-Key': safeHeaderValue(key) },
      // NexaBot /credit menggantung TANPA response untuk key yang tidak dikenal,
      // jadi tanpa timeout cek saldo bisa nge-hang selamanya.
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      if (res.status === 401) {
        return { ok: false, balance: null, creditCost: null, error: 'API key tidak valid' }
      }
      // 429/504 dari proxy artinya NexaBot yang bermasalah, bukan key-nya —
      // jelaskan supaya user tidak buru-buru menghapus key.
      return { ok: false, balance: null, creditCost: null, error: describeNexabotStatus(res.status) }
    }
    const data = await res.json()
    if (!data.ok) {
      return { ok: false, balance: null, creditCost: null, error: data.error || 'Gagal cek saldo' }
    }
    return {
      ok: true,
      balance: data.credit ?? null,
      creditCost: data.credit_cost ?? null,
      telegramId: data.telegram_id ?? null,
      registered: data.registered === true,
    }
  } catch (err: any) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ok: false,
      balance: null,
      creditCost: null,
      error: timedOut
        ? 'Timeout cek saldo NexaBot (15s) — NexaBot menggantung (biasanya key tidak dikenal). Kalau akun punya paket Unlimited, pakai mode Session (cookie): tidak perlu cek saldo.'
        : (err.message || 'Network error'),
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// SESSION INFO (mode cookie) — status sesi + paket Unlimited
// ═══════════════════════════════════════════════════════════════════

/** Info sesi hasil probe cookie login nexabot.id. */
export interface NexabotSessionInfo {
  ok: boolean
  active: boolean
  unlimited: boolean
  plan: string | null
  /** Nilai mentah masa berlaku (bisa ISO date atau teks). */
  until: string | null
  untilMs: number | null
  balance: number | null
  telegramId: string | null
  email: string | null
  error?: string
}

const EMPTY_SESSION: NexabotSessionInfo = {
  ok: false, active: false, unlimited: false, plan: null,
  until: null, untilMs: null, balance: null, telegramId: null, email: null,
}

/** Cari nilai pertama di objek bersarang yang key-nya cocok dengan regex. */
function findDeep(
  obj: any,
  test: (key: string, value: any) => boolean,
  depth = 0
): any {
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

function pickString(obj: any, re: RegExp): string | null {
  const v = findDeep(obj, (k, val) => re.test(k) && (typeof val === 'string' || typeof val === 'number'))
  return v != null && v !== '' ? String(v) : null
}

function pickNumber(obj: any, re: RegExp): number | null {
  const v = findDeep(obj, (k, val) =>
    re.test(k) && (typeof val === 'number' || (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val.trim())))
  )
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function pickBool(obj: any, re: RegExp): boolean | null {
  const v = findDeep(obj, (k, val) => re.test(k) && (typeof val === 'boolean' || val === 0 || val === 1))
  if (typeof v === 'boolean') return v
  if (v === 1) return true
  if (v === 0) return false
  return null
}

/**
 * Probe status sesi cookie lewat proxy `/session` (upstream GET /api/v1/credits).
 * Parsing bersifat heuristik karena bentuk respons web NexaBot bisa berubah;
 * kalau tidak ada field yang dikenali, `active` tetap true tapi `unlimited`
 * false supaya UI jujur menampilkan "belum terverifikasi".
 */
export async function checkNexabotSession(cookies: string): Promise<NexabotSessionInfo> {
  const cookieHeader = safeHeaderValue(parseNexabotCookieInput(cookies))
  if (!cookieHeader) {
    return { ...EMPTY_SESSION, error: 'Cookie session kosong / format tidak dikenali — paste cookie atau hasil “Copy as cURL”.' }
  }
  try {
    let res = await fetch(`${NEXABOT_BASE}/session`, {
      method: 'GET',
      headers: { 'X-Nexabot-Cookie': cookieHeader },
      signal: AbortSignal.timeout(15000),
    })
    if (res.status === 404) {
      // Fallback: sebagian host/rewrite memangkas path — pakai bentuk query.
      res = await fetch(`${NEXABOT_BASE}?action=session`, {
        method: 'GET',
        headers: { 'X-Nexabot-Cookie': cookieHeader },
        signal: AbortSignal.timeout(15000),
      })
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ...EMPTY_SESSION,
        error: 'Cookie sesi ditolak/kedaluwarsa. Kalau kamu pakai `document.cookie`, cookie sesi HttpOnly tidak ikut — ambil ulang lewat Network → Copy as cURL, lalu paste di panel Session.',
      }
    }
    if (!res.ok) {
      return {
        ...EMPTY_SESSION,
        error: res.status === 404
          ? 'Endpoint cek sesi tidak ditemukan (404) — server backend masih versi lama. Restart `npm run dev:server` (atau deploy ulang API) lalu coba lagi.'
          : `Cek sesi gagal: ${describeNexabotStatus(res.status)}`,
        // Catatan: 429/504 di sini = upstream sedang membatasi/menggantung,
        // BUKAN berarti cookie-nya mati. Pesannya dibedakan supaya user tidak
        // buru-buru login ulang hanya karena hiccup sesaat.
      }
    }

    const raw = await res.json().catch(() => null)
    if (!raw || raw.ok === false) {
      return { ...EMPTY_SESSION, error: raw?.error || 'Respons sesi tidak dikenali' }
    }

    // Gabungkan wrapper {data:{...}} ke level atas agar pencarian lebih luas.
    const body = raw?.data && typeof raw.data === 'object' ? { ...raw, ...raw.data } : raw

    const unlimitedFlag = pickBool(body, /^(is_?)?unlimited(_active|_access)?$/i)
    const plan = pickString(body, /^(plan|plan_name|package|package_name|subscription|subscription_type|tier|product)$/i)
    const until = pickString(body, /(unlimited_until|expire[sd]?_at|expiry|valid_until|active_until|end_date|until)$/i)
    const balance = pickNumber(body, /^(credit|credits|balance|remaining_credits|credit_balance)$/i)
    const telegramId = pickString(body, /^(telegram_id|telegram_?user_?id|user_id)$/i)
    const email = pickString(body, /^(email|mail)$/i)

    let untilMs: number | null = null
    if (until) {
      const t = Date.parse(until)
      untilMs = Number.isNaN(t) ? null : t
    }
    const expiredByDate = untilMs != null && untilMs < Date.now()
    const planLooksUnlimited = !!plan && /unlimited/i.test(plan)
    const unlimited = !expiredByDate && (
      unlimitedFlag === true || planLooksUnlimited || (untilMs != null && unlimitedFlag !== false)
    )

    return {
      ok: true,
      active: !expiredByDate,
      unlimited,
      plan,
      until,
      untilMs,
      balance,
      telegramId,
      email,
      error: expiredByDate ? 'Masa berlaku paket sudah berakhir' : undefined,
    }
  } catch (err: any) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ...EMPTY_SESSION,
      error: timedOut ? 'Timeout cek sesi NexaBot (15s)' : (err?.message || 'Network error'),
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// PERINGATAN DINI SESI (dipakai pemantau latar belakang & badge jalur)
// ═══════════════════════════════════════════════════════════════════
// Logikanya sengaja murni (tanpa store/efek) supaya bisa diuji langsung dan
// dipakai ulang oleh pemantau (nexabotSessionMonitor.ts) maupun badge jalur.

export type NexabotSessionWarningLevel = 'expired' | 'expiring' | 'stale'

export interface NexabotSessionWarning {
  level: NexabotSessionWarningLevel
  /** Pesan siap ditampilkan sebagai toast. */
  message: string
  /** Isi browser notification. */
  body: string
  /** Sisa waktu sampai paket berakhir (null kalau tidak diketahui). */
  remainingMs: number | null
}

/** Peringatan lebih awal: paket Unlimited berakhir kurang dari 24 jam lagi. */
export const NEXABOT_EXPIRING_WINDOW_MS = 24 * 60 * 60 * 1000
/** Cookie yang tidak pernah diperbarui selama ini dianggap "mungkin basi". */
export const NEXABOT_STALE_COOKIE_MS = 24 * 60 * 60 * 1000
/** Paket yang baru lewat < 12 jam: tanggal bisa saja masih "hari ini" lokal. */
const NEXABOT_FRESH_EXPIRY_MS = 12 * 60 * 60 * 1000

/** "3 jam", "25 menit", "2 hari" — dipakai pesan toast & badge jalur. */
export function formatNexabotDuration(ms: number): string {
  if (ms <= 0) return 'sudah berakhir'
  const mins = Math.max(1, Math.round(ms / 60000))
  if (mins < 60) return `${mins} menit`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} jam`
  return `${Math.round(hours / 24)} hari`
}

/**
 * Turunkan peringatan dini dari hasil probe sesi.
 *
 * Mengembalikan null kalau tidak ada yang perlu diperingatkan — termasuk saat
 * probe gagal (`ok:false`): status yang tidak terbaca sudah ditampilkan jujur di
 * badge jalur, jadi tidak perlu jadi toast berulang.
 *
 * Deteksi memakai data yang benar-benar tersedia: `until`/`untilMs` (tanggal
 * berakhir paket) dan `cookiesAt` (kapan cookie terakhir berubah) sebagai proxy
 * umur cookie — cookie sesi tidak mengirim `Expires` ke klien.
 */
export function nexabotSessionWarning(
  session: NexabotSessionInfo | null,
  opts: { cookiesAt?: number | null; now?: number } = {}
): NexabotSessionWarning | null {
  if (!session || !session.ok) return null
  const now = opts.now ?? Date.now()

  if (!session.active) {
    const untilMs = session.untilMs
    const baruSaja = untilMs != null && now - untilMs < NEXABOT_FRESH_EXPIRY_MS
    return {
      level: 'expired',
      message: baruSaja
        ? `⚠️ Masa berlaku paket Unlimited NexaBot baru saja berakhir (${session.until}). Login ulang di nexabot.id agar generate tetap tanpa potong kredit — kalau tidak, generate otomatis beralih ke API key (0.25 cr).`
        : '⚠️ Sesi Unlimited NexaBot sudah kedaluwarsa. Perbarui cookie (extension NexaBot / login ulang di nexabot.id) — tanpa itu generate otomatis beralih ke API key pay-as-you-go 0.25 cr.',
      body: 'Sesi Unlimited NexaBot berakhir. Login ulang / perbarui cookie sebelum generate berikutnya.',
      remainingMs: untilMs != null ? untilMs - now : null,
    }
  }

  const remainingMs = session.untilMs != null ? session.untilMs - now : null
  if (remainingMs != null && remainingMs <= NEXABOT_EXPIRING_WINDOW_MS) {
    return {
      level: 'expiring',
      message: `⏳ Sesi Unlimited NexaBot berakhir ${formatNexabotDuration(remainingMs)} lagi${session.until ? ` (${session.until})` : ''}. Perbarui cookie sebelum menjalankan generate panjang — kalau sesi mati di tengah job, generate otomatis beralih ke API key 0.25 cr.`,
      body: `Paket Unlimited berakhir ${formatNexabotDuration(remainingMs)} lagi. Perbarui cookie sesi lewat extension NexaBot.`,
      remainingMs,
    }
  }

  const cookiesAt = opts.cookiesAt ?? null
  if (cookiesAt && now - cookiesAt >= NEXABOT_STALE_COOKIE_MS) {
    const age = formatNexabotDuration(now - cookiesAt)
    return {
      level: 'stale',
      message: `🍪 Cookie sesi NexaBot sudah ${age} tidak diperbarui. Pastikan extension NexaBot / tab nexabot.id tetap terbuka — kalau sesi mati di tengah job, generate otomatis beralih ke API key pay-as-you-go 0.25 cr.`,
      body: `Cookie sesi NexaBot berumur ${age}. Buka nexabot.id agar extension mengirim cookie segar.`,
      remainingMs,
    }
  }

  return null
}

// ═══════════════════════════════════════════════════════════════════
// SUBMIT VIDEO GENERATION
// ═══════════════════════════════════════════════════════════════════

export type NexabotMode = 't2v' | 'sfv' | 'i2v' | 'r2v' | 'img' | 'music' | 'tts'

export interface NexabotSubmitParams {
  mode: NexabotMode
  prompt: string
  ratio?: number       // 1 = 16:9, 2 = 9:16
  aspect?: number      // 1 = square, 2 = 2:3, 5 = 9:16
  voice?: string       // untuk tts (default: en-US-Wavenet-D)
  media?: string[]     // base64 data URI
  /**
   * ID Telegram yang ditagihkan (parameter resmi NexaBot: "user id for credit
   * billing"). Kalau kosong, NexaBot memakai akun default milik API key.
   * Paket Unlimited NexaBot terikat ke akun Telegram — isi ini dengan akun
   * pemilik paket supaya request ditagihkan ke akun tersebut.
   */
  telegramId?: string
  /** @deprecated API NexaBot TIDAK menerima parameter `model` (docs resmi hanya:
   *  mode, prompt, telegram_id, ratio). Model dipilih otomatis di sisi server.
   *  Field ini disimpan hanya untuk kompatibilitas dan tidak pernah dikirim. */
  model?: string
}

export interface NexabotSubmitResult {
  ok: boolean
  jobId?: string
  status?: string
  downloadUrl?: string
  creditCost?: number
  creditBalance?: number
  estSeconds?: number
  error?: string
}

export async function submitNexabot(
  params: NexabotSubmitParams,
  authOverride?: NexabotAuth | string,
  opts: NexabotRetryOptions = {}
): Promise<NexabotSubmitResult> {
  const { maxAttempts = 3, baseMs = 2000, maxMs = 15000, random, onRetry } = opts
  const auth = fillAuthFromStorage(normalizeAuth(authOverride))
  const { apiKey, cookies } = normalizeValues(auth)
  const session = !!cookies
  if (!apiKey && !cookies) {
    throw new Error('NexaBot: tidak ada API key / cookie session yang valid — cek format di halaman Providers')
  }

  const body: Record<string, any> = {
    mode: params.mode,
    prompt: params.prompt,
  }
  if (params.ratio !== undefined) body.ratio = params.ratio
  if (params.aspect !== undefined) body.aspect = params.aspect
  if (params.voice) body.voice = params.voice
  if (params.media) body.media = params.media
  // telegram_id hanya dipakai jalur API key (billing). Di mode session, akun
  // sudah ditentukan oleh cookie login.
  if (params.telegramId && !session) body.telegram_id = params.telegramId
  // CATATAN: sengaja TIDAK mengirim `params.model` — NexaBot mengabaikannya
  // (job yang dikembalikan selalu `"model":null`). Gunakan `mode` untuk
  // memilih perilaku: t2v / sfv / i2v / r2v.

  // Mode session → endpoint web /generate (menghormati paket Unlimited).
  // Mode API key → /submit (pay-as-you-go 0.25 cr).
  const endpoint = session ? `${NEXABOT_BASE}/generate` : `${NEXABOT_BASE}/submit`
  console.log(`[nexabot] Submit ${params.mode} via ${session ? 'session(cookie)' : 'api-key'}: ${params.prompt.slice(0, 50)}...`)

  const attempts = Math.max(1, maxAttempts)
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(auth),
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      if (res.status === 401 || res.status === 403) {
        throw new Error(session
          ? 'NexaBot: session cookie kedaluwarsa — login ulang di nexabot.id lalu paste cookie baru'
          : 'NexaBot: API key tidak valid')
      }
      if (res.status === 402) throw new Error('NexaBot: Kredit tidak cukup (perlu 0.25)')

      // Retry HANYA untuk 429. Upstream menolak permintaan rate-limited tanpa
      // membuat job, jadi mengulang tidak menghasilkan job/kredit ganda. Untuk
      // 5xx & timeout kita sengaja TIDAK mengulang: job bisa saja sudah terbentuk
      // di sana (kredit 0.25 hangus dua kali kalau asal ulang).
      if (res.status === 429) {
        const message = describeNexabotStatus(res.status)
        if (attempt < attempts) {
          const delayMs = nexabotRetryDelayMs({ attempt, retryAfterHeader: res.headers.get('retry-after'), opts: { baseMs, maxMs, random } })
          onRetry?.({ attempt, status: res.status, delayMs, message })
          console.warn(`[nexabot] Submit ${res.status} (${message}) — coba lagi dalam ${Math.round(delayMs / 1000)}s`)
          await sleep(delayMs)
          continue
        }
        throw new Error(`NexaBot: ${message} — tunggu sebentar lalu coba lagi${retryAfterHint(res)}`)
      }

      throw new Error(`NexaBot HTTP ${res.status}: ${errText.slice(0, 200)}`)
    }

    const data = await res.json()
    if (!data.ok) {
      throw new Error(data.error || 'NexaBot: Submit gagal')
    }

    return {
      ok: true,
      jobId: data.job_id,
      status: data.status,
      downloadUrl: data.download_url,
      creditCost: data.credit_cost,
      creditBalance: data.credit_balance,
      estSeconds: data.est_seconds,
    }
  }

  // Tidak tercapai untuk maxAttempts >= 1 (loop selalu return/throw), jaga-jaga.
  throw new Error('NexaBot: Submit gagal setelah beberapa percobaan')
}

// ═══════════════════════════════════════════════════════════════════
// POLL JOB STATUS
// ═══════════════════════════════════════════════════════════════════

export interface NexabotJob {
  id: string
  status: 'queued' | 'processing' | 'done' | 'failed'
  mode: string
  prompt: string
  progress?: string
  error?: string | null
}

export interface NexabotPollResult {
  ok: boolean
  job?: NexabotJob
  error?: string
}

/**
 * Cari semua URL hasil (http/https) di dalam payload job yang sudah selesai.
 *
 * Sebagian provider mengembalikan beberapa varian asset di payload yang sama
 * (mis. `*_nowatermark`, `hd`, `master`, `final`) selain `download_url`.
 * Fungsi ini dipakai untuk (a) diagnostik satu kali saat job selesai dan
 * (b) landasan pemilihan asset terbaik — tanpa menebak nama field-nya.
 *
 * Hanya menggali object/array (bukan string besar seperti base64 media), jadi
 * aman dipanggil pada payload penuh.
 */
export function findNexabotResultUrls(value: unknown): { path: string; url: string }[] {
  const out: { path: string; url: string }[] = []
  const seen = new Set<unknown>()
  const URL_KEY = /url|download|output|result|video|file|asset|media|link/i

  const walk = (node: any, path: string, depth: number) => {
    if (out.length >= 25 || depth > 6 || node == null) return
    if (typeof node === 'string') {
      if (/^https?:\/\//i.test(node) && URL_KEY.test(path)) out.push({ path, url: node })
      return
    }
    if (typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      node.slice(0, 10).forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1))
      return
    }
    for (const [k, v] of Object.entries(node)) {
      walk(v, path ? `${path}.${k}` : k, depth + 1)
    }
  }

  walk(value, '', 0)
  return out
}

/**
 * Batas kegagalan TRANSIENT berturut-turut sebelum kita menyerah. Dengan jeda
 * backoff (maks 15s) ini setara ~3 menit upstream tidak bisa dihubungi — cukup
 * lama untuk melewati hiccup gateway, tapi tidak menggantung user selamanya.
 */
const MAX_CONSECUTIVE_TRANSIENT = 12

/**
 * Poll status job sampai selesai. Respons READ-ONLY, jadi aman diulang: satu
 * poll yang meleset (proxy 504 karena upstream menggantung, atau 429 rate limit)
 * TIDAK menggagalkan job yang masih `queued` di NexaBot — kita tunggu sebentar
 * lalu tanya lagi, menghormati `Retry-After` kalau upstream mengirimnya.
 *
 * Yang tetap dianggap fatal: 4xx selain 429 (sesi mati / job hilang), halaman
 * HTML (cookie kedaluwarsa — biar fallback session→API key jalan), dan
 * `status: failed` dari upstream.
 */
export async function pollNexabotJob(
  jobId: string,
  authOverride: NexabotAuth | string,
  onProgress?: (msg: string) => void,
  opts: NexabotRetryOptions & { maxTotalMs?: number } = {}
): Promise<NexabotJob> {
  const { maxAttempts = 120, baseMs = 3000, maxMs = 15000, maxTotalMs = 20 * 60 * 1000, random, onRetry } = opts
  const auth = fillAuthFromStorage(normalizeAuth(authOverride))
  const { apiKey, cookies } = normalizeValues(auth)
  if (!apiKey && !cookies) throw new Error('NexaBot: tidak ada API key / cookie session yang valid')

  const attempts = Math.max(1, maxAttempts)
  const startedAt = Date.now()
  let attempt = 0
  let transientStreak = 0
  let delayMs = baseMs
  let lastStatus = ''

  /** Satu kegagalan transient: tunggu lalu lanjut, atau menyerah kalau kebanyakan. */
  const retryLater = (info: { status: number | null; message: string; retryAfterHeader?: string | null }) => {
    transientStreak++
    delayMs = nexabotRetryDelayMs({
      attempt: transientStreak,
      retryAfterHeader: info.retryAfterHeader,
      opts: { baseMs, maxMs, random },
    })
    onRetry?.({ attempt, status: info.status, delayMs, message: info.message })
    console.warn(`[nexabot] Poll ${attempt} gagal (${info.message}) — coba lagi dalam ${Math.round(delayMs / 1000)}s`)

    const elapsedMs = Date.now() - startedAt
    if (transientStreak >= MAX_CONSECUTIVE_TRANSIENT) {
      throw new Error(`NexaBot tidak merespons (${transientStreak} percobaan berturut-turut gagal) — cek status job ${jobId} di nexabot.id, lalu coba lagi.`)
    }
    if (elapsedMs > maxTotalMs) {
      throw new Error(`NexaBot polling timeout (${Math.round(elapsedMs / 1000)}s) — cek status job ${jobId} di nexabot.id.`)
    }
  }

  while (attempt < attempts) {
    if (attempt > 0) {
      onProgress?.(`Polling Nexabot ${attempt + 1}/${attempts} (${Math.round((Date.now() - startedAt) / 1000)}s)...`)
      await sleep(delayMs)
    }
    attempt++

    let res: Response
    try {
      res = await fetch(`${NEXABOT_BASE}/job/${jobId}`, {
        method: 'GET',
        headers: authHeaders(auth),
      })
    } catch (err: any) {
      // Jaringan/proxy putus — bukan berarti job-nya gagal.
      retryLater({ status: null, message: err?.message || 'koneksi terputus' })
      continue
    }

    const verdict = nexabotHttpVerdict(res.status)

    if (verdict === 'fatal') {
      const errText = await res.text().catch(() => '')
      if (res.status === 401 || res.status === 403) {
        throw new Error('NexaBot: session cookie kedaluwarsa — login ulang di nexabot.id lalu paste cookie baru')
      }
      throw new Error(`NexaBot job tidak ditemukan atau gagal — ${describeNexabotStatus(res.status)}${errText ? `: ${errText.slice(0, 120)}` : ''}`)
    }

    if (verdict === 'retry') {
      retryLater({
        status: res.status,
        message: describeNexabotStatus(res.status),
        retryAfterHeader: res.headers.get('retry-after'),
      })
      continue
    }

    const contentType = res.headers.get('content-type') || ''
    const text = await res.text()
    // Halaman HTML = halaman login (cookie mati). Dibiarkan fatal supaya lapisan
    // fallback session → API key bisa mengambil alih.
    if (!contentType.includes('application/json') || text.trim().startsWith('<')) {
      throw new Error(`NexaBot API mengembalikan error (bukan JSON). Response: ${text.slice(0, 200)}`)
    }

    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`NexaBot API mengembalikan error (bukan JSON). Response: ${text.slice(0, 200)}`)
    }

    if (!data.ok) {
      retryLater({ status: res.status, message: data.error || 'respons belum ok' })
      continue
    }

    const job = data.job as NexabotJob
    transientStreak = 0
    delayMs = nexabotRetryDelayMs({ attempt: 1, opts: { baseMs, maxMs, random } })

    if (job.status !== lastStatus) {
      lastStatus = job.status
      console.log(`[nexabot] Poll ${attempt}: status=${job.status}${job.progress ? ` ${job.progress}` : ''}`)
    }

    if (job.status === 'done') {
      // Diagnostik sekali per job: laporkan URL hasil yang benar-benar tersedia
      // di payload (`download_url` saja belum tentu satu-satunya varian).
      // Berguna untuk memutuskan asset mana yang diunduh agar hasil bersih.
      const assets = findNexabotResultUrls(data)
      if (assets.length > 0) {
        console.log(`[nexabot] Asset di payload job:`, assets.map((a) => `${a.path} → ${a.url.slice(0, 120)}`))
      } else {
        console.log(`[nexabot] Payload job selesai tanpa URL hasil — unduhan lewat /download/${jobId}`)
      }
      return job
    }

    if (job.status === 'failed') {
      throw new Error(`NexaBot job gagal: ${job.error || 'Unknown error'}`)
    }
  }

  throw new Error(`NexaBot polling timeout (${Math.round((Date.now() - startedAt) / 1000)}s, ${attempt} percobaan)`)
}

// ═══════════════════════════════════════════════════════════════════
// DOWNLOAD RESULT
// ═══════════════════════════════════════════════════════════════════

export async function downloadNexabotResult(
  jobId: string,
  authOverride: NexabotAuth | string
): Promise<{ ok: boolean; url?: string; error?: string; blobUrl?: string }> {
  const auth = fillAuthFromStorage(normalizeAuth(authOverride))
  const { apiKey, cookies } = normalizeValues(auth)
  if (!apiKey && !cookies) return { ok: false, error: 'NexaBot: tidak ada API key / cookie session yang valid' }
  try {
    const res = await fetch(`${NEXABOT_BASE}/download/${jobId}`, {
      method: 'GET',
      headers: authHeaders(auth),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { ok: false, error: `Download gagal: HTTP ${res.status} ${errText.slice(0, 200)}` }
    }

    const contentType = res.headers.get('content-type') || ''

    // NexaBot download endpoint returns binary video directly (not JSON)
    if (contentType.includes('application/json')) {
      // Legacy: JSON response with URL
      const data = await res.json()
      if (!data.ok) {
        return { ok: false, error: data.error || 'Download gagal' }
      }
      return { ok: true, url: data.url }
    }

    // Binary response — use blob URL directly for preview & download
    // (external hosting services unreliable: CORS, tmpfiles returns HTML, etc.)
    const blob = await res.blob()
    console.log(`[nexabot] Downloaded ${blob.size} bytes as ${contentType}`)

    const blobUrl = URL.createObjectURL(blob)
    console.log(`[nexabot] Created blob URL for preview: ${blobUrl.slice(0, 60)}...`)
    return { ok: true, url: blobUrl, blobUrl }
  } catch (err: any) {
    return { ok: false, error: err.message || 'Download error' }
  }
}

// ═══════════════════════════════════════════════════════════════════
// IMAGE COMPRESSION FOR API (aggressive — target <500KB raw)
// NexaBot API rejects payloads > ~2MB; base64 adds 33% overhead
// so raw image must be <500KB → base64 <667KB → JSON body <1MB
// ═══════════════════════════════════════════════════════════════════

export async function compressForApi(
  file: File,
  maxLongestPx = 768,
  quality = 0.6
): Promise<File> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)
      let { width, height } = img
      // Scale down if needed
      if (width > maxLongestPx || height > maxLongestPx) {
        const scale = maxLongestPx / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob((b) => {
        if (b) resolve(b)
        else reject(new Error('Canvas toBlob failed'))
      }, 'image/jpeg', quality)
    }
    img.onerror = () => { reject(new Error('Image load failed')) }
    img.src = URL.createObjectURL(file)
  })

  const result = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
    type: 'image/jpeg',
  })
  console.log(`[nexabot] compressForApi: ${file.name} (${(file.size / 1024).toFixed(0)}KB) → ${result.name} (${(result.size / 1024).toFixed(0)}KB) @ ${maxLongestPx}px q${quality}`)
  return result
}
