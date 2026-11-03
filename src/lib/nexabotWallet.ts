// ─── Klien wallet NexaBot ───────────────────────────────────────────────────
// Saldo Rp per user (potong Rp 150/generate) + Paket Unlimited dengan beberapa
// varian (Mingguan/Bulanan/Tahunan). Semua angka otoritatif datang dari server
// lewat /api/nexabot/*, jadi kalau admin mengubah harga, UI ikut sendiri.
//
// Varian ber-scope (Premium Booster) hanya membebaskan keluarga model yang
// server kenal; klien cuma menampilkan. See isBoosterModelName (shared/pricing.ts).
//
// Dipakai halaman /topup/nexabot, /booster, dan alur generate (Image to Video,
// AI Video Edit, Edit Gambar).
const API = '/api/nexabot'

export interface NexabotUnlimited {
  active: boolean
  expires_at: string | null
  days_left: number
  /** Sisa jam — dipakai paket seharian supaya tidak selalu tampil "1 hari". */
  hours_left?: number
  package_id?: number | null
  /** Slug paket aktif — penentu scope (lihat NEXABOT_BOOSTER_SLUGS). */
  package_slug?: string | null
  days?: number
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
 *
 * Entri baru SELALU di AKHIR, sama seperti katalog server: `packages[0]`
 * diperlakukan sebagai varian utama oleh klien dan endpoint lama.
 */
export const NEXABOT_PACKAGE_FALLBACKS: NexabotPackage[] = [
  { slug: 'unlimited_weekly', label: 'Mingguan', price: 35000, days: 7 },
  { slug: 'unlimited_monthly', label: 'Bulanan', price: 119000, days: 30 },
  { slug: 'unlimited_yearly', label: 'Tahunan', price: 899000, days: 365 },
  { slug: 'unlimited_seedance_daily', label: 'Booster', price: 15000, days: 1 },
]

/**
 * Slug paket Booster — membebaskan Seedance 2.5 + Omni Flash 1.1 + GPT Image,
 * bukan music/tts. Server punya daftar yang sama (derived dari scope katalog)
 * dan itulah yang menentukan tagihan; klien hanya perlu ini untuk menulis label
 * yang jujur.
 */
export const NEXABOT_BOOSTER_SLUGS = ['unlimited_seedance_daily']

/** Varian Booster yang dijual di halaman Premium Booster. */
export const NEXABOT_BOOSTER_SLUG = NEXABOT_BOOSTER_SLUGS[0]

/** Apakah paket ini Premium Booster (bukan Unlimited semua mode)? */
export function isBoosterPackage(slug: string | null | undefined): boolean {
  return NEXABOT_BOOSTER_SLUGS.includes(String(slug || ''))
}

/**
 * Cermin daftar server (shared/pricing.ts): mode yang dibebaskan Premium
 * Booster. `model` di sini adalah string yang sama dengan yang dikirim ke
 * /deduct — 'seedance', lima mode Omni, atau 'gpt-image'/'img'. UI memakainya
 * untuk menampilkan badge di mode yang tepat; yang menagih tetap server.
 */
export const NEXABOT_BOOSTER_OMNI_MODELS = ['t2v', 'sfv', 'i2v', 'r2v', 'extend']
export const NEXABOT_BOOSTER_IMAGE_MODELS = ['gpt-image', 'img']

export function isBoosterModelName(model: string | null | undefined): boolean {
  const mentah = String(model || '').toLowerCase()
  if (/seedance/.test(mentah)) return true
  const inti = mentah.includes(':') ? (mentah.split(':').pop() || '') : mentah
  return NEXABOT_BOOSTER_OMNI_MODELS.includes(inti) || NEXABOT_BOOSTER_IMAGE_MODELS.includes(inti)
}

/** Tiga keluarga yang dibebaskan Booster — satu sumber untuk semua copy UI. */
export const NEXABOT_BOOSTER_COVERAGE = ['Seedance 2.5', 'Omni Flash 1.1', 'GPT Image 2.5']

/**
 * Cermin `shared/pricing.ts` (NEXABOT_BOOSTER_COMING_SOON): Booster ditutup
 * sementara karena Seedance 2 tidak tersedia di provider. UI memakai ini untuk
 * menampilkan label "Coming soon" dan mematikan tombol beli; server tetap
 * menolak pengajuannya sendiri, jadi flag di klien hanya untuk tampilan.
 * Buka lagi = ubah keduanya ke false.
 */
export const NEXABOT_BOOSTER_COMING_SOON = true

export const NEXABOT_BOOSTER_COMING_SOON_NOTE =
  'Premium Booster ditutup sementara — Seedance 2 sedang tidak tersedia di provider. ' +
  'Paket dibuka lagi setelah modelnya normal; Paket Unlimited semua mode tetap bisa dibeli.'

/**
 * Apakah satu generate untuk model ini tidak memotong saldo? Server yang
 * memutuskan lewat /deduct; ini hanya untuk tampilan (badge & copy).
 */
export function nexabotFreeForModel(wallet: NexabotWallet | null | undefined, model: string): boolean {
  return !!wallet?.unlimited?.active || (isBoosterModelName(model) && !!wallet?.booster_unlimited?.active)
}

/**
 * Jalur kredensial untuk satu job NexaBot.
 *
 * Saat paket (Unlimited / Premium Booster) menanggung biaya generate ini, biaya
 * upstream dibayar kunci milik server. API key pribadi member TIDAK dipakai di
 * situ: saldonya bisa kosong dan generate yang sudah dibayar lewat paket gagal
 * di upstream dengan 402 "Kredit tidak cukup". Tanpa paket, kunci pribadi tetap
 * didahulukan seperti biasa.
 */
export function nexabotPreferServerKey(opts: {
  hasOwnKey: boolean
  serverReady: boolean
  coveredByPackage: boolean
}): boolean {
  return opts.serverReady && (opts.coveredByPackage || !opts.hasOwnKey)
}

/**
 * Sisa masa berlaku dalam bahasa UI. Paket seharian disebut dalam jam — dengan
 * days_left, paket Rp 15.000/malam akan selalu terbaca "1 hari lagi" bahkan
 * ketika tinggal satu jam.
 */
export function nexabotRemainingLabel(u: NexabotUnlimited | null | undefined): string {
  if (!u?.active) return ''
  if (isBoosterPackage(u.package_slug) || (u.days ?? 0) <= 1) {
    const jam = u.hours_left ?? 0
    if (jam <= 0) return ''
    return jam <= 24 ? `${jam} jam lagi` : `${u.days_left} hari lagi`
  }
  return u.days_left > 0 ? `${u.days_left} hari lagi` : ''
}

/** Harga per generate versi cermin — hanya untuk tampilan sebelum server menjawab. */
export const NEXABOT_PRICE_FALLBACK = 150

export interface NexabotWallet {
  balance: number
  /** Harga per generate (Rp) versi server. */
  price: number
  min_topup: number
  unlimited: NexabotUnlimited
  /**
   * Status Premium Booster — termasuk kalau yang aktif adalah Unlimited semua
   * mode (ia membebaskan lebih banyak). `unlimited` sengaja TIDAK menghitung
   * Booster karena Booster tidak menggratiskan music/tts.
   */
  booster_unlimited?: NexabotUnlimited
  /**
   * Kunci NexaBot milik server: member yang sudah top up (Unlimited aktif atau
   * saldo > 0) bisa generate tanpa menempel API key sendiri. `reason` adalah
   * alasan yang sama dengan yang dipakai relay saat menolak.
   */
  server_key: NexabotServerKey
  /** Varian utama — dipertahankan supaya pemanggil lama tetap jalan. */
  package: NexabotPackage
  /** Semua varian paket yang bisa dipilih user. */
  packages: NexabotPackage[]
  /**
   * Sisa jatah Seedance 2.5 hari ini (hari WIB). Ada karena paket membebaskan
   * rupiah member tetapi setiap video tetap menagih kredit akun NexaBot server;
   * relay menolak video ke-6 dst, jadi UI perlu bisa menampilkannya lebih dulu.
   */
  seedance_quota?: NexabotSeedanceQuota
}

export interface NexabotSeedanceQuota {
  limit: number
  used: number
  remaining: number
  habis: boolean
}

export interface NexabotServerKey {
  available: boolean
  reason: string
  /** Kredensial server yang akan dipakai relay: sesi Unlimited (cookie) atau kunci API. */
  kind?: 'cookie' | 'key' | null
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

const EMPTY_UNLIMITED: NexabotUnlimited = {
  active: false,
  expires_at: null,
  days_left: 0,
  hours_left: 0,
  package_id: null,
  package_slug: null,
  days: 0,
}

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
      price: data.price ?? NEXABOT_PRICE_FALLBACK,
      min_topup: data.min_topup ?? 10000,
      unlimited: data.unlimited || EMPTY_UNLIMITED,
      // Build server lama belum mengirim status Booster; tanpa field ini UI
      // tetap memakai status unlimited biasa.
      booster_unlimited: data.booster_unlimited || undefined,
      // Build server lama belum mengirim `server_key`; anggap tidak tersedia
      // supaya UI tidak menawarkan jalur tanpa API key yang relay tolak.
      server_key: data.server_key ?? {
        available: false,
        reason: 'Server belum mengaktifkan kunci NexaBot bersama',
      },
      package: packages[0],
      packages,
      // Build server lama belum mengirim kuota; biarkan undefined dan UI
      // menampilkan status tanpa baris kuota.
      seedance_quota: data.seedance_quota || undefined,
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
