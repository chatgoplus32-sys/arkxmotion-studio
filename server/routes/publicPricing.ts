// ─── Harga efektif provider (publik, read-only) ─────────────────────────────
// Dipakai halaman landing dan verifikasi cepat tanpa login. Aman dibuka karena
// isinya memang tarif yang ditampilkan ke calon user — bukan saldo, bukan data
// user. Harga NexaBot ikut pengaturan admin (app_settings), sedangkan CreatePulse
// masih konstanta kode; keduanya diambil dari shared/pricing.ts supaya angka yang
// tampil tidak pernah berbeda dari yang benar-benar dipotong server.
import { Router, Response } from 'express'
import {
  CREATEPULSE_MIN_TOPUP,
  NEXABOT_MIN_TOPUP,
  NEXABOT_UNLIMITED_SLUG,
  SEAVI_MIN_TOPUP,
  SEAVI_PACKAGES,
  SEAVI_TOKEN_PRICE,
  POSBOT_MIN_TOPUP,
  POSBOT_TOPUP_MAX,
  POSBOT_TOPUP_PRESETS,
  RUNNINGHUB_MIN_TOPUP,
} from '../../shared/pricing.js'
import { getNexabotPricing } from './nexabotWallet.js'
import { getProviderPricing } from '../lib/providerPricing.js'

const router = Router()

/** Bentuk respons yang sama dipakai versi Vercel (api/public/pricing.ts). */
const rentang = (values: number[]) => ({ min: Math.min(...values), max: Math.max(...values) })

export function buildPublicPricing() {
  const nexabot = getNexabotPricing()
  const seavi = getProviderPricing('seavi')
  const posbot = getProviderPricing('posbot')
  const runninghub = getProviderPricing('runninghub')
  const createpulse = getProviderPricing('createpulse')

  const createpulseModels = { ...createpulse.catalog }
  const posbotModels = { ...posbot.catalog }
  const createpulseRange = rentang([createpulse.default ?? 1, ...Object.values(createpulseModels)])
  const posbotRange = rentang([posbot.default ?? 1, ...Object.values(posbotModels)])

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
        default_price: createpulse.default,
        price_range: createpulseRange,
        models: createpulseModels,
      },
      seavi: {
        name: 'Seavi',
        min_topup: SEAVI_MIN_TOPUP,
        price_per_token: SEAVI_TOKEN_PRICE,
        default_charge: seavi.default,
        packages: SEAVI_PACKAGES.map((p) => ({ ...p })),
        models: { ...seavi.catalog },
      },
      posbot: {
        name: 'PosBot',
        min_topup: POSBOT_MIN_TOPUP,
        max_topup: POSBOT_TOPUP_MAX,
        default_charge: posbot.default,
        presets: [...POSBOT_TOPUP_PRESETS],
        price_range: posbotRange,
        models: posbotModels,
      },
      runninghub: {
        name: 'RunningHub',
        min_topup: RUNNINGHUB_MIN_TOPUP,
        flat_generate: runninghub.flat,
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
