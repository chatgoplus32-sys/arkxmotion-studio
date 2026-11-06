// Klien MarkasTools (ai.markastools.id) untuk ARKXMotion.
//
// MarkasTools adalah dashboard SaaS bertarif langganan (Rp 60rb/bulan):
// semua endpoint API-nya memakai session cookie login — tidak ada API key
// publik. Token `MF-…` (hasil "MarkasKeyTool dari seller resmi") dipakai
// sebagai kunci akun di DALAM dashboard (menu Accounts → Tambah Akun,
// provider RunningHub yang dilabeli "Markasflow"), bukan sebagai
// kredensial HTTP. Relay /api/public/markastools meneruskan cookie
// session (header X-Markastools-Cookie), persis seperti pola
// X-Nexabot-Cookie untuk NexaBot.
//
// Hasil reverse engineering kontrak API-nya:
//   GET  /api/me                       → session check (butuh cookie)
//   POST /api/runninghub/accounts      → tambah akun {name, api_key}
//                                        (api_key wajib berformat MF-…)
//   POST /api/order/upload             → unggah media (FormData "file") → {url}
//   POST /api/order/generate           → submit order JSON
//   GET  /api/poll                     → daftar job {jobs: [{status, ...}]}
const MARKASTOOLS_BASE = '/api/public/markastools'

export interface MarkastoolsSessionInfo {
  ok: boolean
  user: any | null
  error?: string
}

export interface MarkastoolsSubmitParams {
  /** Nama model di MarkasTools, mis. "MarkasFlow Motion HD". */
  model: string
  imageUrl?: string
  imageUrls?: string[]
  videoUrl?: string
  audioUrl?: string
  prompt?: string
  orientation?: 'image' | 'video'
  rasio?: string
  keepSound?: boolean
  server?: number
}

export interface MarkastoolsSubmitResult {
  ok: boolean
  jobId?: string
  error?: string
}

/** Normalisasi input cookie session (mentah / header / cURL / JSON). */
export function parseMarkastoolsCookieInput(raw: string): string {
  let s = (raw || '').trim()
  if (!s) return ''
  const headerMatch = s.match(/(?:^|[\s'"-])(?:cookie|Cookie):\s*([^'"\r\n\s][^'"\r\n]*)/)
  if (headerMatch?.[1]?.trim()) return headerMatch[1].trim()
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const obj = JSON.parse(s)
      const c = obj?.cookie || obj?.Cookie || obj?.headers?.cookie || obj?.headers?.Cookie
      if (typeof c === 'string' && c.trim()) return c.trim()
    } catch { /* bukan JSON valid — lanjut sebagai string biasa */ }
  }
  const looseMatch = s.match(/cookie\s*:\s*['"]?\s*([^'"\r\n;\s][^'"\r\n]*)/i)
  if (looseMatch?.[1]?.trim()) return looseMatch[1].trim()
  s = s.replace(/^-+[Hh]?\s*/, '').replace(/^['"]+|['"]+$/g, '').trim()
  return s
}

export function getMarkastoolsCookies(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('arkxmotion.providers')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const keys = parsed['markastools'] || []
    const active = keys.find((k: any) => k.cookies && (k.status === 'active' || k.status === 'unknown'))
    return active?.cookies || keys.find((k: any) => k.cookies)?.cookies || null
  } catch { return null }
}

function authHeaders(cookies: string): Record<string, string> {
  return { 'X-Markastools-Cookie': cookies.replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7E]/g, '').trim() }
}

async function request(path: string, init: RequestInit, cookies: string): Promise<any> {
  const res = await fetch(`${MARKASTOOLS_BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(cookies), ...((init.headers as Record<string, string>) || {}) },
  })
  const text = await res.text()
  let data: any = null
  try { data = JSON.parse(text) } catch { /* non-JSON */ }
  if (!res.ok || !data || data.ok === false) {
    throw new Error(data?.error || `MarkasTools HTTP ${res.status}`)
  }
  return data
}

/**
 * Cek session MarkasTools lewat GET /api/me. 401/403 = sesi mati.
 */
export async function checkMarkastoolsSession(cookies: string): Promise<MarkastoolsSessionInfo> {
  const cookieHeader = parseMarkastoolsCookieInput(cookies)
  if (!cookieHeader) return { ok: false, user: null, error: 'Cookie session kosong / format tidak dikenali.' }
  try {
    const res = await fetch(`${MARKASTOOLS_BASE}/api/me`, {
      method: 'GET',
      headers: authHeaders(cookieHeader),
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, user: null, error: 'Cookie sesi ditolak/kedaluwarsa. Login ulang di ai.markastools.id lalu paste cookie baru.' }
    }
    if (!res.ok) return { ok: false, user: null, error: `Cek sesi gagal (HTTP ${res.status})` }
    const data = await res.json().catch(() => null)
    if (!data?.ok) return { ok: false, user: null, error: data?.error || 'Respons sesi tidak dikenali' }
    return { ok: true, user: data.user ?? null }
  } catch (err: any) {
    return { ok: false, user: null, error: err?.message || 'Network error' }
  }
}

/**
 * Tambah akun Markasflow ke MarkasTools: POST /api/runninghub/accounts
 * {name, api_key}. Backend memvalidasi api_key wajib berformat MF-…
 * (hasil MarkasKeyTool dari seller resmi) dan butuh langganan aktif.
 */
export async function addMarkastoolsAccount(
  name: string,
  apiKey: string,
  cookies: string,
): Promise<{ ok: boolean; account?: any; error?: string }> {
  const key = (apiKey || '').trim()
  if (!key) return { ok: false, error: 'Token MF- wajib diisi.' }
  try {
    const data = await request(
      '/api/runninghub/accounts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || 'markasflow-v2', api_key: key }),
      },
      cookies,
    )
    return { ok: true, account: data?.account }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Gagal menambahkan akun' }
  }
}

/**
 * Unggah media ke pool order MarkasTools: POST /api/order/upload
 * (FormData field "file") → {url}.
 */
export async function uploadMarkasMedia(file: File, cookies: string): Promise<string> {
  const fd = new FormData()
  fd.append('file', file, file.name || 'media')
  const data = await request('/api/order/upload', { method: 'POST', body: fd }, cookies)
  if (!data?.url) throw new Error('Upload media gagal (tidak ada URL)')
  return String(data.url)
}

/**
 * Submit generate: POST /api/order/generate (JSON, URL media hasil upload).
 */
export async function submitMarkasOrder(
  params: MarkastoolsSubmitParams,
  cookies: string,
): Promise<MarkastoolsSubmitResult> {
  if (!params.model) return { ok: false, error: 'Model wajib diisi.' }
  try {
    const data = await request(
      '/api/order/generate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: params.model,
          server: params.server ?? 0,
          image_url: params.imageUrl || '',
          image_urls: params.imageUrls || [],
          video_url: params.videoUrl || '',
          audio_url: params.audioUrl || '',
          prompt: params.prompt || '',
          orientation: params.orientation || 'video',
          rasio: params.rasio || '',
          keep_sound: params.keepSound !== false,
        }),
      },
      cookies,
    )
    return { ok: true, jobId: data?.job?.id ? String(data.job.id) : undefined }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Submit gagal' }
  }
}

/**
 * Cari semua URL hasil (http/https) di dalam payload job.
 * Bentuk payload hasil belum dipastikan (dashboard app-nya di balik
 * login), jadi gali semua kandidat URL seperti pola findNexabotResultUrls.
 */
export function findMarkasResultUrls(value: unknown): { path: string; url: string }[] {
  const out: { path: string; url: string }[] = []
  const seen = new Set<unknown>()
  const URL_KEY = /url|download|output|result|video|file|asset|media|link/i
  const walk = (node: any, path: string, depth: number) => {
    if (out.length >= 25 || depth > 6 || node == null) return
    if (typeof node === 'string') {
      if (/^https?:\/\//i.test(node) && URL_KEY.test(path)) out.push({ path, url: node })
      return
    }
    if (typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      node.slice(0, 10).forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1))
      return
    }
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, depth + 1)
  }
  walk(value, '', 0)
  return out
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)))

export interface MarkastoolsJob {
  id?: string
  status?: string
  [key: string]: unknown
}

/**
 * Poll daftar job sampai job target selesai (GET /api/poll).
 * Respons read-only, jadi aman diulang.
 */
export async function pollMarkasJob(
  jobId: string,
  cookies: string,
  opts: { maxAttempts?: number; intervalMs?: number; onProgress?: (msg: string) => void } = {},
): Promise<MarkastoolsJob> {
  const maxAttempts = opts.maxAttempts ?? 240 // ±20 menit @5s
  const intervalMs = opts.intervalMs ?? 5000
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await sleep(intervalMs)
    const data = await request('/api/poll', { method: 'GET' }, cookies)
    const jobs: MarkastoolsJob[] = Array.isArray(data?.jobs) ? data.jobs : []
    const job = jobs.find((j) => String(j.id) === String(jobId))
      || (jobs.length === 1 && attempt > 1 ? jobs[0] : jobs.find((j) => String(j.id) === String(jobId)))
    if (!job) {
      opts.onProgress?.(`Menunggu job ${jobId} muncul di antrean...`)
      continue
    }
    const status = String(job.status || '').toUpperCase()
    opts.onProgress?.(`MarkasTools job: ${status || '...'}`)
    if (status === 'COMPLETED' || status === 'SUCCESS' || status === 'DONE' || status === 'FINISHED') {
      const assets = findMarkasResultUrls(job)
      if (assets.length > 0) console.log('[markastools] Asset di payload job:', assets.map((a) => `${a.path} → ${a.url.slice(0, 120)}`))
      return job
    }
    if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELLED' || status === 'CANCELED') {
      throw new Error(`MarkasTools job gagal: ${(job as any).error || (job as any).error_message || 'Unknown error'}`)
    }
  }
  throw new Error(`MarkasTools polling timeout (job ${jobId})`)
}

/**
 * Alur penuh: unggah media → submit order → poll → kembalikan URL hasil.
 */
export async function runMarkasJob(
  params: MarkastoolsSubmitParams & { imageFile?: File; videoFile?: File; audioFile?: File },
  cookies: string,
  opts: { onProgress?: (msg: string) => void } = {},
): Promise<string> {
  const { imageFile, videoFile, audioFile, ...submit } = params
  opts.onProgress?.('Mengunggah media ke MarkasTools...')
  const imageUrl = imageFile ? await uploadMarkasMedia(imageFile, cookies) : submit.imageUrl || ''
  const videoUrl = videoFile ? await uploadMarkasMedia(videoFile, cookies) : submit.videoUrl || ''
  const audioUrl = audioFile ? await uploadMarkasMedia(audioFile, cookies) : submit.audioUrl || ''

  opts.onProgress?.(`Submit ke MarkasTools (${submit.model})...`)
  const sub = await submitMarkasOrder({ ...submit, imageUrl, videoUrl, audioUrl }, cookies)
  if (!sub.ok || !sub.jobId) throw new Error(sub.error || 'Submit MarkasTools gagal')

  return pollMarkasJob(sub.jobId, cookies, opts).then((job) => {
    const assets = findMarkasResultUrls(job)
    const url = assets.find((a) => /video|mp4/i.test(a.path))?.url || assets[0]?.url
    if (!url) throw new Error('Job selesai tapi URL hasil tidak ditemukan di payload')
    return url
  })
}
