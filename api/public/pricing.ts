// ─── Harga efektif provider (publik, read-only) — versi Vercel ──────────────
// Cermin dari server/routes/publicPricing.ts. Tanpa autentikasi dan tanpa
// menulis apa pun ke DB: kalau `app_settings` belum ada, harga NexaBot jatuh ke
// default dari shared/pricing.ts (bukan error).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'
import {
  CREATEPULSE_MIN_TOPUP,
  CREATEPULSE_DEFAULT_PRICE,
  CREATEPULSE_MODEL_PRICES,
  NEXABOT_MIN_TOPUP,
  NEXABOT_UNLIMITED_SLUG,
  NEXABOT_PRICING_DEFAULTS,
  parseNexabotPricing,
  getCreatepulsePriceRange,
  type NexabotPricing,
} from '../../shared/pricing.js'

async function readNexabotPricing(): Promise<NexabotPricing> {
  const url = process.env.DATABASE_URL
  if (!url) return { ...NEXABOT_PRICING_DEFAULTS }
  try {
    const sql = neon(url)
    const rows = await sql`SELECT key, value FROM app_settings WHERE key IN ('nexabot_price', 'nexabot_unlimited_price', 'nexabot_unlimited_days')`
    const saved: Record<string, string> = {}
    for (const r of rows || []) saved[String(r.key)] = String(r.value)
    return parseNexabotPricing(saved)
  } catch (e) {
    console.warn('[public/pricing] pricing read failed, using defaults:', e)
    return { ...NEXABOT_PRICING_DEFAULTS }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const nexabot = await readNexabotPricing()
    const createpulse = getCreatepulsePriceRange()

    // Cache CDN singkat — tarif tidak perlu realtime, tapi juga tidak boleh basi lama.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300')
    return res.status(200).json({
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
    })
  } catch (err: any) {
    console.error('Public pricing error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
