import { useState, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { DEFAULT_MEMBERSHIP_FEE_ORIGINAL, setMembershipPricingCache, formatRp } from '@/lib/membership'
import { DEFAULT_PRO_FEE, setProFeeCache } from '@/lib/pro'
import { DEFAULT_ADDON_FEE, ADDON_ACCOUNTS_PER_PERIOD, setAddonFeeCache, type AddonAccount } from '@/lib/addon'
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
  MailPlus,
  KeyRound,
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

interface AddonPaymentRow {
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
  periodStart: string | null
  periodEnd: string | null
  accounts: AddonAccount[]
  accountsCount: number
}

/** Parse textarea "email|password|catatan" per baris → daftar akun. */
function parseAccountsText(text: string): AddonAccount[] {
  const out: AddonAccount[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const [emailRaw, passwordRaw, ...noteParts] = line.split('|')
    const email = (emailRaw || '').trim()
    const password = (passwordRaw || '').trim()
    const note = noteParts.join('|').trim()
    if (!email || !email.includes('@')) continue
    out.push(note ? { email, password, note } : { email, password })
  }
  return out
}

function accountsToText(accounts: AddonAccount[]): string {
  return accounts.map((a) => [a.email, a.password, a.note ?? ''].join('|')).join('\n')
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
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
  const [currentAddonFee, setCurrentAddonFee] = useState<number | null>(null)
  const [addonFeeInput, setAddonFeeInput] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingPro, setSavingPro] = useState(false)
  const [savingAddon, setSavingAddon] = useState(false)
  const [payments, setPayments] = useState<ProPaymentRow[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [addonPayments, setAddonPayments] = useState<AddonPaymentRow[]>([])
  const [addonPaymentsLoading, setAddonPaymentsLoading] = useState(true)
  const [addonActionLoading, setAddonActionLoading] = useState<number | null>(null)
  // Inline panel untuk approval / serah-akun: id payment yang sedang dibuka.
  const [approveTargetId, setApproveTargetId] = useState<number | null>(null)
  const [accountsTargetId, setAccountsTargetId] = useState<number | null>(null)
  const [accountsText, setAccountsText] = useState('')

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
        const addonFee = Number(data.addonFee) > 0 ? Number(data.addonFee) : DEFAULT_ADDON_FEE
        setCurrentAddonFee(addonFee)
        setAddonFeeInput(String(addonFee))
        setAddonFeeCache(addonFee)
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

  const fetchAddonPayments = useCallback(async () => {
    if (!token) return
    setAddonPaymentsLoading(true)
    try {
      const response = await fetch('/api/admin/addon/payments', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        const data = await response.json()
        setAddonPayments(data.payments || [])
      } else {
        addToast('Gagal memuat antrian Add-on Akun', 'error')
      }
    } catch {
      addToast('Gagal memuat antrian Add-on Akun', 'error')
    } finally {
      setAddonPaymentsLoading(false)
    }
  }, [token, addToast])

  useEffect(() => {
    fetchConfig()
    fetchPayments()
    fetchAddonPayments()
  }, [fetchConfig, fetchPayments, fetchAddonPayments])

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

  const handleSaveAddon = async () => {
    const fee = Number(addonFeeInput)
    if (!Number.isFinite(fee) || fee <= 0) {
      addToast('Nominal harus angka lebih dari 0', 'error')
      return
    }
    if (!token) return
    setSavingAddon(true)
    try {
      const response = await fetch('/api/admin/membership/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ addonFee: fee })
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        setCurrentAddonFee(fee)
        setAddonFeeCache(fee)
        addToast(data.message || `Harga Add-on Akun diubah menjadi ${formatRp(fee)}`, 'success')
      } else {
        addToast(data.error || 'Gagal menyimpan harga Add-on Akun', 'error')
      }
    } catch {
      addToast('Gagal menyimpan harga Add-on Akun', 'error')
    } finally {
      setSavingAddon(false)
    }
  }

  const openApprovePanel = (payment: AddonPaymentRow) => {
    setAccountsTargetId(null)
    setApproveTargetId(payment.id)
    setAccountsText('')
  }

  const openAccountsPanel = (payment: AddonPaymentRow) => {
    setApproveTargetId(null)
    setAccountsTargetId(payment.id)
    setAccountsText(payment.accounts?.length ? accountsToText(payment.accounts) : '')
  }

  const closeAccountsPanel = () => {
    setApproveTargetId(null)
    setAccountsTargetId(null)
    setAccountsText('')
  }

  const handleApproveAddon = async (payment: AddonPaymentRow, withAccounts: boolean) => {
    if (!token) return
    const accounts = withAccounts ? parseAccountsText(accountsText) : []
    if (withAccounts && accounts.length === 0) {
      addToast('Minimal 1 akun dengan email valid (email|password)', 'error')
      return
    }
    setAddonActionLoading(payment.id)
    try {
      const response = await fetch(`/api/admin/addon/payments/${payment.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(withAccounts ? { accounts } : {})
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        addToast(data.message || 'Add-on Akun disetujui', 'success')
        closeAccountsPanel()
        fetchAddonPayments()
      } else {
        addToast(data.error || 'Gagal menyetujui Add-on Akun', 'error')
      }
    } catch {
      addToast('Gagal menyetujui Add-on Akun', 'error')
    } finally {
      setAddonActionLoading(null)
    }
  }

  const handleRejectAddon = async (payment: AddonPaymentRow) => {
    if (!token) return
    const note = prompt(`Tolak Add-on Akun ${payment.email}? Alasan (opsional):`)
    if (note === null) return
    setAddonActionLoading(payment.id)
    try {
      const response = await fetch(`/api/admin/addon/payments/${payment.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ admin_note: note || '' })
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        addToast(data.message || 'Add-on Akun ditolak', 'success')
        fetchAddonPayments()
      } else {
        addToast(data.error || 'Gagal menolak Add-on Akun', 'error')
      }
    } catch {
      addToast('Gagal menolak Add-on Akun', 'error')
    } finally {
      setAddonActionLoading(null)
    }
  }

  const handleSaveAccounts = async (payment: AddonPaymentRow) => {
    if (!token) return
    const accounts = parseAccountsText(accountsText)
    if (accounts.length === 0) {
      addToast('Minimal 1 akun dengan email valid (email|password)', 'error')
      return
    }
    setAddonActionLoading(payment.id)
    try {
      const response = await fetch(`/api/admin/addon/payments/${payment.id}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ accounts })
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        addToast(data.message || 'Akun tersimpan', 'success')
        closeAccountsPanel()
        fetchAddonPayments()
      } else {
        addToast(data.error || 'Gagal menyimpan akun', 'error')
      }
    } catch {
      addToast('Gagal menyimpan akun', 'error')
    } finally {
      setAddonActionLoading(null)
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
  const addonPendingCount = addonPayments.filter((p) => p.status === 'pending').length

  return (
    <div>
      <PageHeader
        title="Membership & Add-on"
        desc="Atur harga pendaftaran member, upgrade Pro, dan Add-on Akun (3 akun email siap pakai / 30 hari) — serta setujui pembayarannya."
      />
      <PageContent>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
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

          <Section title="Harga Upgrade Pro" sub="Khusus member lama — sekali bayar, membuka ARKX AUTO Studio, ARKX AUTO Motion, Gemini Tools, AI Song Cover & H3 Music Avatar">
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
              Dipakai di halaman <b>Upgrade Pro</b> dan gerbang lima fitur premium (ARKX AUTO Studio, ARKX AUTO Motion, Gemini Tools, AI Song Cover, H3 Music Avatar). Nominal pembayaran selalu diambil dari server.
            </p>
          </Section>

          <Section title="Harga Add-on Akun" sub="Khusus member — tambah 3 akun email siap pakai setiap 30 hari">
            <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary/50 border border-border mb-4">
              <div className="h-10 w-10 rounded-lg brand-gradient flex items-center justify-center">
                <MailPlus className="h-5 w-5 text-black" />
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Harga saat ini</div>
                {isLoading ? (
                  <div className="text-sm text-muted-foreground">Memuat...</div>
                ) : (
                  <div className="text-lg font-bold brand-text">{currentAddonFee != null ? formatRp(currentAddonFee) : '—'}</div>
                )}
              </div>
            </div>

            <label htmlFor="addon-fee" className="block text-sm font-medium text-muted-foreground mb-1.5">
              Harga Add-on Akun baru (Rp)
            </label>
            <input
              id="addon-fee"
              type="number"
              min="1"
              value={addonFeeInput}
              onChange={(e) => setAddonFeeInput(e.target.value)}
              placeholder="mis. 100000"
              disabled={isLoading}
              className="w-full px-4 py-2.5 bg-secondary border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors disabled:opacity-50 mb-4"
            />

            <div className="flex items-center gap-2">
              <Button onClick={handleSaveAddon} disabled={savingAddon || isLoading}>
                {savingAddon ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Simpan Harga Add-on
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mt-4">
              Dipakai di halaman <b>Add-on Akun</b> (menu Lainnya). Member yang sudah aktif bisa membeli berulang untuk perpanjangan 30 hari; approval menambah masa aktif dari expiry terakhir. Nominal pembayaran selalu diambil dari server.
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

        <Section
          title="Antrian Add-on Akun"
          sub={addonPendingCount > 0 ? `${addonPendingCount} pembayaran menunggu approval — serahkan ${ADDON_ACCOUNTS_PER_PERIOD} akun email setelah disetujui` : 'Tidak ada pembayaran yang menunggu'}
          right={
            <Button variant="outline" size="sm" onClick={fetchAddonPayments} disabled={addonPaymentsLoading}>
              <RefreshCw className={`h-3.5 w-3.5 ${addonPaymentsLoading ? 'animate-spin' : ''}`} /> Muat Ulang
            </Button>
          }
        >
          {addonPaymentsLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Memuat antrian...
            </div>
          ) : addonPayments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Belum ada pengajuan Add-on Akun.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">User</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Nominal</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Periode / Akun</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Catatan</th>
                    <th className="text-right py-3 px-3 font-medium text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {addonPayments.map((p) => {
                    const panelOpen = approveTargetId === p.id || accountsTargetId === p.id
                    return [
                      <tr key={p.id} className="border-b border-border hover:bg-secondary/50 align-top">
                        <td className="py-3 px-3">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.email}</div>
                        </td>
                        <td className="py-3 px-3 font-mono text-xs">{formatRp(p.amount)}</td>
                        <td className="py-3 px-3">
                          <div className="flex flex-col items-start gap-1">
                            {statusBadge(p.status)}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${p.status === 'approved' && p.accountsCount > 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-secondary text-muted-foreground'}`}>
                              akun: {p.accountsCount}/{ADDON_ACCOUNTS_PER_PERIOD}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-xs text-muted-foreground">
                          {p.status === 'approved' ? (
                            <>
                              <div>{formatDateTime(p.periodStart)} → {formatDateTime(p.periodEnd)}</div>
                            </>
                          ) : (
                            <div>{new Date(p.createdAt.includes('T') ? p.createdAt : p.createdAt.replace(' ', 'T')).toLocaleDateString('id-ID')}</div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-xs text-muted-foreground max-w-[220px]">
                          {p.proofNote || '—'}
                          {p.adminNote && <div className="text-red-400 mt-1">Admin: {p.adminNote}</div>}
                        </td>
                        <td className="py-3 px-3 text-right">
                          {p.status === 'pending' ? (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                onClick={() => openApprovePanel(p)}
                                disabled={addonActionLoading === p.id}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                              >
                                <BadgeCheck className="h-3.5 w-3.5" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRejectAddon(p)}
                                disabled={addonActionLoading === p.id}
                                className="text-red-500 hover:bg-red-500/10"
                              >
                                <Ban className="h-3.5 w-3.5" /> Tolak
                              </Button>
                            </div>
                          ) : p.status === 'approved' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openAccountsPanel(p)}
                              disabled={addonActionLoading === p.id}
                            >
                              <KeyRound className="h-3.5 w-3.5" /> Set Akun
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>,
                      panelOpen && (
                        <tr key={`${p.id}-panel`} className="border-b border-border bg-secondary/30">
                          <td colSpan={6} className="p-4">
                            <div className="max-w-2xl">
                              <div className="text-xs font-semibold text-foreground mb-1">
                                {approveTargetId === p.id ? 'Serahkan akun email (opsional)' : 'Set / ganti akun email member'}
                              </div>
                              <p className="text-[11px] text-muted-foreground mb-2">
                                Satu akun per baris dengan format <code className="font-mono">email|password|catatan</code> (catatan opsional). Maksimal {ADDON_ACCOUNTS_PER_PERIOD} akun untuk periode ini.
                              </p>
                              <textarea
                                value={accountsText}
                                onChange={(e) => setAccountsText(e.target.value)}
                                rows={4}
                                placeholder={'akun1@example.com|password123|untuk FYP\nakun2@example.com|password456\nakun3@example.com|password789'}
                                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary resize-y"
                              />
                              <div className="flex flex-wrap items-center gap-2 mt-2">
                                {approveTargetId === p.id ? (
                                  <>
                                    <Button size="sm" onClick={() => handleApproveAddon(p, true)} disabled={addonActionLoading === p.id} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                                      {addonActionLoading === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />} Approve + Kirim Akun
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => handleApproveAddon(p, false)} disabled={addonActionLoading === p.id}>
                                      Approve tanpa akun (set nanti)
                                    </Button>
                                  </>
                                ) : (
                                  <Button size="sm" onClick={() => handleSaveAccounts(p)} disabled={addonActionLoading === p.id}>
                                    {addonActionLoading === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Simpan Akun
                                  </Button>
                                )}
                                <Button size="sm" variant="outline" onClick={closeAccountsPanel} disabled={addonActionLoading === p.id}>
                                  Batal
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ),
                    ]
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </PageContent>
    </div>
  )
}
