import { useState, useRef, useCallback, useEffect, useMemo, forwardRef } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Textarea, Select, Label, EmptyState, QuickRoutingDialog, getActiveProviderForCap } from '@/components/ui'
import { useProviderManager, type ProviderId } from '@/stores'
import { MaintenanceBanner } from '@/components/ui/MaintenanceBanner'
import { useToastStore } from '@/stores/toastStore'
import { uploadToCatbox, submitMotionControl, pollRoboneoI2V, checkRoboneoBalance, compressVideo, submitGoogleOmni, normalizeImage, getVideoDurationFromFile } from '@/lib/roboneo'
import { submitWeavyMotionControl, uploadWeavyAssetWithRetry, resolveWeavyAssetUrl, getActiveWeavyAccessToken, compressImageForWeavy } from '@/lib/weavy'
import { getRunningHubApiKey, submitRunningHubMotionControl, pollRunningHubTask } from '@/lib/runninghub'
import { getGalleri5Headers, getGalleri5AuthHeaders, submitGalleri5MotionControl, pollGalleri5MotionControl, checkGalleri5Balance, isGalleri5TokenError, GALLERI5_MOTION_MODELS } from '@/lib/galleri5'
import { trimVideoFFmpeg } from '@/lib/ffmpeg-compress'
import { getMagnificApiKey, submitMagnificMotion, pollMagnificMotion, type MagnificMotionModel } from '@/lib/magnific'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { removeResult, clearResults, getActiveTasks, getLogs, getResults, addBgLog, addActiveTask, addResult, clearLogs, removeActiveTask } from '@/lib/backgroundTasks'
import { startBackgroundPolling } from '@/lib/backgroundTasks'
import { logGenerationStart, logGenerationComplete, logGenerationFailed } from '@/lib/generationLog'
import { useAuthStore } from '@/stores/authStore'
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
  Repeat,
} from 'lucide-react'

const PROVIDERS = {
  weavy: { name: 'Weavy', models: [
    { key: 'fal-ai/kling-video/v3/pro/motion-control', label: 'Kling V3.0 Pro', cr: 50 },
    { key: 'fal-ai/kling-video/v3/standard/motion-control', label: 'Kling V3.0 Standard', cr: 50 },
    { key: 'fal-ai/kling-video/v2.6/pro/motion-control', label: 'Kling V2.6 Pro', cr: 50 },
    { key: 'fal-ai/kling-video/v2.6/standard/motion-control', label: 'Kling V2.6 Standard', cr: 50 },
  ]},
  wavespeed: { name: 'Wavespeed', models: [
    { key: 'ws:kwaivgi/kling-v3.0-pro/motion-control', label: 'Kling V3.0 Pro', cr: 84 },
    { key: 'ws:kwaivgi/kling-v3.0-std/motion-control', label: 'Kling V3.0 Standard', cr: 63 },
    { key: 'ws:kwaivgi/kling-v2.6-pro/motion-control', label: 'Kling V2.6 Pro', cr: 56 },
    { key: 'ws:kwaivgi/kling-v2.6-std/motion-control', label: 'Kling V2.6 Standard', cr: 21 },
  ]},
  roboneo: { name: 'RoboNeo (Meitu)', models: [
    { key: 'rn:video_bonbon_motioncontrol_v30:std', label: 'Kling V3.0 Standard (RoboNeo · Meitu)', cr: 80 },
  ]},
  magnific: { name: 'Magnific', models: [
    { key: 'mag:kling-v3-motion-control-pro', label: 'Kling V3.0 Pro (Magnific)', cr: 84 },
    { key: 'mag:kling-v3-motion-control-std', label: 'Kling V3.0 Standard (Magnific)', cr: 63 },
    { key: 'mag:kling-v2-6-motion-control-pro', label: 'Kling V2.6 Pro (Magnific)', cr: 56 },
    { key: 'mag:kling-v2-6-motion-control-std', label: 'Kling V2.6 Standard (Magnific)', cr: 21 },
  ]},
  framia: { name: 'Framia', models: [
    { key: 'framia:kling-v2.1-motion', label: 'Kling V2.1 Motion Control (Framia)', cr: 40 },
    { key: 'framia:kling-v2.6-motion', label: 'Kling V2.6 Motion Control (Framia)', cr: 35 },
  ]},
  runninghub: { name: 'Motion Control HD (Markasflow-V2)', models: [
    { key: 'rh:pro:2.6', label: 'Kling 2.6 Pro (Markasflow-V2)', cr: 80 },
    { key: 'rh:std:2.6', label: 'Kling 2.6 Standard (Markasflow-V2)', cr: 50 },
    { key: 'rh:pro:2.1', label: 'Kling 2.1 Pro (Markasflow-V2)', cr: 60 },
    { key: 'rh:std:2.1', label: 'Kling 2.1 Standard (Markasflow-V2)', cr: 35 },
  ]},
  galleri5: { name: 'G5 AI Studio', models: [
    { key: 'g5:kling-v3-std-motion-control', label: 'Kling V3.0 Standard (Galery5)', cr: 100 },
    { key: 'g5:kling-v2.6-pro-motion-control', label: 'Kling V2.6 Pro (Galery5)', cr: 120 },
    { key: 'g5:kling-v2.6-std-motion-control', label: 'Kling V2.6 Standard (Galery5)', cr: 60 },
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
  const [provider, setProvider] = useLocalStorage<ProviderId>('motion.provider', 'wavespeed')
  const addToast = useToastStore((s) => s.addToast)
  const [modelKey, setModelKey] = useLocalStorage('motion.modelKey', PROVIDERS.wavespeed.models[0]?.key || '')
  const [orientation, setOrientation] = useLocalStorage<'video' | 'image'>('motion.orientation', 'video')
  const [prompt, setPrompt] = useLocalStorage('motion.prompt', '')
  const [negativePrompt, setNegativePrompt] = useLocalStorage('motion.negativePrompt', '')
  const [keepSound, setKeepSound] = useLocalStorage('motion.keepSound', true)
  const [autoTrim, setAutoTrim] = useLocalStorage('motion.autoTrim', true)
  const [tiktokUrl, setTiktokUrl] = useState('')
  const [tiktokLoading, setTiktokLoading] = useState(false)
  const [slots, setSlots] = useState<Slot[]>(() => {
    try {
      const raw = localStorage.getItem('motion.slots')
      if (raw) {
        const parsed = JSON.parse(raw) as Array<Omit<Slot, 'image' | 'video'>>
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((s) => ({ ...s, image: null, video: null }))
        }
      }
    } catch {}
    return [createSlot()]
  })
  const [generating, setGenerating] = useState(() => getActiveTasks().filter((t) => t.page === 'motion').length > 0)
  const [compressDialog, setCompressDialog] = useState<{ msg: string; pct?: number } | null>(null)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<Array<{ time: string; msg: string; level: string }>>(() => getLogs())
  const [results, setResults] = useState<Array<{ id: string; url: string; prompt: string; date: string }>>(() => {
    return getResults().filter((r) => r.page === 'motion').map(({ page, ...r }) => r)
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [elapsed, setElapsed] = useState('0:00')
  const elapsedRef = useRef<number | null>(null)
  const generatingRef = useRef(false)
  const successRef = useRef(false)
  const [showRoutingDialog, setShowRoutingDialog] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void; tone?: 'default' | 'danger' } | null>(null)

  const { keys, fetchMaintenance } = useProviderManager()

  useEffect(() => {
    fetchMaintenance()
    // Auto-correct provider if it has no models (e.g. 'weavy')
    const p = PROVIDERS[provider as keyof typeof PROVIDERS]
    if (!p || p.models.length === 0) {
      setProvider('wavespeed')
      const wp = PROVIDERS.wavespeed
      if (wp.models.length > 0) setModelKey(wp.models[0].key)
    }
  }, [fetchMaintenance])

  useEffect(() => {
    const sync = () => {
      const cap = getActiveProviderForCap('motion')
      if (cap && cap !== provider && PROVIDERS[cap as keyof typeof PROVIDERS]) {
        setProvider(cap as ProviderId)
        const p = PROVIDERS[cap as keyof typeof PROVIDERS]
        if (p.models.length > 0) setModelKey(p.models[0].key)
      }
    }
    sync()
    window.addEventListener('aatools:routing-changed', sync)
    window.addEventListener('focus', sync)
    return () => {
      window.removeEventListener('aatools:routing-changed', sync)
      window.removeEventListener('focus', sync)
    }
  }, [])

  useEffect(() => {
    const metadata = slots.map(({ image, video, ...rest }) => rest)
    try { localStorage.setItem('motion.slots', JSON.stringify(metadata)) } catch {}
  }, [slots])

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

  useEffect(() => {
    if (!generating) {
      if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null }
      return
    }
    const start = Date.now()
    setElapsed('0:00')
    elapsedRef.current = window.setInterval(() => {
      const sec = Math.floor((Date.now() - start) / 1000)
      setElapsed(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`)
    }, 1000)
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current) }
  }, [generating])

  const currentProvider = PROVIDERS[provider as keyof typeof PROVIDERS] || PROVIDERS.wavespeed
  const currentModel = currentProvider.models.find((m) => m.key === modelKey) || currentProvider.models[0]
  const isOmni = modelKey === 'rn:google-omni'
  const filledSlots = isOmni
    ? slots.filter((s) => s.image).length
    : slots.filter((s) => s.image && s.video).length
  const totalCredits = filledSlots * (currentModel?.cr || 0)

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

  const statusSummary = useMemo(() => {
    const filled = slots.filter((s) => s.image && s.video)
    if (filled.length === 0) return 'Idle'
    const doneCount = filled.filter((s) => s.status === 'done').length
    const errorCount = filled.filter((s) => s.status === 'error').length
    if (!generating && doneCount + errorCount === filled.length && doneCount + errorCount > 0) {
      return errorCount > 0
        ? `Selesai — ${doneCount} sukses · ${errorCount} gagal`
        : `Selesai — ${doneCount} video`
    }
    if (generating) {
      const active = filled.find((s) => s.status !== 'done' && s.status !== 'error' && s.status !== 'idle')
      return active ? `Slot #${filled.indexOf(active) + 1}: ${active.statusText || active.status}` : 'Memproses…'
    }
    return 'Idle'
  }, [slots, generating])

  const handleFileChange = async (id: string, type: 'image' | 'video', file: File | null) => {
    if (!file) {
      const url = null
      if (type === 'image') {
        updateSlot(id, { image: null, imageUrl: null })
      } else {
        updateSlot(id, { video: null, videoUrl: null })
      }
      return
    }

    const sizeLimit = 4 * 1024 * 1024

    if (provider === 'roboneo' && file.size > sizeLimit) {
      const label = type === 'image' ? 'gambar' : 'video'
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
      const doCompress = window.confirm(
        `File ${label} berukuran ${sizeMB}MB. Roboneo membatasi upload maksimal 4MB.\n\nKlik OK untuk mengompres file otomatis.`
      )
      if (doCompress) {
        setCompressDialog({ msg: `Mengompres ${label}...` })
        try {
          let compressed: File
          if (type === 'image') {
            compressed = await normalizeImage(file)
          } else {
            compressed = await compressVideo(file, 4, (msg, pct) => {
              setCompressDialog({ msg, pct })
            })
          }
          setCompressDialog(null)
          const url = URL.createObjectURL(compressed)
          if (type === 'image') {
            updateSlot(id, { image: compressed, imageUrl: url })
          } else {
            updateSlot(id, { video: compressed, videoUrl: url })
          }
          addLog(`#${id.slice(0, 4)} ${label} dikompres: ${(file.size / (1024 * 1024)).toFixed(1)}MB → ${(compressed.size / (1024 * 1024)).toFixed(1)}MB`, 'success')
        } catch (err: any) {
          setCompressDialog(null)
          addLog(`Kompresi gagal: ${err.message}`, 'error')
        }
        return
      }
    }

    const url = URL.createObjectURL(file)
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

  const handleTiktokImport = async () => {
    if (!tiktokUrl.trim()) return
    setTiktokLoading(true)
    addLog('Fetching TikTok video...')
    try {
      const res = await fetch('/api/public/tiktok-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: tiktokUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error || `HTTP ${res.status}`)
      
      addLog(`TikTok video found, downloading...`)
      const videoRes = await fetch(data.url)
      if (!videoRes.ok) throw new Error('Failed to download video')
      const blob = await videoRes.blob()
      const file = new File([blob], `tiktok_${Date.now()}.mp4`, { type: 'video/mp4' })
      
      const targetSlot = slots.find(s => !s.video) || slots[slots.length - 1]
      const url = URL.createObjectURL(file)
      updateSlot(targetSlot.id, { video: file, videoUrl: url })
      addLog(`TikTok video loaded: ${(file.size / 1024 / 1024).toFixed(1)}MB`, 'success')
      setTiktokUrl('')
    } catch (err: any) {
      addLog(`TikTok import failed: ${err.message}`, 'error')
      addToast(`Gagal import TikTok: ${err.message}`, 'error')
    } finally {
      setTiktokLoading(false)
    }
  }

  const handleGenerate = async () => {
    if (generating) return
    const isOmni = modelKey === 'rn:google-omni'
    const filledSlots = isOmni
      ? slots.filter((s) => s.image)
      : slots.filter((s) => s.image && s.video)
    if (filledSlots.length === 0) return

    const isRoboneo = provider === 'roboneo'
    const isMagnific = provider === 'magnific'
    const isFramia = provider === 'framia'

    // Validate all slots comprehensively before generating
    const validationErrors: string[] = []
    const slotValidations: Array<{ id: string; index: number; error?: string }> = []
    
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      const slotNum = i + 1
      
      // Check slot requirements based on model
      if (isOmni) {
        if (!slot.image) {
          validationErrors.push(`#${slotNum} - Referensi #${slotNum}: Harap upload gambar untuk Google Omni`)
          slotValidations.push({ id: slot.id, index: i, error: 'Harap upload gambar' })
        }
      } else {
        if (!slot.image) {
          validationErrors.push(`#${slotNum} - Referensi #${slotNum}: Harap upload gambar (motion control)`)
          slotValidations.push({ id: slot.id, index: i, error: 'Harap upload gambar' })
        }
        if (!slot.video) {
          validationErrors.push(`#${slotNum} - Referensi #${slotNum}: Harap upload video referensi`
            + (slot.image ? '' : ', dan gambar'))
          slotValidations.push({ id: slot.id, index: i, error: 'Harap upload video referensi' })
        }
      }
      
      // Update slot validation status
      if (slotValidations.some(v => v.id === slot.id)) {
        updateSlotStatus(slot.id, 'error', slotValidations.find(v => v.id === slot.id)?.error)
      }
    }
    
    if (validationErrors.length > 0) {
      addLog(`❌ Validasi gagal: ${validationErrors.length} slot perlu diperbaiki`, 'error')
      validationErrors.forEach(err => addLog(err, 'error'))
      addToast('Harap perbaiki slot yang ditandai error terlebih dahulu', 'error')
      return
    }

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

    const startTime = Date.now()
    const currentUser = useAuthStore.getState().user
    const logId = currentUser ? await logGenerationStart({
      page: 'motion',
      provider,
      model: currentModel.label,
      prompt: prompt.slice(0, 500),
      credits: currentModel.cr * filledSlots.length,
      slot_count: filledSlots.length,
    }) : null

    try {
      const rotation = await withTokenRotation<{ completedCount: number; failCount: number }>(
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

        const processSlot = async (slot: Slot, slotNum: number, token: string, staggerMs: number = 0): Promise<boolean> => {
          // Stagger start to prevent overwhelming the server
          if (staggerMs > 0) await new Promise(r => setTimeout(r, staggerMs))

          if (isRoboneo && slot.image) {
            let taskId: string = ''
            let roomId: string = ''
            let nodeId: string = ''
            try {
              let imageUrl = slot.imageUrl || ''
              
              // Force re-upload if cached URL is blob URL (not accessible by RoboNeo)
              if (imageUrl && imageUrl.startsWith('blob:')) {
                addLog(`#${slotNum} ⚠ Cached image adalah blob URL, re-upload...`)
                imageUrl = ''
                updateSlot(slot.id, { imageUrl: null })
              }
              
              if (!imageUrl) {
                updateSlotStatus(slot.id, 'uploading img...')
                addLog(`#${slotNum} Upload image...`)
                const normalizedImage = await normalizeImage(slot.image, (msg, pct) => {
                  setCompressDialog({ msg, pct })
                  updateSlotStatus(slot.id, 'uploading img...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                setCompressDialog(null)
                imageUrl = await uploadToCatbox(normalizedImage, 'image', (msg, pct) => {
                  updateSlotStatus(slot.id, 'uploading img...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                updateSlot(slot.id, { imageUrl })
                addLog(`#${slotNum} Image: ${imageUrl.slice(0, 60)}...`)
              } else {
                addLog(`#${slotNum} Using cached image URL`)
              }

              let motionVideoUrl = slot.videoUrl || ''
              
              // Force re-upload if cached URL is blob URL
              if (motionVideoUrl && motionVideoUrl.startsWith('blob:')) {
                addLog(`#${slotNum} ⚠ Cached video adalah blob URL, re-upload...`)
                motionVideoUrl = ''
                updateSlot(slot.id, { videoUrl: null })
              }

              // Force re-upload if autoTrim is enabled
              if (autoTrim && isRoboneo && motionVideoUrl && slot.video) {
                addLog(`#${slotNum} Auto-trim aktif, re-upload video...`)
                motionVideoUrl = ''
                updateSlot(slot.id, { videoUrl: null })
              }

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
                if (!slot.video && !motionVideoUrl) {
                  addLog(`#${slotNum} Skipping (no video)`, 'warn')
                  return false
                }
                if (!motionVideoUrl) {
                  updateSlotStatus(slot.id, 'uploading vid...')

                  let videoToUpload = slot.video!
                  // FFmpeg WASM tidak work di semua browser, skip trim untuk sekarang
                  // Video akan dikirim as-is ke RoboNeo (biaya mengikuti durasi)
                  if (autoTrim && isRoboneo) {
                    addLog(`#${slotNum} ℹ Auto-trim aktif tapi FFmpeg WASM tidak tersedia. Video dikirim as-is.`, 'warn')
                  }

                  addLog(`#${slotNum} Upload video...`)
                  const videoFile = await compressVideo(videoToUpload, 4, (msg, pct) => {
                    setCompressDialog({ msg, pct })
                    updateSlotStatus(slot.id, 'uploading vid...', msg)
                    addLog(`#${slotNum} ${msg}`)
                  })
                  setCompressDialog(null)
                  motionVideoUrl = await uploadToCatbox(videoFile, 'video', (msg, pct) => {
                    updateSlotStatus(slot.id, 'uploading vid...', msg)
                    addLog(`#${slotNum} ${msg}`)
                  })
                  updateSlot(slot.id, { videoUrl: motionVideoUrl })
                  addLog(`#${slotNum} Video: ${motionVideoUrl.slice(0, 60)}...`)
                } else {
                  addLog(`#${slotNum} Using cached video URL`)
                }

                updateSlotStatus(slot.id, 'processing', 'submitting...')
                addLog(`#${slotNum} Submit motion-control...`)

                // Detect video duration for billing
                let videoDurationSec = 10
                if (slot.video) {
                  videoDurationSec = await getVideoDurationFromFile(slot.video)
                  addLog(`#${slotNum} Video duration: ${videoDurationSec}s`)
                }

                const result = await submitMotionControl({
                  accessToken: token,
                  imageUrl,
                  videoUrl: motionVideoUrl,
                  prompt: prompt.trim() || undefined,
                  negativePrompt: negativePrompt.trim() || undefined,
                  orientation,
                  keepSound,
                  modelKey: currentModel.key,
                  autoTrim,
                  ratio: '9:16',
                  videoDuration: videoDurationSec,
                })
                taskId = result.taskId
                roomId = result.roomId
                nodeId = result.nodeId
                addLog(`#${slotNum} Task: ${taskId.slice(0, 20)}...`)
              }

              addActiveTask({
                id: taskId,
                taskId,
                roomId,
                nodeId,
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
              const MAX_RESUBMIT = 5
              for (let attempt = 1; attempt <= MAX_RESUBMIT; attempt++) {
                try {
                  resultUrl = await pollRoboneoI2V(
                    token,
                    taskId,
                    roomId,
                    (status, pct) => {
                      updateSlotStatus(slot.id, 'processing', `${status} ${pct}%`)
                      addLog(`#${slotNum} ${status} ${pct}%`)
                      setProgress(pct)
                    },
                    3600000,
                    undefined,
                    nodeId
                  )
                  break
                } catch (pollErr: any) {
                  const isBusy = /busy|sibuk|try again|later|overload|capacity|queue|结果接口获取失败|error_code.*6/i.test(pollErr.message)
                  if (isBusy && attempt < MAX_RESUBMIT) {
                    const waitSec = 10 + attempt * 5
                    addLog(`#${slotNum} Server sibuk, retry ${attempt + 1}/${MAX_RESUBMIT} (${waitSec}s)...`, 'warn')
                    await new Promise((r) => setTimeout(r, waitSec * 1000))
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
                        negativePrompt: negativePrompt.trim() || undefined,
                        orientation,
                        keepSound,
                        modelKey: currentModel.key,
                        autoTrim,
                        ratio: '9:16',
                        videoDuration: videoDurationSec,
                      })
                      taskId = retry.taskId
                      roomId = retry.roomId
                      nodeId = retry.nodeId
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
              return true
            } catch (err: any) {
              setCompressDialog(null)
              updateSlotStatus(slot.id, 'error', err.message)
              addLog(`#${slotNum} Error: ${err.message}`, 'error')
              removeActiveTask(taskId)
              return false
            }
          } else if (isMagnific && slot.image && slot.video) {
            try {
              let imageUrl = slot.imageUrl || ''
              if (!imageUrl) {
                updateSlotStatus(slot.id, 'uploading img...')
                addLog(`#${slotNum} Upload image...`)
                const normalizedImage = await normalizeImage(slot.image, (msg, pct) => {
                  setCompressDialog({ msg, pct })
                  updateSlotStatus(slot.id, 'uploading img...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                setCompressDialog(null)
                imageUrl = await uploadToCatbox(normalizedImage, 'image', (msg, pct) => {
                  updateSlotStatus(slot.id, 'uploading img...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                updateSlot(slot.id, { imageUrl })
                addLog(`#${slotNum} Image: ${imageUrl.slice(0, 60)}...`)
              } else {
                addLog(`#${slotNum} Using cached image URL`)
              }

              let videoUrl = slot.videoUrl || ''
              if (!videoUrl) {
                updateSlotStatus(slot.id, 'uploading vid...')
                addLog(`#${slotNum} Upload video...`)
                const videoFile = await compressVideo(slot.video, 4, (msg, pct) => {
                  setCompressDialog({ msg, pct })
                  updateSlotStatus(slot.id, 'uploading vid...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                setCompressDialog(null)
                videoUrl = await uploadToCatbox(videoFile, 'video', (msg, pct) => {
                  updateSlotStatus(slot.id, 'uploading vid...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                updateSlot(slot.id, { videoUrl })
                addLog(`#${slotNum} Video: ${videoUrl.slice(0, 60)}...`)
              } else {
                addLog(`#${slotNum} Using cached video URL`)
              }

              const magnificKey = getMagnificApiKey()
              if (!magnificKey) throw Error('Belum ada Magnific API key')

              const modelSlug = modelKey.replace('mag:', '') as MagnificMotionModel
              updateSlotStatus(slot.id, 'processing', 'submitting...')
              addLog(`#${slotNum} Submit ke Magnific (${modelSlug})...`)

              const taskId = await submitMagnificMotion({
                apiKey: magnificKey,
                model: modelSlug,
                imageUrl,
                videoUrl,
                prompt: prompt.trim() || undefined,
                orientation,
              })
              addLog(`#${slotNum} Task: ${taskId.slice(0, 20)}...`)

              updateSlotStatus(slot.id, 'processing', 'polling...')
              addLog(`#${slotNum} Polling for result...`)

              const resultUrl = await pollMagnificMotion(magnificKey, modelSlug, taskId, (msg, pct) => {
                updateSlotStatus(slot.id, 'processing', msg)
                addLog(`#${slotNum} ${msg}`)
                if (pct) setProgress(pct)
              })

              updateSlotStatus(slot.id, 'done')
              addLog(`#${slotNum} Done: ${resultUrl.slice(0, 60)}...`, 'success')

              addResult({
                id: taskId,
                url: resultUrl,
                prompt: prompt.trim() || '(no prompt)',
                date: new Date().toISOString(),
                page: 'motion',
              })
              setResults((prev) => [
                {
                  id: taskId,
                  url: resultUrl,
                  prompt: prompt.trim() || '(no prompt)',
                  date: new Date().toISOString(),
                },
                ...prev,
              ])
              return true
            } catch (err: any) {
              setCompressDialog(null)
              updateSlotStatus(slot.id, 'error', err.message)
              addLog(`#${slotNum} Error: ${err.message}`, 'error')
              return false
            }
          } else if (isFramia) {
            throw new Error('Provider aktif Framia. Gunakan Generate → Framia untuk menjalankan node/canvas Framia secara langsung.')
          } else if (provider === 'weavy' && slot.image && slot.video) {
            try {
              let imageUrl = slot.imageUrl || ''
              let videoUrl = slot.videoUrl || ''

              // Clear blob URLs - they can't be accessed by Weavy server
              if (imageUrl.startsWith('blob:')) {
                addLog(`#${slotNum} Clearing invalid blob URL for image, re-uploading...`, 'warn')
                imageUrl = ''
                updateSlot(slot.id, { imageUrl: null })
              }
              if (videoUrl.startsWith('blob:')) {
                addLog(`#${slotNum} Clearing invalid blob URL for video, re-uploading...`, 'warn')
                videoUrl = ''
                updateSlot(slot.id, { videoUrl: null })
              }

              if (!imageUrl || !videoUrl) {
                const tokenInfo = await getActiveWeavyAccessToken()
                if (!tokenInfo) throw Error('Tidak ada Weavy token aktif. Tambahkan token di Providers.')
                const weavyToken = tokenInfo.accessToken

                if (!imageUrl) {
                  let imageFile = slot.image
                  if (imageFile.size > 8 * 1024 * 1024) {
                    addLog(`#${slotNum} Compressing image...`)
                    updateSlotStatus(slot.id, 'uploading img...', 'Compressing...')
                    const compressed = await compressImageForWeavy(imageFile, 1280, 0.8)
                    imageFile = compressed
                  }
                  updateSlotStatus(slot.id, 'uploading img...')
                  addLog(`#${slotNum} Upload image to Weavy...`)
                  const imgAsset = await uploadWeavyAssetWithRetry(
                    imageFile,
                    `ref_img_${slotNum}_${Date.now()}.jpg`,
                    weavyToken
                  )
                  imageUrl = resolveWeavyAssetUrl(imgAsset, 'image')
                  updateSlot(slot.id, { imageUrl })
                  addLog(`#${slotNum} Image: ${imageUrl.slice(0, 60)}...`)
                } else {
                  addLog(`#${slotNum} Using cached image URL`)
                }

                if (!videoUrl) {
                  updateSlotStatus(slot.id, 'uploading vid...')
                  addLog(`#${slotNum} Upload video to Weavy...`)
                  const vidAsset = await uploadWeavyAssetWithRetry(
                    slot.video,
                    `ref_vid_${slotNum}_${Date.now()}.mp4`,
                    weavyToken
                  )
                  videoUrl = resolveWeavyAssetUrl(vidAsset, 'video')
                  updateSlot(slot.id, { videoUrl })
                  addLog(`#${slotNum} Video: ${videoUrl.slice(0, 60)}...`)
                } else {
                  addLog(`#${slotNum} Using cached video URL`)
                }
              } else {
                addLog(`#${slotNum} Using cached image & video URLs`)
              }

              updateSlotStatus(slot.id, 'processing', 'submitting...')
              addLog(`#${slotNum} Submit ke Weavy (${currentModel.label}) — recipe mode...`)

              const result = await submitWeavyMotionControl({
                modelKey,
                imageUrl,
                videoUrl,
                orientation,
                keepSound,
                prompt: prompt.trim() || undefined,
                onProgress: (status, pct) => {
                  updateSlotStatus(slot.id, 'processing', pct ? `${status} ${pct}%` : status)
                  addLog(`#${slotNum} ${status}`)
                },
              })
              if (!result.ok || !result.videoUrl) throw Error(result.error || 'Submit failed')
              const resultUrl = result.videoUrl

              updateSlotStatus(slot.id, 'done')
              addLog(`#${slotNum} Done: ${resultUrl.slice(0, 60)}...`, 'success')

              addResult({
                id: `weavy-${Date.now().toString(36)}`,
                url: resultUrl,
                prompt: prompt.trim() || '(no prompt)',
                date: new Date().toISOString(),
                page: 'motion',
              })
              setResults((prev) => [
                {
                  id: `weavy-${Date.now().toString(36)}`,
                  url: resultUrl,
                  prompt: prompt.trim() || '(no prompt)',
                  date: new Date().toISOString(),
                },
                ...prev,
              ])
              return true
            } catch (err: any) {
              setCompressDialog(null)
              updateSlotStatus(slot.id, 'error', err.message)
              addLog(`#${slotNum} Error: ${err.message}`, 'error')
              return false
            }
          } else if (provider === 'runninghub' && slot.image && slot.video) {
            try {
              const runninghubKey = getRunningHubApiKey()
              if (!runninghubKey) throw Error('Belum ada RunningHub API key. Silakan tambahkan di Settings.')

              let mode = 'pro'
              let modelVersion = '2.6'
              if (modelKey.startsWith('rh:')) {
                const parts = modelKey.split(':')
                if (parts.length >= 3) {
                  mode = parts[1] || 'pro'
                  modelVersion = parts[2] || '2.6'
                } else if (parts.length === 2) {
                  const modelPart = parts[1]
                  if (modelPart.includes('pro')) mode = 'pro'
                  else if (modelPart.includes('std')) mode = 'std'
                  if (modelPart.includes('3.0') || modelPart.includes('v3')) modelVersion = '3.0'
                  else if (modelPart.includes('2.1')) modelVersion = '2.1'
                  else modelVersion = '2.6'
                }
              }

              updateSlotStatus(slot.id, 'uploading img...')
              addLog(`#${slotNum} Compress image...`)
              const normalizedImage = await normalizeImage(slot.image, (msg, pct) => {
                setCompressDialog({ msg, pct })
                updateSlotStatus(slot.id, 'uploading img...', msg)
                addLog(`#${slotNum} ${msg}`)
              })
              setCompressDialog(null)
              addLog(`#${slotNum} Image: ${normalizedImage.name || 'ready'}`)

              updateSlotStatus(slot.id, 'uploading vid...')
              addLog(`#${slotNum} Compress video...`)
              const videoFile = await compressVideo(slot.video, 4, (msg, pct) => {
                setCompressDialog({ msg, pct })
                updateSlotStatus(slot.id, 'uploading vid...', msg)
                addLog(`#${slotNum} ${msg}`)
              })
              setCompressDialog(null)
              addLog(`#${slotNum} Video: ${videoFile.name || 'ready'}`)

              updateSlotStatus(slot.id, 'processing', 'submitting...')
              addLog(`#${slotNum} Upload & Submit ke RunningHub (${mode} ${modelVersion})...`)

              const result = await submitRunningHubMotionControl({
                imageFile: normalizedImage,
                videoFile,
                prompt: prompt.trim() || undefined,
                negativePrompt: negativePrompt.trim() || undefined,
                keepOriginalSound: keepSound,
              })
              const taskId = result.taskId
              addLog(`#${slotNum} Task: ${taskId.slice(0, 20)}...`)

              addActiveTask({
                id: taskId,
                taskId,
                roomId: '',
                nodeId: '',
                token: runninghubKey,
                model: currentModel.label,
                prompt: prompt.trim() || '(no prompt)',
                startedAt: Date.now(),
                page: 'motion',
              })

              updateSlotStatus(slot.id, 'processing', 'polling...')
              addLog(`#${slotNum} Polling for result...`)

              const resultUrl = await pollRunningHubTask(taskId, (status, pct) => {
                updateSlotStatus(slot.id, 'processing', `${status} ${pct}%`)
                addLog(`#${slotNum} ${status} ${pct}%`)
                setProgress(pct)
              })

              updateSlotStatus(slot.id, 'done')
              addLog(`#${slotNum} Done: ${resultUrl.slice(0, 60)}...`, 'success')

              removeActiveTask(taskId)
              addResult({
                id: taskId,
                url: resultUrl,
                prompt: prompt.trim() || '(no prompt)',
                date: new Date().toISOString(),
                page: 'motion',
              })
              setResults((prev) => [
                {
                  id: taskId,
                  url: resultUrl,
                  prompt: prompt.trim() || '(no prompt)',
                  date: new Date().toISOString(),
                },
                ...prev,
              ])
              return true
            } catch (err: any) {
              setCompressDialog(null)
              updateSlotStatus(slot.id, 'error', err.message)
              addLog(`#${slotNum} Error: ${err.message}`, 'error')
              return false
            }
          } else if (provider === 'galleri5' && slot.image && slot.video) {
            try {
              const authHeaders = await getGalleri5AuthHeaders()
              if (!authHeaders) throw Error('Belum ada auth headers. Buka Manage → Tokens → G5 AI Studio, tambahkan Firebase refresh token (AMf-...) lalu klik Cek Limit & Status.')

              const g5Model = GALLERI5_MOTION_MODELS.find((m) => m.key === modelKey) || GALLERI5_MOTION_MODELS[GALLERI5_MOTION_MODELS.length - 1]
              addLog(`#${slotNum} Model: ${g5Model.label} (±${g5Model.cr} cr)`)

              let imageUrl = slot.imageUrl || ''
              if (!imageUrl) {
                updateSlotStatus(slot.id, 'uploading img...')
                addLog(`#${slotNum} Upload image...`)
                const normalizedImage = await normalizeImage(slot.image, (msg, pct) => {
                  setCompressDialog({ msg, pct })
                  updateSlotStatus(slot.id, 'uploading img...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                setCompressDialog(null)
                imageUrl = await uploadToCatbox(normalizedImage, 'image', (msg, pct) => {
                  updateSlotStatus(slot.id, 'uploading img...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                updateSlot(slot.id, { imageUrl })
                addLog(`#${slotNum} Image: ${imageUrl.slice(0, 60)}...`)
              } else {
                addLog(`#${slotNum} Using cached image URL`)
              }

              let motionVideoUrl = slot.videoUrl || ''
              if (!motionVideoUrl) {
                updateSlotStatus(slot.id, 'uploading vid...')
                addLog(`#${slotNum} Upload video...`)
                const videoFile = await compressVideo(slot.video, 4, (msg, pct) => {
                  setCompressDialog({ msg, pct })
                  updateSlotStatus(slot.id, 'uploading vid...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                setCompressDialog(null)
                motionVideoUrl = await uploadToCatbox(videoFile, 'video', (msg, pct) => {
                  updateSlotStatus(slot.id, 'uploading vid...', msg)
                  addLog(`#${slotNum} ${msg}`)
                })
                updateSlot(slot.id, { videoUrl: motionVideoUrl })
                addLog(`#${slotNum} Video: ${motionVideoUrl.slice(0, 60)}...`)
              } else {
                addLog(`#${slotNum} Using cached video URL`)
              }

              updateSlotStatus(slot.id, 'processing', 'submitting...')
              addLog(`#${slotNum} Submit ke G5 AI Studio (${g5Model.modelPath})...`)

              const submitResult = await submitGalleri5MotionControl({
                authHeaders,
                modelKey,
                imageUrl,
                videoUrl: motionVideoUrl,
                keepOriginalSound: keepSound,
                orientation,
                prompt: prompt.trim() || undefined,
                onProgress: (msg, pct) => {
                  updateSlotStatus(slot.id, 'processing', pct ? `${msg} ${pct}%` : msg)
                  addLog(`#${slotNum} ${msg}`)
                },
              })
              const taskId = submitResult.taskId
              addLog(`#${slotNum} Task: ${taskId.slice(0, 60)}...`)

              addActiveTask({
                id: submitResult.sessionId,
                taskId: submitResult.sessionId,
                roomId: '',
                nodeId: '',
                token: JSON.stringify(authHeaders).slice(0, 50),
                model: currentModel.label,
                prompt: prompt.trim() || '(no prompt)',
                startedAt: Date.now(),
                page: 'motion',
              })

              let resultUrl = taskId
              // If taskId is a URL, submit already returned the result (from SSE stream)
              if (!/^https?:\/\//i.test(taskId)) {
                // taskId is a sessionId — need to poll
                updateSlotStatus(slot.id, 'processing', 'polling...')
                addLog(`#${slotNum} Polling for result...`)
                resultUrl = await pollGalleri5MotionControl(authHeaders, submitResult.sessionId, (msg, pct) => {
                  updateSlotStatus(slot.id, 'processing', `${msg} ${pct}%`)
                  addLog(`#${slotNum} ${msg} ${pct}%`)
                  setProgress(pct)
                }, submitResult.orgId)
              }

              updateSlotStatus(slot.id, 'done')
              addLog(`#${slotNum} Done: ${resultUrl.slice(0, 60)}...`, 'success')

              removeActiveTask(submitResult.sessionId)
              addResult({
                id: submitResult.sessionId,
                url: resultUrl,
                prompt: prompt.trim() || '(no prompt)',
                date: new Date().toISOString(),
                page: 'motion',
              })
              setResults((prev) => [
                {
                  id: submitResult.sessionId,
                  url: resultUrl,
                  prompt: prompt.trim() || '(no prompt)',
                  date: new Date().toISOString(),
                },
                ...prev,
              ])
              return true
            } catch (err: any) {
              setCompressDialog(null)
              updateSlotStatus(slot.id, 'error', err.message)
              addLog(`#${slotNum} Error: ${err.message}`, 'error')
              return false
            }
          } else {
            addLog(`#${slotNum} Skipping (no image/video)`, 'warn')
            return false
          }
          return false
        }

        addLog(`🚀 Running ${filledSlots.length} slot(s) in parallel...`)

        const slotResults = await Promise.allSettled(
          filledSlots.map((slot, i) => processSlot(slot, i + 1, token, i * 1500))
        )

        let successCount = 0
        let failCount = 0
        for (const r of slotResults) {
          if (r.status === 'fulfilled' && r.value) successCount++
          else failCount++
        }

        return { completedCount: successCount, failCount }
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
      const successCount = rotation.result?.completedCount ?? 0
      const failCount = rotation.result?.failCount ?? 0
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
      if (logId) logGenerationComplete(logId, { status: 'completed', duration_ms: Date.now() - startTime })
    } else {
      addLog(`Generation failed: ${rotation.error}`, 'error')
      if (logId) logGenerationFailed(logId, rotation.error || 'Unknown error', Date.now() - startTime)
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
      if (logId) logGenerationFailed(logId, genErr.message, Date.now() - startTime)
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
      let blob: Blob | null = null
      try {
        const res = await fetch(url, { mode: 'cors' })
        if (res.ok) blob = await res.blob()
      } catch {}
      if (!blob) {
        const res = await fetch(`/api/public/video-proxy?url=${encodeURIComponent(url)}`)
        if (res.ok) blob = await res.blob()
      }
      if (!blob) throw Error('Download gagal')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `motion-${id}.mp4`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    } catch {
      window.open(url, '_blank')
    }
  }, [])

  const filteredResults = results.filter(
    (r) => !searchQuery || r.prompt.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const [zipping, setZipping] = useState(false)

  const handleExportZip = useCallback(async () => {
    if (filteredResults.length === 0 || zipping) return
    setZipping(true)
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      let count = 0
      for (const result of filteredResults) {
        count++
        try {
          let blob: Blob | null = null
          try {
            const res = await fetch(result.url, { mode: 'cors' })
            if (res.ok) blob = await res.blob()
          } catch {}
          if (!blob) {
            const res = await fetch(`/api/public/proxy-image?url=${encodeURIComponent(result.url)}`)
            if (res.ok) blob = await res.blob()
          }
          if (blob) {
            const name = `motion-${String(count).padStart(2, '0')}-${result.id}.mp4`
            zip.file(name, blob)
          }
        } catch {}
      }
      if (Object.keys(zip.files).length === 0) {
        addToast('Gagal download video untuk ZIP', 'error')
        return
      }
      const content = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(content)
      a.download = `motion-gallery-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    } catch (err: any) {
      addToast(`ZIP error: ${err.message}`, 'error')
    } finally {
      setZipping(false)
    }
  }, [filteredResults, zipping, addToast])

  if (!currentModel) {
    return (
      <PageContent>
        <PageHeader
          eyebrow="Generate"
          title="Motion"
          highlight="Control"
          desc="Kling Motion Control — transfer gerakan karakter dari video / gambar referensi."
        />
        <EmptyState icon={<Video className="h-10 w-10" />} title="Pilih provider motion control" description="Tidak ada model yang tersedia untuk provider ini." />
      </PageContent>
    )
  }

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
          <div className={`relative grid gap-3 ${
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
            {compressDialog && (
              <div role="dialog" aria-modal="true" aria-live="polite" className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-background/70 backdrop-blur-sm">
                <div className="w-[min(360px,90%)] rounded-2xl border border-primary/40 bg-card/95 p-5 shadow-2xl shadow-primary/20">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                    <div className="font-display text-sm text-foreground">Mengompres file…</div>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground break-words">{compressDialog.msg}</div>
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full bg-primary transition-all ${typeof compressDialog.pct === 'number' ? '' : 'animate-pulse'}`}
                      style={{ width: typeof compressDialog.pct === 'number' ? `${Math.max(0, Math.min(100, compressDialog.pct))}%` : '100%' }}
                    />
                  </div>
                  <div className="mt-3 text-[10px] uppercase tracking-widest text-muted-foreground text-center">Mohon tunggu sampai proses selesai</div>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* Settings */}
        <div className="flex flex-col gap-5">
          <Section title="Pengaturan" sub={`Provider aktif: ${currentProvider.name}`}>
            <div className="flex flex-col gap-4">
              {/* Provider Info Panel (Markas Tools style) */}
              {provider === 'roboneo' && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground leading-relaxed">
                  <div className="font-semibold text-foreground mb-1">Provider RoboNeo (Meitu)</div>
                  Motion Control (berbasis Kling) — animasikan gambar karakter dengan gerakan dari video penggerak.
                  Pakai akun RoboNeo (access key dari roboneo.com → avatar → CLI Settings).
                  Sesi berlaku terbatas & perlu ditempel ulang. Biaya ~100 🥕/generate.
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <Label>Model AI</Label>
                  <button
                    onClick={() => setShowRoutingDialog(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/50 transition"
                    title="Ganti provider"
                  >
                    <Repeat className="h-3 w-3" />
                    {currentProvider.name}
                  </button>
                </div>
                <Select
                  value={modelKey}
                  onChange={(e) => setModelKey(e.target.value)}
                  options={currentProvider.models.map((m) => ({
                    value: m.key,
                    label: `${m.label} (${m.cr} cr)`,
                  }))}
                />
              </div>

              <MaintenanceBanner providerId={provider} />

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

              {/* Auto-trim to 9 seconds (Markas Tools style) */}
              {provider === 'roboneo' && (
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoTrim}
                    onChange={(e) => setAutoTrim(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="h-5 w-5 rounded-md border border-input bg-background grid place-items-center peer-checked:bg-primary peer-checked:border-primary transition">
                    <svg viewBox="0 0 24 24" className="h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <div className="flex flex-col">
                    <span className="text-sm text-foreground/90">Potong otomatis ke 9 detik (hemat — biaya tetap ±65 🥕)</span>
                    <span className="text-[11px] text-muted-foreground">Video referensi dipotong ke 9 detik pertama, jadi biayanya pasti.</span>
                  </div>
                </label>
              )}

              {/* TikTok Link Import (Markas Tools style) */}
              {provider === 'roboneo' && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tiktokUrl}
                    onChange={(e) => setTiktokUrl(e.target.value)}
                    placeholder="Paste link TikTok..."
                    className="flex-1 rounded-xl border border-border bg-card/50 px-3 py-2 text-sm outline-none focus:border-primary/50 transition"
                    onKeyDown={(e) => e.key === 'Enter' && handleTiktokImport()}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleTiktokImport}
                    disabled={!tiktokUrl.trim() || tiktokLoading}
                  >
                    {tiktokLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />}
                    Dari Link TikTok
                  </Button>
                </div>
              )}

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

              {(generating || statusSummary !== 'Idle') && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span className="truncate pr-2">{statusSummary}</span>
                    {generating && <span className="font-mono font-semibold text-foreground shrink-0">{slotProgress}% <span className="text-muted-foreground font-normal">· {elapsed}</span></span>}
                  </div>
                  {generating && (
                    <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                        style={{ width: `${slotProgress}%` }}
                      />
                    </div>
                  )}
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
              onClick={handleExportZip}
              disabled={results.length === 0 || zipping}
              className="text-xs"
            >
              {zipping ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
              {zipping ? 'Zipping…' : 'Export ZIP'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!window.confirm(`Hapus semua ${results.length} video dari gallery?`)) return
                setResults([]); clearResults(); setLogs([]); clearLogs()
              }}
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
                      src={result.url}
                      crossOrigin="anonymous"
                      className="w-full h-full object-contain"
                      controls
                      muted
                      playsInline
                      preload="metadata"
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

      {showRoutingDialog && (
        <QuickRoutingDialog
          cap="motion"
          providers={Object.entries(PROVIDERS).map(([key, val]) => ({
            id: key,
            name: val.name,
            models: val.models,
          }))}
          onClose={() => setShowRoutingDialog(false)}
          onSelect={(id) => {
            setProvider(id as ProviderId)
            const p = PROVIDERS[id as keyof typeof PROVIDERS]
            setModelKey(p.models[0].key)
          }}
        />
      )}

      {confirmDialog && (
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-background/80 backdrop-blur-sm p-4" onClick={() => setConfirmDialog(null)}>
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="font-display text-lg text-foreground mb-2">{confirmDialog.title}</div>
            <p className="text-sm text-muted-foreground mb-5">{confirmDialog.message}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDialog(null)} className="rounded-full px-4 py-1.5 text-xs font-semibold border border-border bg-card hover:bg-card/80 transition">
                Batal
              </button>
              <button onClick={confirmDialog.onConfirm} className="rounded-full px-4 py-1.5 text-xs font-semibold text-primary-foreground" style={{ background: 'var(--gradient-neon)' }}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
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
