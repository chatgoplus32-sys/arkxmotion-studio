// ─── Halaman Antrean ────────────────────────────────────────────────────────
//
// Daftar job NexaBot/PosBot milik user: yang masih menunggu/diproses,
// yang sudah selesai, dan yang gagal — beserta asal halamannya dan apakah
// job itu dipantau server (kunci server) atau hanya bisa dilanjutkan saat
// tab terbuka (kunci pribadi member).
//
// Data: GET /api/generation-jobs/all (server/routes/generationJobs.ts).
// Aksi memakai src/lib/queueApi.ts. Halaman me-refresh otomatis tiap
// 30 detik selagi dibuka (pola yang sama dengan NotificationPanel).
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, PageContent } from '@/components/layout'
import { Button } from '@/components/ui'
import { useToastStore } from '@/stores/toastStore'
import { GENERATION_PAGE_PATH, type GenerationPage } from '@/lib/backgroundTasks'
import {
  cancelGenerationJob,
  deleteGenerationJob,
  fetchQueueJobs,
  resumeAllJobs,
  saveNexabotJobResult,
  type GenerationJob,
  type JobStatus,
} from '@/lib/queueApi'
import { cn } from '@/lib/utils'
import { Loader2, RefreshCw, Play, X, Trash2, Download, ExternalLink, Clock } from 'lucide-react'

/** Label halaman asal yang ramah dibaca (kunci = `page` di generation_job). */
const PAGE_LABELS: Record<string, string> = {
  motion: 'Motion Control',
  'image-to-video': 'Image to Video',
  upscaler: 'AI Upscaler',
  'edit-image': 'Edit Image',
  'song-cover': 'AI Song Cover',
  'video-upscaler': 'Video Upscaler',
  'bulk-fashion': 'Bulk Fashion',
  'virtual-tryon': 'Virtual Try-On',
  'travel-photo': 'Travel Photo',
  'h3-i2v': 'H3 Image to Video',
  'h3-music-avatar': 'H3 Music Avatar',
  'ugc-storyboard': 'Storyboard',
  'voice-over': 'Voice Over',
  'clone-voice': 'Clone Voice',
  'music-generator': 'Music Generator',
  'music-studio': 'AI Music Studio',
  'image-studio': 'AI Image Studio',
  'text-to-image': 'Text to Image',
  ugc: 'UGC',
  'video-edit': 'ARKX AUTO Studio',
  'clip-genius': 'Clip Genius',
  'upscale-video': 'Upscale Video',
  'arkx-health': 'ARKX Health Animasi',
}

const STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'Menunggu',
  processing: 'Diproses',
  done: 'Selesai',
  failed: 'Gagal',
}

const STATUS_STYLE: Record<JobStatus, string> = {
  pending: 'bg-amber-400/10 text-amber-400',
  processing: 'bg-blue-400/10 text-blue-400',
  done: 'bg-emerald-400/10 text-emerald-400',
  failed: 'bg-red-400/10 text-red-400',
}

const PROVIDER_LABEL: Record<string, string> = {
  nexabot: 'NexaBot',
  posbot: 'PosBot',
}

const FILTERS: { key: JobStatus | 'semua'; label: string }[] = [
  { key: 'semua', label: 'Semua' },
  { key: 'pending', label: 'Menunggu' },
  { key: 'processing', label: 'Diproses' },
  { key: 'done', label: 'Selesai' },
  { key: 'failed', label: 'Gagal' },
]

const PAGE_SIZE = 20

function waktuLalu(ms: number): string {
  const detik = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (detik < 60) return 'baru saja'
  const menit = Math.floor(detik / 60)
  if (menit < 60) return `${menit}m lalu`
  const jam = Math.floor(menit / 60)
  if (jam < 24) return `${jam}j lalu`
  const hari = Math.floor(jam / 24)
  return `${hari}h lalu`
}

export default function Queue() {
  const navigate = useNavigate()
  const addToast = useToastStore((s) => s.addToast)
  const [jobs, setJobs] = useState<GenerationJob[]>([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState<JobStatus | 'semua'>('semua')
  const [loading, setLoading] = useState(true)
  const [memuatLagi, setMemuatLagi] = useState(false)
  const [error, setError] = useState('')
  const [resuming, setResuming] = useState(false)
  const [aksiId, setAksiId] = useState<number | null>(null)

  const muat = useCallback(async (gantiFilter?: JobStatus | 'semua') => {
    const f = gantiFilter ?? filter
    setError('')
    setLoading(true)
    try {
      const { jobs: rows, total: n } = await fetchQueueJobs({ status: f, limit: PAGE_SIZE, offset: 0 })
      setJobs(rows)
      setTotal(n)
    } catch (err) {
      setError((err as Error)?.message || 'Gagal memuat antrean')
    } finally {
      setLoading(false)
    }
  }, [filter])

  // Muat awal + refresh tiap 30 detik selagi halaman dibuka.
  useEffect(() => {
    void muat()
    const timer = setInterval(() => { void muat() }, 30_000)
    return () => clearInterval(timer)
  }, [muat])

  const gantiFilter = (f: JobStatus | 'semua') => {
    setFilter(f)
    void muat(f)
  }

  const muatLagi = async () => {
    setMemuatLagi(true)
    try {
      const { jobs: rows } = await fetchQueueJobs({ status: filter, limit: PAGE_SIZE, offset: jobs.length })
      setJobs((prev) => [...prev, ...rows])
    } catch (err) {
      addToast((err as Error)?.message || 'Gagal memuat antrean', 'error')
    } finally {
      setMemuatLagi(false)
    }
  }

  const lanjutkanSemua = async () => {
    setResuming(true)
    try {
      await resumeAllJobs()
      addToast('Melanjutkan job yang bisa di-resume — hasilnya masuk ke panel generasi & galeri.', 'info')
      await muat()
    } catch (err) {
      addToast((err as Error)?.message || 'Gagal melanjutkan job', 'error')
    } finally {
      setResuming(false)
    }
  }

  const batalkan = async (job: GenerationJob) => {
    if (!window.confirm('Batalkan pelacakan job ini? Job di provider tetap berjalan, tapi hasilnya tidak bisa diambil lagi dari antrean.')) return
    setAksiId(job.id)
    try {
      await cancelGenerationJob(job.provider, job.job_id)
      addToast('Job dibatalkan dari antrean.', 'info')
      await muat()
    } catch (err) {
      addToast((err as Error)?.message || 'Gagal membatalkan job', 'error')
    } finally {
      setAksiId(null)
    }
  }

  const hapus = async (job: GenerationJob) => {
    if (!window.confirm('Hapus job ini dari antrean?')) return
    setAksiId(job.id)
    try {
      await deleteGenerationJob(job.provider, job.job_id)
      await muat()
    } catch (err) {
      addToast((err as Error)?.message || 'Gagal menghapus job', 'error')
    } finally {
      setAksiId(null)
    }
  }

  const simpanHasil = async (job: GenerationJob) => {
    setAksiId(job.id)
    try {
      const hasil = await saveNexabotJobResult(job.job_id)
      if (!hasil.ok || !hasil.url) {
        addToast(hasil.error || 'Hasil belum bisa disimpan — coba lagi sebentar lagi.', 'error')
        return
      }
      addToast('Hasil tersimpan.', 'success')
      await muat()
    } catch (err) {
      addToast((err as Error)?.message || 'Gagal menyimpan hasil', 'error')
    } finally {
      setAksiId(null)
    }
  }

  const bukaHalamanAsal = (job: GenerationJob) => {
    const path = GENERATION_PAGE_PATH[job.page as GenerationPage]
    if (path) navigate(path)
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Antrean generasi"
        title="Antrean"
        desc="Job NexaBot & PosBot yang masih berjalan, sudah selesai, atau gagal. Job berkunci server dipantau worker walau tab ditutup; job berkunci pribadi hanya bisa dilanjutkan saat aplikasi terbuka."
        actions={
          <>
            <Button variant="outline" onClick={() => void muat()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button onClick={() => void lanjutkanSemua()} disabled={resuming || loading}>
              {resuming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Lanjutkan sekarang
            </Button>
          </>
        }
      />

      {/* Filter status */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => gantiFilter(f.key)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition',
              filter === f.key
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-muted-foreground">
          {total} job
        </span>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && jobs.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat antrean…
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-4 py-12 text-center">
          <Clock className="mx-auto mb-2 h-8 w-8 opacity-30" />
          <p className="text-sm text-muted-foreground">Belum ada job di antrean.</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Job NexaBot & PosBot yang kamu generate akan tercatat di sini dan bisa dilanjutkan walau tab ditutup.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const dipantauServer = job.credential_source === 'server'
            const halamanAsal = GENERATION_PAGE_PATH[job.page as GenerationPage]
            const sibuk = aksiId === job.id
            return (
              <div key={job.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_STYLE[job.status])}>
                        {STATUS_LABEL[job.status]}
                      </span>
                      <span className="text-xs font-medium">{PROVIDER_LABEL[job.provider] || job.provider}</span>
                      <span className="text-xs text-muted-foreground">
                        {PAGE_LABELS[job.page] || job.page || 'Halaman lain'}
                      </span>
                      <span className="text-xs text-muted-foreground/60">{waktuLalu(job.updated_at)}</span>
                    </div>
                    {job.prompt ? (
                      <p className="mt-2 line-clamp-2 text-sm">{job.prompt}</p>
                    ) : (
                      <p className="mt-2 font-mono text-xs text-muted-foreground">{job.job_id}</p>
                    )}
                    {job.status === 'failed' && job.last_error && (
                      <p className="mt-1 text-xs text-destructive">{job.last_error}</p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground/70">
                      {dipantauServer
                        ? 'Dipantau server — selesai walau tab ditutup.'
                        : 'Kunci pribadi — hanya bisa dilanjutkan saat aplikasi terbuka.'}
                      {job.status === 'pending' && job.server_poll === 0 && job.poll_misses > 0 && (
                        <> Upstream tidak mengenal job ini; polling server dihentikan.</>
                      )}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {job.status === 'done' && job.result_url && (
                      <a
                        href={job.result_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90"
                      >
                        <Download className="h-3.5 w-3.5" /> Buka hasil
                      </a>
                    )}
                    {job.status === 'done' && !job.result_url && job.provider === 'nexabot' && (
                      <Button size="sm" onClick={() => void simpanHasil(job)} disabled={sibuk}>
                        {sibuk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                        Simpan hasil
                      </Button>
                    )}
                    {(job.status === 'pending' || job.status === 'processing') && (
                      <Button size="sm" variant="outline" onClick={() => void batalkan(job)} disabled={sibuk}>
                        <X className="h-3.5 w-3.5" /> Batalkan
                      </Button>
                    )}
                    {job.status === 'failed' && halamanAsal && (
                      <Button size="sm" variant="outline" onClick={() => bukaHalamanAsal(job)}>
                        <ExternalLink className="h-3.5 w-3.5" /> Buka halaman asal
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => void hapus(job)} disabled={sibuk} title="Hapus dari antrean">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {jobs.length > 0 && jobs.length < total && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void muatLagi()} disabled={memuatLagi}>
            {memuatLagi ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Muat lagi ({jobs.length}/{total})
          </Button>
        </div>
      )}
    </PageContent>
  )
}
