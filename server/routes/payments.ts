import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.js'
import {
  getPaymentEmailStatus,
  checkPaymentEmailOnce,
  paymentEmailReady,
} from '../lib/paymentEmailWatcher.js'
import { QRIS_TABLES, extractAmounts, matchIncomingAmount, logPaymentVerify } from '../lib/qrisPayment.js'
import { basunipayReady, pollBasunipayPayments } from '../lib/basunipay.js'

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
       FROM basunipay_payment`,
    ).get() as { pending: number | null; paid_24h: number | null; last_created_at: string | null }
    const basunipay = {
      ready: basunipayReady(),
      pending: bp.pending ?? 0,
      paid_24h: bp.paid_24h ?? 0,
      last_created_at: bp.last_created_at,
    }

    res.json({ email, ready: paymentEmailReady(), basunipay, queues, unmatched_24h: unmatched.n })
  } catch (error) {
    console.error('Payment status error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/check-now', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const bpReady = basunipayReady()
    const emailReady = paymentEmailReady()
    if (!bpReady && !emailReady) {
      return res.status(400).json({ error: 'Belum ada jalur verifikasi aktif — set BASUNIPAY_* atau PAYMENT_IMAP_* di .env' })
    }
    const basunipay = bpReady ? await pollBasunipayPayments() : null
    const email = emailReady ? await checkPaymentEmailOnce() : null
    res.json({ ok: !email?.error, basunipay, email })
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
