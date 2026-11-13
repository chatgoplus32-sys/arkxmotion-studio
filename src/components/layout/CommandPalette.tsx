import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import {
  LayoutDashboard, Sparkles, Video, Image, AudioLines, Wand2, ShoppingBag,
  Music, Mic, Upload, SlidersHorizontal, Route, Settings, Bell, Search,
  ArrowRight, Command as CommandIcon, X, ChevronRight, Scissors, Waves,
  BarChart3, Activity, Users, Coins, CreditCard, Puzzle, FileText, Rocket,
  type LucideIcon,
} from 'lucide-react'
import { trackCmdUse, topFrequent } from '@/lib/cmdUsage'

interface CmdItem {
  id: string
  label: string
  keywords: string[]
  route: string
  icon: LucideIcon
  group: string
  hint?: string
  adminOnly?: boolean
  proOnly?: boolean
}

const COMMANDS: CmdItem[] = [
  { id: 'dashboard', label: 'Dashboard', keywords: ['dashboard','beranda','home','statistik'], route: '/dashboard', icon: LayoutDashboard, group: 'Navigasi' },
  { id: 'quick-start', label: 'Quick Start', keywords: ['start','mulai','panduan','belajar'], route: '/quick-start', icon: Rocket, group: 'Navigasi' },
  { id: 'hasil', label: 'Hasil Generate', keywords: ['hasil','gallery','assets','media','output'], route: '/hasil', icon: FileText, group: 'Navigasi' },
  { id: 'saldo', label: 'Top Up & Saldo', keywords: ['topup','saldo','kredit','token','isi'], route: '/saldo', icon: CreditCard, group: 'Navigasi' },
  { id: 'motion', label: 'Motion Control', keywords: ['motion','dance','gerakan','transfer'], route: '/generate/motion', icon: Video, group: 'Generate' },
  { id: 'image-to-video', label: 'Image to Video', keywords: ['image','gambar','animate','foto'], route: '/generate/image-to-video', icon: Image, group: 'Generate' },
  { id: 'text-to-image', label: 'Text to Image', keywords: ['text','gambar','generate','image','drawing'], route: '/generate/image', icon: Scissors, group: 'Generate' },
  { id: 'video-upscale', label: 'Video Upscale', keywords: ['upscale','4k','hd','video'], route: '/generate/video-upscaler', icon: Waves, group: 'Generate' },
  { id: 'bulk-fashion', label: 'Bulk Fashion', keywords: ['bulk','fashion','outfit','katalog','clothing'], route: '/generate/bulk-fashion', icon: ShoppingBag, group: 'Generate' },
  { id: 'upscaler', label: 'AI Upscaler', keywords: ['upscale','enhance','4k','foto'], route: '/generate/upscaler', icon: Wand2, group: 'Generate' },
  { id: 'song-cover', label: 'AI Song Cover', keywords: ['song','cover','musik','lagu'], route: '/generate/song-cover', icon: Music, group: 'Generate', proOnly: true },
  { id: 'voice-over', label: 'Voice Over', keywords: ['vo','voice','tts','suara'], route: '/generate/voice-over', icon: Mic, group: 'Generate' },
  { id: 'music-generator', label: 'Music Generator', keywords: ['music','musik','lagu','score'], route: '/generate/music-generator', icon: AudioLines, group: 'Generate' },
  { id: 'music-studio', label: 'AI Music Studio', keywords: ['music','musik','lagu','suno','mureka','studio'], route: '/generate/music-studio', icon: AudioLines, group: 'Generate' },
  { id: 'lipsync-pro', label: 'LipSync Pro', keywords: ['lipsync','lip sync','bibir','wajah','suara','posbot','lip'], route: '/generate/lipsync-pro', icon: Mic, group: 'Generate' },
  { id: 'upscale-video', label: 'Upscale Video (PosBot)', keywords: ['upscale','enhance','4k','video','perbesar','posbot'], route: '/generate/upscale-video', icon: Waves, group: 'Generate' },
  { id: 'image-studio', label: 'AI Image Studio', keywords: ['image','gambar','nano banana','seedream','flux','qwen','imagen','studio'], route: '/generate/image-studio', icon: Image, group: 'Generate' },
  { id: 'ugc', label: 'Product UGC', keywords: ['ugc','product','produk','iklan'], route: '/generate/ugc', icon: Sparkles, group: 'Generate' },
  { id: 'providers', label: 'Providers & API Keys', keywords: ['provider','api','key','token','balance'], route: '/providers', icon: Upload, group: 'Manajemen' },
  { id: 'routing', label: 'Smart Routing', keywords: ['routing','route','auto','termurah'], route: '/manage/routing', icon: Route, group: 'Manajemen' },
  { id: 'settings', label: 'Settings', keywords: ['setting','pengaturan','config'], route: '/settings', icon: Settings, group: 'Manajemen' },
  { id: 'admin-users', label: 'Admin · User Management', keywords: ['admin','user','approve','member'], route: '/admin/users', icon: Users, group: 'Admin', adminOnly: true },
  { id: 'admin-analytics', label: 'Admin · Usage Analytics', keywords: ['admin','analytics','statistik','usage'], route: '/admin/analytics', icon: BarChart3, group: 'Admin', adminOnly: true },
  { id: 'admin-activity', label: 'Admin · Activity Feed', keywords: ['admin','activity','log','history'], route: '/admin/activity', icon: Activity, group: 'Admin', adminOnly: true },
  { id: 'admin-health', label: 'Admin · System Health', keywords: ['admin','health','server','cpu','ram'], route: '/admin/health', icon: Activity, group: 'Admin', adminOnly: true },
  { id: 'admin-credits', label: 'Admin · Credit Management', keywords: ['admin','credit','token','balance'], route: '/admin/credits', icon: Coins, group: 'Admin', adminOnly: true },
]

export default function CommandPalette() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const addToast = useToastStore((s) => s.addToast)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const isAdmin = user?.role === 'admin'
  const isPro = isAdmin || user?.plan === 'pro'

  const commands = useMemo(() => COMMANDS.filter(c => (!c.adminOnly || isAdmin) && (!c.proOnly || isPro)), [isAdmin, isPro])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      const freq = topFrequent(100)
      const rank = new Map(freq.map((id, i) => [id, i]))
      return [...commands].sort((a, b) => (rank.get(a.route) ?? 999) - (rank.get(b.route) ?? 999))
    }
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.keywords.some(k => k.toLowerCase().includes(q)) ||
      c.group.toLowerCase().includes(q)
    )
  }, [commands, query])

  const groups = useMemo(() => {
    const map = new Map<string, CmdItem[]>()
    for (const c of filtered) {
      if (!map.has(c.group)) map.set(c.group, [])
      map.get(c.group)!.push(c)
    }
    return [...map.entries()]
  }, [filtered])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('arkx:open-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('arkx:open-palette', onOpen)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => { setSelected(0) }, [query])

  useEffect(() => { setOpen(false) }, [location.pathname])

  const runCommand = (cmd: CmdItem) => {
    trackCmdUse(cmd.route)
    setOpen(false)
    navigate(cmd.route)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter' && filtered[selected]) { e.preventDefault(); runCommand(filtered[selected]) }
  }

  // scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!open) return null

  let globalIndex = -1

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-[640px] overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#0B1526]/95 shadow-[0_0_60px_rgba(0,168,255,0.25)] backdrop-blur-xl">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-white/5 px-4">
          <Search className="h-5 w-5 text-cyan-300" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Cari tools, halaman, atau menu… (mis. ‘motion’)"
            className="h-14 flex-1 bg-transparent text-[15px] text-white placeholder-white/30 outline-none"
            aria-label="Cari perintah"
          />
          <kbd className="hidden rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-mono text-white/40 sm:block">ESC</kbd>
          <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-white/40 hover:bg-white/[0.06] hover:text-white" aria-label="Tutup">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-white/35">Tidak ada hasil untuk “{query}”</div>
          ) : (
            groups.map(([group, items]) => (
              <div key={group}>
                <div className="px-3 pb-1.5 pt-2 text-[9px] font-black uppercase tracking-[0.24em] text-cyan-300/60">{group}</div>
                {items.map((cmd) => {
                  globalIndex += 1
                  const idx = globalIndex
                  const active = idx === selected
                  const Icon = cmd.icon
                  return (
                    <button
                      key={cmd.id}
                      data-index={idx}
                      onClick={() => runCommand(cmd)}
                      onMouseEnter={() => setSelected(idx)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${active ? 'bg-gradient-to-r from-[#00A8FF]/20 to-cyan-500/10 ring-1 ring-cyan-400/30' : ''}`}
                    >
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${active ? 'bg-gradient-to-br from-[#00A8FF] to-[#00D4FF] text-black' : 'bg-white/[0.05] text-cyan-300'}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-white/90">{cmd.label}</span>
                      </span>
                      <ChevronRight className={`h-4 w-4 ${active ? 'text-cyan-300' : 'text-white/20'}`} />
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/5 px-4 py-2 text-[10px] text-white/35">
          <span className="flex items-center gap-2"><CommandIcon className="h-3 w-3" /> <kbd className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono">↑↓</kbd> pilih <kbd className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono">Enter</kbd> buka</span>
          <span className="flex items-center gap-1.5">{filtered.length} hasil</span>
        </div>
      </div>
    </div>
  )
}
