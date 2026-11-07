import nodemailer from 'nodemailer'
import dotenv from 'dotenv'

dotenv.config()

/**
 * Kirim email via SMTP (konfigurasi lewat env):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, APP_URL
 *
 * Bila SMTP belum dikonfigurasi, email tidak benar-benar terkirim —
 * isi email di-log ke console dan fungsi mengembalikan { sent: false }.
 * Endpoint yang memanggil mailer boleh menampilkan link langsung
 * (mode dev) supaya alurnya tetap bisa diuji.
 */
export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
}

export async function sendEmail(opts: {
  to: string
  subject: string
  text: string
  html?: string
}): Promise<{ sent: boolean; preview?: string }> {
  if (!isMailConfigured()) {
    console.log(`[mailer] SMTP tidak dikonfigurasi — email TIDAK terkirim ke ${opts.to}`)
    console.log(`[mailer] Subject: ${opts.subject}`)
    console.log(`[mailer] Body:\n${opts.text}`)
    return { sent: false }
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER!,
        pass: process.env.SMTP_PASS!,
      },
    })

    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    })

    console.log(`[mailer] Email terkirim ke ${opts.to}: ${info.messageId}`)
    return { sent: true, preview: nodemailer.getTestMessageUrl(info) || undefined }
  } catch (err: any) {
    console.error(`[mailer] Gagal kirim email ke ${opts.to}:`, err.message)
    return { sent: false }
  }
}

/** URL dasar app untuk membangun link verifikasi/reset. */
export function appUrl(): string {
  return process.env.APP_URL || 'http://localhost:5173'
}

/**
 * Bolehkah link verifikasi/reset dikembalikan di respons API?
 *
 * Hanya untuk pengembangan lokal. Di produksi link TIDAK boleh ikut respons:
 * saat SMTP gagal, siapa pun yang menebak email terdaftar bisa meminta link
 * reset dan langsung mengambil alih akun. Karena `NODE_ENV` di VPS sering
 * tidak diset, APP_URL-lah yang jadi penentu utama — bukan NODE_ENV.
 *
 * Override sadar: MAIL_DEV_LINK=1 (paksa tampilkan) / MAIL_DEV_LINK=0 (matikan).
 */
export function allowDevMailLink(): boolean {
  const flag = process.env.MAIL_DEV_LINK
  if (flag === '1') return true
  if (flag === '0') return false
  if (process.env.NODE_ENV === 'production') return false
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(appUrl())
}
