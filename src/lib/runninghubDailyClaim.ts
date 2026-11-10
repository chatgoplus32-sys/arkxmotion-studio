// ─── Klaim hadiah harian RunningHub via cron server ────────────────────────
// Token JWT RunningHub hanya tersimpan di browser. Saat pengguna menyalakan
// klaim otomatis, token dikirim sekali ke server agar scheduler harian bisa
// mengklaim tanpa app terbuka. Server tidak pernah mengirim token kembali —
// status berisi id akun (dipotong), hasil klaim, dan waktu percobaan.
import { useAuthStore } from '../stores/authStore'

export type RhAutoClaimTokenState = 'pending' | 'claimed' | 'already' | 'rejected' | 'error'

export interface RhAutoClaimTokenStatus {
  id: number
  account: string
  status: RhAutoClaimTokenState
  message: string
  claimedToday: boolean
  attemptsToday: number
  lastAttemptAt: number | null
  lastSuccessDay: string | null
}

export interface RhAutoClaimStatus {
  ok?: boolean
  enabled: boolean
  day: string
  timezone: string
  running: boolean
  tokens: RhAutoClaimTokenStatus[]
  summary: {
    total: number
    claimedToday: number
    rejected: number
    failedToday: number
    lastAttemptAt: number | null
  }
}

async function authFetch(path: string, init: RequestInit): Promise<Response> {
  const send = (token: string | null) => fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  })

  const store = useAuthStore.getState()
  let res = await send(store.token || localStorage.getItem('arkxmotion_token'))
  if (res.status === 401) {
    // Access token app hanya 15 menit — coba refresh sekali sebelum menyerah.
    const ok = await store.refresh()
    if (ok) {
      res = await send(useAuthStore.getState().token || localStorage.getItem('arkxmotion_token'))
    }
  }
  return res
}

async function readJson(res: Response): Promise<any> {
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || `Klaim otomatis gagal (HTTP ${res.status})`)
  }
  return data
}

export async function fetchRunningHubAutoClaim(): Promise<RhAutoClaimStatus> {
  const res = await authFetch('/api/runninghub/daily-claim', { method: 'GET' })
  return readJson(res) as Promise<RhAutoClaimStatus>
}

/**
 * enabled=false → server menghapus semua token pengguna.
 * enabled=true → daftar di server diganti dengan `tokens` (JWT saja).
 */
export async function saveRunningHubAutoClaim(tokens: string[], enabled: boolean): Promise<RhAutoClaimStatus> {
  const res = await authFetch('/api/runninghub/daily-claim', {
    method: 'PUT',
    body: JSON.stringify({ enabled, tokens: enabled ? tokens : [] }),
  })
  return readJson(res) as Promise<RhAutoClaimStatus>
}

/** Mulai klaim manual di server (background). Pantau lewat fetchRunningHubAutoClaim. */
export async function runRunningHubAutoClaimNow(): Promise<RhAutoClaimStatus> {
  const res = await authFetch('/api/runninghub/daily-claim/run', { method: 'POST', body: '{}' })
  return readJson(res) as Promise<RhAutoClaimStatus>
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
