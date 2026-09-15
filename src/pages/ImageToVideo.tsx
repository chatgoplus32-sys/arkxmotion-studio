import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Select, Label, Textarea, EmptyState, Badge, BalanceBadge } from '@/components/ui'
import { MaintenanceBanner } from '@/components/ui/MaintenanceBanner'
import { Image, Upload, Rocket, Loader2, Trash2, Key, ExternalLink, Download, X, Copy } from 'lucide-react'
import { Swipeable } from '@/components/Swipeable'
import { useProviderManager, PROVIDER_CONFIGS, ProviderId } from '@/stores/providerManager'
import { useToastStore } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import { uploadToCatbox, submitRoboneoI2V, pollRoboneoI2V, checkRoboneoBalance, uploadImageForRoboneo, isRoboneoFormatError } from '@/lib/roboneo'
import { generateWithFramia } from '@/lib/framia'
import { runLeonardoVideo } from '@/lib/leonardo'
import { leonardoVideoQualityOptions } from '@/lib/leonardo-video'
import { submitWeavyVideo, pollWeavyStatus, submitWeavySora, pollWeavySoraStatus, submitWeavyGrokVideo, pollWeavyGrokVideoStatus, submitWeavyOmni, pollWeavyOmniStatus, submitWeavySeedanceMini, pollWeavySeedanceMiniStatus, submitWeavyKlingTurbo, pollWeavyKlingTurboStatus, submitWeavyKlingVideo, pollWeavyKlingVideoStatus } from '@/lib/weavy'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import {
  getActiveTasks,
  addActiveTask,
  removeActiveTask,
  getLogs,
  getResults,
  addBgLog,
  addResult,
  updateResult,
  persistResultToR2,
  startBackgroundPolling,
  removeResult,
  clearLogs,
  clearResults,
} from '@/lib/backgroundTasks'
import type { CompletedResult } from '@/lib/backgroundTasks'
import { logGenerationStart, logGenerationComplete, logGenerationFailed } from '@/lib/generationLog'
import { isNotificationsEnabled, setNotificationsEnabled, requestNotificationPermission, notifyGenerationComplete } from '@/lib/notify'
import { uploadToCdn } from '@/lib/cdn'
import { precheckProviderBalance } from '@/lib/balancePrecheck'
import type { NexabotSessionInfo } from '@/lib/nexabot'

import { PROVIDER_MODELS, QUALITY_OPTIONS, getCreatepulseCost, RATIOS, MODEL_RATIO_RESTRICTIONS, TEMPLATES, CREATEPULSE_API } from './image-to-video/constants'

import VideoPlayer from './image-to-video/VideoPlayer'
import { nexabotPathPill } from './image-to-video/nexabotPathPill'
import { fetchNexabotWallet, chargeNexabotWallet, refundNexabotWallet, type NexabotWallet } from '@/lib/nexabotWallet'
import { formatRp } from '@/lib/payment'
import { runNexabotJobWithSessionFallback } from './image-to-video/nexabotSessionFallback'

// Voice default untuk mode Voice Over NexaBot — salah satu nama dari daftar
// voice resmi NexaBot (GET /api/v1/modes → voices).
const NEXABOT_DEFAULT_VOICE = 'Kore'

export default function ImageToVideoPage() {
  const { keys, routing, fetchMaintenance } = useProviderManager()

  // ── NexaBot: session (Unlimited) vs API key (pay-as-you-go) ──
  // Cookie bisa berubah kapan saja karena extension auto-sync, jadi status sesi
  // di-probe ulang tiap nilai cookie berubah.
  const nexabotCookies = keys.nexabot?.find((k) => !!k.cookies)?.cookies || ''
  const [nexabotSession, setNexabotSession] = useState<NexabotSessionInfo | null>(null)
  const [nexabotChecking, setNexabotChecking] = useState(false)

  useEffect(() => {
    if (!nexabotCookies) { setNexabotSession(null); setNexabotChecking(false); return }
    let cancelled = false
    setNexabotChecking(true)
    ;(async () => {
      try {
        const { checkNexabotSession } = await import('@/lib/nexabot')
        const info = await checkNexabotSession(nexabotCookies)
        if (!cancelled) setNexabotSession(info)
      } catch (e: any) {
        if (!cancelled) setNexabotSession({
          ok: false, active: false, unlimited: false, plan: null,
          until: null, untilMs: null, balance: null, telegramId: null, email: null,
          error: e?.message || 'Gagal cek sesi',
        })
      } finally {
        if (!cancelled) setNexabotChecking(false)
      }
    })()
    return () => { cancelled = true }
  }, [nexabotCookies])
  const addToast = useToastStore((s) => s.addToast)
  const { token: authToken, user } = useAuthStore()
  const [cpBalance, setCpBalance] = useState(0)
  // Wallet NexaBot user (harga/generate dari server) + status Paket Unlimited
  // (varian Mingguan/Bulanan/Tahunan — mana pun yang sedang aktif).
  const [nbWallet, setNbWallet] = useState<NexabotWallet | null>(null)
  // usage_id pemotongan yang masih bisa di-refund kalau generate gagal.
  const nbChargeRef = useRef<number | null>(null)

  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [imgFile, setImgFile] = useState<File | null>(null)
  const [startFrameFile, setStartFrameFile] = useState<File | null>(null)
  const [endFrameFile, setEndFrameFile] = useState<File | null>(null)
  const [refFiles, setRefFiles] = useState<File[]>([])
  const [startFrameUrl, setStartFrameUrl] = useState<string | null>(null)
  const [endFrameUrl, setEndFrameUrl] = useState<string | null>(null)
  const [refUrls, setRefUrls] = useState<string[]>([])
  const [provider, setProvider] = useState<ProviderId>(routing['image-to-video'] || 'weavy')
  const [model, setModel] = useState('')
  const [ratio, setRatio] = useState('9:16')
  const [quality, setQuality] = useState('std')
  const [tplIdx, setTplIdx] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [results, setResults] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('createpulse.results')
      if (saved) {
        const parsed: string[] = JSON.parse(saved)
        return parsed.map((url) =>
          url.startsWith('http') ? url : `https://createpulse.online${url}`
        )
      }
      return []
    } catch {
      return []
    }
  })
  const [galleryItems, setGalleryItems] = useState<CompletedResult[]>(() => {
    try {
      return getResults().filter((r) => r.page === 'image-to-video')
    } catch {
      return []
    }
  })
  const [galleryFilter, setGalleryFilter] = useState<string>('all')
  const [gallerySearch, setGallerySearch] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [status, setStatus] = useState({ show: false, text: '', pct: 0, time: '' })
  const [compressDialog, setCompressDialog] = useState<{ msg: string; pct?: number } | null>(null)
  const [generating, setGenerating] = useState(() => getActiveTasks().filter((t) => t.page === 'image-to-video').length > 0)
  const [logs, setLogs] = useState<Array<{ time: string; msg: string; level: string }>>(() => getLogs())
  const generatingRef = useRef(false)
  const successRef = useRef(false)

  const addLog = (msg: string, level: 'debug' | 'info' | 'warn' | 'error' | 'success' = 'info', provider?: string) => {
    addBgLog(msg, level, provider)
    setLogs(getLogs())
  }

  const inputRef = useRef<HTMLInputElement>(null)
  const startFrameRef = useRef<HTMLInputElement>(null)
  const endFrameRef = useRef<HTMLInputElement>(null)
  const refInputRef = useRef<HTMLInputElement>(null)
  const videoRefInputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const [notifEnabled, setNotifEnabled] = useState(() => isNotificationsEnabled())

  const toggleNotifications = async () => {
    if (!notifEnabled) {
      const granted = await requestNotificationPermission()
      if (granted) {
        setNotificationsEnabled(true)
        setNotifEnabled(true)
        addToast('Notifikasi diaktifkan', 'success')
      } else {
        addToast('Izin notifikasi ditolak', 'error')
      }
    } else {
      setNotificationsEnabled(false)
      setNotifEnabled(false)
      addToast('Notifikasi dimatikan', 'info')
    }
  }

  const [cdnUploading, setCdnUploading] = useState<Record<string, boolean>>({})
  const [cdnUrls, setCdnUrls] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('arkxmotion_cdn_urls') || '{}')
    } catch { return {} }
  })

  const handleCdnUpload = async (itemId: string, videoUrl: string) => {
    setCdnUploading((prev) => ({ ...prev, [itemId]: true }))
    const result = await uploadToCdn(videoUrl)
    setCdnUploading((prev) => ({ ...prev, [itemId]: false }))

    if (result.ok && result.url) {
      setCdnUrls((prev) => {
        const next = { ...prev, [itemId]: result.url! }
        localStorage.setItem('arkxmotion_cdn_urls', JSON.stringify(next))
        return next
      })
      addToast('Video di-upload ke CDN ✓', 'success')
    } else {
      addToast(`Gagal upload ke CDN: ${result.error}`, 'error')
    }
  }

  const handleCopyCdnUrl = (url: string) => {
    navigator.clipboard.writeText(url)
    addToast('Link CDN disalin!', 'success')
  }

  useEffect(() => {
    fetchMaintenance()
  }, [fetchMaintenance])

  useEffect(() => {
    localStorage.setItem('createpulse.results', JSON.stringify(results))
  }, [results])

  useEffect(() => {
    startBackgroundPolling()

    const sync = () => {
      setLogs(getLogs())
      const bgResults = getResults()
      if (bgResults.length > 0) {
        setResults((prev) => {
          const existing = new Set(prev)
          const newUrls = bgResults.map((r) => r.url).filter((u) => !existing.has(u))
          return newUrls.length > 0 ? [...newUrls, ...prev] : prev
        })
      }
    }

    window.addEventListener('arkxmotion-tasks-changed', sync)
    return () => window.removeEventListener('arkxmotion-tasks-changed', sync)
  }, [])

  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const handleDownload = useCallback(async (url: string, index: number, itemId?: string) => {
    if (itemId) setDownloadingId(itemId)
    try {
      // Detect extension from URL
      let ext = 'mp4'
      if (url.includes('.webm')) ext = 'webm'
      else if (url.includes('.mov')) ext = 'mov'
      else if (url.includes('.png')) ext = 'png'
      else if (url.includes('.jpg') || url.includes('.jpeg')) ext = 'jpg'
      const filename = `video-${Date.now()}-${index}.${ext}`

      // Blob URL: download directly (no proxy needed)
      if (url.startsWith('blob:')) {
        console.log('[download] blob URL detected, downloading directly')
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        return
      }

      // Try direct download first (no proxy = no binary corruption)
      const isExternal = /^https?:\/\//i.test(url) && !url.includes(window.location.origin)
      if (isExternal) {
        // Use proxy to avoid CORS, but verify content is actual video
        const proxyUrl = `/api/public/video-proxy?url=${encodeURIComponent(url)}`
        const res = await fetch(proxyUrl)
        const contentType = res.headers.get('content-type') || ''
        console.log('[download] proxy content-type:', contentType, 'status:', res.status)

        // If proxy returned non-video (error JSON, HTML, etc.), fall back to direct
        if (!res.ok || (!contentType.includes('video') && !contentType.includes('octet-stream'))) {
          console.log('[download] proxy returned non-video, falling back to direct')
          const a = document.createElement('a')
          a.href = url
          a.download = filename
          a.target = '_blank'
          a.rel = 'noopener'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          return
        }

        const blob = await res.blob()
        console.log('[download] blob size:', blob.size, 'type:', blob.type)

        // Sanity check: video files should be > 1KB
        if (blob.size < 1024) {
          console.log('[download] blob too small, falling back to direct')
          window.open(url, '_blank')
          return
        }

        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = filename
        document.body.appendChild(a)
        a.click()
        // Delay revoke to ensure download starts
        setTimeout(() => {
          document.body.removeChild(a)
          URL.revokeObjectURL(blobUrl)
        }, 1000)
      } else {
        // Same-origin: download directly
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
    } catch (err) {
      console.error('[download] error:', err)
      window.open(url, '_blank')
    } finally {
      setDownloadingId(null)
    }
  }, [])

  const models = useMemo(() => PROVIDER_MODELS[provider] || [], [provider])
  const currentModel = models.find((m) => m.value === model) || models[0]
  const isNbOmniFlash = provider === 'nexabot' && model === 'nb:omni-flash-1.1'
  const nbVideoIdx = refFiles.findIndex((f) => f.type.startsWith('video/'))
  const nbVideoUrl = nbVideoIdx >= 0 ? refUrls[nbVideoIdx] ?? null : null

  const hasImgFile = !!imgFile
  const qualityOptions = useMemo(() => {
    const providerQualities = QUALITY_OPTIONS[provider] || QUALITY_OPTIONS.weavy
    const leonardoDynamicOptions = provider === 'leonardo' && model ? leonardoVideoQualityOptions(model, ratio) : []
    let opts = provider === 'leonardo'
      ? leonardoDynamicOptions.map((opt) => ({
          value: opt.value,
          label: opt.label,
          mult: 1,
          duration: opt.seconds,
          cr: opt.cr,
          sizeTier: opt.tierId as string,
          resolution: undefined as string | undefined,
          sound: opt.audio ? 'on' : undefined,
        }))
      : (providerQualities[model] || providerQualities.default || [])
    // Veo I2V only supports 8 seconds
    if (provider === 'firefly' && model.includes('veo') && hasImgFile) {
      opts = opts.filter((q) => q.duration === 8)
    }
    return opts
  }, [provider, model, ratio, hasImgFile])
  const currentQuality = qualityOptions.find((q) => q.value === quality) || qualityOptions[0]

  const totalCredits = currentModel ? (currentQuality?.cr ?? Math.round(currentModel.cr * (currentQuality?.mult || 1))) : 0

  const providerKeyCount = keys[provider]?.length || 0
  const hasActiveKey = keys[provider]?.some((k) => k.status !== 'invalid' && k.status !== 'expired') || false

  const isVeoI2V = provider === 'firefly' && model.includes('veo') && !!imgFile

  useEffect(() => {
    if (models.length > 0 && !models.find((m) => m.value === model)) {
      setModel(models[0].value)
    }
  }, [provider, models, model])

  const modelRestrictions = MODEL_RATIO_RESTRICTIONS[currentModel?.apiModel || '']
  const availableRatios = modelRestrictions || RATIOS

  useEffect(() => {
    if (isVeoI2V && ratio !== '16:9') setRatio('16:9')
  }, [isVeoI2V, ratio])

  useEffect(() => {
    if (modelRestrictions && !modelRestrictions.includes(ratio)) {
      setRatio(modelRestrictions[0])
    }
  }, [modelRestrictions, ratio])

  useEffect(() => {
    if (qualityOptions.length > 0 && !qualityOptions.find((q) => q.value === quality)) {
      setQuality(qualityOptions[0].value)
    }
  }, [model, qualityOptions, quality])

  useEffect(() => {
    if (provider === 'createpulse' && authToken) {
      fetch('/api/createpulse/balance', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
        .then((r) => r.json())
        .then((d) => setCpBalance(d.balance || 0))
        .catch(() => {})
    }
  }, [provider, authToken])

  useEffect(() => {
    if (provider !== 'nexabot' || !authToken) return
    fetchNexabotWallet(authToken).then((w) => { if (w) setNbWallet(w) }).catch(() => {})
  }, [provider, authToken])

  const handleFileChange = (files: FileList | null) => {
    const file = files?.[0]
    if (file) {
      setImgUrl(URL.createObjectURL(file))
      setImgFile(file)
    }
  }

  const handleStartFrameChange = (files: FileList | null) => {
    const file = files?.[0]
    if (file) {
      setStartFrameFile(file)
      setStartFrameUrl(URL.createObjectURL(file))
    }
  }

  const handleEndFrameChange = (files: FileList | null) => {
    const file = files?.[0]
    if (file) {
      setEndFrameFile(file)
      setEndFrameUrl(URL.createObjectURL(file))
    }
  }

  const handleRefChange = (files: FileList | null) => {
    if (!files) return
    const newFiles = Array.from(files).slice(0, 4 - refFiles.length)
    if (newFiles.length > 0) {
      setRefFiles((prev) => [...prev, ...newFiles].slice(0, 4))
      setRefUrls((prev) => [...prev, ...newFiles.map((f) => URL.createObjectURL(f))].slice(0, 4))
    }
  }

  const removeRef = (index: number) => {
    setRefFiles((prev) => prev.filter((_, i) => i !== index))
    setRefUrls((prev) => prev.filter((_, i) => i !== index))
  }

  const handleVideoRefChange = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const idx = refFiles.findIndex((f) => f.type.startsWith('video/'))
    if (idx >= 0) {
      setRefFiles((prev) => prev.map((f, i) => (i === idx ? file : f)))
      setRefUrls((prev) => prev.map((u, i) => (i === idx ? url : u)))
    } else {
      setRefFiles((prev) => [...prev, file].slice(0, 4))
      setRefUrls((prev) => [...prev, url].slice(0, 4))
    }
  }

  const refreshGallery = () => {
    setGalleryItems(getResults().filter((r) => r.page === 'image-to-video'))
  }

  const removeGalleryItem = (id: string) => {
    removeResult(id)
    refreshGallery()
  }

  const saveGalleryItem = (url: string) => {
    const item: CompletedResult = {
      id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      url,
      prompt: prompt.trim() || '(no prompt)',
      date: new Date().toISOString(),
      page: 'image-to-video',
      provider,
      model: currentModel?.label || model,
      ratio,
      duration: currentQuality?.duration,
      credits: totalCredits,
      inputImageUrl: imgUrl || undefined,
    }
    addResult(item)
    refreshGallery()
    persistResultToR2(item.id, url)
  }

  const filteredGallery = galleryItems.filter((item) => {
    if (galleryFilter !== 'all' && item.provider !== galleryFilter) return false
    if (gallerySearch && !item.prompt.toLowerCase().includes(gallerySearch.toLowerCase()) && !(item.model || '').toLowerCase().includes(gallerySearch.toLowerCase())) return false
    return true
  })

  const galleryProviders = Array.from(new Set(galleryItems.map((i) => i.provider).filter(Boolean)))

  const generateWithCreatePulse = async (apiKey: string) => {
    const duration = currentQuality?.duration || 10
    const cost = getCreatepulseCost(currentModel?.apiModel)
    const isAdmin = user?.role === 'admin'

    if (!isAdmin) {
      if (cpBalance < cost) {
        throw new Error(`Saldo tidak cukup (Rp ${cpBalance.toLocaleString('id-ID')}). Top up minimal Rp 10.000`)
      }

      addLog(`[1/4] 💰 Deducting saldo Rp ${cost.toLocaleString('id-ID')}...`, 'info', 'createpulse')
      setStatus((s) => ({ ...s, text: 'Deducting saldo...', pct: 5 }))

      const deductRes = await fetch('/api/createpulse/deduct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ model: currentModel?.apiModel || 'dreamina-seedance-2.0' }),
      })
      if (!deductRes.ok) {
        const d = await deductRes.json().catch(() => ({}))
        throw new Error(d.error || 'Gagal deduct saldo')
      }
      const deductData = await deductRes.json()
      setCpBalance(deductData.balance)
      addLog(`[1/4] ✅ Saldo terpotong ✓ sisa Rp ${deductData.balance.toLocaleString('id-ID')}`, 'success', 'createpulse')
    } else {
      addLog(`[1/4] ⚡ Admin mode — skip saldo`, 'info', 'createpulse')
    }

    let batchId = ''
    try {
      addLog(`[2/4] 📤 Preparing images...`, 'info', 'createpulse')
      setStatus((s) => ({ ...s, text: 'Uploading images...', pct: 10 }))

      let initImageUrl = startFrameFile ? await uploadToCatbox(startFrameFile) : undefined
      let finalEndFrameUrl = endFrameFile ? await uploadToCatbox(endFrameFile) : undefined
      let imageReferenceUrls: string[] = []
      for (const f of refFiles) {
        const url = await uploadToCatbox(f)
        imageReferenceUrls.push(url)
      }

      if (initImageUrl) addLog(`[2/4] ✅ Start frame uploaded`, 'success', 'createpulse')
      if (finalEndFrameUrl) addLog(`[2/4] ✅ End frame uploaded`, 'success', 'createpulse')
      if (imageReferenceUrls.length) addLog(`[2/4] ✅ References: ${imageReferenceUrls.length} image(s)`, 'success', 'createpulse')
      if (!initImageUrl && !finalEndFrameUrl && imageReferenceUrls.length === 0) {
        addLog(`[2/4] ℹ️ No images (text-to-video mode)`, 'info', 'createpulse')
      }

      const body: any = {
        kind: 'video',
        model: currentModel?.apiModel || 'dreamina-seedance-2.0',
        prompt,
        aspect: ratio,
        duration,
      }

      if (initImageUrl) body.init_image_url = initImageUrl
      if (finalEndFrameUrl) body.end_frame_url = finalEndFrameUrl
      if (imageReferenceUrls.length > 0) body.image_reference_urls = imageReferenceUrls

      addLog(`[3/4] 🚀 Submitting to CreatePulse...`, 'info', 'createpulse')
      addLog(`   → model: ${body.model}`, 'debug', 'createpulse')
      addLog(`   → ratio: ${ratio} | duration: ${duration}s`, 'debug', 'createpulse')
      setStatus((s) => ({ ...s, text: 'Submitting to CreatePulse...', pct: 20 }))

      const submitRes = await fetch(`${CREATEPULSE_API}?action=generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify(body),
      })

      if (!submitRes.ok) {
        const err = await submitRes.json().catch(() => ({}))
        addLog(`[3/4] ❌ Submit failed: HTTP ${submitRes.status} — ${err.error || 'unknown'}`, 'error', 'createpulse')
        throw new Error(err.error || `HTTP ${submitRes.status}`)
      }

      const submitData = await submitRes.json()
      if (!submitData.ok) {
        addLog(`[3/4] ❌ Submit failed: ${submitData.error || 'unknown'}`, 'error', 'createpulse')
        throw new Error(submitData.error || 'Submit failed')
      }

      batchId = submitData.batchId
      addLog(`[3/4] ✅ Task created ✓ batchId=${batchId}`, 'success', 'createpulse')
      setStatus((s) => ({ ...s, text: `Processing... (batch: ${batchId.slice(0, 8)}...)`, pct: 40 }))

      addLog(`[4/4] ⏳ Polling for result...`, 'info', 'createpulse')
      const maxPolls = 300
      for (let i = 0; i < maxPolls; i++) {
        await new Promise((r) => setTimeout(r, 4000))

        const pollRes = await fetch(`${CREATEPULSE_API}?action=status&batchId=${batchId}`, {
          headers: { 'X-API-Key': apiKey },
        })

        if (!pollRes.ok) {
          addLog(`[4/4] ⚠️ Poll #${i + 1}: HTTP ${pollRes.status} (retrying...)`, 'warn', 'createpulse')
          continue
        }

        const pollData = await pollRes.json()
        const pct = Math.min(90, 40 + (i / maxPolls) * 50)
        addLog(`[4/4] Poll #${i + 1}: status=${pollData.status || 'unknown'}`, 'debug', 'createpulse')
        setStatus((s) => ({ ...s, text: `Status: ${pollData.status}...`, pct }))

        if (pollData.status === 'done' && pollData.url) {
          let videoUrl = pollData.url.startsWith('http')
            ? pollData.url
            : `https://createpulse.online${pollData.url}`
          if (/^https?:\/\/localhost:\d+/i.test(videoUrl)) {
            videoUrl = videoUrl.replace(/^https?:\/\/localhost:\d+/i, 'https://createpulse.online')
          }
          addLog(`[4/4] ✅ Done ✓ ${videoUrl.slice(0, 60)}...`, 'success', 'createpulse')
          return videoUrl
        }

        if (pollData.status === 'failed') {
          addLog(`[4/4] ❌ Failed: ${pollData.error || 'unknown'}`, 'error', 'createpulse')
          throw new Error(pollData.error || 'Generation failed')
        }
      }

      addLog(`[4/4] ❌ Timeout after ${maxPolls} polls`, 'error', 'createpulse')
      throw new Error('Timeout: generation took too long')
    } catch (err: any) {
      if (!isAdmin) {
        if (batchId) {
          addLog(`💸 Refunding Rp ${cost.toLocaleString('id-ID')}...`, 'warn', 'createpulse')
          try {
            const refundRes = await fetch('/api/createpulse/refund', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
              body: JSON.stringify({ batch_id: batchId }),
            })
            if (refundRes.ok) {
              const rd = await refundRes.json()
              setCpBalance(rd.balance)
              addLog(`✅ Refund berhasil ✓ saldo Rp ${rd.balance.toLocaleString('id-ID')}`, 'success', 'createpulse')
            }
          } catch (e) { console.warn('[ImageToVideo] Refund by ID failed:', e) }
        } else {
          addLog(`💸 Refunding Rp ${cost.toLocaleString('id-ID')} (by model)...`, 'warn', 'createpulse')
          try {
            const refundRes = await fetch('/api/createpulse/refund', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
              body: JSON.stringify({ model: currentModel?.apiModel || 'dreamina-seedance-2.0' }),
            })
            if (refundRes.ok) {
              const rd = await refundRes.json()
              setCpBalance(rd.balance)
              addLog(`✅ Refund berhasil ✓ saldo Rp ${rd.balance.toLocaleString('id-ID')}`, 'success', 'createpulse')
            }
          } catch (e) { console.warn('[ImageToVideo] Refund by model failed:', e) }
        }
      }
      throw err
    }
  }

  const validateGenerate = (): string | null => {
    if (!prompt.trim()) return 'Prompt harus diisi'
    if (!hasActiveKey && provider !== 'roboneo' && provider !== 'createpulse') return `Tidak ada API key aktif untuk ${PROVIDER_CONFIGS[provider].name}`
    if (provider === 'createpulse' && user?.role !== 'admin' && cpBalance < getCreatepulseCost(currentModel?.apiModel)) return 'Saldo CreatePulse tidak cukup. Top up minimal Rp 10.000'
    // NexaBot: paket Unlimited = gratis, jadi cek saldo hanya saat paket tidak aktif.
    if (provider === 'nexabot' && user?.role !== 'admin' && !nbWallet?.unlimited.active && (nbWallet?.balance ?? 0) < (nbWallet?.price ?? 250))
      return `Saldo NexaBot tidak cukup (${formatRp(nbWallet?.balance ?? 0)}). Top up atau ambil Paket Unlimited ${nbWallet?.package.days ?? 7} hari di halaman Top Up NexaBot.`
    if (provider === 'roboneo' && !imgFile) return 'Roboneo membutuhkan gambar input'
    if (provider === 'nexabot') {
      const nbMode = currentModel?.apiModel
      const nbImages = [imgFile, startFrameFile, ...refFiles].filter((f): f is File => !!f && f.type.startsWith('image/'))
      const nbVideo = refFiles.find((f) => f.type.startsWith('video/'))
      if (nbMode === 'sfv' && nbImages.length === 0) return 'Start Frame to Video butuh 1 gambar input'
      if (nbMode === 'i2v' && nbImages.length === 0) return 'Ingredient Img to Video butuh 1-3 gambar input'
      if (nbMode === 'r2v' && !nbVideo) return 'Video Reference to Video butuh 1 video referensi'
    }
    return null
  }

  const handleGenerate = async () => {
    const validationError = validateGenerate()
    if (validationError) {
      addToast(validationError, 'error')
      return
    }

    // Pre-check saldo vs estimasi biaya sebelum upload dimulai
    if (provider !== 'createpulse') {
      const pre = await precheckProviderBalance(provider, totalCredits)
      if (!pre.ok) {
        addLog(`❌ ${pre.error}`, 'error', provider)
        addToast(pre.error || 'Saldo tidak cukup', 'error')
        return
      }
    }

    setGenerating(true)
    successRef.current = false
    generatingRef.current = true
    clearLogs()
    setLogs([])
    setStatus({ show: true, text: 'Validasi...', pct: 2, time: '' })

    addLog(`🚀 Mulai generate video`, 'info', provider)
    addLog(`   Provider: ${PROVIDER_CONFIGS[provider].name}`, 'debug', provider)
    addLog(`   Model: ${currentModel?.label || model}`, 'debug', provider)
    addLog(`   Rasio: ${ratio} | Durasi: ${currentQuality?.duration || 5}s`, 'debug', provider)
    addLog(`   Prompt: "${prompt.trim().slice(0, 80)}${prompt.trim().length > 80 ? '...' : ''}"`, 'debug', provider)

    const currentUser = useAuthStore.getState().user
    const logId = currentUser ? await logGenerationStart({
      page: 'image-to-video',
      provider,
      model: currentModel?.label || model,
      prompt: prompt.slice(0, 500),
      credits: currentModel?.cr || 0,
      slot_count: 1,
    }) : null

    let activeTaskId: string | null = null

    const startTime = Date.now()
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      setStatus((s) => ({
        ...s,
        time: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`,
      }))
    }, 1000)

    try {
      if (provider === 'createpulse') {
        const rotation = await withTokenRotation<string>(
          'createpulse',
          async (apiKey, keyInfo) => {
            addLog(`Trying key: ${keyInfo.name || keyInfo.id}`)
            return await generateWithCreatePulse(apiKey)
          },
          {
            onKeySwitch: (from, to, attempt) => {
              addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn')
            },
            onError: (err, key) => {
              if (detectTokenError('createpulse', err)) {
                addLog(`Key "${key.name}" is invalid: ${err.message}`, 'warn')
              }
            },
          }
        )
        if (rotation.ok && rotation.result) {
          setResults((prev) => [rotation.result!, ...prev])
          saveGalleryItem(rotation.result!)
          successRef.current = true
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
          notifyGenerationComplete(currentModel?.label || model, PROVIDER_CONFIGS[provider].name)
          if (rotation.triedKeys > 1) {
            addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success')
          }
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
       } else if (provider === 'roboneo') {
         if (!imgFile) {
           addLog('❌ Roboneo membutuhkan gambar input', 'error', 'roboneo')
           throw new Error('No image provided')
         }

         const uploadWithRetry = async (retryCount = 0): Promise<string> => {
           addLog(`[1/3] 🖼️ Normalizing & uploading image...${retryCount > 0 ? ` (retry ${retryCount})` : ''}`, 'info', 'roboneo')
           setStatus((s) => ({ ...s, text: `Normalize & upload image${retryCount > 0 ? ` (retry ${retryCount})` : ''}...`, pct: 10 }))
           setCompressDialog({ msg: 'Normalisasi gambar...', pct: 0 })
           try {
             const url = await uploadImageForRoboneo(imgFile, (msg, pct) => {
               if (pct !== undefined) setCompressDialog({ msg, pct })
             })
             setCompressDialog(null)
             addLog(`[1/3] ✅ Image uploaded ✓`, 'success', 'roboneo')
             return url
           } catch (e: any) {
             setCompressDialog(null)
             addLog(`[1/3] ❌ Upload gagal: ${e.message}`, 'error', 'roboneo')
             throw e
           }
         }

         let imageUrl = await uploadWithRetry(0)

         const MAX_FORMAT_RETRIES = 2
         let formatRetries = 0

         const submitAndPoll = async (currentImageUrl: string, apiKey: string, keyInfo: any) => {
              const tokenIdx = keys.roboneo?.findIndex(k => k.key === apiKey) ?? 0
              const totalTokens = keys.roboneo?.length || 0
              addLog(`🔑 Trying key: ${keyInfo.name || keyInfo.id} (${tokenIdx + 1}/${totalTokens})`, 'info', 'roboneo')
              setStatus((s) => ({ ...s, text: `Submit Roboneo ${model} (token ${tokenIdx + 1}/${totalTokens})...`, pct: 15 }))

              const balanceResult = await checkRoboneoBalance(apiKey)
              if (!balanceResult.ok) {
                addLog(`Balance check: ${balanceResult.error}`, 'warn', 'roboneo')
                throw new Error(`Token Roboneo tidak valid: ${balanceResult.error}`)
              }
              if (balanceResult.isValidUser === false) {
                throw new Error('Token Roboneo tidak valid (is_valid_user=false). Silakan update token.')
              }
              if (balanceResult.balance !== null && balanceResult.balance <= 0) {
                throw new Error('Balance kosong! Tidak ada credit untuk generate.')
              }
              if (balanceResult.balance !== null && balanceResult.balance < totalCredits) {
                throw new Error(`Balance tidak cukup! Butuh ${totalCredits} credit, hanya ada ${balanceResult.balance}.`)
              }
              addLog(`💰 Balance: ${balanceResult.balance ?? 'unknown'} credits`, 'info', 'roboneo')

              const resolution = currentQuality?.resolution || quality?.match(/(\d+p)/)?.[1]
              const soundEnabled = currentQuality?.sound || (quality?.includes('on') || quality?.includes('audio') ? 'on' : 'off')
              const videoDuration = currentQuality?.duration || 10

               addLog(`[2/3] 🚀 Submitting to Roboneo ${model}...`, 'info', 'roboneo')
               addLog(`   → resolution: ${resolution || 'default'}`, 'debug', 'roboneo')
               addLog(`   → sound: ${soundEnabled} | duration: ${videoDuration}s`, 'debug', 'roboneo')
               const modelParts = model.split(':')
               const modelVersion = modelParts[1]?.includes('v21') ? 'v21' : 'v26'
               const { taskId, roomId, nodeId } = await submitRoboneoI2V({
                 accessToken: apiKey,
                 imageUrl: currentImageUrl,
                 prompt: prompt.trim() || undefined,
                 modelKey: model,
                 modelVersion,
                 ratio,
                 duration: videoDuration,
                 resolution,
                 sound: soundEnabled,
                 quality,
               })
              addLog(`[2/3] ✅ Task created ✓ id=${taskId.slice(0, 20)}...`, 'success', 'roboneo')

             addActiveTask({
               id: taskId,
               taskId,
               roomId,
               nodeId,
               token: apiKey,
               model: currentModel?.label || model,
               prompt: prompt.trim() || '(no prompt)',
               startedAt: Date.now(),
               page: 'image-to-video',
             })
             activeTaskId = taskId

             addLog(`[3/3] ⏳ Polling for result...`, 'info', 'roboneo')
             setStatus((s) => ({ ...s, text: 'Processing...', pct: 25 }))
             const videoUrl = await pollRoboneoI2V(
               apiKey, taskId, roomId,
               (status, pct) => {
                 addLog(`⏳ Roboneo ${status} (${pct}%)`, 'debug', 'roboneo')
                 setStatus((s) => ({ ...s, pct, text: `Roboneo ${status} (${pct}%)` }))
               },
               3600000,
               undefined,
               nodeId
             )
             setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
             addLog(`✅ Video selesai ✓`, 'success', 'roboneo')

             removeActiveTask(taskId)
             activeTaskId = null
             return { videoUrl, taskId, roomId }
         }

         const rotation = await withTokenRotation<{ videoUrl: string; taskId: string; roomId: string }>(
           'roboneo',
           async (apiKey, keyInfo) => {
             try {
               return await submitAndPoll(imageUrl, apiKey, keyInfo)
             } catch (err: any) {                if (isRoboneoFormatError(err.message) && formatRetries < MAX_FORMAT_RETRIES) {
                  formatRetries++

                 addLog(`⚠️ Format error detected (retry ${formatRetries}/${MAX_FORMAT_RETRIES}): re-uploading image...`, 'warn', 'roboneo')
                 setStatus((s) => ({ ...s, text: `Re-uploading image (retry ${formatRetries})...`, pct: 10 }))
                 imageUrl = await uploadWithRetry(formatRetries)
                 addLog(`✅ Re-uploaded ✓ new URL: ${imageUrl.slice(0, 80)}...`, 'success', 'roboneo')
                 return await submitAndPoll(imageUrl, apiKey, keyInfo)
               }
               throw err
             }
           },
           {
             requiredCredits: totalCredits,
             onKeySwitch: (from, to, attempt) => {
               addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn', 'roboneo')
               if (activeTaskId) removeActiveTask(activeTaskId)
               activeTaskId = null
             },
             onError: (err, key) => {
               if (detectTokenError('roboneo', err)) {
                 addLog(`⚠️ Key "${key.name}" is invalid: ${err.message}`, 'warn', 'roboneo')
               }
             },
           }
         )
        if (rotation.ok && rotation.result) {
          setResults((prev) => [rotation.result!.videoUrl, ...prev])
          addResult({
            id: `roboneo-${Date.now()}`,
            url: rotation.result!.videoUrl,
            prompt: prompt.trim() || '(no prompt)',
            date: new Date().toISOString(),
            page: 'image-to-video',
            provider,
            model: currentModel?.label || model,
            ratio,
            duration: currentQuality?.duration,
            credits: totalCredits,
            inputImageUrl: imgUrl || undefined,
            taskUrl: rotation.result!.roomId ? `https://www.roboneo.com/team_studio?room_id=${rotation.result!.roomId}` : undefined,
          })
          persistResultToR2(`roboneo-${Date.now()}`, rotation.result!.videoUrl)
          refreshGallery()
          window.dispatchEvent(new Event('arkxmotion-tasks-changed'))
          successRef.current = true
          notifyGenerationComplete(currentModel?.label || model, 'Roboneo')
          if (rotation.triedKeys > 1) {
            addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success', 'roboneo')
          }
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      } else if (provider === 'framia') {
        addLog(`[1/2] 🖼️ Preparing image...`, 'info', 'framia')
        let imageUrl: string | undefined
        if (imgFile) {
          imageUrl = await uploadToCatbox(imgFile)
          addLog(`[1/2] ✅ Image uploaded ✓`, 'success', 'framia')
        } else {
          addLog(`[1/2] ℹ️ No image provided (text-to-video mode)`, 'info', 'framia')
        }

        const rotation = await withTokenRotation<string>(
          'framia',
          async (apiKey, keyInfo) => {
            addLog(`🔑 Trying key: ${keyInfo.name || keyInfo.id}`, 'info', 'framia')
            return await generateWithFramia({
              apiKey,
              imageUrl,
              prompt: prompt.trim(),
              skillId: model,
              onLog: (msg, level) => addLog(msg, level as any, 'framia'),
              onStatus: (text, pct) => setStatus((s) => ({ ...s, pct, text: `[Framia] ${text}` })),
            })
          },
          {
            onKeySwitch: (from, to, attempt) => {
              addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn', 'framia')
            },
            onError: (err, key) => {
              if (detectTokenError('framia', err)) {
                addLog(`⚠️ Key "${key.name}" is invalid: ${err.message}`, 'warn', 'framia')
              }
            },
          }
        )
        if (rotation.ok && rotation.result) {
          setResults((prev) => [rotation.result!, ...prev])
          successRef.current = true
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
          notifyGenerationComplete(currentModel?.label || model, 'Framia')
          if (rotation.triedKeys > 1) {
            addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success', 'framia')
          }
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      } else if (provider === 'firefly') {
        addLog(`[1/2] 🔥 Preparing image for Firefly...`, 'info', 'firefly')
        setStatus((s) => ({ ...s, text: 'Preparing...', pct: 5 }))

        const rotation = await withTokenRotation<string>(
          'firefly',
          async (apiKey, keyInfo) => {
            addLog(`🔑 Trying key: ${keyInfo.name || keyInfo.id}`, 'info', 'firefly')
            setStatus((s) => ({ ...s, text: `Submit Firefly ${model}...`, pct: 15 }))

            addLog(`[2/2] 🚀 Submitting to Firefly...`, 'info', 'firefly')
            addLog(`   → ratio: ${ratio} | duration: ${currentQuality?.duration || 5}s`, 'debug', 'firefly')

            const seedVal = Math.floor(Date.now() % 999999)
            const nonce = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
            const arpSessionId = btoa(JSON.stringify({ sid: crypto.randomUUID(), ftr: `${Date.now()}_dUAL43-mnts-ants-d4_31ck__tt` }))

            // Upload image to Firefly storage if we have one
            let fireflyImageId = ''
            if (imgFile) {
              addLog(`[1/2] 📤 Uploading image to Firefly storage...`, 'info', 'firefly')
              try {
                const rawType = imgFile.type || 'image/png'
                const isJpeg = rawType.includes('jpeg') || rawType.includes('jpg')
                const contentType = isJpeg ? 'image/jpeg' : 'image/png'

                // Convert to PNG if not JPEG (Firefly only accepts image/png or image/jpeg)
                let uploadFile = imgFile
                if (!isJpeg && rawType !== 'image/png') {
                  addLog(`[1/2] 🔄 Converting ${rawType} → PNG...`, 'info', 'firefly')
                  const canvas = document.createElement('canvas')
                  const bmp = await createImageBitmap(imgFile)
                  canvas.width = bmp.width
                  canvas.height = bmp.height
                  canvas.getContext('2d')!.drawImage(bmp, 0, 0)
                  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
                  uploadFile = new File([blob], 'image.png', { type: 'image/png' })
                }

                const imgBuffer = await uploadFile.arrayBuffer()
                addLog(`[1/2] 📦 Image: ${contentType} (${Math.round(imgBuffer.byteLength / 1024)}KB)`, 'debug', 'firefly')

                // Upload directly to Firefly storage (bypass proxy for correct content-type)
                const uploadRes = await fetch('https://firefly-3p.ff.adobe.io/v2/storage/image', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'x-api-key': 'clio-playground-web',
                    'x-nonce': nonce,
                    'x-arp-session-id': arpSessionId,
                    'content-type': contentType,
                    'accept': '*/*',
                    'origin': 'https://firefly.adobe.com',
                    'referer': 'https://firefly.adobe.com/',
                  },
                  body: imgBuffer,
                })
                const uploadData = await uploadRes.json().catch(() => ({}))
                addLog(`[1/2] 🔍 Upload response: status=${uploadRes.status} ${JSON.stringify(uploadData).slice(0, 300)}`, 'debug', 'firefly')
                if (uploadRes.ok && uploadData) {
                  fireflyImageId = uploadData.id || uploadData.storageId || uploadData.images?.[0]?.id || ''
                  addLog(`[1/2] ✅ Image uploaded to Firefly ✓ (id: ${fireflyImageId.slice(0, 30)}...)`, 'success', 'firefly')
                } else {
                  addLog(`[1/2] ⚠️ Firefly upload failed: status=${uploadRes.status} ${JSON.stringify(uploadData).slice(0, 200)}`, 'warn', 'firefly')
                }
              } catch (e: any) {
                addLog(`[1/2] ⚠️ Firefly upload error: ${e.message}`, 'warn', 'firefly')
              }
            } else {
              addLog(`[1/2] ℹ️ No image (text-to-video mode)`, 'info', 'firefly')
            }

            const isVeo = model.includes('veo')
            const isKling = model.includes('kling')
            const isRunway = model.includes('runway')
            const isLuma = model.includes('ray3')
            const isGemini = model.includes('gemini')
            addLog(`   → model: ${model}${isGemini ? ' (gemini-omni:omni-flash)' : ''}`, 'debug', 'firefly')
            // Veo I2V only supports 16:9
            const effectiveRatio = (isVeo && fireflyImageId) ? '16:9' : ratio
            const vidSize = effectiveRatio === '9:16' ? { width: 720, height: 1280 } : effectiveRatio === '1:1' ? { width: 1080, height: 1080 } : { width: 1280, height: 720 }
            // Veo I2V requires exactly 8 seconds
            const durationSec = (isVeo && fireflyImageId) ? 8 : (currentQuality?.duration || 5)

            let generateBody: Record<string, unknown> = {}
            const refBlobs = fireflyImageId
              ? [{ id: fireflyImageId, usage: 'general', order: 1 }]
              : []
            const imgModule = fireflyImageId ? 'image2video' : 'text2video'
            if (isVeo) {
              const isVeoRef = model.includes('ref')
              const veoVersion = model.includes('3.1-fast') ? '3.1-fast-generate' : isVeoRef ? '3.1-generate' : '3.1-generate'
              generateBody = {
                n: 1, seeds: [seedVal],
                modelId: 'veo',
                modelVersion: veoVersion,
                output: { storeInputs: true },
                prompt: prompt.trim(),
                size: vidSize,
                generateAudio: true,
                referenceBlobs: isVeoRef && fireflyImageId
                  ? [{ id: fireflyImageId, usage: 'asset' }]
                  : fireflyImageId ? refBlobs : [],
                generationMetadata: { module: isVeoRef && fireflyImageId ? 'image2video' : imgModule },
                modelSpecificPayload: {
                  parameters: { durationSeconds: durationSec, aspectRatio: effectiveRatio, addWaterMark: false },
                },
              }
            } else if (isKling) {
              const klingVersion = model.includes('pro') ? 'kling_v3_pro_i2v' : 'kling_v3_standard_i2v'
              generateBody = {
                n: 1, seeds: [seedVal],
                modelId: 'kling',
                modelVersion: klingVersion,
                output: { storeInputs: true },
                prompt: prompt.trim(),
                size: vidSize,
                duration: durationSec,
                generationMetadata: { module: imgModule },
                generationSettings: { aspectRatio: effectiveRatio },
                referenceBlobs: refBlobs.map(b => ({ ...b, usage: 'frame' })),
              }
            } else if (isRunway) {
              generateBody = {
                n: 1, seeds: [seedVal],
                modelId: 'runway-gen4-turbo',
                output: { storeInputs: true },
                prompt: prompt.trim(),
                size: vidSize,
                duration: durationSec,
                generateAudio: true,
                referenceBlobs: refBlobs,
                generationMetadata: { module: imgModule },
                modelSpecificPayload: {
                  parameters: { durationSeconds: durationSec, aspectRatio: effectiveRatio },
                },
              }
            } else if (isLuma) {
              generateBody = {
                n: 1, seeds: [seedVal],
                modelId: 'luma-ray3',
                output: { storeInputs: true },
                prompt: prompt.trim(),
                size: vidSize,
                duration: durationSec,
                generateAudio: true,
                referenceBlobs: refBlobs,
                generationMetadata: { module: imgModule },
                modelSpecificPayload: {
                  parameters: { durationSeconds: durationSec, aspectRatio: effectiveRatio },
                },
              }
            } else if (isGemini) {
              generateBody = {
                n: 1, seeds: [seedVal],
                modelId: 'gemini-omni',
                modelVersion: 'omni-flash',
                output: { storeInputs: true },
                prompt: prompt.trim(),
                size: vidSize,
                duration: durationSec,
                generateAudio: true,
                referenceBlobs: refBlobs.map(b => ({ ...b, usage: 'frame' })),
                generationMetadata: { module: imgModule },
                modelSpecificPayload: {
                  parameters: { durationSeconds: durationSec, aspectRatio: effectiveRatio },
                },
              }
            } else {
              // Default: firefly-video (Adobe Firefly native model)
              generateBody = {
                n: 1, seeds: [seedVal],
                modelId: 'firefly-video',
                output: { storeInputs: true },
                prompt: prompt.trim(),
                size: vidSize,
                generateAudio: true,
                referenceBlobs: refBlobs,
                generationMetadata: { module: imgModule },
                modelSpecificPayload: {
                  parameters: { durationSeconds: durationSec, aspectRatio: effectiveRatio, addWaterMark: false },
                },
              }
            }

            addLog(`   → referenceBlobs: ${JSON.stringify((generateBody.referenceBlobs as any[])?.map((b: any) => ({ id: b.id?.slice(0, 20) + '...', usage: b.usage })))}`, 'debug', 'firefly')
            addLog(`   → module: ${(generateBody.generationMetadata as Record<string, unknown>)?.module}`, 'debug', 'firefly')

            let submitRes: Response | null = null
            let submitData: any = null
            const maxRetries = 5
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              submitRes = await fetch('/api/public/firefly', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Firefly-Token': apiKey,
                  'X-Firefly-Api-Key': 'clio-playground-web',
                  'X-Firefly-Nonce': nonce,
                  'X-Firefly-Arp': arpSessionId,
                },
                body: JSON.stringify({
                  url: 'https://firefly-3p.ff.adobe.io/v2/3p-videos/generate-async',
                  method: 'POST',
                  body: generateBody,
                }),
              })

              if (submitRes.ok) {
                submitData = await submitRes.json()
                break
              }

              const errBody = await submitRes.json().catch(() => ({}))
              const errMsg = errBody.error || errBody.message || `HTTP ${submitRes.status}`
              const isRetryable = [408, 500, 502, 503, 504].includes(submitRes.status) || String(errMsg).includes('timeout') || String(errMsg).includes('under load') || String(errMsg).includes('busy')

              if (isRetryable && attempt < maxRetries) {
                const waitSec = Math.min(10 * Math.pow(2, attempt - 1), 120)
                addLog(`[2/2] ⚠️ Firefly busy (${errMsg}), retry #${attempt + 1}/${maxRetries} dalam ${waitSec}s...`, 'warn', 'firefly')
                setStatus((s) => ({ ...s, text: `Firefly busy, retry ${attempt + 1}/${maxRetries}...`, pct: 15 }))
                await new Promise((r) => setTimeout(r, waitSec * 1000))
                continue
              }

              addLog(`[2/2] ❌ Submit failed: HTTP ${submitRes.status} — ${errMsg}`, 'error', 'firefly')
              throw new Error(errMsg)
            }

            if (!submitData) throw new Error('Firefly: no response')

            addLog(`[2/2] 🔍 Response keys: ${JSON.stringify(Object.keys(submitData))}`, 'debug', 'firefly')
            if (submitData.data) addLog(`[2/2] 🔍 data keys: ${JSON.stringify(Object.keys(submitData.data))}`, 'debug', 'firefly')
            addLog(`[2/2] 🔍 Full response: ${JSON.stringify(submitData).slice(0, 800)}`, 'debug', 'firefly')

            let statusUrl = submitData.data?.links?.result?.href || submitData.data?.links?.result || submitData.data?.statusUrl || submitData.data?._links?.self?.href || submitData.statusUrl || submitData._links?.self?.href
            if (!statusUrl) throw new Error(`Firefly: statusUrl not found. Response: ${JSON.stringify(submitData).slice(0, 500)}`)

            // Rewrite EPO URL → BKS URL (OmniRoute pattern)
            try {
              const parsedUrl = new URL(statusUrl)
              if (parsedUrl.hostname.startsWith('firefly-epo')) {
                const epoId = parsedUrl.hostname.slice('firefly-epo'.length).split('.')[0] || ''
                const bksId = epoId.length > 4 ? epoId.slice(0, 4) : epoId
                const pathParts = parsedUrl.pathname.split('/').filter(Boolean)
                const jobId = pathParts[pathParts.length - 1] || ''
                if (jobId) {
                  statusUrl = `https://bks-epo${bksId}.adobe.io/v2/jobs/result/${jobId}?host=${parsedUrl.hostname}`
                  addLog(`   → Rewritten poll URL: ${statusUrl}`, 'debug', 'firefly')
                }
              }
            } catch { /* keep original */ }

            addLog(`[2/2] ✅ Job submitted ✓`, 'success', 'firefly')
            setStatus((s) => ({ ...s, text: 'Processing...', pct: 40 }))

            addLog(`⏳ Polling for result...`, 'info', 'firefly')
            const maxPolls = 300
            for (let i = 0; i < maxPolls; i++) {
              await new Promise((r) => setTimeout(r, 3000))
              const pollRes = await fetch('/api/public/firefly', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Firefly-Token': apiKey,
                },
                body: JSON.stringify({ url: statusUrl, method: 'GET', pollMode: true }),
              })
              if (!pollRes.ok) continue
              const pollData = await pollRes.json()
              if (i < 3 || i % 50 === 0) addLog(`🔍 Poll #${i + 1} raw: ${JSON.stringify(pollData).slice(0, 600)}`, 'debug', 'firefly')

              // BKS response: status/outputs at top level OR wrapped in data
              const pollPayload = pollData.data || pollData
              const status = (pollPayload.status || '').toUpperCase()

              // Check for presigned media URL (OmniRoute pattern)
              const outputs = pollPayload.outputs || pollPayload.result?.outputs || []
              const firstOutput = Array.isArray(outputs) ? outputs[0] : outputs
              const videoUrl = firstOutput?.video?.presignedUrl || firstOutput?.video?.url || firstOutput?.presignedUrl || firstOutput?.url

              if (videoUrl && videoUrl.startsWith('http')) {
                addLog(`✅ Done ✓ → ${videoUrl.slice(0, 80)}...`, 'success', 'firefly')
                return videoUrl
              }

              const pct = Math.min(95, 40 + (i / maxPolls) * 55)
              addLog(`Poll #${i + 1}: ${status || 'processing'}`, 'debug', 'firefly')
              setStatus((s) => ({ ...s, text: `Firefly ${status || 'processing'}...`, pct }))

              if (['FAILED', 'CANCELLED', 'CANCELED', 'ERROR'].includes(status)) {
                throw new Error(pollPayload.error?.message || pollPayload.errorMessage || 'Firefly: job failed')
              }
            }
            throw new Error('Firefly: timeout')
          },
          {
            onKeySwitch: (from, to, attempt) => {
              addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn', 'firefly')
            },
            onError: (err, key) => {
              if (detectTokenError('firefly', err)) {
                addLog(`⚠️ Key "${key.name}" is invalid: ${err.message}`, 'warn', 'firefly')
              }
            },
          }
        )
        if (rotation.ok && rotation.result) {
          setResults((prev) => [rotation.result!, ...prev])
          saveGalleryItem(rotation.result!)
          successRef.current = true
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
          notifyGenerationComplete(currentModel?.label || model, 'Firefly')
          if (rotation.triedKeys > 1) {
            addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success', 'firefly')
          }
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
       } else if (provider === 'leonardo') {
         if (!imgFile) {
           addLog('❌ Leonardo membutuhkan gambar input', 'error', 'leonardo')
           throw new Error('No image provided')
         }
         addLog(`[1/1] 🎨 Submitting to Leonardo...`, 'info', 'leonardo')
         setStatus((s) => ({ ...s, text: 'Submitting...', pct: 5 }))

        const rotation = await withTokenRotation<string>(
          'leonardo',
          async (apiKey, keyInfo) => {
            addLog(`🔑 Key: ${keyInfo.name || keyInfo.id}`, 'info', 'leonardo')

            const videoUrl = await runLeonardoVideo({
             token: apiKey,
             modelKey: model,
             prompt: prompt.trim(),
             aspectRatio: ratio,
             sizeTier: currentQuality?.sizeTier,
             duration: currentQuality?.duration || 5,
             imageFile: imgFile || undefined,
             onProgress: (text, pct) => {
               addLog(text, 'info', 'leonardo')
               if (pct !== undefined) setStatus((s) => ({ ...s, text, pct }))
             },
             onRotate: (idx, total, reason) => {
               addLog(`🔄 Token #${idx}/${total} — ${reason}`, 'warn', 'leonardo')
             },
           })
           return videoUrl
         },
         {
           requiredCredits: totalCredits,
           onKeySwitch: (from, to, attempt) => {
             addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn', 'leonardo')
           },
           onError: (err, key) => {
             if (detectTokenError('leonardo', err)) {
               addLog(`⚠️ Key "${key.name}" is invalid: ${err.message}`, 'warn', 'leonardo')
             }
           },
         }
        )
        if (rotation.ok && rotation.result) {
          setResults((prev) => [rotation.result!, ...prev])
          addResult({
            id: `leonardo-${Date.now()}`,
            url: rotation.result!,
            prompt: prompt.trim() || '(no prompt)',
            date: new Date().toISOString(),
            page: 'image-to-video',
            provider,
            model: currentModel?.label || model,
            ratio,
            duration: currentQuality?.duration,
            credits: totalCredits,
            inputImageUrl: imgUrl || undefined,
          })
          persistResultToR2(`leonardo-${Date.now()}`, rotation.result!)
          refreshGallery()
          window.dispatchEvent(new Event('arkxmotion-tasks-changed'))
          successRef.current = true
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
          notifyGenerationComplete(currentModel?.label || model, 'Leonardo')
          if (rotation.triedKeys > 1) {
            addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success', 'leonardo')
          }
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      } else if (provider === 'weavy') {
        const isSora = model === 'sora-2'
        const isGrokVideo = model === 'grok-video'
        const isOmni = model === 'gemini-omni'
        const isSeedanceMini = model === 'seedance-mini'
        const isKlingTurbo = model === 'kling-3-turbo'
        const isKlingVideo = model === 'kling-video'
        addLog(`[1/3] 🖼️ Preparing image...`, 'info', 'weavy')
        let imageUrl: string | undefined
        // For Seedance Mini/Kling, image is in startFrameFile (Frames & References UI)
        const effectiveImgFile = (isSeedanceMini || isKlingTurbo || isKlingVideo) ? (startFrameFile || imgFile) : imgFile
        if (effectiveImgFile) {
          if (isSora || isGrokVideo || isOmni || isSeedanceMini || isKlingTurbo || isKlingVideo) {
            // Sora/Grok/Omni/Kling: upload to Catbox (fallback if direct Weavy upload fails)
            addLog(`[1/3] 🖼️ Uploading image to Catbox...`, 'info', 'weavy')
            imageUrl = await uploadToCatbox(effectiveImgFile)
            addLog(`[1/3] ✅ Image uploaded to Catbox ✓`, 'success', 'weavy')
          } else {
            imageUrl = await uploadToCatbox(effectiveImgFile)
            addLog(`[1/3] ✅ Image uploaded ✓`, 'success', 'weavy')
          }
        } else if (isSora) {
          throw new Error('Sora 2 Pro membutuhkan gambar input')
        } else {
          addLog(`[1/3] ℹ️ No image (text-to-video mode)`, 'info', 'weavy')
        }

        const rotation = await withTokenRotation<string>(
          'weavy',
          async (apiKey, keyInfo) => {
            addLog(`🔑 Trying key: ${keyInfo.name || keyInfo.id}`, 'info', 'weavy')
            setStatus((s) => ({ ...s, text: `Submit Weavy ${model}...`, pct: 15 }))

            if (isSora) {
              // Sora 2 Pro: recipe-based workflow
              addLog(`[2/3] 🚀 Submitting Sora 2 Pro (recipe workflow)...`, 'info', 'weavy')
              addLog(`   → duration: ${currentQuality?.duration || 16}s | resolution: ${currentQuality?.resolution || '720p'}`, 'debug', 'weavy')
              addLog(`   → ratio: ${ratio}`, 'debug', 'weavy')

              const submitResult = await submitWeavySora({
                token: apiKey,
                imageUrl: imageUrl!,
                imageFile: imgFile || undefined,
                prompt: prompt.trim() || undefined,
                duration: currentQuality?.duration || 16,
                resolution: currentQuality?.resolution || '720p',
                aspectRatio: ratio,
              })

              if (!submitResult.ok) {
                addLog(`[2/3] ❌ Submit failed: ${submitResult.error}`, 'error', 'weavy')
                throw new Error(submitResult.error || 'Submit failed')
              }

              const taskId = `${submitResult.recipeId}:${submitResult.batchId}`
              addLog(`[2/3] ✅ Task created ✓ recipe=${submitResult.recipeId?.slice(0, 15)}...`, 'success', 'weavy')

              addActiveTask({
                id: taskId,
                taskId,
                roomId: '',
                token: apiKey,
                model: 'Sora 2 Pro',
                prompt: prompt.trim() || '(no prompt)',
                startedAt: Date.now(),
                page: 'image-to-video',
              })
              activeTaskId = taskId

              addLog(`[3/3] ⏳ Polling for result...`, 'info', 'weavy')
              setStatus((s) => ({ ...s, text: 'Processing...', pct: 25 }))
              const videoUrl = await pollWeavySoraStatus(
                apiKey,
                submitResult.recipeId!,
                submitResult.batchId!,
                (status, pct) => {
                  addLog(`⏳ Sora ${status} (${pct}%)`, 'debug', 'weavy')
                  setStatus((s) => ({ ...s, pct, text: `Sora ${status} (${pct}%)` }))
                },
                3600000,
                imageUrl,
              )
              setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
              addLog(`✅ Video selesai ✓`, 'success', 'weavy')

              removeActiveTask(taskId)
              activeTaskId = null
              return videoUrl
            } else if (isGrokVideo) {
              // Grok Imagine Video v1.5: recipe-based workflow
              addLog(`[2/3] 🚀 Submitting Grok Imagine Video v1.5 (recipe workflow)...`, 'info', 'weavy')
              addLog(`   → duration: ${currentQuality?.duration || 10}s | resolution: ${currentQuality?.resolution || '720p'}`, 'debug', 'weavy')
              addLog(`   → ratio: ${ratio}`, 'debug', 'weavy')

              const submitResult = await submitWeavyGrokVideo({
                token: apiKey,
                imageUrl: imageUrl!,
                imageFile: imgFile || undefined,
                prompt: prompt.trim() || undefined,
                duration: currentQuality?.duration || 10,
                resolution: currentQuality?.resolution || '720p',
                aspectRatio: ratio,
              })

              if (!submitResult.ok) {
                addLog(`[2/3] ❌ Submit failed: ${submitResult.error}`, 'error', 'weavy')
                throw new Error(submitResult.error || 'Submit failed')
              }

              const taskId = `${submitResult.recipeId}:${submitResult.batchId}`
              addLog(`[2/3] ✅ Task created ✓ recipe=${submitResult.recipeId?.slice(0, 15)}...`, 'success', 'weavy')

              addActiveTask({
                id: taskId,
                taskId,
                roomId: '',
                token: apiKey,
                model: 'Grok Imagine Video v1.5',
                prompt: prompt.trim() || '(no prompt)',
                startedAt: Date.now(),
                page: 'image-to-video',
              })
              activeTaskId = taskId

              addLog(`[3/3] ⏳ Polling for result...`, 'info', 'weavy')
              setStatus((s) => ({ ...s, text: 'Processing...', pct: 25 }))
              const videoUrl = await pollWeavyGrokVideoStatus(
                apiKey,
                submitResult.recipeId!,
                submitResult.batchId!,
                (status, pct) => {
                  addLog(`⏳ GrokVideo ${status} (${pct}%)`, 'debug', 'weavy')
                  setStatus((s) => ({ ...s, pct, text: `GrokVideo ${status} (${pct}%)` }))
                },
                3600000,
                imageUrl,
              )
              setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
              addLog(`✅ Video selesai ✓`, 'success', 'weavy')

              removeActiveTask(taskId)
              activeTaskId = null
              return videoUrl
            } else if (isOmni) {
              // Gemini Omni Flash: recipe-based workflow with prompt node
              addLog(`[2/3] 🚀 Submitting Gemini Omni Flash (recipe workflow)...`, 'info', 'weavy')
              addLog(`   → duration: ${currentQuality?.duration || 8}s`, 'debug', 'weavy')
              addLog(`   → ratio: ${ratio}`, 'debug', 'weavy')

              const submitResult = await submitWeavyOmni({
                token: apiKey,
                imageUrl: imageUrl || undefined,
                imageFile: imgFile || undefined,
                prompt: prompt.trim(),
                duration: currentQuality?.duration || 8,
                aspectRatio: ratio,
              })

              if (!submitResult.ok) {
                addLog(`[2/3] ❌ Submit failed: ${submitResult.error}`, 'error', 'weavy')
                throw new Error(submitResult.error || 'Submit failed')
              }

              const taskId = `${submitResult.recipeId}:${submitResult.batchId}`
              addLog(`[2/3] ✅ Task created ✓ recipe=${submitResult.recipeId?.slice(0, 15)}...`, 'success', 'weavy')

              addActiveTask({
                id: taskId,
                taskId,
                roomId: '',
                token: apiKey,
                model: 'Gemini Omni Flash',
                prompt: prompt.trim() || '(no prompt)',
                startedAt: Date.now(),
                page: 'image-to-video',
              })
              activeTaskId = taskId

              addLog(`[3/3] ⏳ Polling for result...`, 'info', 'weavy')
              setStatus((s) => ({ ...s, text: 'Processing...', pct: 25 }))
              const videoUrl = await pollWeavyOmniStatus(
                apiKey,
                submitResult.recipeId!,
                submitResult.batchId!,
                (status, pct) => {
                  addLog(`⏳ Omni ${status} (${pct}%)`, 'debug', 'weavy')
                  setStatus((s) => ({ ...s, pct, text: `Omni ${status} (${pct}%)` }))
                },
                3600000,
                imageUrl,
              )
              setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
              addLog(`✅ Video selesai ✓`, 'success', 'weavy')

              removeActiveTask(taskId)
              activeTaskId = null
              return videoUrl
            } else if (isSeedanceMini) {
              // Seedance 2.0 Mini: recipe-based workflow with prompt + start/end image nodes
              addLog(`[2/3] 🚀 Submitting Seedance 2.0 Mini (recipe workflow)...`, 'info', 'weavy')
              addLog(`   → duration: ${currentQuality?.duration || 10}s | resolution: ${currentQuality?.resolution || '720p'}`, 'debug', 'weavy')
              addLog(`   → ratio: ${ratio}`, 'debug', 'weavy')

              const submitResult = await submitWeavySeedanceMini({
                token: apiKey,
                imageUrl: imageUrl || undefined,
                imageFile: startFrameFile || imgFile || undefined,
                endImageUrl: endFrameUrl || undefined,
                endImageFile: endFrameFile || undefined,
                refImageUrls: refFiles.length > 0 ? await Promise.all(refFiles.map(async f => await uploadToCatbox(f))) : undefined,
                prompt: prompt.trim(),
                duration: currentQuality?.duration || 10,
                resolution: currentQuality?.resolution || '720p',
                aspectRatio: ratio,
                generateAudio: true,
              })

              if (!submitResult.ok) {
                addLog(`[2/3] ❌ Submit failed: ${submitResult.error}`, 'error', 'weavy')
                throw new Error(submitResult.error || 'Submit failed')
              }

              const taskId = `${submitResult.recipeId}:${submitResult.batchId}`
              addLog(`[2/3] ✅ Task created ✓ recipe=${submitResult.recipeId?.slice(0, 15)}...`, 'success', 'weavy')

              addActiveTask({
                id: taskId,
                taskId,
                roomId: '',
                token: apiKey,
                model: 'Seedance 2.0 Mini',
                prompt: prompt.trim() || '(no prompt)',
                startedAt: Date.now(),
                page: 'image-to-video',
              })
              activeTaskId = taskId

              addLog(`[3/3] ⏳ Polling for result...`, 'info', 'weavy')
              setStatus((s) => ({ ...s, text: 'Processing...', pct: 25 }))
              const videoUrl = await pollWeavySeedanceMiniStatus(
                apiKey,
                submitResult.recipeId!,
                submitResult.batchId!,
                (status, pct) => {
                  addLog(`⏳ Seedance ${status} (${pct}%)`, 'debug', 'weavy')
                  setStatus((s) => ({ ...s, pct, text: `Seedance ${status} (${pct}%)` }))
                },
                3600000,
                imageUrl,
              )
              setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
              addLog(`✅ Video selesai ✓`, 'success', 'weavy')

              removeActiveTask(taskId)
              activeTaskId = null
              return videoUrl
            } else if (isKlingTurbo) {
              // Kling 3.0 Turbo: recipe-based workflow with prompt + image nodes
              addLog(`[2/3] 🚀 Submitting Kling 3.0 Turbo (recipe workflow)...`, 'info', 'weavy')
              addLog(`   → duration: ${currentQuality?.duration || 15}s`, 'debug', 'weavy')
              addLog(`   → ratio: ${ratio}`, 'debug', 'weavy')

              const submitResult = await submitWeavyKlingTurbo({
                token: apiKey,
                imageUrl: imageUrl || undefined,
                imageFile: startFrameFile || imgFile || undefined,
                prompt: prompt.trim(),
                duration: currentQuality?.duration || 15,
                aspectRatio: ratio,
              })

              if (!submitResult.ok) {
                addLog(`[2/3] ❌ Submit failed: ${submitResult.error}`, 'error', 'weavy')
                throw new Error(submitResult.error || 'Submit failed')
              }

              const taskId = `${submitResult.recipeId}:${submitResult.batchId}`
              addLog(`[2/3] ✅ Task created ✓ recipe=${submitResult.recipeId?.slice(0, 15)}...`, 'success', 'weavy')

              addActiveTask({
                id: taskId,
                taskId,
                roomId: '',
                token: apiKey,
                model: 'Kling 3.0 Turbo',
                prompt: prompt.trim() || '(no prompt)',
                startedAt: Date.now(),
                page: 'image-to-video',
              })
              activeTaskId = taskId

              addLog(`[3/3] ⏳ Polling for result...`, 'info', 'weavy')
              setStatus((s) => ({ ...s, text: 'Processing...', pct: 25 }))
              const videoUrl = await pollWeavyKlingTurboStatus(
                apiKey,
                submitResult.recipeId!,
                submitResult.batchId!,
                (status, pct) => {
                  addLog(`⏳ Kling Turbo ${status} (${pct}%)`, 'debug', 'weavy')
                  setStatus((s) => ({ ...s, pct, text: `Kling Turbo ${status} (${pct}%)` }))
                },
                3600000,
                imageUrl,
              )
              setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
              addLog(`✅ Video selesai ✓`, 'success', 'weavy')

              removeActiveTask(taskId)
              activeTaskId = null
              return videoUrl
            } else if (isKlingVideo) {
              // Kling Video 2.1 Pro: recipe-based workflow with prompt + image nodes
              addLog(`[2/3] 🚀 Submitting Kling Video 2.1 Pro (recipe workflow)...`, 'info', 'weavy')
              addLog(`   → duration: ${currentQuality?.duration || 10}s`, 'debug', 'weavy')
              addLog(`   → ratio: ${ratio}`, 'debug', 'weavy')

              const submitResult = await submitWeavyKlingVideo({
                token: apiKey,
                imageUrl: imageUrl || undefined,
                imageFile: startFrameFile || imgFile || undefined,
                prompt: prompt.trim(),
                duration: currentQuality?.duration || 10,
                aspectRatio: ratio,
                modelTier: '2.1 Pro',
              })

              if (!submitResult.ok) {
                addLog(`[2/3] ❌ Submit failed: ${submitResult.error}`, 'error', 'weavy')
                throw new Error(submitResult.error || 'Submit failed')
              }

              const taskId = `${submitResult.recipeId}:${submitResult.batchId}`
              addLog(`[2/3] ✅ Task created ✓ recipe=${submitResult.recipeId?.slice(0, 15)}...`, 'success', 'weavy')

              addActiveTask({
                id: taskId,
                taskId,
                roomId: '',
                token: apiKey,
                model: 'Kling Video 2.1 Pro',
                prompt: prompt.trim() || '(no prompt)',
                startedAt: Date.now(),
                page: 'image-to-video',
              })
              activeTaskId = taskId

              addLog(`[3/3] ⏳ Polling for result...`, 'info', 'weavy')
              setStatus((s) => ({ ...s, text: 'Processing...', pct: 25 }))
              const videoUrl = await pollWeavyKlingVideoStatus(
                apiKey,
                submitResult.recipeId!,
                submitResult.batchId!,
                (status, pct) => {
                  addLog(`⏳ Kling Video ${status} (${pct}%)`, 'debug', 'weavy')
                  setStatus((s) => ({ ...s, pct, text: `Kling Video ${status} (${pct}%)` }))
                },
                3600000,
                imageUrl,
              )
              setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
              addLog(`✅ Video selesai ✓`, 'success', 'weavy')

              removeActiveTask(taskId)
              activeTaskId = null
              return videoUrl
            } else {
              // Other Weavy models: simple workflow
              addLog(`[2/3] 🚀 Submitting to Weavy ${model}...`, 'info', 'weavy')
              addLog(`   → model: ${model}`, 'debug', 'weavy')
              addLog(`   → ratio: ${ratio} | duration: ${currentQuality?.duration || 5}s`, 'debug', 'weavy')

              const submitResult = await submitWeavyVideo({
                token: apiKey,
                model,
                prompt: prompt.trim(),
                imageUrl,
                aspectRatio: ratio,
                duration: currentQuality?.duration || 5,
                negativePrompt: undefined,
                quality: quality || undefined,
              })

              if (!submitResult.ok) {
                addLog(`[2/3] ❌ Submit failed: ${submitResult.error}`, 'error', 'weavy')
                throw new Error(submitResult.error || 'Submit failed')
              }

              const taskId = submitResult.taskId!
              addLog(`[2/3] ✅ Task created ✓ id=${taskId.slice(0, 20)}...`, 'success', 'weavy')

              addActiveTask({
                id: taskId,
                taskId,
                roomId: '',
                token: apiKey,
                model: currentModel?.label || model,
                prompt: prompt.trim() || '(no prompt)',
                startedAt: Date.now(),
                page: 'image-to-video',
              })
              activeTaskId = taskId

              addLog(`[3/3] ⏳ Polling for result...`, 'info', 'weavy')
              setStatus((s) => ({ ...s, text: 'Processing...', pct: 25 }))
              const videoUrl = await pollWeavyStatus(
                apiKey,
                taskId,
                (status, pct) => {
                  addLog(`⏳ Weavy ${status} (${pct}%)`, 'debug', 'weavy')
                  setStatus((s) => ({ ...s, pct, text: `Weavy ${status} (${pct}%)` }))
                },
                3600000
              )
              setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
              addLog(`✅ Video selesai ✓`, 'success', 'weavy')

              removeActiveTask(taskId)
              activeTaskId = null
              return videoUrl
            }
          },
          {
            requiredCredits: totalCredits,
            onKeySwitch: (from, to, attempt) => {
              addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn', 'weavy')
              if (activeTaskId) removeActiveTask(activeTaskId)
              activeTaskId = null
            },
            onError: (err, key) => {
              if (detectTokenError('weavy', err)) {
                addLog(`⚠️ Key "${key.name}" is invalid: ${err.message}`, 'warn', 'weavy')
              }
            },
          }
        )
        if (rotation.ok && rotation.result) {
          setResults((prev) => [rotation.result!, ...prev])
          saveGalleryItem(rotation.result!)
          successRef.current = true
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
          notifyGenerationComplete(currentModel?.label || model, 'Weavy')
          if (rotation.triedKeys > 1) {
            addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success', 'weavy')
          }
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      } else if (provider === 'galleri5') {
        addLog(`[1/3] 🖼️ Preparing image...`, 'info', 'galleri5')
        if (!imgFile) throw new Error('G5 I2V membutuhkan gambar input')

        addLog(`[1/3] 🖼️ Uploading image to Catbox...`, 'info', 'galleri5')
        const imageUrl = await uploadToCatbox(imgFile)
        addLog(`[1/3] ✅ Image uploaded ✓`, 'success', 'galleri5')

        const { submitGalleri5I2V, pollGalleri5MotionControl, getGalleri5AuthHeaders, isGalleri5ModelRestricted, isGalleri5InsufficientBalance, getGalleri5ErrorMessage } = await import('@/lib/galleri5')

        const rotation = await withTokenRotation<string>(
          'galleri5',
          async (token) => {
            addLog(`🔑 Trying G5 token...`, 'info', 'galleri5')
            setStatus((s) => ({ ...s, text: 'Submit G5 I2V...', pct: 15 }))

            const authHeaders = await getGalleri5AuthHeaders(token)
            if (!authHeaders) throw new Error('G5: auth headers tidak valid')

            const submitResult = await submitGalleri5I2V({
              authHeaders,
              modelKey: model,
              imageUrl,
              imageFile: imgFile,
              prompt: prompt.trim() || undefined,
              duration: currentQuality?.duration || 10,
              onProgress: (msg, pct) => {
                addLog(`⏳ G5 ${msg}`, 'debug', 'galleri5')
                setStatus((s) => ({ ...s, pct: Math.min(pct || 0, 90), text: `G5 ${msg}` }))
              },
            })

            const taskId = submitResult.taskId
            addLog(`[2/3] ✅ Task created ✓ task=${taskId.slice(0, 20)}...`, 'success', 'galleri5')

            addActiveTask({
              id: taskId,
              taskId,
              roomId: '',
              token: token.slice(0, 50),
              model: currentModel?.label || model,
              prompt: prompt.trim() || '(no prompt)',
              startedAt: Date.now(),
              page: 'image-to-video',
            })
            activeTaskId = taskId

            addLog(`[3/3] ⏳ Polling for result...`, 'info', 'galleri5')
            setStatus((s) => ({ ...s, text: 'Processing...', pct: 25 }))

            let videoUrl: string
            if (/^https?:\/\//i.test(taskId)) {
              videoUrl = taskId
            } else {
              videoUrl = await pollGalleri5MotionControl(authHeaders, submitResult.sessionId, (msg, pct) => {
                addLog(`⏳ G5 ${msg}`, 'debug', 'galleri5')
                setStatus((s) => ({ ...s, pct: Math.min(pct || 0, 95), text: `G5 ${msg}` }))
              }, submitResult.orgId)
            }

            setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
            addLog(`✅ Video selesai ✓`, 'success', 'galleri5')

            removeActiveTask(taskId)
            activeTaskId = null
            return videoUrl
          },
          {
            requiredCredits: totalCredits,
            onKeySwitch: (from, to, attempt) => {
              addLog(`🔄 Token invalid! Switching key #${attempt}`, 'warn', 'galleri5')
              if (activeTaskId) removeActiveTask(activeTaskId)
              activeTaskId = null
            },
            onError: (err, _key) => {
              if (detectTokenError('galleri5', err)) {
                addLog(`⚠️ Key is invalid: ${err.message}`, 'warn', 'galleri5')
              }
              // If model restricted, stop rotation and throw error
              if (isGalleri5ModelRestricted(err.message)) {
                const errorMsg = getGalleri5ErrorMessage(err)
                addLog(`❌ ${errorMsg}`, 'error', 'galleri5')
                throw new Error(errorMsg)
              }
              // If insufficient balance, log warning and let rotation continue to next token
              if (isGalleri5InsufficientBalance(err.message)) {
                addLog(`⚠️ ${err.message} - trying next token...`, 'warn', 'galleri5')
                return // Don't throw, let rotation continue
              }
            },
          }
        )
        if (rotation.ok && rotation.result) {
          setResults((prev) => [rotation.result!, ...prev])
          saveGalleryItem(rotation.result!)
          successRef.current = true
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
          notifyGenerationComplete(currentModel?.label || model, 'Galery5')
          if (rotation.triedKeys > 1) {
            addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success', 'galleri5')
          }
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      } else if (provider === 'oneover') {
        // ─── OneOver: Grok Video, Seedance 2.0, Seedance 2.5 ────────
        addLog(`[1/3] 🖼️ Preparing images...`, 'info', 'oneover')

        // Upload reference image to base64 if available
        let referenceImageBase64: string | undefined
        if (imgFile) {
          addLog(`[1/3] 🖼️ Converting image to base64...`, 'info', 'oneover')
          setStatus((s) => ({ ...s, text: 'Converting image...', pct: 5 }))
          const { fileToBase64 } = await import('@/lib/oneover')
          referenceImageBase64 = await fileToBase64(imgFile)
          addLog(`[1/3] ✅ Image ready ✓`, 'success', 'oneover')
        } else if (startFrameFile) {
          addLog(`[1/3] 🖼️ Converting start frame to base64...`, 'info', 'oneover')
          setStatus((s) => ({ ...s, text: 'Converting image...', pct: 5 }))
          const { fileToBase64 } = await import('@/lib/oneover')
          referenceImageBase64 = await fileToBase64(startFrameFile)
          addLog(`[1/3] ✅ Image ready ✓`, 'success', 'oneover')
        } else {
          addLog(`[1/3] ℹ️ Text-to-video mode (no image)`, 'info', 'oneover')
        }

        const rotation = await withTokenRotation<string>(
          'oneover',
          async (apiKey, keyInfo) => {
            addLog(`🔑 Trying key: ${keyInfo.name || keyInfo.id}`, 'info', 'oneover')

            const { generateWithOneOver } = await import('@/lib/oneover')

            const apiModel = currentModel?.apiModel || model.replace('oo:', '')
            addLog(`[2/3] 🚀 Submitting to OneOver ${apiModel}...`, 'info', 'oneover')
            setStatus((s) => ({ ...s, text: `Submit OneOver ${apiModel}...`, pct: 10 }))

            const videoUrl = await generateWithOneOver({
              apiKey,
              prompt: prompt.trim(),
              model: apiModel,
              duration: currentQuality?.duration || 10,
              resolution: currentQuality?.resolution || undefined,
              aspectRatio: ratio,
              generateAudio: currentQuality?.sound === 'on',
              referenceImageBase64,
              omniTask: referenceImageBase64 ? 'image_to_video' : 'text_to_video',
              onLog: (msg, level) => addLog(msg, level as any, 'oneover'),
              onStatus: (text, pct) => setStatus((s) => ({ ...s, text, pct })),
            })

            setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
            addLog(`✅ Video selesai ✓`, 'success', 'oneover')

            return videoUrl
          },
          {
            requiredCredits: totalCredits,
            onKeySwitch: (from, to, attempt) => {
              addLog(`🔄 Key invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn', 'oneover')
            },
            onError: (err, key) => {
              if (detectTokenError('oneover', err)) {
                addLog(`⚠️ Key "${key.name}" is invalid: ${err.message}`, 'warn', 'oneover')
              }
            },
          }
        )
        if (rotation.ok && rotation.result) {
          setResults((prev) => [rotation.result!, ...prev])
          saveGalleryItem(rotation.result!)
          successRef.current = true
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
          notifyGenerationComplete(currentModel?.label || model, 'OneOver')
          if (rotation.triedKeys > 1) {
            addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success', 'oneover')
          }
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      } else if (provider === 'genspark') {
        // ─── Genspark: Image-to-Video (14+ models) ────────
        const gensparkApiModel = currentModel?.apiModel || model.replace('gp:', '')
        addLog(`[1/3] 🖼️ Preparing image...`, 'info', 'genspark')

        let imageUrl: string | undefined
        if (imgFile) {
          addLog(`[1/3] 🖼️ Uploading image to Genspark...`, 'info', 'genspark')
          setStatus((s) => ({ ...s, text: 'Upload image...', pct: 10 }))
          const { uploadToGenspark } = await import('@/lib/genspark')
          imageUrl = await uploadToGenspark(imgFile)
          addLog(`[1/3] ✅ Image: ${imageUrl.slice(0, 60)}...`, 'success', 'genspark')
        } else {
          addLog(`[1/3] ℹ️ Text-to-video mode (no image)`, 'info', 'genspark')
        }

        const rotation = await withTokenRotation<string>(
          'genspark',
          async (apiKey, keyInfo) => {
            addLog(`🔑 Trying key: ${keyInfo.name || keyInfo.id}`, 'info', 'genspark')

            const { submitGensparkVideo, extractGensparkVideoUrl } = await import('@/lib/genspark')

            const duration = currentQuality?.duration || 10
            const aspectRatio = ratio

            addLog(`[2/3] 🚀 Submitting to Genspark ${gensparkApiModel} (${duration}s)...`, 'info', 'genspark')
            setStatus((s) => ({ ...s, text: `Submit Genspark ${gensparkApiModel}...`, pct: 20 }))

            const result = await submitGensparkVideo({
              prompt: prompt.trim() || undefined,
              model: gensparkApiModel,
              imageUrl,
              duration,
              aspectRatio,
              extraParams: {
                tier: quality === 'standard' ? 'standard' : quality === 'fast' ? 'fast' : 'standard',
                ...(currentQuality?.resolution ? { video_size: 'auto' } : {}),
              },
            })

            // Check for FAILURE in initial response
            const gv0 = result?.data?.generated_videos?.[0] as any
            if (gv0?.status === 'FAILURE' || gv0?.status === 'FAILED') {
              const reason = gv0.failure_reason || gv0.error_message || 'Unknown error'
              throw new Error(`Genspark gagal: ${reason}`)
            }

            let resultUrl = extractGensparkVideoUrl(result, { imageUrl })
            if (!resultUrl) {
              // Video still processing — poll for result
              const taskId = gv0?.task_id || result?.data?.task_id
              if (taskId) {
                addLog(`[2/3] ⏳ Video sedang diproses, polling...`, 'info', 'genspark')
                setStatus((s) => ({ ...s, text: 'Polling...', pct: 50 }))
                const { pollGensparkVideo } = await import('@/lib/genspark')
                resultUrl = await pollGensparkVideo(taskId, (msg) => {
                  addLog(`[2/3] ${msg}`, 'info', 'genspark')
                  setStatus((s) => ({ ...s, text: msg, pct: 70 }))
                })
              } else {
                throw new Error('No video URL and no task_id returned from Genspark')
              }
            }

            setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
            addLog(`[3/3] ✅ Video selesai ✓`, 'success', 'genspark')

            return resultUrl
          },
          {
            requiredCredits: totalCredits,
            onKeySwitch: (from, to, attempt) => {
              addLog(`🔄 Key invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn', 'genspark')
            },
            onError: (err, key) => {
              if (detectTokenError('genspark', err)) {
                addLog(`⚠️ Key "${key.name}" is invalid: ${err.message}`, 'warn', 'genspark')
              }
            },
          }
        )
        if (rotation.ok && rotation.result) {
          setResults((prev) => [rotation.result!, ...prev])
          saveGalleryItem(rotation.result!)
          successRef.current = true
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
          notifyGenerationComplete(currentModel?.label || model, 'Genspark AI')
          if (rotation.triedKeys > 1) {
            addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success', 'genspark')
          }
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      } else if (provider === 'riverside') {
        // ─── Riverside: playground GraphQL (real generation) ─────────────
        addLog(`[1/3] 🖼️ Menyiapkan generate Riverside...`, 'info', 'riverside')
        setStatus((s) => ({ ...s, text: 'Menyiapkan...', pct: 5 }))

        const rotation = await withTokenRotation<string>(
          'riverside',
          async (apiKey, keyInfo) => {
            addLog(`🔑 Trying key: ${keyInfo.name || keyInfo.id}`, 'info', 'riverside')

            const { generateRiversideVideo } = await import('@/lib/riverside')
            const apiModel = currentModel?.apiModel || model.replace('rs:', '')
            const duration = currentQuality?.duration || 8
            const resolution = currentQuality?.resolution
            const soundEnabled = currentQuality?.sound === 'on'

            addLog(`[2/3] 🚀 Submitting to Riverside ${apiModel} (${duration}s)...`, 'info', 'riverside')
            setStatus((s) => ({ ...s, text: `Submit Riverside ${apiModel}...`, pct: 15 }))

            const result = await generateRiversideVideo({
              token: apiKey,
              modelId: apiModel,
              prompt: prompt.trim(),
              aspectRatio: ratio,
              resolution,
              durationSeconds: duration,
              generateAudio: soundEnabled,
              imageFile: imgFile || startFrameFile,
              onLog: (msg, level = 'info') => {
                addLog(msg, level as any, 'riverside')
                setStatus((s) => ({ ...s, text: msg, pct: Math.min((s.pct || 0) + 5, 85) }))
              },
            })

            if (!result.ok || !result.videoUrl) {
              throw new Error(result.error || 'Riverside generation gagal')
            }

            setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
            addLog(`[3/3] ✅ Video selesai ✓ ${result.videoUrl.slice(0, 60)}...`, 'success', 'riverside')
            return result.videoUrl
          },
          {
            requiredCredits: totalCredits,
            onKeySwitch: (from, to, attempt) => {
              addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn', 'riverside')
            },
            onError: (err, key) => {
              if (detectTokenError('riverside', err)) {
                addLog(`⚠️ Key "${key.name}" is invalid: ${err.message}`, 'warn', 'riverside')
              }
            },
          }
        )
        if (rotation.ok && rotation.result) {
          setResults((prev) => [rotation.result!, ...prev])
          saveGalleryItem(rotation.result!)
          successRef.current = true
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai' }))
          notifyGenerationComplete(currentModel?.label || model, PROVIDER_CONFIGS['riverside'].name)
          if (logId) logGenerationComplete(logId, { status: 'completed', result_url: rotation.result, duration_ms: Date.now() - startTime })
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      } else if (provider === 'nexabot') {
        // ─── NexaBot: REST API (satu model: Google Omni) ─────
        addLog(`[1/3] 🚀 Menyiapkan generate NexaBot...`, 'info', 'nexabot')
        setStatus((s) => ({ ...s, text: 'Menyiapkan...', pct: 5 }))

        // Billing user: 1 generate = Rp 250 (otomatis Rp 0 selama Paket Unlimited
        // aktif, ditegakkan server). Admin bebas. `usage_id`-nya disimpan supaya
        // pemotongan ini bisa di-refund tepat kalau generate gagal.
        if (authToken && currentUser?.role !== 'admin') {
          const charge = await chargeNexabotWallet(authToken, currentModel?.apiModel || 't2v')
          nbChargeRef.current = charge.usageId
          setNbWallet((w) => (w ? { ...w, balance: charge.balance } : w))
          addLog(charge.unlimited
            ? `[1/3] 🎟️ Paket Unlimited aktif — generate ini gratis`
            : `[1/3] 💰 Saldo terpotong ${formatRp(charge.deducted)} ✓ sisa ${formatRp(charge.balance)}`, 'success', 'nexabot')
        } else if (currentUser?.role === 'admin') {
          addLog(`[1/3] ⚡ Admin mode — skip saldo`, 'info', 'nexabot')
        }

        const rotation = await withTokenRotation<string>(
          'nexabot',
          async (apiKey, keyInfo) => {
            // Mode session (cookie): generate lewat /api/v1/generate yang
            // menghormati paket Unlimited. Key tanpa cookie langsung lewat API
            // key (pay-as-you-go 0.25 cr). Key dengan cookie yang mati di tengah
            // job ditangani runNexabotJobWithSessionFallback() di bawah.
            const sessionMode = !!keyInfo?.cookies
            addLog(sessionMode
              ? `🍪 Trying session key: ${keyInfo.name || keyInfo.id} (Unlimited) → /api/v1/generate`
              : `🔑 Trying key: ${keyInfo.name || keyInfo.id} (API key) → /api/v1/api`, 'info', 'nexabot')

            const { submitNexabot, pollNexabotJob, downloadNexabotResult } = await import('@/lib/nexabot')
            const { fileToBase64 } = await import('@/lib/oneover')
            // NexaBot tidak punya parameter `model` di API-nya — yang menentukan hasil
            // adalah MODE. Jadi dropdown sekarang berisi mode, bukan nama model palsu.
            const apiModel = currentModel?.apiModel || 't2v'
            // Mapping param sesuai API resmi NexaBot (/api/v1/modes):
            //  • ratio (t2v/sfv/i2v): 1 = landscape, 2 = portrait
            //  • aspect (img):        1 = 1:1, 2 = 16:9, 5 = 9:16
            let ratioParam: number | undefined
            let aspectParam: number | undefined
            if (apiModel === 'img') {
              if (ratio === '1:1') aspectParam = 1
              else if (ratio === '16:9') aspectParam = 2
              else if (ratio === '9:16') aspectParam = 5
            } else if (apiModel === 't2v' || apiModel === 'sfv' || apiModel === 'i2v') {
              if (ratio === '16:9') ratioParam = 1
              else if (ratio === '9:16') ratioParam = 2
            }

            // Media input (base64 data URI) sesuai aturan tiap mode:
            //  • sfv: 1 gambar start frame · i2v: 1-3 gambar ingredient
            //  • r2v: media[0]=video + 1 gambar opsional (Omni Flash 1.1)
            //  • NexaBot (t2v): kirim semua gambar/video sebagai media reference
            const imageFiles = [imgFile, startFrameFile, ...refFiles]
              .filter((f): f is File => !!f && f.type.startsWith('image/'))
            const videoFile = refFiles.find((f) => f.type.startsWith('video/'))

            // NexaBot hanya punya satu model (Google Omni), jadi mode diturunkan dari
            // media yang di-upload: gambar → sfv (start frame), video → r2v (reference),
            // tanpa media → t2v (text to video).
            type NbMode = import('@/lib/nexabot').NexabotMode
            const baseMode = (apiModel as NbMode) || 't2v'
            let nbMode: NbMode = baseMode
            if (baseMode === 't2v') {
              // opsi tunggal: turunkan mode dari media
              if (imageFiles.length > 0) nbMode = 'sfv'
              else if (videoFile) nbMode = 'r2v'
            } else if ((baseMode === 'sfv' || baseMode === 'i2v') && imageFiles.length === 0) {
              nbMode = videoFile ? 'r2v' : 't2v'
            } else if (baseMode === 'r2v' && !videoFile) {
              nbMode = imageFiles.length > 0 ? 'sfv' : 't2v'
            }

            // Media (base64 data URI) dibatasi sesuai aturan tiap mode:
            //   sfv = 1 gambar start frame · i2v = 1-3 gambar
            //   r2v = media[0]=video + 1 gambar opsional (Omni Flash 1.1) · t2v = tanpa media
            const media: string[] = []
            {
              // NexaBot: kompres agresif agar payload JSON < 1MB
              // (normalizeImage terlalu longgar — bisa 4MB + base64 overhead = 413)
              const { compressForApi } = await import('@/lib/nexabot')
              if (nbMode === 'sfv') {
                if (imageFiles[0]) media.push(await fileToBase64(await compressForApi(imageFiles[0])))
              } else if (nbMode === 'i2v') {
                for (const f of imageFiles.slice(0, 3)) {
                  media.push(await fileToBase64(await compressForApi(f)))
                }
              } else if (nbMode === 'r2v') {
                // Omni Flash 1.1 r2v: media[0]=video + 1 image opsional
                if (videoFile) media.push(await fileToBase64(videoFile))
                for (const f of imageFiles.slice(0, 1)) {
                  media.push(await fileToBase64(await compressForApi(f)))
                }
                if (media.length === 0 && imageFiles[0]) media.push(await fileToBase64(await compressForApi(imageFiles[0])))
              }
            }
            // Jalur session → API key dengan pemulihan otomatis: kalau cookie
            // Unlimited kedaluwarsa di tengah job, helper mencoba ambil ulang
            // cookie (extension / penyimpanan) lalu mengulang job; kalau tetap
            // gagal, generate beralih ke API key pay-as-you-go milik key ini —
            // lengkap dengan notifikasi toast + log.
            return await runNexabotJobWithSessionFallback<string>(
              async (auth, via) => {
                addLog(`[2/3] 🚀 Submitting to NexaBot ${nbMode} via ${via}...`, 'info', 'nexabot')
                setStatus((s) => ({ ...s, text: `Submit NexaBot ${nbMode}...`, pct: 15 }))

                const submit = await submitNexabot({
                  mode: nbMode,
                  prompt: prompt.trim(),
                  ratio: ratioParam,
                  aspect: aspectParam,
                  voice: apiModel === 'tts' ? NEXABOT_DEFAULT_VOICE : undefined,
                  media: media.length > 0 ? media : undefined,
                  // Billing NexaBot mengikuti telegram_id (kalau diisi di halaman Providers).
                  // Di mode session field ini diabaikan — akun ditentukan oleh cookie.
                  telegramId: keyInfo?.telegramId,
                }, auth, {
                  // 429 dari NexaBot diulang otomatis setelah jeda (upstream
                  // menolak tanpa membuat job, jadi aman diulang).
                  onRetry: ({ status, delayMs }) => {
                    addLog(`⏳ NexaBot sibuk (HTTP ${status}) — submit diulang dalam ${Math.ceil(delayMs / 1000)}s...`, 'warn', 'nexabot')
                  },
                })
                if (!submit.ok || !submit.jobId) throw new Error(submit.error || 'NexaBot submit gagal')

                addLog(`✅ Task created ✓ id=${submit.jobId.slice(0, 20)}...`, 'success', 'nexabot')
                setStatus((s) => ({ ...s, text: 'Memproses di NexaBot...', pct: 30 }))

                await pollNexabotJob(submit.jobId, auth, (msg) => {
                  addLog(msg, 'debug', 'nexabot')
                  setStatus((s) => ({ ...s, text: msg, pct: Math.min((s.pct || 0) + 5, 85) }))
                }, {
                  // Poll status itu read-only, jadi hiccup upstream (proxy 504
                  // / rate limit) ditunggu dengan backoff, bukan menggagalkan job.
                  onRetry: ({ status, delayMs, message }) => {
                    const seconds = Math.ceil(delayMs / 1000)
                    addLog(`⏳ NexaBot ${message}${status ? ` (HTTP ${status})` : ''} — coba lagi dalam ${seconds}s...`, 'warn', 'nexabot')
                    setStatus((s) => ({ ...s, text: `NexaBot sibuk — menunggu ${seconds}s...` }))
                  },
                })

                setStatus((s) => ({ ...s, pct: 90, text: 'Mengunduh hasil...' }))
                const dl = await downloadNexabotResult(submit.jobId, auth)
                if (!dl.ok || !dl.url) throw new Error(dl.error || 'NexaBot download gagal')

                setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
                addLog(`[3/3] ✅ Selesai ✓ ${dl.url.slice(0, 60)}...`, 'success', 'nexabot')
                return dl.url
              },
              {
                sessionCookies: keyInfo?.cookies,
                apiKey,
                keyId: keyInfo.id,
                hooks: { log: addLog, notify: addToast },
              }
            )
          },
          {
            requiredCredits: totalCredits,
            onKeySwitch: (from, to, attempt) => {
              addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn', 'nexabot')
            },
            onError: (err, key) => {
              if (detectTokenError('nexabot', err)) {
                addLog(`⚠️ Key "${key.name}" is invalid: ${err.message}`, 'warn', 'nexabot')
              }
            },
          }
        )
        if (rotation.ok && rotation.result) {
          setResults((prev) => [rotation.result!, ...prev])
          saveGalleryItem(rotation.result!)
          successRef.current = true
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai' }))
          notifyGenerationComplete(currentModel?.label || model, PROVIDER_CONFIGS['nexabot'].name)
          if (logId) logGenerationComplete(logId, { status: 'completed', result_url: rotation.result, duration_ms: Date.now() - startTime })
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      } else {
        addLog(`ℹ️ Using default provider flow for ${PROVIDER_CONFIGS[provider].name}`, 'info', provider)
        const rotation = await withTokenRotation<string>(
          provider,
          async (apiKey, keyInfo) => {
            addLog(`🔑 Trying key: ${keyInfo.name || keyInfo.id}`, 'info', provider)
            for (let i = 0; i <= 100; i += 10) {
              await new Promise((r) => setTimeout(r, 500))
              setStatus((s) => ({ ...s, pct: i, text: `Processing ${i}%...` }))
            }
            return 'https://example.com/result.mp4'
          },
          {
            onKeySwitch: (from, to, attempt) => {
              addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn', provider)
            },
            onError: (err, key) => {
              if (detectTokenError(provider, err)) {
                addLog(`⚠️ Key "${key.name}" is invalid: ${err.message}`, 'warn', provider)
              }
            },
          }
        )
        if (rotation.ok && rotation.result) {
          setResults((prev) => [rotation.result!, ...prev])
          saveGalleryItem(rotation.result!)
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai' }))
          addLog(`✅ Video selesai ✓`, 'success', provider)
          notifyGenerationComplete(currentModel?.label || model, PROVIDER_CONFIGS[provider].name)
          if (logId) logGenerationComplete(logId, { status: 'completed', result_url: rotation.result, duration_ms: Date.now() - startTime })
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      }
     } catch (err: any) {
       if (activeTaskId) removeActiveTask(activeTaskId)
       // NexaBot: kembalikan saldo yang sudah dipotong untuk generate ini.
       if (provider === 'nexabot' && nbChargeRef.current && authToken) {
         const refundedBalance = await refundNexabotWallet(authToken, nbChargeRef.current)
         nbChargeRef.current = null
         if (refundedBalance != null) {
           addLog(`💸 Saldo NexaBot dikembalikan ✓ sisa ${formatRp(refundedBalance)}`, 'warn', 'nexabot')
           setNbWallet((w) => (w ? { ...w, balance: refundedBalance } : w))
         }
       }
       addLog(`❌ Error: ${err.message}`, 'error', provider)
       addToast(`Generate gagal: ${err.message}`, 'error')
       if (logId) logGenerationFailed(logId, err.message, Date.now() - startTime)
       if (['roboneo', 'framia', 'createpulse'].includes(provider)) {
         addLog('⚠️ Credit mungkin sudah terpotong oleh server provider. Hubungi provider untuk refund jika gagal.', 'warn', provider)
       }
       setStatus((s) => ({ ...s, pct: 100, text: `❌ Error: ${err.message}` }))
    } finally {
      clearInterval(timer)
      // Blok catch sudah menangani refund (kalau ada); sisanya dibuang supaya
      // generate berikutnya tidak me-refund catatan lama.
      nbChargeRef.current = null
      setCompressDialog(null)
      const wasGenerating = generatingRef.current
      setGenerating(false)
      generatingRef.current = false
      if (wasGenerating && successRef.current) {
        addToast(`Generate selesai: ${PROVIDER_CONFIGS[provider].icon} ${model}`, 'success')
        setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200)
      }
      setTimeout(() => setStatus((s) => ({ ...s, show: false })), 3000)
    }
  }

  // Ditampilkan di kartu provider NexaBot (lihat nexabotPathPill).
  const nexabotPill = nexabotPathPill(keys.nexabot, nexabotSession, nexabotChecking)

  const PROVIDER_IDS: ProviderId[] = ['weavy', 'wavespeed', 'roboneo', 'createpulse', 'framia', 'leonardo', 'galleri5', 'oneover', 'firefly', 'genspark', 'riverside', 'nexabot']

  return (
    <PageContent>
      <PageHeader
        eyebrow="Generate"
        title="Image To"
        highlight="Video"
        desc="1 gambar → pilih provider, model, aspek rasio, durasi, prompt → generate video."
      />

      {/* Provider Selection */}
      <Section title="📡 Pilih Provider" sub="Pilih provider AI untuk generate video">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3">
          {PROVIDER_IDS.map((pid) => {
            const config = PROVIDER_CONFIGS[pid]
            const providerModels = PROVIDER_MODELS[pid] || []
            const keyCount = keys[pid]?.length || 0
            const isActive = provider === pid

            return (
              <button
                key={pid}
                onClick={() => setProvider(pid)}
                className={`p-2 sm:p-3 rounded-xl border-2 transition-all text-left ${
                  isActive
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border hover:border-primary/30 bg-card/30'
                }`}
              >
                <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                  <span className="text-base sm:text-lg">{config.icon}</span>
                  <span className="text-xs sm:text-sm font-medium truncate">{config.name}</span>
                </div>
                                                    <div className="text-[9px] sm:text-[10px] text-muted-foreground">
                  {providerModels.length} models · {keyCount} keys
                  {pid === 'nexabot' && nexabotPill && (
                    <span className={nexabotPill.className} title={nexabotPill.title}>{nexabotPill.text}</span>
                  )}
                </div>
                {isActive && (
                  <Badge variant="default" className="mt-1 sm:mt-2 text-[9px] sm:text-[10px]">
                    Active
                  </Badge>
                )}
              </button>
            )
          })}
        </div>

        <MaintenanceBanner providerId={provider} />

        {/* Provider Info */}
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <div>
            Provider aktif: <b className="text-foreground">{PROVIDER_CONFIGS[provider].icon} {PROVIDER_CONFIGS[provider].name}</b>
          </div>
          <div>
            {provider === 'createpulse' ? (
              <>API Key: <b className="text-emerald-500">Admin Managed</b></>
            ) : (
              <>API Keys: <b className={providerKeyCount > 0 ? 'text-emerald-500' : 'text-destructive'}>{providerKeyCount}</b> tersedia</>
            )}
          </div>
          <div>
            Status: <b className={provider === 'createpulse' || hasActiveKey ? 'text-emerald-500' : 'text-blue-500'}>{provider === 'createpulse' || hasActiveKey ? 'Ready' : 'No Key'}</b>
          </div>
          <button
            onClick={toggleNotifications}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] transition ${
              notifEnabled
                ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-500'
                : 'border-border text-muted-foreground hover:border-primary/30'
            }`}
          >
            🔔 {notifEnabled ? 'Notifikasi ON' : 'Notifikasi OFF'}
          </button>
        </div>

        {/* CreatePulse Pricing Info */}
        {provider === 'createpulse' && (
          <div className="mt-3 p-3 rounded-xl border border-primary/20 bg-primary/5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-primary">💜 CreatePulse {user?.role === 'admin' && '(Admin — Free)'}</div>
              {user?.role !== 'admin' && (
                <div className="text-xs">
                  Saldo: <b className={`font-bold ${cpBalance >= getCreatepulseCost(currentModel?.apiModel) ? 'text-emerald-500' : 'text-destructive'}`}>
                    Rp {cpBalance.toLocaleString('id-ID')}
                  </b>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <div>Seedance 2.0 (10s): <b className="text-foreground">{user?.role === 'admin' ? 'GRATIS' : 'Rp 1.500'}</b></div>
              <div>Seedance 2.5 (10s): <b className="text-foreground">{user?.role === 'admin' ? 'GRATIS' : 'Rp 1.500'}</b></div>
              <div>Seedance 2.0 (15s): <b className="text-foreground">{user?.role === 'admin' ? 'GRATIS' : 'Rp 2.250'}</b></div>
              <div>Veo Omni (10s): <b className="text-foreground">{user?.role === 'admin' ? 'GRATIS' : 'Rp 2.250'}</b></div>
              {user?.role !== 'admin' && <div>Failed generations: <b className="text-emerald-500">auto-refunded</b></div>}
            </div>
            {user?.role !== 'admin' && cpBalance < getCreatepulseCost(currentModel?.apiModel) && (
              <div className="mt-2 text-[11px]">
                <a href="/topup/createpulse" className="text-primary hover:underline font-medium">
                  Top Up Saldo →
                </a>
              </div>
            )}
          </div>
        )}

        {/* NexaBot Pricing Info — saldo Rp 250/generate atau Paket Unlimited */}
        {provider === 'nexabot' && (
          <div className="mt-3 p-3 rounded-xl border border-primary/20 bg-primary/5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-primary">
                ⚡ NexaBot {user?.role === 'admin' ? '(Admin — Free)' : `— ${formatRp(nbWallet?.price ?? 250)}/generate`}
              </div>
              {nbWallet?.unlimited.active && (
                <Badge variant="success">
                  Unlimited · sisa {nbWallet.unlimited.days_left} hari
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <div>
                Saldo: <b className={`font-bold ${nbWallet?.unlimited.active || (nbWallet?.balance ?? 0) >= (nbWallet?.price ?? 250) ? 'text-emerald-500' : 'text-destructive'}`}>
                  {formatRp(nbWallet?.balance ?? 0)}
                </b>
              </div>
              <div>Paket Unlimited {nbWallet?.package.days ?? 7} hari: <b className="text-foreground">{formatRp(nbWallet?.package.price ?? 35000)}</b></div>
              {nbWallet?.unlimited.active ? (
                <div>Status: <b className="text-emerald-500">GRATIS sampai paket habis</b></div>
              ) : (
                <div>Failed generations: <b className="text-emerald-500">auto-refunded</b></div>
              )}
            </div>
            {user?.role !== 'admin' && !nbWallet?.unlimited.active && (nbWallet?.balance ?? 0) < (nbWallet?.price ?? 250) && (
              <div className="mt-2 text-[11px]">
                <a href="/topup/nexabot" className="text-primary hover:underline font-medium">
                  Top Up Saldo / Beli Paket Unlimited →
                </a>
              </div>
            )}
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-5">
            {(provider === 'createpulse' || model === 'seedance-mini') ? (
              /* CreatePulse / Seedance Mini: Frames & References */
              <Section title="Frames & References" sub="Start frame, end frame, dan referensi gambar (opsional)">
                <input ref={startFrameRef} type="file" accept="image/*" hidden onChange={(e) => handleStartFrameChange(e.target.files)} />
                <input ref={endFrameRef} type="file" accept="image/*" hidden onChange={(e) => handleEndFrameChange(e.target.files)} />
                <input ref={refInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => handleRefChange(e.target.files)} />
                <div className="grid grid-cols-3 gap-3">
                  {/* Start Frame */}
                  <div>
                    <div className="text-[11px] text-muted-foreground mb-1.5 text-center">Start*</div>
                    {startFrameUrl ? (
                      <div className="relative aspect-square rounded-xl overflow-hidden border border-border">
                        <img src={startFrameUrl} alt="Start" className="w-full h-full object-cover" />
                        <button onClick={() => { setStartFrameFile(null); setStartFrameUrl(null) }} className="absolute top-1 right-1 rounded-full w-5 h-5 bg-black/60 text-white text-[10px] grid place-items-center hover:bg-black/80">×</button>
                      </div>
                    ) : (
                      <button onClick={() => startFrameRef.current?.click()} className="w-full aspect-square rounded-xl border border-dashed border-border/80 bg-card/30 grid place-items-center hover:border-primary/60 transition">
                        <div className="text-center">
                          <div className="text-lg">+</div>
                          <div className="text-[10px] text-muted-foreground">Start*</div>
                        </div>
                      </button>
                    )}
                  </div>

                  {/* End Frame */}
                  <div>
                    <div className="text-[11px] text-muted-foreground mb-1.5 text-center">End</div>
                    {endFrameUrl ? (
                      <div className="relative aspect-square rounded-xl overflow-hidden border border-border">
                        <img src={endFrameUrl} alt="End" className="w-full h-full object-cover" />
                        <button onClick={() => { setEndFrameFile(null); setEndFrameUrl(null) }} className="absolute top-1 right-1 rounded-full w-5 h-5 bg-black/60 text-white text-[10px] grid place-items-center hover:bg-black/80">×</button>
                      </div>
                    ) : (
                      <button onClick={() => endFrameRef.current?.click()} className="w-full aspect-square rounded-xl border border-dashed border-border/80 bg-card/30 grid place-items-center hover:border-primary/60 transition">
                        <div className="text-center">
                          <div className="text-lg">+</div>
                          <div className="text-[10px] text-muted-foreground">End</div>
                        </div>
                      </button>
                    )}
                  </div>

                  {/* References */}
                  <div>
                    <div className="text-[11px] text-muted-foreground mb-1.5 text-center">Ref*</div>
                    {refUrls.length > 0 ? (
                      <div className="space-y-2">
                        {refUrls.map((url, i) => (
                          <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-border">
                            <img src={url} alt={`Ref ${i + 1}`} className="w-full h-full object-cover" />
                            <button onClick={() => removeRef(i)} className="absolute top-1 right-1 rounded-full w-5 h-5 bg-black/60 text-white text-[10px] grid place-items-center hover:bg-black/80">×</button>
                          </div>
                        ))}
                        {refFiles.length < 4 && (
                          <button onClick={() => refInputRef.current?.click()} className="w-full aspect-square rounded-xl border border-dashed border-primary/40 bg-primary/5 grid place-items-center hover:border-primary/60 transition">
                            <div className="text-center">
                              <div className="text-lg">+</div>
                              <div className="text-[10px] text-muted-foreground">Add more</div>
                            </div>
                          </button>
                        )}
                      </div>
                    ) : (
                      <button onClick={() => refInputRef.current?.click()} className="w-full aspect-square rounded-xl border border-dashed border-border/80 bg-card/30 grid place-items-center hover:border-primary/60 transition">
                        <div className="text-center">
                          <div className="text-lg">+</div>
                          <div className="text-[10px] text-muted-foreground">Ref*</div>
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              </Section>
            ) : (
              /* Default UI for other providers */
              <Section title="🖼️ Gambar Input" sub={isNbOmniFlash ? "Gambar referensi (opsional) + video referensi (wajib) di bawah" : "1 file (JPG / PNG / WEBP) — optional untuk text-to-video"}>
                <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => handleFileChange(e.target.files)} />
                {imgUrl ? (
                  <div className="relative aspect-[9/16] rounded-2xl overflow-hidden border border-border">
                    <img src={imgUrl} alt="" className="w-full h-full object-cover" />
                    <button onClick={() => inputRef.current?.click()} className="absolute top-2 right-2 rounded-full px-2 md:px-2.5 py-1 text-xs bg-black/60 text-white flex items-center gap-1">
                      <Upload className="h-3 w-3" />
                      <span className="hidden md:inline">Ganti</span>
                    </button>
                  </div>
                ) : (
                  <button onClick={() => inputRef.current?.click()} className="w-full aspect-[9/16] rounded-2xl border border-dashed border-border/80 bg-card/30 grid place-items-center hover:border-primary/60 transition text-center px-4">
                    <div>
                      <div className="text-3xl">🖼️</div>
                      <div className="text-sm mt-1">Tap atau tarik <b>gambar</b> (opsional)</div>
                      <div className="text-[11px] text-muted-foreground">JPG / PNG / WEBP</div>
                    </div>
                  </button>
                )}
                {isNbOmniFlash && (
                  <div className="mt-3">
                    <input ref={videoRefInputRef} type="file" accept="video/*" hidden onChange={(e) => handleVideoRefChange(e.target.files)} />
                    <div className="text-[11px] text-muted-foreground mb-1.5">🎬 Video Referensi (wajib)</div>
                    {nbVideoUrl ? (
                      <div className="relative aspect-video rounded-2xl overflow-hidden border border-border">
                        <video src={nbVideoUrl} className="w-full h-full object-cover" controls />
                        <button onClick={() => removeRef(nbVideoIdx)} className="absolute top-2 right-2 rounded-full w-6 h-6 bg-black/60 text-white text-xs grid place-items-center hover:bg-black/80">×</button>
                      </div>
                    ) : (
                      <button onClick={() => videoRefInputRef.current?.click()} className="w-full aspect-video rounded-2xl border border-dashed border-border/80 bg-card/30 grid place-items-center hover:border-primary/60 transition text-center px-4">
                        <div>
                          <div className="text-3xl">🎬</div>
                          <div className="text-sm mt-1">Tap untuk upload <b>video referensi</b> (wajib)</div>
                          <div className="text-[11px] text-muted-foreground">MP4 / WEBM / MOV</div>
                        </div>
                      </button>
                    )}
                  </div>
                )}
              </Section>
            )}

            {/* Default Settings */}
            <div className="lg:col-span-2">
              <Section title="⚙️ Pengaturan">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <Label>Model AI ({PROVIDER_CONFIGS[provider].name})</Label>
                    <Select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      options={models.map((m) => ({
                        value: m.value,
                        label: provider === 'createpulse'
                          ? m.label
                          : `${m.label} — ${m.cr === 0 ? 'kuota' : '$' + (m.cr / 1000).toFixed(3)}`,
                      }))}
                    />
                  </div>
                  <div>
                    <Label>Aspek Rasio {isVeoI2V && <span className="text-[10px] text-blue-400 font-normal ml-1">(16:9 only)</span>}</Label>
                    <Select
                      value={ratio}
                      onChange={(e) => setRatio(e.target.value)}
                      options={availableRatios.map((r) => ({ value: r, label: r }))}
                      disabled={isVeoI2V}
                    />
                  </div>
                  <div>
                    <Label>Durasi</Label>
                    <Select
                      value={quality}
                      onChange={(e) => setQuality(e.target.value)}
                      options={qualityOptions.map((q) => ({ value: q.value, label: q.label }))}
                    />
                  </div>
                  <div>
                    <Label>Template Prompt</Label>
                    <div className="flex gap-2">
                      <Select
                        value={String(tplIdx)}
                        onChange={(e) => {
                          const idx = Number(e.target.value)
                      setTplIdx(idx)
                      setPrompt(TEMPLATES[idx]?.body || '')
                    }}
                    options={TEMPLATES.map((t, i) => ({ value: String(i), label: t.name }))}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4">
              <Label>Prompt</Label>
              <Textarea
                rows={4}
                placeholder="Deskripsikan motion / kamera / suasana video..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-3 mt-4 flex-wrap">
              <Button
                onClick={() => setShowPreview(true)}
                disabled={!prompt.trim() || generating}
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" />
                    Generate Video
                  </>
                )}
              </Button>
              <div className="text-xs text-muted-foreground">
                Est. Cost: <b className="text-foreground font-mono">{provider === 'createpulse' ? `Rp ${getCreatepulseCost(currentModel?.apiModel).toLocaleString('id-ID')}` : `${totalCredits} credits`}</b>
                {provider !== 'createpulse' && <BalanceBadge provider={provider} required={totalCredits} />}
              </div>
              {!hasActiveKey && provider !== 'createpulse' && (
                <a
                  href="/providers"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <Key className="h-3 w-3" /> Tambah API key
                </a>
              )}
            </div>

            {status.show && (
               <div className="mt-4 rounded-xl border border-border/70 bg-card/40 p-3">
                 <div className="flex justify-between items-center text-xs mb-1">
                   <span>{status.text}</span>
                   <span className="font-mono text-muted-foreground">{status.time}</span>
                 </div>
                 <div className="h-1 rounded-full bg-border overflow-hidden">
                   <div
                     className="h-full transition-all bg-primary"
                     style={{ width: `${status.pct}%` }}
                   />
                 </div>
                 {!generating && status.pct === 100 && results.length > 0 && (
                   <Button
                     size="sm"
                     className="w-full mt-3"
                     onClick={handleGenerate}
                   >
                     <Rocket className="h-4 w-4" /> Generate Lagi
                   </Button>
                 )}
               </div>
             )}
 
              {compressDialog && (
                <div role="dialog" aria-modal="true" aria-live="polite" className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-background/70 backdrop-blur-sm">
                  <div className="w-[min(360px,90%)] rounded-2xl border border-primary/40 bg-card/95 p-5 shadow-2xl shadow-primary/20">
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                      <div className="font-display text-sm text-foreground">Mengompres file.</div>
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
            </Section>
          </div>

      {/* Preview Dialog */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={() => setShowPreview(false)}>
          <div className="w-[min(480px,92%)] rounded-2xl border border-border bg-card shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-base font-semibold">🚀 Konfirmasi Generate</h3>
              <button onClick={() => setShowPreview(false)} className="p-1 rounded-lg hover:bg-muted transition">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              {imgUrl && (
                <div className="flex items-center gap-3">
                  <img src={imgUrl} alt="Input" className="w-16 h-16 rounded-lg object-cover border border-border" />
                  <div className="text-xs text-muted-foreground">Input image</div>
                </div>
              )}

              <div className="rounded-xl border border-border bg-background/50 p-3 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Provider</span>
                  <span className="font-medium">{PROVIDER_CONFIGS[provider].icon} {PROVIDER_CONFIGS[provider].name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Model</span>
                  <span className="font-medium">{currentModel?.label || model}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rasio</span>
                  <span className="font-medium">{ratio}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Durasi</span>
                  <span className="font-medium">{currentQuality?.duration || '?'}s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Est. Cost</span>
                  <span className="font-medium text-primary">{provider === 'createpulse' ? `Rp ${getCreatepulseCost(currentModel?.apiModel).toLocaleString('id-ID')}` : `${totalCredits} credits`}</span>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background/50 p-3">
                <div className="text-xs text-muted-foreground mb-1">Prompt</div>
                <div className="text-sm break-words max-h-24 overflow-y-auto">{prompt.trim()}</div>
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <Button variant="outline" className="flex-1" onClick={() => setShowPreview(false)}>
                Batal
              </Button>
              <Button className="flex-1" onClick={() => { setShowPreview(false); handleGenerate() }}>
                <Rocket className="h-4 w-4" /> Generate Sekarang
              </Button>
            </div>
          </div>
        </div>
      )}
       </div>

      {/* Logs */}
      {logs.length > 0 && (
        <Section
          title={`📋 Log (${logs.length})`}
          right={
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const text = logs.map((l) => `[${l.time}] ${l.msg}`).join('\n')
                  navigator.clipboard.writeText(text)
                  addToast('Log disalin ke clipboard', 'success')
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground transition flex items-center gap-1"
              >
                <Copy className="h-3 w-3" />
                Copy
              </button>
              <button
                onClick={() => { clearLogs(); setLogs([]); }}
                className="text-[11px] text-destructive hover:text-destructive/80 transition"
              >
                Clear
              </button>
            </div>
          }
        >
          <div className="max-h-52 overflow-y-auto overflow-x-hidden text-[11px] font-mono space-y-0.5 rounded-xl bg-black/20 p-2">
            {logs.map((log, i) => (
              <div
                key={i}
                className={`break-all leading-relaxed ${
                  log.level === 'error'
                    ? 'text-red-400'
                    : log.level === 'success'
                    ? 'text-emerald-400'
                    : log.level === 'warn'
                    ? 'text-blue-400'
                    : log.level === 'debug'
                    ? 'text-slate-500'
                    : 'text-slate-400'
                }`}
              >
                <span className="text-slate-600">[{log.time}]</span>{' '}
                {log.level === 'error' && '❌ '}
                {log.level === 'success' && '✅ '}
                {log.level === 'warn' && '⚠️ '}
                {log.msg}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Gallery / History */}
      <Section
        title={`🖼️ Galeri Hasil (${filteredGallery.length})`}
        sub="Riwayat semua video yang sudah di-generate"
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (window.confirm('Hapus semua log dan galeri? Tindakan ini tidak bisa dibatalkan.')) {
                  clearLogs()
                  clearResults()
                  setLogs([])
                  setGalleryItems([])
                  setResults([])
                  addToast('Semua log & galeri dihapus', 'success')
                }
              }}
              className="text-[11px] text-destructive hover:text-destructive/80 transition font-medium"
            >
              🗑️ Hapus Total
            </button>
            <input
              type="text"
              placeholder="Cari..."
              value={gallerySearch}
              onChange={(e) => setGallerySearch(e.target.value)}
              className="px-2 py-1 rounded-lg border border-border bg-card text-xs w-24 sm:w-48"
            />
            <select
              value={galleryFilter}
              onChange={(e) => setGalleryFilter(e.target.value)}
              className="px-2 py-1 rounded-lg border border-border bg-card text-xs max-w-[100px] sm:max-w-none"
            >
              <option value="all">Semua</option>
              {galleryProviders.map((p) => (
                <option key={p} value={p}>{PROVIDER_CONFIGS[p as ProviderId]?.icon} {PROVIDER_CONFIGS[p as ProviderId]?.name || p}</option>
              ))}
            </select>
          </div>
        }
      >
        {filteredGallery.length === 0 ? (
          <EmptyState
            icon={<Image className="h-8 w-8" />}
            title="Belum ada galeri"
            description="Hasil generate akan muncul di sini"
          />
        ) : (
          <>
            <div className="sm:hidden text-[10px] text-muted-foreground text-center mb-2">
              💡 Swipe kanan = Download, Swipe kiri = Hapus
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredGallery.map((item) => {
              const isBlobUrl = item.url.startsWith('blob:')
              const alreadyProxied = item.url.includes('/api/public/video-proxy')
              const needsProxy = isBlobUrl || alreadyProxied ? false : /meitudata\.com|localhost/i.test(item.url)
              const directUrl = needsProxy ? `/api/public/video-proxy?url=${encodeURIComponent(item.url)}` : item.url
              const proxyFallback = isBlobUrl || alreadyProxied ? item.url : `/api/public/video-proxy?url=${encodeURIComponent(item.url)}`
              return (
                <Swipeable
                  key={item.id}
                  onSwipeLeft={() => removeGalleryItem(item.id)}
                  onSwipeRight={() => handleDownload(item.url, 0)}
                  leftAction={{ icon: <Trash2 className="h-4 w-4" />, label: 'Hapus', color: 'destructive' }}
                  rightAction={{ icon: <Download className="h-4 w-4" />, label: 'Download', color: 'emerald' }}
                >
                  <div className="relative rounded-xl border border-border bg-black/40">
                    <VideoPlayer directUrl={directUrl} proxyFallback={proxyFallback} rawUrl={item.url} ratio={item.ratio} />
                    <div className="p-2 flex flex-col gap-1.5">
                      {item.inputImageUrl && (
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <img src={item.inputImageUrl} alt="" className="w-6 h-6 rounded object-cover" />
                          <span className="truncate flex-1">Input: {item.prompt.slice(0, 40)}...</span>
                        </div>
                      )}
                      <div className="text-xs font-medium truncate">{item.prompt.slice(0, 60)}{item.prompt.length > 60 ? '...' : ''}</div>
                      <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                        {item.provider && <Badge variant="outline" className="text-[9px]">{PROVIDER_CONFIGS[item.provider as ProviderId]?.icon} {PROVIDER_CONFIGS[item.provider as ProviderId]?.name || item.provider}</Badge>}
                        {item.model && <Badge variant="outline" className="text-[9px]">{item.model}</Badge>}
                        {item.ratio && <Badge variant="outline" className="text-[9px]">{item.ratio}</Badge>}
                        {item.duration && <Badge variant="outline" className="text-[9px]">{item.duration}s</Badge>}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{new Date(item.date).toLocaleString('id-ID')}</div>
                       <div className="flex items-center gap-1">
                        <a href={directUrl} target="_blank" rel="noreferrer" className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition">
                          <ExternalLink className="h-3.5 w-3.5" /> Buka
                        </a>
                        <button
                          onClick={() => handleDownload(item.url, 0, item.id)}
                          disabled={downloadingId === item.id}
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-500 transition disabled:opacity-50"
                        >
                          {downloadingId === item.id ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...</>
                          ) : (
                            <><Download className="h-3.5 w-3.5" /> Download</>
                          )}
                        </button>
                        {item.taskUrl && (
                          <a href={item.taskUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/5 hover:bg-violet-500/10 px-3 py-2 text-xs font-medium text-violet-500 transition" title="Buka di provider untuk download tanpa watermark">
                            🌐 Open
                          </a>
                        )}
                        <button
                          onClick={() => removeGalleryItem(item.id)}
                          className="p-2 rounded-lg border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 text-destructive transition"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-1.5">
                        {cdnUrls[item.id] ? (
                          <button
                            onClick={() => handleCopyCdnUrl(cdnUrls[item.id])}
                            className="w-full inline-flex items-center justify-center gap-1 rounded-lg border border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10 px-3 py-1.5 text-[11px] font-medium text-blue-500 transition"
                          >
                            🔗 Copy CDN Link
                          </button>
                        ) : (
                          <button
                            onClick={() => handleCdnUpload(item.id, item.url)}
                            disabled={cdnUploading[item.id]}
                            className="w-full inline-flex items-center justify-center gap-1 rounded-lg border border-border hover:border-primary/30 hover:bg-primary/5 px-3 py-1.5 text-[11px] text-muted-foreground transition"
                          >
                            {cdnUploading[item.id] ? (
                              <><Loader2 className="h-3 w-3 animate-spin" /> Uploading...</>
                            ) : (
                              <>☁️ Upload to CDN</>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </Swipeable>
              )
            })}
          </div>
          </>
        )}
      </Section>

    </PageContent>
  )
}
