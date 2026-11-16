// ─── Harga efektif CreatePulse untuk UI ────────────────────────────────────
// Sumber kebenaran: app_settings (`provider_pricing`) di server — diedit admin
// di System Settings → Harga Token & Wallet, dibaca klien tiap kali lewat
// /api/public/pricing. File ini hanya CERMIN tampilan + cache 60 detik;
// angka yang terpotong selalu harga dari server (/deduct memakai providerUnitCharge).
//
// Kunci model = apiModel yang dikirim ke upstream & /deduct.
import { useEffect, useState } from 'react'
export const CREATEPULSE_PRICE_FALLBACK: Record<string, number> = {
  // Varian dasar (tanpa durasi khusus)
  'dreamina-seedance-2.0': 1500,
  'dreamina-seedance-2.5': 1500,
  // 15/20/30 detik
  'dreamina-seedance-2.0-15s': 2250,
  'dreamina-seedance-2.5-15s': 2500,
  'dreamina-seedance-2.5-20s': 3000,
  'dreamina-seedance-2.5-30s': 4500,
  'veo-omni-10s': 2250,
}

export const CREATEPULSE_DEFAULT_FALLBACK = 1500

export interface CreatepulsePricing {
  /** Harga efektif per model (Rp/generate). */
  models: Record<string, number>
  /** Tarif untuk model yang tidak tercantum. */
  defaultPrice: number
}

const FALLBACK: CreatepulsePricing = {
  models: { ...CREATEPULSE_PRICE_FALLBACK },
  defaultPrice: CREATEPULSE_DEFAULT_FALLBACK,
}

let cache: { at: number; data: CreatepulsePricing } | null = null
const TTL_MS = 60 * 1000

/** Ambil harga efektif dari server; jatuh ke cermin bawaan kalau gagal. */
export async function fetchCreatepulsePricing(): Promise<CreatepulsePricing> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data
  try {
    const res = await fetch('/api/public/pricing')
    if (!res.ok) return FALLBACK
    const data = await res.json()
    const cp = data?.providers?.createpulse
    const serverModels = cp?.models && typeof cp.models === 'object' ? cp.models : {}
    const defaultPrice = Number(cp?.default_price) || CREATEPULSE_DEFAULT_FALLBACK
    const merged = { ...CREATEPULSE_PRICE_FALLBACK }
    for (const [k, v] of Object.entries(serverModels)) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) merged[k] = n
    }
    const eff: CreatepulsePricing = { models: merged, defaultPrice }
    cache = { at: Date.now(), data: eff }
    return eff
  } catch {
    return FALLBACK
  }
}

/** Harga efektif model (Rp). */
export function cpModelPrice(pricing: CreatepulsePricing, model?: string): number {
  if (!model) return pricing.defaultPrice
  return pricing.models[model] ?? pricing.defaultPrice
}

/**
 * Hook ringan untuk komponen yang butuh menampilkan harga CreatePulse.
 * Selama memuat (atau kalau server tidak menjawab) memakai cermin bawaan
 * supaya tidak ada angka kosong di UI.
 */
export function useCreatepulsePricing(): CreatepulsePricing {
  const [pricing, setPricing] = useState<CreatepulsePricing>(() => cache?.data ?? FALLBACK)
  useEffect(() => {
    let hidup = true
    fetchCreatepulsePricing().then((p) => { if (hidup) setPricing(p) })
    return () => { hidup = false }
  }, [])
  return pricing
}
