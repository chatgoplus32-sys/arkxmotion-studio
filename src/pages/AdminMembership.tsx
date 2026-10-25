import { useState, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { DEFAULT_MEMBERSHIP_FEE_ORIGINAL, setMembershipPricingCache, formatRp } from '@/lib/membership'
import { DEFAULT_PRO_FEE, setProFeeCache } from '@/lib/pro'
import {
  Loader2,
  Wallet,
  Save,
  RefreshCw,
  Crown,
  BadgeCheck,
  Ban,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react'

interface ProPaymentRow {
  id: number
  userId: number
  amount: number
  status: 'pending' | 'approved' | 'rejected'
  proofNote: string
  adminNote: string
  createdAt: string
  email: string
  name: string
  userPlan: string
  proSince: string | null
}

function statusBadge(status: ProPaymentRow['status']) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium bg-emerald-500/10 text-emerald-500">
        <CheckCircle2 className="h-3 w-3" /> Disetujui
      </span>
    )
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium bg-red-500/10 text-red-500">
        <XCircle className="h-3 w-3" /> Ditolak
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium bg-yellow-500/10 text-yellow-500">
      <Clock className="h-3 w-3" /> Menunggu
    </span>
  )
}

export default function AdminMembershipPage() {
  const token = useAuthStore((state) => state.token)
  const addToast = useToastStore((state) => state.addToast)
  const [currentFee, setCurrentFee] = useState<number | null>(null)
  const [feeInput, setFeeInput] = useState('')
  const [originalFeeInput, setOriginalFeeInput] = useState('')
  const [currentProFee, setCurrentProFee] = useState<number | null>(null)
  const [proFeeInput, setProFeeInput] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingPro, setSavingPro] = useState(false)
  const [payments, setPayments] = useState<ProPaymentRow[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<number | null>(null)

  const fetchConfig = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    try {
      const response = await fetch('/api/admin/membership/config', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        const data = await response.json()
        const originalFee = Number(data.membershipFeeOriginal) > 0
          ? Number(data.membershipFeeOriginal)
          : DEFAULT_MEMBERSHIP_FEE_ORIGINAL
        setCurrentFee(data.membershipFee)
        setFeeInput(String(data.membershipFee))
        setOriginalFeeInput(String(originalFee))
        setMembershipPricingCache({ fee: Number(data.membershipFee), originalFee })
        const proFee = Number(data.proFee) > 0 ? Number(data.proFee) : DEFAULT_PRO_FEE
        setCurrentProFee(proFee)
        setProFeeInput(String(proFee))
        setProFeeCache(proFee)
      } else {
        addToast('Gagal memuat konfigurasi membership', 'error')
      }
    } catch {
      addToast('Gagal memuat konfigurasi membership', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [token, addToast])

  const fetchPayments = useCallback(async () => {
    if (!token) return
    setPaymentsLoading(true)
    try {
      const response = await fetch('/api/admin/pro/payments', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        const data = await response.json()
        setPayments(data.payments || [])
      } else {
        addToast('Gagal memuat antrian upgrade Pro', 'error')
      }
    } catch {
      addToast('Gagal memuat antrian upgrade Pro', 'error')
    } finally {
      setPaymentsLoading(false)
    }
  }, [token, addToast])

  useEffect(() => {
    fetchConfig()
    fetchPayments()
  }, [fetchConfig, fetchPayments])

  const handleSave = async () => {
    const fee = Number(feeInput)
    const originalFee = Number(originalFeeInput)
    if (!Number.isFinite(fee) || fee <= 0 || !Number.isFinite(originalFee) || originalFee <= 0) {
      addToast('Nominal harus angka lebih dari 0', 'error')
      return
    }
    if (originalFee < fee) {
      addToast('Harga normal (referensi) tidak boleh lebih kecil dari harga join', 'error')
      return
    }
    if (!token) return
    setSaving(true)
    try {
      const response = await fetch('/api/admin/membership/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ membershipFee: fee, membershipFeeOriginal: originalFee })
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        setCurrentFee(fee)
        setMembershipPricingCache({ fee, originalFee })
        addToast(data.message || `Harga join diubah menjadi ${formatRp(fee)}`, 'success')
      } else {
        addToast(data.error || 'Gagal menyimpan harga', 'error')
      }
    } catch {
      addToast('Gagal menyimpan harga', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleSavePro = async () => {
    const fee = Number(proFeeInput)
    if (!Number.isFinite(fee) || fee <= 0) {
      addToast('Nominal harus angka lebih dari 0', 'error')
      return
    }
    if (!token) return
    setSavingPro(true)
    try {
      const response = await fetch('/api/admin/membership/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ proFee: fee })
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        setCurrentProFee(fee)
        setProFeeCache(fee)
        addToast(data.message || `Harga Pro diubah menjadi ${formatRp(fee)}`, 'success')
      } else {
        addToast(data.error || 'Gagal menyimpan harga Pro', 'error')
      }
    } catch {
      addToast('Gagal menyimpan harga Pro', 'error')
    } finally {
      setSavingPro(false)
    }
  }

  const handleApprove = async (payment: ProPaymentRow) => {
    if (!token) return
    if (!confirm(`Setujui upgrade Pro ${payment.email}? Akun akan langsung jadi Pro.`)) return
    setActionLoading(payment.id)
    try {
      const response = await fetch(`/api/admin/pro/payments/${payment.id}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        addToast(data.message || 'Upgrade Pro disetujui', 'success')
        fetchPayments()
      } else {
        addToast(data.error || 'Gagal menyetujui upgrade Pro', 'error')
      }
    } catch {
      addToast('Gagal menyetujui upgrade Pro', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleReject = async (payment: ProPaymentRow) => {
    if (!token) return
    const note = prompt(`Tolak upgrade Pro ${payment.email}? Alasan (opsional):`)
    if (note === null) return
    setActionLoading(payment.id)
    try {
      const response = await fetch(`/api/admin/pro/payments/${payment.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ admin_note: note || '' })
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        addToast(data.message || 'Upgrade Pro ditolak', 'success')
        fetchPayments()
      } else {
        addToast(data.error || 'Gagal menolak upgrade Pro', 'error')
      }
    } catch {
      addToast('Gagal menolak upgrade Pro', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const pendingCount = payments.filter((p) => p.status === 'pending').length

  return (
    <div>
      <PageHeader
        title="Membership & Pro"
        desc="Atur harga pendaftaran member & upgrade Pro, serta setujui pembayaran upgrade."
      />
      <PageContent>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Section title="Harga Join Pro" sub="Biaya join member baru — approval otomatis mengaktifkan Pro (semua fitur AI)">
            <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary/50 border border-border mb-4">
              <div className="h-10 w-10 rounded-lg brand-gradient flex items-center justify-center">
                <Wallet className="h-5 w-5 text-black" />
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Harga join saat ini</div>
                {isLoading ? (
                  <div className="text-sm text-muted-foreground">Memuat...</div>
                ) : (
                  <div className="text-lg font-bold brand-text">{currentFee != null ? formatRp(currentFee) : '—'}</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <label htmlFor="fee-original" className="block text-sm font-medium text-muted-foreground mb-1.5">
                  Harga normal (referensi internal)
                </label>
                <input
                  id="fee-original"
                  type="number"
                  min="1"
                  value={originalFeeInput}
                  onChange={(e) => setOriginalFeeInput(e.target.value)}
                  placeholder="mis. 350000"
                  disabled={isLoading}
                  className="w-full px-4 py-2.5 bg-secondary border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors disabled:opacity-50"
                />
              </div>
              <div>
                <label htmlFor="fee" className="block text-sm font-medium text-muted-foreground mb-1.5">
                  Harga join / dibayar (Rp)
                </label>
                <input
                  id="fee"
                  type="number"
                  min="1"
                  value={feeInput}
                  onChange={(e) => setFeeInput(e.target.value)}
                  placeholder="mis. 250000"
                  disabled={isLoading}
                  className="w-full px-4 py-2.5 bg-secondary border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors disabled:opacity-50"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={handleSave} disabled={saving || isLoading}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Simpan Harga Join
              </Button>
              <Button variant="outline" onClick={fetchConfig} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mt-4">
              Dipakai di halaman <b>Sign Up</b> dan pesan WhatsApp ke admin. Member baru otomatis menjadi Pro setelah pembayaran disetujui.
            </p>
          </Section>

          <Section title="Harga Upgrade Pro" sub="Khusus member lama — sekali bayar, membuka Gemini Tools, AI Song Cover & H3 Music Avatar">
            <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary/50 border border-border mb-4">
              <div className="h-10 w-10 rounded-lg brand-gradient flex items-center justify-center">
                <Crown className="h-5 w-5 text-black" />
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Harga saat ini</div>
                {isLoading ? (
                  <div className="text-sm text-muted-foreground">Memuat...</div>
                ) : (
                  <div className="text-lg font-bold brand-text">{currentProFee != null ? formatRp(currentProFee) : '—'}</div>
                )}
              </div>
            </div>

            <label htmlFor="pro-fee" className="block text-sm font-medium text-muted-foreground mb-1.5">
              Harga Pro baru (Rp)
            </label>
            <input
              id="pro-fee"
              type="number"
              min="1"
              value={proFeeInput}
              onChange={(e) => setProFeeInput(e.target.value)}
              placeholder="mis. 50000"
              disabled={isLoading}
              className="w-full px-4 py-2.5 bg-secondary border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors disabled:opacity-50 mb-4"
            />

            <div className="flex items-center gap-2">
              <Button onClick={handleSavePro} disabled={savingPro || isLoading}>
                {savingPro ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Simpan Harga Pro
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mt-4">
              Dipakai di halaman <b>Upgrade Pro</b> dan gerbang tiga fitur premium (Gemini Tools, AI Song Cover, H3 Music Avatar). Nominal pembayaran selalu diambil dari server.
            </p>
          </Section>
        </div>

        <Section
          title="Antrian Upgrade Pro"
          sub={pendingCount > 0 ? `${pendingCount} pembayaran menunggu approval` : 'Tidak ada pembayaran yang menunggu'}
          right={
            <Button variant="outline" size="sm" onClick={fetchPayments} disabled={paymentsLoading}>
              <RefreshCw className={`h-3.5 w-3.5 ${paymentsLoading ? 'animate-spin' : ''}`} /> Muat Ulang
            </Button>
          }
        >
          {paymentsLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Memuat antrian...
            </div>
          ) : payments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Belum ada pengajuan upgrade Pro.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">User</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Nominal</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Catatan</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Tanggal</th>
                    <th className="text-right py-3 px-3 font-medium text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-border hover:bg-secondary/50">
                      <td className="py-3 px-3">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.email}</div>
                      </td>
                      <td className="py-3 px-3 font-mono text-xs">{formatRp(p.amount)}</td>
                      <td className="py-3 px-3">
                        <div className="flex flex-col items-start gap-1">
                          {statusBadge(p.status)}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${p.userPlan === 'pro' ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                            akun: {p.userPlan}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-xs text-muted-foreground max-w-[220px]">
                        {p.proofNote || '—'}
                        {p.adminNote && <div className="text-red-400 mt-1">Admin: {p.adminNote}</div>}
                      </td>
                      <td className="py-3 px-3 text-xs text-muted-foreground">
                        {new Date(p.createdAt.includes('T') ? p.createdAt : p.createdAt.replace(' ', 'T')).toLocaleDateString('id-ID')}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {p.status === 'pending' ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              onClick={() => handleApprove(p)}
                              disabled={actionLoading === p.id}
                              className="bg-emerald-500 hover:bg-emerald-600 text-white"
                            >
                              <BadgeCheck className="h-3.5 w-3.5" /> Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReject(p)}
                              disabled={actionLoading === p.id}
                              className="text-red-500 hover:bg-red-500/10"
                            >
                              <Ban className="h-3.5 w-3.5" /> Tolak
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
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
    </div>
  )
}
