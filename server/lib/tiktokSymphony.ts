/**
 * TikTok Symphony (Seedance) API v2.0 — konektor server.
 *
 * Kredensial (Access-Token + tto_id / TikTok One account ID) disimpan
 * server-level di app_settings: admin mengisinya di System Settings, dengan
 * fallback env TIKTOK_SYMPHONY_ACCESS_TOKEN / TIKTOK_SYMPHONY_TTO_ID.
 * Kredensial TIDAK pernah dikirim ke browser.
 *
 * Alur: POST /symphony/video/task/create/ → task_id → GET /symphony/task/get/
 * untuk status & URL hasil. payment_method = PAID_TOKENS (tagihan upstream
 * dibayar akun BytePlus operator, bukan member). Member membayar kita lewat
 * wallet tiktok_balance (lihat server/routes/tiktokSymphony.ts).
 */
import db from '../db.js'

const BASE = 'https://business-api.tiktok.com/open_api/v2.0'

export const TIKTOK_SETTING_KEYS = {
  accessToken: 'tiktok_symphony_access_token', // kredensial-ok: nama kunci app_settings, bukan nilai rahasia
  ttoId: 'tiktok_symphony_tto_id', // kredensial-ok: nama kunci app_settings, bukan nilai rahasia
} as const

function stored(key: string): string {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
    return (row?.value || '').trim()
  } catch {
    return ''
  }
}

export function getTiktokCredentials(): { accessToken: string; ttoId: string } {
  return {
    accessToken: stored(TIKTOK_SETTING_KEYS.accessToken) || (process.env.TIKTOK_SYMPHONY_ACCESS_TOKEN || '').trim(),
    ttoId: stored(TIKTOK_SETTING_KEYS.ttoId) || (process.env.TIKTOK_SYMPHONY_TTO_ID || '').trim(),
  }
}

export function tiktokCredentialsStatus(): { configured: boolean; source: 'database' | 'env' | 'none'; ttoConfigured: boolean } {
  const dbToken = stored(TIKTOK_SETTING_KEYS.accessToken)
  const dbTto = stored(TIKTOK_SETTING_KEYS.ttoId)
  const envToken = (process.env.TIKTOK_SYMPHONY_ACCESS_TOKEN || '').trim()
  const envTto = (process.env.TIKTOK_SYMPHONY_TTO_ID || '').trim()
  const token = dbToken || envToken
  return {
    configured: !!token && !!(dbTto || envTto),
    source: dbToken ? 'database' : envToken ? 'env' : 'none',
    ttoConfigured: !!(dbTto || envTto),
  }
}

/** Simpan kredensial dari admin (dipanggil route admin). */
export function saveTiktokCredentials(accessToken: string, ttoId: string): void {
  const upsert = db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  )
  db.transaction(() => {
    if (accessToken.trim()) upsert.run(TIKTOK_SETTING_KEYS.accessToken, accessToken.trim())
    if (ttoId.trim()) upsert.run(TIKTOK_SETTING_KEYS.ttoId, ttoId.trim())
  })()
}

export function deleteTiktokCredentials(): void {
  db.prepare('DELETE FROM app_settings WHERE key IN (?, ?)').run(
    TIKTOK_SETTING_KEYS.accessToken,
    TIKTOK_SETTING_KEYS.ttoId,
  )
}

export class TiktokApiError extends Error {
  constructor(
    message: string,
    public code?: number,
    public subcode?: string,
    public requestId?: string,
  ) {
    super(message)
    this.name = 'TiktokApiError'
  }
}

async function request<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const { accessToken } = getTiktokCredentials()
  if (!accessToken) throw new TiktokApiError('Kredensial TikTok Symphony belum diatur admin')
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Access-Token': accessToken,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) } catch { throw new TiktokApiError(`Respons bukan JSON (HTTP ${res.status})`) }
  if (json?.code !== 0) {
    throw new TiktokApiError(
      json?.message || `Gagal memanggil TikTok Symphony (HTTP ${res.status})`,
      json?.code,
      json?.subcode,
      json?.request_id,
    )
  }
  return json as T
}

export interface CreateTaskInput {
  prompt: string
  model?: string
  imageUrl?: string | null
  endFrameUrl?: string | null
  referenceImageUrls?: string[]
  duration?: number
  ratio?: string
  resolution?: string
  generateAudio?: boolean
  callbackUrl?: string
}

/** Buat task generate video. Mengembalikan task_id. */
export async function createTiktokTask(input: CreateTaskInput): Promise<string> {
  const { ttoId } = getTiktokCredentials()
  if (!ttoId) throw new TiktokApiError('TikTok One (tto_id) belum diatur admin')

  const content: any[] = [{ type: 'TEXT', text: input.prompt }]
  const model = input.model || 'SEEDANCE_2_0_FAST'
  const addRef = (url: string, role: string) => {
    if (model === 'SEEDANCE_2_5') content.push({ type: 'IMAGE', image: { url }, role })
    else content.push({ type: 'IMAGE', image: { url }, role })
  }
  if (input.imageUrl) addRef(input.imageUrl, 'FIRST_FRAME')
  if (input.endFrameUrl) addRef(input.endFrameUrl, 'LAST_FRAME')
  for (const url of input.referenceImageUrls || []) addRef(url, 'REFERENCE_IMAGE')

  const body: any = {
    tto_id: ttoId,
    payment_method: 'PAID_TOKENS',
    model,
    content,
    duration: input.duration && input.duration > 0 ? input.duration : 5,
  }
  // resolution/ratio/generate_audio hanya valid untuk PAID_TOKENS.
  if (input.resolution) body.resolution = input.resolution
  if (input.ratio) body.ratio = input.ratio
  if (typeof input.generateAudio === 'boolean') body.generate_audio = input.generateAudio
  if (input.callbackUrl) body.callback_url = input.callbackUrl

  const res = await request<{ data?: { tasks?: Array<{ task_id: string }> } }>(
    '/symphony/video/task/create/',
    { method: 'POST', body: JSON.stringify(body) },
  )
  const taskId = res?.data?.tasks?.[0]?.task_id
  if (!taskId) throw new TiktokApiError('TikTok Symphony tidak mengembalikan task_id')
  return taskId
}

export interface TiktokTaskStatus {
  status: 'QUEUED' | 'RUNNING' | 'CANCELLED' | 'EXPIRED' | 'FAILED' | 'SUCCEEDED' | string
  videoUrl?: string
  error?: string
  raw?: any
}

/** Cek satu task. URL hasil berlaku 24 jam. */
export async function getTiktokTask(taskId: string): Promise<TiktokTaskStatus> {
  const { ttoId } = getTiktokCredentials()
  if (!ttoId) throw new TiktokApiError('TikTok One (tto_id) belum diatur admin')
  const qs = new URLSearchParams({
    tto_id: ttoId,
    'filtering[task_ids][]': taskId,
    page: '1',
    page_size: '1',
  })
  const res = await request<{ data?: { list?: any[] } }>(`/symphony/task/get/?${qs.toString()}`, { method: 'GET' })
  const row = res?.data?.list?.[0]
  if (!row) return { status: 'QUEUED' }
  const status = String(row.task_status || 'QUEUED')
  return {
    status,
    videoUrl: status === 'SUCCEEDED' ? row.video?.video || undefined : undefined,
    error: row.error?.message || (status === 'FAILED' || status === 'EXPIRED' ? 'Task gagal/expired di TikTok Symphony' : undefined),
    raw: row,
  }
}

/** Sisa kredit/token TikTok (untuk panel status admin). */
export async function getTiktokCredits(): Promise<any> {
  const { ttoId } = getTiktokCredentials()
  if (!ttoId) throw new TiktokApiError('TikTok One (tto_id) belum diatur admin')
  return request(`/symphony/credit/get/?${new URLSearchParams({ tto_id: ttoId }).toString()}`, { method: 'GET' })
}
