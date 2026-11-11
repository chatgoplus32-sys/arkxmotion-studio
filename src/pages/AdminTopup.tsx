import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge, Select, Label } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { CheckCircle, XCircle, Clock, Wallet, Sparkles } from 'lucide-react'
import { nexabotPackageName } from '@/lib/nexabotWallet'
import { manualProviderLabel } from '@/lib/manualTopup'

interface Topup {
  id: number
  user_id: number
  amount: number
  /** Token Seavi yang dikreditkan (hanya provider seavi). */
  tokens?: number
  status: 'pending' | 'approved' | 'rejected'
  /** 'unlimited' = pembelian Paket Unlimited (approve → aktifkan masa berlaku, bukan tambah saldo). */
  kind?: 'balance' | 'unlimited'
  days?: number
  /** Varian paket NexaBot yang dibeli (mis. unlimited_monthly) / paket Seavi (mis. seavi_5). */
  package_slug?: string
  /** Hanya top-up manual: provider yang diajukan member. */
  provider?: string
  expires_at?: string | null
  proof_note: string
  admin_note: string
  created_at: string
  user_name: string
  email: string
}

export default function AdminTopupPage() {
  const { token } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const [topups, setTopups] = useState<Topup[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  // Wallet mana yang sedang dibuka: CreatePulse (Rp), NexaBot (Rp), Seavi (token),
  // atau manual untuk provider tanpa dompet (Roboneo/Weavy/Framia, dll.).
  const [provider, setProvider] = useState<'createpulse' | 'nexabot' | 'seavi' | 'posbot' | 'manual'>('createpulse')

  // Inject saldo langsung (promo) — hanya dompet member yang punya saldo.
  const [users, setUsers] = useState<{ id: number; email: string; name: string | null }[]>([])
  const [injUserFilter, setInjUserFilter] = useState('')
  const [injUserId, setInjUserId] = useState('')
  const [injProvider, setInjProvider] = useState<'createpulse' | 'nexabot' | 'seavi' | 'posbot'>('createpulse')
  const [injAmount, setInjAmount] = useState('')
  const [injNote, setInjNote] = useState('')
  const [injBalance, setInjBalance] = useState<number | null>(null)
  const [injBusy, setInjBusy] = useState(false)

  const API = '/api/admin/topup'
  const headers = useMemo(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token])

  const fetchTopups = useCallback(async () => {
    setLoading(true)
    try {
      const url = provider === 'manual' ? '/api/provider-topup/admin/pending' : `${API}/pending?provider=${provider}`
      const res = await fetch(url, { headers })
      const data = await res.json()
      // Endpoint manual memakai nama `requests` dan kolom `note`.
      setTopups((data.topups || data.requests || []).map((t: Topup & { note?: string }) =>
        t.note !== undefined ? { ...t, proof_note: t.note ?? '' } : t,
      ))
    } catch (e) { console.error('[AdminTopup] Failed to fetch pending topups:', e) }
    setLoading(false)
  }, [headers, provider])

  useEffect(() => { fetchTopups() }, [fetchTopups])

  const fetchAll = async () => {
    setLoading(true)
    try {
      const url = provider === 'manual' ? '/api/provider-topup/admin/all' : `${API}/all?provider=${provider}`
      const res = await fetch(url, { headers })
      const data = await res.json()
      setTopups((data.topups || data.requests || []).map((t: Topup & { note?: string }) =>
        t.note !== undefined ? { ...t, proof_note: t.note ?? '' } : t,
      ))
    } catch (e) { console.error('[AdminTopup] Failed to fetch all topups:', e) }
    setLoading(false)
  }

  const handleApprove = async (id: number) => {
    setActionLoading(id)
    if (provider === 'manual') {
      try {
        const res = await fetch(`/api/provider-topup/admin/${id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ status: 'approved', admin_note: 'Approved' }),
        })
        const data = await res.json()
        if (res.ok) {
          addToast('Topup manual disetujui', 'success')
          fetchTopups()
        } else {
          addToast(data.error || 'Gagal', 'error')
        }
      } catch { addToast('Network error', 'error') }
      setActionLoading(null)
      return
    }
    try {
      const res = await fetch(`${API}/approve`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id, admin_note: 'Approved', provider }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(
          data.unlimited
            ? (data.message || 'Paket Unlimited diaktifkan')
            : provider === 'seavi'
              ? (data.message || `Topup approved — ${data.tokens ?? data.balance ?? 0} token`)
              : `Topup approved — saldo ${data.balance?.toLocaleString('id-ID')}`,
          'success',
        )
        fetchTopups()
      } else {
        addToast(data.error || 'Gagal', 'error')
      }
    } catch { addToast('Network error', 'error') }
    setActionLoading(null)
  }

  const handleReject = async (id: number) => {
    setActionLoading(id)
    if (provider === 'manual') {
      try {
        const res = await fetch(`/api/provider-topup/admin/${id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ status: 'rejected', admin_note: 'Rejected' }),
        })
        if (res.ok) {
          addToast('Topup manual ditolak', 'info')
          fetchTopups()
        } else {
          const data = await res.json()
          addToast(data.error || 'Gagal', 'error')
        }
      } catch { addToast('Network error', 'error') }
      setActionLoading(null)
      return
    }
    try {
      const res = await fetch(`${API}/reject`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id, admin_note: 'Rejected', provider }),
      })
      if (res.ok) {
        addToast('Topup ditolak', 'info')
        fetchTopups()
      } else {
        const data = await res.json()
        addToast(data.error || 'Gagal', 'error')
      }
    } catch { addToast('Network error', 'error') }
    setActionLoading(null)
  }

  const formatRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`

  useEffect(() => {
    fetch('/api/admin/users', { headers })
      .then((r) => r.json())
      .then((d) => setUsers(Array.isArray(d.users) ? d.users : []))
      .catch((e) => console.error('[AdminTopup] Failed to load members:', e))
  }, [headers])

  // Pratinjau saldo target setiap member/provider berubah.
  useEffect(() => {
    if (!injUserId) { setInjBalance(null); return }
    fetch(`${API}/balance/${injUserId}?provider=${injProvider}`, { headers })
      .then((r) => r.json())
      .then((d) => setInjBalance(Number(d.balance) || 0))
      .catch(() => setInjBalance(null))
  }, [injUserId, injProvider, headers, API])

  const filteredUsers = useMemo(() => {
    const q = injUserFilter.toLowerCase().trim()
    const list = q ? users.filter((u) => `${u.email} ${u.name || ''}`.toLowerCase().includes(q)) : users
    return list.slice(0, 80)
  }, [users, injUserFilter])

  const handleInject = async () => {
    const amount = Math.round(Number(injAmount))
    if (!injUserId) { addToast('Pilih member dulu', 'warning'); return }
    if (!Number.isFinite(amount) || amount <= 0) { addToast('Nominal tidak valid', 'warning'); return }
    setInjBusy(true)
    try {
      const res = await fetch(`${API}/inject`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ user_id: Number(injUserId), provider: injProvider, amount, note: injNote }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message || 'Berhasil inject saldo', 'success')
        setInjBalance(Number(data.balance) || 0)
        setInjAmount('')
        setInjNote('')
        fetchTopups()
      } else {
        addToast(data.error || 'Gagal inject saldo', 'error')
      }
    } catch {
      addToast('Network error', 'error')
    }
    setInjBusy(false)
  }

  const injIsToken = injProvider === 'seavi'
  const injUnit = injIsToken ? 'token' : 'Rp'
  const injBalanceLabel = injBalance == null ? '—' : (injIsToken ? `${injBalance.toLocaleString('id-ID')} token` : formatRp(injBalance))

  /** Nominal utama tiap baris: token untuk Seavi, Rupiah untuk lainnya. */
  const formatCredit = (t: Topup) =>
    provider === 'seavi' ? `${Number(t.tokens) || 0} token (${formatRp(t.amount)})` : formatRp(t.amount)
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved': return <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" /> Approved</Badge>
      case 'rejected': return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Rejected</Badge>
      default: return <Badge variant="warning"><Clock className="h-3 w-3 mr-1" /> Pending</Badge>
    }
  }

  const pending = topups.filter((t) => t.status === 'pending')

  return (
    <PageContent>
      <PageHeader
        eyebrow="Admin"
        title="Approval Top Up"
        highlight={provider === 'manual' ? 'Manual' : provider === 'nexabot' ? 'NexaBot' : provider === 'seavi' ? 'Seavi' : provider === 'posbot' ? 'PosBot' : 'CreatePulse'}
        desc="Setujui atau tolak topup saldo member"
      />

      <Section title="Inject Saldo Promo" sub="Kredit saldo layanan member langsung di luar alur top-up. Hanya CreatePulse / NexaBot / PosBot (Rp) & Seavi (token) yang punya dompet member.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="mb-1 block">Cari member</Label>
            <input
              value={injUserFilter}
              onChange={(e) => setInjUserFilter(e.target.value)}
              placeholder="nama / email"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <Label className="mb-1 block">Member</Label>
            <Select
              value={injUserId}
              onChange={(e) => setInjUserId(e.target.value)}
              options={[
                { value: '', label: '— pilih member —' },
                ...filteredUsers.map((u) => ({ value: String(u.id), label: `${u.name || '(tanpa nama)'} — ${u.email}` })),
              ]}
            />
          </div>
          <div>
            <Label className="mb-1 block">Provider</Label>
            <Select
              value={injProvider}
              onChange={(e) => setInjProvider(e.target.value as 'createpulse' | 'nexabot' | 'seavi' | 'posbot')}
              options={[
                { value: 'createpulse', label: 'CreatePulse (Rp)' },
                { value: 'nexabot', label: 'NexaBot (Rp)' },
                { value: 'seavi', label: 'Seavi (token)' },
                { value: 'posbot', label: 'PosBot (Rp)' },
              ]}
            />
          </div>
          <div>
            <Label className="mb-1 block">Jumlah ({injUnit})</Label>
            <input
              type="number"
              min={1}
              value={injAmount}
              onChange={(e) => setInjAmount(e.target.value)}
              placeholder={injIsToken ? 'mis. 50' : 'mis. 100000'}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="mb-1 block">Catatan (opsional)</Label>
            <input
              value={injNote}
              onChange={(e) => setInjNote(e.target.value)}
              placeholder="mis. promo bulan ini / ganti rugi / hadiah event"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <div className="text-sm text-muted-foreground">
            {injUserId ? (
              <>Saldo {injIsToken ? 'Seavi' : injProvider === 'nexabot' ? 'NexaBot' : injProvider === 'posbot' ? 'PosBot' : 'CreatePulse'} saat ini: <b className="text-foreground">{injBalanceLabel}</b></>
            ) : (
              'Pilih member untuk melihat saldo saat ini.'
            )}
          </div>
          <Button onClick={handleInject} disabled={injBusy || !injUserId || !injAmount}>
            <Sparkles className="h-4 w-4 mr-1" />
            {injBusy ? 'Memproses…' : 'Kredit Saldo'}
          </Button>
        </div>
      </Section>

      <div className="flex gap-2 mb-4">
        <Button
          size="sm"
          variant={provider === 'createpulse' ? 'default' : 'outline'}
          onClick={() => setProvider('createpulse')}
        >
          CreatePulse
        </Button>
        <Button
          size="sm"
          variant={provider === 'nexabot' ? 'default' : 'outline'}
          onClick={() => setProvider('nexabot')}
        >
          NexaBot
        </Button>
        <Button
          size="sm"
          variant={provider === 'seavi' ? 'default' : 'outline'}
          onClick={() => setProvider('seavi')}
        >
          Seavi
        </Button>
        <Button
          size="sm"
          variant={provider === 'posbot' ? 'default' : 'outline'}
          onClick={() => setProvider('posbot')}
        >
          PosBot
        </Button>
        <Button
          size="sm"
          variant={provider === 'manual' ? 'default' : 'outline'}
          onClick={() => setProvider('manual')}
        >
          Manual
        </Button>
      </div>

      <div className="flex gap-3 mb-5">
        <Button size="sm" variant="outline" onClick={fetchTopups}>
          Pending ({pending.length})
        </Button>
        <Button size="sm" variant="outline" onClick={fetchAll}>
          Semua Riwayat
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : topups.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">Tidak ada topup</div>
      ) : (
        <Section title={`Pending Approval (${pending.length})`} sub="Topup yang perlu diverifikasi">
          <div className="space-y-3">
            {topups.map((t) => (
              <div key={t.id} className="p-4 rounded-xl border border-border bg-card/30">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {t.kind === 'unlimited'
                        ? <Sparkles className="h-4 w-4 text-primary" />
                        : <Wallet className="h-4 w-4 text-primary" />}
                      <span className="font-bold text-lg">{formatCredit(t)}</span>
                      {t.kind === 'unlimited' && (
                        <Badge variant="default">Paket {nexabotPackageName(t.package_slug, t.days || 7)}</Badge>
                      )}
                      {provider === 'seavi' && Number(t.tokens) > 0 && (
                        <Badge variant="default">Paket {t.tokens} Token</Badge>
                      )}
                      {provider === 'manual' && t.provider && (
                        <Badge variant="outline">{manualProviderLabel(t.provider)}</Badge>
                      )}
                    </div>
                    <div className="text-sm">{t.user_name} ({t.email})</div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(t.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
                    </div>
                    {t.proof_note && (
                      <div className="text-[11px] text-muted-foreground mt-1 italic">
                        Catatan: {t.proof_note}
                      </div>
                    )}
                  </div>
                  {getStatusBadge(t.status)}
                </div>
                {t.status === 'pending' && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleApprove(t.id)}
                      disabled={actionLoading === t.id}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      {actionLoading === t.id ? '...' : 'Approve'}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleReject(t.id)}
                      disabled={actionLoading === t.id}
                      className="flex-1"
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      {actionLoading === t.id ? '...' : 'Reject'}
                    </Button>
                  </div>
                )}
                {t.admin_note && t.status !== 'pending' && (
                  <div className="text-[11px] text-muted-foreground mt-2">Admin: {t.admin_note}</div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </PageContent>
  )
}
