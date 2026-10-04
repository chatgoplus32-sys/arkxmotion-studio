// ─── Klien wallet Seavi ─────────────────────────────────────────────────────
// Saldo TOKEN per user (1 token = Rp 2.000). Generate memotong N token sesuai
// bobot model; paket token dibeli di halaman /topup/seavi dan dikredit admin.
// Semua angka otoritatif datang dari server lewat /api/seavi/*.
//
// Dipakai halaman /topup/seavi dan alur generate (Image to Video, Edit Image,
// Video Upscaler).
const API = '/api/seavi'

/** Satu paket token (harga & isi efektif versi server). */
export interface SeaviPackage {
  slug: string
  label: string
  price: number
  tokens: number
}

/**
 * Cermin katalog shared/pricing.ts untuk keadaan darurat: dipakai kalau
 * /balance belum sempat dijawab server. Angka di sini hanya tampilan —
 * yang benar-benar ditagih selalu harga dari server.
 */
export const SEAVI_PACKAGE_FALLBACKS: SeaviPackage[] = [
  { slug: 'seavi_2', label: '2 Token', price: 4000, tokens: 2 },
  { slug: 'seavi_3', label: '3 Token', price: 6000, tokens: 3 },
  { slug: 'seavi_4', label: '4 Token', price: 8000, tokens: 4 },
  { slug: 'seavi_5', label: '5 Token', price: 10000, tokens: 5 },
  { slug: 'seavi_10', label: '10 Token', price: 20000, tokens: 10 },
  { slug: 'seavi_25', label: '25 Token', price: 50000, tokens: 25 },
  { slug: 'seavi_50', label: '50 Token', price: 100000, tokens: 50 },
]

export interface SeaviWallet {
  /** Saldo token user. */
  balance: number
  /** Sama dengan balance (alias agar enak dibaca di UI). */
  tokens: number
  min_topup: number
  token_price: number
  packages: SeaviPackage[]
}

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

/** Ambil saldo token + katalog paket. Null kalau request gagal. */
export async function fetchSeaviWallet(token: string): Promise<SeaviWallet | null> {
  try {
    const res = await fetch(`${API}/balance`, { headers: authHeaders(token) })
    if (!res.ok) return null
    const data = await res.json()
    const packages: SeaviPackage[] = Array.isArray(data.packages) && data.packages.length > 0
      ? data.packages
      : SEAVI_PACKAGE_FALLBACKS
    const balance = data.tokens ?? data.balance ?? 0
    return {
      balance,
      tokens: balance,
      min_topup: data.min_topup ?? 4000,
      token_price: data.token_price ?? 2000,
      packages,
    }
  } catch {
    return null
  }
}

export interface SeaviCharge {
  /** Sisa token setelah dipotong. */
  balance: number
  tokens: number
  /** Token yang dipotong generate ini. */
  deducted: number
  batchId: string
}

/**
 * Potong token untuk satu aksi generate. `quantity` = jumlah generate
 * (mis. Motion Control multi-slot). batchId dibuat di sini supaya refund
 * bisa dicari walau submit upstream belum sempat jalan. Throw kalau token
 * tidak cukup.
 */
export async function chargeSeaviWallet(
  token: string,
  model?: string,
  quantity = 1,
  batchId?: string,
): Promise<SeaviCharge> {
  const batch = batchId || `seavi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const res = await fetch(`${API}/deduct`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ model: model || '', quantity, batch_id: batch }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Gagal memotong token Seavi')
  const balance = data.tokens ?? data.balance ?? 0
  return { balance, tokens: balance, deducted: data.deducted ?? 0, batchId: batch }
}

/** Kembalikan token saat generate gagal. Return sisa token baru, atau null kalau gagal. */
export async function refundSeaviWallet(
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
    return data.tokens ?? data.balance ?? null
  } catch {
    return null
  }
}
