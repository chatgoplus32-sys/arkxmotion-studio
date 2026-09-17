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

/** Kunci induk dari env, atau null kalau tidak dikonfigurasi / dimatikan. */
export function masterKey(): string | null {
  if (masterKeyMode() === 'off') return null
  const raw = (process.env.NEXABOT_MASTER_API_KEY || '').trim()
  return raw || null
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
