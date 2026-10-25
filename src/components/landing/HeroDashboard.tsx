import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Play } from 'lucide-react'

interface Provider {
  name: string
  dot: string
}

interface HeroDashboardProps {
  providers: Provider[]
}

const FINAL_METRICS = { generates: 48291, success: 96.4, keys: 14 }

export default function HeroDashboard({ providers }: HeroDashboardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const [inView, setInView] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [paused, setPaused] = useState(true)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(false)
  const [metrics, setMetrics] = useState({ generates: 0, success: 0, keys: 0 })

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduceMotion(query.matches)
    const onChange = (event: MediaQueryListEvent) => setReduceMotion(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.25,
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (inView && !reduceMotion) {
      void video.play().then(() => setPaused(false)).catch(() => setPaused(true))
    } else {
      video.pause()
      setPaused(true)
    }
  }, [inView, reduceMotion])

  useEffect(() => {
    if (!inView) return
    if (reduceMotion) {
      setProgress(100)
      setDone(true)
      return
    }
    let frame = 0
    let hold = 0
    let start = performance.now()
    const tick = (now: number) => {
      const value = Math.min(100, Math.round(((now - start) / 5200) * 100))
      setProgress(value)
      if (value < 100) {
        frame = requestAnimationFrame(tick)
      } else {
        setDone(true)
        hold = window.setTimeout(() => {
          setDone(false)
          setProgress(0)
          start = performance.now()
          frame = requestAnimationFrame(tick)
        }, 1800)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(hold)
    }
  }, [inView, reduceMotion])

  useEffect(() => {
    if (!inView) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMetrics(FINAL_METRICS)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const ratio = Math.min(1, (now - start) / 1400)
      const eased = 1 - Math.pow(1 - ratio, 3)
      setMetrics({
        generates: Math.round(FINAL_METRICS.generates * eased),
        success: Math.round(FINAL_METRICS.success * eased * 10) / 10,
        keys: Math.round(FINAL_METRICS.keys * eased),
      })
      if (ratio < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [inView])

  return (
    <>
      <div ref={cardRef} className="relative rounded-[24px] overflow-hidden border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.02] backdrop-blur-2xl shadow-[0_20px_80px_rgba(0,0,0,0.5)]">
        <div className="h-11 flex items-center justify-between px-4 border-b border-white/5 bg-white/[0.03]">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-400/80" />
            <span className="w-3 h-3 rounded-full bg-yellow-400/80" />
            <span className="w-3 h-3 rounded-full bg-green-400/80" />
          </div>
          <div className="text-[11px] sm:text-xs font-mono text-white/40">arkxmotion.studio — Dashboard</div>
          <div className="w-16" />
        </div>

        <div className="p-3 sm:p-4 grid gap-3 sm:gap-4">
          <div className="rounded-2xl overflow-hidden border border-white/5 bg-black/40 aspect-[4/5] sm:aspect-[16/9] relative">
            <img
              src="/demo/motion-before.webp"
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl"
            />
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-[#050510]/15 to-cyan-500/10" />

            <div className="absolute inset-0 flex items-center justify-center gap-1.5 sm:gap-2 px-2 pt-3 sm:pt-4 pb-10">
              <div className="relative hidden sm:block h-full aspect-[9/16] overflow-hidden rounded-lg border border-white/10 bg-black/60">
                <img src="/demo/motion-before.webp" alt="Foto referensi" className="h-full w-full object-cover opacity-85" />
                <span className="absolute left-1.5 top-1.5 rounded-full border border-white/15 bg-black/55 px-1.5 py-0.5 text-[8px] font-semibold text-white/80 backdrop-blur">
                  Before
                </span>
              </div>

              <div className="hidden sm:grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/10 bg-black/50 text-white/60 backdrop-blur">
                <ArrowRight className="h-3 w-3" />
              </div>

              <div className="relative h-full aspect-[9/16] overflow-hidden rounded-lg border border-emerald-400/25 bg-black shadow-[0_0_30px_rgba(0,168,255,0.18)]">
                <video
                  ref={videoRef}
                  src="/demo/motion-after.mp4"
                  poster="/demo/motion-before.jpg"
                  muted
                  loop
                  playsInline
                  preload="auto"
                  onPlay={() => setPaused(false)}
                  onPause={() => setPaused(true)}
                  className="h-full w-full object-cover"
                />
                {paused && (
                  <button
                    type="button"
                    onClick={() => void videoRef.current?.play().catch(() => {})}
                    aria-label="Putar preview Motion Control"
                    className="absolute inset-0 grid place-items-center bg-black/25"
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-black shadow-lg">
                      <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
                    </span>
                  </button>
                )}
                <span className="absolute left-1.5 top-1.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[8px] font-bold text-black">
                  After
                </span>
                <span className="absolute right-1.5 top-1.5 rounded-full border border-white/15 bg-black/50 px-1.5 py-0.5 text-[8px] font-mono text-white/70 backdrop-blur">
                  DEMO
                </span>
              </div>
            </div>

            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
              <span className="truncate text-[9px] sm:text-[11px] font-mono px-2 py-1 rounded-full bg-black/60 border border-white/10 text-white/70">
                Motion Control • 5s • 720p
              </span>
              <span className="inline-flex min-w-[104px] sm:min-w-[118px] items-center justify-center rounded-full bg-emerald-500 px-2 py-1 text-[9px] sm:text-[11px] font-semibold text-black tabular-nums">
                {done ? '✓ Render selesai' : `● Generating ${progress}%`}
              </span>
            </div>

            <div className="absolute inset-x-0 bottom-0 h-[2px] bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-[#00d4ff]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-white/[0.04] border border-white/5 p-2 sm:p-3">
              <div className="text-[10px] sm:text-[11px] text-white/40">Total Generates</div>
              <div className="text-[14px] sm:text-[16px] font-bold text-blue-400 tabular-nums">{metrics.generates.toLocaleString('en-US')}</div>
              <div className="text-[10px] sm:text-[11px] text-white/30">+12% minggu ini</div>
            </div>
            <div className="rounded-xl bg-white/[0.04] border border-white/5 p-2 sm:p-3">
              <div className="text-[10px] sm:text-[11px] text-white/40">Success Rate</div>
              <div className="text-[14px] sm:text-[16px] font-bold text-emerald-400 tabular-nums">{metrics.success.toFixed(1)}%</div>
              <div className="text-[10px] sm:text-[11px] text-white/30">Avg 38s</div>
            </div>
            <div className="rounded-xl bg-white/[0.04] border border-white/5 p-2 sm:p-3">
              <div className="text-[10px] sm:text-[11px] text-white/40">Active Keys</div>
              <div className="text-[14px] sm:text-[16px] font-bold text-blue-400 tabular-nums">{metrics.keys}/18</div>
              <div className="text-[10px] sm:text-[11px] text-white/30">3 providers</div>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
            {providers.slice(0, 5).map((provider, index) => (
              <div key={provider.name} className="rounded-xl bg-white/[0.03] border border-white/5 p-1.5 sm:p-2 text-center">
                <div
                  className="w-2 h-2 rounded-full mx-auto mb-1 animate-pulse motion-reduce:animate-none"
                  style={{ background: provider.dot, animationDelay: `${index * 220}ms`, animationDuration: '2.4s' }}
                />
                <div className="text-[10px] sm:text-[11px] font-medium text-white/70">{provider.name}</div>
                <div className="text-[9px] sm:text-[10px] text-emerald-400">online</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="absolute bottom-1 -left-4 hidden md:flex items-center gap-3 rounded-2xl bg-[#0c0c1a] border border-white/10 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.5)] animate-[fadeInUp_0.8s_ease-out_0.5s_both]">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-400 to-cyan-300 grid place-items-center text-black">⚡</div>
        <div>
          <div className="text-sm font-semibold">Bulk 100 video — Done</div>
          <div className="text-xs text-white/50">Selesai dalam 4m 12s • ZIP siap download</div>
        </div>
      </div>
    </>
  )
}
