import { Router, Request, Response } from 'express'
import crypto from 'node:crypto'
import { pollVelianpayPayments } from '../lib/velianpay.js'

/**
 * Webhook VelianPay (dashboard → URL publik ini).
 *
 * Payload tidak kita percaya mentah-mentah: setiap hit webhook yang
 * SIGNATURNYA VALID memicu satu siklus poll API VelianPay, dan hanya status
 * yang DITENDANG API-lah yang mengubah baris top-up — jadi pemalsuan body
 * tidak bisa mengkreditkan saldo.
 *
 * Verifikasi: header `X-VelianPay-Signature` = HMAC-SHA256 (hex) dari BODY
 * MENTAH memakai `VELIANPAY_WEBHOOK_SECRET` (BUKAN API key), dibandingkan
 * dengan `crypto.timingSafeEqual`. Route ini di-mount dengan `express.raw`
 * SEBELUM `express.json()` supaya body mentah tidak dipotong (lihat
 * server/index.ts).
 */
const router = Router()

function signatureValid(raw: Buffer, header: string | string[] | undefined): boolean {
  const secret = (process.env.VELIANPAY_WEBHOOK_SECRET || '').trim()
  const sig = Array.isArray(header) ? header[0] : header
  if (!secret || !sig) return false
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(String(sig).trim(), 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

router.post('/', async (req: Request, res: Response) => {
  // express.raw({ type: '*/*' }) → req.body adalah Buffer body mentah.
  const raw: Buffer = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === 'string' ? req.body : '')

  if (!signatureValid(raw, req.headers['x-velianpay-signature'])) {
    return res.status(401).json({ ok: false, error: 'Signature tidak valid' })
  }

  try {
    console.log('[velianpay-webhook] event diterima:', raw.toString('utf8').slice(0, 300))
    const result = await pollVelianpayPayments()
    res.json({ ok: true, poll: result })
  } catch (error) {
    console.warn('[velianpay-webhook] gagal:', error)
    res.status(200).json({ ok: true, error: 'poll gagal, akan dicoba di siklus berikutnya' })
  }
})

export default router
