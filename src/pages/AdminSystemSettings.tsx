import { useState, useCallback, useEffect, useRef } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { isBoosterPackage } from '@/lib/nexabotWallet'
import type { RhClaimProgress } from '@/lib/runninghubDailyClaim'
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
  Gift,
  Search,
  Upload,
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
  // Ber-scope: Booster membebaskan NexaDance 3.0 + Omni + GPT Image (server yang menegakkan).
  { slug: 'unlimited_seedance_daily', label: 'Booster', price: 15000, days: 1 },
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

type PpProviderId = 'seavi' | 'posbot' | 'runninghub' | 'createpulse'

/** Cermin respons `GET /api/admin/provider-pricing` (lib/providerPricing.ts). */
interface PpEffective {
  provider: PpProviderId
  kind: 'model' | 'flat'
  flat: number | null
  default: number | null
  models: Record<string, number>
  catalog: Record<string, number>
  limits: { min: number; max: number }
}

interface PpFormState {
  flat: string
  default: string
  models: Record<string, string>
}

// Nama ramah untuk model RunningHub — disamakan dengan nama menu Motion
// Control / halaman fitur. Key (action) tetap ditampilkan kecil supaya admin
// tahu field yang benar-benar dipakai charge server.
const RH_MODEL_LABELS: Record<string, string> = {
  'motion-control-72fps': 'Motion Control 72 FPS',
  'motion-control-kontrol-gerakan': 'Kontrol Gerak 50FPS',
  'motion-control-eposcents': 'Eposcents MC — 512HD 32FPS',
  'motion-control-pro': 'Motion Control Pro — Motion Transfer',
  'motion-control-ultra-hd': 'MC Ultra Fast HD',
  'motion-control': 'Motion Control standar (Kling 2.6 Pro/Std · 2.9 · 3.0)',
  'motion-control-kling-2.6': 'Kling Motion Control 2.6 (App)',
  'motion-control-ultra-hd-pro': 'MC Ultra Fast HD Pro — SAM3 multi-person',
  'motion-control-v2.6-std': 'Motion Control V2.6 Std (URL)',
  'motion-control-v2.6-pro': 'Motion Control V2.6 Pro (URL)',
  'motion-control-v3': 'Motion Control V3 (URL)',
  'submit-h3-music-avatar': 'H3 Music / Podcast Avatar',
  'submit-h3-i2v': 'H3 Image → Video',
  'submit-seedance2': 'Seedance 2',
  'submit-seedance2.6': 'Seedance 2.6',
  'submit-image-edit': 'Edit Gambar — FLUX Kontext',
  'submit-photo-enhance': 'Photo Enhance',
  'submit-travel-photo': 'Travel Photo',
  'submit-tryon': 'Virtual Try-On',
  'submit-tryon-flux2': 'Virtual Try-On — Flux 2',
  'submit-video-upscale': 'Video Upscaler',
  'submit-song-cover': 'AI Song Cover',
  'submit-yue2-reimaginer': 'YuE2 Reimagine Lagu',
  'submit-ugc-storyboard': 'UGC Storyboard',
}
// Urutan tampil: model Motion Control dulu (sesuai menu), sisanya menurut antrian penambahan.
const RH_MODEL_ORDER = Object.keys(RH_MODEL_LABELS)
// Urutan tampil model lain (Seavi/PosBot/CreatePulse) — leksiografis lama.
const sortirCatalog = (a: string, b: string) => a.localeCompare(b)

const PP_PROVIDERS: { id: PpProviderId; name: string; desc: string; unit: string; flat?: boolean }[] = [
  { id: 'seavi', name: 'Seavi', desc: 'Token per generate', unit: 'token' },
  { id: 'posbot', name: 'PosBot', desc: 'Tarif per generate', unit: 'Rp' },
  { id: 'runninghub', name: 'RunningHub', desc: 'Harga per model (per fitur) — bisa diedit satu per satu, berlaku langsung', unit: 'Rp' },
  { id: 'createpulse', name: 'CreatePulse', desc: 'Tarif per generate', unit: 'Rp' },
]

const PP_FORM_KOSONG: PpFormState = { flat: '', default: '', models: {} }

const ppFormAwal: Record<PpProviderId, PpFormState> = {
  seavi: { ...PP_FORM_KOSONG },
  posbot: { ...PP_FORM_KOSONG },
  runninghub: { ...PP_FORM_KOSONG },
  createpulse: { ...PP_FORM_KOSONG },
}

const ppFormDari = (e?: PpEffective): PpFormState => e
  ? {
      flat: e.flat != null ? String(e.flat) : '',
      default: e.default != null ? String(e.default) : '',
      models: Object.fromEntries(Object.entries(e.catalog).map(([m, v]) => [m, String(v)])),
    }
  : { ...PP_FORM_KOSONG }

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

// ─── Kunci server Seavi ────────────────────────────────────────────────
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
  provider: 'seavi' | 'posbot'
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

// ─── Pool token master RunningHub ───────────────────────────────────────────
// Member top up saldo Rupiah lalu generate tanpa token sendiri: relay memasang
// token dari pool ini (round-robin, auto-rotate). Token sehat dicoba bergilir;
// saldo habis / kena rate → cooldown sementara; kode invalid → ditolak permanen.
// JWT juga mengklaim hadiah harian (+30 poin) otomatis lewat cron server.
// Nilai token TIDAK PERNAH dikirim ke browser — admin hanya melihat status,
// akun tersamar, dan snapshot poin.

interface RhPoolSummaryView {
  total: number
  usable: number
  active: number
  cooldown: number
  rejected: number
  envConfigured: boolean
  max: number
}

interface RhPoolTokenView {
  id: number
  label: string
  kind: 'jwt' | 'key'
  account: string
  status: 'active' | 'cooldown' | 'rejected'
  cooldown_until: number
  last_error: string
  last_used_at: number | null
  points_balance: number | null
  points_checked_at: number | null
  last_claim_day: string
}

interface RhCheckView {
  ok: boolean
  transient?: boolean
  text: string
  detail?: string
}

function rhPoolCheckView(check: { ok: boolean; rejected: boolean; message: string }): RhCheckView {
  if (check.ok) return { ok: true, text: 'Token diterima', detail: check.message }
  if (check.rejected) return { ok: false, text: 'Token ditolak permanen', detail: check.message }
  return { ok: false, transient: true, text: 'Cek gagal sementara', detail: check.message }
}

function RunningHubPoolSection({
  token,
  addToast,
}: {
  token: string | null
  addToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void
}) {
  const [summary, setSummary] = useState<RhPoolSummaryView | null>(null)
  const [tokens, setTokens] = useState<RhPoolTokenView[]>([])
  const [bulk, setBulk] = useState('')
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [checkingId, setCheckingId] = useState<number | null>(null)
  const [checkingAll, setCheckingAll] = useState(false)
  const [claimingAll, setClaimingAll] = useState(false)
  const [claimProgress, setClaimProgress] = useState<RhClaimProgress | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [checks, setChecks] = useState<Record<number, RhCheckView>>({})
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'cooldown' | 'rejected'>('all')
  const [page, setPage] = useState(0)
  const [clearingAll, setClearingAll] = useState(false)
  const [clearingRejected, setClearingRejected] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const auth = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token])

  const apply = (data: any) => {
    if (data.summary) setSummary(data.summary as RhPoolSummaryView)
    if (Array.isArray(data.tokens)) setTokens(data.tokens as RhPoolTokenView[])
    if ('claimProgress' in data) setClaimProgress((data.claimProgress || null) as RhClaimProgress | null)
  }

  const fetchPool = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/runninghub/pool', { headers: auth() })
      if (!res.ok) return
      apply(await res.json())
    } catch { /* biarkan daftar lama kalau request gagal */ } finally {
      setLoading(false)
    }
  }, [token, auth])

  useEffect(() => { fetchPool() }, [fetchPool])

  const PAGE_SIZE = 25
  const q = query.trim().toLowerCase()
  const filteredTokens = tokens.filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (!q) return true
    return [t.label, t.account, t.kind === 'jwt' ? 'jwt' : 'api key']
      .join(' ')
      .toLowerCase()
      .includes(q)
  })
  const totalPages = Math.max(1, Math.ceil(filteredTokens.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const pageTokens = filteredTokens.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  useEffect(() => { setPage(0) }, [query, statusFilter])

  const handleBulkFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.currentTarget.value = ''
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      addToast('File terlalu besar (maks 10 MB)', 'warning')
      return
    }
    try {
      const text = await file.text()
      setBulk((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text))
      addToast(`Isi "${file.name}" dimuat ke kolom — cek lalu klik Tambah Token`, 'info')
    } catch {
      addToast('Gagal membaca file', 'error')
    }
  }

  const handleClearAll = async () => {
    if (!token || clearingAll) return
    const n = tokens.length
    if (n === 0) { addToast('Pool sudah kosong', 'info'); return }
    if (!window.confirm(`Hapus SEMUA ${n} token dari pool?`)) return
    if (!window.confirm('Konfirmasi terakhir: semua token dihapus permanen dan tidak bisa dikembalikan. Lanjutkan?')) return
    setClearingAll(true)
    try {
      const res = await fetch('/api/admin/runninghub/pool/clear-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ confirm: 'HAPUS-SEMUA-TOKEN' }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(`${data.deleted ?? n} token dihapus`, 'success')
        setChecks({})
        apply(data)
      } else {
        addToast(data.error || 'Gagal menghapus semua token', 'error')
      }
    } catch {
      addToast('Gagal menghapus semua token', 'error')
    } finally {
      setClearingAll(false)
    }
  }

  const handleClearRejected = async () => {
    if (!token || clearingRejected) return
    const n = tokens.filter((t) => t.status === 'rejected').length
    if (n === 0) { addToast('Tidak ada token ditolak', 'info'); return }
    if (!window.confirm(`Hapus ${n} token yang ditolak permanen?`)) return
    setClearingRejected(true)
    try {
      const res = await fetch('/api/admin/runninghub/pool/clear-rejected', { method: 'POST', headers: auth() })
      const data = await res.json()
      if (res.ok) {
        addToast(`${data.deleted ?? n} token ditolak dihapus`, 'success')
        setChecks({})
        apply(data)
      } else {
        addToast(data.error || 'Gagal menghapus token ditolak', 'error')
      }
    } catch {
      addToast('Gagal menghapus token ditolak', 'error')
    } finally {
      setClearingRejected(false)
    }
  }

  const handleAdd = async () => {
    if (!token || saving || !bulk.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/runninghub/pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ tokens: bulk, label: label.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(`+${data.added ?? 0} token ditambahkan (duplikat ${data.skipped ?? 0}, invalid ${data.invalid ?? 0})`, 'success')
        setBulk('')
        setLabel('')
        apply(data)
      } else {
        addToast(data.error || 'Gagal menambah token', 'error')
      }
    } catch {
      addToast('Gagal menambah token', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (t: RhPoolTokenView) => {
    if (!token || deletingId !== null) return
    if (!window.confirm(`Hapus token "${t.label}" dari pool? Generate tidak lagi diarahkan ke token ini.`)) return
    setDeletingId(t.id)
    try {
      const res = await fetch(`/api/admin/runninghub/pool/${t.id}`, { method: 'DELETE', headers: auth() })
      const data = await res.json()
      if (res.ok) {
        addToast(`Token "${t.label}" dihapus`, 'success')
        apply(data)
        setChecks((prev) => { const n = { ...prev }; delete n[t.id]; return n })
      } else {
        addToast(data.error || 'Gagal menghapus token', 'error')
      }
    } catch {
      addToast('Gagal menghapus token', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  const handleCheck = async (id: number) => {
    if (!token || checkingId !== null) return
    setCheckingId(id)
    try {
      const res = await fetch(`/api/admin/runninghub/pool/${id}/check`, { method: 'POST', headers: auth() })
      const data = await res.json()
      if (res.ok && data.check) {
        setChecks((prev) => ({ ...prev, [id]: rhPoolCheckView(data.check) }))
        apply(data)
      } else {
        addToast(data.error || 'Gagal memeriksa token', 'error')
      }
    } catch {
      addToast('Gagal memeriksa token', 'error')
    } finally {
      setCheckingId(null)
    }
  }

  const handleCheckAll = async () => {
    if (!token || checkingAll) return
    setCheckingAll(true)
    try {
      const res = await fetch('/api/admin/runninghub/pool/check-all', { method: 'POST', headers: auth() })
      const data = await res.json()
      if (res.ok) {
        const results = (data.results || {}) as Record<string, { ok: boolean; message: string }>
        setChecks((prev) => {
          const next = { ...prev }
          for (const key of Object.keys(results)) {
            const r = results[key]
            next[Number(key)] = { ok: r.ok, transient: !r.ok, text: r.ok ? 'Token diterima' : 'Cek gagal', detail: r.message }
          }
          return next
        })
        apply(data)
        addToast(`${data.checked ?? 0} token diperiksa`, 'success')
      } else {
        addToast(data.error || 'Gagal memeriksa semua token', 'error')
      }
    } catch {
      addToast('Gagal memeriksa semua token', 'error')
    } finally {
      setCheckingAll(false)
    }
  }

  const handleClaimAll = async () => {
    if (!token || claimingAll) return
    setClaimingAll(true)
    try {
      const res = await fetch('/api/admin/runninghub/pool/claim-all', { method: 'POST', headers: auth() })
      const data = await res.json()
      if (!res.ok) {
        addToast(data.error || 'Gagal mengklaim poin', 'error')
        return
      }
      apply(data)
      // Klaim pool berjalan di latar belakang server (jeda 2 detik/token → bisa
      // puluhan menit). Pantau sampai selesai, batas poll mengikuti jumlah token.
      let progress = (data.claimProgress || null) as RhClaimProgress | null
      const maxPolls = Math.ceil(((progress?.total || 0) * 4 + 300) / 2)
      for (let i = 0; i < maxPolls && progress?.running; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const poll = await fetch('/api/admin/runninghub/pool', { headers: auth() })
        if (!poll.ok) continue
        const fresh = await poll.json()
        apply(fresh)
        progress = (fresh.claimProgress || null) as RhClaimProgress | null
      }
      if (!progress || progress.total === 0) {
        addToast('Tidak ada token JWT yang perlu diklaim hari ini (sudah diklaim / bukan JWT).', 'info')
      } else {
        addToast(
          `Klaim poin: ${progress.claimed} baru, ${progress.already} sudah, ${progress.failed} gagal`,
          progress.failed > 0 ? 'warning' : 'success',
        )
      }
    } catch {
      addToast('Gagal mengklaim poin', 'error')
    } finally {
      setClaimingAll(false)
    }
  }

  const handleSaveLabel = async (id: number) => {
    if (!token) return
    try {
      const res = await fetch(`/api/admin/runninghub/pool/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ label: editLabel.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        apply(data)
        setEditingId(null)
        addToast('Label disimpan', 'success')
      } else {
        addToast(data.error || 'Gagal menyimpan label', 'error')
      }
    } catch {
      addToast('Gagal menyimpan label', 'error')
    }
  }

  const fmtPts = (n: number) => String(Math.round(n * 100) / 100)
  const cekLalu = (ms: number) => {
    const menit = Math.max(0, Math.floor((Date.now() - ms) / 60000))
    if (menit < 1) return 'baru saja'
    if (menit < 60) return `${menit} mnt lalu`
    const jam = Math.floor(menit / 60)
    return jam < 24 ? `${jam} jam lalu` : `${Math.floor(jam / 24)} hari lalu`
  }
  const busy = checkingId !== null || checkingAll || claimingAll || deletingId !== null
  const jwtCount = tokens.filter((t) => t.kind === 'jwt' && t.status !== 'rejected').length

  const statusBadge = (t: RhPoolTokenView) => {
    if (t.status === 'rejected') {
      return <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">Ditolak</span>
    }
    if (t.status === 'cooldown' && t.cooldown_until > Date.now()) {
      const mins = Math.max(1, Math.ceil((t.cooldown_until - Date.now()) / 60000))
      return <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">Cooldown {mins}m</span>
    }
    return <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">Aktif</span>
  }

  const checkBanner = (id: number) => {
    const hasil = checks[id]
    if (!hasil) return null
    return (
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
    )
  }

  return (
    <Section
      title="Token Master RunningHub"
      sub="Pool token operator — auto-rotate. Member top up saldo lalu generate tanpa token sendiri"
    >
      <div className="rounded-xl border border-border bg-card/40 p-4">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5">
            Total <b className="text-foreground">{summary?.total ?? 0}</b>/{summary?.max ?? 100}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-emerald-400">
            <CheckCircle className="h-3 w-3" /> Siap pakai {summary?.usable ?? 0}
          </span>
          {(summary?.cooldown ?? 0) > 0 && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-amber-400">Cooldown {summary?.cooldown}</span>
          )}
          {(summary?.rejected ?? 0) > 0 && (
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-red-400">Ditolak {summary?.rejected}</span>
          )}
          <span className={`rounded-full border px-2.5 py-0.5 ${summary?.envConfigured ? 'border-sky-500/30 bg-sky-500/10 text-sky-400' : 'border-border bg-card text-muted-foreground'}`}>
            Token .env {summary?.envConfigured ? 'aktif' : 'tidak ada'}
          </span>
        </div>

        <p className="mt-2 text-[12px] text-muted-foreground leading-relaxed">
          Relay memilih token sehat secara bergilir (round-robin). Saldo habis / kena rate → cooldown sementara;
          kode invalid → ditolak permanen. Access token (JWT) juga mengklaim hadiah harian +30 poin otomatis
          (cron server, reset UTC+8) — atau klik <b className="text-foreground">Klaim Poin</b> untuk mengklaim sekarang.
          Nilai token tidak pernah ditampilkan lagi dan tidak pernah dikirim ke browser.
        </p>

        {loading && tokens.length === 0 ? (
          <div className="mt-3 text-[12px] text-muted-foreground">Memuat pool token…</div>
        ) : tokens.length === 0 && !summary?.envConfigured ? (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300">
            Belum ada token master. Tempel access token / API key RunningHub di bawah supaya member bisa generate memakai saldo.
          </div>
        ) : (
          <>
          {tokens.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <div className="relative min-w-[160px] flex-1">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cari label / akun…"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-border bg-card py-1.5 pl-7 pr-2 text-xs"
                />
              </div>
              <span className="flex flex-wrap items-center gap-1">
                {([
                  ['all', 'Semua', tokens.length],
                  ['active', 'Siap', tokens.filter((t) => t.status === 'active').length],
                  ['cooldown', 'Cooldown', tokens.filter((t) => t.status === 'cooldown' && t.cooldown_until > Date.now()).length],
                  ['rejected', 'Ditolak', tokens.filter((t) => t.status === 'rejected').length],
                ] as Array<[typeof statusFilter, string, number]>).map(([id, label, n]) => (
                  <button
                    key={id}
                    onClick={() => setStatusFilter(id)}
                    className={`rounded-full border px-2 py-1 text-[10px] transition-colors ${statusFilter === id ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}
                  >
                    {label} <b className="font-mono">{n}</b>
                  </button>
                ))}
              </span>
              <span className="w-full text-right text-[10px] text-muted-foreground">
                {filteredTokens.length} token · halaman {safePage + 1}/{totalPages}
              </span>
            </div>
          )}
          <ul className="mt-3 divide-y divide-border/60 rounded-lg border border-border">
            {summary?.envConfigured && (
              <li className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">Token .env</span>
                  <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-400">RUNNINGHUB_ACCESS_TOKEN</span>
                  <span className="ml-auto">
                    <Button size="sm" variant="outline" onClick={() => handleCheck(0)} disabled={busy}>
                      <Activity className={`h-3.5 w-3.5 mr-1.5 ${checkingId === 0 ? 'animate-pulse' : ''}`} />
                      {checkingId === 0 ? 'Memeriksa...' : 'Cek'}
                    </Button>
                  </span>
                </div>
                {checkBanner(0)}
              </li>
            )}
            {pageTokens.map((t) => (
              <li key={t.id} className="px-2.5 py-1.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {editingId === t.id ? (
                    <span className="flex items-center gap-1.5">
                      <input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        maxLength={40}
                        autoFocus
                        className="px-2 py-1 rounded-lg border border-border bg-card text-sm"
                      />
                      <Button size="sm" onClick={() => handleSaveLabel(t.id)}>Simpan</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Batal</Button>
                    </span>
                  ) : (
                    <span className="text-[12px] font-medium">{t.label}</span>
                  )}
                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-[9px] text-muted-foreground">
                    {t.kind === 'jwt' ? <Zap className="h-3 w-3" /> : <KeyRound className="h-3 w-3" />}
                    {t.kind === 'jwt' ? 'JWT' : 'Key'}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">{t.account}</span>
                  {statusBadge(t)}
                  <span className="ml-auto flex items-center gap-1">
                    <Button size="sm" variant="outline" className="!px-2 !py-1 !text-[10px]" onClick={() => handleCheck(t.id)} disabled={busy} title="Cek token">
                      <Activity className={`h-3 w-3 mr-1 ${checkingId === t.id ? 'animate-pulse' : ''}`} />
                      {checkingId === t.id ? '...' : 'Cek'}
                    </Button>
                    {editingId !== t.id && (
                      <Button size="sm" variant="outline" className="!px-2 !py-1 !text-[10px]" onClick={() => { setEditingId(t.id); setEditLabel(t.label) }} disabled={busy} title="Ubah label">
                        Label
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="!px-2 !py-1 !text-[10px]" onClick={() => handleDelete(t)} disabled={busy} title="Hapus token">
                      <Trash2 className="h-3 w-3 mr-1" />
                      {deletingId === t.id ? '...' : 'Hapus'}
                    </Button>
                  </span>
                </div>

                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                  <span>Poin <b className="text-foreground font-mono">{t.points_balance != null ? fmtPts(t.points_balance) : '—'}</b>{t.points_checked_at && <span className="opacity-70"> · {cekLalu(t.points_checked_at)}</span>}</span>
                  {t.kind === 'jwt' && <span>Klaim <b className="text-foreground">{t.last_claim_day || '—'}</b></span>}
                  {t.last_used_at && <span>Dipakai {cekLalu(t.last_used_at)}</span>}
                </div>
                {t.last_error && (
                  <div className="mt-0.5 truncate text-[10px] text-red-400/90" title={t.last_error}>{t.last_error}</div>
                )}
                {checkBanner(t.id)}
              </li>
            ))}
          </ul>
          </>
        )}
        {totalPages > 1 && (
          <div className="mt-2 flex items-center justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}>
              Sebelumnya
            </Button>
            <span className="text-[11px] text-muted-foreground">{safePage + 1} / {totalPages}</span>
            <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}>
              Berikutnya
            </Button>
          </div>
        )}

        <div className="mt-4 border-t border-border/60 pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] font-medium">Tambah token (bulk)</div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="!py-1.5 !text-[11px]" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Upload file (.txt)
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.csv,.log,text/plain"
                className="hidden"
                onChange={handleBulkFile}
              />
            </div>
          </div>
          <textarea
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder={'Tempel banyak token sekaligus — satu per baris, atau dipisah koma/titik koma.\nAccess token (JWT eyJ…) untuk poin + klaim harian, atau API key (32 hex) untuk generate openapi.'}
            rows={4}
            autoComplete="off"
            spellCheck={false}
            className="mt-2 w-full px-3 py-2 rounded-lg border border-border bg-card text-sm font-mono resize-y"
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label batch (opsional, mis. Akun operator A)"
            autoComplete="off"
            maxLength={40}
            className="mt-2 w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={handleAdd} disabled={saving || !bulk.trim()}>
              <Zap className={`h-4 w-4 mr-2 ${saving ? 'animate-pulse' : ''}`} />
              {saving ? 'Menyimpan...' : 'Tambah Token'}
            </Button>
            <Button size="sm" variant="outline" onClick={handleCheckAll} disabled={busy || (tokens.length === 0 && !summary?.envConfigured)}>
              <Activity className={`h-4 w-4 mr-2 ${checkingAll ? 'animate-pulse' : ''}`} />
              {checkingAll ? 'Memeriksa semua...' : 'Cek Semua'}
            </Button>
            <Button size="sm" variant="outline" onClick={handleClaimAll} disabled={busy || jwtCount === 0}>
              <Gift className={`h-4 w-4 mr-2 ${claimingAll ? 'animate-pulse' : ''}`} />
              {claimingAll ? 'Mengklaim poin...' : `Klaim Poin (${jwtCount})`}
            </Button>
            <Button size="sm" variant="outline" onClick={fetchPool} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-pulse' : ''}`} />
              Muat Ulang
            </Button>
            <Button size="sm" variant="outline" onClick={handleClearRejected} disabled={busy || clearingRejected || tokens.filter((t) => t.status === 'rejected').length === 0}>
              <Trash2 className={`h-4 w-4 mr-2 ${clearingRejected ? 'animate-pulse' : ''}`} />
              {clearingRejected ? 'Menghapus...' : `Hapus Ditolak (${tokens.filter((t) => t.status === 'rejected').length})`}
            </Button>
            <Button
              size="sm"
              onClick={handleClearAll}
              disabled={clearingAll || tokens.length === 0}
              className="bg-red-600 text-white hover:bg-red-700 border-transparent"
            >
              <Trash2 className={`h-4 w-4 mr-2 ${clearingAll ? 'animate-pulse' : ''}`} />
              {clearingAll ? 'Menghapus semua...' : `Hapus Semua (${tokens.length})`}
            </Button>
          </div>
          {claimProgress && (claimProgress.running || claimProgress.processed > 0) && (() => {
            const p = claimProgress
            const pct = p.total > 0 ? Math.min(100, Math.round((p.processed / p.total) * 100)) : 0
            const sisa = p.etaMs >= 60000 ? `${Math.max(1, Math.ceil(p.etaMs / 60000))} mnt` : `${Math.max(1, Math.round(p.etaMs / 1000))} dtk`
            return (
              <div className="mt-2 rounded-lg border border-border/60 bg-card p-2">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span>{p.running ? 'Mengklaim poin…' : 'Klaim terakhir selesai'}</span>
                  <span className="font-mono">{p.processed}/{p.total} token</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className={`h-full transition-all ${p.running ? 'bg-primary' : 'bg-primary/50'}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                  <span>klaim {p.claimed}</span>
                  <span>sudah {p.already}</span>
                  <span className={p.failed > 0 ? 'text-red-500' : ''}>gagal {p.failed}</span>
                  {p.skipped > 0 && <span>dilewati {p.skipped}</span>}
                  {p.running && <span>sisa ± {sisa}</span>}
                </div>
              </div>
            )
          })()}
          <div className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
            Duplikat dan token kedaluwarsa otomatis dilewati. Maksimal {summary?.max ?? 1000} token. Klaim poin
            berjalan di latar belakang server (±2–4 detik per token — 1.000 token ± 40–70 menit), tahan restart:
            daftar "Klaim" tetap utuh walau halaman ditutup. Token yang ditolak permanen (invalid/dicabut) tidak
            dipakai lagi sampai dihapus dan diganti baru.
          </div>
        </div>
      </div>
    </Section>
  )
}

export default function AdminSystemSettings() {
  const [settings, setSettings] = useState<AppSettings>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Harga NexaBot punya jalur sendiri (`/api/admin/nexabot/config`) karena
  // nilainya dipakai langsung oleh perhitungan charge di server. Tiap varian
  // paket Unlimited (Mingguan/Bulanan/Tahunan) punya harga & durasi sendiri.
  // Input dikosongkan sampai server menjawab: nilai fallback bisa saja lebih
  // tua dari yang benar-benar berjalan.
  const [nbForm, setNbForm] = useState<{ price: string; packages: NexabotPackageForm[] }>({
    price: '',
    packages: [],
  })
  const [nbDefaults, setNbDefaults] = useState<{ price: number; packages: NexabotPackage[] }>({
    price: 150,
    packages: NB_PACKAGE_FALLBACKS,
  })
  const [nbActive, setNbActive] = useState<NexabotPricing | null>(null)
  const [nbSaving, setNbSaving] = useState(false)
  // Kalau muat harga gagal, simpan DIBEKUKAN: form mungkin memegang angka
  // lama/fallback, dan menyimpannya akan menimpa harga yang justru berjalan.
  const [nbLoadError, setNbLoadError] = useState<string | null>(null)
  // Harga semua provider (Seavi/PosBot/RunningHub/CreatePulse): disimpan di
  // app_settings, bisa diubah di sini tanpa deploy. Kejatuhan default = katalog
  // kode di shared/pricing.ts.
  const [ppData, setPpData] = useState<Record<PpProviderId, PpEffective> | null>(null)
  const [ppForms, setPpForms] = useState<Record<PpProviderId, PpFormState>>(ppFormAwal)
  const [ppSaving, setPpSaving] = useState<PpProviderId | null>(null)
  const [ppLoadError, setPpLoadError] = useState<string | null>(null)
  // Antrean submit NexaBot (khusus admin): batas submit bersamaan per akun
  // pool, ditampilkan berdampingan dengan jumlah akun supaya admin tidak
  // mengira angka itu menambah job yang benar-benar paralel.
  const [nbQueueInput, setNbQueueInput] = useState('')
  const [nbAkunPool, setNbAkunPool] = useState(0)
  const [nbQueueSaving, setNbQueueSaving] = useState(false)
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
  // AI ARKX AUTO Studio: kunci Gemini milik server + batas harian per member.
  const [studioKeyStatus, setStudioKeyStatus] = useState<{
    configured: boolean
    source: 'database' | 'env' | 'none'
    dailyCap: number
  } | null>(null)
  const [studioKeyInput, setStudioKeyInput] = useState('')
  const [studioKeySaving, setStudioKeySaving] = useState(false)
  const [studioCapInput, setStudioCapInput] = useState('')
  const [studioCapSaving, setStudioCapSaving] = useState(false)
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
      if (!res.ok) {
        // Jangan biarkan admin mengedit angka yang mungkin bukan yang berjalan:
        // tampilkan kegagalan dan bekukan tombol simpan sampai muat ulang berhasil.
        setNbLoadError(`Harga NexaBot gagal dimuat (HTTP ${res.status}) — angka yang tampil mungkin bukan yang sedang berlaku.`)
        return
      }
      const data = await res.json()
      setNbLoadError(null)
      const pricing: NexabotPricing = data.pricing
      setNbActive(pricing)
      if (data.defaults) {
        setNbDefaults({ price: data.defaults.price, packages: asPackages(data.defaults.packages) })
      }
      // Input diisi nilai efektif sekarang supaya admin lihat angka aslinya.
      setNbForm({ price: String(pricing.price), packages: toPackageForm(pricing.packages) })
      if (data.submit_concurrency !== undefined) {
        setNbQueueInput(String(data.submit_concurrency))
        setNbAkunPool(Number(data.akun_pool) || 0)
      }
    } catch (err: any) {
      setNbLoadError(`Harga NexaBot gagal dimuat (${String(err?.message || err).slice(0, 120)}) — angka yang tampil mungkin bukan yang sedang berlaku.`)
    }
  }, [token])

  const handleSaveNexabotQueue = async () => {
    if (!token) return
    setNbQueueSaving(true)
    try {
      const res = await fetch('/api/admin/nexabot/queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ concurrency: Number(nbQueueInput) }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message || 'Antrean submit NexaBot disimpan', 'success')
        setNbQueueInput(String(data.submit_concurrency))
        setNbAkunPool(Number(data.akun_pool) || 0)
      } else {
        addToast(data.error || 'Gagal menyimpan antrean submit NexaBot', 'error')
      }
    } catch {
      addToast('Gagal menyimpan antrean submit NexaBot', 'error')
    } finally {
      setNbQueueSaving(false)
    }
  }

  const fetchProviderPricing = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/admin/provider-pricing', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const providers = data.providers as Record<PpProviderId, PpEffective>
      setPpData(providers)
      setPpForms(() => {
        const next = { ...ppFormAwal }
        for (const p of PP_PROVIDERS) next[p.id] = ppFormDari(providers[p.id])
        return next
      })
      setPpLoadError(null)
    } catch (err: any) {
      setPpLoadError(String(err?.message || err).slice(0, 120))
    }
  }, [token])

  useEffect(() => { fetchProviderPricing() }, [fetchProviderPricing])

  const handleSavePp = async (provider: PpProviderId) => {
    setPpSaving(provider)
    try {
      const f = ppForms[provider]
      const body: Record<string, unknown> = { provider }
      if (f.flat !== '' && Number.isFinite(Number(f.flat))) body.flat = Number(f.flat)
      if (f.default !== '' && Number.isFinite(Number(f.default))) body.default = Number(f.default)
      const models: Record<string, number> = {}
      // Hanya kirim model yang harganya benar-benar diubah. Kalau semua harga
      // katalog ikut dikirim, semuanya jadi override dan perubahan katalog di
      // kode tidak akan pernah terpakai lagi.
      const baseline = ppData?.[provider]?.catalog || {}
      for (const [m, v] of Object.entries(f.models)) {
        const n = Number(v)
        if (v === '' || !Number.isFinite(n)) continue
        if (baseline[m] === n) continue
        models[m] = n
      }
      body.models = models
      const res = await fetch('/api/admin/provider-pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as any)?.error || 'Gagal menyimpan harga')
      setPpData(prev => (prev ? { ...prev, [provider]: (data as any).pricing } : prev))
      addToast(`Harga ${provider} tersimpan — langsung berlaku`, 'success')
    } catch (e: any) {
      addToast(String(e?.message || e).slice(0, 160), 'error')
    } finally {
      setPpSaving(null)
    }
  }

  const handleResetPp = async (provider: PpProviderId) => {
    if (!window.confirm(`Reset harga ${provider} ke bawaan kode? Override admin akan dibuang.`)) return
    try {
      const res = await fetch('/api/admin/provider-pricing/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as any)?.error || 'Gagal reset harga')
      const pricing = (data as any).pricing as PpEffective
      setPpData(prev => (prev ? { ...prev, [provider]: pricing } : prev))
      setPpForms(prev => ({ ...prev, [provider]: ppFormDari(pricing) }))
      addToast(`Harga ${provider} kembali ke bawaan`, 'success')
    } catch (e: any) {
      addToast(String(e?.message || e).slice(0, 160), 'error')
    }
  }

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
        setNbLoadError(null)
        setNbActive(data.pricing)
        setNbForm({ price: String(data.pricing.price), packages: toPackageForm(data.pricing.packages) })
      } else {
        addToast(data.error || 'Gagal menyimpan harga NexaBot', 'error')
        setNbLoadError(String(data.error || `Gagal menyimpan (HTTP ${res.status})`))
      }
    } catch {
      addToast('Gagal menyimpan harga NexaBot', 'error')
      setNbLoadError('Gagal menyimpan harga NexaBot — periksa koneksi lalu coba lagi.')
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

  const fetchStudioKeyStatus = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/admin/studio-ai/key', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      setStudioKeyStatus({
        configured: !!data.configured,
        source: data.source ?? 'none',
        dailyCap: Number(data.dailyCap) || 0,
      })
      setStudioCapInput(String(Number(data.dailyCap) || ''))
    } catch { /* biarkan status lama kalau request gagal */ }
  }, [token])

  useEffect(() => { fetchStudioKeyStatus() }, [fetchStudioKeyStatus])

  const handleSaveStudioKey = async () => {
    if (!token || !studioKeyInput.trim()) return
    setStudioKeySaving(true)
    try {
      const res = await fetch('/api/admin/studio-ai/key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ apiKey: studioKeyInput.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast('Kunci Gemini untuk AI Studio disimpan', 'success')
        setStudioKeyInput('')
        await fetchStudioKeyStatus()
      } else {
        addToast(data.error || 'Gagal menyimpan kunci Gemini', 'error')
      }
    } catch {
      addToast('Gagal menyimpan kunci Gemini', 'error')
    } finally {
      setStudioKeySaving(false)
    }
  }

  const handleClearStudioKey = async () => {
    if (!token) return
    if (!window.confirm('Hapus kunci Gemini server? AI Studio kembali meminta API key Gemini milik member masing-masing.')) return
    setStudioKeySaving(true)
    try {
      const res = await fetch('/api/admin/studio-ai/key', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok) {
        addToast('Kunci Gemini server dihapus', 'success')
        await fetchStudioKeyStatus()
      } else {
        addToast(data.error || 'Gagal menghapus kunci Gemini', 'error')
      }
    } catch {
      addToast('Gagal menghapus kunci Gemini', 'error')
    } finally {
      setStudioKeySaving(false)
    }
  }

  const handleSaveStudioCap = async () => {
    if (!token) return
    const cap = Number(studioCapInput)
    if (!Number.isFinite(cap) || cap < 1) {
      addToast('Batas harian harus angka minimal 1', 'error')
      return
    }
    setStudioCapSaving(true)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ settings: { studio_ai_daily_cap: String(Math.floor(cap)) } }),
      })
      if (res.ok) {
        addToast(`Batas harian AI Studio disetel ke ${Math.floor(cap)} panggilan`, 'success')
        await fetchStudioKeyStatus()
      } else {
        addToast('Gagal menyimpan batas harian', 'error')
      }
    } catch {
      addToast('Gagal menyimpan batas harian', 'error')
    } finally {
      setStudioCapSaving(false)
    }
  }

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
        body: JSON.stringify({ settings }),
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
        desc="Configure global application settings"
      />
      <PageContent>

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
            {nbForm.packages.length === 0 ? (
              <div className="rounded-xl border border-border bg-card/40 p-4 text-[12px] text-muted-foreground">
                {nbLoadError ? (
                  <>
                    <p className="text-red-400 font-medium">Harga gagal dimuat dari server.</p>
                    <p className="mt-1">{nbLoadError}</p>
                    <button
                      type="button"
                      onClick={fetchNexabotPricing}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground transition hover:bg-accent"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Muat ulang
                    </button>
                  </>
                ) : (
                  <p>Memuat harga dari server…</p>
                )}
              </div>
            ) : null}
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
                    {isBoosterPackage(p.slug) && (
                      <div className="mb-3 text-[11px] text-amber-500">
                        Premium Booster — membebaskan NexaDance 3.0, Omni Flash 1.2 (t2v/sfv/i2v/r2v/extend) &amp; GPT Image. Music dan TTS tetap dipotong harga per generate.
                      </div>
                    )}
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
            <Button size="sm" onClick={handleSaveNexabotPricing} disabled={nbSaving || !!nbLoadError || nbForm.packages.length === 0}>
              <Zap className={`h-4 w-4 mr-2 ${nbSaving ? 'animate-pulse' : ''}`} />
              {nbSaving ? 'Menyimpan...' : 'Simpan Harga NexaBot'}
            </Button>
            <button
              type="button"
              onClick={fetchNexabotPricing}
              disabled={nbSaving}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-60"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Muat ulang
            </button>
            <span className="text-[11px] text-muted-foreground">
              Aktif sekarang:{' '}
              {nbActive
                ? `Rp ${nbActive.price.toLocaleString('id-ID')}/generate · ${asPackages(nbActive.packages)
                    .map(p => `${p.label} Rp ${p.price.toLocaleString('id-ID')}/${p.days} hari`)
                    .join(' · ')}`
                : 'memuat...'}
            </span>
            {nbLoadError && (
              <p className="w-full text-[11px] font-medium text-red-400">
                {nbLoadError} Tombol simpan dibekukan sampai muat ulang berhasil.
              </p>
            )}
          </div>
        </Section>

        {/* Harga Token &amp; Wallet — semua provider tanpa deploy */}
        <Section
          title="Harga Token &amp; Wallet"
          sub="Tarif Seavi, PosBot, RunningHub &amp; CreatePulse per generate — berlaku langsung tanpa deploy"
        >
          {ppLoadError && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-400 flex flex-wrap items-center justify-between gap-2">
              <span>Gagal memuat harga dari server: {ppLoadError}</span>
              <button
                type="button"
                onClick={fetchProviderPricing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-2.5 py-1.5 text-[11px] font-medium text-red-300 transition hover:bg-red-500/10"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Muat ulang
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {PP_PROVIDERS.map((meta) => {
              const eff = ppData?.[meta.id]
              const form = ppForms[meta.id]
              const saving = ppSaving === meta.id
              const catalog = Object.entries(eff?.catalog || {}).sort(([a], [b]) => {
                if (meta.id === 'runninghub') {
                  const ia = RH_MODEL_ORDER.indexOf(a)
                  const ib = RH_MODEL_ORDER.indexOf(b)
                  const ra = ia === -1 ? 999 : ia
                  const rb = ib === -1 ? 999 : ib
                  return ra - rb || sortirCatalog(a, b)
                }
                return sortirCatalog(a, b)
              })
              const overrideCount = eff ? Object.keys(eff.models).length : 0
              const setModel = (m: string, v: string) =>
                setPpForms(prev => ({
                  ...prev,
                  [meta.id]: { ...prev[meta.id], models: { ...prev[meta.id].models, [m]: v } },
                }))
              const setFlat = (v: string) =>
                setPpForms(prev => ({ ...prev, [meta.id]: { ...prev[meta.id], flat: v } }))
              const setDefault = (v: string) =>
                setPpForms(prev => ({ ...prev, [meta.id]: { ...prev[meta.id], default: v } }))
              return (
                <div key={meta.id} className="rounded-xl border border-border bg-card/40 p-4 flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm">{meta.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {meta.desc}
                        {overrideCount > 0 ? ` · ${overrideCount} override admin` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleResetPp(meta.id)}
                      title="Kembali ke harga bawaan kode"
                      className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    >
                      Reset bawaan
                    </button>
                  </div>

                  {meta.flat ? (
                    <div className="mt-3">
                      <label className="block text-[11px] text-muted-foreground mb-1">Tarif flat ({meta.unit}) / generate</label>
                      <input
                        type="number"
                        min={1}
                        className="w-44 px-3 py-2 rounded-lg border border-border bg-card text-sm"
                        value={form.flat}
                        onChange={(e) => setFlat(e.target.value)}
                        placeholder="1500"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="mt-3">
                        <label className="block text-[11px] text-muted-foreground mb-1">
                          Harga default ({meta.unit}) — dipakai untuk model tanpa harga khusus
                        </label>
                        <input
                          type="number"
                          min={eff?.limits.min ?? 1}
                          max={eff?.limits.max ?? 10000000}
                          className="w-44 px-3 py-2 rounded-lg border border-border bg-card text-sm"
                          value={form.default}
                          onChange={(e) => setDefault(e.target.value)}
                          placeholder={eff ? String(eff.default ?? '') : ''}
                        />
                      </div>
                      <details className="mt-3 rounded-xl border border-border/70">
                        <summary className="cursor-pointer select-none px-3 py-2.5 text-[12px] text-muted-foreground">
                          Harga per model ({catalog.length}) — klik untuk buka &amp; edit
                        </summary>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2 p-3 max-h-96 overflow-auto border-t border-border/70">
                          {catalog.map(([m, v]) => (
                            <label key={m} className="flex items-center gap-2 text-[11px]">
                              {meta.id === 'runninghub' ? (
                                <span className="flex-1 min-w-0" title={m}>
                                  <span className="block truncate font-medium text-foreground/90">{RH_MODEL_LABELS[m] ?? m}</span>
                                  <span className="block truncate font-mono text-[9px] text-muted-foreground/70">{m}</span>
                                </span>
                              ) : (
                                <span className="flex-1 min-w-0 truncate text-muted-foreground font-mono" title={m}>{m}</span>
                              )}
                              <input
                                type="number"
                                min={eff?.limits.min ?? 1}
                                max={eff?.limits.max ?? 10000000}
                                className="w-20 px-2 py-1.5 rounded-lg border border-border bg-card text-[11px] text-right"
                                value={form.models[m] ?? String(v)}
                                onChange={(e) => setModel(m, e.target.value)}
                              />
                            </label>
                          ))}
                          {catalog.length === 0 && (
                            <div className="col-span-2 text-[11px] text-muted-foreground">Memuat katalog model dari server…</div>
                          )}
                        </div>
                      </details>
                    </>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => handleSavePp(meta.id)} disabled={saving || !eff}>
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      {saving ? 'Menyimpan...' : 'Simpan'}
                    </Button>
                    {eff && (
                      <span className="text-[11px] text-muted-foreground">
                        Efektif:{' '}
                        {meta.flat
                          ? `${meta.unit === 'Rp' ? 'Rp ' : ''}${Number(eff.flat ?? 0).toLocaleString('id-ID')}/generate`
                          : `${meta.unit === 'Rp' ? 'Rp ' : ''}${Number(eff.default ?? 0).toLocaleString('id-ID')} ${meta.unit === 'token' ? 'token' : ''} default`}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="text-[11px] text-muted-foreground mt-2">
            Harga tersimpan di database (app_settings) dan dipakai jalur potong saldo/token. Kosongkan field yang tidak ingin diubah;
            reset akan membuang semua override dan kembali ke bawaan kode.
          </div>
        </Section>

        {/* Antrean submit NexaBot — kapasitas nyata ada di jumlah akun pool */}
        <Section
          title="Antrean Submit NexaBot"
          sub="Berapa submit boleh jalan bersamaan per jalur kredensial — hanya admin yang melihatnya"
        >
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1">Submit bersamaan per akun (1–20)</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={nbQueueInput}
                  onChange={e => setNbQueueInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                  placeholder="1"
                />
              </div>
              <div>
                <div className="block text-[11px] text-muted-foreground mb-1">Job yang bisa benar-benar paralel</div>
                <div className="px-3 py-2 rounded-lg border border-border bg-card text-sm font-semibold">
                  {nbAkunPool} akun di pool server
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={handleSaveNexabotQueue} disabled={nbQueueSaving || nbQueueInput === ''}>
                <Zap className={`h-4 w-4 mr-2 ${nbQueueSaving ? 'animate-pulse' : ''}`} />
                {nbQueueSaving ? 'Menyimpan...' : 'Simpan Antrean Submit'}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Naikkan angka ini hanya menambah slot antrean per akun. Satu akun NexaBot tetap
                hanya menjalankan satu job, jadi paralelitas nyata = jumlah akun pool.
              </span>
            </div>
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

        {/* AI ARKX AUTO Studio (Gemini) */}
        <Section
          title="AI ARKX AUTO Studio (Gemini)"
          sub="Kunci Gemini milik server untuk transkripsi, caption, dan voice-over di /studio — member Pro tidak perlu API key sendiri"
        >
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Status kunci:</span>
              {studioKeyStatus?.configured ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] text-emerald-400">
                  <CheckCircle className="h-3 w-3" />
                  Aktif — {studioKeyStatus.source === 'database' ? 'dari dashboard' : 'dari .env'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 text-[11px] text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  Belum diatur — AI Studio hanya jalan dengan API key Gemini milik member
                </span>
              )}
            </div>

            <p className="mt-2 text-[12px] text-muted-foreground leading-relaxed">
              Relay <code>/api/public/studio-ai</code> memakai kunci ini untuk member <b>Pro / Unlimited</b>
              (admin bebas). Nilainya disimpan di database, tidak pernah ditampilkan lagi, dan tidak pernah
              dikirim ke browser. Member yang sudah punya API key sendiri tetap memakai kuncinya.
            </p>

            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <input
                type="password"
                value={studioKeyInput}
                onChange={e => setStudioKeyInput(e.target.value)}
                placeholder="Tempel API key Gemini (AIza... atau AQ.…)"
                autoComplete="off"
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-sm font-mono"
              />
              <Button size="sm" onClick={handleSaveStudioKey} disabled={studioKeySaving || !studioKeyInput.trim()}>
                <KeyRound className={`h-4 w-4 mr-2 ${studioKeySaving ? 'animate-pulse' : ''}`} />
                {studioKeySaving ? 'Menyimpan...' : 'Simpan Kunci'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleClearStudioKey}
                disabled={studioKeySaving || !studioKeyStatus?.configured || studioKeyStatus?.source === 'env'}
                title={studioKeyStatus?.source === 'env' ? 'Kunci berasal dari .env — hapus variabelnya di server' : undefined}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Hapus
              </Button>
            </div>

            <div className="mt-4 flex flex-col sm:flex-row sm:items-end gap-2">
              <div className="flex-1">
                <label className="block text-[11px] font-medium mb-1">Batas panggilan AI per member per hari</label>
                <input
                  type="number"
                  min={1}
                  value={studioCapInput}
                  onChange={e => setStudioCapInput(e.target.value)}
                  className="w-full sm:w-40 px-3 py-2 rounded-lg border border-border bg-card text-sm"
                />
              </div>
              <Button size="sm" variant="outline" onClick={handleSaveStudioCap} disabled={studioCapSaving}>
                {studioCapSaving ? 'Menyimpan...' : 'Simpan Batas'}
              </Button>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
              Satu panggilan = satu transkripsi/plan/voice-over. Lewat batas ini relay menjawab 429 dan
              Studio beralih menampilkan pesan kuota, bukan error jaringan.
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

        <ProviderServerKeySection provider="seavi" label="Seavi Labs" token={token} addToast={addToast} />

        <ProviderServerKeySection provider="posbot" label="PosBot" token={token} addToast={addToast} />

        <RunningHubPoolSection token={token} addToast={addToast} />

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
