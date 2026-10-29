import db from '../db.js'

/**
 * Kunci induk NexaBot: satu kunci milik operator, TIDAK PERNAH sampai ke browser.
 *
 * Kenapa di server
 * ----------------
 * Sebelumnya jalur API key mengharuskan klien mengirim `x-api-key` sendiri.
 * Artinya kunci apa pun yang dipakai member ada di localStorage browser mereka —
 * bisa dibaca siapa pun yang membuka devtools, lalu dipakai langsung ke
 * nexabot.id: di luar app, tidak tercatat, tidak dipotong saldo, tapi tetap
 * ditagihkan ke pemilik akun. Dan karena kuncinya satu, mencabut akses satu orang
 * tidak mungkin tanpa memutus semua orang.
 *
 * Sekarang relay yang memasang kunci itu, dan hanya untuk member yang berhak.
 * Kunci tetap satu, tapi ia tidak lagi beredar.
 *
 * Konfigurasi
 * -----------
 *  NEXABOT_MASTER_API_KEY   kunci induk. Kosong = fitur ini mati (perilaku lama).
 *  NEXABOT_MASTER_KEY_MODE  siapa yang boleh memakainya:
 *                             'unlimited-or-balance' (default) — paket Unlimited
 *                                 aktif, atau pernah top up saldo;
 *                             'unlimited' — hanya paket Unlimited aktif;
 *                             'off'       — jangan pernah disuntikkan.
 *  NEXABOT_MASTER_DAILY_CAP batas job per member per hari pada kunci induk.
 *                             0 / kosong = tanpa batas.
 *
 * Batas harian defaultnya mati, dan itu keputusan sadar: menyalakannya sendiri
 * bisa memutus member yang sudah membayar. Yang membuatnya layak dinyalakan
 * adalah angka dari `nexabot_upstream_usage` — sudah ada, tinggal dibaca.
 */

export type MasterKeyMode = 'off' | 'unlimited' | 'unlimited-or-balance'

/** Baris `app_settings` tempat admin menyimpan kunci induk lewat dashboard. */
export const MASTER_KEY_SETTING = 'nexabot_master_api_key'

/** Sama seperti relay: bisa diarahkan ke upstream tiruan saat tes. */
const NEXABOT_BASE = (process.env.NEXABOT_BASE || 'https://nexabot.id').replace(/\/+$/, '')

/**
 * Apakah nilai ini berbentuk cookie sesi, bukan API key.
 *
 * Insiden 2026-10-28: cookie sesi ikut ditempel ke kolom API key. Relay lalu
 * mengirimnya sebagai `x-api-key`, upstream membalas 401 "API key tidak valid",
 * dan SEMUA member yang memakai kredensial server gagal tanpa petunjuk kolom
 * mana yang salah. Nilai berbentuk cookie sekarang diabaikan sebagai API key
 * dan ditolak saat admin menyimpannya.
 *
 * API key NexaBot berbentuk `nxb_…` / `nxa_…` tanpa `=`; cookie selalu
 * `nama=isi`. Karena itu satu pasangan `nama=isi` sudah cukup dicurigai —
 * termasuk `nexabot_session=…` yang tidak mengandung `;` (kasus produksi
 * 2026-10-28). `=` di akhir nilai dibiarkan lolos supaya padding base64 pada
 * kunci biasa tidak salah tandai.
 */
export function looksLikeSessionCookie(value: string): boolean {
  const v = (value || '').trim()
  if (!v) return false
  const eq = v.indexOf('=')
  if (eq > 0 && eq < v.length - 1) return true
  return /(^|[;\s])(session|cf_clearance|__secure-[a-z0-9-]+|token|auth)=/i.test(v) || /;\s*[^=;\s]+=/.test(v)
}

/**
 * Nilai kunci dari database (diisi admin lewat dashboard).
 *
 * Dibaca di setiap panggilan, bukan di-cache: admin bisa mengganti kunci kapan
 * saja dan request berikutnya harus langsung memakai nilai baru.
 */
function storedMasterKey(): string | null {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(MASTER_KEY_SETTING) as
      | { value: string }
      | undefined
    const nilai = (row?.value || '').trim()
    return nilai || null
  } catch {
    return null
  }
}

/**
 * Kunci induk efektif: nilai dari dashboard admin, lalu fallback env, atau null
 * kalau tidak dikonfigurasi / dimatikan.
 *
 * Urutan ini disengaja: dashboard menang supaya admin bisa mengganti kunci tanpa
 * menyentuh VPS, sementara env tetap bekerja untuk deployment yang belum pernah
 * membuka halaman pengaturan.
 */
let sudahPeringatKunciCookie = false

function mentahMasterKey(): string {
  return storedMasterKey() || (process.env.NEXABOT_MASTER_API_KEY || '').trim() || ''
}

export function masterKey(): string | null {
  if (masterKeyMode() === 'off') return null
  const mentah = mentahMasterKey()
  if (!mentah) return null
  // Cookie yang salah tempat tidak boleh dikirim sebagai API key: upstream akan
  // menolaknya untuk semua member, dan pesannya menyesatkan ("API key tidak
  // valid") seolah kunci member yang salah.
  if (looksLikeSessionCookie(mentah)) {
    if (!sudahPeringatKunciCookie) {
      sudahPeringatKunciCookie = true
      console.warn(
        '[nexabot-master-key] nilai kunci berbentuk cookie sesi — diabaikan sebagai API key. ' +
        'Simpan cookie itu di slot Sesi Unlimited, dan isi Kunci Server dengan API key NexaBot.',
      )
    }
    return null
  }
  return mentah
}

export interface MasterKeyStatus {
  configured: boolean
  /** Dari mana kunci efektif berasal — tanpa pernah menyertakan nilainya. */
  source: 'database' | 'env' | 'none'
  mode: MasterKeyMode
  daily_cap: number
  /**
   * true = nilai tersimpan berbentuk cookie sesi, jadi diabaikan sebagai API
   * key. Panel admin perlu menampilkan ini supaya salah kolom langsung terlihat.
   */
  looks_like_cookie: boolean
}

/** Status untuk dashboard admin. Nilai kunci TIDAK pernah ikut dikembalikan. */
export function masterKeyStatus(): MasterKeyStatus {
  const dariDb = storedMasterKey()
  const dariEnv = (process.env.NEXABOT_MASTER_API_KEY || '').trim()
  const aktif = masterKeyMode() !== 'off'
  return {
    configured: !!masterKey(),
    source: aktif ? (dariDb ? 'database' : dariEnv ? 'env' : 'none') : 'none',
    mode: masterKeyMode(),
    daily_cap: masterDailyCap(),
    looks_like_cookie: looksLikeSessionCookie(dariDb || dariEnv || ''),
  }
}

export function masterKeyMode(): MasterKeyMode {
  const mode = (process.env.NEXABOT_MASTER_KEY_MODE || 'unlimited-or-balance').trim().toLowerCase()
  if (mode === 'off' || mode === 'unlimited') return mode
  return 'unlimited-or-balance'
}

export function masterDailyCap(): number {
  const n = Number(process.env.NEXABOT_MASTER_DAILY_CAP)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** Nilai pengganti yang ditampilkan ke siapa pun yang meminta nilainya. */
export const NILAI_DISENSOR = '(kunci NexaBot milik server — sengaja tidak ditampilkan)'

/**
 * Nilai token yang aman disajikan ke klien.
 *
 * Dipakai semua jalur yang menyerahkan nilai token (toko token dan daftar admin),
 * supaya kunci induk tidak pernah sampai ke browser mana pun — termasuk browser
 * admin, karena admin melihatnya dari dashboard, bukan dari .env.
 */
export function redactIfMasterKey(value: unknown): string {
  const nilai = typeof value === 'string' ? value : ''
  return isMasterKey(nilai) ? NILAI_DISENSOR : nilai
}

/** Apakah sebuah nilai yang datang dari klien sebenarnya kunci induk. */
export function isMasterKey(value: string | null | undefined): boolean {
  const kunci = masterKey()
  if (!kunci || !value) return false
  return value.trim() === kunci
}

/** Paket Unlimited aktif (aturan sama seperti wallet: expiry terjauh > sekarang). */
export function hasActiveUnlimited(userId: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM nexabot_topup
       WHERE user_id = ? AND kind = 'unlimited' AND status = 'approved'
         AND expires_at IS NOT NULL AND datetime(expires_at) > datetime('now')
       LIMIT 1`,
    )
    .get(userId)
  return !!row
}

export function balanceOf(userId: number): number {
  const row = db.prepare('SELECT balance FROM nexabot_balance WHERE user_id = ?').get(userId) as
    | { balance: number }
    | undefined
  return row?.balance ?? 0
}

/**
 * Apakah member ini baru saja membayar satu generate?
 *
 * Biaya Rp dipotong klien SEBELUM submit (`/api/nexabot/deduct`), jadi saldo
 * bisa sudah 0 tepat setelah potong — mis. sisa pas Rp 150 untuk generate
 * terakhir yang sah. Tanpa bukti potong ini, relay akan menolak job yang sudah
 * dibayar hanya karena `balanceOf()` kebetulan membaca 0.
 *
 * Jendelanya pendek supaya tidak membuka pemakaian kunci induk gratis: setelah
 * jendela lewat, saldo 0 kembali berarti tidak berhak.
 */
export function hasRecentPaidUsage(userId: number, withinMinutes = 15): boolean {
  const menit = Math.max(1, Math.floor(withinMinutes))
  const row = db
    .prepare(
      `SELECT 1 FROM nexabot_usage
       WHERE user_id = ? AND status = 'used' AND cost > 0
         AND created_at >= datetime('now', ?)
       LIMIT 1`,
    )
    .get(userId, `-${menit} minutes`)
  return !!row
}

/** Job yang sudah berjalan di kunci induk oleh member ini, sejak tengah malam UTC. */
export function masterJobsToday(userId: number): number {
  const mulai = new Date()
  mulai.setUTCHours(0, 0, 0, 0)
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM nexabot_upstream_usage
       WHERE user_id = ? AND credential_source = 'master' AND created_at >= ?`,
    )
    .get(userId, mulai.getTime()) as { n: number }
  return row?.n ?? 0
}

export interface Kelayakan {
  ok: boolean
  /** Alasan yang bisa dibaca manusia — dipakai apa adanya sebagai pesan ke klien. */
  reason: string
}

/**
 * Boleh tidaknya seorang member memakai kunci induk.
 *
 * Saldo diperiksa `> 0`, bukan `>= harga`: pemotongan saldo dilakukan klien
 * SEBELUM generate, jadi memeriksa terhadap harga di sini akan menolak member
 * yang barusan membayar. Pencatatan biaya tetap ada di tabel pemakaian upstream.
 */
export function memberMayUseMasterKey(userId: number): Kelayakan {
  const mode = masterKeyMode()
  if (mode === 'off') return { ok: false, reason: 'Kunci induk NexaBot dimatikan di server' }

  const unlimited = hasActiveUnlimited(userId)
  const saldo = balanceOf(userId)

  if (mode === 'unlimited') {
    return unlimited
      ? { ok: true, reason: 'Paket Unlimited aktif' }
      : { ok: false, reason: 'Butuh paket Unlimited aktif untuk memakai kunci NexaBot milik server' }
  }

  if (unlimited) return { ok: true, reason: 'Paket Unlimited aktif' }
  if (saldo > 0) return { ok: true, reason: 'Saldo NexaBot tersedia' }
  // Saldo bisa sudah habis terpotong untuk generate ini (potongan dilakukan
  // klien sebelum submit) — bukti potong terbaru berarti generate ini sudah
  // dibayar dan tetap boleh memakai kunci induk.
  if (hasRecentPaidUsage(userId)) return { ok: true, reason: 'Saldo baru dipotong untuk generate ini' }
  return {
    ok: false,
    reason: 'Saldo NexaBot kosong dan tidak ada paket Unlimited aktif — top up dulu, atau pakai kunci NexaBot milik Anda sendiri',
  }
}

/** Apakah member ini masih di bawah batas harian kunci induk. */
export function underDailyCap(userId: number): Kelayakan {
  const cap = masterDailyCap()
  if (cap <= 0) return { ok: true, reason: 'Tanpa batas harian' }
  const dipakai = masterJobsToday(userId)
  return dipakai < cap
    ? { ok: true, reason: `${dipakai}/${cap} job hari ini` }
    : { ok: false, reason: `Batas harian kunci NexaBot tercapai (${dipakai}/${cap} job hari ini)` }
}

/** Hasil probe kunci induk ke upstream (dipakai tombol "Cek Kunci" di admin). */
export interface MasterKeyCheck {
  ok: boolean
  valid: boolean
  status: number | null
  credit: number | null
  telegram_id: string | null
  /** true = gangguan gateway (timeout/429/5xx); kunci belum tentu salah. */
  transient?: boolean
  error?: string
}

const KOSONG_KUNCI: MasterKeyCheck = { ok: false, valid: false, status: null, credit: null, telegram_id: null }

function angkaKredit(raw: any): number | null {
  for (const sumber of [raw, raw?.data]) {
    if (!sumber || typeof sumber !== 'object') continue
    for (const k of ['credit', 'credits', 'balance', 'remaining_credits', 'credit_balance']) {
      const v = sumber[k]
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v)
    }
  }
  return null
}

function telegramIdKredit(raw: any): string | null {
  const v = raw?.telegram_id ?? raw?.data?.telegram_id
  return v == null || v === '' ? null : String(v)
}

/**
 * Probe kunci induk lewat GET /api/v1/api/credit — endpoint yang sama dipakai
 * relay untuk jalur API key. Tanpa ini, kunci yang salah tidak ketahuan sampai
 * member mengeluh, karena relay hanya mencatatnya sebagai pemakaian upstream.
 *
 * `keyOverride` dipakai panel admin untuk memeriksa SATU akun dari pool tanpa
 * mengubah kunci akun utama.
 */
export async function checkMasterKey(
  timeoutMs = 20000,
  keyOverride?: string | null,
): Promise<MasterKeyCheck> {
  if (keyOverride != null) {
    const kunci = keyOverride.trim()
    if (!kunci) return { ...KOSONG_KUNCI, error: 'Kunci akun kosong' }
    if (looksLikeSessionCookie(kunci)) {
      return {
        ...KOSONG_KUNCI,
        error: 'Nilai di kolom kunci adalah cookie sesi, bukan API key — pindahkan ke slot Sesi Unlimited',
      }
    }
    return probeKunci(kunci, timeoutMs)
  }

  const mentah = mentahMasterKey()
  if (looksLikeSessionCookie(mentah)) {
    return {
      ...KOSONG_KUNCI,
      error: 'Nilai di kolom kunci adalah cookie sesi, bukan API key — pindahkan ke slot Sesi Unlimited',
    }
  }
  const kunci = masterKey()
  if (!kunci) return { ...KOSONG_KUNCI, error: 'Kunci Server NexaBot belum diatur' }

  return probeKunci(kunci, timeoutMs)
}

/**
 * Coba ulang koneksi. Kegagalan jaringan ke nexabot.id (ECONNRESET / connect
 * timeout) muncul sesekali dan bukan tanda kunci salah; satu kegagalan saja
 * sudah cukup membuat tombol Cek Kunci tampak seperti kunci yang dicabut.
 */
const PERCOBAAN_KONEKSI = 3

async function probeKunci(kunci: string, timeoutMs: number): Promise<MasterKeyCheck> {
  let terakhir: any = null
  for (let percobaan = 1; percobaan <= PERCOBAAN_KONEKSI; percobaan++) {
    if (percobaan > 1) {
      await new Promise((r) => setTimeout(r, percobaan === 2 ? 800 : 2000))
    }
    try {
      const res = await fetch(`${NEXABOT_BASE}/api/v1/api/credit`, {
        method: 'GET',
        headers: { 'x-api-key': kunci, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 401 || res.status === 403) {
        return {
          ...KOSONG_KUNCI,
          status: res.status,
          error: 'API key ditolak penyedia — buat kunci baru di dashboard nexabot.id lalu simpan ulang di sini',
        }
      }
      if (!res.ok) {
        return {
          ...KOSONG_KUNCI,
          status: res.status,
          transient: res.status === 408 || res.status === 429 || res.status >= 500,
          error: `Cek kunci gagal: HTTP ${res.status}`,
        }
      }

      const raw = (await res.json().catch(() => null)) as any
      if (raw && raw.ok === false) {
        return { ...KOSONG_KUNCI, status: res.status, error: String(raw.error || 'Kunci ditolak penyedia') }
      }
      return {
        ok: true,
        valid: true,
        status: res.status,
        credit: angkaKredit(raw),
        telegram_id: telegramIdKredit(raw),
      }
    } catch (err: any) {
      terakhir = err
    }
  }

  const timeout = terakhir?.name === 'TimeoutError' || terakhir?.name === 'AbortError'
  const kode = terakhir?.cause?.code || terakhir?.code
  return {
    ...KOSONG_KUNCI,
    transient: true,
    error: timeout
      ? `Cek kunci timeout setelah ${PERCOBAAN_KONEKSI} percobaan — upstream tidak menjawab`
      : `Cek kunci gagal: ${terakhir?.message || terakhir}${kode ? ` (${kode})` : ''}`,
  }
}

/**
 * Kelayakan lengkap memakai kunci induk: konfigurasi server + status member +
 * batas harian. Dipakai relay (penegakan) DAN halaman wallet (tampilan), supaya
 * UI tidak pernah menjanjikan akses yang relay akan tolak.
 */
export function masterKeyEligibility(userId: number): Kelayakan {
  if (!masterKey()) {
    return { ok: false, reason: 'Kunci NexaBot milik server belum dikonfigurasi admin' }
  }
  const izin = memberMayUseMasterKey(userId)
  if (!izin.ok) return izin
  const cap = underDailyCap(userId)
  if (!cap.ok) return cap
  // Alasan kelayakan (saldo/Unlimited) yang menjelaskan MENGAPA member boleh,
  // bukan info batas harian yang tidak berguna saat cap dimatikan (default).
  return { ok: true, reason: masterDailyCap() > 0 ? `${izin.reason} · ${cap.reason}` : izin.reason }
}
