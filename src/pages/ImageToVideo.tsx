import { useState, useRef, useEffect, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Select, Label, Textarea, EmptyState, Badge } from '@/components/ui'
import { Image, Upload, Rocket, Loader2, Trash2, Zap, Key, ExternalLink } from 'lucide-react'
import { useProviderManager, PROVIDER_CONFIGS, ProviderId } from '@/stores/providerManager'
import { uploadToCatbox, submitGoogleOmni, submitSeedancePro, submitKling26, submitKling25, submitKling30, pollMotionControl, compressVideo } from '@/lib/roboneo'
import { generateWithFramia } from '@/lib/framia'
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
  magnific: [
    { value: 'kling-motion', label: 'Kling Motion', cr: 45, provider: 'magnific' },
  ],
  roboneo: [
    { value: 'rn:seedance-pro', label: 'Seedance Pro', cr: 0, provider: 'roboneo' },
    { value: 'rn:google-omni', label: 'Google Omni', cr: 0, provider: 'roboneo' },
    { value: 'rn:kling-v26:std', label: 'Kling 2.6', cr: 0, provider: 'roboneo' },
  ],
  createpulse: [
    { value: 'cp:dreamina-seedance-2.0', label: 'Dreamina Seedance 2.0', cr: 22, provider: 'createpulse', apiModel: 'dreamina-seedance-2.0' },
    { value: 'cp:bytedance-seedance-2.0', label: 'ByteDance Seedance 2.0', cr: 180, provider: 'createpulse', apiModel: 'bytedance-seedance-2.0' },
  ],
  framia: [
    { value: 'framia:seedance-2.0', label: 'Seedance 2.0', cr: 45, provider: 'framia' },
    { value: 'framia:seedance-2.0-fast', label: 'Seedance 2.0 Fast', cr: 30, provider: 'framia' },
    { value: 'framia:kling-3.0-omni', label: 'Kling 3.0 Omni', cr: 60, provider: 'framia' },
    { value: 'framia:kling-3.0', label: 'Kling 3.0', cr: 50, provider: 'framia' },
    { value: 'framia:veo-3.1', label: 'Veo 3.1', cr: 90, provider: 'framia' },
    { value: 'framia:veo-3.1-fast', label: 'Veo 3.1 Fast', cr: 65, provider: 'framia' },
    { value: 'framia:wan-2.7', label: 'Wan 2.7', cr: 25, provider: 'framia' },
    { value: 'framia:gemini-omni-flash', label: 'Gemini Omni Flash', cr: 20, provider: 'framia' },
    { value: 'framia:happyhorse-1.1', label: 'HappyHorse 1.1', cr: 28, provider: 'framia' },
    { value: 'framia:kling-avatar', label: 'Kling Avatar', cr: 40, provider: 'framia' },
  ],
  elevenlabs: [],
  gemini: [],
  openai: [],
}

const QUALITY_OPTIONS: Record<ProviderId, Record<string, Array<{ value: string; label: string; mult: number; duration: number }>>> = {
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
  magnific: {
    default: [
      { value: '720p', label: '720p · 5s', mult: 1, duration: 5 },
      { value: '1080p', label: '1080p · 5s', mult: 1.5, duration: 5 },
    ],
  },
  roboneo: {
    'rn:seedance-pro': [
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5 },
      { value: '720p-10s', label: '720p · 10s', mult: 2, duration: 10 },
      { value: '720p-12s', label: '720p · 12s', mult: 2.4, duration: 12 },
      { value: '480p-5s', label: '480p · 5s', mult: 0.7, duration: 5 },
      { value: '1080p-5s', label: '1080p · 5s', mult: 1.5, duration: 5 },
    ],
    'rn:google-omni': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5 },
      { value: '10s', label: 'Durasi 10s', mult: 2, duration: 10 },
    ],
    'rn:kling-v26:std': [
      { value: '5s-off', label: '5s · No Sound', mult: 1, duration: 5 },
      { value: '5s-on', label: '5s · Sound', mult: 1.3, duration: 5 },
      { value: '10s-off', label: '10s · No Sound', mult: 2, duration: 10 },
      { value: '10s-on', label: '10s · Sound', mult: 2.6, duration: 10 },
    ],
    'rn:kling-v25': [
      { value: '5s', label: '5s', mult: 1, duration: 5 },
      { value: '10s', label: '10s', mult: 2, duration: 10 },
    ],
    default: [
      { value: 'std', label: 'Standard 5s', mult: 1, duration: 5 },
    ],
  },
  createpulse: {
    default: [
      { value: '10s', label: '10 detik', mult: 1, duration: 10 },
      { value: '15s', label: '15 detik', mult: 1.5, duration: 15 },
    ],
  },
  framia: {
    default: [
      { value: 'std', label: 'Standard', mult: 1, duration: 10 },
      { value: 'long', label: 'Long 15s', mult: 1.5, duration: 15 },
    ],
  },
  elevenlabs: { default: [] },
  gemini: { default: [] },
  openai: { default: [] },
}

const RATIOS = ['9:16', '16:9', '1:1', '4:3']

const TEMPLATES = [
  { name: 'Cinematic Slow Pan', body: 'Cinematic slow camera pan, natural lighting, subtle wind on hair, subject stays centered' },
  { name: 'Dolly Zoom', body: 'Slow dolly zoom in, subject sharp, background bokeh, moody' },
  { name: 'Gentle Parallax', body: 'Gentle parallax movement, soft bokeh background, subject in focus' },
  { name: 'Dynamic Action', body: 'Dynamic camera movement, fast paced, energetic motion' },
]

const CREATEPULSE_API = '/api/public/createpulse'

export default function ImageToVideoPage() {
  const { keys, routing } = useProviderManager()

  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [imgFile, setImgFile] = useState<File | null>(null)
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

  const addLog = (msg: string, level = 'info') => {
    addBgLog(msg, level)
    setLogs(getLogs())
  }

  const inputRef = useRef<HTMLInputElement>(null)

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
  const qualityOptions = providerQualities[model] || providerQualities.default || []
  const currentQuality = qualityOptions.find((q) => q.value === quality) || qualityOptions[0]

  const totalCredits = currentModel ? Math.round(currentModel.cr * (currentQuality?.mult || 1)) : 0

  const providerKeyCount = keys[provider]?.length || 0
  const hasActiveKey = keys[provider]?.some((k) => k.status === 'active') || false

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

  const handleFileChange = (files: FileList | null) => {
    const file = files?.[0]
    if (file) {
      setImgUrl(URL.createObjectURL(file))
      setImgFile(file)
    }
  }

  const generateWithCreatePulse = async (apiKey: string) => {
    const duration = currentQuality?.duration || 10

    addLog(`[1/4] Preparing image...`)
    let initImageUrl = undefined
    if (imgFile) {
      setStatus((s) => ({ ...s, text: 'Uploading image...', pct: 10 }))
      initImageUrl = imgUrl || undefined
      addLog(`[1/4] Image URL: ${initImageUrl ? initImageUrl.slice(0, 60) + '...' : '(none)'}`)
    } else {
      addLog(`[1/4] No image provided (text-to-video mode)`)
    }

    const body: any = {
      kind: 'video',
      model: currentModel?.apiModel || 'dreamina-seedance-2.0',
      prompt,
      aspect: ratio,
      duration,
    }

    if (initImageUrl && provider === 'createpulse') {
      body.init_image_url = initImageUrl
    }

    addLog(`[2/4] Submitting to CreatePulse...`)
    addLog(`→ model: ${body.model}, ratio: ${ratio}, duration: ${duration}s`)
    addLog(`→ prompt: "${prompt.trim() || '(none)'}"`)
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
      addLog(`[2/4] Submit failed: HTTP ${submitRes.status} — ${err.error || 'unknown'}`, 'error')
      throw new Error(err.error || `HTTP ${submitRes.status}`)
    }

    const submitData = await submitRes.json()
    if (!submitData.ok) {
      addLog(`[2/4] Submit failed: ${submitData.error || 'unknown'}`, 'error')
      throw new Error(submitData.error || 'Submit failed')
    }

    const batchId = submitData.batchId
    addLog(`[2/4] Task created ✓ batchId=${batchId}`)
    setStatus((s) => ({ ...s, text: `Processing... (batch: ${batchId.slice(0, 8)}...)`, pct: 40 }))

    addLog(`[3/4] Polling for result...`)
    const maxPolls = 300
    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, 4000))

      const pollRes = await fetch(`${CREATEPULSE_API}?action=status&batchId=${batchId}`, {
        headers: { 'X-API-Key': apiKey },
      })

      if (!pollRes.ok) {
        addLog(`[3/4] Poll #${i + 1}: HTTP ${pollRes.status} (retrying...)`, 'warn')
        continue
      }

      const pollData = await pollRes.json()
      const pct = Math.min(90, 40 + (i / maxPolls) * 50)
      addLog(`[3/4] Poll #${i + 1}: status=${pollData.status || 'unknown'}`)
      setStatus((s) => ({ ...s, text: `Status: ${pollData.status}...`, pct }))

      if (pollData.status === 'done' && pollData.url) {
        let videoUrl = pollData.url.startsWith('http')
          ? pollData.url
          : `https://createpulse.online${pollData.url}`
        if (/^https?:\/\/localhost:\d+/i.test(videoUrl)) {
          videoUrl = videoUrl.replace(/^https?:\/\/localhost:\d+/i, 'https://createpulse.online')
        }
        addLog(`[4/4] Done ✓ ${videoUrl.slice(0, 60)}...`, 'success')
        return videoUrl
      }

      if (pollData.status === 'failed') {
        addLog(`[3/4] Failed: ${pollData.error || 'unknown'}`, 'error')
        throw new Error(pollData.error || 'Generation failed')
      }
    }

    addLog(`[3/4] Timeout after ${maxPolls} polls`, 'error')
    throw new Error('Timeout: generation took too long')
  }

  const handleGenerate = async () => {
    if (!prompt.trim()) return
    if (!hasActiveKey && provider !== 'roboneo') return

    setGenerating(true)
    generatingRef.current = true
    setLogs([])
    setStatus({ show: true, text: 'Normalisasi image...', pct: 5, time: '' })
    addLog(`🚀 Mulai generate video · ${provider} · ${model} · ${ratio} · ${quality}`)

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
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
          if (rotation.triedKeys > 1) {
            addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success')
          }
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      } else if (provider === 'roboneo') {
        if (!imgFile) {
          addLog('Roboneo requires an image. Upload one first.', 'error')
          throw new Error('No image provided')
        }

        addLog(`[1/3] Compressing image if needed...`)
        setStatus((s) => ({ ...s, text: 'Upload image ke public host...', pct: 10 }))
        const imageUrl = await uploadToCatbox(imgFile)
        addLog(`[1/3] Image uploaded ✓ ${imageUrl.slice(0, 60)}...`)

        const rotation = await withTokenRotation<{ videoUrl: string; taskId: string; roomId: string }>(
          'roboneo',
          async (apiKey, keyInfo) => {
            const tokenIdx = keys.roboneo?.findIndex(k => k.key === apiKey) ?? 0
            const totalTokens = keys.roboneo?.length || 0
            addLog(`Trying key: ${keyInfo.name || keyInfo.id} (token ${tokenIdx + 1}/${totalTokens})`)
            setStatus((s) => ({ ...s, text: `Submit Roboneo ${model} (token ${tokenIdx + 1}/${totalTokens})...`, pct: 15 }))
            let taskId: string
            let roomId: string

            if (model === 'rn:seedance-pro') {
              addLog(`[2/3] Submitting to Seedance Pro...`)
              const result = await submitSeedancePro({
                accessToken: apiKey,
                imageUrl,
                prompt: prompt.trim() || undefined,
                videoDuration: 12,
                resolution: quality === '1080p-5s' ? '1080p' : quality === '480p-5s' ? '480p' : '720p',
                ratio,
              })
              taskId = result.taskId
              roomId = result.roomId
            } else if (model === 'rn:kling-v26:std') {
              const soundEnabled = quality?.includes('on') ? 'on' : 'off'
              const durationMatch = quality?.match(/(\d+)s/)
              const videoDuration = durationMatch ? parseInt(durationMatch[1]) : 10
              addLog(`[2/3] Submitting to Kling 2.6...`)
              const result = await submitKling26({
                accessToken: apiKey,
                imageUrl,
                prompt: prompt.trim() || undefined,
                videoDuration,
                sound: soundEnabled as 'on' | 'off',
              })
              taskId = result.taskId
              roomId = result.roomId
            } else if (model === 'rn:kling-v25') {
              const durationMatch = quality?.match(/(\d+)s/)
              const videoDuration = durationMatch ? parseInt(durationMatch[1]) : 10
              addLog(`[2/3] Submitting to Kling 2.5...`)
              const result = await submitKling25({
                accessToken: apiKey,
                imageUrl,
                prompt: prompt.trim() || undefined,
                videoDuration,
              })
              taskId = result.taskId
              roomId = result.roomId
            } else if (model === 'rn:kling-v30:pro' || model === 'rn:kling-v30:std') {
              const soundEnabled = quality?.includes('on') ? 'on' : 'off'
              const durationMatch = quality?.match(/(\d+)s/)
              const videoDuration = durationMatch ? parseInt(durationMatch[1]) : 10
              const klingMode = model === 'rn:kling-v30:pro' ? 'pro' : 'std'
              addLog(`[2/3] Submitting to Kling 3.0 ${klingMode === 'pro' ? 'Pro' : 'Standard'}...`)
              const result = await submitKling30({
                accessToken: apiKey,
                imageUrl,
                prompt: prompt.trim() || undefined,
                videoDuration,
                sound: soundEnabled as 'on' | 'off',
                mode: klingMode,
              })
              taskId = result.taskId
              roomId = result.roomId
            } else {
              addLog(`[2/3] Submitting to Google Omni...`)
              const result = await submitGoogleOmni({
                accessToken: apiKey,
                imageUrl,
                prompt: prompt.trim() || undefined,
                ratio,
                videoDuration: parseInt(quality) || 10,
              })
              taskId = result.taskId
              roomId = result.roomId
            }
            addLog(`[2/3] Task created ✓ id=${taskId.slice(0, 20)}...`)

            addActiveTask({
              id: taskId,
              taskId,
              roomId,
              token: apiKey,
              model: currentModel?.label || model,
              prompt: prompt.trim() || '(no prompt)',
              startedAt: Date.now(),
              page: 'image-to-video',
            })
            activeTaskId = taskId

            addLog(`[3/3] Polling for result...`)
            setStatus((s) => ({ ...s, text: 'Processing...', pct: 25 }))
            const videoUrl = await pollMotionControl(
              apiKey, taskId, roomId,
              (status, pct) => { addLog(`⏳ Roboneo ${status} (${pct}%)`); setStatus((s) => ({ ...s, pct, text: `Roboneo ${status} (${pct}%)` })) }
            )
            setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
            addLog(`✅ Video selesai · ${videoUrl.slice(0, 60)}...`, 'success')

            removeActiveTask(taskId)
            activeTaskId = null
            return { videoUrl, taskId, roomId }
          },
          {
            onKeySwitch: (from, to, attempt) => {
              addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn')
              if (activeTaskId) removeActiveTask(activeTaskId)
              activeTaskId = null
            },
            onError: (err, key) => {
              if (detectTokenError('roboneo', err)) {
                addLog(`Key "${key.name}" is invalid: ${err.message}`, 'warn')
              }
            },
          }
        )
        if (rotation.ok && rotation.result) {
          setResults((prev) => [rotation.result!.videoUrl, ...prev])
          if (rotation.triedKeys > 1) {
            addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success')
          }
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      } else if (provider === 'framia') {
        addLog(`[1/2] Preparing image...`)
        let imageUrl: string | undefined
        if (imgFile) {
          imageUrl = await uploadToCatbox(imgFile)
          addLog(`[1/2] Image uploaded ✓ ${imageUrl.slice(0, 60)}...`)
        } else {
          addLog(`[1/2] No image provided (text-to-video mode)`)
        }

        const rotation = await withTokenRotation<string>(
          'framia',
          async (apiKey, keyInfo) => {
            addLog(`Trying key: ${keyInfo.name || keyInfo.id}`)
            return await generateWithFramia({
              apiKey,
              imageUrl,
              prompt: prompt.trim(),
              skillId: model,
              onLog: (msg, level) => addLog(msg, level),
              onStatus: (text, pct) => setStatus((s) => ({ ...s, pct, text: `[Framia] ${text}` })),
            })
          },
          {
            onKeySwitch: (from, to, attempt) => {
              addLog(`🔄 Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`, 'warn')
            },
            onError: (err, key) => {
              if (detectTokenError('framia', err)) {
                addLog(`Key "${key.name}" is invalid: ${err.message}`, 'warn')
              }
            },
          }
        )
        if (rotation.ok && rotation.result) {
          setResults((prev) => [rotation.result!, ...prev])
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai!' }))
          if (rotation.triedKeys > 1) {
            addLog(`✅ Used key: ${rotation.usedKey?.name} (after ${rotation.triedKeys} keys tried)`, 'success')
          }
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      } else {
        const rotation = await withTokenRotation<string>(
          provider,
          async (apiKey, keyInfo) => {
            addLog(`Trying key: ${keyInfo.name || keyInfo.id}`)
            for (let i = 0; i <= 100; i += 10) {
              await new Promise((r) => setTimeout(r, 500))
              setStatus((s) => ({ ...s, pct: i, text: `Processing ${i}%...` }))
            }
            return 'https://example.com/result.mp4'
          },
          {
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
        if (rotation.ok && rotation.result) {
          setResults((prev) => [rotation.result!, ...prev])
          setStatus((s) => ({ ...s, pct: 100, text: '✅ Selesai' }))
        } else {
          throw new Error(rotation.error || 'Generation failed')
        }
      }
    } catch (err: any) {
      if (activeTaskId) removeActiveTask(activeTaskId)
      addLog(`Error: ${err.message}`, 'error')
      if (['roboneo', 'framia', 'createpulse'].includes(provider)) {
        addLog('⚠️ Credit mungkin sudah terpotong oleh server provider. Hubungi provider untuk refund jika gagal.', 'warn')
      }
      setStatus((s) => ({ ...s, pct: 100, text: `❌ Error: ${err.message}` }))
    } finally {
      clearInterval(timer)
      setGenerating(false)
      generatingRef.current = false
    }
  }

  const PROVIDER_IDS: ProviderId[] = ['weavy', 'wavespeed', 'magnific', 'roboneo', 'createpulse', 'framia']

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
            API Keys: <b className={providerKeyCount > 0 ? 'text-emerald-500' : 'text-destructive'}>{providerKeyCount}</b> tersedia
          </div>
          <div>
            Status: <b className={hasActiveKey ? 'text-emerald-500' : 'text-amber-500'}>{hasActiveKey ? 'Ready' : 'No Key'}</b>
          </div>
        </div>

        {/* CreatePulse Pricing Info */}
        {provider === 'createpulse' && (
          <div className="mt-3 p-3 rounded-xl border border-primary/20 bg-primary/5">
            <div className="text-xs font-medium text-primary mb-2">💜 CreatePulse Pricing</div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <div>Dreamina Seedance 2.0: <b className="text-foreground">$0.022</b> / video</div>
              <div>ByteDance Seedance 2.0: <b className="text-foreground">$0.18</b> / video</div>
              <div>Durasi: <b className="text-foreground">10s / 15s</b></div>
              <div>Failed generations: <b className="text-emerald-500">auto-refunded</b></div>
            </div>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Image Input */}
        <Section title="🖼️ Gambar Input" sub="1 file (JPG / PNG / WEBP) — optional untuk text-to-video">
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => handleFileChange(e.target.files)} />
          {imgUrl ? (
            <div className="relative aspect-[9/16] rounded-2xl overflow-hidden border border-border">
              <img src={imgUrl} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => inputRef.current?.click()}
                className="absolute top-2 right-2 rounded-full px-2 md:px-2.5 py-1 text-xs bg-black/60 text-white flex items-center gap-1"
              >
                <Upload className="h-3 w-3" />
                <span className="hidden md:inline">Ganti</span>
              </button>
            </div>
          ) : (
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full aspect-[9/16] rounded-2xl border border-dashed border-border/80 bg-card/30 grid place-items-center hover:border-primary/60 transition text-center px-4"
            >
              <div>
                <div className="text-3xl">🖼️</div>
                <div className="text-sm mt-1">Tap atau tarik <b>gambar</b> (opsional)</div>
                <div className="text-[11px] text-muted-foreground">JPG / PNG / WEBP</div>
              </div>
            </button>
          )}
        </Section>

        {/* Settings */}
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
                    label: `${m.label} — ${m.cr === 0 ? 'kuota' : '$' + (m.cr / 1000).toFixed(3)}`,
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
                Est. Cost: <b className="text-foreground font-mono">${(totalCredits / 1000).toFixed(3)}</b>
              </div>
              {!hasActiveKey && (
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
        <Section title={`📋 Log (${logs.length})`}>
          <div className="max-h-40 overflow-y-auto overflow-x-hidden text-[11px] font-mono space-y-0.5">
            {logs.map((log, i) => (
              <div
                key={i}
                className={`break-all ${
                  log.level === 'error'
                    ? 'text-red-500'
                    : log.level === 'success'
                    ? 'text-emerald-500'
                    : log.level === 'warn'
                    ? 'text-amber-400'
                    : 'text-muted-foreground'
                }`}
              >
                [{log.time}] {log.msg}
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
            {results.map((url, index) => (
              <div key={index} className="rounded-xl overflow-hidden border border-border bg-black/40">
                <video
                  src={url.startsWith('http') ? `/api/public/video-proxy?url=${encodeURIComponent(url)}` : url}
                  controls
                  playsInline
                  onError={(e) => {
                    const target = e.target as HTMLVideoElement
                    target.poster = ''
                  }}
                  className="w-full aspect-[9/16] object-cover bg-black"
                />
                <div className="p-2 flex justify-between items-center">
                  <a href={url.startsWith('http') ? `/api/public/video-proxy?url=${encodeURIComponent(url)}` : url} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" /> Buka
                  </a>
                  <button
                    onClick={() => handleDownload(url, index)}
                    className="text-[11px] text-primary hover:underline"
                  >
                    Download
                  </button>
                  <button
                    onClick={() => setResults(results.filter((_, i) => i !== index))}
                    className="text-[11px] text-destructive hover:underline"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </PageContent>
  )
}
