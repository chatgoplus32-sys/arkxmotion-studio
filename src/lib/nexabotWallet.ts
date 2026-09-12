// ─── Klien wallet NexaBot ───────────────────────────────────────────────────
// Saldo Rp per user (potong Rp 250/generate) + Paket Unlimited 1 minggu
// (Rp 35.000). Semua angka otoritatif datang dari server lewat
// /api/nexabot/*, jadi kalau harga berubah di server UI ikut sendiri.
//
// Dipakai halaman /topup/nexabot dan alur generate (Image to Video).
const API = '/api/nexabot'

export interface NexabotUnlimited {
  active: boolean
  expires_at: string | null
  days_left: number
  package_id?: number | null
}

export interface NexabotWallet {
  balance: number
  /** Harga per generate (Rp) versi server. */
  price: number
  min_topup: number
  unlimited: NexabotUnlimited
  package: { slug: string; price: number; days: number }
}

export interface NexabotCharge {
  balance: number
  /** 0 kalau paket Unlimited sedang aktif. */
  deducted: number
  usageId: number | null
  unlimited: boolean
  expiresAt: string | null
}

const EMPTY_UNLIMITED: NexabotUnlimited = { active: false, expires_at: null, days_left: 0, package_id: null }

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

/** Ambil saldo + status paket. Null kalau request gagal (UI cukup pakai fallback). */
export async function fetchNexabotWallet(token: string): Promise<NexabotWallet | null> {
  try {
    const res = await fetch(`${API}/balance`, { headers: authHeaders(token) })
    if (!res.ok) return null
    const data = await res.json()
    return {
      balance: data.balance || 0,
      price: data.price ?? 250,
      min_topup: data.min_topup ?? 10000,
      unlimited: data.unlimited || EMPTY_UNLIMITED,
      package: data.package || { slug: 'unlimited_weekly', price: 35000, days: 7 },
    }
  } catch {
    return null
  }
}

/**
 * Potong saldo untuk satu generate. Server membebaskan biaya kalau paket
 * Unlimited aktif (returned `deducted: 0`), jadi alur generate tidak perlu
 * tahu detail paketnya. Throw kalau saldo tidak cukup.
 */
export async function chargeNexabotWallet(token: string, model?: string, batchId?: string): Promise<NexabotCharge> {
  const res = await fetch(`${API}/deduct`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ model: model || '', batch_id: batchId || '' }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Gagal memotong saldo NexaBot')
  return {
    balance: data.balance ?? 0,
    deducted: data.deducted ?? 0,
    usageId: data.usage_id ?? null,
    unlimited: !!data.unlimited,
    expiresAt: data.expires_at ?? null,
  }
}

/** Kembalikan saldo saat generate gagal. Return saldo baru, atau null kalau gagal. */
export async function refundNexabotWallet(token: string, usageId: number): Promise<number | null> {
  try {
    const res = await fetch(`${API}/refund`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ usage_id: usageId }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.balance ?? null
  } catch {
    return null
  }
}
