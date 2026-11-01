import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { Zap, Clock, CheckCircle, ExternalLink, Copy, Rocket, Film, ImageIcon, Video } from 'lucide-react'
import { DANA_NUMBER, DANA_NAME, adminWhatsappLink, formatRp } from '@/lib/payment'
import { PaymentMethodToggle, QrisPanel } from '@/components/QrisPayment'
import {
  fetchNexabotWallet,
  nexabotRemainingLabel,
  isBoosterPackage,
  NEXABOT_BOOSTER_COVERAGE,
  NEXABOT_BOOSTER_SLUG,
  type NexabotWallet,
} from '@/lib/nexabotWallet'

interface Topup {
  id: number
  amount: number
  status: 'pending' | 'approved' | 'rejected'
  kind: 'balance' | 'unlimited'
  days: number
  package_slug?: string
  expires_at: string | null
  created_at: string
}

/** Harga Booster kalau server belum sempat menjawab — hanya tampilan. */
const BOOSTER_PRICE_FALLBACK = 15000

const COVERAGE_ICONS = [Video, Film, ImageIcon]

export default function PremiumBoosterPage() {
  const { token } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const [wallet, setWallet] = useState<NexabotWallet | null>(null)
  const [topups, setTopups] = useState<Topup[]>([])
  const [step, setStep] = useState<'select' | 'pay' | 'confirm'>('select')
  const [payMethod, setPayMethod] = useState<'dana' | 'qris'>('dana')
  const [proofNote, setProofNote] = useState('')
  const [loading, setLoading] = useState(false)

  const API = '/api/nexabot'
  const headers = useMemo(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token])

  const paket = (wallet?.packages || []).find((p) => isBoosterPackage(p.slug))
  const slug = paket?.slug || NEXABOT_BOOSTER_SLUG
  const harga = paket?.price ?? BOOSTER_PRICE_FALLBACK
  const hari = paket?.days ?? 1
  const boosterPass = wallet?.booster_unlimited
  const unlimited = wallet?.unlimited
  const perHari = Math.round(harga / Math.max(1, hari))
  const pending = topups.some((t) => t.kind === 'unlimited' && t.status === 'pending' && isBoosterPackage(t.package_slug))

  const fetchAll = useCallback(async () => {
    if (!token) return
    const [w] = await Promise.all([
      fetchNexabotWallet(token),
      fetch(`${API}/topups/mine`, { headers })
        .then((r) => r.json())
        .then((d) => setTopups(d.topups || []))
        .catch(() => {}),
    ])
    if (w) setWallet(w)
  }, [token, headers])

  useEffect(() => { fetchAll() }, [fetchAll])

  const buy = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/package`, {
        method: 'POST',
        headers,
        // Nominal ditentukan server dari slug — klien tidak mengirim amount.
        body: JSON.stringify({ slug, proof_note: proofNote }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(`Premium Booster ${formatRp(harga)} diajukan — menunggu approval admin`, 'success')
        setStep('confirm')
        fetchAll()
      } else {
        addToast(data.error || 'Gagal mengajukan Booster', 'error')
      }
    } catch {
      addToast('Network error', 'error')
    }
    setLoading(false)
  }

  const copyNumber = () => {
    navigator.clipboard.writeText(DANA_NUMBER)
    addToast('Nomor DANA disalin', 'info')
  }

  const formatDate = (value: string | null) => {
    if (!value) return '-'
    const iso = value.includes('T') ? value : value.replace(' ', 'T') + 'Z'
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return value
    return d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })
  }

  const waLink = adminWhatsappLink(`Halo admin, saya ingin beli Premium Booster NexaBot ${hari} hari (${formatRp(harga)})`)

  return (
    <PageContent>
      <PageHeader
        eyebrow="NexaBot"
        title="Premium"
        highlight="Booster"
        desc={`Satu hari tanpa potongan saldo untuk ${NEXABOT_BOOSTER_COVERAGE.join(', ')} — cocok untuk batch produksi banyak konten sekaligus.`}
      />

      {/* Status aktif */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 grid place-items-center">
              <Rocket className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Premium Booster</div>
              <div className="text-2xl font-bold">{formatRp(harga)} / {hari} hari</div>
            </div>
          </div>
          {unlimited?.active ? (
            <Badge variant="success">
              <Zap className="h-3 w-3 mr-1" />
              Unlimited semua mode aktif · sisa {nexabotRemainingLabel(unlimited)}
            </Badge>
          ) : boosterPass?.active ? (
            <Badge variant="success">
              <Zap className="h-3 w-3 mr-1" />
              Booster aktif · sisa {nexabotRemainingLabel(boosterPass)}
            </Badge>
          ) : (
            <Badge variant="outline">Belum aktif</Badge>
          )}
        </div>

        {unlimited?.active ? (
          <div className="mt-3 text-[11px] text-emerald-500">
            Paket Unlimited semua mode sedang aktif sampai {formatDate(unlimited.expires_at)} — semua generate, termasuk tiga keluarga di bawah, sudah gratis. Booster tidak diperlukan saat ini.
          </div>
        ) : boosterPass?.active ? (
          <div className="mt-3 text-[11px] text-emerald-500">
            Booster berlaku sampai {formatDate(boosterPass.expires_at)} — Seedance 2.5, Omni Flash 1.1, dan GPT Image 2.5 gratis selama masa aktif. Mode lain tetap {formatRp(wallet?.price ?? 150)}/generate dari saldo.
          </div>
        ) : (
          <div className="mt-3 text-[11px] text-muted-foreground">
            Mode di luar daftar tetap {formatRp(wallet?.price ?? 150)}/generate dari saldo NexaBot.
          </div>
        )}
      </div>

      {/* Cakupan */}
      <Section title="Yang dibebaskan Booster" sub="Tiga keluarga generate — ditegakkan server, bukan tampilan klien">
        <div className="grid sm:grid-cols-3 gap-3">
          {NEXABOT_BOOSTER_COVERAGE.map((nama, i) => {
            const Icon = COVERAGE_ICONS[i] || Zap
            return (
              <div key={nama} className="rounded-xl border border-border bg-card/40 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-sm">{nama}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {i === 0 && 'Video 4s, 15s & 30s dari halaman Image to Video — tanpa potong kredit upstream.'}
                  {i === 1 && 'Semua mode video NexaBot: t2v, sfv, i2v, r2v (AI Video Edit) dan extend — tanpa potong kredit upstream.'}
                  {i === 2 && 'GPT Image 2.5 dari halaman Edit Image — tanpa potong kredit upstream.'}
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">
          Music dan TTS tidak termasuk — Booster dijual sebagai paket visual, jadi keduanya tetap memotong saldo.
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">
          Seedance 2.5 dibatasi <b className="text-foreground">5 video per hari</b> per akun — biaya kredit upstream model ini selalu ditanggung server, jadi jatahnya dibatasi agar tetap tersedia untuk semua member. Omni Flash 1.1 dan GPT Image tanpa batas harian.
        </div>
      </Section>

      {step === 'select' && (
        <Section title="Ambil Booster" sub={boosterPass?.active ? `Perpanjang — masa berlaku baru dihitung dari expiry saat ini` : `Bayar ${formatRp(harga)}${hari > 1 ? ` untuk ${hari} hari` : ' untuk 1 hari'} · ≈ ${formatRp(perHari)}/hari`}>
          <div className="flex flex-wrap items-center gap-3">
            {pending ? (
              <Badge variant="warning"><Clock className="h-3 w-3 mr-1" /> Pengajuan Booster menunggu approval</Badge>
            ) : (
              <Button onClick={() => { setProofNote(''); setStep('pay') }}>
                {boosterPass?.active ? 'Perpanjang Booster' : `Beli Booster ${formatRp(harga)}`}
              </Button>
            )}
            <a href="/topup/nexabot" className="text-xs text-primary hover:underline font-medium">
              Top up saldo / paket Unlimited →
            </a>
          </div>
        </Section>
      )}

      {step === 'pay' && (
        <Section
          title={payMethod === 'qris' ? 'Pembayaran via QRIS' : 'Pembayaran via DANA'}
          sub={`Premium Booster ${hari} hari — ${formatRp(harga)}`}
        >
          <PaymentMethodToggle value={payMethod} onChange={setPayMethod} />

          {payMethod === 'qris' && <QrisPanel amountLabel={`Premium Booster · ${formatRp(harga)}`} />}

          {payMethod === 'dana' && (
            <div className="rounded-xl border border-border bg-card/50 p-5 mb-4 mt-4">
              <div className="text-center mb-4">
                <div className="text-sm text-muted-foreground mb-1">Transfer ke:</div>
                <div className="text-xl font-bold">💜 DANA</div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-background">
                  <div>
                    <div className="text-xs text-muted-foreground">Nomor HP</div>
                    <div className="font-mono font-bold text-lg">{DANA_NUMBER}</div>
                  </div>
                  <button onClick={copyNumber} className="p-2 rounded-lg hover:bg-accent transition">
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <div className="p-3 rounded-lg bg-background">
                  <div className="text-xs text-muted-foreground">Atas Nama</div>
                  <div className="font-medium">{DANA_NAME}</div>
                </div>
                <div className="p-3 rounded-lg bg-background">
                  <div className="text-xs text-muted-foreground">Jumlah Transfer (Premium Booster {hari} hari)</div>
                  <div className="font-bold text-primary text-lg">{formatRp(harga)}</div>
                </div>
              </div>
            </div>
          )}

          <div className="mb-4">
            <label className="text-sm font-medium mb-1 block">Catatan (opsional)</label>
            <input
              type="text"
              value={proofNote}
              onChange={(e) => setProofNote(e.target.value)}
              placeholder="Contoh: an. Ahmad"
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep('select')} className="flex-1">Kembali</Button>
            <Button onClick={buy} disabled={loading} className="flex-1">
              {loading ? 'Mengirim...' : payMethod === 'qris' ? 'Sudah Bayar' : 'Sudah Transfer'}
            </Button>
          </div>

          <div className="mt-4 text-center">
            <a href={waLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-emerald-500 hover:underline">
              <ExternalLink className="h-4 w-4" />
              Hubungi Admin via WhatsApp
            </a>
          </div>
        </Section>
      )}

      {step === 'confirm' && (
        <Section title="Menunggu Approval" sub="Pengajuan Booster kamu sedang diproses admin">
          <div className="text-center py-8">
            <div className="text-5xl mb-4">⏳</div>
            <div className="text-lg font-medium mb-2">Premium Booster menunggu approval</div>
            <div className="text-sm text-muted-foreground mb-4">
              Booster aktif otomatis setelah admin menyetujui pembayaran — Seedance 2.5, Omni Flash 1.1 &amp; GPT Image langsung bebas potongan saldo.
              <br />Hubungi admin jika sudah transfer.
            </div>
            <a href={waLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-500 text-sm font-medium hover:bg-emerald-500/20 transition">
              <ExternalLink className="h-4 w-4" />
              Konfirmasi via WhatsApp
            </a>
            <div className="mt-4">
              <Button variant="outline" onClick={() => { setStep('select'); fetchAll() }}>Kembali</Button>
            </div>
          </div>
        </Section>
      )}

      {/* Riwayat Booster */}
      {topups.some((t) => t.kind === 'unlimited' && isBoosterPackage(t.package_slug)) && (
        <Section title="Riwayat Booster" sub="Pengajuan Premium Booster">
          <div className="space-y-2">
            {topups
              .filter((t) => t.kind === 'unlimited' && isBoosterPackage(t.package_slug))
              .slice(0, 8)
              .map((t) => (
                <div key={t.id} className="flex items-center justify-between p-3 rounded-xl border border-border bg-card/30">
                  <div>
                    <div className="text-sm font-medium">{formatRp(t.amount)} · {t.days} hari</div>
                    <div className="text-[11px] text-muted-foreground">{formatDate(t.created_at)}</div>
                  </div>
                  {t.status === 'approved' ? (
                    <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" /> Disetujui</Badge>
                  ) : t.status === 'rejected' ? (
                    <Badge variant="destructive"><Clock className="h-3 w-3 mr-1" /> Ditolak</Badge>
                  ) : (
                    <Badge variant="warning"><Clock className="h-3 w-3 mr-1" /> Pending</Badge>
                  )}
                </div>
              ))}
          </div>
        </Section>
      )}
    </PageContent>
  )
}
