import { useCallback, useEffect, useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge, Input } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import {
  fetchAdminWithdrawals,
  processWithdrawal,
  type AdminWithdrawal,
} from '@/lib/affiliate'
import { formatRp } from '@/lib/membership'
import { Share2, RefreshCw, Loader2, Check, X, ArrowDownToLine } from 'lucide-react'

const STATUS_LABEL: Record<AdminWithdrawal['status'], string> = {
  pending: 'Menunggu',
  paid: 'Dibayar',
  rejected: 'Ditolak',
}

const STATUS_VARIANT: Record<AdminWithdrawal['status'], 'warning' | 'success' | 'destructive'> = {
  pending: 'warning',
  paid: 'success',
  rejected: 'destructive',
}

const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'pending', label: 'Menunggu' },
  { key: 'paid', label: 'Dibayar' },
  { key: 'rejected', label: 'Ditolak' },
  { key: '', label: 'Semua' },
]

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function AdminAffiliatePage() {
  const token = useAuthStore((s) => s.token)
  const addToast = useToastStore((s) => s.addToast)

  const [filter, setFilter] = useState('pending')
  const [items, setItems] = useState<AdminWithdrawal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [noteDraft, setNoteDraft] = useState<Record<number, string>>({})

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false)
      return
    }
    setError('')
    try {
      const res = await fetchAdminWithdrawals(token, filter)
      setItems(res.items)
    } catch (e) {
      setError((e as Error).message || 'Gagal memuat pengajuan pencairan')
    } finally {
      setLoading(false)
    }
  }, [token, filter])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const act = async (row: AdminWithdrawal, action: 'paid' | 'rejected') => {
    if (!token || busyId !== null) return
    const label = action === 'paid' ? 'menandai LUNAS' : 'MENOLAK'
    if (!confirm(`Yakin ${label} pencairan ${formatRp(row.amount)} untuk ${row.name}?`)) return
    setBusyId(row.id)
    try {
      await processWithdrawal(token, row.id, action, noteDraft[row.id] || '')
      addToast(action === 'paid' ? 'Pencairan ditandai lunas' : 'Pengajuan ditolak, saldo dikembalikan', 'success')
      await load()
    } catch (e) {
      addToast((e as Error).message || 'Gagal memproses pengajuan', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const pendingTotal = items.filter((i) => i.status === 'pending').reduce((sum, i) => sum + i.amount, 0)

  return (
    <PageContent>
      <PageHeader
        eyebrow="ADMIN"
        title="Affiliate"
        highlight="Pencairan"
        desc="Proses permintaan pencairan saldo afiliasi member. Menandai lunas menambah total dicairkan; menolak mengembalikan nominal ke saldo afiliasi member."
      />

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.key || 'all'}
            size="sm"
            variant={filter === f.key ? 'default' : 'secondary'}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => { setLoading(true); void load() }} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Muat ulang
        </Button>
        {filter === 'pending' && items.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {items.length} pengajuan · total {formatRp(pendingTotal)}
          </span>
        )}
      </div>

      <Section
        title="Pengajuan Pencairan"
        icon={<ArrowDownToLine className="h-4 w-4" />}
        sub="Pembayaran dilakukan manual di luar aplikasi, lalu tandai lunas di sini."
        right={<Badge variant="default" className="gap-1.5"><Share2 className="h-3 w-3" /> Afiliasi</Badge>}
      >
        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat pengajuan…
          </div>
        ) : error ? (
          <p className="py-6 text-sm text-destructive">{error}</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Tidak ada pengajuan pada filter ini.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Tanggal</th>
                  <th className="py-2 pr-3 font-medium">Member</th>
                  <th className="py-2 pr-3 font-medium">Tujuan</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 text-right font-medium">Nominal</th>
                  <th className="py-2 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 align-top last:border-0">
                    <td className="py-3 pr-3 text-muted-foreground">{formatDate(row.createdAt)}</td>
                    <td className="py-3 pr-3">
                      <div className="font-medium">{row.name}</div>
                      <div className="text-[11px] text-muted-foreground">{row.email}</div>
                    </td>
                    <td className="py-3 pr-3">
                      <div>{row.destination}</div>
                      {row.note && <div className="mt-0.5 text-[11px] text-muted-foreground">{row.note}</div>}
                      {row.adminNote && <div className="mt-0.5 text-[11px] text-muted-foreground">Admin: {row.adminNote}</div>}
                    </td>
                    <td className="py-3 pr-3">
                      <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                      {row.processedAt && (
                        <div className="mt-1 text-[11px] text-muted-foreground">{formatDate(row.processedAt)}</div>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-right font-medium tabular-nums">{formatRp(row.amount)}</td>
                    <td className="py-3">
                      {row.status === 'pending' ? (
                        <div className="flex flex-col items-end gap-1.5">
                          <Input
                            value={noteDraft[row.id] || ''}
                            onChange={(e) => setNoteDraft((prev) => ({ ...prev, [row.id]: e.target.value }))}
                            placeholder="Catatan admin"
                            className="h-8 w-40 text-xs"
                            maxLength={300}
                          />
                          <div className="flex gap-1.5">
                            <Button size="sm" onClick={() => act(row, 'paid')} disabled={busyId !== null}>
                              {busyId === row.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />} Lunas
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => act(row, 'rejected')} disabled={busyId !== null}>
                              <X className="mr-1 h-3.5 w-3.5" /> Tolak
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <span className="block text-right text-xs text-muted-foreground">Selesai</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </PageContent>
  )
}
