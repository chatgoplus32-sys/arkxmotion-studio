import { useState, useCallback, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import {
  Save,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Zap,
  KeyRound,
  Trash2,
  Cookie,
  Activity,
} from 'lucide-react'

interface NexabotPackage {
  slug: string
  label: string
  price: number
  days: number
}

interface NexabotPricing {
  price: number
  unlimitedPrice: number
  unlimitedDays: number
  packages: NexabotPackage[]
}

interface NexabotPackageForm {
  slug: string
  label: string
  price: string
  days: string
}

/** Cermin katalog shared/pricing.ts — dipakai sebelum server menjawab. */
const NB_PACKAGE_FALLBACKS: NexabotPackage[] = [
  { slug: 'unlimited_weekly', label: 'Mingguan', price: 35000, days: 7 },
  { slug: 'unlimited_monthly', label: 'Bulanan', price: 119000, days: 30 },
  { slug: 'unlimited_yearly', label: 'Tahunan', price: 899000, days: 365 },
]

/** Paket dari server, atau katalog fallback kalau server belum mengirim. */
const asPackages = (packages?: NexabotPackage[]): NexabotPackage[] =>
  Array.isArray(packages) && packages.length > 0 ? packages : NB_PACKAGE_FALLBACKS

const toPackageForm = (packages?: NexabotPackage[]): NexabotPackageForm[] =>
  asPackages(packages).map((p) => ({
    slug: p.slug,
    label: p.label,
    price: String(p.price),
    days: String(p.days),
  }))

interface AppSettings {
  [key: string]: string
}

interface MasterKeyStatus {
  configured: boolean
  source: 'database' | 'env' | 'none'
  mode: 'off' | 'unlimited' | 'unlimited-or-balance'
  daily_cap: number
  /** Nilai tersimpan berbentuk cookie sesi, jadi diabaikan sebagai API key. */
  looks_like_cookie?: boolean
}

/** Hasil probe `POST /api/admin/nexabot/master-key/check`. */
interface MasterKeyCheck {
  ok: boolean
  valid: boolean
  status: number | null
  credit: number | null
  telegram_id: string | null
  transient?: boolean
  error?: string
}

interface MasterCookieStatus {
  configured: boolean
  source: 'database' | 'none'
  mode: 'off' | 'unlimited' | 'unlimited-or-balance'
  daily_cap: number
}

/** Hasil probe `POST /api/admin/nexabot/master-cookie/check`. */
interface MasterCookieCheck {
  ok: boolean
  active: boolean
  unlimited: boolean
  plan: string | null
  until: string | null
  balance: number | null
  email: string | null
  telegram_id: string | null
  status: number | null
  transient?: boolean
  error?: string
}

interface Maintenance {
  provider: string
  is_maintenance: boolean
  message: string
}

const ALL_PROVIDERS = [
  'weavy', 'wavespeed', 'magnific', 'roboneo', 'createpulse',
  'framia', 'firefly', 'leonardo', 'oneover', 'gemini', 'riverside',
]

// ─── Kunci server Alriz / Seavi ────────────────────────────────────────
// Pola yang sama dengan NexaBot: relay memasang kunci ini untuk member yang
// sudah top up. Server hanya melaporkan status — nilainya tidak pernah dikirim
// balik ke browser, jadi input selalu kosong dan hanya diisi saat mengganti.

interface ProviderKeyStatus {
  configured: boolean
  source: 'database' | 'env' | 'none'
}

interface ProviderKeyCheck {
  ok: boolean
  valid: boolean
  status: number | null
  detail?: string
  transient?: boolean
  error?: string
}

function ProviderServerKeySection({
  provider,
  label,
  token,
  addToast,
}: {
  provider: 'alriz' | 'seavi'
  label: string
  token: string | null
  addToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void
}) {
  const [status, setStatus] = useState<ProviderKeyStatus | null>(null)
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<ProviderKeyCheck | null>(null)

  const applyStatus = (data: any) => {
    setStatus({
      configured: !!data.configured,
      source: data.source ?? 'none',
    })
  }

  const fetchStatus = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`/api/admin/${provider}/master-key`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      applyStatus(await res.json())
    } catch { /* biarkan status lama kalau request gagal */ }
  }, [token, provider])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const handleCheck = async () => {
    if (!token) return
    setChecking(true)
    try {
      const res = await fetch(`/api/admin/${provider}/master-key/check`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok && data.check) setCheck(data.check as ProviderKeyCheck)
      else addToast(data.error || `Gagal memeriksa kunci server ${label}`, 'error')
    } catch {
      addToast(`Gagal memeriksa kunci server ${label}`, 'error')
    } finally {
      setChecking(false)
    }
  }

  const handleSave = async () => {
    if (!token || !input.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/${provider}/master-key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ apiKey: input.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message || `Kunci server ${label} disimpan`, 'success')
        applyStatus(data)
        setCheck(null)
        setInput('')
        // Buktikan kuncinya diterima upstream — kunci salah tidak boleh
        // terlihat "Aktif" tanpa peringatan.
        await handleCheck()
      } else {
        addToast(data.error || `Gagal menyimpan kunci server ${label}`, 'error')
      }
    } catch {
      addToast(`Gagal menyimpan kunci server ${label}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    if (!token) return
    if (!window.confirm(`Hapus kunci server ${label} dari dashboard? Member tanpa API key sendiri tidak bisa generate sampai kunci baru disimpan (atau .env dipakai kembali).`)) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/${provider}/master-key`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message || `Kunci server ${label} dihapus`, 'success')
        applyStatus(data)
        setCheck(null)
      } else {
        addToast(data.error || `Gagal menghapus kunci server ${label}`, 'error')
      }
    } catch {
      addToast(`Gagal menghapus kunci server ${label}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title={`Kunci Server ${label}`}
      sub={`Dipakai relay untuk member yang sudah top up — disimpan di server, tidak pernah dikirim ke browser`}
    >
      <div className="rounded-xl border border-border bg-card/40 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Status:</span>
          {status?.configured ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] text-emerald-400">
              <CheckCircle className="h-3 w-3" />
              Aktif — {status.source === 'database' ? 'dari dashboard' : 'dari .env'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 text-[11px] text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              Belum diatur — member tanpa API key sendiri tidak bisa generate
            </span>
          )}
        </div>

        <p className="mt-2 text-[12px] text-muted-foreground leading-relaxed">
          Member yang sudah top up {label} generate tanpa API key sendiri: relay yang memasang kunci ini, dan
          saldo/token mereka yang dipotong. Untuk request yang membuat job, relay juga mewajibkan tiket
          pembayaran dari wallet app, jadi satu potongan tidak bisa dipakai lebih dari job yang dibayar.
          Kunci tidak pernah ditampilkan lagi dan tidak pernah dikirim ke browser. Isi kolom untuk mengganti
          kunci — nilai lama langsung tidak berlaku.
        </p>

        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Tempel API key ${label}`}
            autoComplete="off"
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-sm font-mono"
          />
          <Button size="sm" onClick={handleSave} disabled={saving || !input.trim()}>
            <KeyRound className={`h-4 w-4 mr-2 ${saving ? 'animate-pulse' : ''}`} />
            {saving ? 'Menyimpan...' : 'Simpan Kunci'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleClear}
            disabled={saving || !status?.configured || status?.source === 'env'}
            title={status?.source === 'env' ? 'Kunci berasal dari .env — hapus variabelnya di server' : undefined}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Hapus
          </Button>
          <Button size="sm" variant="outline" onClick={handleCheck} disabled={checking || !status?.configured}>
            <Activity className={`h-4 w-4 mr-2 ${checking ? 'animate-pulse' : ''}`} />
            {checking ? 'Memeriksa...' : 'Cek Kunci'}
          </Button>
        </div>

        {check && (
          <div
            className={`mt-3 rounded-lg border px-3 py-2 text-[12px] leading-relaxed ${
              check.valid
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : check.transient
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-300'
            }`}
          >
            <span className="font-medium">
              {check.valid
                ? `Kunci diterima (HTTP ${check.status})`
                : check.transient
                  ? 'Cek gagal sementara'
                  : 'Kunci ditolak'}
            </span>
            {check.valid && check.detail && <span className="ml-2 opacity-80">{check.detail}</span>}
            {check.error && <div className="mt-1">{check.error}</div>}
          </div>
        )}

        <div className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
          Urutan yang dipakai server: kunci dashboard → <code>{`${provider.toUpperCase()}_MASTER_API_KEY`}</code> di .env
          → tidak tersedia. Admin tidak dipotong; member wajib punya saldo/token atau baru saja membayar.
        </div>
      </div>
    </Section>
  )
}

// ─── Pool akun NexaBot ────────────────────────────────────────────────
// Satu akun hanya boleh menjalankan satu job. Menambah akun di sini berarti
// menambah lane: relay memilih akun yang sedang kosong, jadi dua job bisa jalan
// bersamaan. Server hanya mengirim ringkasan (ada kunci / ada sesi) — nilai
// rahasianya tidak pernah kembali ke browser.

interface PoolAccount {
  id: string
  label: string
  has_key: boolean
  has_cookie: boolean
  legacy: boolean
}

interface PoolCheckView {
  ok: boolean
  transient?: boolean
  text: string
  detail?: string
}

function NexabotAccountPoolSection({
  token,
  addToast,
  refreshSignal,
}: {
  token: string | null
  addToast: (message: string, type: 'success' | 'error' | 'info') => void
  /** Berubah saat kunci/sesi akun utama disimpan — daftar ikut diperbarui. */
  refreshSignal: string
}) {
  const [accounts, setAccounts] = useState<PoolAccount[]>([])
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [cookie, setCookie] = useState('')
  const [saving, setSaving] = useState(false)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [checks, setChecks] = useState<Record<string, PoolCheckView>>({})
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAccounts = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/nexabot/master-accounts', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = await res.json()
      setAccounts(Array.isArray(data.accounts) ? data.accounts : [])
    } catch { /* biarkan daftar lama kalau request gagal */ } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchAccounts() }, [fetchAccounts, refreshSignal])

  const handleAdd = async () => {
    if (!token || saving) return
    if (!apiKey.trim() && !cookie.trim()) {
      addToast('Isi minimal satu: API key atau cookie sesi', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/nexabot/master-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ label: label.trim(), apiKey: apiKey.trim(), cookie: cookie.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(`Akun "${data.account?.label || 'baru'}" ditambahkan`, 'success')
        setLabel('')
        setApiKey('')
        setCookie('')
        setAccounts(Array.isArray(data.accounts) ? data.accounts : [])
      } else {
        addToast(data.error || 'Gagal menambah akun', 'error')
      }
    } catch {
      addToast('Gagal menambah akun', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (akun: PoolAccount) => {
    if (!token || deletingId) return
    if (!window.confirm(`Hapus akun "${akun.label}" dari pool? Job yang sedang berjalan di akun ini tetap jalan, tapi tidak ada submit baru yang diarahkan ke sana.`)) return
    setDeletingId(akun.id)
    try {
      const res = await fetch(`/api/admin/nexabot/master-accounts/${akun.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok) {
        addToast(`Akun "${akun.label}" dihapus`, 'success')
        setAccounts(Array.isArray(data.accounts) ? data.accounts : [])
        setChecks((prev) => {
          const next = { ...prev }
          delete next[akun.id]
          return next
        })
      } else {
        addToast(data.error || 'Gagal menghapus akun', 'error')
      }
    } catch {
      addToast('Gagal menghapus akun', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  const handleCheck = async (akun: PoolAccount) => {
    if (!token || checkingId) return
    setCheckingId(akun.id)
    try {
      const res = await fetch(`/api/admin/nexabot/master-accounts/${akun.id}/check`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok && data.check) {
        const check = data.check as any
        const hasil: PoolCheckView = data.kind === 'cookie'
          ? {
              ok: !!check.ok,
              transient: !!check.transient,
              text: check.ok
                ? check.unlimited
                  ? 'Sesi valid — Unlimited aktif'
                  : 'Sesi valid, tapi Unlimited tidak terdeteksi'
                : check.transient
                  ? 'Cek gagal sementara'
                  : 'Sesi ditolak',
              detail: check.error || [check.plan, check.until, check.email].filter(Boolean).join(' · ') || undefined,
            }
          : {
              ok: !!check.valid,
              transient: !!check.transient,
              text: check.valid ? `Kunci diterima (HTTP ${check.status})` : check.transient ? 'Cek gagal sementara' : 'Kunci ditolak',
              detail: check.error || undefined,
            }
        setChecks((prev) => ({ ...prev, [akun.id]: hasil }))
      } else {
        addToast(data.error || 'Gagal memeriksa akun', 'error')
      }
    } catch {
      addToast('Gagal memeriksa akun', 'error')
    } finally {
      setCheckingId(null)
    }
  }

  return (
    <Section
      title="Akun NexaBot Tambahan"
      sub="Satu akun = satu lane. Tambah akun kedua dst. supaya beberapa generate bisa berjalan bersamaan"
    >
      <div className="rounded-xl border border-border bg-card/40 p-4">
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          NexaBot hanya mengizinkan <span className="font-medium text-foreground">satu job berjalan per akun</span>.
          Relay memilih akun yang sedang kosong setiap kali ada submit, jadi N akun di sini berarti N job bisa
          paralel. Akun dicoba lewat sesi cookie lebih dulu; kalau tidak ada, lewat API key. Nilai kunci/sesi
          tidak pernah ditampilkan lagi dan tidak pernah dikirim ke browser.
        </p>

        {loading && accounts.length === 0 ? (
          <div className="mt-3 text-[12px] text-muted-foreground">Memuat daftar akun…</div>
        ) : accounts.length === 0 ? (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300">
            Belum ada akun server. Isi Kunci Server / Sesi Unlimited di atas, atau tambahkan akun di bawah.
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-border/60 rounded-lg border border-border">
            {accounts.map((akun) => {
              const hasil = checks[akun.id]
              return (
                <li key={akun.id} className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{akun.label}</span>
                    {akun.legacy && (
                      <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
                        akun utama
                      </span>
                    )}
                    {akun.has_cookie && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
                        <Cookie className="h-3 w-3" />
                        Sesi
                      </span>
                    )}
                    {akun.has_key && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-400">
                        <KeyRound className="h-3 w-3" />
                        Kunci
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCheck(akun)}
                        disabled={!!checkingId}
                      >
                        <Activity className={`h-3.5 w-3.5 mr-1.5 ${checkingId === akun.id ? 'animate-pulse' : ''}`} />
                        {checkingId === akun.id ? 'Memeriksa...' : 'Cek'}
                      </Button>
                      {!akun.legacy && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDelete(akun)}
                          disabled={!!deletingId}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                          {deletingId === akun.id ? 'Menghapus...' : 'Hapus'}
                        </Button>
                      )}
                    </span>
                  </div>

                  {hasil && (
                    <div
                      className={`mt-2 rounded-lg border px-3 py-1.5 text-[11px] leading-relaxed ${
                        hasil.ok
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : hasil.transient
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                            : 'border-red-500/30 bg-red-500/10 text-red-300'
                      }`}
                    >
                      <span className="font-medium">{hasil.text}</span>
                      {hasil.detail && <span className="ml-2 opacity-80">{hasil.detail}</span>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <div className="mt-4 border-t border-border/60 pt-3">
          <div className="text-[12px] font-medium">Tambah akun</div>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Nama akun (mis. Akun 2 — tim A)"
              autoComplete="off"
              maxLength={40}
              className="px-3 py-2 rounded-lg border border-border bg-card text-sm"
            />
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API key akun ini (opsional kalau pakai sesi)"
              autoComplete="off"
              className="px-3 py-2 rounded-lg border border-border bg-card text-sm font-mono"
            />
          </div>
          <label className="block text-[12px] font-medium text-muted-foreground mt-2 mb-1">
            Cookie sesi akun ini (opsional)
          </label>
          <textarea
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            placeholder={'Tempel nilai cookie ("session=...; x=..."), header "Cookie: ...", atau hasil Copy as cURL dari akun tersebut'}
            rows={2}
            autoComplete="off"
            spellCheck={false}
            className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm font-mono resize-y"
          />
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" onClick={handleAdd} disabled={saving || (!apiKey.trim() && !cookie.trim())}>
              <Zap className={`h-4 w-4 mr-2 ${saving ? 'animate-pulse' : ''}`} />
              {saving ? 'Menyimpan...' : 'Tambah Akun'}
            </Button>
            <Button size="sm" variant="outline" onClick={fetchAccounts} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-pulse' : ''}`} />
              Muat Ulang
            </Button>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
            Isi kunci untuk akun berbayar per generate, atau sesi cookie untuk akun Unlimited. Kalau dua-duanya
            diisi, relay memakai sesi lebih dulu. Isian kosong saat menyimpan akun lama berarti nilainya dipertahankan.
          </div>
        </div>
      </div>
    </Section>
  )
}

export default function AdminSystemSettings() {
  const [settings, setSettings] = useState<AppSettings>({})
  const [maintenance, setMaintenance] = useState<Maintenance[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Harga NexaBot punya jalur sendiri (`/api/admin/nexabot/config`) karena
  // nilainya dipakai langsung oleh perhitungan charge di server. Tiap varian
  // paket Unlimited (Mingguan/Bulanan/Tahunan) punya harga & durasi sendiri.
  const [nbForm, setNbForm] = useState<{ price: string; packages: NexabotPackageForm[] }>({
    price: '',
    packages: toPackageForm(),
  })
  const [nbDefaults, setNbDefaults] = useState<{ price: number; packages: NexabotPackage[] }>({
    price: 150,
    packages: NB_PACKAGE_FALLBACKS,
  })
  const [nbActive, setNbActive] = useState<NexabotPricing | null>(null)
  const [nbSaving, setNbSaving] = useState(false)
  // Kunci induk NexaBot: server hanya melaporkan status, nilainya tidak pernah
  // dikirim balik ke browser — jadi input selalu kosong dan hanya diisi saat
  // admin ingin mengganti.
  const [mkStatus, setMkStatus] = useState<MasterKeyStatus | null>(null)
  const [mkInput, setMkInput] = useState('')
  const [mkSaving, setMkSaving] = useState(false)
  const [mkChecking, setMkChecking] = useState(false)
  const [mkCheck, setMkCheck] = useState<MasterKeyCheck | null>(null)
  // Sesi Unlimited (cookie): disimpan di server dan hanya dipakai member dengan
  // Paket Unlimited aktif. Nilainya tidak pernah dikirim balik ke browser.
  const [mcStatus, setMcStatus] = useState<MasterCookieStatus | null>(null)
  const [mcInput, setMcInput] = useState('')
  const [mcSaving, setMcSaving] = useState(false)
  const [mcChecking, setMcChecking] = useState(false)
  const [mcCheck, setMcCheck] = useState<MasterCookieCheck | null>(null)
  const token = useAuthStore((state) => state.token)
  const addToast = useToastStore((state) => state.addToast)

  const fetchData = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setSettings(data.settings || {})
        setMaintenance(data.maintenance || [])
      }
    } catch {
      addToast('Failed to fetch settings', 'error')
    } finally {
      setLoading(false)
    }
  }, [token, addToast])

  useEffect(() => { fetchData() }, [fetchData])

  const fetchNexabotPricing = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/admin/nexabot/config', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      const pricing: NexabotPricing = data.pricing
      setNbActive(pricing)
      if (data.defaults) {
        setNbDefaults({ price: data.defaults.price, packages: asPackages(data.defaults.packages) })
      }
      // Input diisi nilai efektif sekarang supaya admin lihat angka aslinya.
      setNbForm({ price: String(pricing.price), packages: toPackageForm(pricing.packages) })
    } catch { /* biarkan nilai lama kalau request gagal */ }
  }, [token])

  useEffect(() => { fetchNexabotPricing() }, [fetchNexabotPricing])

  const handleSaveNexabotPricing = async () => {
    if (!token) return
    setNbSaving(true)
    try {
      const res = await fetch('/api/admin/nexabot/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        // Field yang dikosongkan tidak ikut dikirim, jadi nilainya tetap.
        body: JSON.stringify({
          price: nbForm.price,
          packages: Object.fromEntries(
            nbForm.packages.map((p) => [p.slug, { price: p.price, days: p.days }]),
          ),
        }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message || 'Harga NexaBot disimpan', 'success')
        setNbActive(data.pricing)
        setNbForm({ price: String(data.pricing.price), packages: toPackageForm(data.pricing.packages) })
      } else {
        addToast(data.error || 'Gagal menyimpan harga NexaBot', 'error')
      }
    } catch {
      addToast('Gagal menyimpan harga NexaBot', 'error')
    } finally {
      setNbSaving(false)
    }
  }

  const fetchMasterKeyStatus = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/admin/nexabot/master-key', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      setMkStatus({
        configured: !!data.configured,
        source: data.source ?? 'none',
        mode: data.mode ?? 'unlimited-or-balance',
        daily_cap: Number(data.daily_cap) || 0,
        looks_like_cookie: !!data.looks_like_cookie,
      })
    } catch { /* biarkan status lama kalau request gagal */ }
  }, [token])

  useEffect(() => { fetchMasterKeyStatus() }, [fetchMasterKeyStatus])

  const handleCheckMasterKey = async () => {
    if (!token) return
    setMkChecking(true)
    try {
      const res = await fetch('/api/admin/nexabot/master-key/check', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok && data.check) setMkCheck(data.check as MasterKeyCheck)
      else addToast(data.error || 'Gagal memeriksa kunci server', 'error')
    } catch {
      addToast('Gagal memeriksa kunci server', 'error')
    } finally {
      setMkChecking(false)
    }
  }

  const handleSaveMasterKey = async () => {
    if (!token || !mkInput.trim()) return
    setMkSaving(true)
    try {
      const res = await fetch('/api/admin/nexabot/master-key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ apiKey: mkInput.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message || 'Kunci server NexaBot disimpan', 'success')
        setMkStatus({
          configured: !!data.configured,
          source: data.source ?? 'none',
          mode: data.mode ?? 'unlimited-or-balance',
          daily_cap: Number(data.daily_cap) || 0,
          looks_like_cookie: !!data.looks_like_cookie,
        })
        setMkCheck(null)
        setMkInput('')
        // Langsung buktikan kuncinya diterima upstream — kunci yang salah tidak
        // boleh terlihat "Aktif" tanpa peringatan.
        await handleCheckMasterKey()
      } else {
        addToast(data.error || 'Gagal menyimpan kunci server', 'error')
      }
    } catch {
      addToast('Gagal menyimpan kunci server', 'error')
    } finally {
      setMkSaving(false)
    }
  }

  const handleClearMasterKey = async () => {
    if (!token) return
    if (!window.confirm('Hapus kunci server NexaBot dari dashboard? Member tidak bisa generate pakai kunci server sampai kunci baru disimpan (atau .env dipakai kembali).')) return
    setMkSaving(true)
    try {
      const res = await fetch('/api/admin/nexabot/master-key', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message || 'Kunci server NexaBot dihapus', 'success')
        setMkStatus({
          configured: !!data.configured,
          source: data.source ?? 'none',
          mode: data.mode ?? 'unlimited-or-balance',
          daily_cap: Number(data.daily_cap) || 0,
          looks_like_cookie: !!data.looks_like_cookie,
        })
        setMkCheck(null)
      } else {
        addToast(data.error || 'Gagal menghapus kunci server', 'error')
      }
    } catch {
      addToast('Gagal menghapus kunci server', 'error')
    } finally {
      setMkSaving(false)
    }
  }

  const fetchMasterCookieStatus = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/admin/nexabot/master-cookie', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      setMcStatus({
        configured: !!data.configured,
        source: data.source ?? 'none',
        mode: data.mode ?? 'unlimited-or-balance',
        daily_cap: Number(data.daily_cap) || 0,
      })
    } catch { /* biarkan status lama kalau request gagal */ }
  }, [token])

  useEffect(() => { fetchMasterCookieStatus() }, [fetchMasterCookieStatus])

  const handleSaveMasterCookie = async () => {
    if (!token || !mcInput.trim()) return
    setMcSaving(true)
    try {
      const res = await fetch('/api/admin/nexabot/master-cookie', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cookie: mcInput.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message || 'Sesi Unlimited NexaBot disimpan', 'success')
        setMcStatus({
          configured: !!data.configured,
          source: data.source ?? 'none',
          mode: data.mode ?? 'unlimited-or-balance',
          daily_cap: Number(data.daily_cap) || 0,
        })
        setMcInput('')
        // Hasil cek lama tidak berlaku untuk cookie baru.
        setMcCheck(null)
      } else {
        addToast(data.error || 'Gagal menyimpan sesi Unlimited', 'error')
      }
    } catch {
      addToast('Gagal menyimpan sesi Unlimited', 'error')
    } finally {
      setMcSaving(false)
    }
  }

  const handleClearMasterCookie = async () => {
    if (!token) return
    if (!window.confirm('Hapus sesi Unlimited server? Member dengan Paket Unlimited tidak bisa generate lewat sesi server sampai cookie baru disimpan.')) return
    setMcSaving(true)
    try {
      const res = await fetch('/api/admin/nexabot/master-cookie', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message || 'Sesi Unlimited server dihapus', 'success')
        setMcStatus({
          configured: !!data.configured,
          source: data.source ?? 'none',
          mode: data.mode ?? 'unlimited-or-balance',
          daily_cap: Number(data.daily_cap) || 0,
        })
        setMcCheck(null)
      } else {
        addToast(data.error || 'Gagal menghapus sesi Unlimited', 'error')
      }
    } catch {
      addToast('Gagal menghapus sesi Unlimited', 'error')
    } finally {
      setMcSaving(false)
    }
  }

  const handleCheckMasterCookie = async () => {
    if (!token) return
    setMcChecking(true)
    try {
      const res = await fetch('/api/admin/nexabot/master-cookie/check', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok && data.check) {
        setMcCheck(data.check as MasterCookieCheck)
      } else {
        addToast(data.error || 'Gagal memeriksa sesi Unlimited', 'error')
      }
    } catch {
      addToast('Gagal memeriksa sesi Unlimited', 'error')
    } finally {
      setMcChecking(false)
    }
  }

  const handleSave = async () => {
    if (!token) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ settings, maintenance }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message || 'Settings saved', 'success')
      } else {
        addToast(data.error || 'Save failed', 'error')
      }
    } catch {
      addToast('Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggleMaintenance = (provider: string) => {
    setMaintenance(prev => {
      const existing = prev.find(m => m.provider === provider)
      if (existing) {
        return prev.map(m => m.provider === provider ? { ...m, is_maintenance: !m.is_maintenance } : m)
      }
      return [...prev, { provider, is_maintenance: true, message: '' }]
    })
  }

  const setMaintenanceMessage = (provider: string, message: string) => {
    setMaintenance(prev =>
      prev.map(m => m.provider === provider ? { ...m, message } : m)
    )
  }

  const maintenanceCount = maintenance.filter(m => m.is_maintenance).length

  if (loading) {
    return (
      <div>
        <PageHeader title="System Settings" desc="Configure global application settings" />
        <PageContent>
          <div className="text-center py-8 text-muted-foreground">Loading settings...</div>
        </PageContent>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="System Settings"
        desc="Configure global application settings and provider maintenance"
      />
      <PageContent>
        {/* Maintenance Status Banner */}
        {maintenanceCount > 0 && (
          <div className="mb-6 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <span className="text-sm text-yellow-500 font-medium">
              {maintenanceCount} provider(s) dalam mode maintenance
            </span>
          </div>
        )}

        {/* App Settings */}
        <Section title="Application Settings" sub="General settings for the application">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Membership Fee (Rp)</label>
                <input
                  type="number"
                  value={settings.membership_fee || ''}
                  onChange={e => setSettings(prev => ({ ...prev, membership_fee: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                  placeholder="150000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">App Name</label>
                <input
                  type="text"
                  value={settings.app_name || ''}
                  onChange={e => setSettings(prev => ({ ...prev, app_name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                  placeholder="ARKXMotion Studio"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Default Credits per User</label>
                <input
                  type="number"
                  value={settings.default_credits || ''}
                  onChange={e => setSettings(prev => ({ ...prev, default_credits: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                  placeholder="100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Max Credits per Generate</label>
                <input
                  type="number"
                  value={settings.max_credits_per_gen || ''}
                  onChange={e => setSettings(prev => ({ ...prev, max_credits_per_gen: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                  placeholder="50"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.maintenance_mode === 'true'}
                  onChange={e => setSettings(prev => ({ ...prev, maintenance_mode: e.target.checked ? 'true' : 'false' }))}
                  className="rounded border-border"
                />
                <span className="text-sm">Global Maintenance Mode</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.registration_open === 'true'}
                  onChange={e => setSettings(prev => ({ ...prev, registration_open: e.target.checked ? 'true' : 'false' }))}
                  className="rounded border-border"
                />
                <span className="text-sm">Registration Open</span>
              </label>
            </div>
          </div>
        </Section>

        {/* NexaBot Pricing */}
        <Section
          title="Harga NexaBot"
          sub="Tarif per generate dan tiap varian paket Unlimited — berlaku langsung tanpa deploy ulang"
        >
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Harga per Generate (Rp)
            </label>
            <input
              type="number"
              value={nbForm.price}
              onChange={e => setNbForm(prev => ({ ...prev, price: e.target.value }))}
              className="w-full sm:w-64 px-3 py-2 rounded-lg border border-border bg-card text-sm"
              placeholder={String(nbDefaults.price)}
            />
            <div className="text-[11px] text-muted-foreground mt-1">
              Dipotong dari saldo user tiap 1 generate (semua mode).
            </div>
          </div>

          <div className="mt-5">
            <div className="text-sm font-medium text-muted-foreground mb-2">Varian Paket Unlimited</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {nbForm.packages.map((p, idx) => {
                const fallback = nbDefaults.packages.find(x => x.slug === p.slug)
                const perDay = Number(p.price) > 0 && Number(p.days) > 0
                  ? Math.round(Number(p.price) / Number(p.days))
                  : null
                return (
                  <div key={p.slug} className="rounded-xl border border-border bg-card/40 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-semibold text-sm">Paket {p.label}</span>
                      <span className="text-[11px] text-muted-foreground font-mono">{p.slug}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-muted-foreground mb-1">Harga (Rp)</label>
                        <input
                          type="number"
                          value={p.price}
                          onChange={e => setNbForm(prev => ({
                            ...prev,
                            packages: prev.packages.map((x, i) => i === idx ? { ...x, price: e.target.value } : x),
                          }))}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                          placeholder={String(fallback?.price ?? '')}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-muted-foreground mb-1">Durasi (hari)</label>
                        <input
                          type="number"
                          value={p.days}
                          onChange={e => setNbForm(prev => ({
                            ...prev,
                            packages: prev.packages.map((x, i) => i === idx ? { ...x, days: e.target.value } : x),
                          }))}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                          placeholder={String(fallback?.days ?? '')}
                        />
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-2">
                      {perDay ? `≈ Rp ${perDay.toLocaleString('id-ID')}/hari · ` : ''}
                      masa berlaku ditumpuk kalau beli saat paket masih aktif.
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="text-[11px] text-muted-foreground mt-2">
              Harga 1–100.000.000 · durasi 1–365 hari. Kosongkan field yang tidak ingin diubah.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-4">
            <Button size="sm" onClick={handleSaveNexabotPricing} disabled={nbSaving}>
              <Zap className={`h-4 w-4 mr-2 ${nbSaving ? 'animate-pulse' : ''}`} />
              {nbSaving ? 'Menyimpan...' : 'Simpan Harga NexaBot'}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Aktif sekarang:{' '}
              {nbActive
                ? `Rp ${nbActive.price.toLocaleString('id-ID')}/generate · ${asPackages(nbActive.packages)
                    .map(p => `${p.label} Rp ${p.price.toLocaleString('id-ID')}/${p.days} hari`)
                    .join(' · ')}`
                : 'memuat...'}
            </span>
          </div>
        </Section>

        {/* Kunci Server NexaBot */}
        <Section
          title="Kunci Server NexaBot"
          sub="Kunci induk yang dipakai member tanpa API key — disimpan di server, tidak pernah dikirim ke browser"
        >
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Status:</span>
              {mkStatus?.configured ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] text-emerald-400">
                  <CheckCircle className="h-3 w-3" />
                  Aktif — {mkStatus.source === 'database' ? 'dari dashboard' : 'dari .env'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 text-[11px] text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  Belum diatur — member hanya bisa lewat sesi cookie server (bila ada)
                </span>
              )}
              {mkStatus && mkStatus.mode === 'off' && (
                <span className="text-[11px] text-amber-400">Mode di .env: off (kunci tidak dipakai)</span>
              )}
            </div>

            <p className="mt-2 text-[12px] text-muted-foreground leading-relaxed">
              Member yang sudah top up saldo atau punya Paket Unlimited aktif generate lewat kredensial
              server (kunci ini, atau sesi cookie di bawah bila kunci tidak tersedia); biaya Rp tetap
              dipotong dari saldo mereka. Kunci disimpan di database, tidak pernah ditampilkan lagi, dan
              tidak pernah dikirim ke browser mana pun. Isi kolom untuk mengganti kunci — nilai lama
              langsung tidak berlaku.
            </p>

            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <input
                type="password"
                value={mkInput}
                onChange={e => setMkInput(e.target.value)}
                placeholder="Tempel API key NexaBot (nxb_...)"
                autoComplete="off"
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-sm font-mono"
              />
              <Button size="sm" onClick={handleSaveMasterKey} disabled={mkSaving || !mkInput.trim()}>
                <KeyRound className={`h-4 w-4 mr-2 ${mkSaving ? 'animate-pulse' : ''}`} />
                {mkSaving ? 'Menyimpan...' : 'Simpan Kunci'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleClearMasterKey}
                disabled={mkSaving || !mkStatus?.configured || mkStatus?.source === 'env'}
                title={mkStatus?.source === 'env' ? 'Kunci berasal dari .env — hapus variabelnya di server' : undefined}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Hapus
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCheckMasterKey}
                disabled={mkChecking || !mkStatus?.configured}
              >
                <Activity className={`h-4 w-4 mr-2 ${mkChecking ? 'animate-pulse' : ''}`} />
                {mkChecking ? 'Memeriksa...' : 'Cek Kunci'}
              </Button>
            </div>

            {mkStatus?.looks_like_cookie && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300 leading-relaxed">
                Nilai yang tersimpan berbentuk <strong>cookie sesi</strong>, bukan API key — server
                mengabaikannya sebagai kunci. Pindahkan nilai itu ke bagian “Sesi Unlimited Server
                NexaBot”, lalu simpan API key NexaBot yang asli di sini.
              </div>
            )}

            {mkCheck && (
              <div
                className={`mt-3 rounded-lg border px-3 py-2 text-[12px] leading-relaxed ${
                  mkCheck.valid
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : mkCheck.transient
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      : 'border-red-500/30 bg-red-500/10 text-red-300'
                }`}
              >
                <span className="font-medium">
                  {mkCheck.valid
                    ? `Kunci diterima (HTTP ${mkCheck.status})`
                    : mkCheck.transient
                      ? 'Cek gagal sementara'
                      : 'Kunci ditolak'}
                </span>
                {mkCheck.valid && (
                  <span className="ml-2 opacity-80">
                    kredit {mkCheck.credit ?? 'tidak terverifikasi'}
                    {mkCheck.telegram_id ? ` · telegram ${mkCheck.telegram_id}` : ''}
                  </span>
                )}
                {mkCheck.error && <div className="mt-1">{mkCheck.error}</div>}
              </div>
            )}

            <div className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
              Urutan yang dipakai server: kunci dashboard → <code>NEXABOT_MASTER_API_KEY</code> di .env →
              tidak tersedia. Batas harian dan mode tetap diatur lewat env
              (<code>NEXABOT_MASTER_KEY_MODE</code>, <code>NEXABOT_MASTER_DAILY_CAP</code>).
            </div>
          </div>
        </Section>

        {/* Sesi Unlimited NexaBot */}
        <Section
          title="Sesi Unlimited Server NexaBot"
          sub="Cookie login nexabot.id untuk jalur web — melayani member Unlimited, dan member saldo pada mode default"
        >
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Status sesi:</span>
              {mcStatus?.configured ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] text-emerald-400">
                  <CheckCircle className="h-3 w-3" />
                  Aktif — cookie tersimpan di server
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 text-[11px] text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  Belum diatur — jalur sesi server tidak tersedia
                </span>
              )}
              {mcStatus && mcStatus.mode === 'off' && (
                <span className="text-[11px] text-amber-400">Mode di .env: off (sesi tidak dipakai)</span>
              )}
            </div>

            <p className="mt-2 text-[12px] text-muted-foreground leading-relaxed">
              Paket Unlimited hanya dihormati lewat cookie login web (endpoint <code>/api/v1/generate</code>),
              bukan API key. Cookie ini disimpan di database, tidak pernah ditampilkan lagi, dan tidak
              pernah dikirim ke browser mana pun. Siapa yang boleh memakainya mengikuti mode server:
              member Unlimited saja, atau juga member bersaldo pada mode <code>unlimited-or-balance</code>{' '}
              (default). Biaya Rp per generate tetap dipotong dari saldo mereka.
            </p>

            <label className="block text-[12px] font-medium text-muted-foreground mt-3 mb-1">
              Tempel cookie sesi
            </label>
            <textarea
              value={mcInput}
              onChange={e => setMcInput(e.target.value)}
              placeholder={'Tempel nilai cookie ("session=...; x=..."), header "Cookie: ...", atau hasil Copy as cURL dari nexabot.id'}
              rows={3}
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm font-mono resize-y"
            />
            <div className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
              Login di nexabot.id dengan akun Unlimited → DevTools → Network → pilih request ke
              <code> /api/v1/generate</code> → Copy as cURL → tempel di sini (atau salin nilai
              <code> document.cookie</code>). Isi kolom untuk mengganti cookie — nilai lama langsung tidak berlaku.
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={handleSaveMasterCookie} disabled={mcSaving || !mcInput.trim()}>
                <Cookie className={`h-4 w-4 mr-2 ${mcSaving ? 'animate-pulse' : ''}`} />
                {mcSaving ? 'Menyimpan...' : 'Simpan Sesi'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCheckMasterCookie}
                disabled={mcChecking || !mcStatus?.configured}
                title={mcStatus?.configured ? undefined : 'Simpan cookie dulu'}
              >
                <Activity className={`h-4 w-4 mr-2 ${mcChecking ? 'animate-pulse' : ''}`} />
                {mcChecking ? 'Memeriksa...' : 'Cek Limit & Status'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleClearMasterCookie}
                disabled={mcSaving || !mcStatus?.configured}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Hapus
              </Button>
            </div>

            {mcCheck && (
              <div className="mt-4 rounded-lg border border-border bg-card/60 p-3">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-sm font-medium">Hasil cek</span>
                  {mcCheck.ok && mcCheck.unlimited ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] text-emerald-400">
                      <CheckCircle className="h-3 w-3" />
                      Unlimited aktif
                    </span>
                  ) : mcCheck.ok ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 text-[11px] text-amber-400">
                      <AlertTriangle className="h-3 w-3" />
                      Sesi valid, tapi Unlimited tidak terdeteksi
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/30 px-2.5 py-0.5 text-[11px] text-red-400">
                      <AlertTriangle className="h-3 w-3" />
                      {mcCheck.transient ? 'Gagal sementara' : 'Sesi ditolak'}
                    </span>
                  )}
                </div>

                {mcCheck.error && (
                  <div className="mb-2 text-[12px] text-red-400 leading-relaxed">{mcCheck.error}</div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5 text-[12px]">
                  <div className="flex justify-between gap-2 border-b border-border/60 py-1">
                    <span className="text-muted-foreground">Paket</span>
                    <span className="font-medium">{mcCheck.plan || 'tidak terverifikasi'}</span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-border/60 py-1">
                    <span className="text-muted-foreground">Berlaku sampai</span>
                    <span className="font-medium">{mcCheck.until || 'tidak terverifikasi'}</span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-border/60 py-1">
                    <span className="text-muted-foreground">Saldo kredit</span>
                    <span className="font-medium">
                      {mcCheck.balance != null
                        ? `${mcCheck.balance.toLocaleString('id-ID')} cr`
                        : 'tidak terverifikasi'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-border/60 py-1">
                    <span className="text-muted-foreground">Email</span>
                    <span className="font-medium truncate" title={mcCheck.email || undefined}>
                      {mcCheck.email || 'tidak terverifikasi'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-border/60 py-1">
                    <span className="text-muted-foreground">Telegram ID</span>
                    <span className="font-medium">{mcCheck.telegram_id || 'tidak terverifikasi'}</span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-border/60 py-1">
                    <span className="text-muted-foreground">HTTP</span>
                    <span className="font-medium">{mcCheck.status ?? '—'}</span>
                  </div>
                </div>

                <div className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
                  Field yang tidak dikenali bentuk responsnya ditandai “tidak terverifikasi” — itu bukan
                  berarti sesi mati. Cek ulang setelah beberapa saat kalau hasilnya gagal sementara.
                </div>
              </div>
            )}
          </div>
        </Section>

        <NexabotAccountPoolSection
          token={token}
          addToast={addToast}
          refreshSignal={`${mkStatus?.configured ? 1 : 0}-${mcStatus?.configured ? 1 : 0}`}
        />

        <ProviderServerKeySection provider="alriz" label="Alriz Motion" token={token} addToast={addToast} />
        <ProviderServerKeySection provider="seavi" label="Seavi Labs" token={token} addToast={addToast} />

        {/* Provider Maintenance */}
        <Section title="Provider Maintenance" sub="Toggle maintenance mode for individual providers">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ALL_PROVIDERS.map(provider => {
              const m = maintenance.find(x => x.provider === provider)
              const isMaint = m?.is_maintenance ?? false
              return (
                <div key={provider} className={`rounded-xl border p-4 transition-colors ${
                  isMaint ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-border bg-card'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium capitalize">{provider}</span>
                    <button
                      onClick={() => toggleMaintenance(provider)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        isMaint ? 'bg-yellow-500' : 'bg-secondary'
                      }`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        isMaint ? 'translate-x-4' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </div>
                  {isMaint && (
                    <input
                      type="text"
                      value={m?.message || ''}
                      onChange={e => setMaintenanceMessage(provider, e.target.value)}
                      placeholder="Maintenance message..."
                      className="w-full px-2 py-1 text-xs rounded border border-yellow-500/30 bg-yellow-500/10"
                    />
                  )}
                  <div className="mt-2 flex items-center gap-1">
                    {isMaint ? (
                      <><AlertTriangle className="h-3 w-3 text-yellow-500" /><span className="text-[12px] text-yellow-500">Maintenance</span></>
                    ) : (
                      <><CheckCircle className="h-3 w-3 text-green-500" /><span className="text-[12px] text-green-500">Active</span></>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>

        {/* Save Button */}
        <div className="flex items-center gap-3 mt-6">
          <Button onClick={handleSave} disabled={saving}>
            <Save className={`h-4 w-4 mr-2 ${saving ? 'animate-spin' : ''}`} />
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
          <Button variant="outline" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </PageContent>
    </div>
  )
}
