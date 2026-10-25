import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity, ArrowRight, ArrowUpRight, CheckCircle2, Image as ImageIcon, Images, Loader2,
  Sparkles, Video, Wand2, X,
} from 'lucide-react'
import { getActiveTasks, getResults, type ActiveTask, type CompletedResult } from '@/lib/backgroundTasks'
import { cn } from '@/lib/utils'

const PAGE_META: Record<ActiveTask['page'], { href: string; label: string; icon: typeof Video }> = {
  motion: { href: '/generate/motion', label: 'Motion Control', icon: Video },
  'image-to-video': { href: '/generate/image-to-video', label: 'Image to Video', icon: ImageIcon },
  upscaler: { href: '/generate/upscaler', label: 'AI Upscaler', icon: Sparkles },
  'edit-image': { href: '/generate/edit-image', label: 'Edit Image', icon: Wand2 },
}
const FALLBACK_PAGE = { href: '/dashboard', label: 'Generasi', icon: Sparkles }

const RESULT_LIMIT = 5
const DONE_FLASH_MS = 8000

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}j ${String(m).padStart(2, '0')}m`
  return `${m}:${String(s).padStart(2, '0')}`
}

function timeAgo(iso: string, now: number): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, Math.floor((now - t) / 1000))
  if (diff < 60) return 'baru saja'
  const m = Math.floor(diff / 60)
  if (m < 60) return `${m}m lalu`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}j lalu`
  return `${Math.floor(h / 24)}h lalu`
}

export function GenerationIndicator() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<ActiveTask[]>(() => getActiveTasks())
  const [results, setResults] = useState<CompletedResult[]>(() => getResults().slice(0, RESULT_LIMIT))
  const [now, setNow] = useState(() => Date.now())
  const [justFinished, setJustFinished] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const prevCountRef = useRef(active.length)
  const doneTimerRef = useRef<number | null>(null)

  const sync = useCallback(() => {
    const next = getActiveTasks()
    if (prevCountRef.current > next.length) {
      setJustFinished(true)
      if (doneTimerRef.current) window.clearTimeout(doneTimerRef.current)
      doneTimerRef.current = window.setTimeout(() => setJustFinished(false), DONE_FLASH_MS)
    }
    prevCountRef.current = next.length
    setActive(next)
    setResults(getResults().slice(0, RESULT_LIMIT))
    setNow(Date.now())
  }, [])

  useEffect(() => {
    const onChange = () => sync()
    window.addEventListener('arkxmotion-tasks-changed', onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener('arkxmotion-tasks-changed', onChange)
      window.removeEventListener('storage', onChange)
      if (doneTimerRef.current) window.clearTimeout(doneTimerRef.current)
    }
  }, [sync])

  useEffect(() => {
    if (!open && active.length === 0) return
    const id = window.setInterval(() => setNow(Date.now()), active.length > 0 ? 1000 : 30000)
    return () => window.clearInterval(id)
  }, [open, active.length])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const go = (page: ActiveTask['page']) => {
    navigate((PAGE_META[page] ?? FALLBACK_PAGE).href)
    setOpen(false)
  }

  const openResult = (result: CompletedResult) => {
    if (/^(https?:|blob:|\/)/i.test(result.url)) {
      window.open(result.url, '_blank', 'noopener,noreferrer')
    } else {
      go(result.page)
    }
    setOpen(false)
  }

  const toggle = () => {
    if (!open) sync()
    setOpen((v) => !v)
  }

  const running = active.length
  const label = running > 0 ? `${running} generasi` : justFinished ? 'Selesai' : 'Generasi'
  const ariaLabel = running > 0 ? `${running} generasi sedang berjalan` : 'Aktivitas generasi'

  return (
    <div className="relative" ref={panelRef}>
      <button
        ref={buttonRef}
        onClick={toggle}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          'relative flex h-9 items-center gap-2 rounded-lg px-2.5 transition-colors',
          running > 0
            ? 'bg-primary/10 text-primary hover:bg-primary/15'
            : justFinished
              ? 'text-emerald-400 hover:bg-accent'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          open && 'bg-accent text-foreground'
        )}
      >
        {running > 0 ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : justFinished ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <Activity className="h-4 w-4" />
        )}
        <span className="hidden text-xs font-medium sm:inline">{label}</span>
        {running > 0 && (
          <span className="grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground sm:hidden">
            {running}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Aktivitas generasi"
          className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-fade-in sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[360px]"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Generasi</h3>
              {running > 0 && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {running} berjalan
                </span>
              )}
            </div>
            <button
              onClick={() => { setOpen(false); buttonRef.current?.focus() }}
              aria-label="Tutup"
              className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {running > 0 && (
              <section>
                <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Sedang berjalan
                </p>
                {active.map((task) => {
                  const meta = PAGE_META[task.page] ?? FALLBACK_PAGE
                  const Icon = meta.icon
                  const startedAt = Number.isFinite(task.startedAt) ? task.startedAt : now
                  return (
                    <button
                      key={`${task.taskId}-${task.startedAt}`}
                      onClick={() => go(task.page)}
                      className="group flex w-full items-start gap-3 px-4 py-2.5 text-left transition hover:bg-accent/40"
                    >
                      <span className="relative mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary animate-pulse" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{task.model || meta.label}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          {meta.label} · {formatElapsed(now - startedAt)}
                        </span>
                        <span className="mt-1.5 block h-0.5 w-full overflow-hidden rounded-full bg-primary/10">
                          <span className="animate-generation-sweep block h-full w-1/3 rounded-full bg-gradient-to-r from-primary/30 via-primary to-primary/30 shadow-[0_0_8px_rgba(0,168,255,0.5)]" />
                        </span>
                      </span>
                      <ArrowUpRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition group-hover:text-primary" />
                    </button>
                  )
                })}
              </section>
            )}

            <section>
              <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Hasil terbaru
              </p>
              {results.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <Sparkles className="mx-auto mb-2 h-7 w-7 text-muted-foreground/40" />
                  <p className="text-sm font-medium">Belum ada generasi</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Hasil video dan gambar akan muncul di sini.</p>
                  <div className="mt-3 flex justify-center gap-2">
                    <button
                      onClick={() => go('motion')}
                      className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary transition hover:bg-primary/20"
                    >
                      Motion Control
                    </button>
                    <button
                      onClick={() => go('image-to-video')}
                      className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary transition hover:bg-primary/20"
                    >
                      Image to Video
                    </button>
                  </div>
                </div>
              ) : (
                results.map((result) => {
                  const meta = PAGE_META[result.page] ?? FALLBACK_PAGE
                  const Icon = meta.icon
                  const title = result.model || meta.label
                  return (
                    <button
                      key={`${result.id}-${result.date}`}
                      onClick={() => openResult(result)}
                      title="Buka hasil"
                      className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-accent/40"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-400/10 text-emerald-400">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{title}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {result.prompt?.trim() || meta.label}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground/70">{timeAgo(result.date, now)}</span>
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition group-hover:text-primary" />
                    </button>
                  )
                })
              )}
            </section>
          </div>

          <button
            onClick={() => { setOpen(false); navigate('/hasil') }}
            className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2.5 text-[11px] font-medium text-muted-foreground transition hover:bg-accent/40 hover:text-foreground"
          >
            <Images className="h-3.5 w-3.5" />
            Lihat semua hasil
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}
