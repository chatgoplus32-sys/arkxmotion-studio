/**
 * Kebijakan retry NexaBot — dipisah dari nexabot.ts supaya bisa diuji tanpa
 * DOM/fetch (lihat test/nexabotRetry.test.ts).
 *
 * Upstream nexabot.id memang dua-duanya sering terjadi:
 *  - MENGGANTUNG >20s saat cek saldo/sesi/job, sehingga proxy kita menjawab 504
 *    padahal job-nya masih `queued` di sana — job yang sudah di-submit tidak
 *    boleh dibuang hanya karena satu poll meleset;
 *  - membalas 429 `Rate limit` saat beberapa key/sesi dipakai bersamaan (poll
 *    status tiap 3 detik + probe saldo/sesi ikut menembak akun yang sama).
 *
 * Semua status di sini TRANSIENT: layak dicoba ulang dengan jeda, bukan
 * kesalahan permintaan kita.
 */

/** Status HTTP yang layak dicoba ulang. */
export const NEXABOT_TRANSIENT_STATUSES: readonly number[] = [408, 425, 429, 500, 502, 503, 504, 522, 524]

export function isNexabotTransientStatus(status: number): boolean {
  return NEXABOT_TRANSIENT_STATUSES.includes(status)
}

export type NexabotHttpVerdict = 'ok' | 'retry' | 'fatal'

/**
 * Arti status HTTP untuk klien NexaBot:
 *  - `ok`    : < 400, lanjut baca body;
 *  - `retry` : transient (rate limit / gateway / timeout proxy) → tunggu lalu ulangi;
 *  - `fatal` : 4xx lain (401/403 sesi mati, 402 kredit habis, 404 job hilang).
 */
export function nexabotHttpVerdict(status: number): NexabotHttpVerdict {
  if (status < 400) return 'ok'
  return isNexabotTransientStatus(status) ? 'retry' : 'fatal'
}

/** Pesan singkat sesuai status, untuk log panel & toast. */
export function describeNexabotStatus(status: number): string {
  if (status === 429) return 'NexaBot membatasi permintaan (rate limit)'
  if (status === 408 || status === 425) return `Permintaan ke NexaBot timeout (HTTP ${status})`
  if (status === 504 || status === 522 || status === 524) return 'Server NexaBot tidak merespons (timeout gateway)'
  if (status >= 500) return `Server NexaBot sedang bermasalah (HTTP ${status})`
  if (status === 401 || status === 403) return 'Akses NexaBot ditolak (sesi/key tidak valid)'
  if (status === 402) return 'Kredit NexaBot tidak cukup'
  if (status === 404) return 'Job NexaBot tidak ditemukan (HTTP 404)'
  return `NexaBot HTTP ${status}`
}

/**
 * `Retry-After` boleh berupa jumlah detik ("30") atau tanggal HTTP. Mengembalikan
 * null kalau header tidak ada / tidak bisa dibaca.
 */
export function parseRetryAfterMs(header: string | null | undefined, nowMs: number = Date.now()): number | null {
  const raw = String(header ?? '').trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return Math.max(0, Number(raw) * 1000)
  const at = Date.parse(raw)
  if (!Number.isFinite(at)) return null
  return Math.max(0, at - nowMs)
}

export interface NexabotBackoffOptions {
  /** Jeda percobaan pertama; default 3000ms (sama dengan interval poll lama). */
  baseMs?: number
  /** Batas jeda; default 15000ms. */
  maxMs?: number
  /** Faktor pertumbuhan tiap percobaan; default 1.5. */
  factor?: number
  /** Bagian jeda yang diacak (anti thundering herd); default 0.25. */
  jitter?: number
  /** Sumber acak — disuntik di test supaya hasilnya bisa diprediksi. */
  random?: () => number
}

/** Jeda sebelum percobaan berikutnya; `attempt` 1 = kegagalan pertama. */
export function nexabotBackoffMs(attempt: number, opts: NexabotBackoffOptions = {}): number {
  const { baseMs = 3000, maxMs = 15000, factor = 1.5, jitter = 0.25, random = Math.random } = opts
  const step = Math.max(0, Math.floor(attempt) - 1)
  const raw = Math.min(maxMs, baseMs * Math.pow(factor, step))
  const spread = raw * Math.min(1, Math.max(0, jitter))
  const value = raw + (random() * 2 - 1) * spread
  return Math.max(0, Math.round(Math.min(maxMs, value)))
}

/**
 * Jeda sebelum percobaan berikutnya: pakai `Retry-After` dari upstream kalau ada
 * (server yang minta kita menunggu lebih tahu), kalau tidak pakai backoff
 * eksponensial. Selalu dibatasi supaya job tidak menunggu tanpa batas.
 */
export function nexabotRetryDelayMs(params: {
  attempt: number
  retryAfterHeader?: string | null
  opts?: NexabotBackoffOptions & { maxRetryAfterMs?: number }
  nowMs?: number
}): number {
  const { attempt, retryAfterHeader, opts = {}, nowMs = Date.now() } = params
  const maxMs = opts.maxMs ?? 15000
  const hinted = parseRetryAfterMs(retryAfterHeader, nowMs)
  if (hinted != null) {
    const cap = opts.maxRetryAfterMs ?? Math.max(maxMs, 30_000)
    return Math.min(cap, hinted)
  }
  return nexabotBackoffMs(attempt, opts)
}
