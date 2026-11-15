// ─── Job generasi yang bertahan setelah tab ditutup ───────────────────────
//
// pollNexabotJob / pollPosbotStatus mencatat jobId ke server begitu polling
// dimulai dan menandainya selesai saat hasil didapat. Saat aplikasi dibuka
// lagi, resumePendingGenerationJobs() mengklaim job yang belum selesai, lalu
// melanjutkan polling dan memasukkan hasilnya ke panel generasi + galeri.
//
// Resume memakai kunci server lewat relay; job yang dulu memakai kunci pribadi
// member akan gagal dengan pesan jelas, bukan hilang diam-diam.
import { useAuthStore } from '@/stores/authStore'
import {
  addResult,
  addResumeFailure,
  dismissResumeFailure,
  GENERATION_PAGE_PATH,
  removeActiveTask,
  startGenerationTask,
  type GenerationPage,
} from '@/lib/backgroundTasks'
import { SERVER_KEY } from '@/lib/providerServerKey'

const TRACK_URL = '/api/generation-jobs'
/** Job yang dipoll tab ini — resume tidak boleh mengambil alih. */
const aktif = new Set<string>()

const keyOf = (provider: string, jobId: string) => `${provider}:${jobId}`

function tokenSekarang(): string | null {
  return useAuthStore.getState().token || localStorage.getItem('arkxmotion_token')
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string | null) => fetch(`${TRACK_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const store = useAuthStore.getState()
  let res = await send(tokenSekarang())
  if (res.status === 401 && await store.refresh()) res = await send(tokenSekarang())
  return res
}

/** Halaman generator yang sedang dibuka — jadi label hasil saat resume. */
function halamanSekarang(): GenerationPage | '' {
  const path = typeof window === 'undefined' ? '' : window.location.pathname
  return (Object.keys(GENERATION_PAGE_PATH) as GenerationPage[])
    .find((page) => GENERATION_PAGE_PATH[page] === path) || ''
}

/** Catat job supaya bisa dilanjutkan dari tab/perangkat lain. Best-effort. */
export async function trackGenerationJob(input: {
  provider: 'nexabot' | 'posbot'
  jobId: string
  prompt?: string
}): Promise<void> {
  const key = keyOf(input.provider, input.jobId)
  if (aktif.has(key)) return
  aktif.add(key)
  try {
    await apiFetch('', {
      method: 'POST',
      body: JSON.stringify({
        provider: input.provider,
        jobId: input.jobId,
        page: halamanSekarang(),
        prompt: input.prompt || '',
      }),
    })
  } catch { /* pencatatan tidak boleh mengganggu generate */ }
}

/** Tandai job selesai (beserta URL hasil) atau gagal. Best-effort. */
export async function finishGenerationJob(input: {
  provider: 'nexabot' | 'posbot'
  jobId: string
  status: 'done' | 'failed'
  resultUrl?: string
  error?: string
}): Promise<void> {
  aktif.delete(keyOf(input.provider, input.jobId))
  try {
    await apiFetch(`/${input.provider}/${input.jobId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: input.status,
        resultUrl: input.resultUrl || '',
        error: input.error || '',
      }),
    })
  } catch { /* status tracking tidak boleh menggagalkan generate */ }
}

/** Ambil hak resume; false bila tab/perangkat lain sudah memegang job ini. */
async function klaim(provider: string, jobId: string): Promise<boolean> {
  try {
    const res = await apiFetch(`/claim/${provider}/${jobId}`, { method: 'POST' })
    if (!res.ok) return false
    return !!(await res.json().catch(() => null))?.claimed
  } catch {
    return false
  }
}

/**
 * Lanjutkan job yang belum selesai setelah aplikasi dibuka lagi. Hasil yang
 * berhasil dilanjutkan masuk ke panel generasi + galeri lewat hook polling/save.
 */
export async function resumePendingGenerationJobs(): Promise<void> {
  if (!tokenSekarang()) return
  let jobs: any[] = []
  try {
    const res = await apiFetch('')
    if (!res.ok) return
    jobs = (await res.json().catch(() => null))?.jobs || []
  } catch { return }

  for (const job of jobs) {
    const key = keyOf(job.provider, job.job_id)
    if (aktif.has(key)) continue
    aktif.add(key)
    const page = (job.page || '') as GenerationPage
    // Panel Aktivitas generasi harus menunjukkan job yang sedang dilanjutkan,
    // bukan hanya hasil akhirnya.
    const taskId = page in GENERATION_PAGE_PATH
      ? startGenerationTask({
          page,
          model: `${job.provider === 'posbot' ? 'PosBot' : 'NexaBot'} · lanjut`,
          prompt: job.prompt || '',
          provider: job.provider,
        })
      : null
    try {
      if (!await klaim(job.provider, job.job_id)) continue
      if (job.provider === 'nexabot') {
        const { pollNexabotJob, saveNexabotResult } = await import('@/lib/nexabot')
        const auth = { master: true }
        await pollNexabotJob(job.job_id, auth, undefined, { maxTotalMs: 15 * 60 * 1000 })
        // saveNexabotResult sendiri menandai job selesai.
        const saved = await saveNexabotResult(job.job_id, auth, `resume-${job.job_id}.mp4`)
        if (!saved.ok || !saved.url) throw new Error(saved.error || 'Hasil tidak bisa disimpan')
        dismissResumeFailure(job.job_id)
        tambahHasil(job, saved.url)
      } else if (job.provider === 'posbot') {
        const { pollPosbotStatus } = await import('@/lib/posbot')
        // Kunci server: relay yang memasang kunci PosBot milik operator, klien
        // hanya mengirim identitas app (X-App-Token). Tanpa sentinel ini relay
        // menolak dengan 401 "Kunci PosBot milik server hanya untuk member yang
        // login". pollPosbotStatus sendiri menandai job selesai.
        const { url } = await pollPosbotStatus(SERVER_KEY, job.job_id, { maxTotalMs: 15 * 60 * 1000 })
        dismissResumeFailure(job.job_id)
        tambahHasil(job, url)
      }
    } catch (err: any) {
      const pesan = err?.message || 'Resume gagal'
      // Tampilkan di panel supaya user tahu hasilnya perlu diulang.
      addResumeFailure({
        id: job.job_id,
        provider: job.provider,
        page: page in GENERATION_PAGE_PATH ? page : 'video-edit',
        prompt: job.prompt || '',
        error: pesan,
        at: Date.now(),
      })
      await finishGenerationJob({
        provider: job.provider === 'posbot' ? 'posbot' : 'nexabot',
        jobId: job.job_id,
        status: 'failed',
        error: pesan,
      })
    } finally {
      if (taskId) removeActiveTask(taskId)
      aktif.delete(key)
    }
  }
}

function tambahHasil(job: any, url: string) {
  addResult({
    id: job.job_id,
    url,
    prompt: job.prompt || '',
    date: new Date().toISOString(),
    page: (job.page || 'video-edit') as GenerationPage,
  })
}
