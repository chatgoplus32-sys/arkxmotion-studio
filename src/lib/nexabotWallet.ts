// ─── Klien wallet NexaBot ───────────────────────────────────────────────────
// Saldo Rp per user (potong Rp 250/generate) + Paket Unlimited dengan beberapa
// varian (Mingguan/Bulanan/Tahunan). Semua angka otoritatif datang dari server
// lewat /api/nexabot/*, jadi kalau admin mengubah harga, UI ikut sendiri.
//
// Dipakai halaman /topup/nexabot dan alur generate (Image to Video).
const API = '/api/nexabot'

export interface NexabotUnlimited {
  active: boolean
  expires_at: string | null
  days_left: number
  package_id?: number | null
}

/** Satu varian Paket Unlimited (harga & durasi efektif versi server). */
export interface NexabotPackage {
  slug: string
  label: string
  price: number
  days: number
}

/**
 * Cermin katalog shared/pricing.ts untuk keadaan darurat: dipakai kalau
 * /balance belum sempat dijawab server. Angka di sini hanya tampilan —
 * yang benar-benar ditagih selalu harga dari server.
 */
export const NEXABOT_PACKAGE_FALLBACKS: NexabotPackage[] = [
  { slug: 'unlimited_weekly', label: 'Mingguan', price: 35000, days: 7 },
  { slug: 'unlimited_monthly', label: 'Bulanan', price: 119000, days: 30 },
  { slug: 'unlimited_yearly', label: 'Tahunan', price: 899000, days: 365 },
]

export interface NexabotWallet {
  balance: number
  /** Harga per generate (Rp) versi server. */
  price: number
  min_topup: number
  unlimited: NexabotUnlimited
  /** Varian utama — dipertahankan supaya pemanggil lama tetap jalan. */
  package: NexabotPackage
  /** Semua varian paket yang bisa dipilih user. */
  packages: NexabotPackage[]
}

/** Nama varian dari slug (aman walau slug kosong / dari data lama). */
export function nexabotPackageName(slug: string | null | undefined, days: number): string {
  const plan = NEXABOT_PACKAGE_FALLBACKS.find((p) => p.slug === slug)
  return plan ? `${plan.label} ${days} hari` : `Unlimited ${days} hari`
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
    // Server baru mengirim `packages`; kalau tidak ada (build lama), pakai
    // `package` tunggal atau katalog fallback supaya halaman tetap utuh.
    const packages: NexabotPackage[] = Array.isArray(data.packages) && data.packages.length > 0
      ? data.packages
      : data.package
        ? [{ slug: data.package.slug, label: data.package.label || 'Unlimited', price: data.package.price, days: data.package.days }]
        : NEXABOT_PACKAGE_FALLBACKS

    return {
      balance: data.balance || 0,
      price: data.price ?? 250,
      min_topup: data.min_topup ?? 10000,
      unlimited: data.unlimited || EMPTY_UNLIMITED,
      package: packages[0],
      packages,
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
