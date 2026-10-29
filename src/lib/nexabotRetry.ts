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

/**
 * Anggaran retry untuk SUBMIT.
 *
 * Angka lama (3 percobaan, jeda 2s → total ±5 detik) dibuat saat 429 dianggap
 * kejadian sesekali. Ternyata 429 muncul karena beberapa member memakai satu
 * akun NexaBot bersamaan, dan itu berlangsung puluhan detik — jadi submit yang
 * sedang mengantre di relay (server menahan slot antrean sampai 45 detik) harus
 * ditemui klien dengan kesabaran, bukan dengan error merah.
 *
 * relay sudah mencegah job ganda (satu slot = satu percobaan), dan 429 selalu
 * berarti "belum ada job", jadi mengulang tetap aman untuk kredit.
 */
export const NEXABOT_SUBMIT_RETRY = {
  attempts: 4,
  baseMs: 2_000,
  maxMs: 20_000,
  /**
   * Batas total waktu yang boleh dihabiskan klien untuk submit yang masih
   * mengantre. Melewati ini user disuruh mencoba lagi, bukan ditahan selamanya.
   */
  budgetMs: 180_000,
  /**
   * Anggaran untuk 429 dari ANTREAN relay (`queued: true`), yang berarti akun
   * NexaBot masih mengerjakan job member lain. Akun Unlimited hanya menjalankan
   * SATU job, jadi member ke-10 bisa menunggu belasan menit — untuk antrean ini
   * jumlah percobaan TIDAK dipakai sebagai batas, hanya anggaran waktu ini.
   */
  queueBudgetMs: 30 * 60_000,
}

export interface NexabotRetryDecision {
  /** true = tunggu `delayMs` lalu coba lagi; false = menyerah. */
  ulang: boolean
  delayMs: number
  /** Alasan singkat untuk log/toast saat masih mencoba. */
  message: string
  /** Pesan final saat `ulang: false`. */
  akhir?: string
}

/**
 * Putuskan apa yang dilakukan submit setelah dapat 429.
 *
 * `antrianSendiri` = 429 berasal dari antrean relay kita (body `queued: true`),
 * bukan dari NexaBot. Bedanya penting untuk teks yang dilihat user: yang pertama
 * berarti "giliran member lain sedang jalan", yang kedua berarti akunnya yang
 * dibatasi — dan keduanya tetap aman diulang.
 *
 * Untuk `antrianSendiri`, `attempts` sengaja DIABAIKAN: selama lane masih sibuk,
 * setiap percobaan berakhir 429 yang sama, jadi batas percobaan hanya akan
 * membuat member menyerah padahal tinggal menunggu giliran. Yang membatasi
 * hanya anggaran waktu (`sisaQueueBudgetMs`).
 */
export function nexabotSubmit429Decision(params: {
  attempt: number
  attempts: number
  retryAfterHeader?: string | null
  antrianSendiri?: boolean
  /** Sisa anggaran waktu klien (ms) sejak submit dimulai — untuk 429 upstream. */
  sisaBudgetMs: number
  /** Sisa anggaran antrean (ms) — dipakai saat `antrianSendiri`. */
  sisaQueueBudgetMs?: number
  /** Sudah berapa lama klien menunggu untuk submit ini (ms) — dipakai di pesan akhir. */
  sudahMenungguMs?: number
  opts?: NexabotBackoffOptions & { maxRetryAfterMs?: number }
  nowMs?: number
}): NexabotRetryDecision {
  const {
    attempt, attempts, retryAfterHeader, antrianSendiri = false,
    sisaBudgetMs, sisaQueueBudgetMs, sudahMenungguMs = 0, opts = {}, nowMs = Date.now(),
  } = params
  const message = antrianSendiri
    ? 'antrean generate penuh — member lain sedang jalan'
    : describeNexabotStatus(429)
  const hint = parseRetryAfterMs(retryAfterHeader, nowMs)
  const delayMs = nexabotRetryDelayMs({ attempt, retryAfterHeader, opts, nowMs })
  const habisPercobaan = !antrianSendiri && attempt >= attempts
  const sisa = antrianSendiri ? (sisaQueueBudgetMs ?? sisaBudgetMs) : sisaBudgetMs
  // Menunggu lebih lama dari sisa anggaran hanya membuat user melihat spinner
  // palsu; lebih baik berhenti sekarang dengan alasan yang jelas.
  const tidakSempat = delayMs > Math.max(0, sisa)

  if (!tidakSempat && !habisPercobaan) return { ulang: true, delayMs, message }

  const sudahMenunggu = Math.round(sudahMenungguMs / 1000)
  const anjuran = hint != null
    ? ` — coba lagi dalam ${Math.max(1, Math.round(hint / 1000))} detik`
    : ' — tunggu sebentar lalu coba lagi'
  return {
    ulang: false,
    delayMs,
    message,
    akhir: antrianSendiri
      ? `NexaBot: antrean generate masih penuh setelah ±${Math.round(sudahMenunggu / 60)} menit menunggu — saldo tidak terpotong, coba lagi nanti`
      : `NexaBot: ${message}${sudahMenunggu ? ` (sudah menunggu ±${sudahMenunggu}s)` : ''}${anjuran}`,
  }
}
