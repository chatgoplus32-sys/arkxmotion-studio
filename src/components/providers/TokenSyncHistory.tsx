import { useEffect } from 'react'
import { Trash2, History } from 'lucide-react'
import { useTokenSyncStore } from '@/stores/tokenSyncStore'

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'baru saja'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} mnt lalu`
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} jam lalu`
  return new Date(ts).toLocaleDateString()
}

export default function TokenSyncHistory({ provider }: { provider?: string }) {
  const events = useTokenSyncStore((s) => s.events)
  const clearHistory = useTokenSyncStore((s) => s.clearHistory)
  const markAllRead = useTokenSyncStore((s) => s.markAllRead)

  // Membuka halaman ini = menandai semua notifikasi auto-sync sudah dibaca
  useEffect(() => {
    markAllRead()
  }, [markAllRead])

  const filtered = provider ? events.filter((e) => e.provider === provider) : events
  if (filtered.length === 0) return null

  return (
    <div className="mb-4 rounded-xl border border-border/50 bg-card/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-[12px] font-mono uppercase tracking-widest text-muted-foreground">
          <History className="h-3.5 w-3.5" />
          Riwayat Auto-Sync Token
        </div>
        <button
          onClick={clearHistory}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition"
          title="Hapus riwayat"
        >
          <Trash2 className="h-3 w-3" /> Bersihkan
        </button>
      </div>
      <ul className="space-y-1">
        {filtered.slice(0, 8).map((e) => (
          <li key={e.id} className="flex items-center gap-2 text-[12px] py-1 border-b border-border/30 last:border-0">
            <span>{e.icon}</span>
            <span className="font-medium">{e.label}</span>
            <span className="text-muted-foreground">
              {e.action === 'replaced' ? 'token diganti otomatis' : 'token baru'}
              {e.note ? ` · ${e.note}` : ''}
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/70">{timeAgo(e.ts)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
