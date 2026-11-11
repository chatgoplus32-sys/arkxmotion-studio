import { useState, useRef, useEffect, useMemo } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, EmptyState } from '@/components/ui'
import { LogDetailActions } from '@/components/ui/LogDetailActions'
import { Loader2, Download, ImageIcon, Sparkles, CheckCircle2, AlertCircle, Clock, Copy, Trash2, Plus, X } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import {
  posbotModelsByCategory,
  buildPosbotPayload,
  generateWithPosbot,
  formatPosbotRupiah,
  posbotModeSummary,
  type PosbotModelSpec,
} from '@/lib/posbot'
import { fetchPosbotWallet, chargePosbotWallet, refundPosbotWallet, type PosbotWallet } from '@/lib/posbotWallet'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { uploadToCatbox, normalizeImage } from '@/lib/roboneo'
import { logGenerationStart, logGenerationComplete, logGenerationFailed } from '@/lib/generationLog'
import { addResult, startGenerationTask, removeActiveTask } from '@/lib/backgroundTasks'
import { usePageActive } from '@/hooks/usePageActive'

// Mesin image PosBot (Nano Banana, GPT Image, Flux, Seedream, Qwen, Imagen, Grok).
const MODELS = posbotModelsByCategory('image')
const DEFAULT_MODEL = MODELS[0]?.id ?? 'nano_banana_2_4k'

interface HistoryItem {
  time: string
  jobId: string
  model: string
  prompt: string
  url: string
}

interface LogEntry {
  time: string
  msg: string
  level: 'info' | 'warn' | 'error' | 'success' | 'debug'
}

export default function ImageStudioPage() {
  const addToast = useToastStore((s) => s.addToast)
  const { token: authToken, user } = useAuthStore()

  const [modelId, setModelId] = useState(DEFAULT_MODEL)
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [refs, setRefs] = useState<File[]>([])
  const refPreviews = useMemo(() => refs.map((f) => URL.createObjectURL(f)), [refs])

  const [loading, setLoading] = useState(false)
  const [taskStatus, setTaskStatus] = useState<'idle' | 'submitting' | 'running' | 'success' | 'error'>('idle')
  const [statusText, setStatusText] = useState('')
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wallet, setWallet] = useState<PosbotWallet | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const spec: PosbotModelSpec = MODELS.find((m) => m.id === modelId) ?? MODELS[0]
  const refMax = spec.imageMode === 'none' ? 0 : spec.imageMax ?? 0
  const refMin = spec.imageMode === 'single' ? 1 : 0

  const addLog = (msg: string, level: LogEntry['level'] = 'info') => {
    const time = new Date().toLocaleTimeString('id-ID')
    setLogs((prev) => [...prev, { time, msg, level }].slice(-200))
  }
  const clearLogs = () => setLogs([])

  useEffect(() => {
    if (!authToken) return
    fetchPosbotWallet(authToken).then((w) => { if (w) setWallet(w) }).catch(() => {})
  }, [authToken])

  // Bersihkan preview object URL saat ganti file / unmount (hindari leak memori).
  useEffect(() => () => refPreviews.forEach((u) => URL.revokeObjectURL(u)), [refPreviews])

  // Saat ganti model yang menolak gambar, kosongkan referensi.
  useEffect(() => {
    if (refMax === 0 && refs.length > 0) setRefs([])
    else if (refs.length > refMax) setRefs(refs.slice(0, refMax))
  }, [refMax]) // eslint-disable-line react-hooks/exhaustive-deps

  const isAdmin = user?.role === 'admin'
  const enough = isAdmin || !wallet || (wallet.balance ?? 0) >= spec.price
  const refsOk = refs.length >= refMin && refs.length <= refMax
  const canRun = !!prompt.trim() && !!authToken && !loading && enough && refsOk

  const addRefFiles = (files: FileList | null) => {
    if (!files || refMax === 0) return
    const picked = Array.from(files).filter((f) => f.type.startsWith('image/'))
    setRefs((prev) => [...prev, ...picked].slice(0, refMax))
  }
  const removeRef = (i: number) => setRefs((prev) => prev.filter((_, idx) => idx !== i))

  const runImage = async () => {
    if (!authToken) {
      addToast('⚠️ Login dulu untuk memakai AI Image Studio.', 'warning')
      return
    }
    if (!prompt.trim()) {
      addToast('⚠️ Tulis prompt gambar yang mau dibuat dulu!', 'warning')
      return
    }
    if (!refsOk) {
      addToast(`⚠️ ${spec.label} membutuhkan ${refMin}-${refMax} gambar referensi (saat ini ${refs.length}).`, 'warning')
      return
    }
    if (!isAdmin && wallet && (wallet.balance ?? 0) < spec.price) {
      addToast(`⚠️ Saldo PosBot tidak cukup (${formatPosbotRupiah(wallet.balance ?? 0)}, butuh ${formatPosbotRupiah(spec.price)}). Top up di Top Up PosBot.`, 'warning')
      return
    }

    setLoading(true)
    setError(null)
    setResultUrl(null)
    setTaskStatus('submitting')
    setStatusText('Menyiapkan...')
    setLogs([])

    const trackId = startGenerationTask({
      page: 'image-studio',
      model: spec.label,
      prompt: prompt.trim().slice(0, 500),
      provider: 'posbot',
    })

    const startTime = Date.now()
    const promptText = prompt.trim()
    const negativeText = negativePrompt.trim()
    addLog(`🖼️ AI Image Studio — ${spec.label} · ${posbotModeSummary(spec)} (${formatPosbotRupiah(spec.price)})`, 'info')

    try {
      // [1/3] Unggah gambar referensi → URL host (dipakai PosBot upstream).
      let imageUrls: string[] = []
      if (refs.length > 0) {
        setStatusText('Mengunggah gambar referensi...')
        for (let i = 0; i < refs.length; i++) {
          const norm = await normalizeImage(refs[i])
          const url = await uploadToCatbox(norm, 'image', (msg, pct) => setStatusText(`Upload ref ${i + 1}/${refs.length}${pct != null ? ` ${pct}%` : ''}`))
          imageUrls.push(url)
          addLog(`📤 Ref #${i + 1} terunggah ✓`, 'success')
        }
      }

      // Validasi kontrak SEBELUM saldo dipotong (sama seperti Motion Control).
      buildPosbotPayload(spec, {
        prompt: promptText,
        imageUrl: imageUrls[0],
        imageUrls: imageUrls.length > 1 ? imageUrls : undefined,
        aspectRatio: aspect || undefined,
        negativePrompt: negativeText || undefined,
      })

      const logId = await logGenerationStart({
        page: 'image-studio',
        provider: 'posbot',
        model: spec.id,
        prompt: promptText.slice(0, 500),
        credits: 0,
        slot_count: 1,
      })

      try {
        const rotation = await withTokenRotation<{ url?: string; error?: string }>(
          'posbot',
          async (apiKey) => {
            let batchId: string | null = null
            let chargeId: number | null = null
            if (!isAdmin && authToken) {
              const charge = await chargePosbotWallet(authToken, spec.id, 1)
              batchId = charge.batchId
              chargeId = charge.usageId ?? null
              setWallet((w) => (w ? { ...w, balance: charge.balance } : w))
              addLog(`💰 ${formatPosbotRupiah(charge.deducted)} dipotong · sisa ${formatPosbotRupiah(charge.balance)}`, 'info')
            }
            try {
              setTaskStatus('running')
              setStatusText('Submit ke PosBot...')
              const url = await generateWithPosbot({
                apiKey,
                chargeId,
                spec,
                prompt: promptText,
                imageUrl: imageUrls[0],
                imageUrls: imageUrls.length > 1 ? imageUrls : undefined,
                aspectRatio: aspect || undefined,
                negativePrompt: negativeText || undefined,
                onLog: addLog,
                onStatus: (text, pct) => setStatusText(`${text} ${Math.round(pct || 0)}%`),
              })
              return { url }
            } catch (slotErr: any) {
              if (batchId && authToken) {
                const refunded = await refundPosbotWallet(authToken, { batch_id: batchId })
                if (refunded != null) {
                  setWallet((w) => (w ? { ...w, balance: refunded } : w))
                  addLog(`↩️ Saldo dikembalikan (refund) ✓ sisa ${formatPosbotRupiah(refunded)}`, 'warn')
                }
              }
              if (detectTokenError('posbot', slotErr)) throw slotErr
              return { error: slotErr?.message || 'AI Image Studio gagal' }
            }
          },
          {
            allowServerKey: true,
            onKeySwitch: (from, to, attempt) => {
              addLog(`🔄 Kunci "${from.name || from.id}" gagal, pindah ke key #${attempt}: "${to.name || to.id}"`, 'warn')
            },
            onError: (err, key) => {
              if (detectTokenError('posbot', err)) addLog(`⚠️ Key "${key.name || key.id}" bermasalah: ${err.message}`, 'warn')
            },
          },
        )

        const outcome = rotation.ok ? rotation.result : undefined
        if (!outcome?.url) throw new Error(outcome?.error || rotation.error || 'AI Image Studio gagal')

        const url = outcome.url
        setResultUrl(url)
        setTaskStatus('success')
        setStatusText('')
        addLog(`✅ Selesai ✓ ${url.slice(0, 60)}...`, 'success')
        const tid = `image-studio-${Date.now()}`
        addResult({
          id: tid,
          url,
          prompt: promptText.slice(0, 500),
          date: new Date().toISOString(),
          page: 'image-studio',
          kind: 'image',
          provider: 'posbot',
          model: spec.label,
        })
        setHistory((prev) => [
          { time: new Date().toLocaleTimeString('id-ID'), jobId: tid, model: spec.label, prompt: promptText, url },
          ...prev,
        ])
        if (logId) logGenerationComplete(logId, { status: 'completed', result_url: url, duration_ms: Date.now() - startTime })
        addToast('✅ AI Image Studio selesai!', 'success')
      } catch (e: any) {
        if (logId) logGenerationFailed(logId, e.message || 'Unknown error', Date.now() - startTime)
        throw e
      }
    } catch (e: any) {
      setTaskStatus('error')
      setError(e.message || 'Unknown error')
      addLog(`❌ Gagal: ${e.message || e}`, 'error')
      addToast(`❌ ${e.message || 'AI Image Studio gagal'}`, 'error')
    } finally {
      removeActiveTask(trackId)
      setLoading(false)
    }
  }

  const pageActive = usePageActive()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pageActive) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canRun) {
        e.preventDefault()
        void runImage()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <PageContent>
      <PageHeader
        title="🖼️ AI Image Studio"
        desc="Generate dan edit gambar resolusi tinggi memakai mesin PosBot — Nano Banana, GPT Image, Flux 2, Seedream, Qwen, Imagen 4, Grok. Tulis prompt, tambahkan gambar acuan bila perlu, lalu generate."
      />

      <div className="flex flex-wrap gap-2 mb-6">
        {[
          '🖌️ Generate + Edit (I2I)',
          '🎯 Resolusi sampai 4K',
          '🔗 Hasil Permanen (CDN)',
          `💠 ${formatPosbotRupiah(spec.price)}/task`,
        ].map((badge) => (
          <span key={badge} className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{badge}</span>
        ))}
      </div>

      {!authToken && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Login dulu untuk memakai fitur ini.
        </div>
      )}
      {authToken && !isAdmin && wallet && (wallet.balance ?? 0) < spec.price && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Saldo PosBot tidak cukup ({formatPosbotRupiah(wallet.balance ?? 0)}, butuh {formatPosbotRupiah(spec.price)}). Top up di halaman <strong>Top Up PosBot</strong>.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input */}
        <Section title="📝 Input" className="!p-6">
          <div className="mb-4">
            <Label className="mb-2 block">🎚️ Pilih Model</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setModelId(m.id)}
                  className={`flex flex-col items-start px-2.5 py-2 rounded-lg text-left transition-colors ${
                    modelId === m.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-surface-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="text-[12px] font-medium leading-tight truncate w-full">{m.label}</span>
                  <span className={`text-[10px] ${modelId === m.id ? 'text-primary-foreground/80' : 'text-muted-foreground/70'}`}>
                    {posbotModeSummary(m)} · {formatPosbotRupiah(m.price)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <Label className="mb-2 block">✏️ Prompt</Label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full h-28 px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Contoh: potret sinematik seorang penjaga mercusuar saat badai, pencahayaan dramatis, 4K..."
            />
            <div className="mt-1 text-[11px] text-muted-foreground">{prompt.trim().length} / {spec.promptMax} karakter</div>
          </div>

          {spec.aspects && spec.aspects.length > 0 && (
            <div className="mb-4">
              <Label className="mb-2 block">📐 Rasio</Label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setAspect('')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${aspect === '' ? 'bg-primary text-primary-foreground' : 'bg-surface-secondary text-muted-foreground hover:text-foreground'}`}
                >
                  Auto
                </button>
                {spec.aspects.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAspect(a)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${aspect === a ? 'bg-primary text-primary-foreground' : 'bg-surface-secondary text-muted-foreground hover:text-foreground'}`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          )}

          {refMax > 0 && (
            <div className="mb-4">
              <Label className="mb-2 block">
                🖼️ Gambar Referensi{' '}
                <span className="text-muted-foreground font-normal">
                  ({refMin > 0 ? `wajib ${refMin}` : 'opsional'} · maks {refMax})
                </span>
              </Label>
              <div className="flex flex-wrap gap-2">
                {refs.map((f, i) => (
                  <div key={i} className="relative h-20 w-20 rounded-lg overflow-hidden border border-border">
                    <img src={refPreviews[i]} alt={f.name} className="h-full w-full object-cover" />
                    <button
                      onClick={() => removeRef(i)}
                      className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
                      aria-label="Hapus gambar"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {refs.length < refMax && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="grid h-20 w-20 place-items-center rounded-lg border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
                    aria-label="Tambah gambar"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple={refMax > 1}
                className="hidden"
                onChange={(e) => { addRefFiles(e.target.files); e.target.value = '' }}
              />
            </div>
          )}

          <div className="mb-4">
            <Label className="mb-2 block">🚫 Hindari (opsional)</Label>
            <input
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="mis. watermark, blur, tangan cacat"
            />
          </div>

          <Button onClick={runImage} disabled={!canRun} className="w-full" size="lg" title="Ctrl+Enter untuk jalankan">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {taskStatus === 'submitting' ? '🚀 Submitting...' : taskStatus === 'running' ? `⏳ ${statusText || 'Running...'}` : '🚀 Buat Gambar'}
          </Button>
        </Section>

        {/* Right: Output */}
        <Section title="📤 Hasil" className="!p-6">
          <div className="mb-4">
            {taskStatus === 'idle' && <span className="text-sm text-muted-foreground">Belum ada generate yang dijalankan.</span>}
            {taskStatus === 'submitting' && (
              <span className="text-sm text-blue-400 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {statusText || 'Menyiapkan...'}</span>
            )}
            {taskStatus === 'running' && (
              <span className="text-sm text-blue-400 flex items-center gap-2"><Clock className="h-4 w-4 animate-spin" /> {statusText || 'Memproses...'}</span>
            )}
            {taskStatus === 'success' && (
              <span className="text-sm text-green-400 flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Selesai!</span>
            )}
            {taskStatus === 'error' && (
              <span className="text-sm text-red-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> Error: {error || 'Unknown error'}
                <button type="button" onClick={runImage} disabled={loading} className="ml-2 px-2 py-0.5 rounded border border-red-400/40 text-xs hover:bg-red-500/20">Coba lagi</button>
              </span>
            )}
          </div>

          <div className="min-h-[160px]">
            {resultUrl ? (
              <div className="rounded-lg border border-border overflow-hidden">
                <img src={resultUrl} alt="hasil" className="w-full bg-black/30" />
                <div className="p-2 flex items-center justify-center gap-4">
                  <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">🔗 Buka Full</a>
                  <a href={resultUrl} download className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><Download className="h-3 w-3" /> Download</a>
                </div>
              </div>
            ) : (
              <EmptyState icon={<ImageIcon className="h-12 w-12" />} title="Belum ada hasil" description="Pilih model, tulis prompt, lalu klik Buat Gambar." />
            )}
          </div>

          {history.length > 0 && (
            <div className="mt-6 pt-4 border-t border-border">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Riwayat</div>
              <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                {history.map((h) => (
                  <a key={h.jobId} href={h.url} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden border border-border hover:border-primary transition-colors" title={`${h.model} — ${h.prompt}`}>
                    <img src={h.url} alt={h.model} className="h-20 w-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </Section>
      </div>

      {/* Log Detail */}
      <Section title="🧾 Log Detail" sub={`Total ${logs.length} entri`}>
        <LogDetailActions logs={logs} onClear={clearLogs} />
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => { navigator.clipboard.writeText(logs.map((l) => `[${l.time}] ${l.msg}`).join('\n')); addToast('📋 Log dicopy!') }}
            disabled={logs.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-secondary text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
          <button
            onClick={() => { setLogs([]); addToast('🗑️ Log dihapus') }}
            disabled={logs.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-secondary text-xs text-muted-foreground hover:text-red-400 disabled:opacity-40 transition-colors"
          >
            <Trash2 className="h-3 w-3" /> Hapus
          </button>
        </div>
        <div className="rounded-xl border border-border/60 bg-black/40 p-2 max-h-64 overflow-y-auto overflow-x-hidden text-[11px] font-mono min-w-0">
          {logs.length === 0 ? (
            <div className="text-muted-foreground px-1 py-2">Belum ada log. Jalankan generate untuk melihat detail proses.</div>
          ) : logs.map((log, i) => (
            <div key={i} className={`break-all min-w-0 px-1 py-0.5 ${
              log.level === 'error' ? 'text-red-400' :
              log.level === 'warn' ? 'text-amber-400' :
              log.level === 'success' ? 'text-emerald-400' :
              'text-muted-foreground'
            }`}>
              [{log.time}] {log.msg}
            </div>
          ))}
        </div>
      </Section>
    </PageContent>
  )
}
