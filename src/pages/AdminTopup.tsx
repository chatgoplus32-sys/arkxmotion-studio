import { useState, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { CheckCircle, XCircle, Clock, Wallet } from 'lucide-react'

interface Topup {
  id: number
  user_id: number
  amount: number
  status: 'pending' | 'approved' | 'rejected'
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

  const API = '/api/admin/topup'
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  useEffect(() => { fetchTopups() }, [])

  const fetchTopups = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/pending`, { headers })
      const data = await res.json()
      setTopups(data.topups || [])
    } catch {}
    setLoading(false)
  }

  const fetchAll = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/all`, { headers })
      const data = await res.json()
      setTopups(data.topups || [])
    } catch {}
    setLoading(false)
  }

  const handleApprove = async (id: number) => {
    setActionLoading(id)
    try {
      const res = await fetch(`${API}/approve`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id, admin_note: 'Approved' }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(`Topup approved — saldo ${data.balance?.toLocaleString('id-ID')}`, 'success')
        fetchTopups()
      } else {
        addToast(data.error || 'Gagal', 'error')
      }
    } catch { addToast('Network error', 'error') }
    setActionLoading(null)
  }

  const handleReject = async (id: number) => {
    setActionLoading(id)
    try {
      const res = await fetch(`${API}/reject`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id, admin_note: 'Rejected' }),
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved': return <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" /> Approved</Badge>
      case 'rejected': return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Rejected</Badge>
      default: return <Badge variant="warning"><Clock className="h-3 w-3 mr-1" /> Pending</Badge>
    }
  }

  const pending = topups.filter((t) => t.status === 'pending')
  const others = topups.filter((t) => t.status !== 'pending')

  return (
    <PageContent>
      <PageHeader
        eyebrow="Admin"
        title="Approval Top Up"
        highlight="CreatePulse"
        desc="Setujui atau tolak topup saldo member"
      />

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
                      <Wallet className="h-4 w-4 text-primary" />
                      <span className="font-bold text-lg">{formatRp(t.amount)}</span>
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
