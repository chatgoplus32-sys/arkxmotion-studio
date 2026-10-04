// Alriz Motion API client — alrizmotion.my.id via relay /api/public/alriz.
// Kontrak terverifikasi dari docs resmi + probe nyata (/models tanpa auth,
// /account dengan X-API-Key): POST /jobs → 202 {job_id, status}, poll
// GET /jobs/{id} → {status, result_url,...}, hasil via result_url (/result).
//
// Klien memanggil relay dengan `Authorization: Bearer <key>` (konvensi sama
// seperti relay Seavi); relay meneruskannya sebagai `X-API-Key` ke upstream.
const ALRIZ_PROXY = '/api/public/alriz'

export interface AlrizModelSpec {
  id: string
  name: string
  resolution: '720p' | '1080p'
  /** Harga per video (Rp) — dipotong dari saldo key upstream. */
  price: number
  maxDuration: number
  active: boolean
}

export const ALRIZ_MODELS: AlrizModelSpec[] = [
  { id: 'mc-kling-2.6-std', name: 'Motion Control 2.6', resolution: '720p', price: 750, maxDuration: 30, active: true },
  { id: 'mc-kling-2.6-pro', name: 'Motion Control 2.6 Pro', resolution: '1080p', price: 1500, maxDuration: 30, active: true },
  { id: 'mc-kling-3.0-std', name: 'Motion Control 3.0', resolution: '720p', price: 1000, maxDuration: 30, active: true },
  { id: 'mc-kling-3.0-pro', name: 'Motion Control 3.0 Pro', resolution: '1080p', price: 1750, maxDuration: 30, active: true },
]

export function getAlrizModel(id: string): AlrizModelSpec | undefined {
  return ALRIZ_MODELS.find((m) => m.id === id)
}

/** Harga satu video (Rp) untuk model id; model tak dikenal → termurah. */
export function getAlrizPrice(modelId?: string): number {
  return getAlrizModel(modelId || '')?.price ?? 750
}

export interface AlrizAccount {
  email: string
  balance: number
  limit: number
  running: number
  available: number
}

/** Cek akun pemanggil: email, saldo Rp, dan slot konkurensi. */
export async function fetchAlrizAccount(apiKey: string): Promise<{ ok: boolean; account?: AlrizAccount; error?: string }> {
  try {
    const res = await fetch(`${ALRIZ_PROXY}?path=account`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const data = await res.json().catch(() => null)
    if (res.status === 401 || res.status === 403) {
      const msg = data?.error?.message || data?.message || `HTTP ${res.status}`
      return { ok: false, error: `Kunci tidak valid: ${msg}` }
    }
    if (!res.ok || !data) {
      return { ok: false, error: data?.error?.message || data?.message || `HTTP ${res.status}` }
    }
    return {
      ok: true,
      account: {
        email: data.email || '',
        balance: typeof data.balance === 'number' ? data.balance : 0,
        limit: data.concurrent?.limit ?? 0,
        running: data.concurrent?.running ?? 0,
        available: data.concurrent?.available ?? 0,
      },
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Gagal cek akun Alriz' }
  }
}

/** Terjemahkan kode error upstream ke Bahasa Indonesia. */
export function alrizErrorMessage(code: string | undefined | null, fallback: string): string {
  switch (code) {
    case 'AUTH_001': return 'Kunci API Alriz tidak valid — periksa kembali key alz-... di halaman Providers.'
    case 'AUTH_002': return 'Kunci API Alriz dicabut / akun ditangguhkan.'
    case 'REQ_001': return 'Permintaan tidak lengkap atau saldo Alriz tidak cukup.'
    case 'REQ_005': return 'Kolom permintaan tidak valid (model tidak dikenal / nilai di luar batas).'
    case 'REQ_006': return 'Berkas ditolak (gambar ≤ 10 MB, video ≤ 50 MB, durasi ≤ 30 detik).'
    case 'JOB_001': return 'Job Alriz tidak ditemukan / bukan milik key ini.'
    case 'JOB_002': return 'Job Alriz belum selesai.'
    case 'STK_001': return 'Kapasitas Alriz habis untuk model ini — saldo dikembalikan penuh, coba lagi nanti.'
    case 'GEN_001': return 'Media tidak dapat diproses Alriz (subjek tak terbaca) — saldo dikembalikan penuh. Coba media yang subjeknya jelas.'
    case 'GEN_002': return 'Berkas masukan ditolak Alriz — saldo dikembalikan penuh.'
    case 'SYS_001': return 'Terlalu banyak job Alriz bersamaan — tunggu lalu coba lagi.'
    case 'SYS_002': return 'Kesalahan internal Alriz — coba lagi.'
    case 'SYS_003': return 'Alriz gagal menghubungi layanan unggah — coba lagi.'
    default: return fallback
  }
}

function throwAlriz(status: number, data: any, fallback: string): never {
  const code = data?.error?.code
  const msg = data?.error?.message || (typeof data === 'string' ? data.slice(0, 200) : '') || `HTTP ${status}`
  throw new Error(alrizErrorMessage(code, `${fallback}: ${code ? `${code} — ` : ''}${msg}`))
}

export interface AlrizSubmitParams {
  model: string
  imageUrl?: string
  videoUrl?: string
  prompt?: string
}

/** POST /jobs → job_id (202). Minimal salah satu image_url / video_url. */
export async function submitAlrizJob(apiKey: string, params: AlrizSubmitParams): Promise<string> {
  const body: Record<string, unknown> = { model: params.model }
  if (params.imageUrl) body.image_url = params.imageUrl
  if (params.videoUrl) body.video_url = params.videoUrl
  if (params.prompt) body.prompt = params.prompt
  const res = await fetch(`${ALRIZ_PROXY}?path=jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data) throwAlriz(res.status, data, 'Alriz submit gagal')
  const id = data.job_id || data.jobId || data.id
  if (!id) throw new Error(`Alriz: respons tanpa job_id — ${JSON.stringify(data).slice(0, 200)}`)
  return String(id)
}

export interface AlrizJobStatus {
  status: string
  progress: number
  resultUrl: string | null
  cost: number | null
  errorCode: string | null
  errorMessage: string | null
}

/** GET /jobs/{id} → status + metadata (result_url terisi setelah DONE). */
export async function fetchAlrizJob(apiKey: string, jobId: string): Promise<AlrizJobStatus> {
  const res = await fetch(`${ALRIZ_PROXY}?path=jobs/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data) throwAlriz(res.status, data, 'Alriz cek status gagal')
  return {
    status: String(data.status || '').toUpperCase(),
    progress: typeof data.progress === 'number' ? data.progress : 0,
    resultUrl: data.result_url || null,
    cost: typeof data.cost === 'number' ? data.cost : null,
    errorCode: data.error_code || data.error?.code || null,
    errorMessage: data.error?.message || data.error || null,
  }
}

export interface AlrizLogOpts {
  onLog?: (msg: string, level?: string) => void
  onStatus?: (text: string, pct: number) => void
}

// Status terminal versi Alriz: DONE sukses; NO_STOCK & FAILED gagal.
const ALRIZ_RUNNING = new Set(['QUEUED', 'CLAIMING', 'UPLOADING', 'PROCESSING', 'SAVING'])

/** Poll GET /jobs/{id} sampai DONE. NO_STOCK / FAILED → throw (saldo direfund upstream). */
export async function pollAlrizJob(apiKey: string, jobId: string, opts: AlrizLogOpts = {}): Promise<string> {
  const { onLog, onStatus } = opts
  const maxPolls = 150 // 5 dtk × 150 = 12,5 menit (docs: poll tiap 5 detik)
  for (let i = 0; i < maxPolls; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 5000))
    let job: AlrizJobStatus
    try {
      job = await fetchAlrizJob(apiKey, jobId)
    } catch (e: any) {
      onLog?.(`Poll #${i + 1}: ${e.message} (dicoba ulang...)`, 'warn')
      continue
    }
    if (job.status === 'DONE') {
      // result_url kadang baru terisi via /result — ambil eksplisit bila kosong.
      if (job.resultUrl) return job.resultUrl
      const viaResult = await fetchAlrizResult(apiKey, jobId)
      if (viaResult) return viaResult
      throw new Error('Alriz: job DONE tanpa URL hasil')
    }
    if (job.status === 'NO_STOCK' || job.status === 'FAILED') {
      const msg = job.errorMessage || ''
      throw new Error(alrizErrorMessage(job.errorCode, `Alriz job ${job.status === 'NO_STOCK' ? 'kehabisan kapasitas' : 'gagal'}${msg ? ` — ${msg}` : ''} (saldo direfund upstream)`))
    }
    if (ALRIZ_RUNNING.has(job.status)) {
      const pct = Math.max(6, Math.min(97, job.progress || 5))
      onStatus?.(`Memproses... ${job.status}`, pct)
      if (i % 6 === 5) onLog?.(`⏳ Alriz ${job.status}`, 'debug')
    } else if (job.status) {
      onLog?.(`Poll #${i + 1}: status=${job.status}`, 'debug')
    }
  }
  throw new Error('Alriz: timeout menunggu hasil (>12 menit)')
}

/** GET /jobs/{id}/result → tautan video ( confirmed setelah DONE). */
export async function fetchAlrizResult(apiKey: string, jobId: string): Promise<string | null> {
  const res = await fetch(`${ALRIZ_PROXY}?path=jobs/${encodeURIComponent(jobId)}/result`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data) return null
  return data.result_url || null
}

export interface AlrizGenerateOptions extends AlrizLogOpts {
  apiKey: string
  model: string
  imageUrl?: string
  videoUrl?: string
  prompt?: string
}

/** End-to-end: submit → poll → URL video hasil. */
export async function generateWithAlriz(opts: AlrizGenerateOptions): Promise<string> {
  const { apiKey, model, onLog, onStatus } = opts
  const price = getAlrizPrice(model)
  onLog?.(`[2/3] 🚀 Submit ${model} (Rp${price.toLocaleString('id-ID')})...`, 'info')
  onStatus?.(`Submit ${model}...`, 5)
  const id = await submitAlrizJob(apiKey, {
    model,
    imageUrl: opts.imageUrl,
    videoUrl: opts.videoUrl,
    prompt: opts.prompt,
  })
  onLog?.(`[2/3] ✅ Job dibuat ✓ id=${id}`, 'success')
  onLog?.(`[3/3] ⏳ Polling hasil...`, 'info')
  const url = await pollAlrizJob(apiKey, id, { onLog, onStatus })
  onLog?.(`✅ Video selesai ✓`, 'success')
  onStatus?.('Done!', 100)
  return url
}
