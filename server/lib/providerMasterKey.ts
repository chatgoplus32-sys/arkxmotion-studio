import db from '../db.js'

/**
 * Kunci API milik operator untuk Alriz Motion dan Seavi Labs.
 *
 * Kenapa kunci disimpan di server
 * -------------------------------
 * Member yang sudah top up saldo provider tetap harus menempel API key sendiri
 * kalau relay hanya menerima kredensial dari klien. Artinya saldo yang mereka
 * bayar tidak ada gunanya tanpa kunci — dan kunci yang dibagikan ke browser
 * bisa dipakai langsung ke upstream, di luar app, tanpa potongan saldo.
 *
 * Sekarang relay memasang kunci ini hanya untuk member yang berhak. Nilainya
 * tidak pernah dikirim balik ke browser, termasuk ke browser admin (admin
 * melihat statusnya saja; nilai lama tidak bisa ditampilkan).
 *
 * Konfigurasi
 * -----------
 *  ALRIZ_MASTER_API_KEY / SEAVI_MASTER_API_KEY
 *      kunci induk. Kosong dan tidak ada nilai di dashboard = fitur mati
 *      (perilaku lama: klien wajib mengirim kuncinya sendiri).
 *
 * Nilai dari dashboard menang atas env, supaya admin bisa mengganti kunci
 * tanpa menyentuh VPS.
 */

export type ServerKeyProvider = 'alriz' | 'seavi'

interface ProviderSpec {
  label: string
  /** Nama satuan saldo yang dibaca member ("saldo" Rp / "token"). */
  unit: 'saldo' | 'token'
  settingKey: string
  envKey: string
  balanceTable: 'alriz_balance' | 'seavi_balance'
  usageTable: 'alriz_usage' | 'seavi_usage'
}

export const PROVIDER_SPECS: Record<ServerKeyProvider, ProviderSpec> = {
  alriz: {
    label: 'Alriz Motion',
    unit: 'saldo',
    settingKey: 'alriz_master_api_key',
    envKey: 'ALRIZ_MASTER_API_KEY',
    balanceTable: 'alriz_balance',
    usageTable: 'alriz_usage',
  },
  seavi: {
    label: 'Seavi Labs',
    unit: 'token',
    settingKey: 'seavi_master_api_key',
    envKey: 'SEAVI_MASTER_API_KEY',
    balanceTable: 'seavi_balance',
    usageTable: 'seavi_usage',
  },
}

export function providerLabel(provider: ServerKeyProvider): string {
  return PROVIDER_SPECS[provider].label
}

export function providerSettingKey(provider: ServerKeyProvider): string {
  return PROVIDER_SPECS[provider].settingKey
}

/** Semua nama setting kredensial server — disembunyikan dari daftar umum. */
export const PROVIDER_MASTER_SETTING_KEYS = Object.values(PROVIDER_SPECS).map((s) => s.settingKey)

function storedMasterKey(provider: ServerKeyProvider): string | null {
  try {
    const row = db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(PROVIDER_SPECS[provider].settingKey) as { value: string } | undefined
    const value = (row?.value || '').trim()
    return value || null
  } catch {
    return null
  }
}

/** Kunci efektif: dashboard dulu, lalu env, atau null kalau tidak diatur. */
export function masterKey(provider: ServerKeyProvider): string | null {
  return storedMasterKey(provider) || (process.env[PROVIDER_SPECS[provider].envKey] || '').trim() || null
}

export interface MasterKeyStatus {
  configured: boolean
  /** Dari mana kunci efektif berasal — tanpa pernah menyertakan nilainya. */
  source: 'database' | 'env' | 'none'
}

export function masterKeyStatus(provider: ServerKeyProvider): MasterKeyStatus {
  const dariDb = storedMasterKey(provider)
  const dariEnv = (process.env[PROVIDER_SPECS[provider].envKey] || '').trim()
  return {
    configured: !!(dariDb || dariEnv),
    source: dariDb ? 'database' : dariEnv ? 'env' : 'none',
  }
}

export function isAdminUser(userId: number): boolean {
  try {
    const row = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role?: string } | undefined
    return row?.role === 'admin'
  } catch {
    return false
  }
}

export function balanceOf(provider: ServerKeyProvider, userId: number): number {
  const row = db
    .prepare(`SELECT balance FROM ${PROVIDER_SPECS[provider].balanceTable} WHERE user_id = ?`)
    .get(userId) as { balance: number } | undefined
  return row?.balance ?? 0
}

/**
 * Pembayaran lokal yang baru terjadi.
 *
 * Saldo dipotong klien SEBELUM submit, jadi saldo bisa sudah 0 tepat setelah
 * potong (mis. sisa pas untuk generate terakhir). Tanpa jendela ini, relay
 * menolak job yang sudah dibayar hanya karena `balanceOf()` membaca 0.
 */
export function hasRecentPaidUsage(provider: ServerKeyProvider, userId: number, withinMinutes = 15): boolean {
  const menit = Math.max(1, Math.floor(withinMinutes))
  const row = db
    .prepare(
      `SELECT 1 FROM ${PROVIDER_SPECS[provider].usageTable}
       WHERE user_id = ? AND status = 'used' AND cost > 0
         AND created_at >= datetime('now', ?)
       LIMIT 1`,
    )
    .get(userId, `-${menit} minutes`)
  return !!row
}

export interface Kelayakan {
  ok: boolean
  /** Alasan yang bisa dibaca manusia — dipakai apa adanya sebagai pesan klien. */
  reason: string
}

/**
 * Boleh tidaknya member memakai kunci server.
 *
 * Saldo diperiksa `> 0`, bukan `>= harga`: potongan dilakukan klien sebelum
 * submit, jadi membandingkan dengan harga di sini akan menolak member yang
 * barusan membayar. Admin tidak dipotong klien (mereka pemilik kunci), jadi
 * admin selalu boleh.
 */
export function keyEligibility(provider: ServerKeyProvider, userId: number): Kelayakan {
  const spec = PROVIDER_SPECS[provider]
  if (!masterKey(provider)) {
    return { ok: false, reason: `Kunci ${spec.label} milik server belum diatur admin` }
  }
  if (isAdminUser(userId)) {
    return { ok: true, reason: 'Admin — memakai kunci server tanpa potongan' }
  }
  if (balanceOf(provider, userId) > 0) {
    return { ok: true, reason: spec.unit === 'token' ? 'Token Seavi tersedia' : 'Saldo Alriz tersedia' }
  }
  if (hasRecentPaidUsage(provider, userId)) {
    return { ok: true, reason: 'Saldo baru dipotong untuk generate ini' }
  }
  return {
    ok: false,
    reason:
      spec.unit === 'token'
        ? 'Token Seavi kosong — top up dulu, atau pakai API key Seavi milik Anda sendiri'
        : 'Saldo Alriz kosong — top up dulu, atau pakai API key Alriz milik Anda sendiri',
  }
}

/** Hasil probe kunci server ke upstream (tombol "Cek Kunci" di admin). */
export interface MasterKeyCheck {
  ok: boolean
  valid: boolean
  status: number | null
  /** Ringkasan akun dari upstream, bila bentuknya dikenali. */
  detail?: string
  /** true = gangguan gateway (timeout/429/5xx); kunci belum tentu salah. */
  transient?: boolean
  error?: string
}

const KOSONG: MasterKeyCheck = { ok: false, valid: false, status: null }

const ALRIZ_BASE = (process.env.ALRIZ_BASE || 'https://alrizmotion.my.id/api').replace(/\/+$/, '')
const SEAVI_BASE = (process.env.SEAVI_BASE || 'https://api.seavilabs.site/v1').replace(/\/+$/, '')

function probeRequest(provider: ServerKeyProvider, kunci: string): { url: string; headers: Record<string, string> } {
  if (provider === 'alriz') {
    return { url: `${ALRIZ_BASE}/account`, headers: { 'X-API-Key': kunci, Accept: 'application/json' } }
  }
  return { url: `${SEAVI_BASE}/balance`, headers: { Authorization: `Bearer ${kunci}`, Accept: 'application/json' } }
}

function ringkasanAkun(provider: ServerKeyProvider, raw: any): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  if (provider === 'alriz') {
    const bagian: string[] = []
    if (raw.email) bagian.push(String(raw.email))
    if (typeof raw.balance === 'number') bagian.push(`saldo Rp ${raw.balance.toLocaleString('id-ID')}`)
    const c = raw.concurrent
    if (c && typeof c.available === 'number' && typeof c.limit === 'number') {
      bagian.push(`slot ${c.running ?? 0}/${c.limit}`)
    }
    return bagian.length ? bagian.join(' · ') : undefined
  }
  const bagian: string[] = []
  if (typeof raw.token_remaining === 'number') bagian.push(`sisa ${raw.token_remaining} token`)
  if (typeof raw.token_used === 'number') bagian.push(`terpakai ${raw.token_used} token`)
  return bagian.length ? bagian.join(' · ') : undefined
}

/**
 * Probe kunci yang tersimpan ke endpoint akun upstream. Tanpa ini, kunci yang
 * ditolak upstream hanya ketahuan dari keluhan member.
 */
export async function checkMasterKey(provider: ServerKeyProvider, timeoutMs = 20000): Promise<MasterKeyCheck> {
  const kunci = masterKey(provider)
  if (!kunci) return { ...KOSONG, error: `Kunci ${providerLabel(provider)} milik server belum diatur` }

  const { url, headers } = probeRequest(provider, kunci)
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) })
    if (res.status === 401 || res.status === 403) {
      return {
        ...KOSONG,
        status: res.status,
        error: `API key ditolak penyedia — buat kunci baru di dashboard ${providerLabel(provider)} lalu simpan ulang di sini`,
      }
    }
    if (!res.ok) {
      return {
        ...KOSONG,
        status: res.status,
        transient: res.status === 408 || res.status === 429 || res.status >= 500,
        error: `Cek kunci gagal: HTTP ${res.status}`,
      }
    }
    const raw = (await res.json().catch(() => null)) as any
    if (raw && raw.ok === false) {
      return { ...KOSONG, status: res.status, error: String(raw.error?.message || raw.error || 'Kunci ditolak penyedia') }
    }
    return { ok: true, valid: true, status: res.status, detail: ringkasanAkun(provider, raw) }
  } catch (err: any) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      ...KOSONG,
      transient: true,
      error: timeout ? 'Cek kunci timeout — upstream tidak menjawab' : `Cek kunci gagal: ${err?.message || err}`,
    }
  }
}
