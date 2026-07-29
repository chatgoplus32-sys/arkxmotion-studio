import { useState, useRef, useCallback, useEffect, useMemo, forwardRef } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Textarea, Select, Label, EmptyState } from '@/components/ui'
import { useProviderManager, type ProviderId } from '@/stores'
import { useToastStore } from '@/stores/toastStore'
import { uploadToCatbox, submitMotionControl, pollMotionControl, checkRoboneoBalance, compressVideo, submitGoogleOmni, normalizeImage } from '@/lib/roboneo'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { removeResult, clearResults, getActiveTasks, getLogs, getResults, addBgLog, addActiveTask, addResult, clearLogs, removeActiveTask } from '@/lib/backgroundTasks'
import { startBackgroundPolling } from '@/lib/backgroundTasks'
import {
  Video,
  Upload,
  Trash2,
  Plus,
  Rocket,
  Search,
  Loader2,
  X,
  Download,
  Play,
} from 'lucide-react'

const PROVIDERS = {
  weavy: { name: 'Weavy', models: [
    { key: 'fal-ai/kling-video/v3/pro/motion-control', label: 'Kling V3.0 Pro', cr: 240 },
    { key: 'fal-ai/kling-video/v3/standard/motion-control', label: 'Kling V3.0 Standard', cr: 150 },
    { key: 'fal-ai/kling-video/v2.6/pro/motion-control', label: 'Kling V2.6 Pro', cr: 80 },
    { key: 'fal-ai/kling-video/v2.6/standard/motion-control', label: 'Kling V2.6 Standard', cr: 50 },
  ]},
  wavespeed: { name: 'Wavespeed', models: [
    { key: 'ws:kwaivgi/kling-v3.0-pro/motion-control', label: 'Kling V3.0 Pro', cr: 84 },
    { key: 'ws:kwaivgi/kling-v3.0-std/motion-control', label: 'Kling V3.0 Standard', cr: 63 },
    { key: 'ws:kwaivgi/kling-v2.6-pro/motion-control', label: 'Kling V2.6 Pro', cr: 56 },
    { key: 'ws:kwaivgi/kling-v2.6-std/motion-control', label: 'Kling V2.6 Standard', cr: 21 },
  ]},
  magnific: { name: 'Magnific', models: [
    { key: 'mag:kling-v3-motion-control-pro', label: 'Kling V3.0 Pro', cr: 84 },
    { key: 'mag:kling-v3-motion-control-std', label: 'Kling V3.0 Standard', cr: 63 },
    { key: 'mag:kling-v2-6-motion-control-pro', label: 'Kling V2.6 Pro', cr: 56 },
    { key: 'mag:kling-v2-6-motion-control-std', label: 'Kling V2.6 Standard', cr: 21 },
  ]},
  roboneo: { name: 'Roboneo', models: [
    { key: 'rn:video_bonbon_motioncontrol_v26:std', label: 'Kling V2.6 Standard (Motion Control)', cr: 0 },
    { key: 'rn:google-omni', label: 'Google Omni (Image to Video)', cr: 0 },
  ]},
}

const MAX_SLOTS = 12

interface Slot {
  id: string
  image: File | null
  imageUrl: string | null
  video: File | null
  videoUrl: string | null
  status: 'idle' | 'uploading img...' | 'uploading vid...' | 'processing' | 'done' | 'error'
  statusText?: string
  resultUrl?: string
  error?: string
}

function createSlot(): Slot {
  return {
    id: Math.random().toString(36).slice(2),
    image: null,
    imageUrl: null,
    video: null,
    videoUrl: null,
    status: 'idle',
  }
}

export default function MotionPage() {
  const [provider, setProvider] = useState<ProviderId>('weavy')
  const addToast = useToastStore((s) => s.addToast)
  const [modelKey, setModelKey] = useState(PROVIDERS.weavy.models[0].key)
  const [orientation, setOrientation] = useState<'video' | 'image'>('video')
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [keepSound, setKeepSound] = useState(true)
  const [slots, setSlots] = useState<Slot[]>([createSlot()])
  const [generating, setGenerating] = useState(() => getActiveTasks().filter((t) => t.page === 'motion').length > 0)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<Array<{ time: string; msg: string; level: string }>>(() => getLogs())
  const [results, setResults] = useState<Array<{ id: string; url: string; prompt: string; date: string }>>(() => {
    return getResults().filter((r) => r.page === 'motion').map(({ page, ...r }) => r)
  })
  const [searchQuery, setSearchQuery] = useState('')
  const generatingRef = useRef(false)
  const successRef = useRef(false)

  const { keys } = useProviderManager()

  useEffect(() => {
    const activeTasks = getActiveTasks().filter((t) => t.page === 'motion')
    const staleThreshold = 30 * 60 * 1000
    const staleTasks = activeTasks.filter((t) => Date.now() - t.startedAt > staleThreshold)
    if (staleTasks.length > 0) {
      for (const task of staleTasks) {
        removeActiveTask(task.taskId)
      }
      setGenerating(false)
      generatingRef.current = false
    }

    startBackgroundPolling()

    const sync = () => {
      const bgLogs = getLogs()
      setLogs(bgLogs)
      const bgResults = getResults().filter((r) => r.page === 'motion').map(({ page, ...r }) => r)
      setResults(bgResults)
      const hasActive = getActiveTasks().filter((t) => t.page === 'motion').length > 0
      setGenerating(hasActive)
      generatingRef.current = hasActive
    }

    window.addEventListener('arkxmotion-tasks-changed', sync)
    return () => window.removeEventListener('arkxmotion-tasks-changed', sync)
  }, [])

  const currentProvider = PROVIDERS[provider as keyof typeof PROVIDERS]
  const currentModel = currentProvider.models.find((m) => m.key === modelKey) || currentProvider.models[0]
  const isOmni = modelKey === 'rn:google-omni'
  const filledSlots = isOmni
    ? slots.filter((s) => s.image).length
    : slots.filter((s) => s.image && s.video).length
  const totalCredits = filledSlots * currentModel.cr

  const addSlot = () => {
    if (slots.length < MAX_SLOTS) {
      setSlots([...slots, createSlot()])
    }
  }

  const removeSlot = (id: string) => {
    if (slots.length > 1) {
      setSlots(slots.filter((s) => s.id !== id))
    }
  }

  const updateSlot = (id: string, updates: Partial<Slot>) => {
    setSlots(slots.map((s) => (s.id === id ? { ...s, ...updates } : s)))
  }

  const updateSlotStatus = (id: string, status: Slot['status'], statusText?: string) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, status, statusText, error: status === 'error' ? statusText : s.error } : s)))
  }

  const slotProgress = useMemo(() => {
    const filled = slots.filter((s) => s.image && s.video)
    if (filled.length === 0) return 0
    const pct = (s: Slot) => {
      if (s.status === 'done' || s.status === 'error') return 100
      if (s.status === 'processing') {
        const m = /(\d+)%/.exec(s.statusText || '')
        return m ? Math.max(60, Math.min(99, Number(m[1]))) : 70
      }
      if (s.status === 'uploading vid...') return 40
      if (s.status === 'uploading img...') return 20
      return generating ? 5 : 0
    }
    return Math.round(filled.reduce((a, s) => a + pct(s), 0) / filled.length)
  }, [slots, generating])

  const handleFileChange = (id: string, type: 'image' | 'video', file: File | null) => {
    const url = file ? URL.createObjectURL(file) : null
    if (type === 'image') {
      updateSlot(id, { image: file, imageUrl: url })
    } else {
      updateSlot(id, { video: file, videoUrl: url })
    }
  }

  const addLog = (msg: string, level: 'debug' | 'info' | 'warn' | 'error' | 'success' = 'info') => {
    addBgLog(msg, level)
    const entry = { time: new Date().toLocaleTimeString(), msg, level }
    setLogs((prev) => [...prev, entry].slice(-200))
  }

  const handleGenerate = async () => {
    if (generating) return
    const isOmni = modelKey === 'rn:google-omni'
    const filledSlots = isOmni
      ? slots.filter((s) => s.image)
      : slots.filter((s) => s.image && s.video)
    if (filledSlots.length === 0) return

    const isRoboneo = provider === 'roboneo'

    setGenerating(true)
    successRef.current = false
    generatingRef.current = true
    setLogs([])
    clearLogs()
    setProgress(0)

    // Reset slot statuses
    setSlots((prev) => prev.map((s) =>
      (isOmni ? s.image : s.image && s.video)
        ? { ...s, status: 'idle' as const, statusText: undefined, error: undefined, resultUrl: undefined }
        : s
    ))

    addLog(`🚀 Mulai generate video · ${currentProvider.name} · ${currentModel.label}`)
    addLog(`Mode: ${isOmni ? 'Image → Video (Google Omni)' : 'Motion Control (Image + Video)'}`)
    addLog(`Processing ${filledSlots.length} slot(s)...`)

    let successCount = 0
    let failCount = 0

    try {
      const rotation = await withTokenRotation<{ completedCount: number }>(
      provider,
      async (token) => {
        if (isRoboneo) {
          addLog('Checking Roboneo balance...')
          const balanceResult = await checkRoboneoBalance(token)
          if (!balanceResult.ok) {
            addLog(`Balance check: ${balanceResult.error}`, 'warn')
            throw new Error(`Token Roboneo tidak valid: ${balanceResult.error}`)
          } else {
            addLog(`Balance: ${balanceResult.balance ?? 'unknown'} · valid: ${balanceResult.isValidUser ? 'yes' : 'NO'}`)
            if (balanceResult.isValidUser === false) {
              throw new Error('Token Roboneo tidak valid (is_valid_user=false). Silakan update token.')
            }
            if (balanceResult.balance !== null && balanceResult.balance <= 0) {
              throw new Error('Balance kosong! Tidak ada credit untuk generate.')
            }
          }
        }

        let completedCount = 0

        for (let i = 0; i < filledSlots.length; i++) {
          const slot = filledSlots[i]
          const slotIdx = slots.findIndex((s) => s.id === slot.id)
          const slotNum = i + 1

          // Stagger delay between slots (1.5s)
          if (i > 0) {
            await new Promise((r) => setTimeout(r, 1500))
          }

          if (isRoboneo && slot.image) {
            let taskId: string = ''
            let roomId: string = ''
            try {
              updateSlotStatus(slot.id, 'uploading img...')
              addLog(`#${slotNum} Upload image...`)
              const normalizedImage = await normalizeImage(slot.image)
              const imageUrl = await uploadToCatbox(normalizedImage)
              addLog(`#${slotNum} Image: ${imageUrl.slice(0, 60)}...`)

              let motionVideoUrl = ''

              if (isOmni) {
                updateSlotStatus(slot.id, 'processing', 'submitting...')
                addLog(`#${slotNum} Submit to Google Omni...`)
                const result = await submitGoogleOmni({
                  accessToken: token,
                  imageUrl,
                  prompt: prompt.trim() || undefined,
                  ratio: '9:16',
                  videoDuration: 10,
                })
                taskId = result.taskId
                roomId = result.roomId
                addLog(`#${slotNum} Task: ${taskId.slice(0, 20)}...`)
              } else {
                if (!slot.video) {
                  addLog(`#${slotNum} Skipping (no video)`, 'warn')
                  continue
                }
                updateSlotStatus(slot.id, 'uploading vid...')
                addLog(`#${slotNum} Upload video...`)
                const videoFile = await compressVideo(slot.video, 4)
                motionVideoUrl = await uploadToCatbox(videoFile)
                addLog(`#${slotNum} Video: ${motionVideoUrl.slice(0, 60)}...`)

                updateSlotStatus(slot.id, 'processing', 'submitting...')
                addLog(`#${slotNum} Submit motion-control...`)
                const result = await submitMotionControl({
                  accessToken: token,
                  imageUrl,
                  videoUrl: motionVideoUrl,
                  prompt: prompt.trim() || undefined,
                  quality: 'std',
                  orientation,
                })
                taskId = result.taskId
                roomId = result.roomId
                addLog(`#${slotNum} Task: ${taskId.slice(0, 20)}...`)
              }

              addActiveTask({
                id: taskId,
                taskId,
                roomId,
                token,
                model: currentModel.label,
                prompt: prompt.trim() || '(no prompt)',
                startedAt: Date.now(),
                page: 'motion',
              })
              const originalTaskId = taskId

              updateSlotStatus(slot.id, 'processing', 'polling...')
              addLog(`#${slotNum} Polling for result...`)

              let resultUrl: string | null = null
              const MAX_RESUBMIT = 3
              for (let attempt = 1; attempt <= MAX_RESUBMIT; attempt++) {
                try {
                  resultUrl = await pollMotionControl(
                    token,
                    taskId,
                    roomId,
                    (status, pct) => {
                      updateSlotStatus(slot.id, 'processing', `${status} ${pct}%`)
                      addLog(`#${slotNum} ${status} ${pct}%`)
                      setProgress(pct)
                    }
                  )
                  break
                } catch (pollErr: any) {
                  const isBusy = /busy|sibuk|try again|later|overload|capacity|queue/i.test(pollErr.message)
                  if (isBusy && attempt < MAX_RESUBMIT) {
                    addLog(`#${slotNum} Server sibuk, retry ${attempt + 1}/${MAX_RESUBMIT}...`, 'warn')
                    await new Promise((r) => setTimeout(r, 5000))
                    if (isOmni) {
                      const retry = await submitGoogleOmni({
                        accessToken: token,
                        imageUrl,
                        prompt: prompt.trim() || undefined,
                        ratio: '9:16',
                        videoDuration: 10,
                      })
                      taskId = retry.taskId
                      roomId = retry.roomId
                    } else {
                      const retry = await submitMotionControl({
                        accessToken: token,
                        imageUrl,
                        videoUrl: motionVideoUrl,
                        prompt: prompt.trim() || undefined,
                        quality: 'std',
                        orientation,
                      })
                      taskId = retry.taskId
                      roomId = retry.roomId
                    }
                    addLog(`#${slotNum} New task: ${taskId.slice(0, 20)}...`)
                    continue
                  }
                  throw pollErr
                }
              }

              updateSlotStatus(slot.id, 'done')
              addLog(`#${slotNum} Done: ${resultUrl!.slice(0, 60)}...`, 'success')

              removeActiveTask(originalTaskId)
              addResult({
                id: taskId,
                url: resultUrl!,
                prompt: prompt.trim() || '(no prompt)',
                date: new Date().toISOString(),
                page: 'motion',
              })
              setResults((prev) => [
                {
                  id: taskId,
                  url: resultUrl!,
                  prompt: prompt.trim() || '(no prompt)',
                  date: new Date().toISOString(),
                },
                ...prev,
              ])
              completedCount++
              successCount++
            } catch (err: any) {
              updateSlotStatus(slot.id, 'error', err.message)
              addLog(`#${slotNum} Error: ${err.message}`, 'error')
              removeActiveTask(taskId)
              failCount++
            }
          } else {
            addLog(`#${slotNum} Skipping (no image/video)`, 'warn')
          }
        }

        return { completedCount }
      },
      {
        requiredCredits: totalCredits,
        onKeySwitch: (from, to, attempt) => {
          addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn')
        },
        onError: (err, key) => {
          if (detectTokenError(provider, err)) {
            addLog(`Key "${key.name}" is invalid: ${err.message}`, 'warn')
          }
        },
      }
    )

    if (rotation.ok) {
      successRef.current = true
      if (rotation.triedKeys > 1) {
        addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success')
      }
      if (failCount > 0 && successCount > 0) {
        addLog(`Selesai — ${successCount} sukses · ${failCount} gagal`, 'warn')
      } else if (failCount > 0) {
        addLog(`Semua slot gagal (${failCount})`, 'error')
      } else {
        addLog(`Selesai — ${successCount} video`, 'success')
      }
    } else {
      addLog(`Generation failed: ${rotation.error}`, 'error')
      if (isRoboneo) {
        addLog('⚠️ Credit mungkin sudah terpotong oleh server provider.', 'warn')
      }
    }

    // Refresh balance after generation
    if (isRoboneo) {
      try {
        const activeKey = useProviderManager.getState().getActiveKey('roboneo')
        if (activeKey) {
          const balanceResult = await checkRoboneoBalance(activeKey.key)
          if (balanceResult.ok && balanceResult.balance !== null) {
            addLog(`💰 Balance terakhir: ${balanceResult.balance}`, 'info')
          }
        }
      } catch {}
    }

    } catch (genErr: any) {
      addLog(`Generation error: ${genErr.message}`, 'error')
      addToast(`Generate gagal: ${genErr.message}`, 'error')
    } finally {
      if (generatingRef.current && successRef.current) {
        addToast(`Generate selesai: ${currentProvider.name} · ${currentModel.label}`, 'success')
      }
      setGenerating(false)
      generatingRef.current = false
    }
  }

  const handleDownload = useCallback(async (url: string, id: string) => {
    try {
      const proxyUrl = `/api/public/video-proxy?url=${encodeURIComponent(url)}`
      const res = await fetch(proxyUrl)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `motion-${id}.mp4`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      window.open(url, '_blank')
    }
  }, [])

  const filteredResults = results.filter(
    (r) => !searchQuery || r.prompt.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <PageContent>
      <PageHeader
        eyebrow="Generate"
        title="Motion"
        highlight="Control"
        desc="Kling Motion Control — transfer gerakan karakter dari video / gambar referensi."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Reference Slots */}
        <Section
          title={`Referensi (${slots.length}/${MAX_SLOTS})`}
          sub="Setiap pasang gambar + video menghasilkan 1 video"
          right={
            <Button size="sm" variant="outline" onClick={addSlot} disabled={slots.length >= MAX_SLOTS}>
              <Plus className="h-3.5 w-3.5" /> Tambah
            </Button>
          }
        >
          <div className={`grid gap-3 ${
            slots.length === 1 ? 'grid-cols-1' :
            slots.length === 2 ? 'grid-cols-1 lg:grid-cols-2' :
            'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3'
          }`}>
            {slots.map((slot, index) => (
              <SlotCard
                key={slot.id}
                index={index}
                slot={slot}
                onImage={(file) => handleFileChange(slot.id, 'image', file)}
                onVideo={(file) => handleFileChange(slot.id, 'video', file)}
                onRemove={() => removeSlot(slot.id)}
                canRemove={slots.length > 1}
              />
            ))}
          </div>
        </Section>

        {/* Settings */}
        <div className="flex flex-col gap-5">
          <Section title="Pengaturan" sub={`Provider aktif: ${currentProvider.name}`}>
            <div className="flex flex-col gap-4">
              <div>
                <Label>Provider</Label>
                <Select
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value as ProviderId)
                    const p = PROVIDERS[e.target.value as keyof typeof PROVIDERS]
                    setModelKey(p.models[0].key)
                  }}
                  options={Object.entries(PROVIDERS).map(([key, val]) => ({
                    value: key,
                    label: val.name,
                  }))}
                />
              </div>

              <div>
                <Label>Model</Label>
                <Select
                  value={modelKey}
                  onChange={(e) => setModelKey(e.target.value)}
                  options={currentProvider.models.map((m) => ({
                    value: m.key,
                    label: `${m.label} (${m.cr} cr)`,
                  }))}
                />
              </div>

              <div>
                <Label>Character Orientation</Label>
                <Select
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value as 'video' | 'image')}
                  options={[
                    { value: 'video', label: 'Video (durasi mengikuti referensi)' },
                    { value: 'image', label: 'Image (output max 5–10 detik)' },
                  ]}
                />
              </div>

              <div>
                <Label>Prompt (opsional)</Label>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Deskripsikan motion yang diinginkan…"
                  rows={2}
                />
              </div>

              <div>
                <Label>Negative Prompt (opsional)</Label>
                <Textarea
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="blurry, low quality, distorted…"
                  rows={2}
                />
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={keepSound}
                  onChange={(e) => setKeepSound(e.target.checked)}
                  className="peer sr-only"
                />
                <span className="h-5 w-5 rounded-md border border-input bg-background grid place-items-center peer-checked:bg-primary peer-checked:border-primary transition">
                  <svg viewBox="0 0 24 24" className="h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="text-sm text-foreground/90">Keep Original Sound</span>
              </label>

              <Button
                onClick={handleGenerate}
                disabled={filledSlots === 0 || generating}
                className="w-full"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Memproses…
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" />
                    Generate Semua
                  </>
                )}
              </Button>

              {generating && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Progress</span>
                    <span className="font-mono font-semibold text-foreground">{slotProgress}%</span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                      style={{ width: `${slotProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {!generating && progress === 100 && results.length > 0 && (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={handleGenerate}
                >
                  <Rocket className="h-4 w-4" /> Generate Lagi
                </Button>
              )}

              <div className="text-center text-xs text-muted-foreground">
                Total: <span className="text-foreground font-mono font-semibold">{totalCredits.toLocaleString()}</span> credits ({filledSlots} × {currentModel.cr})
              </div>
            </div>
          </Section>

          {/* Logs */}
          {(generating || logs.length > 0) && (
            <div className="rounded-xl border border-border/70 bg-black/40 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                  Log Proses {generating && <Loader2 className="inline h-3 w-3 animate-spin ml-1" />}
                </div>
                <button
                  onClick={() => { setLogs([]); clearLogs() }}
                  className="text-[10px] text-muted-foreground hover:text-destructive"
                >
                  Clear
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto overflow-x-hidden font-mono text-[10px] leading-relaxed min-w-0">
                {logs.slice().reverse().map((log, i) => (
                  <div
                    key={i}
                    className={`whitespace-pre-wrap break-all min-w-0 ${
                      log.level === 'error'
                        ? 'text-red-400'
                        : log.level === 'warn'
                        ? 'text-amber-400'
                        : log.level === 'success'
                        ? 'text-emerald-400'
                        : 'text-muted-foreground'
                    }`}
                  >
                    [{log.time}] {log.msg}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      {/* Gallery */}
      <Section
        title="Gallery"
        sub="Video yang telah selesai dibuat"
        right={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setResults([]); clearResults(); setLogs([]); clearLogs() }}
              disabled={results.length === 0}
              className="text-xs"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Hapus Semua
            </Button>
          </div>
        }
        >
          <div className="flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-2 mb-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search prompt…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {filteredResults.length === 0 ? (
            <EmptyState
              icon={<Video className="h-8 w-8" />}
              title="Belum ada video"
              description="Generate video dari referensi gambar dan video"
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredResults.map((result) => (
                <div
                  key={result.id}
                  className="rounded-xl overflow-hidden border border-border/60 bg-card/40 group"
                >
                  <div className="aspect-video bg-black/40 relative">
                    <video
                      src={`/api/public/video-proxy?url=${encodeURIComponent(result.url)}`}
                      className="w-full h-full object-contain"
                      controls
                      muted
                      playsInline
                    />
                  </div>
                  <div className="p-2 flex flex-col gap-1.5">
                    <span className="text-[11px] text-muted-foreground truncate" title={result.prompt}>
                      {result.prompt}
                    </span>
                    <div className="flex items-center gap-1">
                      <a
                        onClick={(e) => { e.preventDefault(); handleDownload(result.url, result.id) }}
                        href="#"
                        className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-500 transition"
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </a>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          setResults(results.filter((r) => r.id !== result.id));
                          removeResult(result.id);
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive transition"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Hapus
                      </button>
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

function SlotCard({
  index,
  slot,
  onImage,
  onVideo,
  onRemove,
  canRemove,
}: {
  index: number
  slot: Slot
  onImage: (file: File | null) => void
  onVideo: (file: File | null) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const imageRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)

  const statusColor = slot.status === 'done' ? 'text-emerald-400 border-emerald-500/40'
    : slot.status === 'error' ? 'text-red-400 border-red-500/40'
    : slot.status === 'idle' ? 'text-muted-foreground border-border'
    : 'text-amber-400 border-amber-500/40'

  return (
    <div className="rounded-2xl border border-border/70 bg-card/30 p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-foreground shrink-0">
            Referensi #{index + 1}
          </div>
          {slot.status !== 'idle' && (
            <div className={`text-[10px] px-2 py-0.5 rounded-full border bg-black/30 truncate ${statusColor}`}>
              {slot.statusText || slot.status}{slot.error ? ` — ${slot.error}` : ''}
            </div>
          )}
        </div>
        {canRemove && (
          <button
            onClick={onRemove}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card/50 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-destructive hover:border-destructive/50 transition"
          >
            <Trash2 className="h-3.5 w-3.5" /> Hapus
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FileUpload
          ref={imageRef}
          kind="image"
          label="Character Image"
          hint="PNG / JPG"
          accept="image/*"
          file={slot.image}
          previewUrl={slot.imageUrl}
          onChange={onImage}
        />
        <FileUpload
          ref={videoRef}
          kind="video"
          label="Reference Video"
          hint="MP4 / MOV"
          accept="video/*"
          file={slot.video}
          previewUrl={slot.videoUrl}
          onChange={onVideo}
        />
      </div>
    </div>
  )
}

interface FileUploadProps {
  kind: 'image' | 'video'
  label: string
  hint: string
  accept: string
  file: File | null
  previewUrl: string | null
  onChange: (file: File | null) => void
}

const FileUpload = forwardRef<HTMLInputElement, FileUploadProps>(
  ({ kind, label, hint, accept, file, previewUrl, onChange }, ref) => {
    const hasFile = !!file && !!previewUrl
    const fileSize = file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : ''

    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </label>
        <div
          onClick={() => (ref as React.RefObject<HTMLInputElement>)?.current?.click()}
          className={`relative overflow-hidden rounded-xl border border-dashed cursor-pointer group transition ${
            hasFile
              ? 'border-primary/50 bg-card/50'
              : 'border-border/80 bg-card/30 hover:border-primary/60'
          }`}
          style={{ aspectRatio: '16 / 10' }}
        >
          {hasFile ? (
            <>
              {kind === 'image' ? (
                <img src={previewUrl} alt="" className="absolute inset-0 h-full w-full object-contain bg-black/40" />
              ) : (
                <video src={previewUrl} className="absolute inset-0 h-full w-full object-contain bg-black/40" muted playsInline />
              )}
              <div className="absolute inset-x-0 bottom-0 bg-black/60 backdrop-blur-sm px-2.5 py-1.5 flex items-center justify-between text-[11px] opacity-0 group-hover:opacity-100 md:opacity-100 transition-opacity">
                <span className="truncate text-foreground/95 max-w-[70%]">{file.name}</span>
                <span className="font-mono text-muted-foreground">{fileSize}</span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(null)
                }}
                className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/70 backdrop-blur px-2 py-1 text-[11px] text-white hover:text-destructive transition"
              >
                <X className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Ganti</span>
              </button>
            </>
          ) : (
            <div className="absolute inset-0 grid place-items-center text-center px-3">
              <div className="flex flex-col items-center gap-2">
                <div className="h-10 w-10 rounded-xl grid place-items-center bg-primary text-primary-foreground">
                  <Upload className="h-5 w-5" />
                </div>
                <div className="flex items-center gap-1.5 text-sm text-foreground/90">
                  <Upload className="h-3.5 w-3.5" /> Upload
                </div>
                <div className="text-[11px] text-muted-foreground">{hint}</div>
              </div>
            </div>
          )}
          <input
            ref={ref}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>
    )
  }
)

FileUpload.displayName = 'FileUpload'
