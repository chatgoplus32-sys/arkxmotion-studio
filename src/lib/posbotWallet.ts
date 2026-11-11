// ─── Klien wallet PosBot ────────────────────────────────────────────────────
// Saldo RUPIAH per user. Generate memotong tarif developer per model (lihat
// shared/pricing.ts getPosbotCharge); top up lewat permintaan yang disetujui
// admin. Sistemnya sama dengan Seavi — relay memasang kunci server dengan
// tiket pembayaran dari /deduct — bedanya satuan: PosBot Rupiah, Seavi token.
//
// Dipakai halaman /topup/posbot dan alur generate (Image to Video, Motion,
// Upscaler).
const API = '/api/posbot'

/** Nominal cepat yang ditampilkan sebagai tombol preset di halaman top up. */
export interface PosbotWallet {
  /** Saldo Rupiah user. */
  balance: number
  min_topup: number
  max_topup: number
  presets: number[]
  /**
   * Boleh tidaknya memakai kunci server PosBot tanpa API key sendiri.
   * Dihitung server (top up / admin); UI hanya menampilkan apa adanya.
   */
  server_key?: { available: boolean; reason?: string }
}

/** Cermin preset shared/pricing.ts untuk keadaan darurat (/balance gagal jawab). */
export const POSBOT_PRESET_FALLBACKS: number[] = [25000, 50000, 100000, 250000, 500000, 1000000]

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

/** Ambil saldo Rupiah + preset. Null kalau request gagal. */
export async function fetchPosbotWallet(token: string): Promise<PosbotWallet | null> {
  try {
    const res = await fetch(`${API}/balance`, { headers: authHeaders(token) })
    if (!res.ok) return null
    const data = await res.json()
    const presets: number[] = Array.isArray(data.presets) && data.presets.length > 0
      ? data.presets
      : POSBOT_PRESET_FALLBACKS
    return {
      balance: Number(data.balance) || 0,
      min_topup: data.min_topup ?? 10000,
      max_topup: data.max_topup ?? 5000000,
      presets,
      server_key: data.server_key && typeof data.server_key === 'object'
        ? { available: !!data.server_key.available, reason: data.server_key.reason }
        : undefined,
    }
  } catch {
    return null
  }
}

export interface PosbotCharge {
  /** Sisa saldo Rupiah setelah dipotong. */
  balance: number
  /** Rupiah yang dipotong generate ini. */
  deducted: number
  batchId: string
  /** usage_id server — tiket yang dikirim ke relay pada jalur kunci server. */
  usageId?: number
}

/**
 * Potong saldo untuk satu aksi generate. `quantity` = jumlah generate
 * (mis. Motion Control multi-slot). batchId dibuat di sini supaya refund
 * bisa dicari walau submit upstream belum sempat jalan. Throw kalau saldo
 * tidak cukup.
 */
export async function chargePosbotWallet(
  token: string,
  model?: string,
  quantity = 1,
  batchId?: string,
): Promise<PosbotCharge> {
  const batch = batchId || `posbot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const res = await fetch(`${API}/deduct`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ model: model || '', quantity, batch_id: batch }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Gagal memotong saldo PosBot')
  return {
    balance: Number(data.balance) || 0,
    deducted: data.deducted ?? 0,
    batchId: batch,
    usageId: typeof data.usage_id === 'number' && data.usage_id > 0 ? data.usage_id : undefined,
  }
}

/** Kembalikan saldo saat generate gagal. Return sisa Rupiah baru, atau null kalau gagal. */
export async function refundPosbotWallet(
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
    return typeof data.balance === 'number' ? data.balance : null
  } catch {
    return null
  }
}

/**
 * Apakah alur generate boleh menawarkan jalur kunci server PosBot. Sama seperti
 * Seavi: hanya kalau relay bilang layak (member sudah top up / admin) dan member
 * tidak membawa API key sendiri.
 */
export function posbotPreferServerKey(wallet: PosbotWallet | null | undefined, hasOwnKey: boolean): boolean {
  if (hasOwnKey) return false
  return !!wallet?.server_key?.available
}
