// ─── API halaman Antrean ───────────────────────────────────────────────────
//
// Pola fetch mengikuti src/lib/jobTracking.ts: token dari authStore
// (fallback localStorage), dan sekali refresh diam-diam kalau dijawab 401
// (access token app cuma hidup 15 menit).
import { useAuthStore } from '@/stores/authStore'
import { resumePendingGenerationJobs } from './jobTracking'
import { saveNexabotResult } from './nexabot'

export type JobStatus = 'pending' | 'processing' | 'done' | 'failed'

export interface GenerationJob {
  id: number
  provider: 'nexabot' | 'posbot'
  job_id: string
  page: string
  model: string
  prompt: string
  status: JobStatus
  result_url: string
  last_error: string
  credential_source: string
  server_poll: number
  poll_misses: number
  notified_at: number | null
  created_at: number
  updated_at: number
}

const BASE = '/api/generation-jobs'

function tokenSekarang(): string | null {
  return useAuthStore.getState().token || localStorage.getItem('arkxmotion_token')
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const kirim = (token: string | null) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    })
  const store = useAuthStore.getState()
  let res = await kirim(tokenSekarang())
  if (res.status === 401 && (await store.refresh())) res = await kirim(tokenSekarang())
  return res
}

/** Daftar lengkap job milik user (bukan hanya yang bisa di-resume). */
export async function fetchQueueJobs(opts: {
  status?: JobStatus | 'semua'
  limit?: number
  offset?: number
} = {}): Promise<{ jobs: GenerationJob[]; total: number }> {
  const params = new URLSearchParams()
  if (opts.status && opts.status !== 'semua') params.set('status', opts.status)
  if (opts.limit) params.set('limit', String(opts.limit))
  if (opts.offset) params.set('offset', String(opts.offset))
  const query = params.toString()
  const res = await apiFetch(`/all${query ? `?${query}` : ''}`)
  if (!res.ok) throw new Error(`Gagal memuat antrean (HTTP ${res.status})`)
  const data = await res.json().catch(() => null)
  return { jobs: Array.isArray(data?.jobs) ? data.jobs : [], total: Number(data?.total) || 0 }
}

/**
 * Batalkan job yang masih menunggu/diproses. Ini hanya menghentikan
 * PELACAKAN di Studio — job di provider tetap berjalan sampai selesai
 * atau kedaluwarsa di sana; hasil yang telanjur jadi tidak bisa diambil
 * lagi dari antrean setelah dibatalkan.
 */
export async function cancelGenerationJob(provider: string, jobId: string): Promise<void> {
  const res = await apiFetch(`/${provider}/${jobId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'failed', error: 'Dibatalkan oleh user' }),
  })
  if (!res.ok) throw new Error(`Gagal membatalkan job (HTTP ${res.status})`)
}

/** Hapus baris job dari antrean (hanya milik sendiri; tidak menyentuh provider). */
export async function deleteGenerationJob(provider: string, jobId: string): Promise<void> {
  const res = await apiFetch(`/${provider}/${jobId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Gagal menghapus job (HTTP ${res.status})`)
}

/**
 * Simpan hasil NexaBot yang sudah selesai ke penyimpanan server
 * (alur yang sama dengan resume). Mengembalikan URL permanen, atau pesan
 * error. Berhasil = job otomatis ditandai selesai + result_url terisi
 * oleh saveNexabotResult sendiri.
 */
export async function saveNexabotJobResult(
  jobId: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  return saveNexabotResult(jobId, { master: true }, `antrean-${jobId}.mp4`)
}

/**
 * Lanjutkan SEMUA job yang bisa di-resume sekarang (alur yang sama dengan
 * pemulihan otomatis tiap 30 detik di main.tsx). Dipakai tombol
 * "Lanjutkan sekarang" — hasilnya masuk ke panel generasi & galeri.
 */
export async function resumeAllJobs(): Promise<void> {
  await resumePendingGenerationJobs()
}
