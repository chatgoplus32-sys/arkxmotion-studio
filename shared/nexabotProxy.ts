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
  // Probe saldo/sesi: read-only, jadi boleh diulang — TAPI anggarannya harus
  // muat di dalam kesabaran klien (halaman Providers memakai
  // NEXABOT_CHECK_TIMEOUT_MS = 55s).
  //
  // Kenapa bukan 30s × 3 seperti dulu: log nexabot-local menunjukkan /credit
  // menggantung ~30s TANPA jawaban, retry 3× = ~92s, padahal klien menyerah di
  // 8–15s — jadi hasilnya selalu 504 dan tidak ada satu pun percobaan yang
  // sempat dilihat user. Sekarang satu percobaan 20s + satu retry (~45s worst
  // case): jawaban upstream yang datang di ~30s tetap tertangkap di percobaan
  // kedua, dan seluruh anggaran masih di bawah timeout klien.
  credit: { timeoutMs: 20_000, attempts: 2, label: 'cek saldo' },
  session: { timeoutMs: 20_000, attempts: 2, label: 'cek sesi' },
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

// ═══════════════════════════════════════════════════════════════════
// ANTREAN PROBE & SINGLE-FLIGHT (khusus request read-only)
// ═══════════════════════════════════════════════════════════════════
/**
 * Log lapangan (nexabot-local): begitu beberapa key dicek bersamaan, lima
 * request `/credit` menembak upstream sekaligus — dan NexaBot menggantung untuk
 * SEMUANYA (semua berakhir `timeout setelah 3×30s`). Padahal request yang persis
 * sama (key/sesi yang sama, dipicu cek-all + pemantau sesi + dashboard) tidak
 * perlu dua kali jalan sama sekali.
 *
 * Dua penanganan di sini, keduanya HANYA untuk aksi read-only:
 *
 *  1. **single-flight** — panggilan identik yang sedang jalan berbagi satu
 *     respons upstream, bukan menembak ulang. Respons di-clone supaya tiap
 *     pemanggil tetap bebas membaca body-nya sendiri.
 *  2. **antrean FIFO** — maksimum {@link NEXABOT_PROBE_QUEUE.concurrency} probe
 *     jalan bersamaan; sisanya menunggu slot, dibatasi
 *     {@link NEXABOT_PROBE_QUEUE.maxWaitMs} supaya tidak menggantung selamanya.
 *
 * Submit & generate TIDAK lewat jalur ini: keduanya bisa membuat job (kredit
 * terpotong) dan tidak boleh dibagi maupun ditahan.
 *
 * Batasannya: antrean ini per proses/instance server. Di Vercel ia menjaga
 * instance yang dipakai bersama; di server Express lokal (kasus paling sering
 * memicu hujan probe) efeknya langsung terasa.
 */

export const NEXABOT_PROBE_QUEUE = {
  /** Probe read-only yang boleh jalan bersamaan per proses/instance. */
  concurrency: 2,
  /** Batas menunggu slot antrean sebelum menyerah (ms). */
  maxWaitMs: 25_000,
}

export interface NexabotProbeQueueConfig {
  concurrency: number
  maxWaitMs: number
}

/** Config antrean efektif — bisa disetel lewat env saat upstream sedang ramai. */
export function nexabotProbeQueueConfig(env: NodeJS.ProcessEnv = process.env): NexabotProbeQueueConfig {
  const num = (raw: string | undefined, fallback: number) => {
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
  return {
    concurrency: Math.max(1, Math.floor(num(env.NEXABOT_PROBE_CONCURRENCY, NEXABOT_PROBE_QUEUE.concurrency))),
    maxWaitMs: num(env.NEXABOT_PROBE_QUEUE_MAX_WAIT_MS, NEXABOT_PROBE_QUEUE.maxWaitMs),
  }
}

/** Aksi read-only & idempoten → aman diantrekan sekaligus dibagi. */
export function isNexabotShareableProbe(action: NexabotProxyAction): boolean {
  return action === 'credit' || action === 'session' || action === 'modes'
}

/**
 * Kunci single-flight: jenis request + URL + kredensialnya. Nilainya hanya
 * dipakai sebagai kunci Map di memori proses — tidak pernah di-log.
 */
export function nexabotProbeShareKey(url: string, init: RequestInit, action: NexabotProxyAction): string {
  const headers = (init.headers || {}) as Record<string, string>
  const auth = headers['x-api-key'] || headers['X-Api-Key']
    || headers['x-nexabot-cookie'] || headers['X-Nexabot-Cookie'] || ''
  return `${action}|${init.method || 'GET'}|${url}|${auth}`
}

interface ProbeWaiter {
  grant: () => void
  timer: ReturnType<typeof setTimeout> | null
  settled: boolean
}

/** Semaphore FIFO sederhana (satu instance per proses). */
export class NexabotProbeGate {
  private active = 0
  private queue: ProbeWaiter[] = []

  /** true = slot didapat (wajib `release()`), false = menunggu kelamaan. */
  async acquire(limit: number, maxWaitMs: number): Promise<boolean> {
    if (this.active < limit) {
      this.active += 1
      return true
    }
    return await new Promise<boolean>((resolve) => {
      const waiter: ProbeWaiter = { grant: () => resolve(true), timer: null, settled: false }
      waiter.timer = setTimeout(() => {
        if (waiter.settled) return
        waiter.settled = true
        this.queue = this.queue.filter((w) => w !== waiter)
        resolve(false)
      }, maxWaitMs)
      // Antrean tidak boleh menahan proses tetap hidup (Node/Vercel).
      ;(waiter.timer as { unref?: () => void } | null)?.unref?.()
      this.queue.push(waiter)
    })
  }

  /** Lepas slot: diteruskan ke penunggu berikutnya kalau ada. */
  release(): void {
    const next = this.queue.shift()
    if (!next) {
      this.active = Math.max(0, this.active - 1)
      return
    }
    next.settled = true
    if (next.timer) clearTimeout(next.timer)
    next.grant()
  }

  /** Dipakai test: slot terpakai & jumlah penunggu saat ini. */
  stats(): { active: number; waiting: number } {
    return { active: this.active, waiting: this.queue.length }
  }
}

const probeGate = new NexabotProbeGate()
const inFlightProbes = new Map<string, Promise<{ response: Response; attempts: number }>>()

/** Salinan respons supaya tiap pemanggil bisa membaca body-nya sendiri. */
function cloneProbeResult(result: { response: Response; attempts: number }): { response: Response; attempts: number } {
  try {
    return { response: result.response.clone(), attempts: result.attempts }
  } catch {
    // Body sudah terkunci / respons tidak bisa di-clone — pakai apa adanya.
    return result
  }
}

/** Probe read-only di belakang antrean; dipanggil sekali per single-flight. */
async function runSharedProbe(
  url: string,
  init: RequestInit,
  options: NexabotProxyCallOptions,
): Promise<{ response: Response; attempts: number }> {
  const queue = nexabotProbeQueueConfig()
  const acquired = await probeGate.acquire(queue.concurrency, queue.maxWaitMs)
  if (!acquired) {
    const label = options.policy?.label ?? NEXABOT_PROXY_POLICY[options.action].label
    // attempts: 0 = tidak ada percobaan ke upstream sama sekali (tertahan antrean).
    // timeout: true → route menjawab 504, dan klien memperlakukannya transient.
    throw new NexabotUpstreamError(
      `NexaBot ${label} gagal — antrean probe penuh (semua slot terpakai)`,
      { attempts: 0, timeout: true },
    )
  }
  try {
    return await runNexabotUpstream(url, init, options)
  } finally {
    probeGate.release()
  }
}

/**
 * Penyebab asli kegagalan jaringan, diambil dari `err.cause`.
 *
 * `fetch` (undici) membungkus alasan sebenarnya di `cause` — ECONNRESET,
 * `UND_ERR_SOCKET`, `HeadersTimeoutError`, dan sejenisnya. Tanpa ini pesan yang
 * tersimpan hanya "fetch failed" (itulah yang bikin insiden submit 61 detik di
 * log tidak bisa ditelusuri).
 */
export function nexabotErrorCause(err: any): string {
  const cause = err?.cause
  if (!cause) return ''
  const code = cause.code || cause.errno || ''
  const name = cause.name && cause.name !== 'Error' ? cause.name : ''
  const label = [code, name].filter(Boolean).join(' ')
  const message = String(cause.message || '').trim()
  if (label && message) return `${label}: ${message}`
  return label || message
}

/**
 * Aksi yang bisa MEMBUAT job (kredit terpotong) → respons hilang berarti job
 * mungkin sudah terbentuk, jadi jangan menyarankan "coba lagi" begitu saja.
 */
export function isNexabotNonIdempotentAction(action: NexabotProxyAction): boolean {
  return action === 'submit' || action === 'generate'
}

/**
 * Saran aman yang boleh ditampilkan ke user setelah kegagalan.
 *
 * Untuk submit/generate, mengulang tanpa memeriksa lebih dulu bisa membuat job
 * ganda dan kredit 0.25 cr terpotong dua kali — jadi sarannya diperingatkan,
 * bukan "coba lagi".
 */
export function nexabotErrorAdvice(action: NexabotProxyAction): string {
  return isNexabotNonIdempotentAction(action)
    ? 'Respons NexaBot hilang — job MUNGKIN sudah terbentuk, jadi cek dulu di nexabot.id/riwayat; ulangi hanya kalau kamu yakin belum ada job, karena kredit 0.25 cr bisa terpotong dua kali.'
    : 'coba lagi'
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

export interface NexabotUpstreamCallResult {
  response: Response
  attempts: number
  /** true kalau respons ini dipakai bersama panggilan identik (single-flight). */
  shared?: boolean
}

/**
 * Panggil upstream NexaBot dengan timeout & retry sesuai `action`.
 *
 * Probe read-only (credit/session/modes) lewat antrean + single-flight dulu
 * (lihat {@link isNexabotShareableProbe}); submit/generate/download langsung
 * dieksekusi karena bisa membuat job & memotong kredit.
 */
export async function fetchNexabotUpstream(
  url: string,
  init: RequestInit,
  options: NexabotProxyCallOptions,
): Promise<NexabotUpstreamCallResult> {
  if (!isNexabotShareableProbe(options.action)) {
    return await runNexabotUpstream(url, init, options)
  }

  const shareKey = nexabotProbeShareKey(url, init, options.action)
  const running = inFlightProbes.get(shareKey)
  if (running) {
    // Panggilan kembar: pakai respons yang sedang dalam perjalanan, jangan
    // tembak upstream lagi (tiap pemanggil dapat salinan body sendiri).
    return { ...cloneProbeResult(await running), shared: true }
  }

  // Response "master" di-clone SEKALI di sini, sebelum pemanggil pertama sempat
  // membaca body-nya. Tiap pemanggil (termasuk yang pertama) menerima salinan,
  // jadi tidak ada yang bisa mengunci body milik pemanggil lain.
  const inflight = (async () => {
    const result = await runSharedProbe(url, init, options)
    return { response: result.response.clone(), attempts: result.attempts }
  })()
  inFlightProbes.set(shareKey, inflight)
  try {
    return cloneProbeResult(await inflight)
  } finally {
    if (inFlightProbes.get(shareKey) === inflight) inFlightProbes.delete(shareKey)
  }
}

/**
 * Eksekusi nyata satu panggilan upstream: timeout & retry sesuai `action`.
 *
 * Transient (timeout, koneksi putus, 429, 5xx) diulang selama percobaan tersisa;
 * kalau percobaan habis, respons terakhir dari upstream DIKEMBALIKAN apa adanya
 * (supaya klien melihat status aslinya, mis. 429 + Retry-After) atau error
 * dilempar kalau kegagalannya bukan HTTP.
 */
async function runNexabotUpstream(
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
          message: isTimeoutError(err)
            ? `timeout ${policy.timeoutMs}ms`
            : [err?.message || 'koneksi gagal', nexabotErrorCause(err)].filter(Boolean).join(' — '),
        })
        await sleep(delayMs)
        continue
      }
    }
  }

  const timeout = isTimeoutError(lastError)
  // Kegagalan jaringan menyertakan penyebab aslinya (mis. "fetch failed
  // (ECONNRESET: socket hang up)") supaya bisa ditelusuri tanpa menebak.
  const cause = timeout ? '' : nexabotErrorCause(lastError)
  const detail = timeout
    ? `timeout setelah ${attempts}×${Math.round(policy.timeoutMs / 1000)}s`
    : [(lastError?.message || 'koneksi ke NexaBot gagal'), cause && `(${cause})`].filter(Boolean).join(' ')
  throw new NexabotUpstreamError(
    `NexaBot ${policy.label} gagal — ${detail}`,
    { attempts, lastStatus, timeout },
  )
}
