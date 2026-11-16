// ─── Harga provider efektif (cermin /api/public/pricing) ────────────────────
// Sumber kebenaran: app_settings (`provider_pricing`) di server — admin mengubah
// dari System Settings → Harga Token & Wallet, dibaca klien lewat endpoint
// publik (cache 60 detik). Modul ini hanya CERMIN tampilan + dukungan untuk
// spec provider yang static di kode; angka yang benar-benar dipotong selalu
// harga dari server (route /deduct memakai providerUnitCharge di
// server/lib/providerPricing.ts).
//
// overrideFor() mengembalikan undefined selama cache kosong — pemanggil
// jangan menebak harga, pakai fallback kode apa adanya.
import { useEffect, useState } from 'react'

export type EffProvider = 'seavi' | 'posbot' | 'runninghub' | 'createpulse'

export interface ProviderEffective {
  models: Record<string, number>
  defaultCharge: number
}

interface Cache {
  at: number
  data: Record<EffProvider, ProviderEffective> | null
}

let cache: Cache = { at: 0, data: null }
let inflight: Promise<Record<EffProvider, ProviderEffective> | null> | null = null
const TTL_MS = 60 * 1000
const EMPTY: Record<EffProvider, ProviderEffective> = {
  seavi: { models: {}, defaultCharge: 1 },
  posbot: { models: {}, defaultCharge: 1000 },
  runninghub: { models: {}, defaultCharge: 2500 },
  createpulse: { models: {}, defaultCharge: 1500 },
}

const ambilNomor = (v: unknown, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function parseProvider(raw: any, fallback: ProviderEffective): ProviderEffective {
  const models: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw?.models || {})) {
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0) models[k] = n
  }
  const defaultCharge = ambilNomor(raw?.default_price ?? raw?.default_charge, fallback.defaultCharge)
  return { models, defaultCharge }
}

/** Ambil harga efektif semua provider; aman dipanggil paralel (inflight tunggal). */
export function refreshEffectivePricing(): Promise<Record<EffProvider, ProviderEffective> | null> {
  if (cache.data && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.data)
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch('/api/public/pricing')
      if (!res.ok) return null
      const body = await res.json()
      const providers = body?.providers || {}
      const data: Record<EffProvider, ProviderEffective> = {
        seavi: parseProvider(providers.seavi, EMPTY.seavi),
        posbot: parseProvider(providers.posbot, EMPTY.posbot),
        runninghub: parseProvider(providers.runninghub, EMPTY.runninghub),
        createpulse: parseProvider(providers.createpulse, EMPTY.createpulse),
      }
      cache = { at: Date.now(), data }
      return data
    } catch {
      return null
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * Harga satuan efektif untuk satu model harga dari override admin. Undefined
 * berarti "belum tahu" — pemanggil memakai fallback kode, bukan angka 0.
 * Id dengan prefix ('sv:xxx', 'pb:xxx') dinormalkan dulu, sama seperti server.
 */
export function overrideFor(provider: EffProvider, model?: string | null): number | undefined {
  const c = cache.data?.[provider]
  if (!c) return undefined
  const id = (() => {
    const raw = String(model || '').trim()
    if (!raw) return null
    return raw.includes(':') ? raw.split(':').pop() || raw : raw
  })()
  if (id && Object.prototype.hasOwnProperty.call(c.models, id)) return c.models[id]
  return c.defaultCharge
}

/**
 * Hook pemicu refetch. Halaman yang menampilkan harga memanggilnya sekali;
 * re-render terjadi begitu jawaban server masuk, jadi angka langsung berubah
 * ke nilai System Settings tanpa perlu reload.
 */
export function useProviderPricing(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let hidup = true
    refreshEffectivePricing().then(() => { if (hidup) setTick((n) => n + 1) })
    return () => { hidup = false }
  }, [])
  return tick
}
