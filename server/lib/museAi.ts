/**
 * MuseAI (MusangAPI / GemuseAPI) — jembatan OpenAI-compatible ke muse.ai.
 *
 * Server MusangAPI jalan di VPS (systemd musangapi, port 18610) dan
 * mengekspos /v1/chat/completions, /v1/images/generations, /v1/videos.
 * Kredensial (MUSE2API_KEY) DISIMPAN SERVER-LEVEL di app_settings, dengan
 * fallback env MUSE2API_KEY / MUSE_BASE — tidak pernah dikirim ke browser.
 *
 * Semua generate lewat relay /api/public/muse — member tidak punya kunci,
 * cukup saldo wallet (muse_balance) yang dipotong saat submit & direfund
 * kalau upstream gagal.
 */
import db from '../db.js'

export const MUSE_KEY_SETTING = 'muse_api_key'
export const MUSE_BASE_SETTING = 'muse_api_base'
export const DEFAULT_MUSE_BASE = 'http://127.0.0.1:18610/v1'

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

export function museApiKey(): string {
  return setting(MUSE_KEY_SETTING) || (process.env.MUSE2API_KEY || '').trim()
}

export function museBaseUrl(): string {
  return (setting(MUSE_BASE_SETTING) || (process.env.MUSE_BASE || '').trim() || DEFAULT_MUSE_BASE).replace(/\/+$/, '')
}

export function museStatus(): {
  configured: boolean
  source: 'database' | 'env' | 'none'
  base: string
} {
  const dbKey = setting(MUSE_KEY_SETTING)
  const envKey = (process.env.MUSE2API_KEY || '').trim()
  const key = dbKey || envKey
  return {
    configured: !!key,
    source: dbKey ? 'database' : envKey ? 'env' : 'none',
    base: museBaseUrl(),
  }
}

export function saveMuseCredentials(apiKey: string, baseUrl: string): void {
  const upsert = db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  )
  db.transaction(() => {
    if (apiKey.trim()) upsert.run(MUSE_KEY_SETTING, apiKey.trim())
    if (baseUrl.trim()) upsert.run(MUSE_BASE_SETTING, baseUrl.trim())
  })()
}

export function deleteMuseCredentials(): void {
  db.prepare('DELETE FROM app_settings WHERE key IN (?, ?)').run(MUSE_KEY_SETTING, MUSE_BASE_SETTING)
}

export class MuseApiError extends Error {
  constructor(message: string, public status?: number, public upstream?: any) {
    super(message)
    this.name = 'MuseApiError'
  }
}

/** POST ke endpoint MusangAPI dengan Bearer key. */
export async function museRequest(
  path: string,
  body: Record<string, any>,
  opts: { timeoutMs?: number; method?: string; headers?: Record<string, string> } = {},
): Promise<any> {
  const key = museApiKey()
  if (!key) throw new MuseApiError('Kredensial MuseAI belum diatur admin')
  const url = `${museBaseUrl()}${path}`
  const res = await fetch(url, {
    method: opts.method || 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    body: opts.method === 'GET' ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs || 300000),
  })
  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) } catch { throw new MuseApiError(`Respons bukan JSON (HTTP ${res.status}): ${text.slice(0, 200)}`) }
  if (!res.ok) {
    throw new MuseApiError(json?.error?.message || json?.message || `MuseAI HTTP ${res.status}`, res.status, json)
  }
  return json
}
