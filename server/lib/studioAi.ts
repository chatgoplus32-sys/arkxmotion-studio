import db from '../db.js'
import { hasActiveUnlimited } from './nexabotMasterKey.js'

/**
 * AI ARKX AUTO Studio memakai kunci Gemini milik server.
 *
 * Kunci disimpan admin di app_settings ('studio_gemini_key'), dengan
 * GEMINI_API_KEY sebagai cadangan untuk server yang belum punya dashboard.
 * Biaya transkripsi/plan/TTS ditanggung operator, jadi akses digerbangi
 * paket Pro/Unlimited dan dibatasi per hari.
 */

export const STUDIO_KEY_SETTING = 'studio_gemini_key'
export const STUDIO_CAP_SETTING = 'studio_ai_daily_cap'
export const GEMINI_BASE = 'https://generativelanguage.googleapis.com'

/** Batas panggilan per member per hari bila admin belum menyetel apa pun. */
export const DEFAULT_DAILY_CAP = 40

/** Hanya method Gemini yang dipakai Studio; selain ini ditolak (bukan proxy bebas). */
const ALLOWED_METHODS = new Set([
  'generateContent',
  'streamGenerateContent',
  'countTokens',
])

export interface StudioTarget {
  model: string
  method: string
}

export function parseStudioTarget(raw: string): StudioTarget | null {
  const target = String(raw || '').trim()
  const sep = target.lastIndexOf(':')
  if (sep <= 0) return null
  const model = target.slice(0, sep)
  const method = target.slice(sep + 1)
  if (!/^gemini-[a-z0-9.-]+$/i.test(model)) return null
  if (!ALLOWED_METHODS.has(method)) return null
  return { model, method }
}

function setting(key: string): string {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return (row?.value || '').trim()
  } catch {
    return ''
  }
}

export function studioGeminiKey(): string {
  return setting(STUDIO_KEY_SETTING) || (process.env.GEMINI_API_KEY || '').trim()
}

export function studioDailyCap(): number {
  const n = Number(setting(STUDIO_CAP_SETTING))
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_CAP
}

/**
 * Model cadangan bila model yang diminta Studio ditolak kunci server.
 *
 * Studio memaku `gemini-3-flash-preview`. Pada kunci server 2026-11-07 model itu
 * dibalas 429 (kuota), `gemini-3.5-flash` bisa teks tetapi 429 untuk audio,
 * sedangkan `gemini-3.1-flash-lite` / `gemini-3.5-flash-lite` lolos untuk teks
 * maupun audio inline. Relay mencoba urutan ini supaya kegagalan satu model
 * tidak mematikan seluruh Studio.
 */
export const STUDIO_FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']

/** Model yang baru ditolak kuota/404 dilewati sementara agar tidak dua kali lambat. */
const unavailableUntil = new Map<string, number>()
const MODEL_COOLDOWN_MS = 10 * 60 * 1000

export function studioModelOrder(requested: string): string[] {
  const now = Date.now()
  const ordered = [requested, ...STUDIO_FALLBACK_MODELS.filter((m) => m !== requested)]
  const fresh = ordered.filter((m) => (unavailableUntil.get(m) || 0) <= now)
  // Semua sedang cooldown: tetap coba model yang diminta, jangan menyerah tanpa
  // satu panggilan pun.
  return fresh.length > 0 ? fresh : [requested]
}

export function markStudioModelUnavailable(model: string): void {
  unavailableUntil.set(model, Date.now() + MODEL_COOLDOWN_MS)
}

export function resetStudioModelCooldown(): void {
  unavailableUntil.clear()
}

export type StudioEntitlement =
  | { ok: true; reason: 'admin' | 'pro' | 'unlimited' }
  | { ok: false; reason: 'login' | 'pro' }

export function studioEntitlement(userId: number | undefined): StudioEntitlement {
  if (!userId) return { ok: false, reason: 'login' }

  const row = db.prepare('SELECT role, plan FROM users WHERE id = ?').get(userId) as
    | { role?: string; plan?: string }
    | undefined
  if (!row) return { ok: false, reason: 'login' }
  if (row.role === 'admin') return { ok: true, reason: 'admin' }
  if (row.plan === 'pro') return { ok: true, reason: 'pro' }
  if (hasActiveUnlimited(userId)) return { ok: true, reason: 'unlimited' }
  return { ok: false, reason: 'pro' }
}

/** Jumlah panggilan AI Studio yang sudah tercatat hari ini (UTC, pola SQLite). */
export function studioUsageToday(userId: number): number {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM studio_ai_usage WHERE user_id = ? AND created_at >= ?')
    .get(userId, dayAgo) as { n: number } | undefined
  return Number(row?.n) || 0
}

export function recordStudioUsage(
  userId: number,
  model: string,
  method: string,
  status: number,
  ms: number,
): void {
  try {
    db.prepare(
      'INSERT INTO studio_ai_usage (user_id, model, method, status, ms, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(userId, model, method, status, ms, Date.now())
  } catch (err) {
    console.error('[studio-ai] gagal mencatat pemakaian:', (err as Error)?.message)
  }
}
