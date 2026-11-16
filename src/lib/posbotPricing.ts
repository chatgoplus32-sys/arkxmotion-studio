// ─── Harga efektif PosBot untuk UI ───────────────────────────────────────────
// Sumber kebenaran: app_settings (`provider_pricing`) di server — diedit admin
// di System Settings → Harga Token & Wallet, dibaca klien tiap kali lewat
// /api/public/pricing. File ini hanya CERMIN tampilan + cache 60 detik;
// angka yang benar-benar ditagih selalu harga dari server (/deduct memakai
// providerUnitCharge di server/lib/providerPricing.ts).
import { useEffect, useState } from 'react'
export const POSBOT_PRICE_FALLBACK: Record<string, number> = {
  krea2_2k: 500,
  nano_banana_2_4k: 350,
  nano_banana_pro_4k: 350,
  gpt_image_2_high: 350,
  gpt_image_25: 350,
  gpt_image_25_sunburst: 350,
  gpt_image_26_sunburst: 350,
  gpt_image_26_flare: 350,
  flux_2_pro: 350,
  seedream_50_lite: 350,
  seedream_50_pro: 350,
  seedream_45: 350,
  seedream_5_fast_2k: 350,
  seedream_5_pro_2k: 350,
  nano_banana_21_4k: 350,
  nano_banana_2_2k: 350,
  nano_banana_pro_2k: 350,
  gpt_image_2_2k: 350,
  flux_2_pro_2k: 350,
  seedream_5_flash_2k: 350,
  qwen_image_3_pro_2k: 350,
  qwen_z_image_1k: 350,
  imagen4_ultra_2k: 350,
  grok_image_2_1k: 350,
  face_swap: 350,
  upscale_4k: 500,
  grok_imagine_2_15s: 2500,
  grok_imagine_2_30s: 4000,
  grok_imagine_15_video_720p: 1500,
  betagrok_15s: 2000,
  s2_seedance_25_30s: 6000,
  seedance_25_30s_strict: 6000,
  seedance_20_15s: 5000,
  seedance_20_mini: 2500,
  wan_30_hd: 3000,
  wan_remix_720p: 2500,
  wan3_hd_15s: 3000,
  wan3_hd_30s: 4500,
  minimax_h3: 2500,
  minimax_h3_720p: 1500,
  kling_25_turbo: 2500,
  kling_26_pro_1080p: 3000,
  kling_30_turbo: 3000,
  omni_flash_t2v: 1000,
  omni_flash_sfv: 1000,
  omni_flash_i2v: 1000,
  omni_flash_r2v: 1000,
  omni_flash_11_720p: 1000,
  omni_flash_12_1080p: 1000,
  watermark_remover: 1500,
  minimax_lipsync: 2000,
  ltx_lipsync: 2500,
  betamotion_hd: 2000,
  betamotion_1080p: 2500,
  betamotion_1080p_pro: 3000,
  betamotion_1080p_max: 3500,
  motion_control_std: 1500,
  motion_control_pro: 2500,
  kling_30_std: 2500,
  kling_30_pro: 3500,
  upscale_2k_60fps: 2000,
  upscale_video: 2000,
  seedance_25_30s_r2v: 6000,
  seedance_25_30s_strict_r2v: 6000,
  seedance_20_mini_r2v: 3000,
  kling_30_omni_r2v: 3500,
  wan_30_r2v: 3000,
  minimax_h3_r2v: 2500,
  google_tts: 500,
  suno_cover_v6: 500,
  suno_v6: 500,
  suno_v6_wild: 500,
  suno_v6_mini: 500,
  lyria_35: 500,
  minimax_music_3: 500,
  mureka_95: 500,
  sonauto_3: 400,
  acestep_15: 400,
}

export const POSBOT_DEFAULT_FALLBACK = 1000

export interface PosbotPricing {
  /** Harga efektif per model (Rp/generate). */
  models: Record<string, number>
  /** Tarif untuk model yang tidak tercantum. */
  defaultPrice: number
}

const FALLBACK: PosbotPricing = {
  models: { ...POSBOT_PRICE_FALLBACK },
  defaultPrice: POSBOT_DEFAULT_FALLBACK,
}

let cache: { at: number; data: PosbotPricing } | null = null
const TTL_MS = 60 * 1000

/** Ambil harga efektif dari server; jatuh ke cermin bawaan kalau gagal. */
export async function fetchPosbotPricing(): Promise<PosbotPricing> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data
  try {
    const res = await fetch('/api/public/pricing')
    if (!res.ok) return FALLBACK
    const data = await res.json()
    const pb = data?.providers?.posbot
    const serverModels = pb?.models && typeof pb.models === 'object' ? pb.models : {}
    const defaultPrice = Number(pb?.default_charge) || POSBOT_DEFAULT_FALLBACK
    const merged = { ...POSBOT_PRICE_FALLBACK }
    for (const [k, v] of Object.entries(serverModels)) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) merged[k] = n
    }
    const eff: PosbotPricing = { models: merged, defaultPrice }
    cache = { at: Date.now(), data: eff }
    return eff
  } catch {
    return FALLBACK
  }
}

/** Harga efektif model (Rp). */
export function posbotModelPrice(pricing: PosbotPricing, model?: string | null): number {
  if (!model) return pricing.defaultPrice
  return pricing.models[model] ?? pricing.defaultPrice
}

/** Rentang harga efektif (min, max) — untuk tampilan top-up. */
export function posbotPriceRange(pricing: PosbotPricing): { min: number; max: number } {
  const vals = Object.values(pricing.models).filter((v) => Number.isFinite(v) && v > 0)
  return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : { min: pricing.defaultPrice, max: pricing.defaultPrice }
}

/** Rentang hanya untuk kelompok gambar (model dengan harga ≤ 500). */
export function posbotImageRange(pricing: PosbotPricing): { min: number; max: number } {
  const vals = Object.values(pricing.models).filter((v) => Number.isFinite(v) && v > 0 && v <= 500)
  return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : { min: pricing.defaultPrice, max: pricing.defaultPrice }
}

/** Hook ringan untuk komponen yang butuh menampilkan harga PosBot. */
export function usePosbotPricing(): PosbotPricing {
  const [pricing, setPricing] = useState<PosbotPricing>(() => cache?.data ?? FALLBACK)
  useEffect(() => {
    let hidup = true
    fetchPosbotPricing().then((p) => { if (hidup) setPricing(p) })
    return () => { hidup = false }
  }, [])
  return pricing
}
