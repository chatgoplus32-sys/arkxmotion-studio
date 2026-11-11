// ─── Katalog harga provider (satu sumber untuk server & fungsi Vercel) ──────
// File ini SENGAJA tidak mengimpor apa pun (tanpa db, tanpa driver Neon) supaya
// bisa dipakai dari dua dunia: `server/` (Express + SQLite) dan `api/` (Vercel
// + Neon). Yang berbeda hanya CARA membacanya — harga NexaBot hidup di tabel
// `app_settings` (diatur admin), sedangkan CreatePulse masih konstanta kode.
//
// Dipakai oleh: server/routes/nexabotWallet.ts, server/routes/createpulse.ts,
// server/routes/seaviWallet.ts, api/nexabot-wallet.ts, api/admin.ts,
// api/createpulse.ts, api/seavi-wallet.ts, dan endpoint publik
// /api/public/pricing.

// ── NexaBot ────────────────────────────────────────────────────────────────

/** Minimal top up saldo, mengikuti CreatePulse supaya seragam. */
export const NEXABOT_MIN_TOPUP = 10000

// ── Top-up manual (provider tanpa dompet) ──────────────────────────────────
// Roboneo/Weavy/Framia memakai kunci milik member sendiri, jadi tidak punya
// saldo yang bisa dikreditkan otomatis. Permintaan top-up mereka diverifikasi
// admin satu per satu (transfer DANA/QRIS) — bukan pembelian token otomatis.
export const MANUAL_TOPUP_MIN = 10000
export const MANUAL_TOPUP_MAX = 5000000
/** Nominal cepat yang ditawarkan di halaman Top Up Manual. */
export const MANUAL_TOPUP_NOMINALS = [25000, 50000, 100000, 250000] as const

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
  /**
   * Bagian mana dari tagihan yang dibebaskan paket ini.
   *  - 'all'     : semua mode NexaBot (Mingguan/Bulanan/Tahunan);
   *  - 'booster' : NexaDance 3.0 + Omni Flash 1.2 + GPT Image — lihat
   *                `isBoosterModelName()`. Mode lain (music, tts) tetap
   *                Rp/generate.
   *
   * Sengaja tidak ikut dikirim di objek `packages` respons: bentuk payload
   * itu diuji kontraknya (slug/label/price/days) dan dipakai klien lama.
   * Kelas paket dibaca lewat slug dengan `isBoosterPackage()`.
   */
  scope?: 'all' | 'booster'
}

/**
 * Varian Paket Unlimited yang berdampingan: user memilih salah satu saat top up
 * dan admin bisa mengatur harga + durasi tiap varian.
 *
 * Varian pertama sengaja memakai kunci app_settings LAMA
 * (`nexabot_unlimited_price` / `nexabot_unlimited_days`) supaya nilai yang
 * sudah disimpan admin sebelum varian ini ada tetap terpakai apa adanya.
 *
 * Entri baru SELALU ditambahkan di AKHIR: `packages[0]` adalah varian utama
 * yang dipakai klien lama (`NEXABOT_UNLIMITED_SLUG`, `unlimitedPrice`,
 * `unlimitedDays`), jadi menyisipkan varian di depan diam-diam mengubah
 * harga paket yang dianggap "utama" di seluruh sistem.
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
  {
    // Premium Booster: satu hari tanpa potongan untuk tiga keluarga generate
    // paling laris — NexaDance 3.0 (upstream 0,5 kredit/video, 20 detik 720p),
    // Omni Flash 1.2 (0,15 kredit/request), dan GPT Image (0,1 kredit/gambar).
    // Dinamai dari halaman tempat paket ini dijual, bukan dari satu model saja.
    //
    // slug sengaja TETAP `unlimited_seedance_daily` walaupun cakupanisnya sudah
    // melebar: baris `nexabot_topup` produksi sudah menyimpan slug ini, dan
    // kelas paket ditentukan dari daftar hitam slug. Ganti slug = baris lama
    // tidak lagi dikenali sebagai ber-scope, dan pemiliknya diam-diam dapat
    // Unlimited semua mode.
    slug: 'unlimited_seedance_daily',
    label: 'Booster',
    days: 1,
    defaultPrice: 15000,
    priceKey: 'nexabot_unlimited_seedance_daily_price',
    daysKey: 'nexabot_unlimited_seedance_daily_days',
    scope: 'booster',
  },
]

/** Slug paket Booster (NexaDance + Omni + GPT Image), bukan Unlimited semua mode. */
export const NEXABOT_BOOSTER_SLUGS: string[] = NEXABOT_PACKAGES
  .filter((plan) => plan.scope === 'booster')
  .map((plan) => plan.slug)

/**
 * Penjualan Premium Booster ditutup ("coming soon") lewat flag ini. Dipakai saat
 * paket ini tidak dijual — pengajuan pembelian ditolak server, bukan sekadar
 * tombol yang dimatikan di UI.
 *
 * 3 Nov 2026: tetap ditutup karena Seedance 2.5 — model yang membuat paket ini
 * ada — sudah tidak tersedia di provider (jalur generate-nya kini NexaDance 3.0).
 * Pemegang Booster yang masih aktif tidak terpengaruh. Untuk membuka penjualan:
 * ubah ke `false` di sini + cerminnya di src/lib/nexabotWallet.ts. Halaman
 * Booster/topup/landing ikut sendiri karena membaca flag ini.
 */
export const NEXABOT_BOOSTER_COMING_SOON = true

/** Pesan yang dipakai UI dan penolakan server — satu teks, jangan bercabang. */
export const NEXABOT_BOOSTER_COMING_SOON_NOTE =
  'Premium Booster sedang tidak dijual — Seedance 2.5 sudah tidak ada di provider. ' +
  'Paket Unlimited semua mode tetap bisa dibeli.'

/**
 * Semua slug paket yang TIDAK membebaskan semua mode. Dipakai untuk mengecualikan
 * paket ber-scope dari status "Unlimited" global.
 *
 * Sengaja daftar hitam dari katalog, bukan daftar putih slug 'all': baris paket
 * lama (sebelum kolom `package_slug` ada) berisi `''` dan harus tetap dihitung
 * sebagai Unlimited semua mode — itulah janji yang sudah dibayar member.
 */
export const NEXABOT_SCOPED_SLUGS: string[] = NEXABOT_PACKAGES
  .filter((plan) => (plan.scope || 'all') !== 'all')
  .map((plan) => plan.slug)

/** Apakah slug ini paket Booster? Slug lama/kosong → tidak. */
export function isBoosterPackage(slug: string | null | undefined): boolean {
  return NEXABOT_BOOSTER_SLUGS.includes(String(slug || ''))
}

/**
 * Apakah slug ini paket ber-scope — yaitu TIDAK membebaskan semua mode? Ini
 * pertanyaan yang dipakai untuk memisahkan KELAS paket (antrian pengajuan,
 * penumpukan expiry); daftar hitamnya bisa bertambah tanpa mengubah aturan.
 */
export function isScopedPackage(slug: string | null | undefined): boolean {
  return NEXABOT_SCOPED_SLUGS.includes(String(slug || ''))
}

/**
 * Apakah nama model yang dikirim ke /deduct adalah job NexaDance 3.0?
 * Klien NexaBot mengirim `apiModel` dari katalog halaman ('nexadance'); pola
 * longgar supaya varian nama ('nexadance_3_0', 'nb:nexadance') tetap kena.
 *
 * 'seedance' sengaja tetap dikenali: baris usage lama (sebelum rebrand) harus
 * masih dihitung sebagai jatah harian yang sama, bukan jatah baru.
 */
export function isNexadanceModelName(model: string | null | undefined): boolean {
  return /nexadance|seedance/i.test(String(model || ''))
}

/**
 * Mode Omni Flash 1.2 yang dikirim ke /deduct. Tidak ada string "omni" di jalur
 * biaya: satu model Omni dijual sebagai lima mode video (katalog Image to Video),
 * dan AI Video Edit mengirim 'r2v' untuk klip hasil potong.
 */
export const NEXABOT_OMNI_MODELS = ['t2v', 'sfv', 'i2v', 'r2v', 'extend']

/** Varian GPT Image NexaBot: 2.5 ('gpt-image') dan generasi sebelumnya ('img'). */
export const NEXABOT_IMAGE_MODELS = ['gpt-image', 'img']

/**
 * Apakah model ini dibebaskan Premium Booster? Tiga keluarga: NexaDance 3.0,
 * Omni Flash 1.2, dan GPT Image.
 *
 * Audio (`music`, `tts`) sengaja TIDAK ikut — Booster dijual sebagai paket
 * visual dan halaman Top Up menyebut batas itu apa adanya. Daftarnya juga harus
 * tetap eksplisit: mode baru yang muncul di /deduct tidak boleh otomatis gratis
 * hanya karena namanya belum sempat diperbarui.
 */
export function isBoosterModelName(model: string | null | undefined): boolean {
  const mentah = String(model || '').toLowerCase()
  if (isNexadanceModelName(mentah)) return true
  // Klien lama ada yang mengirim 'nb:r2v'; pakai nama telanjangnya.
  const inti = mentah.includes(':') ? (mentah.split(':').pop() || '') : mentah
  return NEXABOT_OMNI_MODELS.includes(inti) || NEXABOT_IMAGE_MODELS.includes(inti)
}

/** Paket utama — dipakai kalau klien lama tidak menyebut varian (slug). */
export const NEXABOT_UNLIMITED_SLUG = NEXABOT_PACKAGES[0].slug

/** Dipakai kalau admin belum pernah menyimpan pengaturan harga. */
export const NEXABOT_PRICING_DEFAULTS = {
  /** Rp per generate (semua mode) — dipotong dari saldo user. */
  price: 150,
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

// ── Seavi ────────────────────────────────────────────────────────────────
// Wallet TOKEN (bukan Rp): 1 token = Rp 1.700. User membeli paket token,
// generate memotong N token sesuai bobot model (lihat `tokens` di
// src/lib/seavi.ts — angka di bawah harus selalu sama dengan spec itu).
// Paket: Rp 3.400 = 2 token, Rp 8.500 = 5 token.

/** Harga 1 token Seavi dalam Rupiah. */
export const SEAVI_TOKEN_PRICE = 1700

/** Minimal top up Seavi (sama dengan paket terkecil: 2 token × Rp 1.700). */
export const SEAVI_MIN_TOPUP = 3400

export interface SeaviPackagePlan {
  slug: string
  label: string
  /** Harga bayar (Rp). */
  price: number
  /** Token yang didapat setelah admin approve. */
  tokens: number
}

export const SEAVI_PACKAGES: SeaviPackagePlan[] = [
  { slug: 'seavi_2', label: '2 Token', price: 3400, tokens: 2 },
  { slug: 'seavi_3', label: '3 Token', price: 5100, tokens: 3 },
  { slug: 'seavi_4', label: '4 Token', price: 6800, tokens: 4 },
  { slug: 'seavi_5', label: '5 Token', price: 8500, tokens: 5 },
  { slug: 'seavi_10', label: '10 Token', price: 17000, tokens: 10 },
  { slug: 'seavi_25', label: '25 Token', price: 42500, tokens: 25 },
  { slug: 'seavi_50', label: '50 Token', price: 85000, tokens: 50 },
]

/** Biaya default 1 generate (token) untuk model yang tidak dikenal. */
export const SEAVI_DEFAULT_CHARGE = 1

/**
 * Bobot token per model id Seavi (tanpa prefix `sv:`), sesuai katalog upstream
 * "Aktif (21)" 5 Nov 2026 — 13 model 1 token, 8 model 2 token. Hanya bobot yang
 * BEDA dari SEAVI_DEFAULT_CHARGE yang didaftar (kontrak /api/public/pricing);
 * model 1 token jatuh ke default. Cermin `spec.tokens` di src/lib/seavi.ts
 * (SEAVI_MODELS + SEAVI_IMAGE_MODELS) — tes kontrak silang menjaga keduanya
 * tetap sama, jadi daftar lengkap ada di file itu.
 */
export const SEAVI_MODEL_TOKENS: Record<string, number> = {
  gemini_omni_server19: 2,
  happyhorse11_server23: 2,
  kling4_server19: 2,
  motion_control_v3_server10_30dtk: 2,
  seedance25_server10: 2,
  seedance25_server19: 2,
  wan30_prime_server19: 2,
  wan30_server19: 2,
  wan3_server23: 2,
}

/** Biaya satu generate Seavi dalam token (dikalikan `quantity` di server). */
export function getSeaviCharge(model?: string): number {
  if (!model) return SEAVI_DEFAULT_CHARGE
  // Client mengirim 'sv:xxx' atau id mentah 'xxx' — samakan dulu.
  const id = model.includes(':') ? (model.split(':').pop() || model) : model
  return SEAVI_MODEL_TOKENS[id] ?? SEAVI_DEFAULT_CHARGE
}

/** Paket token menurut slug; undefined kalau slug tidak dikenal. */
export function findSeaviPackage(slug?: string | null): SeaviPackagePlan | undefined {
  if (!slug) return undefined
  return SEAVI_PACKAGES.find((plan) => plan.slug === slug)
}
