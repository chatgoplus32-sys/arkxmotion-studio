import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Routes, useLocation, type Location } from 'react-router-dom'
import { GENERATION_PAGE_PATH, getActiveTasks } from '@/lib/backgroundTasks'
import { PageActiveContext } from '@/hooks/usePageActive'

// Halaman generator tetap ter-mount saat user pindah menu. Tanpa ini React
// Router meng-unmount halaman, sehingga proses generate, progress, dan isian
// (gambar/audio/prompt) hilang begitu menu diganti.
const KEEP_ALIVE_PATHS = new Set<string>([
  ...Object.values(GENERATION_PAGE_PATH),
  '/generate/watermark-remover',
  '/tools/metadata-cleaner',
  '/generate/edit-video-auto-motion',
  '/generate/ugc-pro',
  '/tools/gemini-tools',
])

// Batas halaman yang disimpan agar memori tidak membengkak. Halaman yang
// sedang punya task berjalan tidak pernah dibuang.
const MAX_CACHED_TABS = 6

interface Tab {
  path: string
  location: Location
}

function PageLoader() {
  return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" /></div>
}

function KeepAliveSlot({ active, location, children }: { active: boolean; location: Location; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (active) return
    // Halaman tersembunyi tidak boleh terus memutar audio/video hasil generate.
    ref.current?.querySelectorAll('video, audio').forEach((el) => {
      try { (el as HTMLMediaElement).pause() } catch {}
    })
  }, [active])

  return (
    <div ref={ref} hidden={!active} aria-hidden={!active}>
      <PageActiveContext.Provider value={active}>
        <Suspense fallback={<PageLoader />}>
          <Routes location={location}>{children}</Routes>
        </Suspense>
      </PageActiveContext.Provider>
    </div>
  )
}

export function KeepAliveRoutes({ children }: { children: ReactNode }) {
  const location = useLocation()
  const path = location.pathname
  const cached = KEEP_ALIVE_PATHS.has(path)
  const [tabs, setTabs] = useState<Tab[]>(() => (cached ? [{ path, location }] : []))

  if (cached && !tabs.some((t) => t.path === path)) {
    setTabs((prev) => [...prev, { path, location }])
  }

  // Tab yang baru dikunjungi pindah ke urutan terakhir supaya eviksi LRU
  // membuang halaman yang paling lama tidak dibuka.
  useEffect(() => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path)
      if (idx < 0 || idx === prev.length - 1) return prev
      const next = [...prev]
      const [tab] = next.splice(idx, 1)
      next.push(tab)
      return next
    })
  }, [path])

  const runningPaths = new Set(
    getActiveTasks().map((task) => GENERATION_PAGE_PATH[task.page]).filter(Boolean)
  )
  const protectedTabs = tabs.filter((t) => t.path === path || runningPaths.has(t.path))
  const rest = tabs.filter((t) => !protectedTabs.includes(t))
  const freeSlots = Math.max(0, MAX_CACHED_TABS - protectedTabs.length)
  const visibleTabs = [...rest.slice(Math.max(0, rest.length - freeSlots)), ...protectedTabs]

  return (
    <>
      {visibleTabs.map((tab) => (
        <KeepAliveSlot key={tab.path} active={tab.path === path} location={tab.location}>
          {children}
        </KeepAliveSlot>
      ))}
      {!cached && (
        <Suspense fallback={<PageLoader />}>
          <Routes>{children}</Routes>
        </Suspense>
      )}
    </>
  )
}
