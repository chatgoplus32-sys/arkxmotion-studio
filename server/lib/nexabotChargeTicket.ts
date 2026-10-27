import db from '../db.js'

/**
 * Tiket pembayaran untuk jalur kredensial server di relay NexaBot.
 *
 * Kenapa ada
 * ----------
 * Potongan Rp 150 dilakukan klien lewat `/api/nexabot/deduct`, sedangkan relay
 * yang menyuntikkan kunci/sesi induk tidak pernah tahu apakah potongan itu
 * terjadi. Akibatnya member bisa memanggil relay langsung (tanpa browser) dan
 * memakai kredensial server berkali-kali hanya dengan saldo > 0 — biaya
 * upstream-nya ditanggung operator, bukan member.
 *
 * Sekarang relay menuntut `usage_id` hasil `/deduct` (header X-Nexabot-Charge)
 * sebelum memakai kredensial server. Sekali dipakai untuk job yang benar-benar
 * dibuat upstream, tiket itu hangus — jadi satu potongan = satu job.
 *
 * Yang TIDAK diwajibkan: member yang memakai kunci/cookie sendiri (tidak ada
 * uang operator yang dipakai) dan admin (mereka mengelola kredensial server).
 */

/** Umur maksimum usage yang masih boleh dipakai sebagai tiket. */
export const CHARGE_TICKET_TTL_MS = 30 * 60 * 1000

/**
 * Reservasi yang lebih tua dari ini dianggap percobaan yang ditinggalkan:
 * klien tidak mengulang submit setelah 5xx/putus koneksi (hanya 429/throttle,
 * dan itu melepas reservasi). Menahannya lebih lama hanya menyisakan tiket
 * yang tidak bisa dipakai padahal tidak pernah menghasilkan job.
 */
const RESERVATION_TTL_MS = 2 * 60 * 1000

export interface TicketCheck {
  ok: boolean
  usageId?: number
  reason?: string
}

export function isAdminUser(userId: number): boolean {
  try {
    const row = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role?: string } | undefined
    return row?.role === 'admin'
  } catch {
    return false
  }
}

interface UsageRow {
  id: number
  cost: number
  status: string
  age_ms: number
}

/**
 * Validasi + reservasi tiket. Aman dipanggil sebelum request ke upstream:
 * reservasi ini yang mencegah dua request bersamaan memakai tiket yang sama.
 */
export function reserveChargeTicket(userId: number, rawUsageId: unknown, route: string): TicketCheck {
  const usageId = typeof rawUsageId === 'string' ? Number(rawUsageId.trim()) : Number(rawUsageId)
  if (!Number.isInteger(usageId) || usageId <= 0) {
    return {
      ok: false,
      reason:
        'Pembayaran generate ini belum terverifikasi server (tiket X-Nexabot-Charge tidak ada). ' +
        'Muat ulang aplikasi lalu coba lagi.',
    }
  }

  // Umur dihitung di SQL supaya tidak tergantung timezone mesin (CURRENT_TIMESTAMP
  // SQLite = UTC).
  const usage = db.prepare(`
    SELECT id, cost, status,
           CAST((julianday('now') - julianday(created_at)) * 86400000 AS INTEGER) AS age_ms
    FROM nexabot_usage
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

  const tiket = db
    .prepare('SELECT state, updated_at FROM nexabot_charge_ticket WHERE usage_id = ?')
    .get(usageId) as { state: string; updated_at: number } | undefined

  if (tiket?.state === 'consumed') {
    return { ok: false, reason: 'Tiket pembayaran ini sudah dipakai untuk job lain.' }
  }

  const now = Date.now()
  if (!tiket) {
    db.prepare(
      `INSERT INTO nexabot_charge_ticket (usage_id, user_id, route, state, created_at, updated_at)
       VALUES (?, ?, ?, 'reserved', ?, ?)`,
    ).run(usageId, userId, route, now, now)
    return { ok: true, usageId }
  }

  if (now - tiket.updated_at > RESERVATION_TTL_MS) {
    return {
      ok: false,
      reason: 'Tiket pembayaran ini tertahan percobaan sebelumnya yang tidak menghasilkan job — coba generate sekali lagi.',
    }
  }
  // Percobaan ulang yang sah (mis. upstream membalas 429): perpanjang reservasi.
  db.prepare('UPDATE nexabot_charge_ticket SET updated_at = ?, route = ? WHERE usage_id = ?').run(now, route, usageId)
  return { ok: true, usageId }
}

/** Upstream sudah menerima job: tiket hangus. */
export function consumeChargeTicket(usageId: number, jobId: string | null): void {
  try {
    db.prepare(
      "UPDATE nexabot_charge_ticket SET state = 'consumed', job_id = ?, updated_at = ? WHERE usage_id = ? AND state = 'reserved'",
    ).run(jobId, Date.now(), usageId)
  } catch (error) {
    console.error('[nexabot-ticket] gagal menandai tiket terpakai:', error)
  }
}

/** Upstream jelas menolak sebelum membuat job (429/4xx): tiket boleh dipakai lagi. */
export function releaseChargeTicket(usageId: number): void {
  try {
    db.prepare("DELETE FROM nexabot_charge_ticket WHERE usage_id = ? AND state = 'reserved'").run(usageId)
  } catch (error) {
    console.error('[nexabot-ticket] gagal melepas tiket:', error)
  }
}
