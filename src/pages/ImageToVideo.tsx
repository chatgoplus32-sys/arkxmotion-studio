import { useState, useRef, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Select, Label, Textarea, EmptyState, Badge } from '@/components/ui'
import { Image, Upload, Rocket, Loader2, Trash2, Zap, Key, ExternalLink, Download } from 'lucide-react'
import { useProviderManager, PROVIDER_CONFIGS, ProviderId } from '@/stores/providerManager'
import { useToastStore } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import { uploadToCatbox, submitGoogleOmni, submitRoboneoI2V, pollMotionControl, compressVideo, normalizeImage } from '@/lib/roboneo'
import { generateWithFramia } from '@/lib/framia'
import { runLeonardoVideo } from '@/lib/leonardo'
import { LEONARDO_VIDEO_MODELS, leonardoVideoQualityOptions } from '@/lib/leonardo-video'
import { submitWeavyVideo, pollWeavyStatus, checkWeavyBalance } from '@/lib/weavy'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import {
  getActiveTasks,
  addActiveTask,
  removeActiveTask,
  getLogs,
  addBgLog,
  startBackgroundPolling,
} from '@/lib/backgroundTasks'

interface ModelOption {
  value: string
  label: string
  cr: number
  provider: ProviderId
  apiModel?: string // model name for API
}

const PROVIDER_MODELS: Record<ProviderId, ModelOption[]> = {
  weavy: [
    { value: 'kling-2.1', label: 'Kling V2.1', cr: 30, provider: 'weavy' },
    { value: 'kling-1.6-standard', label: 'Kling V1.6 Standard', cr: 25, provider: 'weavy' },
    { value: 'kling-1.6-pro', label: 'Kling V1.6 Pro', cr: 40, provider: 'weavy' },
    { value: 'kling-3-pro', label: 'Kling V3 Pro', cr: 70, provider: 'weavy' },
    { value: 'sora-2', label: 'Sora 2', cr: 50, provider: 'weavy' },
    { value: 'veo-3', label: 'Veo 3 Fast', cr: 65, provider: 'weavy' },
    { value: 'veo-3.1', label: 'Veo 3.1', cr: 90, provider: 'weavy' },
    { value: 'seedance', label: 'Seedance V1 Pro', cr: 36, provider: 'weavy' },
    { value: 'seedance-2', label: 'Seedance 2.0', cr: 45, provider: 'weavy' },
    { value: 'wan-i2v', label: 'Wan 2.2 Turbo', cr: 20, provider: 'weavy' },
    { value: 'hailuo-02-pro', label: 'Hailuo 02 Pro', cr: 40, provider: 'weavy' },
  ],
  wavespeed: [
    { value: 'kling-2.1', label: 'Kling V2.1', cr: 26, provider: 'wavespeed' },
    { value: 'seedance', label: 'Seedance', cr: 30, provider: 'wavespeed' },
    { value: 'wan-i2v', label: 'Wan i2v', cr: 18, provider: 'wavespeed' },
  ],
  roboneo: [
    { value: 'rn:seedance-2.0', label: 'Seedance 2.0 (Roboneo)', cr: 143, provider: 'roboneo' },
    { value: 'rn:seedance-2.0-mini', label: 'Seedance 2.0 Mini (Roboneo)', cr: 140, provider: 'roboneo' },
    { value: 'rn:seedance-2.0-fast', label: 'Seedance 2.0 Fast (Roboneo)', cr: 90, provider: 'roboneo' },
    { value: 'rn:happyhorse-1.1', label: 'Happy Horse 1.1 (Roboneo)', cr: 144, provider: 'roboneo' },
    { value: 'rn:happyhorse-1.0', label: 'Happy Horse 1.0 (Roboneo)', cr: 120, provider: 'roboneo' },
    { value: 'rn:kling-v3', label: 'Kling 3.0 (Roboneo)', cr: 130, provider: 'roboneo' },
    { value: 'rn:kling-v3-turbo', label: 'Kling 3.0 Turbo (Roboneo)', cr: 90, provider: 'roboneo' },
    { value: 'rn:seedance-1.0', label: 'Seedance 1.0 / Pro (Roboneo)', cr: 100, provider: 'roboneo' },
    { value: 'rn:google-omni', label: 'Google Omni Flash (Roboneo)', cr: 45, provider: 'roboneo' },
    { value: 'rn:kling-v26:std', label: 'Kling 2.6 (Roboneo)', cr: 80, provider: 'roboneo' },
    { value: 'rn:seedance-pro', label: 'Seedance Pro — legacy alias (Roboneo)', cr: 100, provider: 'roboneo' },
  ],
  createpulse: [
    { value: 'cp:dreamina-seedance-2.0', label: 'Dreamina Seedance 2.0', cr: 22, provider: 'createpulse', apiModel: 'dreamina-seedance-2.0' },
    { value: 'cp:veo-omni-10s', label: 'Veo Omni 10s', cr: 33, provider: 'createpulse', apiModel: 'veo-omni-10s' },
  ],
  framia: [
    { value: 'framia:gemini-omni-flash', label: 'Gemini Omni Flash (Framia)', cr: 20, provider: 'framia' },
    { value: 'framia:seedance-2.0', label: 'Seedance 2.0 (Framia)', cr: 45, provider: 'framia' },
    { value: 'framia:seedance-2.0-fast', label: 'Seedance 2.0 Fast (Framia)', cr: 30, provider: 'framia' },
    { value: 'framia:kling-3.0-omni', label: 'Kling 3.0 Omni (Framia)', cr: 60, provider: 'framia' },
    { value: 'framia:kling-3.0', label: 'Kling 3.0 (Framia)', cr: 50, provider: 'framia' },
    { value: 'framia:veo-3.1', label: 'Veo 3.1 (Framia)', cr: 90, provider: 'framia' },
    { value: 'framia:veo-3.1-fast', label: 'Veo 3.1 Fast (Framia)', cr: 65, provider: 'framia' },
    { value: 'framia:wan-2.7', label: 'Wan 2.7 (Framia)', cr: 25, provider: 'framia' },
    { value: 'framia:happyhorse-1.1', label: 'HappyHorse 1.1 (Framia)', cr: 28, provider: 'framia' },
    { value: 'framia:kling-avatar', label: 'Kling Avatar (Framia)', cr: 40, provider: 'framia' },
  ],
  leonardo: LEONARDO_VIDEO_MODELS.map((m) => ({
    value: m.id,
    label: `${m.label} (Leonardo · ~${m.crPerSecond} cr/s)`,
    cr: m.crExamples[0]?.cr ?? Math.round(m.crPerSecond * 5),
    provider: 'leonardo' as ProviderId,
  })),
  elevenlabs: [],
  gemini: [],
  openai: [],
  shotstack: [],
  creatomate: [],
}

const QUALITY_OPTIONS: Record<ProviderId, Record<string, Array<{ value: string; label: string; mult: number; duration: number; cr?: number; resolution?: string; sound?: string; sizeTier?: string }>>> = {
  weavy: {
    default: [
      { value: 'std', label: 'Standard 5s', mult: 1, duration: 5 },
      { value: 'long', label: 'Long 10s', mult: 2, duration: 10 },
    ],
  },
  wavespeed: {
    default: [
      { value: 'std', label: 'Standard 5s', mult: 1, duration: 5 },
      { value: 'long', label: 'Long 10s', mult: 2, duration: 10 },
    ],
  },
  roboneo: {
    'rn:seedance-2.0': [
      { value: '480p-10s-audio', label: '480p · 10s · audio', mult: 1, duration: 10, resolution: '480p', sound: 'on', cr: 143 },
      { value: '480p-10s', label: '480p · 10s', mult: 1, duration: 10, resolution: '480p', sound: 'off', cr: 120 },
      { value: '480p-5s-audio', label: '480p · 5s · audio', mult: 1, duration: 5, resolution: '480p', sound: 'on', cr: 75 },
      { value: '480p-5s', label: '480p · 5s', mult: 1, duration: 5, resolution: '480p', sound: 'off', cr: 60 },
    ],
    'rn:seedance-2.0-mini': [
      { value: '480p-12s-audio', label: '480p · 12s · audio', mult: 1, duration: 12, resolution: '480p', sound: 'on', cr: 140 },
      { value: '480p-10s-audio', label: '480p · 10s · audio', mult: 1, duration: 10, resolution: '480p', sound: 'on', cr: 118 },
      { value: '480p-5s-audio', label: '480p · 5s · audio', mult: 1, duration: 5, resolution: '480p', sound: 'on', cr: 60 },
      { value: '480p-5s', label: '480p · 5s', mult: 1, duration: 5, resolution: '480p', sound: 'off', cr: 48 },
    ],
    'rn:seedance-2.0-fast': [
      { value: '480p-10s', label: '480p · 10s', mult: 1, duration: 10, resolution: '480p', sound: 'off', cr: 90 },
      { value: '480p-5s', label: '480p · 5s', mult: 1, duration: 5, resolution: '480p', sound: 'off', cr: 45 },
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', sound: 'off', cr: 65 },
    ],
    'rn:happyhorse-1.1': [
      { value: '720p-14s', label: '720p · 14s', mult: 1, duration: 14, resolution: '720p', cr: 144 },
      { value: '720p-10s', label: '720p · 10s', mult: 1, duration: 10, resolution: '720p', cr: 100 },
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 50 },
      { value: '480p-14s', label: '480p · 14s', mult: 1, duration: 14, resolution: '480p', cr: 100 },
    ],
    'rn:happyhorse-1.0': [
      { value: '720p-10s', label: '720p · 10s', mult: 1, duration: 10, resolution: '720p', cr: 120 },
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 60 },
    ],
    'rn:kling-v3': [
      { value: '10s-off', label: '10s · No Sound', mult: 1, duration: 10, sound: 'off', cr: 130 },
      { value: '5s-off', label: '5s · No Sound', mult: 1, duration: 5, sound: 'off', cr: 65 },
      { value: '5s-on', label: '5s · Sound', mult: 1, duration: 5, sound: 'on', cr: 85 },
    ],
    'rn:kling-v3-turbo': [
      { value: '10s-off', label: '10s · No Sound', mult: 1, duration: 10, sound: 'off', cr: 90 },
      { value: '5s-off', label: '5s · No Sound', mult: 1, duration: 5, sound: 'off', cr: 45 },
    ],
    'rn:seedance-1.0': [
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 50 },
      { value: '720p-10s', label: '720p · 10s', mult: 1, duration: 10, resolution: '720p', cr: 100 },
      { value: '720p-12s', label: '720p · 12s', mult: 1, duration: 12, resolution: '720p', cr: 120 },
      { value: '480p-5s', label: '480p · 5s', mult: 1, duration: 5, resolution: '480p', cr: 35 },
    ],
    'rn:seedance-pro': [
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 50 },
      { value: '720p-10s', label: '720p · 10s', mult: 1, duration: 10, resolution: '720p', cr: 100 },
      { value: '720p-12s', label: '720p · 12s', mult: 1, duration: 12, resolution: '720p', cr: 120 },
      { value: '480p-5s', label: '480p · 5s', mult: 1, duration: 5, resolution: '480p', cr: 35 },
    ],
    'rn:google-omni': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5, cr: 25 },
      { value: '10s', label: 'Durasi 10s', mult: 1, duration: 10, cr: 45 },
    ],
    'rn:kling-v26:std': [
      { value: '5s-off', label: '5s · No Sound', mult: 1, duration: 5, sound: 'off', cr: 40 },
      { value: '5s-on', label: '5s · Sound', mult: 1, duration: 5, sound: 'on', cr: 55 },
      { value: '10s-off', label: '10s · No Sound', mult: 1, duration: 10, sound: 'off', cr: 80 },
      { value: '10s-on', label: '10s · Sound', mult: 1, duration: 10, sound: 'on', cr: 105 },
    ],
    default: [
      { value: 'std', label: 'Standard 5s', mult: 1, duration: 5 },
    ],
  },
  createpulse: {
    'cp:veo-omni-10s': [
      { value: '10s', label: '10 detik', mult: 1, duration: 10 },
    ],
    default: [
      { value: '10s', label: '10 detik', mult: 1, duration: 10 },
      { value: '15s', label: '15 detik', mult: 1.5, duration: 15 },
    ],
  },
  framia: {
    'framia:gemini-omni-flash': [
      { value: '720p-10s', label: '720p · 10s', mult: 2, duration: 10, resolution: '720p', cr: 45 },
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 25 },
    ],
    'framia:seedance-2.0': [
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 25 },
      { value: '720p-10s', label: '720p · 10s', mult: 2, duration: 10, resolution: '720p', cr: 45 },
    ],
    'framia:seedance-2.0-fast': [
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 15 },
      { value: '720p-10s', label: '720p · 10s', mult: 2, duration: 10, resolution: '720p', cr: 25 },
    ],
    'framia:kling-3.0-omni': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5, cr: 40 },
      { value: '10s', label: 'Durasi 10s', mult: 2, duration: 10, cr: 80 },
    ],
    'framia:kling-3.0': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5, cr: 30 },
      { value: '10s', label: 'Durasi 10s', mult: 2, duration: 10, cr: 60 },
    ],
    'framia:veo-3.1': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5, cr: 90 },
      { value: '10s', label: 'Durasi 10s', mult: 2, duration: 10, cr: 180 },
    ],
    'framia:veo-3.1-fast': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5, cr: 65 },
      { value: '10s', label: 'Durasi 10s', mult: 2, duration: 10, cr: 130 },
    ],
    'framia:wan-2.7': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5, cr: 20 },
      { value: '10s', label: 'Durasi 10s', mult: 2, duration: 10, cr: 40 },
    ],
    'framia:happyhorse-1.1': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5, cr: 28 },
      { value: '10s', label: 'Durasi 10s', mult: 2, duration: 10, cr: 56 },
    ],
    'framia:kling-avatar': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5, cr: 40 },
      { value: '10s', label: 'Durasi 10s', mult: 2, duration: 10, cr: 80 },
    ],
    default: [
      { value: 'std', label: 'Standard', mult: 1, duration: 10, cr: 45 },
      { value: 'long', label: 'Long 15s', mult: 1.5, duration: 15, cr: 68 },
    ],
  },
  leonardo: {},
  elevenlabs: { default: [] },
  gemini: { default: [] },
  openai: { default: [] },
  shotstack: { default: [] },
  creatomate: { default: [] },
}

const RATIOS = ['16:9', '9:16', '1:1', '4:5', '3:4']

const TEMPLATES = [
  { name: 'Cinematic Slow Pan', body: 'Cinematic slow camera pan, natural lighting, subtle wind on hair, subject stays centered' },
  { name: 'Dolly Zoom', body: 'Slow dolly zoom in, subject sharp, background bokeh, moody' },
  { name: 'Gentle Parallax', body: 'Gentle parallax movement, soft bokeh background, subject in focus' },
  { name: 'Dynamic Action', body: 'Dynamic camera movement, fast paced, energetic motion' },
]

const CREATEPULSE_API = '/api/public/createpulse'

export default function ImageToVideoPage() {
  const { keys, routing, getActiveKey } = useProviderManager()
  const addToast = useToastStore((s) => s.addToast)
  const { token: authToken, user } = useAuthStore()
  const [cpBalance, setCpBalance] = useState(0)

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
  const [status, setStatus] = useState({ show: false, text: '', pct: 0, time: '' })
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

  useEffect(() => {
    localStorage.setItem('createpulse.results', JSON.stringify(results))
  }, [results])

  useEffect(() => {
    startBackgroundPolling()

    const sync = () => {
      setLogs(getLogs())
    }

    window.addEventListener('arkxmotion-tasks-changed', sync)
    return () => window.removeEventListener('arkxmotion-tasks-changed', sync)
  }, [])

  const handleDownload = useCallback(async (url: string, index: number) => {
    try {
      const proxyUrl = `/api/public/createpulse?action=download&url=${encodeURIComponent(url)}`
      const res = await fetch(proxyUrl)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `createpulse-${Date.now()}-${index}.mp4`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch {
      window.open(url, '_blank')
    }
  }, [])

  const models = PROVIDER_MODELS[provider] || []
  const currentModel = models.find((m) => m.value === model) || models[0]

  const providerQualities = QUALITY_OPTIONS[provider] || QUALITY_OPTIONS.weavy
  const leonardoDynamicOptions = provider === 'leonardo' && model ? leonardoVideoQualityOptions(model, ratio) : []
  const qualityOptions = provider === 'leonardo'
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
  const currentQuality = qualityOptions.find((q) => q.value === quality) || qualityOptions[0]

  const totalCredits = currentModel ? (currentQuality?.cr ?? Math.round(currentModel.cr * (currentQuality?.mult || 1))) : 0

  const providerKeyCount = keys[provider]?.length || 0
  const hasActiveKey = keys[provider]?.some((k) => k.status === 'active' || k.status === 'unknown') || false

  useEffect(() => {
    if (models.length > 0 && !models.find((m) => m.value === model)) {
      setModel(models[0].value)
    }
  }, [provider, models])

  useEffect(() => {
    if (qualityOptions.length > 0 && !qualityOptions.find((q) => q.value === quality)) {
      setQuality(qualityOptions[0].value)
    }
  }, [model, qualityOptions])

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

  const generateWithCreatePulse = async (apiKey: string) => {
    const duration = currentQuality?.duration || 10
    const cost = 1500
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
          } catch {}
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
          } catch {}
        }
      }
      throw err
    }
  }

  const validateGenerate = (): string | null => {
    if (!prompt.trim()) return 'Prompt harus diisi'
    if (!hasActiveKey && provider !== 'roboneo' && provider !== 'createpulse') return `Tidak ada API key aktif untuk ${PROVIDER_CONFIGS[provider].name}`
    if (provider === 'createpulse' && user?.role !== 'admin' && cpBalance < 1500) return 'Saldo CreatePulse tidak cukup. Top up minimal Rp 10.000'
    if (provider === 'roboneo' && !imgFile) return 'Roboneo membutuhkan gambar input'
    return null
  }

  const handleGenerate = async () => {
    const validationError = validateGenerate()
    if (validationError) {
      addToast(validationError, 'error')
      return
    }

    setGenerating(true)
    successRef.current = false
    generatingRef.current = true
    setLogs([])
    setStatus({ show: true, text: 'Validasi...', pct: 2, time: '' })

    addLog(`🚀 Mulai generate video`, 'info', provider)
    addLog(`   Provider: ${PROVIDER_CONFIGS[provider].name}`, 'debug', provider)
    addLog(`   Model: ${currentModel?.label || model}`, 'debug', provider)
    addLog(`   Rasio: ${ratio} | Durasi: ${currentQuality?.duration || 5}s`, 'debug', provider)
    addLog(`   Prompt: "${prompt.trim().slice(0, 80)}${prompt.trim().length > 80 ? '...' : ''}"`, 'debug', provider)

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
          successRef.current = true
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
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

        addLog(`[1/3] 🖼️ Normalizing image...`, 'info', 'roboneo')
        setStatus((s) => ({ ...s, text: 'Normalize & upload image...', pct: 10 }))
        const normalizedFile = await normalizeImage(imgFile)
        addLog(`[1/3] 📤 Uploading image...`, 'info', 'roboneo')
        const imageUrl = await uploadToCatbox(normalizedFile)
        addLog(`[1/3] ✅ Image uploaded ✓`, 'success', 'roboneo')

        const rotation = await withTokenRotation<{ videoUrl: string; taskId: string; roomId: string }>(
          'roboneo',
          async (apiKey, keyInfo) => {
            const tokenIdx = keys.roboneo?.findIndex(k => k.key === apiKey) ?? 0
            const totalTokens = keys.roboneo?.length || 0
            addLog(`🔑 Trying key: ${keyInfo.name || keyInfo.id} (${tokenIdx + 1}/${totalTokens})`, 'info', 'roboneo')
            setStatus((s) => ({ ...s, text: `Submit Roboneo ${model} (token ${tokenIdx + 1}/${totalTokens})...`, pct: 15 }))

            const resolution = currentQuality?.resolution || quality?.match(/(\d+p)/)?.[1]
            const soundEnabled = currentQuality?.sound || (quality?.includes('on') || quality?.includes('audio') ? 'on' : 'off')
            const videoDuration = currentQuality?.duration || 10

            addLog(`[2/3] 🚀 Submitting to Roboneo ${model}...`, 'info', 'roboneo')
            addLog(`   → resolution: ${resolution || 'default'}`, 'debug', 'roboneo')
            addLog(`   → sound: ${soundEnabled} | duration: ${videoDuration}s`, 'debug', 'roboneo')
            const { taskId, roomId, nodeId } = await submitRoboneoI2V({
              accessToken: apiKey,
              imageUrl,
              prompt: prompt.trim() || undefined,
              modelKey: model,
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
            const videoUrl = await pollMotionControl(
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
          successRef.current = true
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
          if (rotation.triedKeys > 1) {
            addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success', 'framia')
          }
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      } else if (provider === 'firefly') {
        addLog(`[1/2] 🔥 Preparing image for Firefly...`, 'info', 'firefly')
        setStatus((s) => ({ ...s, text: 'Preparing...', pct: 5 }))
        let imageUrl: string | undefined
        if (imgFile) {
          imageUrl = await uploadToCatbox(imgFile)
          addLog(`[1/2] ✅ Image uploaded ✓`, 'success', 'firefly')
        } else {
          addLog(`[1/2] ℹ️ No image (text-to-video mode)`, 'info', 'firefly')
        }

        const rotation = await withTokenRotation<string>(
          'firefly',
          async (apiKey, keyInfo) => {
            addLog(`🔑 Trying key: ${keyInfo.name || keyInfo.id}`, 'info', 'firefly')
            setStatus((s) => ({ ...s, text: `Submit Firefly ${model}...`, pct: 15 }))

            addLog(`[2/2] 🚀 Submitting to Firefly...`, 'info', 'firefly')
            addLog(`   → model: ${model}`, 'debug', 'firefly')
            addLog(`   → ratio: ${ratio} | duration: ${currentQuality?.duration || 5}s`, 'debug', 'firefly')

            const submitRes = await fetch('/api/public/firefly', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Firefly-Token': apiKey,
                'X-Firefly-Api-Key': 'SunbreakWebUI1',
              },
              body: JSON.stringify({
                url: 'https://firefly-3p.ff.adobe.io/v2/3p-videos/generate-async',
                method: 'POST',
                body: {
                  modelId: model.includes('veo') ? 'veo' : 'firefly',
                  modelVersion: model.includes('3.1-fast') ? '3.1-fast-generate' : model.includes('3.1') ? '3.1-generate' : 'video-1',
                  size: ratio === '9:16' ? { width: 720, height: 1280 } : ratio === '1:1' ? { width: 1024, height: 1024 } : { width: 1280, height: 720 },
                  prompt: prompt.trim(),
                  duration: currentQuality?.duration || 5,
                  generateAudio: false,
                },
              }),
            })

            if (!submitRes.ok) {
              const err = await submitRes.json().catch(() => ({}))
              addLog(`[2/2] ❌ Submit failed: HTTP ${submitRes.status}`, 'error', 'firefly')
              throw new Error(err.error || `HTTP ${submitRes.status}`)
            }

            const submitData = await submitRes.json()
            const statusUrl = submitData.data?.statusUrl || submitData.data?._links?.self?.href
            if (!statusUrl) throw new Error('Firefly: statusUrl not found')

            addLog(`[2/2] ✅ Job submitted ✓`, 'success', 'firefly')
            setStatus((s) => ({ ...s, text: 'Processing...', pct: 40 }))

            addLog(`⏳ Polling for result...`, 'info', 'firefly')
            const maxPolls = 225
            for (let i = 0; i < maxPolls; i++) {
              await new Promise((r) => setTimeout(r, 4000))
              const pollRes = await fetch('/api/public/firefly', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Firefly-Token': apiKey,
                  'X-Firefly-Api-Key': 'SunbreakWebUI1',
                },
                body: JSON.stringify({ url: statusUrl, method: 'GET' }),
              })
              if (!pollRes.ok) continue
              const pollData = await pollRes.json()
              const status = (pollData.data?.status || '').toLowerCase()
              const pct = Math.min(95, 40 + (i / maxPolls) * 55)
              addLog(`Poll #${i + 1}: ${status || 'processing'}`, 'debug', 'firefly')
              setStatus((s) => ({ ...s, text: `Firefly ${status}...`, pct }))

              if (['succeeded', 'success', 'completed', 'done'].includes(status)) {
                const outputs = pollData.data?.result?.outputs || pollData.data?.outputs || []
                const videoUrl = outputs.find((o: any) => o?.video?.url || o?.url)?.video?.url || outputs[0]?.url
                if (!videoUrl) throw new Error('Firefly: output URL not found')
                addLog(`✅ Done ✓`, 'success', 'firefly')
                return videoUrl
              }
              if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
                throw new Error(pollData.data?.error?.message || 'Firefly: job failed')
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
          successRef.current = true
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
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
          successRef.current = true
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
          if (rotation.triedKeys > 1) {
            addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success', 'leonardo')
          }
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      } else if (provider === 'weavy') {
        addLog(`[1/3] 🖼️ Preparing image...`, 'info', 'weavy')
        let imageUrl: string | undefined
        if (imgFile) {
          imageUrl = await uploadToCatbox(imgFile)
          addLog(`[1/3] ✅ Image uploaded ✓`, 'success', 'weavy')
        } else {
          addLog(`[1/3] ℹ️ No image (text-to-video mode)`, 'info', 'weavy')
        }

        const rotation = await withTokenRotation<string>(
          'weavy',
          async (apiKey, keyInfo) => {
            addLog(`🔑 Trying key: ${keyInfo.name || keyInfo.id}`, 'info', 'weavy')
            setStatus((s) => ({ ...s, text: `Submit Weavy ${model}...`, pct: 15 }))

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
          successRef.current = true
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
          if (rotation.triedKeys > 1) {
            addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success', 'weavy')
          }
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
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai' }))
          addLog(`✅ Video selesai ✓`, 'success', provider)
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      }
    } catch (err: any) {
      if (activeTaskId) removeActiveTask(activeTaskId)
      addLog(`❌ Error: ${err.message}`, 'error', provider)
      addToast(`Generate gagal: ${err.message}`, 'error')
      if (['roboneo', 'framia', 'createpulse'].includes(provider)) {
        addLog('⚠️ Credit mungkin sudah terpotong oleh server provider. Hubungi provider untuk refund jika gagal.', 'warn', provider)
      }
      setStatus((s) => ({ ...s, pct: 100, text: `❌ Error: ${err.message}` }))
    } finally {
      clearInterval(timer)
      const wasGenerating = generatingRef.current
      setGenerating(false)
      generatingRef.current = false
      if (wasGenerating && successRef.current) {
        addToast(`Generate selesai: ${PROVIDER_CONFIGS[provider].icon} ${model}`, 'success')
      }
      setTimeout(() => setStatus((s) => ({ ...s, show: false })), 3000)
    }
  }

  const PROVIDER_IDS: ProviderId[] = ['weavy', 'wavespeed', 'roboneo', 'createpulse', 'framia', 'leonardo']

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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {PROVIDER_IDS.map((pid) => {
            const config = PROVIDER_CONFIGS[pid]
            const providerModels = PROVIDER_MODELS[pid] || []
            const keyCount = keys[pid]?.length || 0
            const isActive = provider === pid

            return (
              <button
                key={pid}
                onClick={() => setProvider(pid)}
                className={`p-3 rounded-xl border-2 transition-all text-left ${
                  isActive
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border hover:border-primary/30 bg-card/30'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{config.icon}</span>
                  <span className="text-sm font-medium">{config.name}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {providerModels.length} models · {keyCount} keys
                </div>
                {isActive && (
                  <Badge variant="default" className="mt-2 text-[10px]">
                    Active
                  </Badge>
                )}
              </button>
            )
          })}
        </div>

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
            Status: <b className={provider === 'createpulse' || hasActiveKey ? 'text-emerald-500' : 'text-amber-500'}>{provider === 'createpulse' || hasActiveKey ? 'Ready' : 'No Key'}</b>
          </div>
        </div>

        {/* CreatePulse Pricing Info */}
        {provider === 'createpulse' && (
          <div className="mt-3 p-3 rounded-xl border border-primary/20 bg-primary/5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-primary">💜 CreatePulse {user?.role === 'admin' && '(Admin — Free)'}</div>
              {user?.role !== 'admin' && (
                <div className="text-xs">
                  Saldo: <b className={`font-bold ${cpBalance >= 1500 ? 'text-emerald-500' : 'text-destructive'}`}>
                    Rp {cpBalance.toLocaleString('id-ID')}
                  </b>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <div>Dreamina Seedance 2.0: <b className="text-foreground">{user?.role === 'admin' ? 'GRATIS' : 'Rp 1.500'}</b> / generate</div>
              <div>Veo Omni 10s: <b className="text-foreground">{user?.role === 'admin' ? 'GRATIS' : 'Rp 1.500'}</b> / generate</div>
              <div>Durasi: <b className="text-foreground">10s / 15s</b></div>
              {user?.role !== 'admin' && <div>Failed generations: <b className="text-emerald-500">auto-refunded</b></div>}
            </div>
            {user?.role !== 'admin' && cpBalance < 1500 && (
              <div className="mt-2 text-[11px]">
                <a href="/topup/createpulse" className="text-primary hover:underline font-medium">
                  Top Up Saldo →
                </a>
              </div>
            )}
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {provider === 'createpulse' ? (
              /* CreatePulse: Frames & References */
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
              <Section title="🖼️ Gambar Input" sub="1 file (JPG / PNG / WEBP) — optional untuk text-to-video">
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
                    <Label>Aspek Rasio</Label>
                    <Select
                      value={ratio}
                      onChange={(e) => setRatio(e.target.value)}
                      options={RATIOS.map((r) => ({ value: r, label: r }))}
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
                onClick={handleGenerate}
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
                Est. Cost: <b className="text-foreground font-mono">{provider === 'createpulse' ? 'Rp 1.500' : `${totalCredits} credits`}</b>
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
          </Section>
        </div>
      </div>

      {/* Logs */}
      {logs.length > 0 && (
        <Section
          title={`📋 Log (${logs.length})`}
          right={
            <button
              onClick={() => { setLogs([]); }}
              className="text-[11px] text-destructive hover:text-destructive/80 transition"
            >
              Clear
            </button>
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
                    ? 'text-amber-400'
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

      {/* Results */}
      <Section
        title={`🎬 Hasil Image To Video (${results.length})`}
        right={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setResults([])
              localStorage.removeItem('createpulse.results')
            }}
            disabled={results.length === 0}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        }
      >
            {results.length === 0 ? (
          <EmptyState
            icon={<Image className="h-8 w-8" />}
            title="Belum ada video"
            description="Generate video dari gambar atau text prompt"
          />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {results.map((url, index) => {
              const needsProxy = /meitudata\.com|localhost/i.test(url)
              const displayUrl = needsProxy ? `/api/public/video-proxy?url=${encodeURIComponent(url)}` : url
              return (
              <div key={index} className="rounded-xl overflow-hidden border border-border bg-black/40">
                <video
                  src={displayUrl}
                  controls
                  playsInline
                  preload="metadata"
                  onError={(e) => {
                    const target = e.target as HTMLVideoElement
                    target.poster = ''
                  }}
                  className="w-full aspect-[9/16] object-cover bg-black"
                />
                <div className="p-2 flex flex-col gap-1.5">
                    <div className="flex items-center gap-1">
                      <a href={displayUrl} target="_blank" rel="noreferrer" className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition">
                        <ExternalLink className="h-3.5 w-3.5" /> Buka
                      </a>
                      <button
                        onClick={() => handleDownload(url, index)}
                        className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-500 transition"
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </button>
                    </div>
                    <button
                      onClick={() => setResults(results.filter((_, i) => i !== index))}
                      className="w-full inline-flex items-center justify-center gap-1 rounded-lg border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive transition"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Hapus
                    </button>
                  </div>
              </div>
              )
            })}
          </div>
        )}
      </Section>
    </PageContent>
  )
}
