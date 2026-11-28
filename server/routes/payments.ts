import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.js'
import {
  getPaymentEmailStatus,
  checkPaymentEmailOnce,
  paymentEmailReady,
} from '../lib/paymentEmailWatcher.js'
import { QRIS_TABLES, extractAmounts, matchIncomingAmount, approveTopupRef, logPaymentVerify } from '../lib/qrisPayment.js'
import { velianpayReady, velianpayStatus, PAID_STATUSES, pollVelianpayPayments, createVelianpayPayment } from '../lib/velianpay.js'

type VelianpayCheckout = {
  checkout_url: string
  payable_amount: number
  unique_code: number
  qris_image: string
}

/**
 * Checkout VelianPay terbaru yang masih pending untuk satu baris pengajuan.
 * Dipakai ulang supaya halaman yang di-refresh tidak membuat order baru.
 */
function findPendingCheckout(refTable: string, refId: number): VelianpayCheckout | undefined {
  return db
    .prepare(
      `SELECT checkout_url, payable_amount, unique_code, qris_image
         FROM velianpay_payment
        WHERE ref_table = ? AND ref_id = ? AND status = 'pending'
        ORDER BY id DESC LIMIT 1`,
    )
    .get(refTable, refId) as VelianpayCheckout | undefined
}

/**
 * Panel kontrol verifikasi pembayaran QRIS manual — status koneksi email,
 * trigger cek manual, dan jejak audit pencocokan nominal.
 */
const router = Router()

router.get('/status', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const email = getPaymentEmailStatus()

    // Antrean pending per tabel + yang sudah dibayar menunggu approve.
    const queues = QRIS_TABLES.map((t) => {
      const pending = db.prepare(`SELECT COUNT(*) AS n FROM ${t.table} WHERE status = 'pending'`).get() as { n: number }
      const awaiting = db.prepare(
        `SELECT COUNT(*) AS n FROM ${t.table} WHERE status = 'pending' AND paid_at IS NOT NULL`,
      ).get() as { n: number }
      const verified24h = db.prepare(
        `SELECT COUNT(*) AS n FROM ${t.table} WHERE paid_at >= datetime('now', '-24 hours')`,
      ).get() as { n: number }
      return { table: t.table, label: t.label, pending: pending.n, awaiting_admin: awaiting.n, verified_24h: verified24h.n }
    })

    const unmatched = db.prepare(
      "SELECT COUNT(*) AS n FROM payment_verify_log WHERE action IN ('no_match', 'no_amount') AND created_at >= datetime('now', '-24 hours')",
    ).get() as { n: number }

    const bp = db.prepare(
      `SELECT
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'paid' AND paid_at >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS paid_24h,
         MAX(created_at) AS last_created_at
       FROM velianpay_payment`,
    ).get() as { pending: number | null; paid_24h: number | null; last_created_at: string | null }
    const velianpay = {
      ready: velianpayReady(),
      pending: bp.pending ?? 0,
      paid_24h: bp.paid_24h ?? 0,
      last_created_at: bp.last_created_at,
    }

    res.json({ email, ready: paymentEmailReady(), velianpay, queues, unmatched_24h: unmatched.n })
  } catch (error) {
    console.error('Payment status error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/check-now', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const bpReady = velianpayReady()
    const emailReady = paymentEmailReady()
    if (!bpReady && !emailReady) {
      return res.status(400).json({ error: 'Belum ada jalur verifikasi aktif — set VELIANPAY_* atau PAYMENT_IMAP_* di .env' })
    }
    const velianpay = bpReady ? await pollVelianpayPayments() : null
    const email = emailReady ? await checkPaymentEmailOnce() : null
    res.json({ ok: !email?.error, velianpay, email })
  } catch (error) {
    console.error('Payment check-now error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * Paste mutasi m-banking/e-wallet: admin menyalin teks riwayat transaksi
 * (bukan PDF — seleksi teks biasa), sistem mengekstrak SEMUA nominal yang
 * terdeteksi lalu mencocokkan satu per satu ke baris pending lewat kode unik.
 * Baris yang sudah ditemukan tidak akan "dimakan" dua kali karena setelah
 * auto-approve ia bukan pending lagi.
 */
router.post('/match-text', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const text = String(req.body?.text || '').slice(0, 20000)
    if (text.trim().length < 8) {
      return res.status(400).json({ error: 'Teks terlalu pendek — paste seluruh isi mutasi' })
    }

    const amounts = extractAmounts(text)
    if (!amounts.length) {
      logPaymentVerify({
        source: 'paste',
        action: 'no_amount',
        detail: 'Teks paste admin tidak mengandung nominal',
      })
      return res.status(200).json({ ok: true, amounts: [], matched: [], note: 'Tidak ada nominal terdeteksi di teks' })
    }

    // Terbesar dulu — biaya admin kecil tidak boleh mengambil baris orang lain.
    const matched: Array<{ amount: number; action: string; table?: string; id?: number; detail: string }> = []
    for (const amount of amounts.sort((a, b) => b - a)) {
      const r = matchIncomingAmount(amount, {
        from: 'paste-admin',
        subject: 'Paste mutasi admin',
        source: 'paste',
      })
      if (r.action !== 'no_match') matched.push({ amount, ...r })
    }

    logPaymentVerify({
      source: 'paste',
      amount: amounts[0] || 0,
      action: 'paste_processed',
      detail: `paste: ${amounts.length} nominal, ${matched.length} cocok`,
    })
    res.json({
      ok: true,
      amounts,
      matched,
      note: matched.length
        ? `${matched.length} pembayaran cocok — saldo dikredit / lunas`
        : 'Tidak ada nominal yang cocok dengan pengajuan pending (kode unik biasanya belum dibayar, atau user membayar nominal bulat)',
    })
  } catch (error) {
    console.error('Match-text error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * Siapkan (atau ambil ulang) QRIS VelianPay untuk pengajuan yang masih
 * pending — tombol "Coba lagi" di halaman top up / pembayaran.
 *
 * Kenapa perlu: checkout pertama bisa gagal dibuat (jaringan/API VelianPay
 * sedang bermasalah). Tanpa endpoint ini satu-satunya jalan adalah mengajukan
 * ulang → baris pengajuan dobel. Di sini HANYA checkout yang dibuat baru;
 * baris pengajuan, nominal, dan kode unik tetap yang lama. QRIS statis lama
 * tidak pernah dipakai.
 */
router.post('/qris/recreate', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const refTable = String(req.body?.refTable || '')
    const refId = Number(req.body?.refId)
    const t = QRIS_TABLES.find((x) => x.table === refTable)
    if (!t) return res.status(400).json({ error: 'Tabel pembayaran tidak dikenal' })
    if (!Number.isInteger(refId) || refId <= 0) return res.status(400).json({ error: 'Pengajuan tidak valid' })

    const row = db.prepare(`SELECT id, user_id, amount, status FROM ${t.table} WHERE id = ?`).get(refId) as
      | { id: number; user_id: number; amount: number; status: string }
      | undefined
    if (!row || row.user_id !== req.user!.id) return res.status(404).json({ error: 'Pengajuan tidak ditemukan' })
    if (row.status !== 'pending') {
      return res.status(400).json({ error: 'Pengajuan sudah diproses — tidak perlu QR baru' })
    }

    const existing = findPendingCheckout(refTable, refId)
    if (existing?.checkout_url) return res.json(existing)

    if (!velianpayReady()) {
      return res.status(503).json({ error: 'QRIS VelianPay sedang tidak tersedia — hubungi admin' })
    }
    const bp = await createVelianpayPayment({
      refTable,
      refId,
      userId: row.user_id,
      baseAmount: row.amount,
      description: t.label,
    })
    if (!bp) return res.status(502).json({ error: 'QRIS VelianPay gagal disiapkan — coba lagi' })
    res.json(bp)
  } catch (error) {
    console.error('Velianpay recreate error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * QRIS VelianPay untuk pembayaran join Pro pada halaman status pendaftaran
 * (belum login, identitas = email). Mengembalikan checkout terbaru bila ada;
 * kalau belum pernah dibuat, dibuat sekarang. Hanya untuk akun yang masih
 * belum aktif — akun approved tidak punya tagihan pending.
 */
router.post('/qris/membership', async (req, res: Response) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Email tidak valid' })
    }
    const user = db.prepare('SELECT id FROM users WHERE email = ? AND approved = 0').get(email) as
      | { id: number }
      | undefined
    if (!user) return res.status(404).json({ error: 'Pendaftaran dengan email itu tidak ditemukan atau sudah aktif' })

    const payment = db.prepare(
      "SELECT id, amount, amount_total FROM membership_payments WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
    ).get(user.id) as { id: number; amount: number; amount_total: number | null } | undefined
    if (!payment) return res.status(404).json({ error: 'Belum ada tagihan pembayaran yang menunggu' })

    const existing = findPendingCheckout('membership_payments', payment.id)
    if (existing?.checkout_url) return res.json(existing)

    if (!velianpayReady()) {
      return res.status(503).json({ error: 'QRIS VelianPay sedang tidak tersedia — hubungi admin' })
    }
    const bp = await createVelianpayPayment({
      refTable: 'membership_payments',
      refId: payment.id,
      userId: user.id,
      baseAmount: payment.amount,
      description: `Join Pro — ${email}`,
    })
    if (!bp) return res.status(502).json({ error: 'QRIS VelianPay gagal disiapkan — coba lagi' })
    res.json(bp)
  } catch (error) {
    console.error('Velianpay membership QR error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * Paksa verifikasi segera ke VelianPay untuk satu pengajuan pending — admin
 * tidak perlu menunggu poller 2 menit. Kalau VelianPay sudah menandai order
 * sebagai lunas, auto-approve akan trigger sekarang (jalan mesinya yang sama
 * dengan poller, jadi konsisten).
 */
router.post(
  '/admin/payments/qris/verify/:refTable/:refId',
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const refTable = String(req.params.refTable)
      const refId = Number(req.params.refId)
      const t = QRIS_TABLES.find((x) => x.table === refTable)
      if (!t) return res.status(400).json({ error: 'Tabel pembayaran tidak dikenal' })
      if (!Number.isInteger(refId) || refId <= 0) {
        return res.status(400).json({ error: 'Pengajuan tidak valid' })
      }

      const row = db.prepare(
        `SELECT id, user_id, amount, status FROM ${t.table} WHERE id = ?`,
      ).get(refId) as { id: number; user_id: number; amount: number; status: string } | undefined
      if (!row) {
        return res.status(404).json({ error: 'Pengajuan tidak ditemukan' })
      }
      if (row.status !== 'pending') {
        return res.status(400).json({ error: 'Pengajuan sudah diproses' })
      }

      const checkout = db.prepare(
        'SELECT id, order_id, payable_amount FROM velianpay_payment WHERE ref_table = ? AND ref_id = ? AND status = ? ORDER BY id DESC LIMIT 1',
      ).get(refTable, refId, 'pending') as
        | { id: number; order_id: string; payable_amount: number }
        | undefined
      if (!checkout) {
        return res.status(404).json({ error: 'Checkout VelianPay pending tidak ditemukan' })
      }

      if (!velianpayReady()) {
        return res.status(503).json({ error: 'QRIS VelianPay sedang tidak tersedia' })
      }

      const d = await velianpayStatus(checkout.order_id)
      const st = String(d?.status || '').toLowerCase()
      if (!PAID_STATUSES.has(st)) {
        return res.status(200).json({
          verified: false,
          status: st || 'unknown',
          detail: 'VelianPay belum melaporkan lunas — coba lagi nanti.',
        })
      }

      const r = approveTopupRef(refTable, refId, Number(checkout.payable_amount) || 0, {
        source: 'velianpay',
        from: 'velianpay-api-force-verify',
        subject: checkout.order_id,
      })
      if (!['auto_approved', 'auto_activated', 'already_approved'].includes(r.action)) {
        return res.status(400).json({ error: r.detail || 'Gagal menyetujui' })
      }

      db.prepare(
        "UPDATE velianpay_payment SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
      ).run(checkout.id)

      return res.json({ verified: true, action: r.action, detail: r.detail })
    } catch (error) {
      console.error('Velianpay force verify error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

router.get('/log', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
    const log = db.prepare('SELECT * FROM payment_verify_log ORDER BY created_at DESC LIMIT ?').all(limit)
    res.json({ log })
  } catch (error) {
    console.error('Payment log error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
