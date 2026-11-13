import { Router, Response, Request } from 'express'
import { extractAmounts, matchIncomingAmount, logPaymentVerify } from '../lib/qrisPayment.js'

/**
 * Titik masuk notifikasi dari companion Android (QRIS Payment Monitor).
 *
 * Companion app membaca push notification dari aplikasi bank/e-wallet di HP
 * (NotificationListenerService) lalu mengirim teks notifikasinya ke sini.
 * Server mengekstrak nominal dan mencocokkannya ke baris top-up pending
 * lewat kode unik — mesin pencocoknya sama dengan pemantau email.
 *
 * Keamanan: endpoint ini PUBLIC (tidak pakai JWT) tapi dijaga shared secret
 * `x-payment-secret` = PLAYMENT_INGEST_SECRET. Tanpa secret tepat, 401.
 */
const router = Router()

const SECRET = () => (process.env.PAYMENT_INGEST_SECRET || '').trim()

router.post('/', async (req: Request, res: Response) => {
  try {
    const secret = String(req.headers['x-payment-secret'] || '').trim()
    if (!SECRET() || secret !== SECRET()) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const text = String(req.body?.text ?? '').slice(0, 2000)
    const packageName = String(req.body?.package ?? '').slice(0, 100)
    if (text.length < 8) {
      return res.status(400).json({ error: 'text too short' })
    }

    const amounts = extractAmounts(text)
    if (!amounts.length) {
      logPaymentVerify({
        source: 'android',
        action: 'no_amount',
        emailFrom: packageName,
        emailSubject: text.slice(0, 200),
        detail: 'Tidak ada nominal terdeteksi di notifikasi',
      })
      return res.json({ ok: true, matched: false, reason: 'no_amount' })
    }

    // Nominal terbesar dulu — biaya/admin fee kecil tidak boleh menang lebih
    // dulu dari nominal transfer utama.
    for (const amount of amounts.sort((a, b) => b - a)) {
      const r = matchIncomingAmount(amount, {
        from: packageName,
        subject: text.split('\n')[0].slice(0, 150),
        source: 'android',
      })
      if (r.action !== 'no_match') {
        return res.json({ ok: true, matched: true, amount, ...r })
      }
    }
    logPaymentVerify({
      source: 'android',
      amount: amounts[0],
      action: 'no_match',
      emailFrom: packageName,
      emailSubject: text.split('\n')[0].slice(0, 200),
      detail: `Tidak ada baris pending untuk ${amounts.length} nominal: ${amounts.slice(0, 5).join(', ')}`,
    })
    res.json({ ok: true, matched: false, reason: 'no_match', amounts })
  } catch (error) {
    console.error('[payment-ingest] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/** Health check kecil — companion app bisa tes secret-nya valid. */
router.get('/ping', (req: Request, res: Response) => {
  const secret = String(req.headers['x-payment-secret'] || '').trim()
  if (!SECRET() || secret !== SECRET()) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  res.json({ ok: true, configured: true })
})

export default router
