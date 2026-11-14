/**
 * Aktivasi Paket Unlimited NexaBot — dipakai baik oleh approve manual admin
 * (`/api/admin/topup/approve`) maupun oleh verifikasi otomatis BasuniPay.
 *
 * Paket aktif saat pembayaran diverifikasi, dengan penumpukan masa berlaku:
 * pembelian baru menumpuk di atas expiry TERJAUH yang sudah disetujui (per
 * kelas paket), bukan menghapus sisa hari yang masih jalan.
 */
import db from '../db.js'
import { NEXABOT_SCOPED_SLUGS, isScopedPackage, nexabotPackageName } from '../../shared/pricing.js'

export interface UnifiedActivationResult {
  name: string
  expires_at: string | null
  days_left: number
  days: number
}

/** Sisa hari dari DATETIME SQLite (UTC yang disimpan tanpa penanda zona). */
export function remainingDays(expiresAt: string | null | undefined): number {
  if (!expiresAt) return 0
  const end = new Date(expiresAt.replace(' ', 'T') + 'Z').getTime()
  if (!Number.isFinite(end)) return 0
  return Math.max(0, Math.ceil((end - Date.now()) / 86400000))
}

/**
 * Aktivasi satu baris nexabot_topup kind='unlimited'. Aman dipanggil dari
 * dalam transaksi lain? Tidak dibutuhkan — dipanggil di luar transaksi.
 */
export function activateUnlimitedTopup(topup: any, adminNote: string): UnifiedActivationResult {
  const id: number = topup.id
  const days = Number(topup.days) || 7
  // Penumpukan masa berlaku HANYA dihitung di dalam kelas paket yang sama
  // (ber-scope vs tidak), supaya pembelian Booster tidak menjulur di atas
  // Bulanan dan sebaliknya.
  const punyaSlug = 'package_slug' in topup
  const kelasBerScope = isScopedPackage(topup.package_slug)
  const tanda = NEXABOT_SCOPED_SLUGS.map(() => '?').join(', ')
  const pakaiPemisah = punyaSlug && NEXABOT_SCOPED_SLUGS.length > 0
  const syaratKelas = pakaiPemisah
    ? kelasBerScope
      ? `AND package_slug IN (${tanda})`
      : `AND (package_slug IS NULL OR package_slug NOT IN (${tanda}))`
    : ''
  const paramKelas = pakaiPemisah ? NEXABOT_SCOPED_SLUGS : []
  const priorExpiry =
    (db.prepare(`
        SELECT MAX(expires_at) AS expires_at FROM nexabot_topup
        WHERE user_id = ? AND kind = 'unlimited' AND status = 'approved' AND id <> ? ${syaratKelas}
      `).get(topup.user_id, id, ...paramKelas) as { expires_at: string | null } | undefined)?.expires_at || null

  db.prepare(`
      UPDATE nexabot_topup
         SET status = 'approved',
             admin_note = ?,
             started_at = datetime('now'),
             expires_at = datetime(MAX(COALESCE(?, datetime('now')), datetime('now')), ?),
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `).run(adminNote || '', priorExpiry, `+${days} days`, id)

  const activated = db.prepare('SELECT expires_at FROM nexabot_topup WHERE id = ?').get(id) as { expires_at: string } | undefined
  return {
    name: nexabotPackageName(topup.package_slug, days),
    expires_at: activated?.expires_at || null,
    days_left: remainingDays(activated?.expires_at),
    days,
  }
}
