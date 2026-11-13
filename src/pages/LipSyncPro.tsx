import { useState, useRef, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, EmptyState } from '@/components/ui'
import { LogDetailActions } from '@/components/ui/LogDetailActions'
import { Loader2, Download, Sparkles, CheckCircle2, AlertCircle, Clock, Mic, Image as ImageIcon, Music, X } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import {
  getPosbotSpec,
  buildPosbotPayload,
  generateWithPosbot,
  formatPosbotRupiah,
} from '@/lib/posbot'
import { fetchPosbotWallet, chargePosbotWallet, refundPosbotWallet, type PosbotWallet } from '@/lib/posbotWallet'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { logGenerationStart, logGenerationComplete, logGenerationFailed } from '@/lib/generationLog'
import { addResult, startGenerationTask, removeActiveTask } from '@/lib/backgroundTasks'
import { usePageActive } from '@/hooks/usePageActive'
import { uploadToCatbox, normalizeImage } from '@/lib/roboneo'

const SPEC = getPosbotSpec('minimax_lipsync_pro')!

export default function LipSyncProPage() {
  const addToast = useToastStore((s) => s.addToast)
  const { token: authToken, user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [audioDuration, setAudioDuration] = useState<number | null>(null)
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')

  const [loading, setLoading] = useState(false)
  const [taskStatus, setTaskStatus] = useState<'idle' | 'submitting' | 'running' | 'success' | 'error'>('idle')
  const [statusText, setStatusText] = useState('')
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wallet, setWallet] = useState<PosbotWallet | null>(null)
  const [logs, setLogs] = useState<Array<{ time: string; msg: string; level?: string }>>([])

  const photoInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)

  const addLog = useCallback((msg: string, level?: string) => {
    setLogs((prev) => [...prev, { time: new Date().toLocaleTimeString('id-ID'), msg, level }].slice(-200))
  }, [])
  const clearLogs = () => setLogs([])

  useEffect(() => {
    if (!authToken) return
    fetchPosbotWallet(authToken).then((w) => { if (w) setWallet(w) }).catch(() => {})
  }, [authToken])

  const handlePhotoSelect = (file: File) => {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const handleAudioSelect = (file: File) => {
    setAudioFile(file)
    setAudioDuration(null)
    // Validasi durasi audio (maks 30 dtk) sebelum masuk antrean.
    const url = URL.createObjectURL(file)
    const el = document.createElement('audio')
    el.onloadedmetadata = () => {
      setAudioDuration(el.duration)
      URL.revokeObjectURL(url)
      if (el.duration > 30) {
        addToast(`⚠️ Audio ${el.duration.toFixed(1)} detik melebihi batas 30 detik.`, 'warning')
      }
    }
    el.onerror = () => URL.revokeObjectURL(url)
    el.src = url
  }

  const enough = isAdmin || !wallet || (wallet.balance ?? 0) >= SPEC.price
  const audioOk = !!audioFile && (audioDuration == null || audioDuration <= 30)
  const canRun = !!photoFile && audioOk && !!authToken && !loading && enough

  const runLipSync = async () => {
    if (!authToken) {
      addToast('⚠️ Login dulu untuk memakai LipSync Pro.', 'warning')
      return
    }
    if (!photoFile) {
      addToast('⚠️ Upload foto wajah dulu!', 'warning')
      return
    }
    if (!audioFile) {
      addToast('⚠️ Upload file audio dulu!', 'warning')
      return
    }
    if (audioDuration != null && audioDuration > 30) {
      addToast('⚠️ Audio maksimal 30 detik.', 'warning')
      return
    }
    if (!isAdmin && wallet && (wallet.balance ?? 0) < SPEC.price) {
      const msg = `Saldo PosBot tidak cukup (${formatPosbotRupiah(wallet.balance ?? 0)}, butuh ${formatPosbotRupiah(SPEC.price)}). Top up di halaman Top Up PosBot.`
      addToast(`⚠️ ${msg}`, 'warning')
      return
    }

    setLoading(true)
    setError(null)
    setResultUrl(null)
    setTaskStatus('submitting')
    setStatusText('Menyiapkan...')
    setLogs([])

    const trackId = startGenerationTask({
      page: 'lipsync-pro',
      model: SPEC.label,
      prompt: 'LipSync Pro',
      provider: 'posbot',
    })
    const startTime = Date.now()
    const promptText = prompt.trim()
    const negativeText = negativePrompt.trim()

    addLog(`💋 LipSync Pro — ${SPEC.label} (${formatPosbotRupiah(SPEC.price)})`, 'info')

    // Upload dulu — PosBot butuh URL publik; saldo baru dipotong setelah
    // upload berhasil & input valid.
    let imageUrl = ''
    let audioUrl = ''
    try {
      setStatusText('Upload gambar...')
      const normImg = await normalizeImage(photoFile, (msg) => addLog(msg, 'info'))
      imageUrl = await uploadToCatbox(normImg, 'image', (msg, pct) => {
        updateStatusProgress(pct, `Upload gambar ${msg}`)
      })
      addLog(`✅ Foto terupload: ${imageUrl.slice(0, 60)}`, 'success')

      setStatusText('Upload audio...')
      audioUrl = await uploadToCatbox(audioFile, 'audio', (msg, pct) => {
        updateStatusProgress(pct, `Upload audio ${msg}`)
      })
      addLog(`✅ Audio terupload: ${audioUrl.slice(0, 60)}`, 'success')
    } catch (e: any) {
      setError(e?.message || 'Gagal upload file')
      setTaskStatus('error')
      addLog(`❌ Upload gagal: ${e?.message || e}`, 'error')
      removeActiveTask(trackId)
      setLoading(false)
      return
    }

    // Validasi kontrak model SEBELUM saldo dipotong.
    try {
      buildPosbotPayload(SPEC, {
        imageUrl,
        audioUrl,
        prompt: promptText || undefined,
        negativePrompt: negativeText || undefined,
      })
    } catch (e: any) {
      setError(e.message || 'Input tidak valid')
      setTaskStatus('error')
      addLog(`❌ ${e.message || 'Input tidak valid'}`, 'error')
      removeActiveTask(trackId)
      setLoading(false)
      return
    }

    const logId = await logGenerationStart({
      page: 'lipsync-pro',
      provider: 'posbot',
      model: SPEC.id,
      prompt: promptText.slice(0, 500) || 'LipSync Pro',
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
            const charge = await chargePosbotWallet(authToken, SPEC.id, 1)
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
              spec: SPEC,
              imageUrl,
              audioUrl,
              prompt: promptText || undefined,
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
            return { error: slotErr?.message || 'LipSync Pro gagal' }
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
      if (!outcome?.url) throw new Error(outcome?.error || rotation.error || 'LipSync Pro gagal')

      const url = outcome.url
      setResultUrl(url)
      setTaskStatus('success')
      setStatusText('')
      addLog(`✅ Selesai ✓ ${url.slice(0, 60)}...`, 'success')
      addResult({
        id: `lipsync-pro-${Date.now()}`,
        url,
        prompt: promptText.slice(0, 500) || 'LipSync Pro',
        date: new Date().toISOString(),
        page: 'lipsync-pro',
        kind: 'video',
        provider: 'posbot',
        model: SPEC.label,
      })
      if (logId) logGenerationComplete(logId, { status: 'completed', result_url: url, duration_ms: Date.now() - startTime })
      addToast('✅ LipSync Pro selesai!', 'success')
    } catch (e: any) {
      setTaskStatus('error')
      setError(e.message || 'Unknown error')
      addLog(`❌ Gagal: ${e.message || e}`, 'error')
      if (logId) logGenerationFailed(logId, e.message || 'Unknown error', Date.now() - startTime)
      addToast(`❌ ${e.message || 'LipSync Pro gagal'}`, 'error')
    } finally {
      removeActiveTask(trackId)
      setLoading(false)
    }
  }

  const updateStatusProgress = (pct: number | undefined, fallbackMsg?: string) => {
    setStatusText(pct != null ? `${fallbackMsg || 'Upload...'} ${Math.round(pct)}%` : (fallbackMsg || 'Upload...'))
  }

  const pageActive = usePageActive()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pageActive) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canRun) {
        e.preventDefault()
        void runLipSync()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <PageContent>
      <PageHeader
        title="💋 LipSync Pro"
        desc="Sinkronkan gerak bibir & ekspresi wajah ke audio ucapan dengan mesin Minimax LipSync Pro — video sinematik 30 detik dengan dukungan custom prompt & multi-angle camera."
      />

      <div className="flex flex-wrap gap-2 mb-6">
        {[
          '🎭 Foto Wajah + Audio',
          '📸 Multi-Angle Camera',
          '⏱️ Maks 30 Detik',
          `💠 ${formatPosbotRupiah(SPEC.price)}/generate`,
        ].map((badge) => (
          <span key={badge} className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{badge}</span>
        ))}
      </div>

      {!authToken && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Login dulu untuk memakai fitur ini.
        </div>
      )}
      {authToken && !isAdmin && wallet && (wallet.balance ?? 0) < SPEC.price && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
          ⚠️ Saldo PosBot tidak cukup ({formatPosbotRupiah(wallet.balance ?? 0)}, butuh {formatPosbotRupiah(SPEC.price)}). Top up di halaman <strong>Top Up PosBot</strong>.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input */}
        <Section title="📝 Input" className="!p-6">
          {/* Foto wajah */}
          <div className="mb-4">
            <Label className="mb-2 block">🙂 Foto Wajah (frontal, jelas)</Label>
            {photoPreview ? (
              <div className="relative rounded-lg border border-border overflow-hidden bg-surface-secondary p-3 flex items-center gap-3">
                <img src={photoPreview} alt="wajah" className="h-24 w-24 object-cover rounded-md" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground truncate">{photoFile?.name}</div>
                  <button onClick={() => { setPhotoFile(null); if (photoPreview) URL.revokeObjectURL(photoPreview); setPhotoPreview(null) }} className="mt-2 inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
                    <X className="h-3 w-3" /> Ganti foto
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => photoInputRef.current?.click()} className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors">
                <div className="flex justify-center text-muted-foreground mb-2"><ImageIcon className="h-8 w-8" /></div>
                <div className="text-sm text-muted-foreground">Klik untuk upload foto wajah</div>
                <div className="text-xs text-muted-foreground mt-1">JPG / PNG / WEBP — wajah menghadap depan</div>
              </div>
            )}
            <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handlePhotoSelect(e.target.files[0])} />
          </div>

          {/* Audio */}
          <div className="mb-4">
            <Label className="mb-2 block">🎵 File Audio</Label>
            {audioFile ? (
              <div className="rounded-lg border border-border overflow-hidden bg-surface-secondary p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Music className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground truncate flex-1">{audioFile.name} ({(audioFile.size / 1024 / 1024).toFixed(1)}MB){audioDuration != null ? ` · ${audioDuration.toFixed(1)} dtk` : ''}</span>
                  <button onClick={() => { setAudioFile(null); setAudioDuration(null) }} className="p-1 rounded-full hover:bg-red-500/80 transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {audioFile && <audio src={URL.createObjectURL(audioFile)} controls className="w-full" />}
              </div>
            ) : (
              <div onClick={() => audioInputRef.current?.click()} className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors">
                <div className="flex justify-center text-muted-foreground mb-2"><Mic className="h-8 w-8" /></div>
                <div className="text-sm text-muted-foreground">Klik untuk upload audio</div>
                <div className="text-xs text-muted-foreground mt-1">MP3 / WAV — maksimal 30 detik</div>
              </div>
            )}
            <input ref={audioInputRef} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleAudioSelect(e.target.files[0])} />
            {audioDuration != null && audioDuration > 30 && (
              <div className="mt-2 text-xs text-red-400">⚠️ Audio {audioDuration.toFixed(1)} detik melebihi batas 30 detik.</div>
            )}
          </div>

          {/* Prompt opsional */}
          <div className="mb-4">
            <Label className="mb-2 block">✍️ Custom Prompt <span className="text-muted-foreground font-normal">(opsional — arahkan kamera/ekspresi)</span></Label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full h-24 px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Contoh: multi-angle camera, close-up wajah, gerak kepala kiri-kanan natural, ekspresi senang..."
            />
            <div className="mt-1 text-[11px] text-muted-foreground">{prompt.length} / 2500 karakter</div>
          </div>

          {/* Negative prompt */}
          <div className="mb-4">
            <Label className="mb-2 block">🚫 Hindari (opsional)</Label>
            <input
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="mis. wajah blur, berkedip aneh, frame lompat"
            />
          </div>

          <Button
            onClick={runLipSync}
            disabled={!canRun}
            className="w-full"
            size="lg"
            title="Ctrl+Enter untuk jalankan"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {taskStatus === 'submitting' ? '🚀 Submitting...' : taskStatus === 'running' ? `⏳ ${statusText || 'Running...'}` : '🚀 Buat LipSync Pro'}
          </Button>
        </Section>

        {/* Right: Output */}
        <Section title="📤 Hasil" className="!p-6">
          <div className="mb-4">
            {taskStatus === 'idle' && (
              <span className="text-sm text-muted-foreground">Belum ada generate yang dijalankan.</span>
            )}
            {taskStatus === 'submitting' && (
              <span className="text-sm text-blue-400 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Menyiapkan...
              </span>
            )}
            {taskStatus === 'running' && (
              <span className="text-sm text-blue-400 flex items-center gap-2">
                <Clock className="h-4 w-4 animate-spin" /> {statusText || 'Memproses...'}
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
                <button type="button" onClick={runLipSync} disabled={loading} className="ml-2 px-2 py-0.5 rounded border border-red-400/40 text-xs hover:bg-red-500/20">Coba lagi</button>
              </span>
            )}
          </div>

          <div className="min-h-[140px]">
            {resultUrl ? (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="p-2 bg-black">
                  <video src={resultUrl} controls playsInline className="w-full rounded" />
                </div>
                <div className="p-2 flex items-center justify-center gap-4">
                  <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">🔗 Buka Full</a>
                  <a href={resultUrl} download className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Download className="h-3 w-3" /> Download
                  </a>
                </div>
              </div>
            ) : (
              <EmptyState icon={<Mic className="h-12 w-12" />} title="Belum ada hasil" description="Upload foto wajah + audio, lalu klik Buat LipSync Pro." />
            )}
          </div>
        </Section>
      </div>

      {/* Log Detail */}
      <Section title="🧾 Log Detail" sub={`Total ${logs.length} entri`}>
        <LogDetailActions logs={logs} onClear={clearLogs} />
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => {
              const text = logs.map((l) => `[${l.time}] ${l.msg}`).join('\n')
              navigator.clipboard.writeText(text)
            }}
            className="px-2.5 py-1 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >Copy</button>
          <button
            onClick={() => {
              const text = logs.map((l) => `[${l.time}] ${l.msg}`).join('\n')
              const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `lipsync-pro-log-${Date.now()}.txt`
              a.click()
              URL.revokeObjectURL(url)
            }}
            className="px-2.5 py-1 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >Download</button>
          <button
            onClick={clearLogs}
            className="px-2.5 py-1 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >Clear</button>
        </div>
        <div className="max-h-56 overflow-y-auto space-y-0.5 font-mono text-[11px] bg-surface-secondary/50 rounded-lg p-3 border border-border">
          {logs.length === 0 ? (
            <div className="text-muted-foreground">Log akan muncul saat proses berjalan…</div>
          ) : (
            logs.map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-muted-foreground/60 shrink-0">[{l.time}]</span>
                <span className={l.level === 'error' ? 'text-red-400' : l.level === 'success' ? 'text-green-400' : l.level === 'warn' ? 'text-yellow-400' : 'text-foreground'}>{l.msg}</span>
              </div>
            ))
          )}
        </div>
      </Section>
    </PageContent>
  )
}
