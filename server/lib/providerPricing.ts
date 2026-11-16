// ─── Harga provider (Seavi/PosBot/RunningHub/CreatePulse) yang bisa diedit ──
// Sampai 15 Nov 2026, harga keempat wallet provider ini hanya hidup di
// shared/pricing.ts — mengganti harga = edit kode + deploy. Sekarang harga
// tersimpan di app_settings (kunci `provider_pricing`, satu JSON) dan dibaca
// setiap charge — pola yang sama dengan NexaBot harganya tidak lagi terkunci di kode.
//
// Bentuk simpanan:
//   {
//     "<provider>": {
//       "flat"?:    number,              // RunningHub: tarif flat Rp/generate
//       "default"?: number|null,         // harga per unit kalau model tak tercantum
//       "models"?:  { "<model>": number|null, ... }  // null = hapus override
//     },
//     ...
//   }
//
// Semua angka dibounded (default & override) supaya salah ketik admin tidak
// bisa membuat harga 0 / negatif / astronomi. Fallback ke katalog kode kalau
// belum diatur. Nilai null pada `models` = hapus override untuk model itu;
// `flat`/`default` = null dikembalikan ke default kode.
//
// Catatan: `app_settings` adalah SATU kunci JSON supaya write tidak mengacak
// urutan upsert dan baris tidak ribuan (PosBot punya ~50 model).

import db from '../db.js'
import {
  SEAVI_MODEL_TOKENS,
  SEAVI_DEFAULT_CHARGE,
  POSBOT_MODEL_PRICES,
  POSBOT_DEFAULT_CHARGE,
  RUNNINGHUB_CHARGE,
  CREATEPULSE_MODEL_PRICES,
  CREATEPULSE_DEFAULT_PRICE,
} from '../../shared/pricing.js'

export type ProviderId = 'seavi' | 'posbot' | 'runninghub' | 'createpulse'

export const PROVIDER_IDS: ProviderId[] = ['seavi', 'posbot', 'runninghub', 'createpulse']

interface ProviderPriceConfig {
  flat?: number | null
  default?: number | null
  models?: Record<string, number | null>
}

export type ProviderPricingState = Partial<Record<ProviderId, ProviderPriceConfig>>

const SETTINGS_KEY = 'provider_pricing'

const LIMITS: Record<ProviderId, { min: number; max: number }> = {
  seavi: { min: 1, max: 100 }, // bobot token per generate
  posbot: { min: 1, max: 10_000_000 }, // Rp
  runninghub: { min: 1, max: 10_000_000 }, // Rp
  createpulse: { min: 1, max: 10_000_000 }, // Rp
}

const SPECS: Record<
  ProviderId,
  { kind: 'model' | 'flat'; default: number; models: Record<string, number> }
> = {
  seavi: { kind: 'model', default: SEAVI_DEFAULT_CHARGE, models: SEAVI_MODEL_TOKENS },
  posbot: { kind: 'model', default: POSBOT_DEFAULT_CHARGE, models: POSBOT_MODEL_PRICES },
  runninghub: { kind: 'flat', default: RUNNINGHUB_CHARGE, models: {} },
  createpulse: { kind: 'model', default: CREATEPULSE_DEFAULT_PRICE, models: CREATEPULSE_MODEL_PRICES },
}

const MAX_MODELS = 2000
const MAX_MODEL_KEY = 80

function readSettings(): ProviderPricingState {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(SETTINGS_KEY) as
    | { value: string }
    | undefined
  if (!row?.value) return {}
  try {
    const parsed = JSON.parse(row.value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const upsert = db.prepare(
  `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
)

function bounded(raw: unknown, provider: ProviderId, fallback: number): number {
  const x = Number(raw)
  if (!Number.isFinite(x)) return fallback
  const { min, max } = LIMITS[provider]
  if (x < min || x > max) return fallback
  return Math.round(x)
}

/** Id model Seavi/PosBot/CreatePulse (klien kadang mengirim 'sv:xx'/'pb:xx'). */
function idModel(model: string | null | undefined): string {
  const raw = String(model || '').trim()
  return raw.includes(':') ? (raw.split(':').pop() || raw) : raw
}

export interface ProviderPricingEffective {
  provider: ProviderId
  kind: 'model' | 'flat'
  /** Harga per unit untuk provider flat (RunningHub), Rp. */
  flat: number | null
  /** Harga unit default (dipakai bila model tak ada), atau null (flat). */
  default: number | null
  /** Harga per model — override admin, bukan fallback kode. */
  models: Record<string, number>
  /** Katalog yang diketahui server: harga efektif (default kode dioverride). */
  catalog: Record<string, number>
  limits: { min: number; max: number }
}

/**
 * Harga satu unit yang benar-benar dipotong untuk `model`.
 * Urutan: override admin → katalog kode → `default` admin → default kode.
 */
export function providerUnitCharge(provider: ProviderId, model?: string | null): number {
  const cfg = readSettings()[provider] || {}
  const spec = SPECS[provider]
  if (spec.kind === 'flat') {
    return bounded(cfg.flat ?? cfg.default ?? spec.default, provider, spec.default)
  }
  const id = idModel(model)
  if (id && cfg.models && Object.prototype.hasOwnProperty.call(cfg.models, id)) {
    const override = cfg.models[id]
    if (override != null) return bounded(override, provider, spec.models[id] ?? spec.default)
  }
  // Model yang punya harga khusus di katalog kode tetap pakai harga itu;
  // `default` admin hanya untuk model yang tidak tercantum.
  if (id && spec.models[id] != null) return bounded(spec.models[id], provider, spec.default)
  return bounded(cfg.default, provider, spec.default)
}

/** Harga efektif satu unit (seperti yang benar-benar dipotong). */
export function getProviderPricing(provider: ProviderId): ProviderPricingEffective {
  const cfg = readSettings()[provider] || {}
  const spec = SPECS[provider]
  const { min, max } = LIMITS[provider]

  if (spec.kind === 'flat') {
    return {
      provider,
      kind: 'flat',
      flat: bounded(cfg.flat ?? spec.default, provider, spec.default),
      default: null,
      models: {},
      catalog: { ...spec.models },
      limits: { min, max },
    }
  }

  const catalog: Record<string, number> = {}
  for (const [m, base] of Object.entries(spec.models)) {
    if (cfg.models && Object.prototype.hasOwnProperty.call(cfg.models, m)) {
      const override = cfg.models[m]
      catalog[m] = override != null ? bounded(override, provider, base) : base
    } else {
      catalog[m] = base
    }
  }

  const overrideModels: Record<string, number> = {}
  for (const [m, override] of Object.entries(cfg.models || {})) {
    if (override == null) continue
    overrideModels[m] = bounded(override, provider, spec.models[m] ?? spec.default)
  }

  return {
    provider,
    kind: 'model',
    flat: null,
    default: bounded(cfg.default, provider, spec.default),
    models: overrideModels,
    catalog,
    limits: { min, max },
  }
}

/** Semua provider sekaligus (untuk halaman settings). */
export function getAllProviderPricing(): Record<ProviderId, ProviderPricingEffective> {
  const out = {} as Record<ProviderId, ProviderPricingEffective>
  for (const p of PROVIDER_IDS) out[p] = getProviderPricing(p)
  return out
}

/**
 * Simpan patch harga. Bentuk patch:
 *   { provider, flat?: number|null, default?: number|null,
 *     models?: { "<model>": number|null, ... } }
 * Nilai null pada flat/default/models<key> MENGHAPUS override (kembali ke kode).
 */
export function setProviderPricing(
  provider: ProviderId,
  patch: { flat?: unknown; default?: unknown; models?: unknown },
): ProviderPricingEffective {
  if (!PROVIDER_IDS.includes(provider)) throw new Error(`Provider tidak dikenal: ${provider}`)

  const current = { ...readSettings() }
  const next: ProviderPriceConfig = { ...(current[provider] || {}) }

  const prosesAngka = (nama: string, v: unknown, min: number, max: number): number | null | undefined => {
    if (v === undefined) return undefined
    if (v === null) return null // hapus override → default kode
    const x = Number(v)
    if (!Number.isFinite(x)) throw new Error(`${nama} harus angka antara ${min} dan ${max}`)
    if (x < min || x > max) throw new Error(`${nama} harus angka antara ${min} dan ${max}`)
    return Math.round(x)
  }

  const { min, max } = LIMITS[provider]

  const flat = prosesAngka('Tarif flat', patch.flat, min, max)
  if (flat !== undefined) next.flat = flat

  const def = prosesAngka('Harga default', patch.default, min, max)
  if (def !== undefined) next.default = def

  if (patch.models !== undefined) {
    if (typeof patch.models !== 'object' || patch.models === null || Array.isArray(patch.models)) {
      throw new Error('`models` harus objek { model: harga }')
    }
    const modelMap = { ...(next.models || {}) }
    const entries = Object.entries(patch.models as Record<string, unknown>)
    if (entries.length > MAX_MODELS) throw new Error('Terlalu banyak model sekaligus')
    for (const [key, raw] of entries) {
      const k = String(key).trim()
      if (!k || k.length > MAX_MODEL_KEY) throw new Error('Nama model tidak valid')
      if (raw === null) {
        delete modelMap[k] // hapus override
        continue
      }
      const x = Number(raw)
      if (!Number.isFinite(x)) throw new Error(`Harga model ${k} harus angka`)
      if (x < min || x > max) throw new Error(`Harga model ${k} harus antara ${min} dan ${max}`)
      modelMap[k] = Math.round(x)
    }
    next.models = modelMap
  }

  current[provider] = next
  upsert.run(SETTINGS_KEY, JSON.stringify(current))
  return getProviderPricing(provider)
}

/** Hapus semua override provider — kembali ke katalog kode. */
export function resetProviderPricing(provider: ProviderId): ProviderPricingEffective {
  if (!PROVIDER_IDS.includes(provider)) throw new Error(`Provider tidak dikenal: ${provider}`)
  const current = { ...readSettings() }
  delete current[provider]
  upsert.run(SETTINGS_KEY, JSON.stringify(current))
  return getProviderPricing(provider)
}
