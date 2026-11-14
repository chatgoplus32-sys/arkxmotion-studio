// ─── Job generasi yang bertahan setelah tab ditutup ───────────────────────
//
// pollNexabotJob / pollPosbotStatus mencatat jobId ke server begitu polling
// dimulai, lalu menandainya selesai saat hasil didapat. Saat aplikasi dibuka
// lagi, resumePendingGenerationJobs() melanjutkan polling job yang belum
// selesai dan memasukkan hasilnya ke panel generasi + galeri.
//
// Resume memakai kunci server lewat relay; job yang dulu memakai kunci pribadi
// member akan gagal dengan pesan jelas, bukan hilang diam-diam.
import { useAuthStore } from '@/stores/authStore'
import { addResult, GENERATION_PAGE_PATH, type GenerationPage } from '@/lib/backgroundTasks'

const TRACK_URL = '/api/generation-jobs'
/** Job yang sedang dipoll di tab ini — resume tidak boleh mengambil alih. */
const aktif = new Set<string>()

const keyOf = (provider: string, jobId: string) => `${provider}:${jobId}`

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string | null) => fetch(`${TRACK_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const store = useAuthStore.getState()
  let res = await send(store.token || localStorage.getItem('arkxmotion_token'))
  if (res.status === 401 && await store.refresh()) {
    res = await send(useAuthStore.getState().token)
  }
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
  model?: string
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
        model: input.model || '',
        prompt: input.prompt || '',
      }),
    })
  } catch { /* pencatatan tidak boleh mengganggu generate */ }
}

/** Tandai job selesai (beserta URL hasil) atau gagal. */
export async function finishGenerationJob(input: {
  provider: 'nexabot' | 'posbot'
  jobId: string
  status: 'done' | 'failed'
  resultUrl?: string
  error?: string
}): Promise<void> {
  aktif.delete(keyOf(input.provider, input.jobId))
  try {
    const res = await apiFetch('')
    if (!res.ok) return
    const jobs: any[] = (await res.json().catch(() => null))?.jobs || []
    const job = jobs.find((j) => j.provider === input.provider && j.job_id === input.jobId)
    if (!job) return
    await apiFetch(`/${job.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: input.status,
        resultUrl: input.resultUrl || '',
        error: input.error || '',
      }),
    })
  } catch { /* status tracking tidak boleh menggagalkan generate */ }
}

/**
 * Lanjutkan job yang belum selesai setelah aplikasi dibuka lagi. Hasil yang
 * berhasil dilanjutkan dimasukkan ke panel generasi + galeri.
 */
export async function resumePendingGenerationJobs(): Promise<void> {
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
    try {
      if (job.provider === 'nexabot') {
        const { pollNexabotJob, saveNexabotResult } = await import('@/lib/nexabot')
        const auth = { master: true }
        await pollNexabotJob(job.job_id, auth, undefined, { maxTotalMs: 15 * 60 * 1000 })
        const saved = await saveNexabotResult(job.job_id, auth, `resume-${job.job_id}.mp4`)
        if (!saved.ok || !saved.url) throw new Error(saved.error || 'Hasil tidak bisa disimpan')
        await finishGenerationJob({ provider: 'nexabot', jobId: job.job_id, status: 'done', resultUrl: saved.url })
        addResult({
          id: job.job_id,
          url: saved.url,
          prompt: job.prompt || '',
          date: new Date().toISOString(),
          page: (job.page || 'video-edit') as GenerationPage,
        })
      } else if (job.provider === 'posbot') {
        const { pollPosbotStatus } = await import('@/lib/posbot')
        const { url } = await pollPosbotStatus('', job.job_id, { maxTotalMs: 15 * 60 * 1000 })
        await finishGenerationJob({ provider: 'posbot', jobId: job.job_id, status: 'done', resultUrl: url })
        addResult({
          id: job.job_id,
          url,
          prompt: job.prompt || '',
          date: new Date().toISOString(),
          page: (job.page || 'video-edit') as GenerationPage,
        })
      }
    } catch (err: any) {
      await finishGenerationJob({
        provider: job.provider === 'posbot' ? 'posbot' : 'nexabot',
        jobId: job.job_id,
        status: 'failed',
        error: err?.message || 'Resume gagal',
      })
    } finally {
      aktif.delete(key)
    }
  }
}
