/**
 * Aktivasi pembayaran Member (join Pro) & Upgrade Pro — dipakai baik oleh
 * approve manual admin (`/api/admin/membership|pro/payments/:id/approve`)
 * maupun oleh verifikasi otomatis BasuniPay / email / paste mutasi.
 *
 * Satu sumber kebenaran: update membership_payments|pro_payments → update
 * users → kirim email (fire-and-forget) → notifikasi + log audit.
 */
import db from '../db.js'
import { sendEmail, appUrl } from '../mailer.js'
import { logPaymentVerify } from './qrisPayment.js'

export interface ActivationResult {
  ok: boolean
  reason?: string
  email?: string
  name?: string
  userId?: number
}

/**
 * Setujui membership_payments + jadikan akun Pro. Mengembalikan detail untuk
 * pesan jawaban admin.
 */
export function approveMembershipPaymentRow(id: number | string, source = 'manual'): ActivationResult {
  const pid = Number(id)
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, reason: 'id_tidak_valid' }
  const payment = db.prepare(
    "SELECT mp.id, mp.user_id, mp.status, u.email, u.name FROM membership_payments mp JOIN users u ON u.id = mp.user_id WHERE mp.id = ?",
  ).get(pid) as { id: number; user_id: number; status: string; email: string; name: string } | undefined
  if (!payment) return { ok: false, reason: 'tidak_ditemukan' }
  if (payment.status === 'approved') return { ok: false, reason: 'sudah_approve' }

  db.transaction(() => {
    db.prepare("UPDATE membership_payments SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(pid)
    db.prepare(
      "UPDATE users SET approved = 1, email_verified = 1, plan = 'pro', pro_since = COALESCE(pro_since, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(payment.user_id)
  })()

  // Email & notifikasi — gagal email TIDAK menggagalkan approve.
  void sendEmail({
    to: payment.email,
    subject: 'Pembayaran Disetujui & Pro Aktif — ARKXMotion Studio ✅',
    text: `Halo ${payment.name},\n\nPembayaran kamu telah disetujui, akun diaktifkan, dan otomatis menjadi Pro. Semua fitur AI sudah terbuka. Login di ${appUrl()}/login\n— ARKXMotion Studio`,
    html: `<p>Halo <b>${payment.name}</b>,</p><p>Pembayaran kamu <b>disetujui</b>, akun telah diaktifkan, dan otomatis menjadi <b>Pro</b>. Semua fitur AI sudah terbuka.</p><p><a href="${appUrl()}/login" style="background:#d4a017;color:#000;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Login Sekarang</a></p>`,
  }).catch((e) => console.warn('[membership-activation] email gagal:', e?.message || e))

  try {
    db.prepare("INSERT INTO notifications (title, message, type, target, user_id) VALUES (?, ?, 'success', 'users', ?)").run(
      'Pembayaran Disetujui — Pro Aktif',
      'Pembayaran kamu disetujui. Akun aktif dan semua fitur AI terbuka.',
      payment.user_id,
    )
    db.prepare("INSERT INTO notifications (title, message, type, target) VALUES (?, ?, 'warning', 'admins')").run(
      'Pembayaran Member Masuk (auto)',
      `Member ${payment.name} (${payment.email}) — membership_payments #${pid} disetujui (${source}).`,
    )
  } catch (e) { console.warn('[membership-activation] notif gagal:', e) }

  logPaymentVerify({
    source,
    refTable: 'membership_payments',
    refId: pid,
    action: 'auto_activated',
    emailFrom: payment.email,
    detail: 'Membership disetujui, akun Pro aktif',
  })
  return { ok: true, email: payment.email, name: payment.name, userId: payment.user_id }
}

/** Setujui pro_payments + aktifkan plan Pro user tersebut. */
export function approveProPaymentRow(id: number | string, source = 'manual'): ActivationResult {
  const pid = Number(id)
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, reason: 'id_tidak_valid' }
  const payment = db.prepare(
    'SELECT pp.id, pp.user_id, pp.status, u.email, u.name FROM pro_payments pp JOIN users u ON u.id = pp.user_id WHERE pp.id = ?',
  ).get(pid) as { id: number; user_id: number; status: string; email: string; name: string } | undefined
  if (!payment) return { ok: false, reason: 'tidak_ditemukan' }
  if (payment.status === 'approved') return { ok: false, reason: 'sudah_approve' }

  db.transaction(() => {
    db.prepare("UPDATE pro_payments SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(pid)
    db.prepare(
      "UPDATE users SET plan = 'pro', pro_since = COALESCE(pro_since, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(payment.user_id)
  })()

  void sendEmail({
    to: payment.email,
    subject: 'Upgrade Pro Berhasil — ARKXMotion Studio ⭐',
    text: `Halo ${payment.name},\n\nPembayaran upgrade Pro kamu sudah disetujui. Akun kamu sekarang Pro dan menu Gemini Tools sudah terbuka.\n\nMulai sekarang: ${appUrl()}/tools/gemini-tools\n— ARKXMotion Studio`,
    html: `<p>Halo <b>${payment.name}</b>,</p><p>Pembayaran upgrade <b>Pro</b> kamu sudah disetujui. Akun kamu sekarang <b>Pro</b> dan menu <b>Gemini Tools</b> sudah terbuka.</p><p><a href="${appUrl()}/tools/gemini-tools" style="background:#d4a017;color:#000;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Buka Gemini Tools</a></p><p>— ARKXMotion Studio</p>`,
  }).catch((e) => console.warn('[pro-activation] email gagal:', e?.message || e))

  try {
    db.prepare("INSERT INTO notifications (title, message, type, target, user_id) VALUES (?, ?, 'success', 'users', ?)").run(
      'Upgrade Pro Disetujui',
      'Akun kamu sekarang Pro — Gemini Tools sudah terbuka.',
      payment.user_id,
    )
    db.prepare("INSERT INTO notifications (title, message, type, target) VALUES (?, ?, 'warning', 'admins')").run(
      'Upgrade Pro Masuk (auto)',
      `User ${payment.name} (${payment.email}) — pro_payments #${pid} disetujui (${source}).`,
    )
  } catch (e) { console.warn('[pro-activation] notif gagal:', e) }

  logPaymentVerify({
    source,
    refTable: 'pro_payments',
    refId: pid,
    action: 'auto_activated',
    emailFrom: payment.email,
    detail: 'Upgrade Pro disetujui',
  })
  return { ok: true, email: payment.email, name: payment.name, userId: payment.user_id }
}
