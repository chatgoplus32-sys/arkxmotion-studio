// ─── Harga efektif TikTok Symphony untuk UI ─────────────────────────────────
// Sumber kebenaran: app_settings (`provider_pricing`) di server — diedit admin
// di System Settings → Harga Token & Wallet. File ini cermin tampilan + cache.
import { useEffect, useState } from 'react'

export const TIKTOK_PRICE_FALLBACK: Record<string, number> = {
  'SEEDANCE_2_0_FAST': 700,
}
export const TIKTOK_DEFAULT_FALLBACK = 700
export const TIKTOK_MIN_TOPUP = 10000

export interface TiktokPricing {
  models: Record<string, number>
  defaultPrice: number
}

const FALLBACK: TiktokPricing = {
  models: { ...TIKTOK_PRICE_FALLBACK },
  defaultPrice: TIKTOK_DEFAULT_FALLBACK,
}
let cache: { at: number; data: TiktokPricing } | null = null
const TTL_MS = 60 * 1000

export async function fetchTiktokPricing(): Promise<TiktokPricing> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data
  try {
    const res = await fetch('/api/public/pricing')
    if (!res.ok) return FALLBACK
    const data = await res.json()
    const t = data?.providers?.tiktok
    const serverModels = t?.models && typeof t.models === 'object' ? t.models : {}
    const defaultPrice = Number(t?.default_price) || TIKTOK_DEFAULT_FALLBACK
    const merged = { ...TIKTOK_PRICE_FALLBACK }
    for (const [k, v] of Object.entries(serverModels)) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) merged[k] = n
    }
    const eff: TiktokPricing = { models: merged, defaultPrice }
    cache = { at: Date.now(), data: eff }
    return eff
  } catch {
    return FALLBACK
  }
}

export function ttModelPrice(pricing: TiktokPricing, model?: string): number {
  if (!model) return pricing.defaultPrice
  return pricing.models[model] ?? pricing.defaultPrice
}

export function useTiktokPricing(): TiktokPricing {
  const [pricing, setPricing] = useState<TiktokPricing>(() => cache?.data ?? FALLBACK)
  useEffect(() => {
    let hidup = true
    fetchTiktokPricing().then((p) => { if (hidup) setPricing(p) })
    return () => { hidup = false }
  }, [])
  return pricing
}
