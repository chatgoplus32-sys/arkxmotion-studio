// ─── Katalog harga provider (satu sumber untuk server & fungsi Vercel) ──────
// File ini SENGAJA tidak mengimpor apa pun (tanpa db, tanpa driver Neon) supaya
// bisa dipakai dari dua dunia: `server/` (Express + SQLite) dan `api/` (Vercel
// + Neon). Yang berbeda hanya CARA membacanya — harga NexaBot hidup di tabel
// `app_settings` (diatur admin), sedangkan CreatePulse masih konstanta kode.
//
// Dipakai oleh: server/routes/nexabotWallet.ts, server/routes/createpulse.ts,
// api/nexabot-wallet.ts, api/admin.ts, api/createpulse.ts, dan endpoint publik
// /api/public/pricing.

// ── NexaBot ────────────────────────────────────────────────────────────────

/** Minimal top up saldo, mengikuti CreatePulse supaya seragam. */
export const NEXABOT_MIN_TOPUP = 10000
export const NEXABOT_UNLIMITED_SLUG = 'unlimited_weekly'

/** Dipakai kalau admin belum pernah menyimpan pengaturan harga. */
export const NEXABOT_PRICING_DEFAULTS = {
  /** Rp per generate (semua mode) — dipotong dari saldo user. */
  price: 250,
  /** Paket Unlimited: sekali bayar → generate gratis selama `unlimitedDays`. */
  unlimitedPrice: 35000,
  unlimitedDays: 7,
}

/** Kunci di tabel app_settings. */
export const NEXABOT_PRICING_KEYS = {
  price: 'nexabot_price',
  unlimitedPrice: 'nexabot_unlimited_price',
  unlimitedDays: 'nexabot_unlimited_days',
} as const

export interface NexabotPricing {
  price: number
  unlimitedPrice: number
  unlimitedDays: number
}

/** Batas wajar supaya salah ketik admin tidak merusak billing. */
export const NEXABOT_PRICING_LIMITS: Record<keyof NexabotPricing, { min: number; max: number }> = {
  price: { min: 1, max: 10_000_000 },
  unlimitedPrice: { min: 1, max: 100_000_000 },
  unlimitedDays: { min: 1, max: 365 },
}

/**
 * Ubah isi app_settings jadi harga efektif. Nilai yang kosong / tidak masuk akal
 * otomatis jatuh ke default, jadi DB yang setengah terisi tidak pernah membuat
 * server salah menagih.
 */
export function parseNexabotPricing(saved: Record<string, string | number | null | undefined>): NexabotPricing {
  const read = (key: keyof NexabotPricing): number => {
    const n = Number(saved?.[NEXABOT_PRICING_KEYS[key]])
    const { min, max } = NEXABOT_PRICING_LIMITS[key]
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : NEXABOT_PRICING_DEFAULTS[key]
  }
  return {
    price: read('price'),
    unlimitedPrice: read('unlimitedPrice'),
    unlimitedDays: read('unlimitedDays'),
  }
}

/** Pesan validasi untuk harga yang dikirim admin; null kalau nilainya wajar. */
export function validateNexabotPricing(key: keyof NexabotPricing, value: number): string | null {
  const { min, max } = NEXABOT_PRICING_LIMITS[key]
  if (!Number.isFinite(value) || value < min || value > max) {
    return `${key} harus angka antara ${min} dan ${max}`
  }
  return null
}

// ── CreatePulse ────────────────────────────────────────────────────────────
// Catatan: harga per model di sisi server masih konstanta (belum bisa diatur
// admin seperti NexaBot). Tarif di bawah adalah yang BENAR-BENAR dipotong oleh
// /api/createpulse/deduct dan server/routes/createpulse.ts.

export const CREATEPULSE_MIN_TOPUP = 10000
/** Harga untuk model yang tidak punya tarif khusus. */
export const CREATEPULSE_DEFAULT_PRICE = 1500
/** Tarif khusus per apiModel. */
export const CREATEPULSE_MODEL_PRICES: Record<string, number> = {
  'dreamina-seedance-2.0-15s': 2250,
  'veo-omni-10s': 2250,
}

/** Harga satu generate CreatePulse sesuai apiModel (default kalau tidak dikenal). */
export function getCreatepulseCharge(model?: string): number {
  if (!model) return CREATEPULSE_DEFAULT_PRICE
  return CREATEPULSE_MODEL_PRICES[model] ?? CREATEPULSE_DEFAULT_PRICE
}

/** Rentang harga efektif provider ini — dipakai endpoint publik & halaman landing. */
export function getCreatepulsePriceRange(): { min: number; max: number } {
  const values = [CREATEPULSE_DEFAULT_PRICE, ...Object.values(CREATEPULSE_MODEL_PRICES)]
  return { min: Math.min(...values), max: Math.max(...values) }
}
