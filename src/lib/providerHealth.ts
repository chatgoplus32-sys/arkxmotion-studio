import { getGalleri5AuthHeaders } from '@/lib/galleri5'
import { appAuthHeaders } from '@/lib/nexabot'
import { OMNI_API_URL, OMNI_MODEL } from '@/lib/omni'
import {
  checkRunningHubBalance,
  formatRhWalletCompact,
  saveRhCreditSnapshot,
  type RHTokenWallet,
} from '@/lib/runninghub'
import { useProviderManager, RUNNINGHUB_SERVER_MANAGED_KEY } from '@/stores/providerManager'

export type ProviderHealthStatus = 'online' | 'busy' | 'down' | 'nokey'

export interface ProviderHealth {
  provider: string
  status: ProviderHealthStatus
  latencyMs?: number
  detail?: string
  /** Ringkasan kredit/saldo versi pendek untuk chip status. */
  creditsLabel?: string
  /** Snapshot kredit access token RunningHub. */
  wallet?: RHTokenWallet | null
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

// ─── NexaBot ──────────────────────────────────────────────────────────
// Probe via credit endpoint — lightweight, read-only.
async function checkNexabot(): Promise<ProviderHealth> {
  const keys = useProviderManager.getState().keys['nexabot' as any] || []
  const entry = keys.find(
    (k) => k && k.status !== 'invalid' && k.status !== 'expired' && k.status !== 'empty' && (k.key || k.cookies)
  )
  if (!entry) {
    return { provider: 'nexabot', status: 'nokey', detail: 'Tidak ada API key / session', checkedAt: Date.now() }
  }
  // Mode session (cookie): generate lewat /api/v1/generate dan saldo kredit tidak
  // relevan (paket Unlimited), jadi tidak perlu probe /credit.
  if (entry.cookies) {
    return { provider: 'nexabot', status: 'online', detail: 'Session mode (cookie) — Unlimited', checkedAt: Date.now() }
  }
  const token = entry.key
  try {
    const { latencyMs, res } = await probe('/api/public/nexabot/credit', {
      method: 'GET',
      headers: { 'X-Api-Key': token, ...appAuthHeaders() },
    })
    const json = await res.json().catch(() => null)
    if (res.ok && json?.ok) {
      const balance = json.credit ?? 0
      return { provider: 'nexabot', status: 'online', latencyMs, detail: `Balance: ${balance} cr`, checkedAt: Date.now() }
    }
    if (res.status === 401) {
      return { provider: 'nexabot', status: 'down', latencyMs, detail: 'API key tidak valid', checkedAt: Date.now() }
    }
    return { provider: 'nexabot', status: 'down', latencyMs, detail: json?.error || `HTTP ${res.status}`, checkedAt: Date.now() }
  } catch (err: any) {
    return { provider: 'nexabot', status: 'down', detail: err?.message || 'Tidak terhubung', checkedAt: Date.now() }
  }
}

// ─── Seavi ────────────────────────────────────────────────────────────
// Probe via balance endpoint — lightweight, read-only.
async function checkSeavi(): Promise<ProviderHealth> {
  const token = firstValidKey('seavi')
  if (!token) {
    return { provider: 'seavi', status: 'nokey', detail: 'Tidak ada API key', checkedAt: Date.now() }
  }
  try {
    const { latencyMs, res } = await probe('/api/public/seavi?path=balance', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => null)
    if (res.ok && typeof json?.token_remaining === 'number') {
      return { provider: 'seavi', status: 'online', latencyMs, detail: `Balance: ${json.token_remaining} token`, checkedAt: Date.now() }
    }
    if (res.ok && !json?.error) {
      return { provider: 'seavi', status: 'online', latencyMs, detail: 'API OK', checkedAt: Date.now() }
    }
    return { provider: 'seavi', status: 'down', latencyMs, detail: json?.error?.message || json?.error || `HTTP ${res.status}`, checkedAt: Date.now() }
  } catch (err: any) {
    return { provider: 'seavi', status: 'down', detail: err?.message || 'Tidak terhubung', checkedAt: Date.now() }
  }
}

// ─── Omni (Google Gemini 15s video) ───────────────────────────────────────
// Probe via POST ke endpoint interaksi Google. Tanpa API key → nokey.
// Dengan API key (termasuk palsu): 401/403 = upstream hidup (key perlu diperbarui),
// 2xx = online, 5xx = degraded. Tidak auto-retry (request potensi billable).
async function checkOmni(): Promise<ProviderHealth> {
  const token = firstValidKey('omni')
  if (!token) {
    return { provider: 'omni', status: 'nokey', detail: 'Tidak ada API key Gemini', checkedAt: Date.now() }
  }
  try {
    const start = Date.now()
    const ac = new AbortController()
    const tid = setTimeout(() => ac.abort(), 10000)
    const res = await fetch(OMNI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': token,
      },
      body: JSON.stringify({
        model: OMNI_MODEL,
        input: 'health check',
        response_format: { type: 'video', duration: '15s', aspect_ratio: '16:9', resolution: '720p', delivery: 'uri' },
        store: false,
      }),
      signal: ac.signal,
    })
    clearTimeout(tid)
    const latencyMs = Date.now() - start
    if (res.ok) return { provider: 'omni', status: 'online', latencyMs, detail: 'API OK', checkedAt: Date.now() }
    if (res.status === 401 || res.status === 403) {
      return { provider: 'omni', status: 'online', latencyMs, detail: 'API OK · key perlu diperbarui', checkedAt: Date.now() }
    }
    return { provider: 'omni', status: 'down', latencyMs, detail: `HTTP ${res.status}`, checkedAt: Date.now() }
  } catch (err: any) {
    return { provider: 'omni', status: 'down', detail: err?.message || 'Tidak terhubung', checkedAt: Date.now() }
  }
}

// ─── RunningHub ─────────────────────────────────────────────────────────
// Cek limit/status = baca wallet access token (kredit video/image + poin
// harian). Key pengguna yang sudah dicabut tidak membuat provider tampak mati:
// relay mengalihkan generate ke token server, jadi status mengikuti token yang
// benar-benar dipakai. Koin RH tidak bisa dibaca dari access token — hanya
// kredit gratis + poin yang dilaporkan.
async function checkRunningHub(): Promise<ProviderHealth> {
  const keys = useProviderManager.getState().keys.runninghub || []
  // Placeholder "server-managed" bukan kredensial milik pengguna — relai yang
  // menyuntikkan token server, jadi probe tanpa key (server yang menentukan).
  const userKey = keys.find((k) => k.key && k.key !== RUNNINGHUB_SERVER_MANAGED_KEY) || null

  try {
    let source: 'user' | 'server' = userKey ? 'user' : 'server'
    let res = await checkRunningHubBalance(userKey?.key || '')

    // Key pengguna ditolak RunningHub (412/806) — generate tetap jalan lewat
    // token server, jadi kredit yang ditampilkan harus milik token server.
    if (userKey && res.invalidKey) {
      const server = await checkRunningHubBalance('')
      if (server.ok && server.isValidUser) {
        res = server
        source = 'server'
      }
    }

    const wallet = res.tokenWallet ?? null
    const walletLabel = formatRhWalletCompact(wallet)
    if (res.ok && res.isValidUser) {
      saveRhCreditSnapshot({
        wallet,
        balance: res.balance ?? null,
        source,
        at: Date.now(),
      })
      const label = walletLabel || (res.balance != null ? `${res.balance} koin` : '')
      return {
        provider: 'runninghub',
        status: 'online',
        detail: [source === 'server' ? 'token server' : 'token pengguna', label || 'saldo belum terbaca']
          .filter(Boolean)
          .join(' · '),
        creditsLabel: label || undefined,
        wallet,
        checkedAt: Date.now(),
      }
    }

    if (res.invalidKey) {
      saveRhCreditSnapshot({ wallet: null, balance: null, source, at: Date.now(), error: res.error })
      return {
        provider: 'runninghub',
        status: 'down',
        detail: res.error || 'Access token ditolak RunningHub',
        checkedAt: Date.now(),
      }
    }

    // Gangguan upstream (timeout/HTML 502) bukan bukti provider mati.
    return {
      provider: 'runninghub',
      status: keys.length ? 'online' : 'nokey',
      detail: res.error || 'Gateway OK · kredit belum terbaca',
      checkedAt: Date.now(),
    }
  } catch (err: any) {
    return {
      provider: 'runninghub',
      status: keys.length ? 'online' : 'nokey',
      detail: err?.message || 'Tidak terhubung',
      checkedAt: Date.now(),
    }
  }
}

// ─── PosBot ─────────────────────────────────────────────────────────────
// Probe read-only GET /balance. Saldo PosBot dalam Rupiah, bukan kredit app.
async function checkPosbot(): Promise<ProviderHealth> {
  const token = firstValidKey('posbot')
  if (!token) {
    return { provider: 'posbot', status: 'nokey', detail: 'Tidak ada API key', checkedAt: Date.now() }
  }
  try {
    const { latencyMs, res } = await probe('/api/public/posbot?path=balance', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => null)
    if (res.ok && json?.success && typeof json.saldo_generate === 'number') {
      const label = `Rp ${Number(json.saldo_generate).toLocaleString('id-ID')}`
      return { provider: 'posbot', status: 'online', latencyMs, detail: `Saldo: ${label}`, creditsLabel: label, checkedAt: Date.now() }
    }
    if (res.status === 401 || res.status === 403) {
      return { provider: 'posbot', status: 'down', latencyMs, detail: 'API key tidak valid', checkedAt: Date.now() }
    }
    return { provider: 'posbot', status: 'down', latencyMs, detail: json?.error || `HTTP ${res.status}`, checkedAt: Date.now() }
  } catch (err: any) {
    return { provider: 'posbot', status: 'down', detail: err?.message || 'Tidak terhubung', checkedAt: Date.now() }
  }
}

const CHECKERS: Record<string, () => Promise<ProviderHealth>> = {
  runninghub: checkRunningHub,
  roboneo: checkRoboneo,
  galleri5: checkGalleri5,
  weavy: checkWeavy,
  leonardo: checkLeonardo,
  magnific: checkMagnific,
  framia: checkFramia,
  oneover: checkOneOver,
  nexabot: checkNexabot,
  omni: checkOmni,
  seavi: checkSeavi,
  posbot: checkPosbot,
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
