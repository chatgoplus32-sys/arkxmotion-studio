// ─── Parameter OpenAPI v2 RunningHub ────────────────────────────────────────
//
// Sumber kebenaran: dokumentasi resmi RunningHub OpenAPI v2
//   POST https://www.runninghub.ai/openapi/v2/run/ai-app/{appId}
//   POST https://www.runninghub.ai/openapi/v2/query
//   POST https://www.runninghub.ai/openapi/v2/media/upload/binary
//
// Body run (dokumentasi):
//   nodeInfoList   List   wajib   daftar pemetaan parameter node
//   instanceType   String opsional default (24G VRAM) | plus (48G) | ultra (84G)
//   usePersonalQueue Boolean opsional antrean eksklusif pribadi
//   retainSeconds  Integer opsional  retensi instans 10-180 detik
//                             (hanya Kunci API Enterprise Bersama; biaya tambahan)
//   webhookUrl     String opsional  callback POST saat task selesai
//
// Modul ini sengaja terpisah dari route supaya SEMUA handler run memakai
// bentuk body yang sama — dulu tiap handler menulis sendiri
// `{ nodeInfoList, instanceType: 'default', usePersonalQueue: 'false' }`, dan
// `usePersonalQueue` dikirim sebagai STRING padahal dokumentasi menyebutnya
// Boolean.

export type RhInstanceType = 'default' | 'plus' | 'ultra'

export const RH_INSTANCE_TYPES: readonly RhInstanceType[] = ['default', 'plus', 'ultra'] as const

/** VRAM tiap kelas instance (dipakai untuk label di UI). */
export const RH_INSTANCE_VRAM: Record<RhInstanceType, string> = {
  default: '24G',
  plus: '48G',
  ultra: '84G',
}

/** Rentang resmi `retainSeconds` (detik). */
export const RH_RETAIN_SECONDS_MIN = 10
export const RH_RETAIN_SECONDS_MAX = 180

/** Panjang maksimum `webhookUrl` yang diterima server. */
const RH_WEBHOOK_URL_MAX = 500

/**
 * instanceType → kelas GPU. Nilai di luar daftar diabaikan (fallback),
 * jadi request client tidak bisa Asking RunningHub memakai tipe tak dikenal.
 */
export function normalizeRhInstanceType(raw: unknown, fallback: RhInstanceType = 'default'): RhInstanceType {
  const v = String(raw ?? '').trim().toLowerCase()
  return (RH_INSTANCE_TYPES as readonly string[]).includes(v) ? (v as RhInstanceType) : fallback
}

/** `usePersonalQueue` harus boolean; terima juga "true"/"1" dari form/JSON lama. */
export function normalizeRhUsePersonalQueue(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  const v = String(raw ?? '').trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true
  return false
}

/**
 * `retainSeconds` (detik) — hanya berlaku untuk Kunci API Enterprise Bersama.
 * Nilai di luar 10-180 dijepit ke rentang resmi; input tidak valid dibuang.
 */
export function normalizeRhRetainSeconds(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) return undefined
  return Math.min(RH_RETAIN_SECONDS_MAX, Math.max(RH_RETAIN_SECONDS_MIN, Math.round(n)))
}

/**
 * `webhookUrl` callback — hanya http/https yang boleh. Nilai dikembalikan
 * dalam bentuk URL ternormalisasi (tanpa hash fragment).
 */
export function normalizeRhWebhookUrl(raw: unknown): string | undefined {
  const v = String(raw ?? '').trim()
  if (!v || v.length > RH_WEBHOOK_URL_MAX) return undefined
  let parsed: URL
  try {
    parsed = new URL(v)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  parsed.hash = ''
  return parsed.toString()
}

export interface RhRunOptions {
  /** Kelas GPU: 24G (default), 48G (plus), 84G (ultra). */
  instanceType: RhInstanceType
  /** Antrean eksklusif pribadi. */
  usePersonalQueue: boolean
  /** Retensi instans 10-180 detik (Enterprise Shared). */
  retainSeconds?: number
  /** Callback POST saat task selesai. */
  webhookUrl?: string
}

/**
 * Ambil opsi run dari params request. `overrides` dipakai server untuk
 * memaksa nilai (mis. handler motion app yang memilih instance berdasarkan
 * durasi video referensi).
 */
export function rhRunOptions(params: any, overrides: Partial<RhRunOptions> = {}): RhRunOptions {
  const src = params ?? {}
  const opts: RhRunOptions = {
    instanceType: normalizeRhInstanceType(overrides.instanceType ?? src.instanceType, 'default'),
    usePersonalQueue: normalizeRhUsePersonalQueue(overrides.usePersonalQueue ?? src.usePersonalQueue),
  }
  const retain = normalizeRhRetainSeconds(overrides.retainSeconds ?? src.retainSeconds)
  if (retain !== undefined) opts.retainSeconds = retain
  const hook = normalizeRhWebhookUrl(overrides.webhookUrl ?? src.webhookUrl)
  if (hook) opts.webhookUrl = hook
  return opts
}

/**
 * Body request `POST /openapi/v2/run/ai-app/{appId}` sesuai dokumentasi.
 * Field opsional yang tidak dipakai TIDAK ikut dikirim (RunningHub menolak
 * body yang memuat retainSeconds di luar 10-180).
 */
export function rhBuildRunBody(input: { nodeInfoList: any[] } & Partial<RhRunOptions>): Record<string, any> {
  const body: Record<string, any> = {
    nodeInfoList: input.nodeInfoList,
    instanceType: normalizeRhInstanceType(input.instanceType, 'default'),
    usePersonalQueue: normalizeRhUsePersonalQueue(input.usePersonalQueue),
  }
  const retain = normalizeRhRetainSeconds(input.retainSeconds)
  if (retain !== undefined) body.retainSeconds = retain
  const hook = normalizeRhWebhookUrl(input.webhookUrl)
  if (hook) body.webhookUrl = hook
  return body
}

/**
 * Bangun URL callback webhook milik server sendiri.
 * Base URL: env `RUNNINGHUB_WEBHOOK_BASE_URL`, lalu `APP_URL`, lalu host
 * request. Secret selalu berupa query param `token` supaya tidak bocor ke
 * header yang di-log upstream.
 */
export function rhWebhookCallbackUrl(baseUrl: string | undefined, secret: string): string | undefined {
  if (!secret) return undefined
  const base = String(baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!base) return undefined
  return `${base}/api/public/runninghub/webhook?token=${encodeURIComponent(secret)}`
}
