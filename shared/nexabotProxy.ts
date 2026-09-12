/**
 * Kebijakan timeout & retry untuk proxy NexaBot.
 *
 * Dipakai DUA implementasi proxy yang harus berperilaku sama:
 *  - server/routes/nexabot.ts  (Express lokal, dev)
 *  - api/public/nexabot.ts     (fungsi Vercel, produksi)
 *
 * Kenapa perlu: NexaBot (nexabot.id) sering menggantung tanpa respons. Proxy
 * kita dulu memakai satu timeout 20 detik untuk semua hal dan langsung menjawab
 * 504 — padahal hanya SATU percobaan. Akibatnya satu hiccup upstream langsung
 * terlihat oleh klien sebagai kegagalan job yang sebenarnya masih `queued`.
 *
 * Sekarang tiap jenis request punya timeout & jumlah percobaan sendiri:
 *  - probe saldo/sesi & poll status job = read-only → aman diulang;
 *  - submit/generate = bisa membuat job (kredit terpotong) → TIDAK pernah
 *    diulang, supaya tidak ada job/kredit ganda.
 *
 * Bedanya dengan src/lib/nexabotRetry.ts (sisi klien): modul ini berjalan di
 * server/Vercel dan mengurus timeout-batas atas proxy, sedangkan yang itu
 * mengatur backoff polling di browser.
 */

export type NexabotProxyAction =
  | 'credit'
  | 'session'
  | 'job'
  | 'modes'
  | 'submit'
  | 'generate'
  | 'download'
  | 'generic'

export interface NexabotProxyPolicy {
  /** Timeout per percobaan (ms). */
  timeoutMs: number
  /** Total percobaan; 1 = tanpa retry. */
  attempts: number
  /** Keterangan singkat untuk pesan error/log. */
  label: string
}

export const NEXABOT_PROXY_POLICY: Record<NexabotProxyAction, NexabotProxyPolicy> = {
  // Probe saldo/sesi: read-only, murah, dan jawabannya berguna walau lambat
  // (dipanggil background oleh check-all/session monitor) → ruang paling lega
  // (30s × 3) supaya satu hiccup upstream tidak langsung jadi 504.
  credit: { timeoutMs: 30_000, attempts: 3, label: 'cek saldo' },
  session: { timeoutMs: 30_000, attempts: 3, label: 'cek sesi' },
  // Poll status: read-only juga, tapi ini di jalur kritis user yang sedang
  // menunggu video, jadi per percobaan lebih pendek dari probe dan hanya 2
  // percobaan — klien punya backoff sendiri dan akan menanyakan status lagi.
  job: { timeoutMs: 25_000, attempts: 2, label: 'poll status job' },
  // Daftar mode/model: read-only, dipakai halaman Providers.
  modes: { timeoutMs: 20_000, attempts: 2, label: 'ambil daftar mode' },
  // Submit & generate: SATU percobaan. Kalau responsnya hilang, job bisa saja
  // sudah terbentuk upstream — mengulang berarti kredit terpotong dua kali.
  submit: { timeoutMs: 180_000, attempts: 1, label: 'submit ke NexaBot' },
  generate: { timeoutMs: 180_000, attempts: 1, label: 'generate via session' },
  download: { timeoutMs: 180_000, attempts: 1, label: 'unduh hasil' },
  // Jalur cadangan (path yang tidak dikenali): tetap diberi timeout supaya tidak
  // menggantung tanpa batas, tapi tanpa retry karena isinya tidak diketahui.
  generic: { timeoutMs: 180_000, attempts: 1, label: 'proxy NexaBot' },
}

/** Jeda antar percobaan (backoff + jitter). */
export const NEXABOT_PROXY_RETRY = {
  baseMs: 500,
  maxMs: 4000,
  jitter: 0.25,
  /** Retry-After dari upstream tidak boleh menahan proxy lebih lama dari ini. */
  maxRetryAfterMs: 10_000,
}

export interface NexabotProxyRetryConfig {
  baseMs: number
  maxMs: number
  jitter: number
  maxRetryAfterMs: number
}

/**
 * Config retry efektif. Bisa ditimpa lewat env supaya test tidak menunggu
 * setengah detik tiap percobaan (dan ops bisa melonggarkan saat upstream ramai).
 */
export function nexabotProxyRetryConfig(env: NodeJS.ProcessEnv = process.env): NexabotProxyRetryConfig {
  const num = (raw: string | undefined, fallback: number) => {
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
  return {
    baseMs: num(env.NEXABOT_PROXY_RETRY_BASE_MS, NEXABOT_PROXY_RETRY.baseMs),
    maxMs: num(env.NEXABOT_PROXY_RETRY_MAX_MS, NEXABOT_PROXY_RETRY.maxMs),
    jitter: NEXABOT_PROXY_RETRY.jitter,
    maxRetryAfterMs: num(env.NEXABOT_PROXY_RETRY_MAX_RETRY_AFTER_MS, NEXABOT_PROXY_RETRY.maxRetryAfterMs),
  }
}

/** Status upstream yang layak diulang proxy (rate limit & gateway). */
export function isNexabotProxyTransientStatus(status: number): boolean {
  return status === 429 || status === 408 || status === 425 || status >= 500
}

/** `Retry-After` dalam ms (detik atau tanggal HTTP); null kalau tidak terbaca. */
export function parseNexabotRetryAfterMs(header: string | null | undefined, nowMs: number = Date.now()): number | null {
  const raw = String(header ?? '').trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return Math.max(0, Number(raw) * 1000)
  const at = Date.parse(raw)
  if (!Number.isFinite(at)) return null
  return Math.max(0, at - nowMs)
}

/** Jeda sebelum percobaan berikutnya (Retry-After menang atas backoff). */
export function nexabotProxyDelayMs(params: {
  attempt: number
  retryAfterHeader?: string | null
  config?: NexabotProxyRetryConfig
  random?: () => number
  nowMs?: number
}): number {
  const {
    attempt,
    retryAfterHeader,
    config = nexabotProxyRetryConfig(),
    random = Math.random,
    nowMs = Date.now(),
  } = params
  const hinted = parseNexabotRetryAfterMs(retryAfterHeader, nowMs)
  if (hinted != null) return Math.min(config.maxRetryAfterMs, hinted)

  const step = Math.max(0, Math.floor(attempt) - 1)
  const raw = Math.min(config.maxMs, config.baseMs * Math.pow(2, step))
  const spread = raw * Math.min(1, Math.max(0, config.jitter))
  const value = raw + (random() * 2 - 1) * spread
  return Math.max(0, Math.round(Math.min(config.maxMs, value)))
}

/** Header yang perlu diteruskan apa adanya dari upstream ke klien. */
export function nexabotRelayHeaders(upstream: Response): Record<string, string> {
  const retryAfter = upstream.headers.get('retry-after')
  return retryAfter ? { 'Retry-After': retryAfter } : {}
}

/** Error dari percobaan yang semuanya gagal (timeout / koneksi). */
export class NexabotUpstreamError extends Error {
  attempts: number
  lastStatus: number | null
  timeout: boolean

  constructor(message: string, info: { attempts: number; lastStatus?: number | null; timeout?: boolean }) {
    super(message)
    this.name = 'NexabotUpstreamError'
    this.attempts = info.attempts
    this.lastStatus = info.lastStatus ?? null
    this.timeout = !!info.timeout
  }
}

export interface NexabotProxyCallOptions {
  action: NexabotProxyAction
  /** Timpa policy (test). */
  policy?: Partial<NexabotProxyPolicy>
  /** Timpa config retry (test). */
  retry?: Partial<NexabotProxyRetryConfig>
  /** Dipakai test supaya tidak menyentuh jaringan global. */
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  /** Dipanggil tiap kali menunggu sebelum mencoba lagi (log). */
  onRetry?: (info: { attempt: number; status: number | null; delayMs: number; message: string }) => void
}

const defaultSleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))

function isTimeoutError(err: any): boolean {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError'
}

/**
 * Panggil upstream NexaBot dengan timeout & retry sesuai `action`.
 *
 * Transient (timeout, koneksi putus, 429, 5xx) diulang selama percobaan tersisa;
 * kalau percobaan habis, respons terakhir dari upstream DIKEMBALIKAN apa adanya
 * (supaya klien melihat status aslinya, mis. 429 + Retry-After) atau error
 * dilempar kalau kegagalannya bukan HTTP.
 */
export async function fetchNexabotUpstream(
  url: string,
  init: RequestInit,
  options: NexabotProxyCallOptions,
): Promise<{ response: Response; attempts: number }> {
  const base = NEXABOT_PROXY_POLICY[options.action]
  const policy: NexabotProxyPolicy = { ...base, ...options.policy }
  const retryConfig = { ...nexabotProxyRetryConfig(), ...options.retry }
  const doFetch = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const attempts = Math.max(1, Math.floor(policy.attempts))

  let attempt = 0
  let lastError: any = null
  let lastStatus: number | null = null

  for (attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await doFetch(url, { ...init, signal: AbortSignal.timeout(policy.timeoutMs) })
      lastStatus = response.status

      if (!isNexabotProxyTransientStatus(response.status)) {
        return { response, attempts: attempt }
      }

      if (attempt < attempts) {
        const delayMs = nexabotProxyDelayMs({
          attempt,
          retryAfterHeader: response.headers.get('retry-after'),
          config: retryConfig,
          random: options.random,
        })
        options.onRetry?.({ attempt, status: response.status, delayMs, message: `upstream HTTP ${response.status}` })
        // Respons yang dibuang harus ditutup supaya koneksi tidak menggantung.
        try { await response.body?.cancel() } catch { /* bukan masalah */ }
        await sleep(delayMs)
        continue
      }

      return { response, attempts: attempt }
    } catch (err: any) {
      lastError = err
      if (attempt < attempts) {
        const delayMs = nexabotProxyDelayMs({ attempt, config: retryConfig, random: options.random })
        options.onRetry?.({
          attempt,
          status: null,
          delayMs,
          message: isTimeoutError(err) ? `timeout ${policy.timeoutMs}ms` : err?.message || 'koneksi gagal',
        })
        await sleep(delayMs)
        continue
      }
    }
  }

  const timeout = isTimeoutError(lastError)
  const detail = timeout
    ? `timeout setelah ${attempts}×${Math.round(policy.timeoutMs / 1000)}s`
    : lastError?.message || 'koneksi ke NexaBot gagal'
  throw new NexabotUpstreamError(
    `NexaBot ${policy.label} gagal — ${detail}`,
    { attempts, lastStatus, timeout },
  )
}
