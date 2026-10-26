import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, EmptyState, Input, Select, Button } from '@/components/ui'
import {
  AlertTriangle, CalendarDays, CheckCircle2, Clock3, Database, Download,
  ExternalLink, Image as ImageIcon, Images, Layers, Loader2, Music, Play, RefreshCw,
  Search, Sparkles, Trash2, Video, X,
} from 'lucide-react'
import { getResults, removeResult, GENERATION_PAGE_KIND, type CompletedResult } from '@/lib/backgroundTasks'
import { useToastStore } from '@/stores/toastStore'
import { cn } from '@/lib/utils'

type AssetKind = 'image' | 'video' | 'audio'
type StoreId = 'results' | 'upscaler' | 'editimage' | 'createpulse'
type KindFilter = 'all' | AssetKind

interface AssetRef {
  store: StoreId
  id?: string
  url: string
}

interface AssetItem {
  key: string
  url: string
  kind: AssetKind
  title: string
  prompt: string
  source: string
  provider?: string
  model?: string
  ratio?: string
  duration?: number
  createdAt?: string
  refs: AssetRef[]
  order: number
}

interface AssetSeed extends Omit<AssetItem, 'key' | 'refs' | 'order'> {}

const RESULTS_PAGE_SOURCE: Record<CompletedResult['page'], string> = {
  motion: 'Motion Control',
  'image-to-video': 'Image to Video',
  upscaler: 'AI Upscaler',
  'edit-image': 'Edit Image',
  'song-cover': 'AI Song Cover',
  'video-upscaler': 'Video Upscaler',
  'bulk-fashion': 'Bulk Fashion',
  'virtual-tryon': 'Virtual Try-On',
  'travel-photo': 'Travel Photo',
  'talking-photo': 'Talking Photo',
  'h3-i2v': 'H3 Image to Video',
  'h3-music-avatar': 'H3 Music Avatar',
  'ugc-storyboard': 'UGC Storyboard',
  'voice-over': 'Voice Over',
  'music-generator': 'Music Generator',
  'text-to-image': 'Image Generator',
  ugc: 'Product UGC',
  'clip-genius': 'Clip Genius',
}

const UPSCALER_KEY = 'arkxmotion.upscaler.gallery'
const EDITIMAGE_KEY = 'arkxmotion.editimage.gallery'
const CREATEPULSE_KEY = 'createpulse.results'

const KIND_TABS: { id: KindFilter; label: string; icon: typeof Images }[] = [
  { id: 'all', label: 'Semua', icon: Layers },
  { id: 'video', label: 'Video', icon: Video },
  { id: 'image', label: 'Gambar', icon: ImageIcon },
  { id: 'audio', label: 'Audio', icon: Music },
]

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(?:$|[?#])/i
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)(?:$|[?#])/i

const KIND_ICON = { video: Video, image: ImageIcon, audio: Music }

function readArray(key: string): unknown[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const t = Date.parse(value)
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined
}

function normalizeCreatePulseUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('/')) return `https://createpulse.online${url}`
  return url
}

function assetKey(url: string, id?: string): string {
  if (url.startsWith('blob:')) return `id:${id || url}`
  try {
    const parsed = new URL(url, window.location.origin)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return `url:${url}`
  }
}

function kindFromUrl(url: string): AssetKind {
  if (VIDEO_EXT.test(url)) return 'video'
  if (IMAGE_EXT.test(url)) return 'image'
  return 'image'
}

function mergeAsset(map: Map<string, AssetItem>, seed: AssetSeed, ref: AssetRef) {
  const key = assetKey(seed.url, ref.id)
  const current = map.get(key)
  if (!current) {
    map.set(key, { ...seed, key, refs: [ref], order: map.size })
    return
  }
  current.refs.push(ref)
  if (current.kind === 'image' && seed.kind === 'video') current.kind = 'video'
  if (!current.prompt && seed.prompt) current.prompt = seed.prompt
  if (!current.model && seed.model) current.model = seed.model
  if (!current.provider && seed.provider) current.provider = seed.provider
  if (!current.ratio && seed.ratio) current.ratio = seed.ratio
  if (current.duration === undefined && seed.duration !== undefined) current.duration = seed.duration
  if (!current.createdAt && seed.createdAt) current.createdAt = seed.createdAt
}

function collectAssets(): AssetItem[] {
  const map = new Map<string, AssetItem>()

  for (const result of getResults()) {
    if (!result?.url) continue
    const source = RESULTS_PAGE_SOURCE[result.page] || 'Generasi'
    const kind: AssetKind = result.kind || GENERATION_PAGE_KIND[result.page] || kindFromUrl(result.url)
    mergeAsset(map, {
      url: result.url,
      kind,
      title: str(result.model) || source,
      prompt: str(result.prompt) || '',
      source,
      provider: str(result.provider),
      model: str(result.model),
      ratio: str(result.ratio),
      duration: typeof result.duration === 'number' ? result.duration : undefined,
      createdAt: isoDate(result.date),
    }, { store: 'results', id: result.id, url: result.url })
  }

  for (const entry of readArray(UPSCALER_KEY)) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const url = str(item.url) || str(item.preview)
    if (!url || !/^https?:\/\//i.test(url)) continue
    const sourceName = str(item.sourceName)
    const provider = str(item.provider)
    const mode = str(item.mode)
    mergeAsset(map, {
      url,
      kind: 'image',
      title: sourceName || 'Upscale',
      prompt: [provider, mode].filter(Boolean).join(' · '),
      source: 'AI Upscaler',
      provider,
      model: mode,
      createdAt: isoDate(item.createdAt),
    }, { store: 'upscaler', id: str(item.id), url })
  }

  for (const entry of readArray(EDITIMAGE_KEY)) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const url = str(item.url)
    // Item blob: dari sesi lama sudah mati; hasil yang sama tetap tersedia
    // lewat arkxmotion_results yang URL-nya dipulihkan dari IndexedDB.
    if (!url || url.startsWith('blob:') || !(url.startsWith('http') || url.startsWith('/'))) continue
    mergeAsset(map, {
      url,
      kind: 'image',
      title: str(item.model) || 'Edit Image',
      prompt: str(item.prompt) || '',
      source: 'Edit Image',
      provider: str(item.provider),
      model: str(item.model),
      createdAt: isoDate(item.createdAt),
    }, { store: 'editimage', id: str(item.id), url })
  }

  for (const entry of readArray(CREATEPULSE_KEY)) {
    if (typeof entry !== 'string' || !entry) continue
    if (!(entry.startsWith('http') || entry.startsWith('/'))) continue
    const url = normalizeCreatePulseUrl(entry)
    mergeAsset(map, {
      url,
      kind: 'video',
      title: 'Image to Video',
      prompt: '',
      source: 'Image to Video',
    }, { store: 'createpulse', url: entry })
  }

  return [...map.values()].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : NaN
    const tb = b.createdAt ? Date.parse(b.createdAt) : NaN
    const aValid = Number.isFinite(ta)
    const bValid = Number.isFinite(tb)
    if (aValid && bValid && ta !== tb) return tb - ta
    if (aValid && !bValid) return -1
    if (!aValid && bValid) return 1
    return a.order - b.order
  })
}

function timeAgo(iso?: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, Date.now() - t)
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'baru saja'
  if (minutes < 60) return `${minutes}m lalu`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}j lalu`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}h lalu`
  return new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}

function fullDate(iso?: string): string {
  if (!iso) return 'Tidak tercatat'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'Tidak tercatat'
  return new Date(t).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

function extensionFor(asset: AssetItem): string {
  try {
    const match = new URL(asset.url, window.location.origin).pathname.match(/\.([a-z0-9]{2,5})$/i)
    if (match) return match[1].toLowerCase()
  } catch {}
  return asset.kind === 'video' ? 'mp4' : asset.kind === 'audio' ? 'mp3' : 'jpg'
}

function downloadName(asset: AssetItem): string {
  const slug = (asset.title || asset.source)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'hasil'
  const stamp = asset.createdAt
    ? new Date(asset.createdAt).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  return `arkxmotion-${slug}-${stamp}.${extensionFor(asset)}`
}

function filterStoredArray(key: string, predicate: (value: unknown) => boolean) {
  let parsed: unknown
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return
    parsed = JSON.parse(raw)
  } catch {
    return
  }
  if (!Array.isArray(parsed)) return
  try {
    localStorage.setItem(key, JSON.stringify(parsed.filter(predicate)))
  } catch {}
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card/50 p-3.5">
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', accent)}>{icon}</span>
      <div className="min-w-0">
        <div className="truncate font-display text-lg font-bold leading-tight">{value}</div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      </div>
    </div>
  )
}

export default function AssetsPage() {
  const navigate = useNavigate()
  const addToast = useToastStore((s) => s.addToast)
  const [assets, setAssets] = useState<AssetItem[]>(() => collectAssets())
  const [kind, setKind] = useState<KindFilter>('all')
  const [source, setSource] = useState('all')
  const [query, setQuery] = useState('')
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [broken, setBroken] = useState<Set<string>>(() => new Set())
  const [downloading, setDownloading] = useState<string | null>(null)

  const sync = useCallback(() => setAssets(collectAssets()), [])

  useEffect(() => {
    const onChange = () => sync()
    window.addEventListener('arkxmotion-tasks-changed', onChange)
    window.addEventListener('storage', onChange)
    window.addEventListener('focus', onChange)
    const interval = window.setInterval(sync, 10000)
    return () => {
      window.removeEventListener('arkxmotion-tasks-changed', onChange)
      window.removeEventListener('storage', onChange)
      window.removeEventListener('focus', onChange)
      window.clearInterval(interval)
    }
  }, [sync])

  useEffect(() => {
    if (!confirmKey) return
    const timer = window.setTimeout(() => setConfirmKey(null), 3500)
    return () => window.clearTimeout(timer)
  }, [confirmKey])

  const previewAsset = useMemo(
    () => (previewKey ? assets.find((a) => a.key === previewKey) || null : null),
    [assets, previewKey],
  )

  useEffect(() => {
    if (previewKey && !previewAsset) setPreviewKey(null)
  }, [previewAsset, previewKey])

  useEffect(() => {
    if (!previewAsset) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewKey(null)
    }
    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [previewAsset])

  const counts = useMemo(() => ({
    all: assets.length,
    video: assets.filter((a) => a.kind === 'video').length,
    image: assets.filter((a) => a.kind === 'image').length,
    audio: assets.filter((a) => a.kind === 'audio').length,
  }), [assets])

  const sources = useMemo(
    () => Array.from(new Set(assets.map((a) => a.source))).sort((a, b) => a.localeCompare(b, 'id')),
    [assets],
  )

  const sourceOptions = useMemo(
    () => [{ value: 'all', label: 'Semua sumber' }, ...sources.map((s) => ({ value: s, label: s }))],
    [sources],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return assets.filter((a) => {
      if (kind !== 'all' && a.kind !== kind) return false
      if (source !== 'all' && a.source !== source) return false
      if (!q) return true
      return [a.title, a.prompt, a.model, a.provider, a.source]
        .some((value) => value?.toLowerCase().includes(q))
    })
  }, [assets, kind, source, query])

  const hasFilter = kind !== 'all' || source !== 'all' || query.trim() !== ''
  const latestLabel = assets.find((a) => a.createdAt)?.createdAt

  const markBroken = useCallback((key: string) => {
    setBroken((prev) => {
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }, [])

  const resetFilters = () => {
    setKind('all')
    setSource('all')
    setQuery('')
  }

  const handleDownload = async (asset: AssetItem) => {
    if (downloading) return
    setDownloading(asset.key)
    try {
      const res = await fetch(asset.url, { mode: 'cors' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = downloadName(asset)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000)
      addToast('Unduhan dimulai', 'success')
    } catch {
      window.open(asset.url, '_blank', 'noopener,noreferrer')
      addToast('Tidak bisa unduh langsung — hasil dibuka di tab baru', 'warning')
    } finally {
      setDownloading(null)
    }
  }

  const handleDelete = (asset: AssetItem) => {
    const removeUrls = new Set<string>([asset.url, ...asset.refs.map((r) => r.url)])

    for (const ref of asset.refs) {
      if (ref.store === 'results' && ref.id) removeResult(ref.id)
    }

    filterStoredArray(UPSCALER_KEY, (value) => {
      if (!value || typeof value !== 'object') return true
      const item = value as Record<string, unknown>
      const id = str(item.id)
      const url = str(item.url)
      const preview = str(item.preview)
      return !asset.refs.some((r) => r.store === 'upscaler' && ((r.id && id === r.id) || (url && removeUrls.has(url)) || (preview && removeUrls.has(preview))))
    })

    filterStoredArray(EDITIMAGE_KEY, (value) => {
      if (!value || typeof value !== 'object') return true
      const item = value as Record<string, unknown>
      const id = str(item.id)
      const url = str(item.url)
      return !asset.refs.some((r) => r.store === 'editimage' && ((r.id && id === r.id) || (url && removeUrls.has(url))))
    })

    filterStoredArray(CREATEPULSE_KEY, (value) => !(typeof value === 'string' && removeUrls.has(value)))

    window.dispatchEvent(new Event('arkxmotion-tasks-changed'))
    setPreviewKey(null)
    setConfirmKey(null)
    sync()
    addToast('Hasil dihapus', 'success')
  }

  const openInTab = (asset: AssetItem) => {
    window.open(asset.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Galeri"
        title="Hasil"
        highlight="Generasi"
        desc="Semua gambar, video, dan audio yang kamu buat di ARKXMotion — cari, pratinjau, unduh, atau hapus dari satu tempat."
        actions={(
          <Button onClick={() => navigate('/generate/motion')}>
            <Sparkles className="h-4 w-4" />
            Buat baru
          </Button>
        )}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard icon={<Layers className="h-4 w-4" />} label="Total hasil" value={String(counts.all)} accent="bg-primary/10 text-primary" />
        <StatCard icon={<Video className="h-4 w-4" />} label="Video" value={String(counts.video)} accent="bg-violet-500/10 text-violet-400" />
        <StatCard icon={<ImageIcon className="h-4 w-4" />} label="Gambar" value={String(counts.image)} accent="bg-emerald-500/10 text-emerald-400" />
        <StatCard icon={<Music className="h-4 w-4" />} label="Audio" value={String(counts.audio)} accent="bg-sky-500/10 text-sky-400" />
        <StatCard icon={<Clock3 className="h-4 w-4" />} label="Terakhir dibuat" value={timeAgo(latestLabel) || '—'} accent="bg-amber-500/10 text-amber-400" />
      </div>

      <Section>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Input
            leftIcon={<Search className="h-4 w-4" />}
            placeholder="Cari prompt, model, atau sumber..."
            aria-label="Cari hasil"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="lg:max-w-sm"
          />

          <div role="tablist" aria-label="Filter tipe hasil" className="flex items-center gap-1 self-start rounded-xl border border-border bg-background p-1">
            {KIND_TABS.map((tab) => {
              const Icon = tab.icon
              const active = kind === tab.id
              const count = tab.id === 'all' ? counts.all : counts[tab.id]
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setKind(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
                    active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                  <span className={cn('rounded-full px-1 text-[10px] tabular-nums', active ? 'bg-primary/15' : 'bg-secondary')}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-2 lg:ml-auto">
            <Select
              options={sourceOptions}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              aria-label="Filter sumber hasil"
              className="h-9 w-full sm:w-[170px]"
            />
            <Button variant="outline" size="icon" onClick={sync} aria-label="Muat ulang hasil" title="Muat ulang" className="h-9 w-9 shrink-0">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span>
            {filtered.length} dari {assets.length} hasil
            {hasFilter && ' setelah filter'}
          </span>
          {hasFilter && (
            <button type="button" onClick={resetFilters} className="font-medium text-primary hover:underline">
              Reset filter
            </button>
          )}
        </div>
      </Section>

      {assets.length === 0 ? (
        <Section>
          <EmptyState
            icon={<Database className="h-8 w-8" />}
            title="Belum ada hasil tersimpan"
            description="Hasil dari semua fitur generate — video, gambar, dan audio — akan muncul otomatis di sini."
            action={(
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" onClick={() => navigate('/generate/motion')}>Motion Control</Button>
                <Button size="sm" variant="outline" onClick={() => navigate('/generate/image-to-video')}>Image to Video</Button>
              </div>
            )}
          />
        </Section>
      ) : filtered.length === 0 ? (
        <Section>
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="Tidak ada hasil yang cocok"
            description="Coba kata kunci lain atau reset filter untuk melihat semua hasil."
            action={<Button size="sm" variant="outline" onClick={resetFilters}>Reset filter</Button>}
          />
        </Section>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {filtered.map((asset) => {
            const KindIcon = KIND_ICON[asset.kind]
            const isBroken = broken.has(asset.key)
            const isConfirm = confirmKey === asset.key
            return (
              <li
                key={asset.key}
                className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card/60 transition duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
              >
                <button
                  type="button"
                  onClick={() => setPreviewKey(asset.key)}
                  aria-label={`Pratinjau ${asset.title}`}
                  className="relative block aspect-video w-full overflow-hidden bg-black/40 text-left"
                >
                  {isBroken ? (
                    <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-secondary to-background text-muted-foreground">
                      <AlertTriangle className="h-5 w-5" />
                      <span className="text-[10px]">Media tidak tersedia</span>
                    </span>
                  ) : asset.kind === 'video' ? (
                    <video
                      src={`${asset.url}${asset.url.includes('#') ? '' : '#t=0.1'}`}
                      preload="metadata"
                      muted
                      playsInline
                      onError={() => markBroken(asset.key)}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                    />
                  ) : asset.kind === 'audio' ? (
                    <span className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-sky-500/20 via-secondary to-background text-sky-400">
                      <Music className="h-8 w-8" />
                      <span className="text-[10px] font-medium text-muted-foreground">Audio</span>
                    </span>
                  ) : (
                    <img
                      src={asset.url}
                      alt={asset.title}
                      loading="lazy"
                      onError={() => markBroken(asset.key)}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                    />
                  )}

                  <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                    <KindIcon className="h-3 w-3" />
                    {asset.kind === 'video' ? 'Video' : asset.kind === 'audio' ? 'Audio' : 'Gambar'}
                  </span>
                  {asset.createdAt && (
                    <span className="absolute right-2 top-2 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white/80 backdrop-blur">
                      {timeAgo(asset.createdAt)}
                    </span>
                  )}
                  {asset.kind === 'video' && !isBroken && (
                    <span className="pointer-events-none absolute inset-0 grid place-items-center">
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition duration-200 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground">
                        <Play className="ml-0.5 h-4 w-4 fill-current" />
                      </span>
                    </span>
                  )}
                </button>

                <div className="flex flex-1 flex-col p-2.5">
                  <p className="truncate text-xs font-semibold" title={asset.title}>{asset.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={asset.prompt || asset.source}>
                    {asset.prompt || asset.source}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="truncate rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {asset.source}
                    </span>
                    {asset.provider && !asset.prompt && (
                      <span className="ml-auto truncate text-[10px] text-muted-foreground/70">{asset.provider}</span>
                    )}
                  </div>
                  <div className="mt-auto flex items-center justify-end gap-0.5 border-t border-border/60 pt-1.5">
                    <button
                      type="button"
                      onClick={() => handleDownload(asset)}
                      disabled={downloading === asset.key}
                      aria-label={`Unduh ${asset.title}`}
                      title="Unduh"
                      className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-60"
                    >
                      {downloading === asset.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => openInTab(asset)}
                      aria-label={`Buka ${asset.title} di tab baru`}
                      title="Buka di tab baru"
                      className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (isConfirm) handleDelete(asset)
                        else setConfirmKey(asset.key)
                      }}
                      onBlur={() => { if (isConfirm) setConfirmKey(null) }}
                      aria-label={isConfirm ? `Konfirmasi hapus ${asset.title}` : `Hapus ${asset.title}`}
                      title={isConfirm ? 'Klik lagi untuk hapus' : 'Hapus'}
                      className={cn(
                        'grid h-7 min-w-7 place-items-center rounded-lg px-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive',
                        isConfirm && 'bg-destructive/15 text-destructive',
                      )}
                    >
                      {isConfirm ? <span className="text-[10px] font-semibold">Hapus?</span> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {previewAsset && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-6"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setPreviewKey(null) }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Pratinjau ${previewAsset.title}`}
            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl animate-fade-in sm:rounded-2xl"
          >
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                {previewAsset.kind === 'video' ? <Video className="h-4 w-4" /> : previewAsset.kind === 'audio' ? <Music className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{previewAsset.title}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {previewAsset.source} · {fullDate(previewAsset.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewKey(null)}
                aria-label="Tutup pratinjau"
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row">
              <div className="grid shrink-0 place-items-center bg-black p-2 lg:flex-1">
                {broken.has(previewAsset.key) ? (
                  <div className="flex min-h-[220px] w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                    <AlertTriangle className="h-9 w-9" />
                    <p className="text-sm font-medium">Media tidak tersedia</p>
                    <p className="max-w-xs text-center text-[11px]">Tautan hasil mungkin sudah kedaluwarsa. Kamu masih bisa menghapusnya dari galeri.</p>
                  </div>
                ) : previewAsset.kind === 'video' ? (
                  <video
                    src={previewAsset.url}
                    controls
                    playsInline
                    onError={() => markBroken(previewAsset.key)}
                    className="max-h-[55vh] w-full rounded-lg bg-black object-contain lg:max-h-[70vh]"
                  />
                ) : previewAsset.kind === 'audio' ? (
                  <div className="flex w-full flex-col items-center justify-center gap-4 p-6">
                    <Music className="h-16 w-16 text-sky-400" />
                    <audio
                      src={previewAsset.url}
                      controls
                      onError={() => markBroken(previewAsset.key)}
                      className="w-full max-w-lg"
                    />
                  </div>
                ) : (
                  <img
                    src={previewAsset.url}
                    alt={previewAsset.title}
                    onError={() => markBroken(previewAsset.key)}
                    className="max-h-[55vh] w-full rounded-lg object-contain lg:max-h-[70vh]"
                  />
                )}
              </div>

              <aside className="w-full shrink-0 space-y-4 border-t border-border p-4 lg:w-80 lg:border-l lg:border-t-0">
                {previewAsset.prompt && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Prompt</p>
                    <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-background/40 p-2.5 text-xs leading-relaxed text-foreground/90">
                      {previewAsset.prompt}
                    </p>
                  </div>
                )}

                <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-xl border border-border bg-background/40 p-3 text-[11px]">
                  <div>
                    <dt className="text-muted-foreground">Sumber</dt>
                    <dd className="mt-0.5 font-medium">{previewAsset.source}</dd>
                  </div>
                  {previewAsset.model && (
                    <div>
                      <dt className="text-muted-foreground">Model</dt>
                      <dd className="mt-0.5 truncate font-medium" title={previewAsset.model}>{previewAsset.model}</dd>
                    </div>
                  )}
                  {previewAsset.provider && (
                    <div>
                      <dt className="text-muted-foreground">Provider</dt>
                      <dd className="mt-0.5 truncate font-medium">{previewAsset.provider}</dd>
                    </div>
                  )}
                  {previewAsset.ratio && (
                    <div>
                      <dt className="text-muted-foreground">Rasio</dt>
                      <dd className="mt-0.5 font-medium">{previewAsset.ratio}</dd>
                    </div>
                  )}
                  {previewAsset.duration !== undefined && (
                    <div>
                      <dt className="text-muted-foreground">Durasi</dt>
                      <dd className="mt-0.5 font-medium">{previewAsset.duration} detik</dd>
                    </div>
                  )}
                  <div className="col-span-2 flex items-center gap-1.5 text-muted-foreground">
                    <CalendarDays className="h-3 w-3" />
                    {fullDate(previewAsset.createdAt)}
                  </div>
                </dl>

                <div className="flex flex-col gap-2">
                  <Button onClick={() => handleDownload(previewAsset)} loading={downloading === previewAsset.key}>
                    {downloading !== previewAsset.key && <Download className="h-4 w-4" />}
                    Unduh
                  </Button>
                  <Button variant="outline" onClick={() => openInTab(previewAsset)}>
                    <ExternalLink className="h-4 w-4" />
                    Buka di tab baru
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleDelete(previewAsset)}
                    className="border-destructive/30 text-destructive hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    Hapus hasil
                  </Button>
                </div>

                {!broken.has(previewAsset.key) && (
                  <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    Hasil tersimpan di perangkat ini
                  </p>
                )}
              </aside>
            </div>
          </div>
        </div>
      )}
    </PageContent>
  )
}
