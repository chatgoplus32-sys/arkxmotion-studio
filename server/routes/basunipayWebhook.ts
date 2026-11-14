import { Router, Request, Response } from 'express'
import { pollBasunipayPayments } from '../lib/basunipay.js'

/**
 * Webhook BasuniPay (dashboard → URL publik ini).
 *
 * Payload tidak kita percaya mentah-mentah: setiap hit webhook memicu satu
 * siklus poll API BasuniPay, dan hanya status yang DITENDANG API-lah yang
 * mengubah baris top-up — jadi pemalsuan body tidak bisa mengkreditkan
 * saldo. (Tanda tangan HMAC bisa ditambahkan setelah formatnya jelas.)
 */
const router = Router()

router.post('/', async (req: Request, res: Response) => {
  try {
    console.log('[basunipay-webhook] event diterima:', JSON.stringify(req.body).slice(0, 300))
    const result = await pollBasunipayPayments()
    res.json({ ok: true, poll: result })
  } catch (error) {
    console.warn('[basunipay-webhook] gagal:', error)
    res.status(200).json({ ok: true, error: 'poll gagal, akan dicoba di siklus berikutnya' })
  }
})

export default router
