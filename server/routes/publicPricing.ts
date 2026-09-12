// ─── Harga efektif provider (publik, read-only) ─────────────────────────────
// Dipakai halaman landing dan verifikasi cepat tanpa login. Aman dibuka karena
// isinya memang tarif yang ditampilkan ke calon user — bukan saldo, bukan data
// user. Harga NexaBot ikut pengaturan admin (app_settings), sedangkan CreatePulse
// masih konstanta kode; keduanya diambil dari shared/pricing.ts supaya angka yang
// tampil tidak pernah berbeda dari yang benar-benar dipotong server.
import { Router, Response } from 'express'
import {
  CREATEPULSE_MIN_TOPUP,
  CREATEPULSE_DEFAULT_PRICE,
  CREATEPULSE_MODEL_PRICES,
  NEXABOT_MIN_TOPUP,
  NEXABOT_UNLIMITED_SLUG,
  getCreatepulsePriceRange,
} from '../../shared/pricing.js'
import { getNexabotPricing } from './nexabotWallet.js'

const router = Router()

/** Bentuk respons yang sama dipakai versi Vercel (api/public/pricing.ts). */
export function buildPublicPricing() {
  const nexabot = getNexabotPricing()
  const createpulse = getCreatepulsePriceRange()

  return {
    ok: true,
    currency: 'IDR',
    updated_at: new Date().toISOString(),
    providers: {
      nexabot: {
        name: 'NexaBot',
        price_per_generate: nexabot.price,
        min_topup: NEXABOT_MIN_TOPUP,
        package: {
          slug: NEXABOT_UNLIMITED_SLUG,
          label: `Unlimited ${nexabot.unlimitedDays} hari`,
          price: nexabot.unlimitedPrice,
          days: nexabot.unlimitedDays,
        },
      },
      createpulse: {
        name: 'CreatePulse',
        min_topup: CREATEPULSE_MIN_TOPUP,
        default_price: CREATEPULSE_DEFAULT_PRICE,
        price_range: createpulse,
        models: { ...CREATEPULSE_MODEL_PRICES },
      },
    },
  }
}

router.get('/', (_req, res: Response) => {
  try {
    // Tarif publik boleh di-cache sebentar (tidak perlu realtime per milidetik).
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300')
    res.json(buildPublicPricing())
  } catch (error) {
    console.error('Public pricing error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
