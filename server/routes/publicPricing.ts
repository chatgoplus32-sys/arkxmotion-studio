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
  SEAVI_MIN_TOPUP,
  SEAVI_PACKAGES,
  SEAVI_TOKEN_PRICE,
  SEAVI_DEFAULT_CHARGE,
  SEAVI_MODEL_TOKENS,
  ALRIZ_MIN_TOPUP,
  ALRIZ_MAX_TOPUP,
  ALRIZ_NOMINALS,
  ALRIZ_MODEL_PRICES,
  ALRIZ_DEFAULT_PRICE,
  getCreatepulsePriceRange,
  getAlrizPriceRange,
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
        // `package` = varian utama (kompatibilitas klien lama), `packages` =
        // semua varian Unlimited yang bisa dipilih user.
        package: {
          slug: NEXABOT_UNLIMITED_SLUG,
          label: `Unlimited ${nexabot.unlimitedDays} hari`,
          price: nexabot.unlimitedPrice,
          days: nexabot.unlimitedDays,
        },
        packages: nexabot.packages,
      },
      createpulse: {
        name: 'CreatePulse',
        min_topup: CREATEPULSE_MIN_TOPUP,
        default_price: CREATEPULSE_DEFAULT_PRICE,
        price_range: createpulse,
        models: { ...CREATEPULSE_MODEL_PRICES },
      },
      seavi: {
        name: 'Seavi',
        min_topup: SEAVI_MIN_TOPUP,
        price_per_token: SEAVI_TOKEN_PRICE,
        default_charge: SEAVI_DEFAULT_CHARGE,
        packages: SEAVI_PACKAGES.map((p) => ({ ...p })),
        models: { ...SEAVI_MODEL_TOKENS },
      },
      alriz: {
        name: 'Alriz Motion',
        min_topup: ALRIZ_MIN_TOPUP,
        max_topup: ALRIZ_MAX_TOPUP,
        nominals: [...ALRIZ_NOMINALS],
        default_price: ALRIZ_DEFAULT_PRICE,
        price_range: getAlrizPriceRange(),
        models: { ...ALRIZ_MODEL_PRICES },
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
