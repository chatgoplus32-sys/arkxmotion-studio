// ─── MuseAI client (MusangAPI via proxy) ────────────────────────────────────
// Kredensial MusangAPI server-level — klien hanya memanggil proxy /api/public/muse.
export const MUSE_API = '/api/public/muse'
export const MUSE_MIN_TOPUP = 10000
export const MUSE_MODEL_PRICE_FALLBACK: Record<string, number> = {
  'muse-spark': 200,
  'muse-image': 500,
  'muse-video': 1500,
}
export const MUSE_DEFAULT_PRICE_FALLBACK = 500

export interface MusePricing {
  models: Record<string, number>
  defaultPrice: number
}
let cache: { at: number; data: MusePricing } | null = null
const TTL = 60_000

export async function fetchMusePricing(): Promise<MusePricing> {
  if (cache && Date.now() - cache.at < TTL) return cache.data
  try {
    const res = await fetch('/api/public/pricing')
    if (!res.ok) throw new Error('pricing')
    const d = await res.json()
    const m = d?.providers?.muse
    const models = { ...MUSE_MODEL_PRICE_FALLBACK }
    for (const [k, v] of Object.entries(m?.models || {})) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) models[k] = n
    }
    const data: MusePricing = { models, defaultPrice: Number(m?.default_price) || MUSE_DEFAULT_PRICE_FALLBACK }
    cache = { at: Date.now(), data }
    return data
  } catch {
    return { models: { ...MUSE_MODEL_PRICE_FALLBACK }, defaultPrice: MUSE_DEFAULT_PRICE_FALLBACK }
  }
}

export function musePrice(pricing: MusePricing, model?: string): number {
  return model ? (pricing.models[model] ?? pricing.defaultPrice) : pricing.defaultPrice
}

async function api<T>(token: string, action: string, body: Record<string, any> = {}, method = 'POST'): Promise<T> {
  const res = await fetch(`${MUSE_API}?action=${action}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: method === 'GET' ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) throw new Error(data?.error || `MuseAI HTTP ${res.status}`)
  return data as T
}

export interface MuseChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export async function museChat(token: string, messages: MuseChatMessage[]): Promise<string> {
  const d = await api<{ data: any }>(token, 'chat', { messages, model: 'muse-spark' })
  return d?.data?.choices?.[0]?.message?.content || d?.data?.choices?.[0]?.text || ''
}

export async function museImage(token: string, prompt: string, size = '16:9', images?: string[]): Promise<string[]> {
  const d = await api<{ data: any }>(token, 'image', { prompt, size, images })
  const arr = d?.data?.data || []
  return arr.map((x: any) => x.url || x.b64_json).filter(Boolean)
}

export async function museVideoCreate(token: string, prompt: string, duration = 10, size = '16:9'): Promise<string> {
  const key = `muse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const d = await api<{ data: any }>(token, 'video-create', {
    prompt, duration, size, idempotency_key: key,
  })
  return d?.data?.id || d?.data?.task_id || ''
}

export async function museVideoStatus(token: string, taskId: string): Promise<{ status: string; url?: string; error?: string }> {
  const res = await fetch(`${MUSE_API}?action=video-status&taskId=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60000),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j?.ok === false) return { status: 'ERROR', error: j?.error || 'Gagal cek status' }
  const row = j?.data || {}
  const status = String(row.status || '').toUpperCase()
  return {
    status,
    url: status === 'SUCCEEDED' || status === 'COMPLETED' ? (row.url || row.video_url || row.result?.url || row.output?.url) : undefined,
    error: row.error?.message || row.error,
  }
}
