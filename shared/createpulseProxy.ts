// ─── Kebijakan proxy CreatePulse (dipakai bersama Express & Vercel) ─────────
//
// Kenapa modul ini ada: submit Veo Omni pernah dijawab **502 dalam ~2 detik**
// dan yang terlihat di UI hanya "Submit failed: HTTP 502 — unknown". Dua detik
// jauh di bawah anggaran timeout kita, jadi penyebabnya ada di sisi
// createpulse.online — tapi proxy kita membaca body upstream dengan
// `json().catch(() => ({}))`, sehingga halaman error gateway mereka (bukan JSON)
// hilang tanpa jejak dan pesan "unknown" menutupi asalnya.
//
// Yang dikunci di sini:
//   1. Body upstream TIDAK pernah dibuang. Yang bukan JSON, atau yang tidak
//      memuat pesan yang bisa dibaca klien, dipotong/dibungkus jadi pesan error
//      (`upstreamBodySnippet` / `parseUpstreamBody`).
//   2. Hanya aksi read-only yang boleh diulang. `generate` TIDAK: kalau upstream
//      sebenarnya sudah menerima job lalu gateway-nya yang gagal, mengulang
//      berarti dua job dan dua kali potong kredit pengguna. Alasannya sama
//      dengan `isNexabotNonIdempotentAction` di shared/nexabotProxy.ts.
//
// Logikanya murni (tanpa I/O) supaya bisa diuji tanpa server —
// lihat test/createpulseProxy.test.ts.

export type CreatepulseProxyAction = 'generate' | 'status' | 'download'

export interface CreatepulseProxyPolicy {
  timeoutMs: number
  attempts: number
  label: string
}

export const CREATEPULSE_PROXY_POLICY: Record<CreatepulseProxyAction, CreatepulseProxyPolicy> = {
  // Submit: satu percobaan. 30s adalah anggaran yang juga dipakai fungsi Vercel
  // (maxDuration di vercel.json), jadi memperpanjang di sini tidak akan pernah
  // sempat selesai di produksi.
  generate: { timeoutMs: 30_000, attempts: 1, label: 'submit' },
  // Cek status: read-only, jadi boleh diulang. 20s × 2 masih jauh di bawah jeda
  // poll klien (4 detik per poll, sampai 300 poll), dan satu percobaan kedua
  // menyelamatkan poll yang kebetulan kena blip gateway.
  status: { timeoutMs: 20_000, attempts: 2, label: 'cek status' },
  download: { timeoutMs: 30_000, attempts: 1, label: 'unduh' },
}

export const CREATEPULSE_PROXY_RETRY = {
  baseMs: 1_500,
  maxMs: 5_000,
  maxRetryAfterMs: 10_000,
  jitter: 0.25,
}

export function isCreatepulseNonIdempotentAction(action: CreatepulseProxyAction): boolean {
  return action === 'generate'
}

/** Percobaan yang benar-benar dipakai: aksi non-idempoten tidak pernah diulang. */
export function createpulseAttempts(action: CreatepulseProxyAction): number {
  return isCreatepulseNonIdempotentAction(action) ? 1 : CREATEPULSE_PROXY_POLICY[action].attempts
}

/** Status yang pantas diulang: rate limit / timeout upstream dan 5xx gateway. */
export function isCreatepulseProxyTransientStatus(status: number): boolean {
  return status === 429 || status === 408 || status === 425 || status >= 500
}

/** `Retry-After` dalam ms (detik atau tanggal HTTP); null kalau tidak terbaca. */
export function parseCreatepulseRetryAfterMs(header: string | null | undefined, nowMs: number = Date.now()): number | null {
  const raw = String(header ?? '').trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return Math.max(0, Number(raw) * 1000)
  const at = Date.parse(raw)
  if (!Number.isFinite(at)) return null
  return Math.max(0, at - nowMs)
}

/**
 * Jeda sebelum percobaan berikutnya. `Retry-After` menang atas backoff, tapi
 * tetap dibatasi `maxRetryAfterMs` supaya permintaan tidak ikut menggantung
 * hanya karena upstream meminta menunggu sejam.
 */
export function createpulseProxyDelayMs(params: {
  attempt: number
  retryAfterHeader?: string | null
  random?: () => number
  nowMs?: number
}): number {
  const { attempt, retryAfterHeader, random = Math.random, nowMs = Date.now() } = params
  const retryAfter = parseCreatepulseRetryAfterMs(retryAfterHeader, nowMs)
  const backoff = Math.min(
    CREATEPULSE_PROXY_RETRY.baseMs * Math.pow(2, Math.max(0, attempt - 1)),
    CREATEPULSE_PROXY_RETRY.maxMs,
  )
  const dasar = retryAfter != null
    ? Math.max(backoff, Math.min(retryAfter, CREATEPULSE_PROXY_RETRY.maxRetryAfterMs))
    : backoff
  const jitter = dasar * CREATEPULSE_PROXY_RETRY.jitter * (random() * 2 - 1)
  return Math.max(0, Math.round(dasar + jitter))
}

/**
 * Potongan body upstream yang aman ditampilkan: tag HTML dan script dibuang,
 * entitas dasar dibuka, spasi dirapikan, lalu dipotong. Halaman error gateway
 * biasanya HTML panjang, dan justru baris pertamanya yang berguna
 * ("502 Bad Gateway").
 */
export function upstreamBodySnippet(raw: string, maxLength = 200): string {
  const rapi = String(raw || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
  if (!rapi) return '(body kosong)'
  return rapi.length > maxLength ? `${rapi.slice(0, maxLength)}…` : rapi
}

/**
 * Body upstream → objek yang selalu bisa dikirim ke klien.
 *
 * Klien hanya membaca `error` (dan `ok`), jadi body yang tidak menyediakan
 * keduanya sama saja dengan "unknown" — dan itulah yang dulu terjadi. Aturannya:
 *
 *   - ada `error` → diteruskan apa adanya (kontraknya sudah benar);
 *   - status < 400 dan body memuat isi sukses (`ok:true` / `batchId` / `status`)
 *     → diteruskan apa adanya;
 *   - sisanya (5xx gateway dengan halaman HTML, JSON tanpa `error`, body kosong,
 *     atau 200 tanpa isi) → dibungkus `{ ok:false, error }` yang menyebut status,
 *     content-type, dan isi body-nya, sambil mempertahankan field lain
 *     (`message`/`detail` dipakai sebagai pesan kalau ada).
 */
export function parseUpstreamBody(raw: string, status: number, contentType: string | null = null): Record<string, any> {
  const text = String(raw || '')
  const detail = contentType ? ` (${contentType})` : ''

  if (text.trim()) {
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const body = parsed as Record<string, any>
        if (typeof body.error === 'string' && body.error) return body
        const isiSukses = body.ok === true || body.batchId || body.status
        if (status < 400 && isiSukses) return body
        const pesan = typeof body.message === 'string' && body.message
          ? body.message
          : typeof body.detail === 'string' && body.detail
            ? body.detail
            : upstreamBodySnippet(text)
        return { ...body, ok: false, error: `createpulse.online HTTP ${status}${detail}: ${pesan}` }
      }
    } catch { /* bukan JSON — jatuh ke bawah */ }
  }

  return {
    ok: false,
    error: `createpulse.online HTTP ${status}${detail}: ${upstreamBodySnippet(text)}`,
  }
}
