/**
 * Konektor VelianPay — checkout QRIS dinamis + deteksi bayar otomatis.
 *
 * Alur (sesuai dokumentasi merchant VelianPay, velianpay.my.id):
 *   1. Server POST /api/v1/orders { amount, callback_url, metadata.order_id }
 *      → dapat reference, final_amount, payment_link, qris_branded_image_url
 *   2. Baris top-up di-update ke final_amount (mis. Rp 50.137) —
 *      payment_link/qris_branded_image_url ditampilkan ke user.
 *   3. User bayar QRIS → VelianPay menandai PAID.
 *   4. VelianPay memanggil webhook merchant (POST /api/public/velianpay/webhook)
 *      DAN/ATAU kita polling GET /api/v1/orders/:reference tiap 2 menit.
 *   5. `pollVelianpayPayments` menyetujui baris: kredit saldo / tandai lunas
 *      + notifikasi — memakai mesin yang sama dengan jalur paste-mutasi.
 *
 * Catatan: `order_id` di tabel kita = `reference` dari VelianPay. Karena
 * provider yang menerbitkan reference, kita tidak menebak sendiri.
 *
 * Fail-safe: bila API key kosong / VelianPay tidak bisa dihubungi, pengajuan
 * top-up TETAP jalan dengan kode unik lokal (perilaku sebelumnya); pembayaran
 * otomatis bisa diverifikasi lewat email/paste.
 *
 * Secret hanya dipakai server — tidak pernah dikirim ke browser.
 */
import db from '../db.js'
import { approveTopupRef, logPaymentVerify, QRIS_TABLES } from './qrisPayment.js'

const baseUrl = () => (process.env.VELIANPAY_BASE_URL || 'https://velianpay.my.id').replace(/\/+$/, '')
const apiKey = () => (process.env.VELIANPAY_API_KEY || '').trim()
const callbackUrl = () =>
  (process.env.VELIANPAY_CALLBACK_URL || 'https://arkxmotion-studio.win/api/public/velianpay/webhook').trim()
const enabled = () => String(process.env.VELIANPAY_ENABLED || '').toLowerCase() === 'true'

export function velianpayReady(): boolean {
  return enabled() && !!apiKey()
}

/** Bentuk checkout yang dikirim ke klien (kontrak frontend dibekukan). */
export interface VelianpayPayment {
  checkout_url: string
  payable_amount: number
  unique_code: number
  /** URL PNG QRIS dinamis (dari qris_branded_image_url) — bukan data URI. */
  qris_image: string
}

async function velianpayRequest(path: string, init?: RequestInit): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 300) } }
  return { status: res.status, json }
}

/**
 * Hanya terima URL absolut http/https; selain itu kembalikan '' (string kosong).
 * Kolom `checkout_url`/`qris_image` berkontrak URL, jadi nilai tak sah seperti
 * 'bukan-url' atau data URI TIDAK boleh disimpan apa adanya. Kegagalan satu
 * field tidak menggagalkan pembayaran — order tetap dibuat, field lain tetap.
 */
function safeHttpUrl(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : ''
  } catch {
    return ''
  }
}

/**
 * Buat pembayaran VelianPay untuk sebuah baris top-up yang baru diajukan.
 * Mengembalikan checkout (link + nominal bayar + QR) atau null bila gagal
 * (caller boleh lanjut dengan perilaku kode unik lokal).
 */
export async function createVelianpayPayment(opts: {
  refTable: string
  refId: number
  userId: number
  baseAmount: number
  description: string
}): Promise<VelianpayPayment | null> {
  if (!velianpayReady()) return null

  try {
    const { status, json } = await velianpayRequest('/api/v1/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: Math.round(opts.baseAmount),
        callback_url: callbackUrl(),
        metadata: { order_id: `${opts.refTable}:${opts.refId}` },
      }),
    })
    const data = json?.data
    const reference = String(data?.reference || '')
    const payable = Number(data?.final_amount)
    if (!json?.success || !reference || !Number.isFinite(payable) || payable <= 0) {
      console.warn('[velianpay] create gagal:', status, JSON.stringify(json).slice(0, 300))
      logPaymentVerify({ source: 'velianpay', action: 'create_failed', detail: JSON.stringify(json).slice(0, 300) })
      return null
    }
    const code = Math.max(0, payable - Math.round(opts.baseAmount))
    const checkout = safeHttpUrl(data?.payment_link)
    const qrisImage = safeHttpUrl(data?.qris_branded_image_url || data?.qris_image_url)

    // Selaraskan baris top-up dengan nominal VelianPay — parser paste-mutasi
    // & tampilan "Bayar TEPAT" otomatis ikut benar.
    db.transaction(() => {
      db.prepare(
        `UPDATE ${opts.refTable} SET amount_total = ?, unique_code = ?, pay_ref = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'pending'`,
      ).run(payable, code, reference, opts.refId)
      db.prepare(
        `INSERT INTO velianpay_payment (order_id, payment_id, ref_table, ref_id, user_id, base_amount, unique_code, payable_amount, checkout_url, qris_image, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      ).run(reference, '', opts.refTable, opts.refId, opts.userId, Math.round(opts.baseAmount), code, payable, checkout, qrisImage)
    })()

    logPaymentVerify({
      source: 'velianpay',
      refTable: opts.refTable,
      refId: opts.refId,
      amount: payable,
      action: 'payment_created',
      detail: `reference ${reference} → checkout ${checkout ? 'tersedia' : 'kosong'}`,
    })
    return { checkout_url: checkout, payable_amount: payable, unique_code: code, qris_image: qrisImage }
  } catch (e: any) {
    console.warn('[velianpay] create error:', e?.message)
    return null
  }
}

/** Status yang dianggap lunas oleh penyedia — dipakai untuk menandai bayar. */
export const PAID_STATUSES = new Set(['paid'])
/** Status terminal (checkout ditutup penyedia). */
export const CLOSED_STATUSES = new Set(['expired', 'failed', 'cancelled', 'canceled'])

/**
 * Checkout ditutup penyedia TAPI baris top-up masih pending — kemungkinan
 * member sudah bayar (mis. QRIS lunas di DANA) tapi tidak terdeteksi VelianPay.
 * Beri tahu admin supaya rekonsiliasi manual DANA/bank tidak terlewat.
 */
function alertCheckoutClosed(m: { ref_table: string; ref_id: number; payable_amount: number; order_id: string }, st: string): void {
  try {
    const t = QRIS_TABLES.find((x) => x.table === m.ref_table)
    if (!t) return
    const row = db.prepare(`SELECT status FROM ${t.table} WHERE id = ?`).get(m.ref_id) as { status: string } | undefined
    if (row?.status !== 'pending') return
    const amount = Number(m.payable_amount) || 0
    db.prepare("INSERT INTO notifications (title, message, type, target) VALUES (?, ?, 'warning', 'admins')").run(
      `Checkout ${t.label} ditutup (${st}) — cek mutasi`,
      `Order ${m.order_id} (${t.label} #${m.ref_id}, Rp ${amount.toLocaleString('id-ID')}) berakhir dengan status '${st}'. Member kemungkinan sudah membayar (tidak terdeteksi VelianPay) — periksa mutasi DANA/bank lalu approve manual di Admin.`,
    )
    logPaymentVerify({
      source: 'velianpay',
      refTable: m.ref_table,
      refId: m.ref_id,
      amount,
      action: 'checkout_closed',
      detail: `Checkout ditutup penyedia (${st}); baris masih pending — kemungkinan perlu rekonsiliasi manual mutasi DANA/bank`,
    })
  } catch (e) {
    console.warn('[velianpay] alert checkout closed gagal:', e)
  }
}

/** Status pembayaran dari API (sumber kebenaran — webhook hanya memicu). */
export async function velianpayStatus(reference: string): Promise<any | null> {
  try {
    const { status, json } = await velianpayRequest(`/api/v1/orders/${encodeURIComponent(reference)}`, { method: 'GET' })
    if (status !== 200 || json?.success === false) return null
    return json?.data || json || null
  } catch {
    return null
  }
}

export interface VelianpayPollResult {
  checked: number
  paid: number
  closed: number
}

/** Sekali siklus: cek semua pembayaran VelianPay yang masih pending. */
export async function pollVelianpayPayments(): Promise<VelianpayPollResult> {
  const result: VelianpayPollResult = { checked: 0, paid: 0, closed: 0 }
  if (!velianpayReady()) return result

  const rows = db.prepare(
    "SELECT * FROM velianpay_payment WHERE status = 'pending' AND (paid_at IS NOT NULL OR created_at >= datetime('now', '-7 days')) ORDER BY updated_at ASC, id ASC LIMIT 25",
  ).all() as Array<{ id: number; order_id: string; ref_table: string; ref_id: number; payable_amount: number; payment_id: string; paid_at: string | null }>

  for (const m of rows) {
    result.checked++
    const d = m.paid_at ? { status: 'paid' } : await velianpayStatus(m.order_id)
    const st = String(d?.status || '').toLowerCase()
    db.prepare('UPDATE velianpay_payment SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(m.id)
    if (!st) continue

    if (PAID_STATUSES.has(st)) {
      // Simpan bukti lunas sebelum kredit; kegagalan kredit tetap bisa direkonsiliasi tanpa memanggil provider lagi.
      db.prepare('UPDATE velianpay_payment SET paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP) WHERE id = ?').run(m.id)
      try {
        const r = approveTopupRef(m.ref_table, m.ref_id, Number(m.payable_amount) || 0, {
          source: 'velianpay',
          from: 'velianpay-api',
          subject: m.order_id,
        })
        if (!['auto_approved', 'auto_activated', 'already_approved'].includes(r.action)) {
          throw new Error(`${r.action}: ${r.detail}`)
        }
        const updated = db.prepare("UPDATE velianpay_payment SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(m.id)
        result.paid += updated.changes
      } catch {
        logPaymentVerify({
          source: 'velianpay', refTable: m.ref_table, refId: m.ref_id,
          amount: Number(m.payable_amount) || 0, action: 'approval_pending',
          detail: 'Pembayaran lunas; kredit/aktivasi belum selesai. Periksa pengajuan; rekonsiliasi diulang otomatis.',
        })
      }
    } else if (CLOSED_STATUSES.has(st)) {
      db.prepare('UPDATE velianpay_payment SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(st, m.id)
      result.closed++
      alertCheckoutClosed(m, st)
    }
  }
  return result
}

/** Poller internal tiap 2 menit — dipanggil dari server/index.ts. */
export function startVelianpayPoller(): () => void {
  if (!velianpayReady()) {
    console.log('[velianpay] Poller nonaktif — set VELIANPAY_ENABLED=true + VELIANPAY_API_KEY di .env.')
    return () => {}
  }
  console.log('[velianpay] Poller aktif — cek payment pending tiap 2 menit.')
  const timer = setInterval(() => {
    pollVelianpayPayments().catch((e) => console.warn('[velianpay] poll gagal:', e))
  }, 2 * 60 * 1000)
  timer.unref?.()
  return () => clearInterval(timer)
}
