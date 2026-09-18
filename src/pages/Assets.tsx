import { useMemo, useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, EmptyState, Input } from '@/components/ui'
import { Database, Image, Video, FileText, Mic } from 'lucide-react'

const CATEGORIES = [
  { id: 'all', label: 'All', icon: <Database className="h-4 w-4" /> },
  { id: 'image', label: 'Images', icon: <Image className="h-4 w-4" /> },
  { id: 'video', label: 'Videos', icon: <Video className="h-4 w-4" /> },
  { id: 'text', label: 'Text', icon: <FileText className="h-4 w-4" /> },
  { id: 'voice', label: 'Voice', icon: <Mic className="h-4 w-4" /> },
] as const

type CategoryId = (typeof CATEGORIES)[number]['id']

interface AssetItem {
  id: string
  url: string
  kind: Exclude<CategoryId, 'all'>
  name: string
  createdAt?: string
}

function readJsonArray(key: string): unknown[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function collectAssets(): AssetItem[] {
  const out: AssetItem[] = []
  for (const item of readJsonArray('arkxmotion.upscaler.gallery') as Array<{ url?: string; preview?: string; sourceName?: string; createdAt?: string }>) {
    const url = item.url || item.preview
    if (!url || url.startsWith('blob:')) continue
    out.push({ id: `upscaler-${url}`, url, kind: 'image', name: item.sourceName || 'Upscaler', createdAt: item.createdAt })
  }
  for (const item of readJsonArray('arkxmotion.editimage.gallery') as Array<{ url?: string; createdAt?: string }>) {
    if (!item.url || item.url.startsWith('blob:')) continue
    out.push({ id: `edit-${item.url}`, url: item.url, kind: 'image', name: 'EditImage', createdAt: item.createdAt })
  }
  for (const item of readJsonArray('createpulse.results') as Array<{ videoUrl?: string; url?: string; prompt?: string; createdAt?: string }>) {
    const url = item.videoUrl || item.url
    if (!url || (typeof url === 'string' && (url as string).startsWith('blob:'))) continue
    out.push({ id: `i2v-${url}`, url, kind: 'video', name: item.prompt?.slice(0, 40) || 'ImageToVideo', createdAt: item.createdAt })
  }
  for (const item of readJsonArray('arkxmotion_results') as Array<{ url?: string; prompt?: string; date?: string }>) {
    if (!item.url || item.url.startsWith('blob:')) continue
    out.push({ id: `bg-${item.url}`, url: item.url, kind: item.url.match(/\.(mp4|webm|mov)$/i) ? 'video' : 'image', name: item.prompt?.slice(0, 40) || 'Result', createdAt: item.date })
  }
  return out.slice(0, 200)
}

export default function AssetsPage() {
  const [active, setActive] = useState<CategoryId>('all')
  const [query, setQuery] = useState('')
  const assets = useMemo(collectAssets, [])

  const filtered = assets.filter((a) => {
    if (active !== 'all' && a.kind !== active) return false
    if (query.trim() && !a.name.toLowerCase().includes(query.trim().toLowerCase())) return false
    return true
  })

  return (
    <PageContent>
      <PageHeader
        eyebrow="Storage"
        title="Asset"
        highlight="Hub"
        desc="Organized storage for your generated images, videos, text, and voice."
      />

      <Section title="Assets">
        <div className="flex gap-2 mb-3 overflow-x-auto pb-2" role="tablist" aria-label="Filter kategori asset">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={active === cat.id}
              aria-pressed={active === cat.id}
              aria-label={`Filter ${cat.label}`}
              onClick={() => setActive(cat.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition whitespace-nowrap ${
                active === cat.id ? 'bg-accent border-accent-foreground/20' : 'border-border hover:bg-accent'
              }`}
            >
              {cat.icon}
              {cat.label}
            </button>
          ))}
        </div>

        <div className="mb-4">
          <Input
            placeholder="Cari asset..."
            aria-label="Cari asset"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<Database className="h-8 w-8" />}
            title="Belum ada asset tersimpan"
            description={assets.length === 0 ? 'Asset yang di-generate akan muncul di sini' : 'Tidak cocok dengan filter/pencarian'}
          />
        ) : (
          <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {filtered.map((a) => (
              <li key={a.id} className="rounded-lg border border-border overflow-hidden">
                {a.kind === 'video' ? (
                  <video src={a.url} controls preload="metadata" className="w-full h-32 object-cover" aria-label={a.name} />
                ) : (
                  <img src={a.url} alt={a.name} loading="lazy" className="w-full h-32 object-cover" />
                )}
                <div className="p-2 text-xs truncate" title={a.name}>{a.name}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PageContent>
  )
}
