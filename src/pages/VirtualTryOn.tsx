import { useState, useRef, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, EmptyState } from '@/components/ui'
import { LogDetailActions } from '@/components/ui/LogDetailActions'
import { Loader2, Upload, Download, X, Shirt, User, Sparkles, CheckCircle2, AlertCircle, Clock } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import { fetchNexabotWallet, chargeNexabotWallet, refundNexabotWallet, nexabotPreferServerKey, nexabotFreeForModel, NEXABOT_PRICE_FALLBACK, type NexabotWallet } from '@/lib/nexabotWallet'
import { formatRp } from '@/lib/payment'
import { submitRunningHubTryOn, submitRunningHubTryOnFlux2, pollRunningHubTask } from '@/lib/runninghub'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { persistResultToR2, addResult, startGenerationTask, removeActiveTask } from '@/lib/backgroundTasks'
import { usePageActive } from '@/hooks/usePageActive'

type TryOnMode = 'tryon' | 'extract'
type TryOnEngine = 'firered' | 'flux2'
type TryOnProvider = 'runninghub' | 'nexabot'

interface HistoryItem {
  time: string
  taskId: string
  status: string
  url?: string
}

interface LogEntry {
  time: string
  msg: string
  level: 'info' | 'warn' | 'error' | 'success'
}

function getStoredProviderKey(provider: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('arkxmotion.providers')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const keys = parsed[provider] || []
    const active = keys.find((k: any) => k.status === 'active' || k.status === 'unknown')
    return active?.key || keys[0]?.key || null
  } catch { return null }
}

export default function VirtualTryOnPage() {
  const addToast = useToastStore((s) => s.addToast)

  const [mode, setMode] = useState<TryOnMode>('tryon')
  const [engine, setEngine] = useState<TryOnEngine>('firered')
  const [provider, setProvider] = useState<TryOnProvider>('runninghub')
  const [gptAspect, setGptAspect] = useState<1 | 2 | 5>(5)
  const { token: authToken, user } = useAuthStore()
  const [nbWallet, setNbWallet] = useState<NexabotWallet | null>(null)
  const nbChargeRef = useRef<number | null>(null)
  const nbCoveredRef = useRef(false)
  const [personFile, setPersonFile] = useState<File | null>(null)
  const [personPreview, setPersonPreview] = useState<string | null>(null)
  const [garmentFile, setGarmentFile] = useState<File | null>(null)
  const [garmentPreview, setGarmentPreview] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [taskStatus, setTaskStatus] = useState<'idle' | 'uploading' | 'submitting' | 'running' | 'success' | 'error'>('idle')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])

  const personPickerRef = useRef<HTMLInputElement | null>(null)
  const garmentPickerRef = useRef<HTMLInputElement | null>(null)

  const apiKey = getStoredProviderKey('runninghub')
  const nexabotServerReady = !!nbWallet?.server_key?.available
  const nbFreeForModel = nexabotFreeForModel(nbWallet, 'gpt-image')

  useEffect(() => {
    if (!authToken) { setNbWallet(null); return }
    fetchNexabotWallet(authToken).then((w) => { if (w) setNbWallet(w) }).catch(() => {})
  }, [authToken])

  /** Kredensial NexaBot untuk satu job gpt-image (mengikuti pola EditImage). */
  const buildNexabotAuth = async (): Promise<any> => {
    const mod = await import('@/lib/nexabot')
    const nbApiKey = mod.getNexabotApiKey()
    const nbCookies = mod.getNexabotCookies()
    const ticket = nbChargeRef.current
    let serverReady = nexabotServerReady
    if (authToken) {
      const fresh = await fetchNexabotWallet(authToken).catch(() => null)
      if (fresh) {
        setNbWallet(fresh)
        serverReady = !!fresh.server_key?.available
      }
    }
    if (nexabotPreferServerKey({
      hasOwnKey: !!(nbApiKey || nbCookies),
      serverReady,
      coveredByPackage: nbCoveredRef.current,
    })) return { master: true, ticket }
    if (nbApiKey || nbCookies) return { apiKey: nbApiKey, cookies: nbCookies, ticket }
    throw new Error('NexaBot: tidak ada API key aktif dan kunci server belum tersedia — tambahkan API key di halaman Providers atau top up / ambil paket dulu.')
  }

  const fileToDataUrl = async (file: File): Promise<string> => {
    const { compressForApi } = await import('@/lib/nexabot')
    const small = await compressForApi(file, 1024, 0.72)
    return new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error('Gagal membaca file gambar'))
      r.readAsDataURL(small)
    })
  }

  const addLog = (msg: string, level: LogEntry['level'] = 'info') => {
    const time = new Date().toLocaleTimeString('id-ID')
    setLogs((prev) => [...prev, { time, msg, level }].slice(-200))
  }

  const clearLogs = () => setLogs([])

  const handleFileSelect = (file: File, type: 'person' | 'garment') => {
    const reader = new FileReader()
    reader.onload = (e) => {
      if (type === 'person') {
        setPersonFile(file)
        setPersonPreview(e.target?.result as string)
      } else {
        setGarmentFile(file)
        setGarmentPreview(e.target?.result as string)
      }
    }
    reader.readAsDataURL(file)
  }

  const removeFile = (type: 'person' | 'garment') => {
    if (type === 'person') { setPersonFile(null); setPersonPreview(null) }
    else { setGarmentFile(null); setGarmentPreview(null) }
  }

  const runWorkflow = async () => {
    if (provider === 'runninghub' && !apiKey) {
      addToast('⚠️ Belum ada RunningHub API key. Tambahkan di Providers.', 'warning')
      return
    }
    if (provider === 'nexabot' && !authToken && !getStoredProviderKey('nexabot')) {
      addToast('⚠️ Untuk NexaBot perlu login (saldo/paket) atau API key NexaBot di Providers.', 'warning')
    }
    if (!personFile) {
      addToast('⚠️ Upload foto karakter terlebih dahulu!', 'warning')
      return
    }
    if (mode === 'tryon' && !garmentFile) {
      addToast('⚠️ Upload foto pakaian terlebih dahulu!', 'warning')
      return
    }
    if (provider === 'runninghub' && engine === 'flux2' && !garmentFile) {
      addToast('⚠️ FLUX2-Klein butuh foto pakaian. Upload foto pakaian terlebih dahulu!', 'warning')
      return
    }
    if (provider === 'nexabot' && authToken && user?.role !== 'admin' && nbWallet && !nbFreeForModel && (nbWallet.balance < (nbWallet.price ?? NEXABOT_PRICE_FALLBACK))) {
      addToast(`Saldo NexaBot tidak cukup (${formatRp(nbWallet.balance)}). Top up dulu di halaman NexaBot.`, 'error')
      return
    }

    const isNb = provider === 'nexabot'
    const modelLabel = isNb
      ? 'Virtual Try-On (NexaBot GPT Image)'
      : engine === 'flux2' ? 'Virtual Try-On FLUX2-Klein' : 'Virtual Try-On'

    setLoading(true)
    setError(null)
    setResultUrl(null)
    setProgress(0)
    setTaskStatus('submitting')
    setLogs([])
    const trackId = startGenerationTask({
      page: 'virtual-tryon',
      model: modelLabel,
      prompt: prompt.trim().slice(0, 500),
      provider,
    })
    addLog(`Mulai (${mode}) via ${isNb ? 'NexaBot GPT Image' : 'RunningHub'}: ${(personFile!.size / 1024).toFixed(0)}KB ${personFile!.name}` + (mode === 'tryon' && garmentFile ? ` + ${(garmentFile.size / 1024).toFixed(0)}KB ${garmentFile.name}` : ''))
    if (prompt.trim()) addLog(`Prompt: ${prompt.trim().slice(0, 120)}`)

    try {
      // ── Jalur NexaBot: GPT Image 2.5 (prompt + gambar referensi) ──
      if (isNb) {
        const { submitNexabotGptImage, pollNexabotGptImage, downloadNexabotGptImage, runWithNexabotThrottleRetry } = await import('@/lib/nexabot')
        if (authToken && user?.role !== 'admin') {
          const charge = await chargeNexabotWallet(authToken, 'gpt-image')
          nbChargeRef.current = charge.usageId
          nbCoveredRef.current = charge.unlimited
          setNbWallet((w) => (w ? { ...w, balance: charge.balance } : w))
          addLog(charge.unlimited ? '🎟️ Paket aktif — generate ini gratis' : `💰 Saldo terpotong ${formatRp(charge.deducted)} ✓ sisa ${formatRp(charge.balance)}`, 'success')
        } else if (user?.role === 'admin') {
          addLog('⚡ Admin mode — skip saldo', 'info')
        }
        const auth = await buildNexabotAuth()
        const references: string[] = [await fileToDataUrl(personFile!)]
        if (mode === 'tryon') references.push(await fileToDataUrl(garmentFile!))
        const fullPrompt = mode === 'tryon'
          ? `The person in the first reference image is wearing the garment (outfit) shown in the second reference image. Keep the person's face, hair, pose, body shape, background and lighting from the first image unchanged — only change the upper garment to match the second image exactly (color, fabric, cut, pattern, logo). Photorealistic, high detail.${prompt.trim() ? ` Additional: ${prompt.trim()}` : ''}`
          : `Extract the garment worn by the person in the reference image as a clean flat-lay product photo on a neutral plain background, showing color, fabric, cut and details faithfully. Photorealistic product mockup.${prompt.trim() ? ` Additional: ${prompt.trim()}` : ''}`
        setTaskStatus('running')
        const submit = await runWithNexabotThrottleRetry(() => submitNexabotGptImage({
          prompt: fullPrompt,
          aspect: gptAspect,
          references,
        }, auth), {
          onThrottle: (waitSeconds) => addLog(`⏳ Server gambar NexaBot dibatasi upstream — menunggu ${waitSeconds}s lalu submit otomatis...`, 'warn'),
        })
        if (!submit.ok || !submit.id) throw new Error(submit.error || 'Submit NexaBot gagal')
        setTaskId(submit.id)
        addLog(`TaskId: ${submit.id} (biaya ${submit.cost ?? 0.1} kredit)`, 'success')
        const job = await pollNexabotGptImage(submit.id, auth, (msg) => addLog(msg, 'info'))
        addLog(`Status: ${job.status}`, 'success')
        const images = (job.images || []).filter((im) => im && typeof im.url === 'string')
        if (!images.length) throw new Error('Tidak ada gambar yang dihasilkan')
        setTaskStatus('running')
        addLog(`Mengunduh ${images.length} gambar...`)
        let finalUrl = ''
        for (let i = 0; i < images.length; i++) {
          const dl = await downloadNexabotGptImage(images[i].url, auth)
          if (!dl.ok || !dl.blob) {
            addLog(`Gambar ${i + 1} gagal diunduh: ${dl.error}`, 'warn')
            continue
          }
          finalUrl = URL.createObjectURL(dl.blob)
          break
        }
        if (!finalUrl) throw new Error('Semua gambar gagal diunduh dari NexaBot')
        const tid = submit.id || `tryon-${Date.now()}`
        setResultUrl(finalUrl)
        setTaskStatus('success')
        setProgress(100)
        addLog('Selesai ✓', 'success')
        addResult({
          id: tid,
          url: finalUrl,
          prompt: prompt.trim().slice(0, 500),
          date: new Date().toISOString(),
          page: 'virtual-tryon',
          kind: 'image',
          provider: 'nexabot',
          model: modelLabel,
        })
        setHistory((prev) => [
          { time: new Date().toLocaleTimeString('id-ID'), taskId: tid, status: '✅ Selesai', url: finalUrl },
          ...prev,
        ])
        addToast('✅ Virtual Try-On selesai! (NexaBot)', 'success')
        return
      }

      let submittedTaskId = ''
      const rotation = await withTokenRotation<string>(
        'runninghub',
        async (key, keyInfo) => {
          addLog(`🔑 Key: ${keyInfo?.name || keyInfo?.id || 'default'}`)
          const submit = engine === 'flux2'
            ? await submitRunningHubTryOnFlux2({
                personFile: personFile!,
                garmentFile: garmentFile!,
                prompt: prompt.trim() || undefined,
                apiKey: key,
              })
            : await submitRunningHubTryOn({
                personFile: personFile!,
                garmentFile: mode === 'tryon' ? garmentFile : null,
                mode,
                prompt: prompt.trim() || undefined,
                apiKey: key,
              })
          submittedTaskId = submit.taskId
          setTaskId(submit.taskId)
          setTaskStatus('running')
          addLog(`TaskId: ${submit.taskId} (status: ${submit.status})`, 'success')
          const url = await pollRunningHubTask(submit.taskId, (status, pct) => {
            setTaskStatus('running')
            setProgress(pct)
            addLog(`Poll: ${status} ${pct}%`)
          }, 600000, key, engine === 'flux2' ? 'Virtual Try-On FLUX2-Klein (RunningHub)' : 'Virtual Try-On (RunningHub)')
          return url
        },
        {
          onKeySwitch: (from, to, attempt) => {
            const msg = `🔄 Key "${from.name}" gagal, pindah ke key #${attempt}: "${to.name}"`
            addLog(msg, 'warn')
            addToast(msg, 'info')
          },
          onError: (err, key) => {
            if (detectTokenError('runninghub', err)) {
              const msg = `⚠️ Key "${key.name}" bermasalah: ${err.message}`
              addLog(msg, 'warn')
              addToast(msg, 'warning')
            }
          },
        },
      )

      if (!rotation.ok || !rotation.result) {
        throw new Error(rotation.error || 'Generation failed')
      }

      const url = rotation.result
      const tid = submittedTaskId || `tryon-${Date.now()}`
      setResultUrl(url)
      setTaskStatus('success')
      setProgress(100)
      addLog(`Selesai: ${url.slice(0, 100)}...`, 'success')
      if ((rotation.triedKeys || 1) > 1) {
        addLog(`Dipakai key "${rotation.usedKey?.name}" setelah ${rotation.triedKeys} percobaan`)
      }
      // URL RunningHub kedaluwarsa 24 jam — simpan permanen ke R2
      persistResultToR2(tid, url)
      addResult({
        id: tid,
        url,
        prompt: prompt.trim().slice(0, 500),
        date: new Date().toISOString(),
        page: 'virtual-tryon',
        kind: 'image',
        provider: 'runninghub',
        model: engine === 'flux2' ? 'Virtual Try-On FLUX2-Klein' : 'Virtual Try-On',
      })
      setHistory((prev) => [
        { time: new Date().toLocaleTimeString('id-ID'), taskId: tid, status: '✅ Selesai', url },
        ...prev,
      ])
      addToast('✅ Virtual Try-On selesai!', 'success')
  // Refund saldo NexaBot kalau generate gagal setelah pemotongan
    } catch (e: any) {
      if (provider === 'nexabot' && nbChargeRef.current && authToken) {
        const refundedBalance = await refundNexabotWallet(authToken, nbChargeRef.current)
        nbChargeRef.current = null
        if (refundedBalance != null) {
          addLog(`💸 Saldo NexaBot dikembalikan ✓ sisa ${formatRp(refundedBalance)}`, 'warn')
          setNbWallet((w) => (w ? { ...w, balance: refundedBalance } : w))
        }
      }
      setTaskStatus('error')
      setError(e.message || 'Unknown error')
      addLog(`Gagal: ${e.message || e}`, 'error')
      addToast(`❌ ${e.message}`, 'error')
    } finally {
      nbChargeRef.current = null
      nbCoveredRef.current = false
      removeActiveTask(trackId)
      setLoading(false)
    }
  }

  const canRun = (provider === 'runninghub' ? !!apiKey : true) && !!personFile && ((mode === 'tryon' || (provider === 'runninghub' && engine === 'flux2')) ? !!garmentFile : true) && !loading

  const pageActive = usePageActive()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pageActive) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canRun) {
        e.preventDefault()
        void runWorkflow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const FileUpload = ({ label, icon, file, preview, pickerRef, onPick, onRemove, type }: {
    label: string; icon: React.ReactNode; file: File | null; preview: string | null;
    pickerRef: React.RefObject<HTMLInputElement | null>; onPick: () => void; onRemove: () => void; type: 'person' | 'garment'
  }) => (
    <div className="mb-4">
      <Label className="mb-2 block">{label}</Label>
      {preview ? (
        <div className="relative rounded-lg border border-border overflow-hidden">
          <img src={preview} alt={label} className="w-full max-h-64 object-contain bg-surface-secondary" />
          <button onClick={onRemove} className="absolute top-2 right-2 p-1 rounded-full bg-background/80 hover:bg-red-500/80 transition-colors">
            <X className="h-4 w-4" />
          </button>
          <div className="p-2 text-xs text-muted-foreground truncate">{file?.name}</div>
        </div>
      ) : (
        <div onClick={onPick} className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors">
          <div className="flex justify-center text-muted-foreground mb-2">{icon}</div>
          <div className="text-sm text-muted-foreground">Klik atau seret foto di sini</div>
          <div className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP — max 50MB</div>
        </div>
      )}
      <input ref={pickerRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0], type)} />
    </div>
  )

  return (
    <PageContent>
      <PageHeader
        title="👗 Virtual Try-On & Ekstraksi Pakaian"
        desc="Ubah pakaian pada karakter atau ekstrak pakaian menjadi mockup datar. RunningHub (FireRed 2-in-1 & FLUX2-Klein) atau NexaBot GPT Image 2.5."
      />

      <div className="mb-4">
        <Label className="mb-2 block">Provider</Label>
        <div className="flex gap-2 max-w-md">
          <button
            onClick={() => setProvider('runninghub')}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${provider === 'runninghub' ? 'bg-primary text-primary-foreground' : 'bg-surface-secondary text-muted-foreground hover:text-foreground'}`}
          >⚙️ RunningHub</button>
          <button
            onClick={() => setProvider('nexabot')}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${provider === 'nexabot' ? 'bg-primary text-primary-foreground' : 'bg-surface-secondary text-muted-foreground hover:text-foreground'}`}
          >🔮 NexaBot (GPT Image)</button>
        </div>
      </div>

      {provider === 'runninghub' && !apiKey && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Belum ada RunningHub API key. Tambahkan di <strong>Providers</strong> untuk menggunakan fitur ini.
        </div>
      )}
      {provider === 'nexabot' && (
        <div className="mb-6 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm">
          🔮 Mode NexaBot memakai <strong>GPT Image 2.5</strong> — hasil berupa prompt-based try-on (wajah/pose bisa sedikit berubah). Butuh login saldo/paket atau API key NexaBot di Providers.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input */}
        <Section title="📸 Input" className="!p-6">
          {provider === 'runninghub' && (
          <div className="mb-4">
            <Label className="mb-2 block">Engine</Label>
            <div className="flex gap-2">
              <button
                onClick={() => setEngine('firered')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${engine === 'firered' ? 'bg-primary text-primary-foreground' : 'bg-surface-secondary text-muted-foreground hover:text-foreground'}`}
              >
                🔥 FireRed 2-in-1
              </button>
              <button
                onClick={() => setEngine('flux2')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${engine === 'flux2' ? 'bg-primary text-primary-foreground' : 'bg-surface-secondary text-muted-foreground hover:text-foreground'}`}
              >
                ✨ FLUX2-Klein
              </button>
            </div>
            {engine === 'flux2' && (
              <p className="mt-2 text-xs text-muted-foreground">
                Transfer pakaian tubuh atas via FLUX2-Klein + masking SAM3: analisis bentuk, garis leher, lengan, bahan, warna & logo — wajah, rambut, pose, proporsi, pakaian bawah, latar & pencahayaan asli tetap dipertahankan. Mode: try-on saja (tanpa ekstraksi).
              </p>
            )}
          </div>
          )}

          {(provider === 'nexabot' || engine === 'firered') && (
            <div className="mb-4">
              <Label className="mb-2 block">Mode</Label>
              <div className="flex gap-2">
                <button
                  onClick={() => setMode('tryon')}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'tryon' ? 'bg-primary text-primary-foreground' : 'bg-surface-secondary text-muted-foreground hover:text-foreground'}`}
                >
                  👗 Virtual Try-On
                </button>
                <button
                  onClick={() => setMode('extract')}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'extract' ? 'bg-primary text-primary-foreground' : 'bg-surface-secondary text-muted-foreground hover:text-foreground'}`}
                >
                  🧵 Ekstraksi Pakaian
                </button>
              </div>
            </div>
          )}

          {provider === 'nexabot' && (
            <div className="mb-4">
              <Label className="mb-2 block">Rasio (NexaBot)</Label>
              <div className="flex gap-2 flex-wrap">
                {([1, 5, 2] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => setGptAspect(a)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${gptAspect === a ? 'bg-primary text-primary-foreground' : 'bg-surface-secondary text-muted-foreground hover:text-foreground'}`}
                  >{a === 1 ? '1:1' : a === 5 ? '9:16' : '16:9'}</button>
                ))}
              </div>
            </div>
          )}

          <FileUpload
            label={mode === 'tryon' ? '🖼️ Foto Karakter / Model' : '🖼️ Foto Orang Memakai Pakaian'}
            icon={<User className="h-8 w-8" />}
            file={personFile}
            preview={personPreview}
            pickerRef={personPickerRef}
            onPick={() => personPickerRef.current?.click()}
            onRemove={() => removeFile('person')}
            type="person"
          />

          {(mode === 'tryon' || (provider === 'runninghub' && engine === 'flux2')) && (
            <FileUpload label="👔 Foto Pakaian / Garment" icon={<Shirt className="h-8 w-8" />} file={garmentFile} preview={garmentPreview} pickerRef={garmentPickerRef} onPick={() => garmentPickerRef.current?.click()} onRemove={() => removeFile('garment')} type="garment" />
          )}

          <div className="mb-4">
            <Label className="mb-2 block">✏️ Prompt (opsional)</Label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full h-20 px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Deskripsikan perubahan yang diinginkan..."
            />
          </div>

          <Button
            onClick={runWorkflow}
            disabled={loading || (provider === 'runninghub' && !apiKey) || !personFile || ((mode === 'tryon' || (provider === 'runninghub' && engine === 'flux2')) && !garmentFile)}
            className="w-full"
            size="lg"
            title="Ctrl+Enter untuk jalankan"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {taskStatus === 'submitting' ? '🚀 Submitting...' : taskStatus === 'running' ? `⏳ Running... ${progress}%` : '🚀 Jalankan AI'}
          </Button>
        </Section>

        {/* Right: Output */}
        <Section title="📤 Hasil" className="!p-6">
          <div className="mb-4">
            {taskStatus === 'idle' && (
              <span className="text-sm text-muted-foreground">Belum ada task yang dijalankan.</span>
            )}
            {taskStatus === 'submitting' && (
              <span className="text-sm text-blue-400 flex items-center gap-2">
                <Upload className="h-4 w-4 animate-pulse" /> Mengunggah & submit...
              </span>
            )}
            {taskStatus === 'running' && (
              <span className="text-sm text-blue-400 flex items-center gap-2">
                <Clock className="h-4 w-4 animate-spin" /> {taskId?.slice(0, 20)}... — {progress}%
              </span>
            )}
            {taskStatus === 'success' && (
              <span className="text-sm text-green-400 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> Selesai!
              </span>
            )}
            {taskStatus === 'error' && (
              <span className="text-sm text-red-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> Error: {error || 'Unknown error'}
                {(personFile || garmentFile) && (
                  <button
                    type="button"
                    onClick={runWorkflow}
                    disabled={loading}
                    className="ml-2 px-2 py-0.5 rounded border border-red-400/40 text-xs hover:bg-red-500/20"
                    aria-label="Coba lagi dengan file yang sama"
                  >
                    Coba lagi
                  </button>
                )}
              </span>
            )}
          </div>

          <div className="min-h-[200px]">
            {resultUrl ? (
              <div className="rounded-lg border border-border overflow-hidden">
                <img src={resultUrl} alt="Try-On result" className="w-full" />
                <div className="p-2 flex items-center justify-center gap-4">
                  <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">🔗 Buka Full Size</a>
                  <a href={resultUrl} download className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Download className="h-3 w-3" /> Download
                  </a>
                </div>
              </div>
            ) : (
              <EmptyState icon={<Sparkles className="h-12 w-12" />} title="Belum ada hasil" description="Hasil akan muncul di sini setelah proses selesai." />
            )}
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className="mt-6 pt-4 border-t border-border">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Riwayat</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {history.map((h, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-border/50">
                    {h.url && <img src={h.url} alt={`Riwayat try-on ${i + 1}`} className="h-8 w-8 rounded object-cover shrink-0" />}
                    <span className="text-muted-foreground">{h.time}</span>
                    <span className="text-muted-foreground font-mono truncate">{h.taskId?.slice(0, 15)}...</span>
                    <span className="shrink-0">{h.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
      </div>

      {/* Log Detail */}
      <Section title="🧾 Log Detail" sub={`Total ${logs.length} entri`}>
          <LogDetailActions logs={logs} onClear={clearLogs} />
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
