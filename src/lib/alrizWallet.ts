// ─── Klien wallet Alriz ─────────────────────────────────────────────────────
// Saldo Rp per user (mirip CreatePulse/NexaBot): top up Rp 5.000–100.000 di
// halaman /topup/alriz, approve admin kredit 1:1. Generate Motion Control
// memotong harga model per video lewat /deduct dan mengembalikan lewat /refund
// kalau job upstream gagal. Semua angka otoritatif datang dari server lewat
// /api/alriz/*.
const API = '/api/alriz'

/**
 * Cermin konstanta shared/pricing.ts untuk keadaan darurat: dipakai kalau
 * /balance belum sempat dijawab server. Angka di sini hanya tampilan —
 * yang benar-benar dipotong selalu harga dari server.
 */
export const ALRIZ_NOMINALS_FALLBACK = [5000, 10000, 15000, 20000, 25000, 50000, 100000]
export const ALRIZ_MIN_TOPUP_FALLBACK = 5000
export const ALRIZ_MAX_TOPUP_FALLBACK = 100000

export interface AlrizWallet {
  /** Saldo Rp user. */
  balance: number
  min_topup: number
  max_topup: number
  /** Nominal preset (Rp). */
  nominals: number[]
  /** Harga model per video (Rp) — id model → harga. */
  models: Record<string, number>
}

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

/** Ambil saldo Rp + batas top up + harga model. Null kalau request gagal. */
export async function fetchAlrizWallet(token: string): Promise<AlrizWallet | null> {
  try {
    const res = await fetch(`${API}/balance`, { headers: authHeaders(token) })
    if (!res.ok) return null
    const data = await res.json()
    const nominals: number[] = Array.isArray(data.nominals) && data.nominals.length > 0
      ? data.nominals
      : ALRIZ_NOMINALS_FALLBACK
    return {
      balance: data.balance ?? 0,
      min_topup: data.min_topup ?? ALRIZ_MIN_TOPUP_FALLBACK,
      max_topup: data.max_topup ?? ALRIZ_MAX_TOPUP_FALLBACK,
      nominals,
      models: data.models && typeof data.models === 'object' ? data.models : {},
    }
  } catch {
    return null
  }
}

export interface AlrizCharge {
  /** Sisa saldo setelah dipotong. */
  balance: number
  /** Rupiah yang dipotong generate ini. */
  deducted: number
  batchId: string
}

/**
 * Potong saldo untuk satu aksi generate. `quantity` = jumlah video (mis.
 * Motion Control multi-slot). batchId dibuat di sini supaya refund bisa
 * dicari walau submit upstream belum sempat jalan. Throw kalau saldo kurang.
 */
export async function chargeAlrizWallet(
  token: string,
  model?: string,
  quantity = 1,
  batchId?: string,
): Promise<AlrizCharge> {
  const batch = batchId || `alriz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const res = await fetch(`${API}/deduct`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ model: model || '', quantity, batch_id: batch }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Gagal memotong saldo Alriz')
  return { balance: data.balance ?? 0, deducted: data.deducted ?? 0, batchId: batch }
}

/** Kembalikan saldo saat generate gagal. Return sisa saldo baru, atau null kalau gagal. */
export async function refundAlrizWallet(
  token: string,
  opts: { batch_id?: string; model?: string },
): Promise<number | null> {
  try {
    const res = await fetch(`${API}/refund`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(opts.batch_id ? { batch_id: opts.batch_id } : { model: opts.model || '' }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.balance ?? null
  } catch {
    return null
  }
}
