import { useState, useRef, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Select, Label, Textarea, EmptyState } from '@/components/ui'
import { MaintenanceBanner } from '@/components/ui/MaintenanceBanner'
import { Loader2, Upload, Trash2, Download, X, ImagePlus, ExternalLink, Search, Copy, ClipboardCheck } from 'lucide-react'
import { useProviderManager, PROVIDER_CONFIGS } from '@/stores/providerManager'
import { useToastStore } from '@/stores/toastStore'
import { withTokenRotation } from '@/lib/tokenRotation'
import { submitRunningHubImageEdit, pollRunningHubTask } from '@/lib/runninghub'
import { normalizeImage } from '@/lib/roboneo'
import { addBgLog, getLogs, addResult, removeResult, startBackgroundPolling, persistResultToR2 } from '@/lib/backgroundTasks'

type EditProvider = 'riverside' | 'nexabot' | 'runninghub'

const PROVIDER_OPTIONS: Array<{ value: EditProvider; label: string; icon: string }> = [
  { value: 'nexabot', label: 'NexaBot (GPT Image)', icon: '🔮' },
  { value: 'riverside', label: 'Riverside', icon: '🎙️' },
  { value: 'runninghub', label: 'RunningHub (Kontext)', icon: '🖌️' },
]

const RIVERSIDE_IMAGE_MODELS = [
  { value: 'rs-img:gpt-image-2', label: 'GPT Image 2', cr: 8, apiModel: 'gpt-image-2' },
  { value: 'rs-img:flux-2-pro', label: 'FLUX 2 Pro', cr: 8, apiModel: 'flux-2-pro' },
  { value: 'rs-img:seedream-4.5', label: 'Seedream 4.5', cr: 10, apiModel: 'seedream-4.5' },
  { value: 'rs-img:nano-banana-2', label: 'Nano Banana 2', cr: 6, apiModel: 'nano-banana-2' },
  { value: 'rs-img:ideogram-4', label: 'Ideogram 4', cr: 8, apiModel: 'ideogram-4' },
  { value: 'rs-img:recraft-v3', label: 'Recraft V3', cr: 8, apiModel: 'recraft-v3' },
]

const NEXABOT_IMAGE_MODELS = [
  { value: 'nb:img', label: '✨ GPT Image (NexaBot)', cr: 0.1, apiModel: 'img' },
]

const RUNNINGHUB_IMAGE_MODELS = [
  { value: 'rh:kontext-edit', label: 'FLUX Kontext Edit', cr: 0, apiModel: 'kontext-edit' },
]

const ALL_MODELS: Record<EditProvider, typeof RIVERSIDE_IMAGE_MODELS> = {
  riverside: RIVERSIDE_IMAGE_MODELS,
  nexabot: NEXABOT_IMAGE_MODELS,
  runninghub: RUNNINGHUB_IMAGE_MODELS,
}

const PROVIDER_LABEL: Record<EditProvider, string> = {
  nexabot: 'NexaBot (GPT Image)',
  riverside: 'Riverside',
  runninghub: 'RunningHub (Kontext)',
}

const RIVERSIDE_PLAYGROUND_URL = 'https://riverside.com/dashboard/studios/surahs-studio-2hkky/playground?mode=image'

interface GalleryItem {
  id: string
  url: string
  prompt: string
  provider: string
  model: string
  createdAt: string
}

const GALLERY_KEY = 'arkxmotion.editimage.gallery'

function loadGallery(): GalleryItem[] {
  try { return JSON.parse(localStorage.getItem(GALLERY_KEY) || '[]') } catch { return [] }
}
function saveGallery(items: GalleryItem[]) {
  localStorage.setItem(GALLERY_KEY, JSON.stringify(items.slice(0, 200)))
}

export default function EditImagePage() {
  const addToast = useToastStore((s) => s.addToast)
  const { keys, fetchMaintenance } = useProviderManager()

  const [provider, setProvider] = useState<EditProvider>('nexabot')
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [imgFile, setImgFile] = useState<File | null>(null)
  const [model, setModel] = useState(NEXABOT_IMAGE_MODELS[0].value)
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [logs, setLogs] = useState<Array<{ time: string; msg: string; level: string }>>(() => getLogs())
  const [gallery, setGallery] = useState<GalleryItem[]>(() => loadGallery())
  const [gallerySearch, setGallerySearch] = useState('')
  const [logCopied, setLogCopied] = useState(false)
  const filePickerRef = useRef<HTMLInputElement | null>(null)

  const currentModel = ALL_MODELS[provider].find((m) => m.value === model) || ALL_MODELS[provider][0]
  const providerKeyCount = keys[provider]?.length || 0
  const hasActiveKey = keys[provider]?.some((k) => k.status !== 'invalid' && k.status !== 'expired') || false

  const addLog = (msg: string, level: 'debug' | 'info' | 'warn' | 'error' | 'success' = 'info') => {
    addBgLog(msg, level, provider)
    setLogs(getLogs())
  }

  useEffect(() => {
    fetchMaintenance()
  }, [fetchMaintenance])

  useEffect(() => {
    startBackgroundPolling()
    const sync = () => setLogs(getLogs())
    window.addEventListener('arkxmotion-tasks-changed', sync)
    return () => window.removeEventListener('arkxmotion-tasks-changed', sync)
  }, [])

  const handleFileChange = (files: FileList | null) => {
    const file = files?.[0]
    if (file) {
      setImgUrl(URL.createObjectURL(file))
      setImgFile(file)
    }
  }

  const canGenerate = (!imgFile || provider === 'nexabot') && !generating && !!prompt.trim() && hasActiveKey

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      addToast('Prompt harus diisi', 'error')
      return
    }
    if (!hasActiveKey) {
      addToast(`Tidak ada API key aktif untuk ${PROVIDER_CONFIGS[provider]?.name || provider}`, 'error')
      return
    }

    setGenerating(true)
    setLogs([])
    addLog(`🚀 Mulai generate gambar`, 'info')
    addLog(`   Provider: ${PROVIDER_LABEL[provider]}`, 'debug')
    addLog(`   Model: ${currentModel.label}`, 'debug')
    addLog(`   Mode: ${provider === 'nexabot' ? 'Text to Image' : (imgFile ? 'Edit Gambar + Prompt' : 'Text to Image')}`, 'debug')
    addLog(`   Prompt: "${prompt.trim().slice(0, 80)}${prompt.trim().length > 80 ? '...' : ''}"`, 'debug')

    try {
      if (provider === 'nexabot') {
        await handleGenerateNexabot()
      } else if (provider === 'runninghub') {
        await handleGenerateRunningHub()
      } else {
        await handleGenerateRiverside()
      }
    } catch (err: any) {
      addLog(`❌ Error: ${err.message}`, 'error')
      addToast(`Generate gagal: ${err.message}`, 'error')
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateNexabot = async () => {
    const { submitNexabot, pollNexabotJob, downloadNexabotResult } = await import('@/lib/nexabot')

    addLog(`[1/3] 📤 Submit job ke NexaBot (text to image)...`, 'info')
    const result = await submitNexabot({
      mode: 'img',
      prompt: prompt.trim(),
    })

    if (!result.ok || !result.jobId) {
      throw new Error(result.error || 'Submit gagal')
    }

    addLog(`   ✓ Job ID: ${result.jobId}`, 'success')
    if (result.creditCost) addLog(`   💰 Biaya: 0.1 kredit (image)`, 'debug')

    addLog(`[2/3] ⏳ Polling status...`, 'info')
    const job = await pollNexabotJob(result.jobId, undefined, (msg) => {
      addLog(`   ${msg}`, 'debug')
    })

    if (job.status === 'failed') {
      throw new Error(job.error || 'Job gagal')
    }
    addLog(`   ✓ Status: ${job.status}`, 'success')

    addLog(`[3/3] 📥 Download hasil...`, 'info')
    const dlResult = await downloadNexabotResult(result.jobId, undefined)
    if (!dlResult.ok || !dlResult.url) {
      throw new Error(dlResult.error || 'Download gagal')
    }
    addLog(`   ✓ Selesai!`, 'success')

    const item: GalleryItem = {
      id: `editimg-${Date.now()}`,
      url: dlResult.url,
      prompt: prompt.trim(),
      provider: 'nexabot',
      model: currentModel.label,
      createdAt: new Date().toISOString(),
    }
    setGallery((prev) => {
      const updated = [item, ...prev]
      saveGallery(updated)
      return updated
    })
    addResult({
      id: item.id,
      url: item.url,
      prompt: item.prompt,
      date: new Date().toISOString(),
      page: 'edit-image',
      provider: 'nexabot',
      model: item.model,
    })
    persistResultToR2(item.id, item.url)
    window.dispatchEvent(new Event('arkxmotion-tasks-changed'))
    addToast('Generate gambar selesai!', 'success')
  }

  const handleGenerateRunningHub = async () => {
    if (!imgFile) {
      addToast('Upload gambar terlebih dahulu untuk mode edit', 'error')
      return
    }

    addLog(`[1/3] 🖼️ Normalisasi gambar...`, 'info')
    let upFile = imgFile
    try {
      upFile = await normalizeImage(imgFile, (msg) => addLog(`   ${msg}`, 'debug'))
      addLog(`   ✓ Siap: ${(upFile.size / 1024).toFixed(0)}KB`, 'debug')
    } catch (e: any) {
      addLog(`   ⚠️ Normalisasi gagal, pakai file asli: ${e.message}`, 'warn')
    }

    const rotation = await withTokenRotation<string>(
      provider,
      async (apiKey, keyInfo) => {
        addLog(`🔑 Trying key: ${keyInfo.name || keyInfo.id}`, 'info')
        addLog(`[2/3] 🚀 Submit ke RunningHub Kontext...`, 'info')

        const submit = await submitRunningHubImageEdit({
          imageFile: upFile,
          prompt: prompt.trim(),
          apiKey,
        })
        addLog(`   ✓ Task: ${submit.taskId.slice(0, 20)}...`, 'success')

        addLog(`[3/3] ⏳ Polling hasil...`, 'info')
        const url = await pollRunningHubTask(submit.taskId, (status, pct) => {
          addLog(`   ${status} ${pct}%`, 'debug')
        }, 600000, apiKey)
        return url
      },
      {
        onKeySwitch: (from, to, attempt) => {
          addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn')
        },
        onError: (err, key) => {
          addLog(`⚠️ Key "${key.name}" error: ${err.message}`, 'warn')
        },
      }
    )

    if (rotation.ok && rotation.result) {
      const item: GalleryItem = {
        id: `editimg-${Date.now()}`,
        url: rotation.result,
        prompt: prompt.trim(),
        provider: 'runninghub',
        model: currentModel.label,
        createdAt: new Date().toISOString(),
      }
      setGallery((prev) => {
        const updated = [item, ...prev]
        saveGallery(updated)
        return updated
      })
      addResult({
        id: item.id,
        url: item.url,
        prompt: item.prompt,
        date: new Date().toISOString(),
        page: 'edit-image',
        provider: 'runninghub',
        model: item.model,
      })
      persistResultToR2(item.id, item.url)
      window.dispatchEvent(new Event('arkxmotion-tasks-changed'))
      addLog(`[3/3] ✅ Selesai ✓`, 'success')
      addToast('Edit gambar selesai!', 'success')
    } else {
      throw new Error(rotation.error || 'Generation failed')
    }
  }

  const handleGenerateRiverside = async () => {    if (!imgFile) {
      addToast('Upload gambar terlebih dahulu untuk mode edit', 'error')
      return
    }

    const rotation = await withTokenRotation<string>(
      provider,
      async (apiKey, keyInfo) => {
        addLog(`🔑 Trying key: ${keyInfo.name || keyInfo.id}`, 'info')
        addLog(`[1/3] 🖼️ Uploading image ke Riverside...`, 'info')

        const { generateRiversideImage } = await import('@/lib/riverside')
        const result = await generateRiversideImage({
          token: apiKey,
          modelId: (currentModel as any).apiModel || 'gpt-image-2',
          prompt: prompt.trim(),
          imageFile: imgFile,
          onLog: (msg, level = 'info') => {
            addLog(msg, level as any)
          },
        })

        if (!result.ok) {
          throw new Error(result.error || 'Image edit failed')
        }

        addLog(`[3/3] ✅ Selesai ✓`, 'success')
        return result.imageUrl!
      },
      {
        onKeySwitch: (from, to, attempt) => {
          addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn')
        },
        onError: (err, key) => {
          addLog(`⚠️ Key "${key.name}" error: ${err.message}`, 'warn')
        },
      }
    )

    if (rotation.ok && rotation.result) {
      const item: GalleryItem = {
        id: `editimg-${Date.now()}`,
        url: rotation.result,
        prompt: prompt.trim(),
        provider: 'riverside',
        model: currentModel.label,
        createdAt: new Date().toISOString(),
      }
      setGallery((prev) => {
        const updated = [item, ...prev]
        saveGallery(updated)
        return updated
      })
      addResult({
        id: item.id,
        url: item.url,
        prompt: item.prompt,
        date: new Date().toISOString(),
        page: 'edit-image',
        provider: 'riverside',
        model: item.model,
      })
      persistResultToR2(item.id, item.url)
      window.dispatchEvent(new Event('arkxmotion-tasks-changed'))
      addToast('Edit gambar selesai!', 'success')
    } else {
      throw new Error(rotation.error || 'Generation failed')
    }
  }

  const filteredGallery = gallery.filter((g) =>
    !gallerySearch ||
    g.prompt.toLowerCase().includes(gallerySearch.toLowerCase()) ||
    g.model.toLowerCase().includes(gallerySearch.toLowerCase())
  )

  const removeGalleryItem = (id: string) => {
    removeResult(id)
    setGallery((prev) => {
      const updated = prev.filter((e) => e.id !== id)
      saveGallery(updated)
      return updated
    })
  }

  const copyAllLogs = async () => {
    const text = logs.map((l) => `[${l.time}] ${l.msg}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setLogCopied(true)
      addToast('Log disalin ke clipboard', 'success')
      setTimeout(() => setLogCopied(false), 2000)
    } catch {
      addToast('Gagal copy log', 'error')
    }
  }

  const clearLogs = () => {
    setLogs([])
    addToast('Log dihapus', 'info')
  }

  const downloadItem = async (item: GalleryItem) => {
    try {
      const res = await fetch(item.url, { mode: 'cors' })
      const blob = await res.blob()
      const ext = /\\.(png|jpe?g|webp)(\\?|$)/i.exec(item.url)?.[1]?.toLowerCase() || 'jpg'
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `edit-image-${item.id}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    } catch {
      window.open(item.url, '_blank')
    }
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Generate"
        title="Edit"
        highlight="Image"
        desc="Edit gambar dengan AI — upload foto, pilih model, tulis prompt, hasil langsung."
      />

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Config Panel */}
          <div className="lg:col-span-1 space-y-5">
            <Section title="Konfigurasi" sub="Pilih provider & model AI">
              <div className="space-y-4">
                <Label>Provider</Label>
                <Select
                  value={provider}
                  onChange={(e) => {
                    const newProvider = e.target.value as EditProvider
                    setProvider(newProvider)
                    setModel(ALL_MODELS[newProvider][0].value)
                  }}
                  disabled={generating}
                  options={PROVIDER_OPTIONS.map((p) => ({
                    value: p.value,
                    label: `${p.icon} ${p.label}`,
                  }))}
                />

                <MaintenanceBanner providerId={provider} />

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>API Keys: <b className={providerKeyCount > 0 ? 'text-emerald-500' : 'text-destructive'}>{providerKeyCount}</b> tersedia</span>
                  {!hasActiveKey && (
                    <a href="/providers" className="text-primary hover:underline font-medium">Tambah API key →</a>
                  )}
                </div>

                <Label>Model AI</Label>
                <Select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={generating}
                  options={ALL_MODELS[provider].map((m) => ({
                    value: m.value,
                    label: provider === 'nexabot'
                      ? `${m.label} — $${m.cr}/gambar`
                      : provider === 'runninghub'
                        ? `${m.label} — koin RH`
                        : `${m.label} — $${((m as any).cr / 1000).toFixed(3)}`,
                  }))}
                />

                <Label>Prompt</Label>
                <Textarea
                  rows={4}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={generating}
                  placeholder={provider === 'nexabot'
                    ? 'Deskripsikan gambar yang diinginkan — mis. "kucing berdiri di atas bulan", "potret wanita di taman bunga"...'
                    : 'Deskripsikan edit yang diinginkan — mis. "ubah latar jadi studio neon", "buat versi kartun", "tambah cahaya dramatis"...'
                  }
                />

                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                  <div className="font-medium text-foreground">💡 NexaBot Image</div>
                  <div>• <b>Text to Image</b> — cukup tulis prompt</div>
                  <div>• 💰 0.1 kredit/gambar • ♾️ Gratis kalau Unlimited aktif</div>
                  <div>• ⚠️ Untuk edit gambar, gunakan <b>Riverside</b> atau <b>RunningHub (Kontext)</b></div>
                </div>

                <div className="flex flex-col gap-2 pt-2">
                  <Button onClick={handleGenerate} disabled={!canGenerate} loading={generating}>
                    {generating ? 'Memproses...' : (provider === 'nexabot' ? 'Generate Gambar' : (imgFile ? 'Edit Gambar' : 'Generate Gambar'))}
                  </Button>
                  {provider === 'riverside' && (
                    <a
                      href={RIVERSIDE_PLAYGROUND_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background h-10 px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-all"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Buka di Riverside Playground
                    </a>
                  )}
                </div>

                {!hasActiveKey && (
                  <div className="text-[11px] text-blue-400 bg-blue-500/10 rounded-lg p-2 border border-blue-500/20">
                    Tambahkan API key <b>{PROVIDER_LABEL[provider]}</b> di halaman <b>Providers</b> untuk bisa generate dari sini.
                  </div>
                )}
              </div>
            </Section>
          </div>

          {/* Image Panel */}
          <div className="lg:col-span-2 space-y-5">
            <Section
              title={provider === 'nexabot' ? '🖼️ Gambar (Opsional)' : '🖼️ Gambar Input'}
              sub={provider === 'nexabot' ? 'NexaBot hanya mendukung Text to Image — untuk edit gambar pakai Riverside / RunningHub' : 'Upload 1 gambar untuk diedit'}
              right={
                <button
                  onClick={() => filePickerRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-border cursor-pointer hover:bg-accent/40"
                >
                  <Upload className="h-4 w-4" /> Upload
                </button>
              }
            >
              <input
                ref={filePickerRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => { if (e.target.files) handleFileChange(e.target.files); e.target.value = '' }}
              />
              {!imgUrl ? (
                <button
                  onClick={() => filePickerRef.current?.click()}
                  className="w-full p-10 text-sm text-muted-foreground border border-dashed border-border rounded-xl hover:bg-accent/30 transition-all"
                >
                  <ImagePlus className="h-8 w-8 mx-auto mb-2 opacity-60" />
                  {provider === 'nexabot'
                    ? 'NexaBot tidak mendukung edit gambar — gunakan Riverside untuk edit gambar'
                    : 'Tap atau tarik gambar untuk diedit'
                  }
                </button>
              ) : (
                <div className="relative rounded-xl overflow-hidden border border-border bg-black/40">
                  <img src={imgUrl} alt="Gambar yang akan diedit" className="w-full max-h-[420px] object-contain" />
                  {!generating && (
                    <button
                      onClick={() => { if (imgUrl) URL.revokeObjectURL(imgUrl); setImgUrl(null); setImgFile(null) }}
                      className="absolute top-2 right-2 h-7 w-7 grid place-items-center rounded-full bg-black/70 text-white hover:bg-black/90"
                      title="Hapus gambar"
                      aria-label="Hapus gambar yang akan diedit"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {generating && (
                    <div className="absolute inset-0 bg-black/50 grid place-items-center">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <span className="text-xs text-muted-foreground">Mengedit gambar...</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Section>

            {/* Log */}
            <Section
              title="📋 Log"
              sub={`Total ${logs.length} entri`}
              right={
                logs.length > 0 ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={copyAllLogs}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 px-2.5 py-1 text-xs hover:text-foreground hover:border-primary/50 transition"
                      title="Copy semua log"
                    >
                      {logCopied ? <ClipboardCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      {logCopied ? 'Copied!' : 'Copy'}
                    </button>
                    <button
                      onClick={clearLogs}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 px-2.5 py-1 text-xs hover:text-destructive hover:border-destructive/50 transition"
                      title="Hapus semua log"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Hapus
                    </button>
                  </div>
                ) : undefined
              }
            >
              <div className="rounded-xl border border-border/60 bg-black/40 p-2 max-h-52 overflow-y-auto overflow-x-hidden text-[11px] font-mono min-w-0">
                {logs.length === 0 ? (
                  <div className="text-muted-foreground px-1 py-2">Belum ada log.</div>
                ) : logs.map((log, i) => (
                  <div key={i} className={`break-all min-w-0 ${
                    log.level === 'error' ? 'text-red-400' :
                    log.level === 'warn' ? 'text-blue-400' :
                    log.level === 'success' ? 'text-emerald-400' :
                    'text-muted-foreground'
                  }`}>
                    [{log.time}] {log.msg}
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </div>

        {/* Gallery */}
        <Section
          title="Gallery Hasil"
          sub="Gambar hasil edit"
          right={
            <div className="flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={gallerySearch}
                onChange={(e) => setGallerySearch(e.target.value)}
                placeholder="Cari prompt/model…"
                className="w-40 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          }
        >
          {filteredGallery.length === 0 ? (
            <EmptyState icon={<ImagePlus className="h-8 w-8" />} title="Belum ada hasil" description="Hasil edit gambar akan muncul di sini" />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredGallery.map((item) => (
                <div key={item.id} className="rounded-xl overflow-hidden border border-border/60 bg-card/40 group">
                  <a href={item.url} target="_blank" rel="noreferrer" className="block relative bg-black/40">
                    <img src={item.url} alt={item.prompt?.slice(0, 80) || 'Hasil edit gambar'} className="w-full h-auto object-contain" loading="lazy" />
                  </a>
                  <div className="p-2 text-[11px] text-muted-foreground space-y-0.5">
                    <div className="truncate" title={item.prompt}>💬 {item.prompt}</div>
                    <div className="truncate">🎙️ {item.model}</div>
                    <div className="flex items-center justify-between gap-1 pt-1">
                      <span className="truncate">{new Date(item.createdAt).toLocaleString()}</span>
                      <span className="flex gap-1 shrink-0">
                        <button onClick={() => downloadItem(item)}
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 px-2 py-1 hover:text-foreground hover:border-primary/50 transition" title="Download">
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => removeGalleryItem(item.id)}
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 px-2 py-1 hover:text-destructive hover:border-destructive/50 transition" title="Hapus">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </PageContent>
  )
}