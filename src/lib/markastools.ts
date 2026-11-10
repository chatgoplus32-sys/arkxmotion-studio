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

/**
 * Normalisasi input cookie session (mentah / header / cURL / JSON).
 *
 * PENTING: nilai header Cookie boleh BERSPASI ("a=1; b=2") — regex lama yang
 * berhenti di whitespace memotong cookie jadi tidak lengkap dan MarkasTools
 * membalas 401 (session tidak dikenal).
 */
export function parseMarkastoolsCookieInput(raw: string): string {
  let s = (raw || '').trim()
  if (!s) return ''

  // Buang sisa header lain yang menempel di baris yang sama
  // (mis. "a=1; b=2 Referer: https://…").
  const cut = (v: string) => v.trim().replace(/^['"]+|['"]+$/g, '').split(/\s{2,}(?=[A-Za-z-]+:)/)[0].trim()

  // Header "Cookie: a=1; b=2" — nilai diambil sampai akhir baris.
  const headerMatch = s.match(/(?:^|[\s'"-])(?:cookie|Cookie):\s*(.+)$/m)
  if (headerMatch?.[1]?.trim()) return cut(headerMatch[1])

  // JSON (Copy as fetch / Node).
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const obj = JSON.parse(s)
      const c = obj?.cookie || obj?.Cookie || obj?.headers?.cookie || obj?.headers?.Cookie
      if (typeof c === 'string' && c.trim()) return cut(c)
    } catch { /* bukan JSON valid — lanjut sebagai string biasa */ }
  }

  // cURL: -H 'cookie: a=1; b=2'
  const looseMatch = s.match(/cookie\s*:\s*(.+)$/im)
  if (looseMatch?.[1]?.trim()) return cut(looseMatch[1])

  // Tabel cookie DevTools: "nama nilai" (tanpa "=") → ubah jadi nama=nilai.
  if (!s.includes('=') && /\s/.test(s)) {
    const [name, ...rest] = s.split(/\s+/)
    if (name && rest.length) return `${name}=${rest.join(' ')}`.trim()
  }

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
 * Bulk tambah akun Markasflow: POST /api/runninghub/accounts/bulk
 * { text } → { added, total, pending, results: [{ ok, error }] }.
 * Dipakai untuk mendaftarkan banyak token MF- sekaligus (satu klik untuk
 * seluruh daftar token).
 */
export async function addMarkastoolsAccountsBulk(
  text: string,
  cookies: string,
): Promise<{ ok: boolean; added?: number; total?: number; pending?: number; errors?: string[]; error?: string }> {
  const raw = (text || '').trim()
  if (!raw) return { ok: false, error: 'Daftar token MF- kosong.' }
  try {
    const data = await request(
      '/api/runninghub/accounts/bulk',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: raw }),
      },
      cookies,
    )
    const results = Array.isArray(data?.results) ? data.results : []
    const errors = results
      .filter((r: any) => !r?.ok)
      .map((r: any) => {
        const key = String(r?.key || r?.api_key || '')
        const masked = key ? `${key.slice(0, 6)}…${key.slice(-4)}` : 'token'
        return `${masked}: ${r?.error || 'gagal'}`
      })
    return {
      ok: true,
      added: Number(data?.added ?? 0),
      total: Number(data?.total ?? 0),
      pending: Number(data?.pending ?? 0),
      errors,
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Gagal menambahkan akun' }
  }
}

export interface MarkastoolsAccount {
  id?: string | number
  name?: string
  label?: string
  provider?: string
  status?: string
  active?: boolean
  balance?: number | string | null
  [key: string]: unknown
}

/** Daftar akun provider yang tersimpan di MarkasTools: GET /api/accounts. */
export async function listMarkastoolsAccounts(
  cookies: string,
): Promise<{ ok: boolean; accounts: MarkastoolsAccount[]; error?: string }> {
  try {
    const data = await request('/api/accounts', { method: 'GET' }, cookies)
    return { ok: true, accounts: Array.isArray(data?.accounts) ? data.accounts : [] }
  } catch (err: any) {
    return { ok: false, accounts: [], error: err?.message || 'Gagal memuat daftar akun' }
  }
}

/**
 * Cek session MarkasTools lewat GET /api/me. 401/403 = sesi mati.
 */
export async function checkMarkastoolsSession(cookies: string): Promise<MarkastoolsSessionInfo> {
  const cookieHeader = parseMarkastoolsCookieInput(cookies)
  if (!cookieHeader) return { ok: false, user: null, error: 'Cookie session kosong / format tidak dikenali.' }
  if (!cookieHeader.includes('=')) {
    return {
      ok: false,
      user: null,
      error: 'Cookie yang ditempel tidak berbentuk "nama=nilainya". Salin utuh header Cookie dari DevTools.',
    }
  }
  try {
    const res = await fetch(`${MARKASTOOLS_BASE}/api/me`, {
      method: 'GET',
      headers: authHeaders(cookieHeader),
    })
    if (res.status === 401 || res.status === 403) {
      // /api/me kadang lebih ketat dari endpoint lain. Coba /api/stats dulu
      // sebelum menyatakan sesi mati.
      try {
        const alt = await fetch(`${MARKASTOOLS_BASE}/api/stats`, {
          method: 'GET',
          headers: authHeaders(cookieHeader),
        })
        if (alt.ok) {
          const altData = await alt.json().catch(() => null)
          if (altData?.ok) return { ok: true, user: altData.user ?? null }
        }
      } catch { /* lanjut ke pesan utama */ }
      const body = await res.json().catch(() => null)
      const code = String(body?.code || '')
      // Kode yang dipakai MarkasTools sendiri untuk differentiate jenis gagal.
      if (code === 'ACCOUNT_INACTIVE') {
        return {
          ok: false,
          user: null,
          error: 'Akun MarkasTools belum aktif (ACCOUNT_INACTIVE) — langganan belum aktif atau akun dinonaktifkan admin. Token MF- tidak bisa dipakai sebelum akun aktif.',
        }
      }
      if (code === 'SESSION_EXPIRED') {
        return {
          ok: false,
          user: null,
          error: 'Sesi MarkasTools sudah berakhir (SESSION_EXPIRED) — login ulang di ai.markastools.id lalu paste cookie baru.',
        }
      }
      return {
        ok: false,
        user: null,
        error: `Cookie sesi ditolak${code ? ` (${code})` : ''}. Salin ULANG seluruh header Cookie dari ai.markastools.id (semua pasangan nama=nilainya, termasuk yang ada spasi) lalu Simpan Sesi.`,
      }
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
 * Unggah media ke pool order MarkasTools.
 *
 * Alur resmi dashboard: POST /api/order/upload-ticket → kalau mode "server",
 * unggah lewat POST /api/order/upload (FormData "file"). Kalau mode client,
 * unggah langsung ke upload_url dengan Bearer access_token + header
 * x-app-recipeid. Jalur cadangan: langsung POST /api/order/upload.
 */
export async function uploadMarkasMedia(file: File, cookies: string, type: 'image' | 'video' | 'audio' = 'image'): Promise<string> {
  const uploadViaServer = async (): Promise<string> => {
    const fd = new FormData()
    fd.append('file', file, file.name || 'media')
    const data = await request('/api/order/upload', { method: 'POST', body: fd }, cookies)
    if (!data?.url) throw new Error('Upload media gagal (tidak ada URL)')
    return String(data.url)
  }

  try {
    const ticket = await request('/api/order/upload-ticket', { method: 'POST' }, cookies)
    if (ticket?.mode === 'server') return await uploadViaServer()
    if (ticket?.upload_url && ticket?.access_token) {
      const fd = new FormData()
      fd.append('file', file, file.name || 'media')
      fd.append('type', type)
      const headers: Record<string, string> = { Authorization: `Bearer ${ticket.access_token}` }
      if (ticket.recipe_id) headers['x-app-recipeid'] = String(ticket.recipe_id)
      const res = await fetch(String(ticket.upload_url), { method: 'POST', headers, body: fd })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        if (data?.url) return String(data.url)
      }
    }
  } catch {
    // tiket gagal → jatuh ke jalur unggah server
  }
  return uploadViaServer()
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
 * Model Motion Control yang tersedia di MarkasTools (label resmi dari
 * /api/public/home). Token MF- yang terdaftar di MarkasTools (akun
 * "Markasflow") dipakai service ini — rotasi antar akun dilakukan
 * MarkasTools sendiri.
 */
export const MARKAS_MOTION_MODELS = [
  { key: 'mt:markasflow-motion-v25', label: 'MarkasFlow Motion V2.5 (MarkasTools)', model: 'MarkasFlow Motion V2.5', cr: 0 },
] as const

/**
 * Jalur Motion Control lewat MarkasTools: unggah gambar + video referensi →
 * submit order → poll → kembalikan URL hasil.
 */
export async function runMarkasMotionControl(
  params: {
    model: string
    imageFile?: File
    videoFile?: File
    prompt?: string
    keepSound?: boolean
    cookies: string
    onProgress?: (msg: string) => void
  },
): Promise<string> {
  if (!params.cookies) throw new Error('Belum ada cookie session MarkasTools. Simpan cookie di halaman Providers → MarkasTools.')
  return runMarkasJob(
    {
      model: params.model,
      imageFile: params.imageFile,
      videoFile: params.videoFile,
      prompt: params.prompt,
      orientation: 'video',
      keepSound: params.keepSound !== false,
    },
    params.cookies,
    { onProgress: params.onProgress },
  )
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
  const imageUrl = imageFile ? await uploadMarkasMedia(imageFile, cookies, 'image') : submit.imageUrl || ''
  const videoUrl = videoFile ? await uploadMarkasMedia(videoFile, cookies, 'video') : submit.videoUrl || ''
  const audioUrl = audioFile ? await uploadMarkasMedia(audioFile, cookies, 'audio') : submit.audioUrl || ''

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
