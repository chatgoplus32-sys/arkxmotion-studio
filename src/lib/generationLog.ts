import { useAuthStore } from '@/stores/authStore'

export interface GenerationLogData {
  page: string
  provider: string
  model: string
  prompt?: string
  credits?: number
  slot_count?: number
  status?: 'pending' | 'completed' | 'failed'
  result_url?: string
  error?: string
  duration_ms?: number
}

const API_BASE = ''

async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = useAuthStore.getState().token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> || {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return fetch(`${API_BASE}${url}`, { ...opts, headers })
}

export async function logGenerationStart(data: GenerationLogData): Promise<number | null> {
  try {
    const res = await authFetch('/api/logs/generation', {
      method: 'POST',
      body: JSON.stringify({ ...data, status: 'pending' }),
    })
    if (!res.ok) return null
    const json = await res.json()
    return json.id ?? null
  } catch {
    return null
  }
}

export async function logGenerationComplete(logId: number, data: Partial<GenerationLogData>): Promise<void> {
  try {
    await authFetch(`/api/logs/generation/${logId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  } catch {}
}

export async function logGenerationFailed(logId: number, error: string, duration_ms?: number): Promise<void> {
  try {
    await authFetch(`/api/logs/generation/${logId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'failed', error, duration_ms }),
    })
  } catch {}
}
