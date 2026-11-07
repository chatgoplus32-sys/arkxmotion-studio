import db from '../db.js'

/**
 * Kuota harian NexaDance 3.0 untuk pemegang paket (Premium Booster / Unlimited).
 *
 * Kenapa ada
 * ----------
 * Paket membebaskan saldo rupiah member, TAPI setiap video NexaDance 3.0 tetap
 * menagih 0,5 kredit ke akun NexaBot milik operator (endpoint
 * /api/v1/alt-video/generate selalu pay-as-you-go — jalur cookie Unlimited
 * ditolak 401). Tanpa batas, satu member bisa menghabiskan kredit server
 * sendirian dalam sehari.
 *
 * Hitungannya memakai baris `nexabot_usage` yang sudah dicatat /deduct, jadi
 * tidak ada tabel baru. Baris berstatus 'refunded' (generate gagal lalu saldo
 * dikembalikan) tidak dihitung — member tidak boleh kehilangan jatah karena
 * kegagalan upstream.
 *
 * Batas hari memakai WIB (UTC+7), bukan UTC: member Indonesia harus mendapat
 * jatah baru saat tengah malam lokal, bukan jam 07.00 pagi.
 */
export const NEXADANCE_DAILY_LIMIT = 5

export interface NexadanceQuota {
  limit: number
  used: number
  remaining: number
  /** true kalau jatah hari ini sudah habis. */
  habis: boolean
}

/**
 * Jumlah video NexaDance yang benar-benar terpakai hari ini (WIB).
 *
 * `seedance%` ikut dihitung: baris lama (sebelum rebrand ke NexaDance 3.0)
 * tetap tercatat dengan nama itu, dan jatah hari itu tidak boleh terlihat
 * kembali penuh hanya karena nama modelnya berubah.
 */
export function nexadanceUsedToday(userId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM nexabot_usage
        WHERE user_id = ?
          AND status = 'used'
          AND (model LIKE 'nexadance%' OR model LIKE 'seedance%')
          AND date(created_at, '+7 hours') = date('now', '+7 hours')`,
    )
    .get(userId) as { n: number } | undefined
  return Number(row?.n ?? 0)
}

export function nexadanceQuota(userId: number): NexadanceQuota {
  const used = nexadanceUsedToday(userId)
  return {
    limit: NEXADANCE_DAILY_LIMIT,
    used,
    remaining: Math.max(0, NEXADANCE_DAILY_LIMIT - used),
    habis: used >= NEXADANCE_DAILY_LIMIT,
  }
}

/**
 * Pesan siap tampil untuk klien. Menyebut kuota dan waktu reset supaya member
 * tidak mengira saldo/paketnya rusak.
 */
export function nexadanceQuotaMessage(q: NexadanceQuota): string {
  return `Kuota NexaDance 3.0 hari ini habis (${q.used}/${q.limit} video). Jatah baru terbuka besok pukul 00.00 WIB — Omni Flash 1.2 dan GPT Image tetap gratis tanpa batas selama paket aktif.`
}
