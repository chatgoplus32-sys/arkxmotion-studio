/**
 * Konektor BasuniPay — checkout QRIS dinamis + deteksi bayar otomatis.
 *
 * Alur (sesuai dokumentasi basunipay.com):
 *   1. Server POST /v1/payments { order_id, amount, description }
 *      → dapat unique_code & payable_amount & checkout_url
 *   2. Baris top-up di-update ke payable_amount (mis. Rp 50.137) —
 *      checkout_url ditampilkan ke user sebagai "Bayar QRIS"
 *   3. User bayar QRIS → BasuniPay menandai PAID
 *   4. BasuniPay memanggil webhook merchant (POST /api/public/basunipay/webhook)
 *      DAN/ATAU kita polling GET /v1/payments/{order_id} tiap 2 menit
 *   5. `pollBasunipayPayments` menyetujui baris: kredit saldo / tandai lunas
 *      + notifikasi — memakai mesin yang sama dengan jalur paste-mutasi.
 *
 * Fail-safe: bila API key kosong / BasuniPay tidak bisa dihubungi, pengajuan
 * top-up TETAP jalan dengan kode unik lokal (perilaku sebelumnya).
 *
 * Secret hanya dipakai server — tidak pernah dikirim ke browser.
 */
import db from '../db.js'
import { approveTopupRef, logPaymentVerify, QRIS_TABLES } from './qrisPayment.js'

const baseUrl = () => (process.env.BASUNIPAY_BASE_URL || 'https://www.basunipay.com').replace(/\/+$/, '')
const apiKey = () => (process.env.BASUNIPAY_API_KEY || '').trim()
const enabled = () => String(process.env.BASUNIPAY_ENABLED || '').toLowerCase() === 'true'

export function basunipayReady(): boolean {
  return enabled() && !!apiKey()
}

export interface BasunipayPayment {
  order_id: string
  payment_id: string
  payable_amount: number
  unique_code: number
  checkout_url: string
  /** QR PNG (data URI) dengan nominal + kode unik — ditampilkan inline. */
  qris_image: string
}

async function basunipayRequest(path: string, init?: RequestInit): Promise<{ status: number; json: any }> {
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
 * Buat pembayaran BasuniPay untuk sebuah baris top-up yang baru diajukan.
 * Mengembalikan checkout_url + nomor yang harus dibayar, atau null bila gagal
 * (caller boleh lanjut dengan perilaku kode unik lokal).
 */
export async function createBasunipayPayment(opts: {
  refTable: string
  refId: number
  userId: number
  baseAmount: number
  description: string
}): Promise<BasunipayPayment | null> {
  if (!basunipayReady()) return null

  const orderId = `arkx_${opts.refTable}_${opts.refId}_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
  try {
    const { status, json } = await basunipayRequest('/v1/payments', {
      method: 'POST',
      // Kunci per-order: id baris bisa berulang antar DB (lokal/test/prod) dan
      // BasuniPay menolak kunci lama dengan 409 IDEMPOTENCY_CONFLICT.
      headers: { 'Idempotency-Key': orderId },
      body: JSON.stringify({
        order_id: orderId,
        amount: Math.round(opts.baseAmount),
        description: String(opts.description || 'Top Up ArkxMotion Studio').slice(0, 200),
      }),
    })
    const data = json?.data
    const payable = Number(data?.payable_amount)
    if (!json?.success || !Number.isFinite(payable) || payable <= 0) {
      console.warn('[basunipay] create gagal:', status, JSON.stringify(json).slice(0, 300))
      logPaymentVerify({ source: 'basunipay', action: 'create_failed', detail: JSON.stringify(json).slice(0, 300) })
      return null
    }
    const code = Number(data?.unique_code) || Math.max(0, payable - Math.round(opts.baseAmount))
    const checkout = String(data?.checkout_url || '')
    // Ambil QR (image_data) dari halaman checkout — sumber yang sama dengan
    // yang ditampilkan BasuniPay, jadi apa yang dilihat user persis QR yang
    // akan dibayar — tidak ada lagi ketidakcocokan QR lama vs QR dinamis.
    let qrisImage = ''
    if (checkout) {
      const token = checkout.split('/').pop() || ''
      if (token) {
        const chk = await basunipayRequest(`/api/public/checkout/${encodeURIComponent(token)}`, { method: 'GET' })
        const img = chk?.json?.qris?.image_data
        if (typeof img === 'string' && img.startsWith('data:image/')) qrisImage = img
      }
    }

    // Selaraskan baris top-up dengan nominal BasuniPay — parser paste-mutasi
    // & tampilan "Bayar TEPAT" otomatis ikut benar.
    db.transaction(() => {
      db.prepare(
        `UPDATE ${opts.refTable} SET amount_total = ?, unique_code = ?, pay_ref = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'pending'`,
      ).run(payable, code, String(data?.payment_id || ''), opts.refId)
      db.prepare(
        `INSERT INTO basunipay_payment (order_id, payment_id, ref_table, ref_id, user_id, base_amount, unique_code, payable_amount, checkout_url, qris_image, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      ).run(orderId, String(data?.payment_id || ''), opts.refTable, opts.refId, opts.userId, Math.round(opts.baseAmount), code, payable, checkout, qrisImage)
    })()

    logPaymentVerify({
      source: 'basunipay',
      refTable: opts.refTable,
      refId: opts.refId,
      amount: payable,
      action: 'payment_created',
      detail: `order_id ${orderId} → checkout ${checkout ? 'tersedia' : 'kosong'}`,
    })
    return { order_id: orderId, payment_id: String(data?.payment_id || ''), payable_amount: payable, unique_code: code, checkout_url: checkout, qris_image: qrisImage }
  } catch (e: any) {
    console.warn('[basunipay] create error:', e?.message)
    return null
  }
}

/** Status yang dianggap lunas oleh penyedia — dipakai untuk menandai bayar. */
export const PAID_STATUSES = new Set(['paid', 'success', 'completed', 'settlement', 'settled', 'done', 'paid_out', 'verified'])
/** Status terminal (checkout ditutup penyedia). */
export const CLOSED_STATUSES = new Set(['expired', 'failed', 'cancelled', 'canceled'])

/**
 * Checkout ditutup penyedia TAPI baris top-up masih pending — kemungkinan
 * member sudah bayar (mis. QRIS lunas di DANA) tapi Bridge tidak mendeteksi
 * dan BasuNiPay tidak pernah menandainya paid. Beri tahu admin supaya
 * rekonsiliasi manual DANA/bank tidak terlewat.
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
      `Order ${m.order_id} (${t.label} #${m.ref_id}, Rp ${amount.toLocaleString('id-ID')}) berakhir dengan status '${st}'. Member kemungkinan sudah membayar (Bridge tidak mendeteksi) — periksa mutasi DANA/bank lalu approve manual di Admin.`,
    )
    logPaymentVerify({
      source: 'basunipay',
      refTable: m.ref_table,
      refId: m.ref_id,
      amount,
      action: 'checkout_closed',
      detail: `Checkout ditutup penyedia (${st}); baris masih pending — kemungkinan perlu rekonsiliasi manual mutasi DANA/bank`,
    })
  } catch (e) {
    console.warn('[basunipay] alert checkout closed gagal:', e)
  }
}

/** Status pembayaran dari API (sumber kebenaran — webhook hanya memicu). */
export async function basunipayStatus(orderId: string): Promise<any | null> {
  try {
    const { status, json } = await basunipayRequest(`/v1/payments/${encodeURIComponent(orderId)}`, { method: 'GET' })
    if (status !== 200 || json?.success === false) return null
    return json?.data || json || null
  } catch {
    return null
  }
}

export interface BasunipayPollResult {
  checked: number
  paid: number
  closed: number
}

/** Sekali siklus: cek semua pembayaran BasuniPay yang masih pending. */
export async function pollBasunipayPayments(): Promise<BasunipayPollResult> {
  const result: BasunipayPollResult = { checked: 0, paid: 0, closed: 0 }
  if (!basunipayReady()) return result

  const rows = db.prepare(
    "SELECT * FROM basunipay_payment WHERE status = 'pending' AND (paid_at IS NOT NULL OR created_at >= datetime('now', '-7 days')) ORDER BY updated_at ASC, id ASC LIMIT 25",
  ).all() as Array<{ id: number; order_id: string; ref_table: string; ref_id: number; payable_amount: number; payment_id: string; paid_at: string | null }>

  for (const m of rows) {
    result.checked++
    const d = m.paid_at ? { status: 'paid' } : await basunipayStatus(m.order_id)
    const st = String(d?.status || '').toLowerCase()
    db.prepare('UPDATE basunipay_payment SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(m.id)
    if (!st) continue

    if (PAID_STATUSES.has(st)) {
      // Simpan bukti lunas sebelum kredit; kegagalan kredit tetap bisa direkonsiliasi tanpa memanggil provider lagi.
      db.prepare('UPDATE basunipay_payment SET paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP) WHERE id = ?').run(m.id)
      try {
        const r = approveTopupRef(m.ref_table, m.ref_id, Number(m.payable_amount) || 0, {
          source: 'basunipay',
          from: 'basunipay-api',
          subject: m.order_id,
        })
        if (!['auto_approved', 'auto_activated', 'already_approved'].includes(r.action)) {
          throw new Error(`${r.action}: ${r.detail}`)
        }
        const updated = db.prepare("UPDATE basunipay_payment SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(m.id)
        result.paid += updated.changes
      } catch {
        logPaymentVerify({
          source: 'basunipay', refTable: m.ref_table, refId: m.ref_id,
          amount: Number(m.payable_amount) || 0, action: 'approval_pending',
          detail: 'Pembayaran lunas; kredit/aktivasi belum selesai. Periksa pengajuan; rekonsiliasi diulang otomatis.',
        })
      }
    } else if (CLOSED_STATUSES.has(st)) {
      db.prepare('UPDATE basunipay_payment SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(st, m.id)
      result.closed++
      alertCheckoutClosed(m, st)
    }
  }
  return result
}

/** Poller internal tiap 2 menit — dipanggil dari server/index.ts. */
export function startBasunipayPoller(): () => void {
  if (!basunipayReady()) {
    console.log('[basunipay] Poller nonaktif — set BASUNIPAY_ENABLED=true + BASUNIPAY_API_KEY di .env.')
    return () => {}
  }
  console.log('[basunipay] Poller aktif — cek payment pending tiap 2 menit.')
  const timer = setInterval(() => {
    pollBasunipayPayments().catch((e) => console.warn('[basunipay] poll gagal:', e))
  }, 2 * 60 * 1000)
  timer.unref?.()
  return () => clearInterval(timer)
}
