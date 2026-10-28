/**
 * Shared fetch wrapper with timeout protection.
 * Prevents upstream API hangs from causing 502 errors.
 *
 * Aturan penentuannya ada di `isRetryableFetchError`: kegagalan yang terjadi
 * SEBELUM ada byte terkirim boleh diulang untuk metode apa pun, kegagalan
 * sesudah itu hanya untuk metode baca. Relay provider di sini memicu job
 * berbayar, jadi ulang yang salah = saldo member terpotong dua kali.
 */

/**
 * Gagal sebelum request terkirim (DNS / TCP / TLS belum sempat jalan) — aman
 * diulang meski metodenya POST yang membuat job berbayar.
 */
const PRE_SEND = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EHOSTDOWN',
  'UND_ERR_CONNECT_TIMEOUT',
])

/**
 * Bisa terjadi SETELAH request terkirim: upstream mungkin sudah menerima job
 * dan memungut biayanya. Hanya diulang untuk metode baca.
 */
const POST_SEND = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ERR_HTTP2_GOAWAY_SESSION',
  'ERR_STREAM_PREMATURE_CLOSE',
])

/** Kode yang muncul di pesan (bukan di `code`) kalau cause tidak terbaca. */
const PRE_SEND_TEXT = /getaddrinfo|econnrefused|ehostunreach|enetunreach|connect etimedout|connecttimeout/
const POST_SEND_TEXT = /socket hang up|premature close|other side closed|headers timeout|socket closed|epipe/

const IDEMPOTENT = new Set(['GET', 'HEAD'])

/** Timeout kami sendiri (timer di `fetchWithTimeout`), bukan error dari undici. */
export class FetchTimeoutError extends Error {
  readonly timeoutMs: number
  constructor(timeoutMs: number, cause?: unknown) {
    super(`timeout setelah ${timeoutMs}ms`, { cause })
    this.name = 'TimeoutError'
    this.timeoutMs = timeoutMs
  }
}

function chain(err: any): any[] {
  const out: any[] = []
  let cur = err
  for (let i = 0; i < 4 && cur; i++) {
    out.push(cur)
    cur = cur.cause
  }
  return out
}

function codes(err: any): string[] {
  return chain(err)
    // Hanya `code` string: DOMException memakai properti ini untuk nomor
    // legacy (AbortError = 20), yang muncul di log sebagai sampah petunjuk.
    .map((e) => (typeof e?.code === 'string' ? e.code : String(e?.errno || '')))
    .filter(Boolean)
}

function text(err: any): string {
  return chain(err)
    .map((e) => String(e?.message || e?.name || ''))
    .join(' ')
    .toLowerCase()
}

/**
 * Body yang bisa dikirim ulang. Stream dan FormData tidak: sudah terpakai pada
 * percobaan pertama, jadi retry-nya cuma menghasilkan error kedua.
 */
function replayableBody(body: unknown): boolean {
  if (body == null || typeof body === 'string' || body instanceof URLSearchParams) return true
  if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) return true
  // Blob/File dicek lewat nama konstruktornya: `Blob` tidak ada di lib ES2023
  // yang dipakai tsconfig.backend, sementara runtime Node 18+ punya global itu.
  return ['Blob', 'File'].includes((body as any)?.constructor?.name || '')
}

/**
 * Boleh diulang tidak error ini?
 *
 * POST/PUT hanya untuk kegagalan tahap koneksi — di titik itu belum ada byte
 * yang dikirim, jadi tidak mungkin job ganda. Untuk GET/HEAD, socket reset dan
 * timeout kami sendiri ikut diulang karena tidak ada efek samping.
 */
export function isRetryableFetchError(err: any, method = 'GET'): boolean {
  const idempotent = IDEMPOTENT.has(method.toUpperCase())
  // Sinyal pemanggil (batal klien / koneksi ditutup) bukan gangguan jaringan.
  if (err?.name === 'AbortError') return false
  if (err instanceof FetchTimeoutError) return idempotent
  const list = codes(err)
  if (list.some((c) => PRE_SEND.has(c))) return true
  if (list.some((c) => POST_SEND.has(c))) return idempotent
  const msg = text(err)
  if (PRE_SEND_TEXT.test(msg)) return true
  if (POST_SEND_TEXT.test(msg)) return idempotent
  return false
}

export async function fetchWithTimeout(
  url: string | URL,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? 30000
  const ac = new AbortController()
  const pemanggil = init?.signal
  let kenaTimeout = false
  const saatPemanggilBatal = () => ac.abort(pemanggil?.reason)

  if (pemanggil) {
    if (pemanggil.aborted) throw pemanggil.reason
    pemanggil.addEventListener('abort', saatPemanggilBatal, { once: true })
  }
  const tid = setTimeout(() => {
    kenaTimeout = true
    ac.abort()
  }, timeoutMs)

  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } catch (err: any) {
    throw kenaTimeout ? new FetchTimeoutError(timeoutMs, err) : err
  } finally {
    clearTimeout(tid)
    pemanggil?.removeEventListener('abort', saatPemanggilBatal)
  }
}

export interface FetchRetryOptions {
  attempts?: number
  backoffMs?: number
  /**
   * Status yang diulang ulang. Hanya berlaku untuk metode baca: 502 dari nginx
   * di atas POST /generate bisa berarti job-nya sudah diterima upstream.
   */
  retryStatus?: number[]
  onRetry?: (info: { err?: any; status?: number; attempt: number; delayMs: number }) => void
}

/**
 * fetchWithTimeout + retry untuk gangguan jaringan sesaat.
 *
 * Kenapa perlu: dari VPS, handshake ke upstream kadang butuh 10–15 detik dan
 * undici memotong pada 10 detik → klien melihat "502 fetch failed" padahal
 * upstream sehat. Satu percobaan ulang biasanya langsung lolos.
 *
 * Yang TIDAK dilakukan: mengulang request yang sudah sempat dikirim. Bedanya
 * ada di `isRetryableFetchError`, dan body non-replayable tidak diulang sama
 * sekali — percobaan ulang semacam itu menghasilkan job ganda berbayar.
 */
export async function fetchWithRetry(
  url: string | URL,
  init?: RequestInit & { timeoutMs?: number },
  opts: FetchRetryOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, Math.floor(opts.attempts ?? 3))
  const backoff = Math.max(0, opts.backoffMs ?? 600)
  const method = (init?.method || 'GET').toUpperCase()
  const idempotent = IDEMPOTENT.has(method)
  const retryStatus = opts.retryStatus ?? (idempotent ? [502, 503, 504] : [])
  const bolehUlang = idempotent || replayableBody(init?.body)

  let lastErr: any
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const percobaanTerakhir = attempt >= attempts
    try {
      const res = await fetchWithTimeout(url, init)
      if (percobaanTerakhir || !retryStatus.includes(res.status) || !bolehUlang) return res
      const delay = retryDelayMs(res, backoff * attempt)
      opts.onRetry?.({ status: res.status, attempt, delayMs: delay })
      // Body dibuang supaya socket-nya bisa dipakai lagi oleh percobaan berikut.
      await res.body?.cancel().catch(() => {})
      await new Promise((r) => setTimeout(r, delay))
    } catch (err: any) {
      lastErr = err
      if (percobaanTerakhir || !bolehUlang || !isRetryableFetchError(err, method)) break
      const delay = backoff * attempt
      opts.onRetry?.({ err, attempt, delayMs: delay })
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr
}

/**
 * Budget retry untuk relay provider (Alriz, Seavi).
 *
 * Rute baca (poll status / cek saldo) dipotong ketat: klien polling tiap
 * beberapa detik, jadi menunggu panjang lebih buruk daripada gagal cepat dan
 * dicoba lagi pada tick berikutnya. Rute yang membuat job diberi budget penuh,
 * dengan tetap hanya mengulang kegagalan tahap koneksi.
 */
export async function fetchWithProviderRetry(
  url: string | URL,
  init: RequestInit & { timeoutMs?: number },
  opts: { consuming: boolean; label: string },
): Promise<Response> {
  return fetchWithRetry(
    url,
    { ...init, timeoutMs: init.timeoutMs ?? (opts.consuming ? 30_000 : 20_000) },
    {
      attempts: opts.consuming ? 3 : 2,
      backoffMs: opts.consuming ? 600 : 400,
      onRetry: ({ err, status, attempt, delayMs }) =>
        console.warn(
          `[${opts.label}] percobaan ${attempt} gagal (${err ? describeFetchError(err) : `HTTP ${status}`}) — coba lagi dalam ${delayMs}ms`,
        ),
    },
  )
}

/** Hormati Retry-After upstream (detik) kalau lebih besar dari backoff kami. */
function retryDelayMs(res: Response, fallback: number): number {
  const header = Number(res.headers.get('retry-after'))
  return Number.isFinite(header) && header > 0 ? Math.min(header * 1000, 30_000) : fallback
}

/** Ringkasan error jaringan untuk log: pesan + kode cause, tanpa kredensial. */
export function describeFetchError(err: any): string {
  const list = codes(err)
  const msg = String(err?.message || err)
  return list.length ? `${msg} (cause: ${list.join(' <- ')})` : msg
}
