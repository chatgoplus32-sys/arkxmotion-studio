import { useState, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { setMembershipFeeCache, formatRp } from '@/lib/membership'
import { Loader2, Wallet, Save, RefreshCw } from 'lucide-react'

export default function AdminMembershipPage() {
  const token = useAuthStore((state) => state.token)
  const addToast = useToastStore((state) => state.addToast)
  const [currentFee, setCurrentFee] = useState<number | null>(null)
  const [feeInput, setFeeInput] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchConfig = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    try {
      const response = await fetch('/api/admin/membership/config', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        const data = await response.json()
        setCurrentFee(data.membershipFee)
        setFeeInput(String(data.membershipFee))
        setMembershipFeeCache(data.membershipFee)
      } else {
        addToast('Gagal memuat konfigurasi membership', 'error')
      }
    } catch {
      addToast('Gagal memuat konfigurasi membership', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [token, addToast])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const handleSave = async () => {
    const fee = Number(feeInput)
    if (!Number.isFinite(fee) || fee <= 0) {
      addToast('Nominal harus angka lebih dari 0', 'error')
      return
    }
    if (!token) return
    setSaving(true)
    try {
      const response = await fetch('/api/admin/membership/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ membershipFee: fee })
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        setCurrentFee(fee)
        setMembershipFeeCache(fee)
        addToast(data.message || `Harga membership diubah menjadi ${formatRp(fee)}`, 'success')
      } else {
        addToast(data.error || 'Gagal menyimpan harga', 'error')
      }
    } catch {
      addToast('Gagal menyimpan harga', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Membership"
        desc="Atur harga pendaftaran member (tampil di halaman Sign Up & Cek Status)"
      />
      <PageContent>
        <Section title="Harga Membership" sub="Biaya pendaftaran member baru yang dibayar via QRIS">
          <div className="max-w-md">
            <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary/50 border border-border mb-4">
              <div className="h-10 w-10 rounded-lg gold-gradient flex items-center justify-center">
                <Wallet className="h-5 w-5 text-black" />
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Harga saat ini</div>
                {isLoading ? (
                  <div className="text-sm text-muted-foreground">Memuat...</div>
                ) : (
                  <div className="text-lg font-bold gold-text">{currentFee != null ? formatRp(currentFee) : '—'}</div>
                )}
              </div>
            </div>

            <label htmlFor="fee" className="block text-sm font-medium text-muted-foreground mb-1.5">
              Harga baru (Rp)
            </label>
            <input
              id="fee"
              type="number"
              min="1"
              value={feeInput}
              onChange={(e) => setFeeInput(e.target.value)}
              placeholder="mis. 150000"
              disabled={isLoading}
              className="w-full px-4 py-2.5 bg-secondary border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors disabled:opacity-50 mb-4"
            />

            <div className="flex items-center gap-2">
              <Button onClick={handleSave} disabled={saving || isLoading}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Simpan Harga
              </Button>
              <Button variant="outline" onClick={fetchConfig} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mt-4">
              Harga ini langsung dipakai di halaman <b>Sign Up</b> (form Konfirmasi Pembayaran QRIS) dan
              pesan WhatsApp otomatis ke admin. Perubahan berlaku seketika untuk semua user baru.
            </p>
          </div>
        </Section>
      </PageContent>
    </div>
  )
}
