// ─── Klien wallet RunningHub ────────────────────────────────────────────────
// Saldo RUPIAH per user, harga per model (action) — default Rp 2.500/generate,
// diedit admin lewat Harga Token & Wallet. Member top up → relay memasang token
// master dari pool operator dengan tiket pembayaran dari /deduct. Tanpa top up,
// member tetap bisa memakai access token/API key RunningHub miliknya sendiri
// (passthrough).
//
// Dipakai halaman /topup/runninghub dan alur generate (lewat runninghubProxy).
const API = '/api/runninghub-wallet'

export interface RunninghubWallet {
  balance: number
  min_topup: number
  max_topup: number
  presets: number[]
  /** Harga per generate untuk model paling umum/default (Rp) — ditampilkan di halaman top up. */
  charge?: number
  server_key?: { available: boolean; reason?: string }
}

export const RUNNINGHUB_PRESET_FALLBACKS: number[] = [25000, 50000, 100000, 250000, 500000, 1000000]

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

export async function fetchRunninghubWallet(token: string): Promise<RunninghubWallet | null> {
  try {
    const res = await fetch(`${API}/balance`, { headers: authHeaders(token) })
    if (!res.ok) return null
    const data = await res.json()
    const presets: number[] = Array.isArray(data.presets) && data.presets.length > 0
      ? data.presets
      : RUNNINGHUB_PRESET_FALLBACKS
    return {
      balance: Number(data.balance) || 0,
      min_topup: data.min_topup ?? 10000,
      max_topup: data.max_topup ?? 5000000,
      presets,
      charge: typeof data.charge === 'number' ? data.charge : undefined,
      server_key: data.server_key && typeof data.server_key === 'object'
        ? { available: !!data.server_key.available, reason: data.server_key.reason }
        : undefined,
    }
  } catch {
    return null
  }
}

export interface RunninghubCharge {
  balance: number
  deducted: number
  batchId: string
  usageId?: number
}

export async function chargeRunninghubWallet(
  token: string,
  model?: string,
  quantity = 1,
  batchId?: string,
): Promise<RunninghubCharge> {
  const batch = batchId || `runninghub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const res = await fetch(`${API}/deduct`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ model: model || '', quantity, batch_id: batch }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Gagal memotong saldo RunningHub')
  return {
    balance: Number(data.balance) || 0,
    deducted: data.deducted ?? 0,
    batchId: batch,
    usageId: typeof data.usage_id === 'number' && data.usage_id > 0 ? data.usage_id : undefined,
  }
}

export async function refundRunninghubWallet(
  token: string,
  opts: { batch_id?: string; model?: string; usage_id?: number },
): Promise<number | null> {
  try {
    const body = opts.usage_id
      ? { usage_id: opts.usage_id }
      : opts.batch_id
        ? { batch_id: opts.batch_id }
        : { model: opts.model || '' }
    const res = await fetch(`${API}/refund`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.balance === 'number' ? data.balance : null
  } catch {
    return null
  }
}

/**
 * Boleh tidaknya alur generate memakai jalur token server RunningHub: hanya
 * kalau relay bilang layak (sudah top up / admin) dan member tidak membawa
 * access token/API key sendiri.
 */
export function runninghubPreferServerKey(wallet: RunninghubWallet | null | undefined, hasOwnKey: boolean): boolean {
  if (hasOwnKey) return false
  return !!wallet?.server_key?.available
}