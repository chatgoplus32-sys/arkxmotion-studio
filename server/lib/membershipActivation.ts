/**
 * Aktivasi pembayaran Member (join Pro) & Upgrade Pro — dipakai baik oleh
 * approve manual admin (`/api/admin/membership|pro/payments/:id/approve`)
 * maupun oleh verifikasi otomatis VelianPay / email / paste mutasi.
 *
 * Satu sumber kebenaran: update membership_payments|pro_payments → update
 * users → kirim email (fire-and-forget) → notifikasi + log audit.
 */
import db from '../db.js'
import { sendEmail, appUrl } from '../mailer.js'
import { logPaymentVerify } from './qrisPayment.js'
import { creditCommissionForPayment } from './affiliate.js'

export interface AddonAccount {
  email: string
  password: string
  note?: string
}

/** Bersihkan daftar akun dari admin: maks 10, tiap field dipotong 200 char. */
export function sanitizeAddonAccounts(input: unknown): AddonAccount[] {
  if (!Array.isArray(input)) return []
  const out: AddonAccount[] = []
  for (const raw of input.slice(0, 10)) {
    if (!raw || typeof raw !== 'object') continue
    const email = String((raw as any).email ?? '').trim().slice(0, 200)
    const password = String((raw as any).password ?? '').trim().slice(0, 200)
    const note = String((raw as any).note ?? '').trim().slice(0, 200)
    if (!email) continue
    out.push(note ? { email, password, note } : { email, password })
  }
  return out
}

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
    // Komisi afiliasi (25% dari fee join) — kalau member ini datang lewat link
    // member lain. Dijaga supaya kegagalan komisi TIDAK membatalkan aktivasi.
    try {
      creditCommissionForPayment(pid, source)
    } catch (e) {
      console.warn('[affiliate] komisi gagal:', e)
    }
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

// ─── Add-on Akun (3 email siap pakai / 30 hari) ────────────────────────────
const ADDON_PERIOD_DAYS = 30

function parseDbDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDbDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  )
}

/**
 * Approve account_addon_payments: tandai lunas + set/perpanjang periode 30
 * hari. Satu payment = satu periode 30 hari; memperpanjang dari expiry
 * terakhir bila masih aktif. `accounts` (opsional) disimpan untuk ditampilkan
 * ke member.
 */
export function approveAddonPaymentRow(
  id: number | string,
  source = 'manual',
  accounts?: AddonAccount[],
): ActivationResult {
  const pid = Number(id)
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, reason: 'id_tidak_valid' }
  const payment = db.prepare(
    'SELECT ap.id, ap.user_id, ap.status, u.email, u.name FROM account_addon_payments ap JOIN users u ON u.id = ap.user_id WHERE ap.id = ?',
  ).get(pid) as { id: number; user_id: number; status: string; email: string; name: string } | undefined
  if (!payment) return { ok: false, reason: 'tidak_ditemukan' }
  if (payment.status === 'approved') return { ok: false, reason: 'sudah_approve' }

  // Perpanjangan: kalau user masih punya periode aktif, tambah 30 hari dari
  // expiry terakhir; kalau tidak, mulai dari sekarang.
  const current = db.prepare(
    "SELECT period_end FROM account_addon_payments WHERE user_id = ? AND status = 'approved' AND period_end > datetime('now') ORDER BY period_end DESC LIMIT 1",
  ).get(payment.user_id) as { period_end: string | null } | undefined
  const now = new Date()
  const currentEnd = parseDbDate(current?.period_end)
  const periodStart = currentEnd && currentEnd > now ? currentEnd : now
  const periodEnd = new Date(periodStart.getTime() + ADDON_PERIOD_DAYS * 24 * 60 * 60 * 1000)

  const cleanAccounts = accounts && accounts.length > 0 ? sanitizeAddonAccounts(accounts) : null

  db.transaction(() => {
    if (cleanAccounts) {
      db.prepare(
        "UPDATE account_addon_payments SET status = 'approved', period_start = ?, period_end = ?, accounts = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).run(formatDbDate(periodStart), formatDbDate(periodEnd), JSON.stringify(cleanAccounts), pid)
    } else {
      db.prepare(
        "UPDATE account_addon_payments SET status = 'approved', period_start = ?, period_end = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).run(formatDbDate(periodStart), formatDbDate(periodEnd), pid)
    }
  })()

  const periodEndText = periodEnd.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

  void sendEmail({
    to: payment.email,
    subject: 'Add-on Akun Aktif — ARKXMotion Studio',
    text: `Halo ${payment.name},\n\nPembayaran Add-on Akun kamu sudah disetujui. 3 akun email siap pakai berlaku sampai ${periodEndText} dan bisa dilihat di halaman Add-on Akun.\n\nBuka: ${appUrl()}/addon-akun\n— ARKXMotion Studio`,
    html: `<p>Halo <b>${payment.name}</b>,</p><p>Pembayaran <b>Add-on Akun</b> kamu sudah disetujui. <b>3 akun email siap pakai</b> berlaku sampai <b>${periodEndText}</b> dan bisa dilihat di halaman Add-on Akun.</p><p><a href="${appUrl()}/addon-akun" style="background:#d4a017;color:#000;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Buka Add-on Akun</a></p><p>— ARKXMotion Studio</p>`,
  }).catch((e) => console.warn('[addon-activation] email gagal:', e?.message || e))

  try {
    db.prepare("INSERT INTO notifications (title, message, type, target, user_id) VALUES (?, ?, 'success', 'users', ?)").run(
      'Add-on Akun Aktif',
      `Pembayaran Add-on Akun kamu disetujui — 3 akun email berlaku sampai ${periodEndText}. Buka menu Add-on Akun untuk melihat akun.`,
      payment.user_id,
    )
    db.prepare("INSERT INTO notifications (title, message, type, target) VALUES (?, ?, 'warning', 'admins')").run(
      'Add-on Akun Masuk (auto)',
      `User ${payment.name} (${payment.email}) — account_addon_payments #${pid} disetujui (${source}). Serahkan 3 akun email lewat halaman Admin → Membership.`,
    )
  } catch (e) { console.warn('[addon-activation] notif gagal:', e) }

  logPaymentVerify({
    source,
    refTable: 'account_addon_payments',
    refId: pid,
    action: 'auto_activated',
    emailFrom: payment.email,
    detail: `Add-on Akun aktif sampai ${formatDbDate(periodEnd)}`,
  })
  return { ok: true, email: payment.email, name: payment.name, userId: payment.user_id }
}
