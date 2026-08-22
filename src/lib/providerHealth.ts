import { getGalleri5AuthHeaders } from '@/lib/galleri5'
import { useProviderManager } from '@/stores/providerManager'

export type ProviderHealthStatus = 'online' | 'busy' | 'down' | 'nokey'

export interface ProviderHealth {
  provider: string
  status: ProviderHealthStatus
  latencyMs?: number
  detail?: string
  checkedAt: number
}

const TIMEOUT_MS = 8000

function firstValidKey(provider: string): string | null {
  const keys = useProviderManager.getState().keys[provider as any] || []
  const key = keys.find(
    (k) => k && k.status !== 'invalid' && k.status !== 'expired' && k.status !== 'empty' && k.key
  )
  return key?.key || null
}

async function probe(url: string, init: RequestInit): Promise<{ latencyMs: number; res: Response }> {
  const t0 = performance.now()
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  const latencyMs = Math.round(performance.now() - t0)
  return { latencyMs, res }
}

// ─── Roboneo ────────────────────────────────────────────────────────────
// Probe read-only via /api/public/roboneo-membership (vipshow). Tidak menyentuh
// nodeexecute sehingga tidak membuat task. 6003 → busy.
async function checkRoboneo(): Promise<ProviderHealth> {
  const token = firstValidKey('roboneo')
  if (!token) {
    return { provider: 'roboneo', status: 'nokey', detail: 'Tidak ada token', checkedAt: Date.now() }
  }
  try {
    const { latencyMs, res } = await probe('/api/public/roboneo-membership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Roboneo-Token': token },
      body: '{}',
    })
    if (!res.ok) {
      return { provider: 'roboneo', status: 'down', latencyMs, detail: `HTTP ${res.status}`, checkedAt: Date.now() }
    }
    const json = await res.json().catch(() => null)
    const data = json?.data
    if (data?.error_code === 6003 || /busy|try again later/i.test(data?.error_msg || '')) {
      return { provider: 'roboneo', status: 'busy', latencyMs, detail: 'Layanan eksekusi sibuk', checkedAt: Date.now() }
    }
    const detail = data?.error_code === 98 ? 'Gateway OK · token ditolak' : 'Gateway OK'
    return { provider: 'roboneo', status: 'online', latencyMs, detail, checkedAt: Date.now() }
  } catch (err: any) {
    return { provider: 'roboneo', status: 'down', detail: err?.message || 'Tidak terhubung', checkedAt: Date.now() }
  }
}

// ─── G5 AI Studio (Galleri5) ────────────────────────────────────────────
// Rantai penuh read-only: refresh token Firebase → authHeaders → info akun.
async function checkGalleri5(): Promise<ProviderHealth> {
  if (!firstValidKey('galleri5')) {
    return { provider: 'galleri5', status: 'nokey', detail: 'Tidak ada token', checkedAt: Date.now() }
  }
  try {
    const headers = await getGalleri5AuthHeaders(undefined, 0)
    if (!headers) {
      return { provider: 'galleri5', status: 'down', detail: 'Gagal resolve auth', checkedAt: Date.now() }
    }
    const { latencyMs, res } = await probe('/api/public/galleri5', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'info', authHeaders: headers }),
    })
    const json = await res.json().catch(() => null)
    if (res.ok && json?.ok) {
      return { provider: 'galleri5', status: 'online', latencyMs, detail: 'Backend & auth OK', checkedAt: Date.now() }
    }
    return { provider: 'galleri5', status: 'down', latencyMs, detail: json?.error || `HTTP ${res.status}`, checkedAt: Date.now() }
  } catch (err: any) {
    return { provider: 'galleri5', status: 'down', detail: err?.message || 'Tidak terhubung', checkedAt: Date.now() }
  }
}

// ─── Weavy ──────────────────────────────────────────────────────────────
// Probe read-only balance via proxy (tidak membuat batch).
async function checkWeavy(): Promise<ProviderHealth> {
  const token = firstValidKey('weavy')
  if (!token) {
    return { provider: 'weavy', status: 'nokey', detail: 'Tidak ada token', checkedAt: Date.now() }
  }
  try {
    const { latencyMs, res } = await probe('/api/public/weavy?action=balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Weavy-Token': token },
      body: '{}',
    })
    const json = await res.json().catch(() => null)
    if (res.ok && json?.ok) {
      return { provider: 'weavy', status: 'online', latencyMs, detail: 'API & token OK', checkedAt: Date.now() }
    }
    return { provider: 'weavy', status: 'down', latencyMs, detail: json?.error || `HTTP ${res.status}`, checkedAt: Date.now() }
  } catch (err: any) {
    return { provider: 'weavy', status: 'down', detail: err?.message || 'Tidak terhubung', checkedAt: Date.now() }
  }
}

// ─── Leonardo ───────────────────────────────────────────────────────────
// GET /v1/users/me — read-only. Token invalid sekalipun, respon 401 dari
// upstream membuktikan layanan hidup.
async function checkLeonardo(): Promise<ProviderHealth> {
  const token = firstValidKey('leonardo') || 'health-check-invalid'
  try {
    const { latencyMs, res } = await probe('/api/public/leonardo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path: '/v1/users/me', method: 'GET' }),
    })
    const json = await res.json().catch(() => null)
    if (json?.status != null || json?.ok) {
      // upstream merespons (200 dengan token valid, atau 401/403 = token invalid)
      const detail = json?.ok ? 'API OK' : json?.error ? `API OK · ${json.error}` : `API OK · HTTP ${json.status}`
      return { provider: 'leonardo', status: 'online', latencyMs, detail, checkedAt: Date.now() }
    }
    return { provider: 'leonardo', status: 'down', latencyMs, detail: json?.error || `HTTP ${res.status}`, checkedAt: Date.now() }
  } catch (err: any) {
    return { provider: 'leonardo', status: 'down', detail: err?.message || 'Tidak terhubung', checkedAt: Date.now() }
  }
}

// ─── Magnific ───────────────────────────────────────────────────────────
// Pakai API key PALSU selalu — dengan key asli submit bisa membuat task nyata.
// Key palsu → upstream balas 401 → terbukti hidup, tanpa biaya.
async function checkMagnific(): Promise<ProviderHealth> {
  try {
    const { latencyMs, res } = await probe('/api/public/magnific', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'submit',
        apiKey: 'health-check-invalid',
        modelKey: 'mag:image-upscaler',
        payload: {},
      }),
    })
    const json = await res.json().catch(() => null)
    if (res.ok && json?.error) {
      return { provider: 'magnific', status: 'online', latencyMs, detail: `API OK · ${json.error}`, checkedAt: Date.now() }
    }
    if (res.ok && json?.ok) {
      return { provider: 'magnific', status: 'online', latencyMs, detail: 'API OK', checkedAt: Date.now() }
    }
    return { provider: 'magnific', status: 'down', latencyMs, detail: json?.error || `HTTP ${res.status}`, checkedAt: Date.now() }
  } catch (err: any) {
    return { provider: 'magnific', status: 'down', detail: err?.message || 'Tidak terhubung', checkedAt: Date.now() }
  }
}

// ─── Framia ─────────────────────────────────────────────────────────────
// Upstream aacreative.vercel.app sudah tidak ada (DEPLOYMENT_NOT_FOUND).
// Probe via proxy — respon non-2xx / DEPLOYMENT_NOT_FOUND = down.
async function checkFramia(): Promise<ProviderHealth> {
  if (!firstValidKey('framia')) {
    return { provider: 'framia', status: 'nokey', detail: 'Tidak ada token', checkedAt: Date.now() }
  }
  try {
    const { latencyMs, res } = await probe('/api/public/framia?path=workflows/skills', {
      method: 'GET',
      headers: { Authorization: 'Bearer health-check' },
    })
    const text = await res.text().catch(() => '')
    if (res.ok && !/DEPLOYMENT_NOT_FOUND|not found/i.test(text)) {
      return { provider: 'framia', status: 'online', latencyMs, detail: 'API OK', checkedAt: Date.now() }
    }
    const detail = /DEPLOYMENT_NOT_FOUND/i.test(text)
      ? 'Upstream hilang (DEPLOYMENT_NOT_FOUND)'
      : `HTTP ${res.status}`
    return { provider: 'framia', status: 'down', latencyMs, detail, checkedAt: Date.now() }
  } catch (err: any) {
    return { provider: 'framia', status: 'down', detail: err?.message || 'Tidak terhubung', checkedAt: Date.now() }
  }
}

// ─── OneOver ──────────────────────────────────────────────────────────
// Probe via balance endpoint — lightweight, read-only.
async function checkOneOver(): Promise<ProviderHealth> {
  const token = firstValidKey('oneover')
  if (!token) {
    return { provider: 'oneover', status: 'nokey', detail: 'Tidak ada token', checkedAt: Date.now() }
  }
  try {
    const { resolveOneOverAccessToken, extractOneOverUserId } = await import('@/lib/oneover')
    const accessToken = await resolveOneOverAccessToken(token)
    const userId = extractOneOverUserId(accessToken)
    const qs = userId ? `?action=balance&user_id=${encodeURIComponent(userId)}` : '?action=balance'
    const { latencyMs, res } = await probe(`/api/public/oneover${qs}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const json = await res.json().catch(() => null)
    const bal = json?.total_credits ?? json?.current_balance ?? json?.balance
    if (res.ok && bal != null) {
      return { provider: 'oneover', status: 'online', latencyMs, detail: `Balance: ${bal} cr`, checkedAt: Date.now() }
    }
    if (res.ok && !json?.error) {
      return { provider: 'oneover', status: 'online', latencyMs, detail: 'API OK', checkedAt: Date.now() }
    }
    return { provider: 'oneover', status: 'down', latencyMs, detail: json?.error?.message || json?.error || `HTTP ${res.status}`, checkedAt: Date.now() }
  } catch (err: any) {
    return { provider: 'oneover', status: 'down', detail: err?.message || 'Tidak terhubung', checkedAt: Date.now() }
  }
}

const CHECKERS: Record<string, () => Promise<ProviderHealth>> = {
  roboneo: checkRoboneo,
  galleri5: checkGalleri5,
  weavy: checkWeavy,
  leonardo: checkLeonardo,
  magnific: checkMagnific,
  framia: checkFramia,
  oneover: checkOneOver,
}

/** Provider yang punya probe live. Lainnya (mis. wavespeed) ditampilkan via status key. */
export const HEALTH_PROVIDERS = Object.keys(CHECKERS)

/**
 * Cek status live semua provider yang punya probe — dijalankan paralel.
 * Aman: semua probe read-only, tidak membuat task generate.
 */
export async function checkAllProviderHealth(): Promise<Record<string, ProviderHealth>> {
  const entries = await Promise.allSettled(
    Object.entries(CHECKERS).map(async ([provider, fn]) => {
      try {
        return [provider, await fn()] as const
      } catch (err: any) {
        return [provider, { provider, status: 'down', detail: err?.message || 'Error', checkedAt: Date.now() }] as const
      }
    })
  )
  const out: Record<string, ProviderHealth> = {}
  for (const e of entries) {
    if (e.status === 'fulfilled') out[e.value[0]] = e.value[1]
  }
  return out
}
