/**
 * Pemantau email notifikasi bank/e-wallet untuk verifikasi pembayaran QRIS.
 *
 * Alur: inbox menerima email notifikasi transfer masuk (user meneruskan
 * notifikasi dari bank/e-wallet ke inbox ini) → watcher membaca pesan BELUM
 * dibaca tiap 5 menit → ekstrak nominal → `matchIncomingAmount` mencocokkan
 * ke baris top-up pending lewat kode unik → saldo dikredit / ditandai lunas.
 *
 * Konfigurasi (.env):
 *   PAYMENT_IMAP_HOST     imap.gmail.com / outlook.office365.com / dll
 *   PAYMENT_IMAP_PORT     default 993
 *   PAYMENT_IMAP_SECURE   default true (SSL)
 *   PAYMENT_IMAP_USER     alamat inbox
 *   PAYMENT_IMAP_PASS     app-password / kata sandi IMAP
 *   PAYMENT_IMAP_ENABLED  'false' untuk mematikan tanpa menghapus kredensial
 *
 * Pesan ditandai \Seen setelah diproses — jadi tidak ada cursor terpisah,
 * dan restart server tidak memproses email yang sama dua kali.
 */
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import db from '../db.js'
import { extractAmounts, matchIncomingAmount, logPaymentVerify } from './qrisPayment.js'
import { alertWarn } from './alerts.js'

const POLL_MS = 5 * 60 * 1000
/** Email yang tidak mirip notifikasi transaksi diabaikan (promo dsb.). */
const TRANSACTION_RE = /transfer|transaksi|pembayaran|mutasi|masuk|debit|diterima|berhasil|qris|top-?up|payment|received|credited/i

interface PaymentImapConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  enabled: boolean
}

export function paymentImapConfig(): PaymentImapConfig {
  return {
    host: (process.env.PAYMENT_IMAP_HOST || '').trim(),
    port: Number(process.env.PAYMENT_IMAP_PORT) || 993,
    secure: String(process.env.PAYMENT_IMAP_SECURE ?? 'true').toLowerCase() !== 'false',
    user: (process.env.PAYMENT_IMAP_USER || '').trim(),
    pass: process.env.PAYMENT_IMAP_PASS || '',
    enabled: String(process.env.PAYMENT_IMAP_ENABLED || '').toLowerCase() !== 'false',
  }
}

export function paymentEmailReady(): boolean {
  const c = paymentImapConfig()
  return c.enabled && !!c.host && !!c.user && !!c.pass
}

function setSetting(key: string, value: string): void {
  try {
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).run(key, value)
  } catch (e) {
    console.warn('[payment-email] Gagal simpan pengaturan:', e)
  }
}

export function getSetting(key: string): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value || ''
}

export interface PaymentEmailStatus {
  ready: boolean
  enabled: boolean
  host: string
  user: string
  last_check_at: string
  last_error: string
  last_result: string
  processed_total: number
}

export function getPaymentEmailStatus(): PaymentEmailStatus {
  const c = paymentImapConfig()
  return {
    ready: paymentEmailReady(),
    enabled: c.enabled,
    host: c.host,
    user: c.user,
    last_check_at: getSetting('payment_email_last_check'),
    last_error: getSetting('payment_email_last_error'),
    last_result: getSetting('payment_email_last_result'),
    processed_total: Number(getSetting('payment_email_processed') || 0),
  }
}

// Satu siklus koneksi — dicegah tumpang-tindih dengan flag sederhana.
let running = false

export interface CheckResult {
  checked: number
  matched: number
  skipped: number
  error?: string
}

/** Satu kali siklus: baca pesan belum-dibaca, cocokkan, tandai \Seen. */
export async function checkPaymentEmailOnce(): Promise<CheckResult> {
  const result: CheckResult = { checked: 0, matched: 0, skipped: 0 }
  if (!paymentEmailReady()) {
    result.error = 'Email verifikasi belum dikonfigurasi (PAYMENT_IMAP_*)'
    return result
  }
  if (running) {
    result.error = 'Siklus sebelumnya masih berjalan'
    return result
  }
  running = true
  const c = paymentImapConfig()
  const client = new ImapFlow({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.pass },
    logger: false,
    tls: { rejectUnauthorized: false },
  })

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      // Pesan belum pernah dibaca (belum diproses watcher).
      for await (const msg of client.fetch({ seen: false }, { envelope: true, source: true, uid: true })) {
        result.checked++
        try {
          const parsed = await simpleParser(msg.source)
          const subject = parsed.subject || ''
          const from = typeof parsed.from?.value?.[0]?.address === 'string' ? String(parsed.from.value[0].address) : ''
          const fromName = parsed.from?.value?.[0]?.name || ''
          const body = [subject, parsed.text || '', stripHtml(parsed.html || '')].join('\n')

          // Bukan notifikasi transaksi (promo/newsletter) → lewati.
          if (!TRANSACTION_RE.test(`${subject} ${fromName} ${from}`)) {
            result.skipped++
            logPaymentVerify({
              action: 'ignored_sender',
              emailFrom: from,
              emailSubject: subject,
              detail: 'Bukan email notifikasi transaksi',
            })
          } else {
            const amounts = extractAmounts(body)
            if (!amounts.length) {
              result.skipped++
              logPaymentVerify({
                action: 'no_amount',
                emailFrom: from,
                emailSubject: subject,
                detail: 'Tidak ada nominal terdeteksi di email',
              })
            } else {
              // Cocokkan dari nominal terbesar dulu — nominal utama transfer
              // biasanya yang paling besar; nominal kecil (biaya) tidak boleh
              // mengambil baris orang lain lebih dulu.
              for (const amount of amounts.sort((a, b) => b - a)) {
                const r = matchIncomingAmount(amount, { from, subject })
                if (r.action !== 'no_match') {
                  result.matched++
                  break // satu email = satu pembayaran
                }
              }
            }
          }
        } catch (e: any) {
          result.skipped++
          console.warn('[payment-email] Gagal memproses pesan:', e?.message)
        }
        // Tandai dibaca SETELAH diproses — kalau proses gagal di tengah,
        // pesan tetap terbaca ulang pada siklus berikutnya.
        await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true })
      }
    } finally {
      lock.release()
    }

    setSetting('payment_email_last_check', new Date().toISOString())
    setSetting('payment_email_last_error', '')
    setSetting('payment_email_last_result', `checked=${result.checked} matched=${result.matched} skipped=${result.skipped}`)
    if (result.checked > 0) {
      const total = Number(getSetting('payment_email_processed') || 0) + result.checked
      setSetting('payment_email_processed', String(total))
    }
  } catch (e: any) {
    result.error = String(e?.message || e)
    setSetting('payment_email_last_error', result.error.slice(0, 300))
    // Alert bercooldown (lihat alerts.ts) — gagal IMAP berulang tidak
    // membanjiri webhook admin.
    alertWarn('Email verifikasi pembayaran gagal dicek', { error: result.error.slice(0, 200), host: c.host })
  } finally {
    try { await client.logout() } catch { /* koneksi sudah tutup */ }
    running = false
  }
  return result
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ')
}

/** Jadwal poll internal — dipanggil dari server/index.ts saat boot. */
export function startPaymentEmailWatcher(): () => void {
  if (!paymentEmailReady()) {
    console.log('[payment-email] Nonaktif — isi PAYMENT_IMAP_* di .env untuk mengaktifkan verifikasi otomatis.')
    return () => {}
  }
  console.log(`[payment-email] Aktif — memantau ${(process.env.PAYMENT_IMAP_USER || '').trim()} tiap ${POLL_MS / 60000} menit.`)
  const timer = setInterval(() => {
    checkPaymentEmailOnce().catch((e) => console.warn('[payment-email] Siklus gagal:', e))
  }, POLL_MS)
  timer.unref?.()
  // Cek pertama ditunda 45 detik supaya server selesai boot dulu.
  const first = setTimeout(() => {
    checkPaymentEmailOnce().catch((e) => console.warn('[payment-email] Siklus awal gagal:', e))
  }, 45_000)
  first.unref?.()
  return () => {
    clearInterval(timer)
    clearTimeout(first)
  }
}
