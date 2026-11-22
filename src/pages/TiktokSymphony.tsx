import { useCallback, useEffect, useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge, ProgressBar, Dropzone } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { uploadToCatbox } from '@/lib/roboneo'
import { addResult, persistResultToR2, type CompletedResult } from '@/lib/backgroundTasks'
import { formatRp } from '@/lib/payment'
import { useTiktokPricing, ttModelPrice, TIKTOK_MIN_TOPUP } from '@/lib/tiktokSymphony'
import { tiktokCreateTask, tiktokPollTask } from '@/lib/tiktokGenerate'
import { Link } from 'react-router-dom'
import {
  Music2,
  Loader2,
  ImagePlus,
  Sparkles,
  Wallet,
  RefreshCw,
  Download,
  ExternalLink,
} from 'lucide-react'

const RATIOS = ['9:16', '16:9', '1:1', '4:3']
const DURATIONS = [5, 10, 15]
const MODEL = 'SEEDANCE_2_0_FAST'

export default function TiktokSymphonyPage() {
  const { token, user } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const pricing = useTiktokPricing()
  const cost = ttModelPrice(pricing, MODEL)

  const [prompt, setPrompt] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [ratio, setRatio] = useState('9:16')
  const [duration, setDuration] = useState(5)
  const [balance, setBalance] = useState(0)
  const [loadingBalance, setLoadingBalance] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [pct, setPct] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [results, setResults] = useState<CompletedResult[]>([])

  const loadBalance = useCallback(async () => {
    if (!token) { setLoadingBalance(false); return }
    setLoadingBalance(true)
    try {
      const res = await fetch('/api/tiktok-symphony/balance', { headers: { Authorization: `Bearer ${token}` } })
      const d = await res.json()
      setBalance(d.balance || 0)
    } catch { /* biarkan saldo 0 */ } finally { setLoadingBalance(false) }
  }, [token])

  useEffect(() => { void loadBalance() }, [loadBalance])

  const addLog = (msg: string) => setLogs((prev) => [...prev.slice(-30), msg])
  const isAdmin = user?.role === 'admin'

  const generate = async () => {
    if (!token) { addToast('Login dulu ya', 'error'); return }
    if (!prompt.trim()) { addToast('Prompt wajib diisi', 'error'); return }
    if (!isAdmin && balance < cost) {
      addToast(`Saldo TikTok tidak cukup — top up minimal ${formatRp(TIKTOK_MIN_TOPUP)}`, 'error')
      return
    }
    setGenerating(true)
    setPct(0)
    setLogs([])
    let chargeUsageId: number | undefined
    let taskId = ''
    try {
      if (!isAdmin) {
        setStatusText('Memotong saldo…')
        const dr = await fetch('/api/tiktok-symphony/deduct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ model: MODEL }),
        })
        const dd = await dr.json()
        if (!dr.ok) throw new Error(dd.error || 'Gagal memotong saldo')
        setBalance(dd.balance)
        chargeUsageId = dd.usage_id
        addLog(`💰 Saldo terpotong ${formatRp(dd.deducted)} — sisa ${formatRp(dd.balance)}`)
      } else {
        addLog('⚡ Mode admin — saldo tidak dipotong')
      }

      let imageUrl: string | undefined
      if (image) {
        setStatusText('Mengunggah gambar…')
        imageUrl = await uploadToCatbox(image)
        addLog('✅ Gambar diunggah')
      }

      setStatusText('Mengirim ke TikTok Symphony…')
      setPct(15)
      taskId = await tiktokCreateTask({
        token,
        prompt: prompt.trim(),
        model: MODEL,
        imageUrl,
        duration,
        ratio,
        onLog: addLog,
      })
      addLog(`✅ Task dibuat: ${taskId.slice(0, 16)}…`)
      const url = await tiktokPollTask(token, taskId, {
        onLog: addLog,
        onStatus: (text, p) => { setStatusText(text); setPct(p) },
      })
      const item: CompletedResult = {
        id: `tt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        url,
        prompt: prompt.trim(),
        date: new Date().toISOString(),
        page: 'video-edit',
        provider: 'tiktok',
        model: 'Seedance 2.0 Fast (TikTok)',
        ratio,
        duration,
        credits: cost,
      }
      addResult(item, { notify: false })
      setResults((prev) => [item, ...prev])
      persistResultToR2(item.id, url)
      setStatusText('✅ Selesai!')
      setPct(100)
      addToast('Video berhasil dibuat', 'success')
    } catch (e: any) {
      addLog(`❌ ${e?.message || 'Gagal'}`)
      if (!isAdmin) {
        const refundBody = chargeUsageId != null ? { usage_id: chargeUsageId } : taskId ? { task_id: taskId } : null
        if (refundBody) {
          try {
            const rr = await fetch('/api/tiktok-symphony/refund', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify(refundBody),
            })
            if (rr.ok) {
              const rd = await rr.json()
              setBalance(rd.balance)
              addLog(`💸 Saldo dikembalikan ${formatRp(rd.refunded)}`)
            }
          } catch { /* refund gagal — log saja */ }
        }
      }
      addToast(e?.message || 'Generate gagal', 'error')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="GENERATE · TIKTOK"
        title="TikTok"
        highlight="Symphony"
        desc="Seedance 2.0 Fast lewat API resmi TikTok. Kredensial diatur admin — cukup pakai saldo TikTok kamu."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant="default" className="gap-1.5 px-3 py-1.5">
          <Music2 className="h-3.5 w-3.5" /> Seedance 2.0 Fast · PAID_TOKENS
        </Badge>
        <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
          <Wallet className="h-3.5 w-3.5" />
          {loadingBalance ? 'Muat saldo…' : `Saldo ${formatRp(balance)}`}
        </Badge>
        <button onClick={() => void loadBalance()} className="text-xs text-muted-foreground hover:text-foreground">
          <RefreshCw className="mr-1 inline h-3 w-3" /> refresh
        </button>
        <Link to="/topup/tiktok" className="ml-auto text-xs font-semibold text-primary hover:underline">
          Top up saldo →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Section title="Prompt" icon={<Sparkles className="h-4 w-4" />} sub="Jelaskan video yang kamu mau — bahasa Indonesia didukung">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Contoh: Gadis berdiri di depan patung, kamera slow motion, cahaya keemasan…"
              className="min-h-[140px] w-full rounded-xl border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </Section>

          <Section title="Gambar Awal (opsional)" icon={<ImagePlus className="h-4 w-4" />} sub="Tanpa gambar = text-to-video">
            <Dropzone accept="image/*" onFile={(f) => setImage(f || null)} className="min-h-[132px]">
              {image ? (
                <div className="text-sm font-medium">{image.name}</div>
              ) : (
                <div className="text-center text-xs text-muted-foreground">Klik atau drop gambar di sini</div>
              )}
            </Dropzone>
          </Section>

          <Section title="Rasio & Durasi" icon={<Music2 className="h-4 w-4" />}>
            <div className="flex flex-wrap gap-2">
              {RATIOS.map((r) => (
                <button key={r} onClick={() => setRatio(r)} className={`rounded-lg border px-3 py-1.5 text-xs ${ratio === r ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>{r}</button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {DURATIONS.map((d) => (
                <button key={d} onClick={() => setDuration(d)} className={`rounded-lg border px-3 py-1.5 text-xs ${duration === d ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>{d} detik</button>
              ))}
            </div>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Generate" icon={<Sparkles className="h-4 w-4" />} sub={`Biaya ${formatRp(cost)} per video${isAdmin ? ' · admin: gratis' : ''}`}>
            <Button className="w-full" size="lg" onClick={generate} disabled={generating}>
              {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {generating ? statusText || 'Memproses…' : `Buat Video · ${formatRp(cost)}`}
            </Button>
            {generating && <ProgressBar className="mt-3" value={pct} label={statusText} />}
            {logs.length > 0 && (
              <div className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-border bg-background/50 p-2 font-mono text-[10px] text-muted-foreground">
                {logs.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}
          </Section>

          <Section title="Hasil" icon={<Download className="h-4 w-4" />} sub="Video tersimpan otomatis di galeri">
            {results.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Belum ada hasil — buat video pertamamu.</p>
            ) : (
              <div className="space-y-3">
                {results.map((r) => (
                  <div key={r.id} className="rounded-xl border border-border p-3">
                    <video src={r.url} controls className="w-full rounded-lg" />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">{r.prompt}</span>
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs font-semibold text-primary hover:underline">
                        <ExternalLink className="mr-1 inline h-3 w-3" /> Buka
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </PageContent>
  )
}
