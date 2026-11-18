// ─── Harga efektif RunningHub untuk UI ───────────────────────────────────────
// Sumber kebenaran: app_settings (`provider_pricing`) di server — diedit admin
// di System Settings → Harga Token & Wallet, dibaca klien tiap kali lewat
// /api/public/pricing. File ini hanya CERMIN tampilan + cache 60 detik;
// angka yang benar-benar ditagih selalu harga dari server (runninghubWallet).
//
// Kunci model = action yang dikirim SDK ke /deduct (shared/pricing.ts
// RUNNINGHUB_MODEL_PRICES).
import { useEffect, useState } from 'react'
export const RUNNINGHUB_PRICE_FALLBACK: Record<string, number> = {
  // Motion Control
  'motion-control': 2500,
  'motion-control-v2.6-std': 2500,
  'motion-control-v2.6-pro': 2500,
  'motion-control-v3': 2500,
  'motion-control-ultra-hd': 2500,
  'motion-control-kling-2.6': 2500,
  'motion-control-ultra-hd-pro': 2500,
  'motion-control-pro': 2500,
  'motion-control-eposcents': 2500,
  'motion-control-kontrol-gerakan': 2500,
  'motion-control-72fps': 2500,
  // Virtual try-on
  'submit-tryon': 2500,
  'submit-tryon-flux2': 2500,
  // Music / avatar / video
  'submit-h3-music-avatar': 2500,
  'submit-h3-i2v': 2500,
  'submit-seedance2': 2500,
  'submit-seedance2.6': 2500,
  // Gambar & foto
  'submit-image-edit': 2500,
  'submit-photo-enhance': 2500,
  'submit-travel-photo': 2500,
  // Utilitas media
  'submit-video-upscale': 2500,
  // Audio
  'submit-song-cover': 2500,
  'submit-yue2-reimaginer': 2500,
  // Lainnya
  'submit-ugc-storyboard': 2500,
}

export const RUNNINGHUB_DEFAULT_FALLBACK = 2500

export interface RunninghubPricing {
  /** Harga efektif per model (Rp/generate). */
  models: Record<string, number>
  /** Tarif untuk model yang tidak tercantum. */
  defaultCharge: number
}

const FALLBACK: RunninghubPricing = {
  models: { ...RUNNINGHUB_PRICE_FALLBACK },
  defaultCharge: RUNNINGHUB_DEFAULT_FALLBACK,
}

let cache: { at: number; data: RunninghubPricing } | null = null
const TTL_MS = 60 * 1000

/** Ambil harga efektif dari server; jatuh ke cermin bawaan kalau gagal. */
export async function fetchRunninghubPricing(): Promise<RunninghubPricing> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data
  try {
    const res = await fetch('/api/public/pricing')
    if (!res.ok) return FALLBACK
    const data = await res.json()
    const rh = data?.providers?.runninghub
    const serverModels = rh?.models && typeof rh.models === 'object' ? rh.models : {}
    const defaultCharge = Number(rh?.default_charge) || RUNNINGHUB_DEFAULT_FALLBACK
    const merged = { ...RUNNINGHUB_PRICE_FALLBACK }
    for (const [k, v] of Object.entries(serverModels)) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) merged[k] = n
    }
    const eff: RunninghubPricing = { models: merged, defaultCharge }
    cache = { at: Date.now(), data: eff }
    return eff
  } catch {
    return FALLBACK
  }
}

/** Harga efektif model (Rp). */
export function rhModelPrice(pricing: RunninghubPricing, action: string): number {
  return pricing.models[action] ?? pricing.defaultCharge
}

/**
 * Hook ringan untuk komponen yang butuh menampilkan harga RH. Selama memuat
 * (atau kalau server tidak menjawab) memakai cermin bawaan supaya tidak ada
 * angka kosong di UI.
 */
export function useRunninghubPricing(): RunninghubPricing {
  const [pricing, setPricing] = useState<RunninghubPricing>(() => cache?.data ?? FALLBACK)
  useEffect(() => {
    let hidup = true
    fetchRunninghubPricing().then((p) => { if (hidup) setPricing(p) })
    return () => { hidup = false }
  }, [])
  return pricing
}
