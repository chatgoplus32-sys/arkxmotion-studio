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

export interface NexabotPackagePlan {
  slug: string
  label: string
  /** Durasi default, dipakai selama admin belum menyimpan nilai sendiri. */
  days: number
  defaultPrice: number
  /** Kunci app_settings untuk harga varian ini. */
  priceKey: string
  /** Kunci app_settings untuk durasi (hari) varian ini. */
  daysKey: string
}

/**
 * Varian Paket Unlimited yang berdampingan: user memilih salah satu saat top up
 * dan admin bisa mengatur harga + durasi tiap varian.
 *
 * Varian pertama sengaja memakai kunci app_settings LAMA
 * (`nexabot_unlimited_price` / `nexabot_unlimited_days`) supaya nilai yang
 * sudah disimpan admin sebelum varian ini ada tetap terpakai apa adanya.
 */
export const NEXABOT_PACKAGES: NexabotPackagePlan[] = [
  {
    slug: 'unlimited_weekly',
    label: 'Mingguan',
    days: 7,
    defaultPrice: 35000,
    priceKey: 'nexabot_unlimited_price',
    daysKey: 'nexabot_unlimited_days',
  },
  {
    slug: 'unlimited_monthly',
    label: 'Bulanan',
    days: 30,
    defaultPrice: 119000,
    priceKey: 'nexabot_unlimited_monthly_price',
    daysKey: 'nexabot_unlimited_monthly_days',
  },
  {
    slug: 'unlimited_yearly',
    label: 'Tahunan',
    days: 365,
    defaultPrice: 899000,
    priceKey: 'nexabot_unlimited_yearly_price',
    daysKey: 'nexabot_unlimited_yearly_days',
  },
]

/** Paket utama — dipakai kalau klien lama tidak menyebut varian (slug). */
export const NEXABOT_UNLIMITED_SLUG = NEXABOT_PACKAGES[0].slug

/** Dipakai kalau admin belum pernah menyimpan pengaturan harga. */
export const NEXABOT_PRICING_DEFAULTS = {
  /** Rp per generate (semua mode) — dipotong dari saldo user. */
  price: 250,
  /** Varian pertama (kompatibilitas): sekali bayar → gratis `unlimitedDays` hari. */
  unlimitedPrice: NEXABOT_PACKAGES[0].defaultPrice,
  unlimitedDays: NEXABOT_PACKAGES[0].days,
}

/** Kunci app_settings untuk field lama (varian pertama). */
export const NEXABOT_PRICING_KEYS = {
  price: 'nexabot_price',
  unlimitedPrice: NEXABOT_PACKAGES[0].priceKey,
  unlimitedDays: NEXABOT_PACKAGES[0].daysKey,
} as const

/** Semua kunci app_settings yang perlu dibaca untuk menghitung harga NexaBot. */
export const NEXABOT_PRICING_SETTING_KEYS: string[] = [
  NEXABOT_PRICING_KEYS.price,
  ...NEXABOT_PACKAGES.flatMap((plan) => [plan.priceKey, plan.daysKey]),
]

/** Satu varian paket dengan harga efektif (DB + default yang sudah digabung). */
export interface NexabotPackage {
  slug: string
  label: string
  price: number
  days: number
}

export interface NexabotPricing {
  price: number
  /** Varian pertama — dipertahankan supaya pemanggil lama tetap jalan. */
  unlimitedPrice: number
  unlimitedDays: number
  packages: NexabotPackage[]
}

export type NexabotPricingField = 'price' | 'unlimitedPrice' | 'unlimitedDays'

/** Batas wajar supaya salah ketik admin tidak merusak billing. */
export const NEXABOT_PRICING_LIMITS: Record<NexabotPricingField, { min: number; max: number }> = {
  price: { min: 1, max: 10_000_000 },
  unlimitedPrice: { min: 1, max: 100_000_000 },
  unlimitedDays: { min: 1, max: 365 },
}

/** Batas harga & durasi yang berlaku untuk SEMUA varian paket. */
export const NEXABOT_PACKAGE_LIMITS: Record<'price' | 'days', { min: number; max: number }> = {
  price: NEXABOT_PRICING_LIMITS.unlimitedPrice,
  days: NEXABOT_PRICING_LIMITS.unlimitedDays,
}

/** Nilai tersimpan yang kosong / tidak masuk akal jatuh ke default. */
function readBounded(
  raw: string | number | null | undefined,
  fallback: number,
  limits: { min: number; max: number },
): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= limits.min && n <= limits.max ? Math.round(n) : fallback
}

/**
 * Ubah isi app_settings jadi harga efektif. Nilai yang kosong / tidak masuk akal
 * otomatis jatuh ke default, jadi DB yang setengah terisi tidak pernah membuat
 * server salah menagih.
 */
export function parseNexabotPricing(saved: Record<string, string | number | null | undefined>): NexabotPricing {
  const packages: NexabotPackage[] = NEXABOT_PACKAGES.map((plan) => ({
    slug: plan.slug,
    label: plan.label,
    price: readBounded(saved?.[plan.priceKey], plan.defaultPrice, NEXABOT_PACKAGE_LIMITS.price),
    days: readBounded(saved?.[plan.daysKey], plan.days, NEXABOT_PACKAGE_LIMITS.days),
  }))

  return {
    price: readBounded(
      saved?.[NEXABOT_PRICING_KEYS.price],
      NEXABOT_PRICING_DEFAULTS.price,
      NEXABOT_PRICING_LIMITS.price,
    ),
    // Varian pertama memakai kunci lama, jadi nilai admin yang sudah tersimpan
    // otomatis terbaca sebagai paket Mingguan.
    unlimitedPrice: packages[0].price,
    unlimitedDays: packages[0].days,
    packages,
  }
}

/** Pesan validasi untuk harga yang dikirim admin; null kalau nilainya wajar. */
export function validateNexabotPricing(key: NexabotPricingField, value: number): string | null {
  const { min, max } = NEXABOT_PRICING_LIMITS[key]
  if (!Number.isFinite(value) || value < min || value > max) {
    return `${key} harus angka antara ${min} dan ${max}`
  }
  return null
}

/** Validasi satu angka varian paket (harga atau durasi hari). */
export function validateNexabotPackageValue(field: 'price' | 'days', value: number): string | null {
  const { min, max } = NEXABOT_PACKAGE_LIMITS[field]
  if (!Number.isFinite(value) || value < min || value > max) {
    return `${field === 'days' ? 'durasi paket' : 'harga paket'} harus angka antara ${min} dan ${max}`
  }
  return null
}

/** Varian paket menurut slug; tanpa slug (klien lama) → varian pertama. */
export function findNexabotPackage(slug?: string | null): NexabotPackagePlan | undefined {
  if (!slug) return NEXABOT_PACKAGES[0]
  return NEXABOT_PACKAGES.find((plan) => plan.slug === slug)
}

/** Perubahan harga/durasi per varian yang boleh dikirim admin (slug → patch). */
export type NexabotPackagesPatch = Record<string, { price?: number; days?: number }>

/** Nama varian untuk riwayat user & antrian admin (aman walau slug lama/kosong). */
export function nexabotPackageName(slug: string | null | undefined, days: number): string {
  const plan = NEXABOT_PACKAGES.find((p) => p.slug === slug)
  return plan ? `${plan.label} ${days} hari` : `Unlimited ${days} hari`
}

/** Ringkasan harga untuk pesan konfirmasi admin setelah menyimpan. */
export function describeNexabotPricing(pricing: NexabotPricing): string {
  const tiers = pricing.packages
    .map((p) => `${p.label} Rp ${p.price.toLocaleString('id-ID')}/${p.days} hari`)
    .join(' · ')
  return `Harga NexaBot: Rp ${pricing.price.toLocaleString('id-ID')}/generate · ${tiers}`
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
  'dreamina-seedance-2.5-15s': 2500,
  'dreamina-seedance-2.5-20s': 3000,
  'dreamina-seedance-2.5-30s': 4500,
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
