import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, ChevronLeft, ChevronRight, Clapperboard, Play, RotateCcw, ScanFace, Upload } from 'lucide-react'

const DURATION_MS = 4800

const STEPS = [
  { label: 'Upload referensi', desc: 'Foto karakter + video gerakan', icon: Upload, until: 12 },
  { label: 'Motion tracking', desc: 'AI membaca pose & ritme gerakan', icon: ScanFace, until: 55 },
  { label: 'Render 720p', desc: 'Frame demi frame di cloud', icon: Clapperboard, until: 92 },
  { label: 'Video siap', desc: 'Preview & download hasil', icon: Play, until: 100 },
]

const statusFor = (progress: number) => {
  if (progress >= 100) return 'Video siap'
  if (progress >= 92) return 'Menyiapkan video'
  if (progress >= 55) return 'Merender 720p'
  if (progress >= 12) return 'Motion tracking'
  return 'Upload referensi'
}

export default function MotionControlDemo() {
  const cardRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const startedRef = useRef(false)
  const draggingRef = useRef(false)

  const [started, setStarted] = useState(false)
  const [inView, setInView] = useState(false)
  const [run, setRun] = useState(0)
  const [progress, setProgress] = useState(0)
  const [pos, setPos] = useState(50)
  const [playing, setPlaying] = useState(false)

  const ready = progress >= 100

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting)
        if (entry.isIntersecting && !startedRef.current) {
          startedRef.current = true
          setStarted(true)
        }
      },
      { threshold: 0.35 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!started) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setProgress(100)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const ratio = Math.min(1, (now - start) / DURATION_MS)
      setProgress(Math.round(ratio * 100))
      if (ratio < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [started, run])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (ready && inView) {
      void video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [ready, inView])

  const updatePos = (clientX: number) => {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    setPos(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)))
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!ready) return
    draggingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    updatePos(event.clientX)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) updatePos(event.clientX)
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const replay = () => {
    const video = videoRef.current
    if (video) {
      video.pause()
      video.currentTime = 0
    }
    setPos(50)
    setProgress(0)
    setRun((value) => value + 1)
  }

  const activeIndex = progress >= 92 ? 3 : progress >= 55 ? 2 : progress >= 12 ? 1 : 0

  return (
    <div ref={cardRef} className="rounded-[20px] sm:rounded-[24px] border border-white/5 bg-white/[0.02] p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[13px] sm:text-sm font-semibold">
            <span className={`h-2 w-2 rounded-full ${ready ? 'bg-emerald-400' : 'bg-[#00c8ff] animate-pulse motion-reduce:animate-none'}`} />
            Motion Control
            <span className="rounded-full border border-[#00a8ff]/25 bg-[#00a8ff]/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.14em] text-[#4cc7ff]">
              demo
            </span>
          </div>
          <div className="mt-1 text-[10px] sm:text-[11px] font-mono text-white/35">Alur Motion Control · 5s · 720p</div>
        </div>
        <button
          type="button"
          onClick={replay}
          disabled={!ready}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] sm:text-[11px] font-medium text-white/60 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        >
          <RotateCcw className="h-3 w-3" /> Ulangi
        </button>
      </div>

      <div className="mt-4 flex flex-col sm:flex-row gap-4 sm:gap-5">
        <div className="w-full max-w-[250px] sm:max-w-none sm:w-[232px] lg:w-[258px] shrink-0 mx-auto sm:mx-0">
          <div
            ref={stageRef}
            role="group"
            aria-label="Demo sebelum dan sesudah Motion Control — geser untuk membandingkan"
            tabIndex={ready ? 0 : -1}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(event) => {
              if (!ready) return
              if (event.key === 'ArrowLeft') setPos((value) => Math.max(0, value - 4))
              if (event.key === 'ArrowRight') setPos((value) => Math.min(100, value + 4))
            }}
            className="relative aspect-[3/4] w-full select-none overflow-hidden rounded-2xl border border-white/10 bg-black outline-none focus-visible:ring-2 focus-visible:ring-[#00a8ff]/60"
            style={{ touchAction: 'pan-y', cursor: ready ? 'ew-resize' : 'default' }}
          >
            <video
              ref={videoRef}
              src="/demo/motion-after.mp4"
              poster="/demo/motion-before.jpg"
              muted
              loop
              playsInline
              preload="auto"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <img
              src="/demo/motion-before.webp"
              alt="Foto referensi sebelum dianimasikan"
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              style={{ clipPath: ready ? `inset(0 ${100 - pos}% 0 0)` : 'inset(0 0 0 0)' }}
            />

            {!ready && (
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-0 bg-gradient-to-t from-[#03030a]/90 via-transparent to-[#03030a]/45" />

                <div
                  className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-[#00d4ff] to-transparent shadow-[0_0_16px_2px_rgba(0,212,255,0.45)]"
                  style={{ top: `${8 + progress * 0.78}%` }}
                />

                {progress >= 12 && progress < 92 && (
                  <div className="absolute inset-x-[16%] top-[5%] bottom-[9%] rounded-xl border border-[#00d4ff]/35 transition-opacity duration-300">
                    <span className="absolute -top-2 left-2 rounded bg-[#06121c]/90 px-1.5 py-0.5 text-[8px] font-mono tracking-[0.18em] text-[#4cc7ff]">
                      MOTION LOCK
                    </span>
                    <span className="absolute -left-px -top-px h-3 w-3 rounded-tl border-l-2 border-t-2 border-[#00d4ff]" />
                    <span className="absolute -right-px -top-px h-3 w-3 rounded-tr border-r-2 border-t-2 border-[#00d4ff]" />
                    <span className="absolute -bottom-px -left-px h-3 w-3 rounded-bl border-b-2 border-l-2 border-[#00d4ff]" />
                    <span className="absolute -bottom-px -right-px h-3 w-3 rounded-br border-b-2 border-r-2 border-[#00d4ff]" />
                  </div>
                )}

                <div className="absolute inset-x-0 bottom-0 p-3">
                  <div className="flex items-center justify-between text-[9px] sm:text-[10px] font-mono uppercase tracking-[0.14em] text-white/55">
                    <span>{statusFor(progress)}</span>
                    <span className="text-[#4cc7ff]">{progress}%</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/15">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#00a8ff] to-[#00d4ff]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[9px] font-mono text-white/30">
                    <span>Referensi</span>
                    <span>Demo render · 720p</span>
                  </div>
                </div>
              </div>
            )}

            {ready && (
              <>
                <span className="absolute left-2 top-2 rounded-full border border-white/15 bg-black/55 px-2 py-0.5 text-[9px] sm:text-[10px] font-semibold text-white/80 backdrop-blur">
                  Before
                </span>
                <span className="absolute right-2 top-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[9px] sm:text-[10px] font-bold text-black">
                  After
                </span>
                <div className="absolute inset-y-0 z-10" style={{ left: `${pos}%` }}>
                  <div className="absolute inset-y-0 -left-px w-0.5 bg-white/85 shadow-[0_0_12px_rgba(0,0,0,0.55)]" />
                  <div className="absolute top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-[0_4px_16px_rgba(0,0,0,0.45)]">
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <ChevronRight className="h-3.5 w-3.5" />
                  </div>
                </div>
                {!playing && (
                  <button
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => void videoRef.current?.play().catch(() => {})}
                    aria-label="Putar video demo"
                    className="absolute inset-0 z-20 grid place-items-center"
                  >
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-white/95 text-black shadow-lg">
                      <Play className="ml-0.5 h-5 w-5" fill="currentColor" />
                    </span>
                  </button>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/65 to-transparent px-2 pb-2 pt-6 text-center">
                  <span className="text-[9px] sm:text-[10px] font-medium text-white/70">Geser untuk bandingkan</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.16em] text-white/35">Proses generate</span>
            <span className="text-[10px] sm:text-[11px] font-mono text-white/45">{progress}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#00a8ff] to-[#00d4ff]"
              style={{ width: `${progress}%` }}
            />
          </div>

          <ol className="mt-4 space-y-1.5 sm:space-y-2">
            {STEPS.map((step, index) => {
              const done = progress >= step.until
              const active = !done && index === activeIndex
              const Icon = step.icon
              return (
                <li
                  key={step.label}
                  className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors duration-300 ${
                    done
                      ? 'border-emerald-500/15 bg-emerald-500/[0.05]'
                      : active
                        ? 'border-[#00a8ff]/25 bg-[#00a8ff]/[0.07]'
                        : 'border-transparent bg-transparent'
                  }`}
                >
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border transition-colors duration-300 ${
                      done
                        ? 'border-emerald-500/20 bg-emerald-500/15 text-emerald-400'
                        : active
                          ? 'border-[#00a8ff]/30 bg-[#00a8ff]/15 text-[#4cc7ff]'
                          : 'border-white/[0.06] bg-white/[0.03] text-white/30'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-[11px] sm:text-xs font-medium ${done || active ? 'text-white/85' : 'text-white/35'}`}>
                      {step.label}
                    </div>
                    <div className="truncate text-[9px] sm:text-[10px] text-white/30">{step.desc}</div>
                  </div>
                  {done ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : active ? (
                    <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#00c8ff] motion-reduce:animate-none" />
                  ) : (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/10" />
                  )}
                </li>
              )
            })}
          </ol>

          <p className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.025] px-2.5 py-2 text-[10px] leading-relaxed text-white/35">
            {ready
              ? 'Video siap — geser garis untuk bandingkan foto & hasilnya.'
              : 'Simulasi alur render. Di dashboard prosesnya real dan bisa ditinggal.'}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[9px] sm:text-[10px] leading-relaxed text-white/25">
        Demo render 5 detik, bukan generate live. Hasil asli mengikuti model, durasi, dan token yang kamu pilih.
      </p>
    </div>
  )
}
