import db from '../db.js'
import { PROVIDER_SPECS, type ServerKeyProvider } from './providerMasterKey.js'

/**
 * Tiket pembayaran untuk jalur kunci server Alriz / Seavi.
 *
 * Kenapa ada
 * ----------
 * Potongan saldo dilakukan klien lewat `/api/alriz/deduct` atau
 * `/api/seavi/deduct`, sedangkan relay yang menyuntikkan kunci server tidak
 * pernah tahu apakah potongan itu benar-benar terjadi. Tanpa tiket, member
 * (atau siapa pun yang memegang JWT-nya) bisa memanggil relay langsung dan
 * memakai kunci operator berkali-kali padahal saldonya sudah habis.
 *
 * Klien mengirim `usage_id` hasil `/deduct` sebagai header X-Provider-Charge.
 * Satu usage boleh menghasilkan sebanyak `units` job — angka itu ditulis
 * server saat potong (mis. Motion Control multi-slot membayar 3 job sekaligus),
 * jadi klien tidak bisa mengarang jumlahnya.
 */

/** Umur maksimum usage yang masih boleh dipakai sebagai tiket. */
export const CHARGE_TICKET_TTL_MS = 2 * 60 * 60 * 1000

export interface TicketCheck {
  ok: boolean
  usageId?: number
  reason?: string
}

interface UsageRow {
  id: number
  units: number
  status: string
  age_ms: number
}

/**
 * Klaim satu jatah job dari usage ini. Aman dipanggil paralel: UPDATE bersyarat
 * `used_jobs < max_jobs` memastikan jumlah job tidak melebihi yang dibayar.
 */
export function claimChargeTicket(
  provider: ServerKeyProvider,
  userId: number,
  rawUsageId: unknown,
): TicketCheck {
  const usageId = typeof rawUsageId === 'string' ? Number(rawUsageId.trim()) : Number(rawUsageId)
  if (!Number.isInteger(usageId) || usageId <= 0) {
    return {
      ok: false,
      reason:
        'Pembayaran generate ini belum terverifikasi server (tiket X-Provider-Charge tidak ada). ' +
        'Muat ulang aplikasi lalu coba lagi.',
    }
  }

  // Umur dihitung di SQL supaya tidak tergantung timezone mesin (CURRENT_TIMESTAMP
  // SQLite = UTC).
  const tabel = PROVIDER_SPECS[provider].usageTable
  const usage = db.prepare(`
    SELECT id, units, status,
           CAST((julianday('now') - julianday(created_at)) * 86400000 AS INTEGER) AS age_ms
    FROM ${tabel}
    WHERE id = ? AND user_id = ?
  `).get(usageId, userId) as UsageRow | undefined

  if (!usage) {
    return { ok: false, reason: 'Tiket pembayaran tidak ditemukan untuk akun ini.' }
  }
  if (usage.status !== 'used') {
    return { ok: false, reason: 'Tiket pembayaran sudah tidak berlaku (generate dibatalkan/direfund).' }
  }
  if (usage.age_ms > CHARGE_TICKET_TTL_MS) {
    return { ok: false, reason: 'Tiket pembayaran kedaluwarsa — muat ulang aplikasi lalu coba lagi.' }
  }

  const maxJobs = Math.max(1, Number(usage.units) || 1)
  const now = Date.now()
  db.prepare(`
    INSERT INTO provider_charge_ticket (provider, usage_id, user_id, max_jobs, used_jobs, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(provider, usage_id) DO NOTHING
  `).run(provider, usageId, userId, maxJobs, now, now)

  const klaim = db.prepare(`
    UPDATE provider_charge_ticket
    SET used_jobs = used_jobs + 1, updated_at = ?
    WHERE provider = ? AND usage_id = ? AND used_jobs < max_jobs
  `).run(now, provider, usageId)

  if (klaim.changes === 0) {
    return {
      ok: false,
      reason: `Tiket pembayaran ini sudah dipakai untuk ${maxJobs} job yang dibayar.`,
    }
  }
  return { ok: true, usageId }
}

/** Upstream jelas menolak sebelum job dibuat: kembalikan jatah yang diklaim. */
export function releaseChargeTicket(provider: ServerKeyProvider, usageId: number): void {
  try {
    db.prepare(`
      UPDATE provider_charge_ticket
      SET used_jobs = MAX(0, used_jobs - 1), updated_at = ?
      WHERE provider = ? AND usage_id = ?
    `).run(Date.now(), provider, usageId)
  } catch (error) {
    console.error(`[provider-ticket] gagal melepas tiket ${provider}:`, error)
  }
}

/** Upstream menerima job: simpan id-nya untuk jejak (jatah tetap terpakai). */
export function noteChargeTicketJob(provider: ServerKeyProvider, usageId: number, jobId: string | null): void {
  try {
    db.prepare(`
      UPDATE provider_charge_ticket SET last_job_id = ?, updated_at = ?
      WHERE provider = ? AND usage_id = ?
    `).run(jobId, Date.now(), provider, usageId)
  } catch (error) {
    console.error(`[provider-ticket] gagal mencatat job ${provider}:`, error)
  }
}
