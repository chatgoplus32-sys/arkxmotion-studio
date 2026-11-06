import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Select, Label, Textarea, EmptyState } from '@/components/ui'
import { LogDetailActions } from '@/components/ui/LogDetailActions'
import { MaintenanceBanner } from '@/components/ui/MaintenanceBanner'
import { Loader2, Upload, Trash2, Key, Download, ImageIcon, Search, X, CheckCircle2, AlertCircle } from 'lucide-react'
import { useProviderManager } from '@/stores/providerManager'
import { useToastStore } from '@/stores/toastStore'
import { runMagnificUpscale, getMagnificApiKey, type MagnificEngine, type MagnificOptimizedFor } from '@/lib/magnific'
import { runLeonardoUpscale } from '@/lib/leonardo-upscale'
import { runTopazUpscale } from '@/lib/weavy'
import { submitRunningHubPhotoEnhance, pollRunningHubTask } from '@/lib/runninghub'
import { withTokenRotation } from '@/lib/tokenRotation'
import { addResult, startGenerationTask, removeActiveTask } from '@/lib/backgroundTasks'
import { useAuthStore } from '@/stores/authStore'
import { fetchNexabotWallet, chargeNexabotWallet, refundNexabotWallet, nexabotPreferServerKey, nexabotFreeForModel, NEXABOT_PRICE_FALLBACK, type NexabotWallet } from '@/lib/nexabotWallet'
import { formatRp } from '@/lib/payment'
import { uploadBlobToCdn } from '@/lib/cdn'

const MAX_IMAGES = 50

const TOPAZ_MODELS = [
  'Standard V2', 'Low Resolution V2', 'CGI', 'High Fidelity V2',
  'Text Refine', 'Recovery', 'Redefine', 'Recovery V2',
  'Standard MAX', 'Wonder', 'Wonder 3',
]

const MAGNIFIC_ENGINES: { value: MagnificEngine; label: string }[] = [
  { value: 'automatic', label: 'automatic' },
  { value: 'magnific_illusio', label: 'magnific_illusio' },
  { value: 'magnific_sharpy', label: 'magnific_sharpy' },
  { value: 'magnific_sparkle', label: 'magnific_sparkle' },
]

const MAGNIFIC_OPTIMIZED: { value: MagnificOptimizedFor; label: string }[] = [
  { value: 'standard', label: 'standard' },
  { value: 'soft_portraits', label: 'soft_portraits' },
  { value: 'hard_portraits', label: 'hard_portraits' },
  { value: 'art_n_illustration', label: 'art_n_illustration' },
  { value: 'videogame_assets', label: 'videogame_assets' },
  { value: 'nature_n_landscapes', label: 'nature_n_landscapes' },
  { value: 'films_n_photography', label: 'films_n_photography' },
  { value: '3d_renders', label: '3d_renders' },
  { value: 'science_fiction_n_horror', label: 'science_fiction_n_horror' },
]

interface ImageRow {
  id: string
  file: File
  preview: string
  ratio: number
  status: 'queued' | 'processing' | 'done' | 'error'
  url?: string
  error?: string
}

interface LogEntry {
  time: string
  msg: string
  level: 'info' | 'warn' | 'error' | 'success' | 'debug'
}

interface GalleryItem {
  id: string
  url: string
  sourceName: string
  provider: string
  mode: string
  createdAt: string
}

const GALLERY_KEY = 'arkxmotion.upscaler.gallery'

function loadGallery(): GalleryItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(GALLERY_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    // blob: URL (preview) mati setelah reload → buang agar tak ERR_FILE_NOT_FOUND
    const cleaned = raw.filter((g: any) => g && typeof (g.url || g.preview) === 'string' && String(g.url || g.preview).startsWith('http'))
    if (cleaned.length !== raw.length) {
      try { localStorage.setItem(GALLERY_KEY, JSON.stringify(cleaned.slice(0, 200))) } catch {}
    }
    return cleaned
  } catch { return [] }
}
function saveGallery(items: GalleryItem[]) {
  const persistable = items.filter((g: any) => g && typeof (g.url || g.preview) === 'string' && String(g.url || g.preview).startsWith('http'))
  localStorage.setItem(GALLERY_KEY, JSON.stringify(persistable.slice(0, 200)))
}

const HANDOFF_KEY = 'upscaler:handoff'
function getHandoffImages(): { url: string; name?: string }[] {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY)
    sessionStorage.removeItem(HANDOFF_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((e: any) => e && typeof e.url === 'string') : []
  } catch { return [] }
}

async function urlToFile(url: string, name?: string): Promise<File | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
    const fileName = name || `upscale-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
    return new File([blob], fileName, { type: blob.type || 'image/jpeg' })
  } catch { return null }
}

export default function UpscalerPage() {
  const addToast = useToastStore((s) => s.addToast)
  const { keys, fetchMaintenance } = useProviderManager()
  const { token: authToken, user } = useAuthStore()
  const [nbWallet, setNbWallet] = useState<NexabotWallet | null>(null)

  const [provider, setProvider] = useState<'topaz' | 'magnific' | 'leonardo' | 'runninghub' | 'nexabot'>('topaz')
  const [mode, setMode] = useState<'upscale' | 'enhance'>('upscale')
  const [rows, setRows] = useState<ImageRow[]>([])
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [gallerySearch, setGallerySearch] = useState('')
  const [gallery, setGallery] = useState<GalleryItem[]>(() => loadGallery())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [topazModel, setTopazModel] = useState('Standard V2')
  const [topazFactor, setTopazFactor] = useState(2)
  const [topazFormat, setTopazFormat] = useState('jpeg')
  const [topazCrop, setTopazCrop] = useState(false)

  const [magScale, setMagScale] = useState('2x')
  const [magEngine, setMagEngine] = useState<MagnificEngine>('automatic')
  const [magOptimized, setMagOptimized] = useState<MagnificOptimizedFor>('standard')
  const [magCreativity, setMagCreativity] = useState(2)
  const [magHdr, setMagHdr] = useState(3)
  const [magResemblance, setMagResemblance] = useState(50)
  const [magFractality, setMagFractality] = useState(2)
  const [magPrompt, setMagPrompt] = useState('')

  const [leoUpscaler, setLeoUpscaler] = useState<'legacy' | 'ultra' | 'pro'>('pro')
  const [leoProType, setLeoProType] = useState<'precise' | 'creative'>('precise')
  const [leoFactor, setLeoFactor] = useState(2)
  const [leoFixArtifacts, setLeoFixArtifacts] = useState(true)

  const [rhScaleBy, setRhScaleBy] = useState(2)

  const [nbAspect, setNbAspect] = useState<'auto' | 1 | 2 | 5>('auto')
  const [nbPrompt, setNbPrompt] = useState('')

  const filePickerRef = useRef<HTMLInputElement | null>(null)
  const runningRef = useRef(false)
  const [timedOut, setTimedOut] = useState<{ taskId: string; index: number; fileName: string } | null>(null)

  const magnificKey = getMagnificApiKey()
  const leonardoKeys = keys.leonardo || []
  const hasLeonardoKey = leonardoKeys.some(k => k.status !== 'invalid' && k.status !== 'expired')
  const weavyKeys = keys.weavy || []
  const hasWeavyKey = weavyKeys.some(k => k.status !== 'invalid' && k.status !== 'expired')
  const rhKeys = keys.runninghub || []
  const hasRunningHubKey = rhKeys.some(k => k.status !== 'invalid' && k.status !== 'expired')
  const nbKeys = keys.nexabot || []
  const hasNexabotKey = nbKeys.some(k => k.status !== 'invalid' && k.status !== 'expired')
  const nexabotServerReady = !!nbWallet?.server_key?.available
  const nbFreeForModel = nexabotFreeForModel(nbWallet, 'gpt-image')
  const hasNexabotAuth = user?.role === 'admin' || hasNexabotKey || nexabotServerReady
  const canRun = rows.length > 0 && !running &&
    ((provider === 'topaz' && hasWeavyKey) || (provider === 'magnific' && !!magnificKey) || (provider === 'leonardo' && hasLeonardoKey) || (provider === 'runninghub' && hasRunningHubKey) || (provider === 'nexabot' && hasNexabotAuth))

  const addLog = useCallback((msg: string, level: LogEntry['level'] = 'info') => {
    const time = new Date().toLocaleTimeString()
    setLogs(prev => [...prev, { time, msg, level }].slice(-300))
  }, [])

  const clearLogs = () => setLogs([])

  const addImages = useCallback((files: File[]) => {
    const remaining = MAX_IMAGES - rows.length
    const toAdd = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, Math.max(0, remaining))
    toAdd.forEach(file => {
      const preview = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        setRows(prev => [...prev, {
          id: Math.random().toString(36).slice(2),
          file, preview,
          ratio: img.naturalWidth / Math.max(1, img.naturalHeight),
          status: 'queued',
        }])
      }
      img.onerror = () => {
        setRows(prev => [...prev, {
          id: Math.random().toString(36).slice(2),
          file, preview, ratio: 1,
          status: 'queued',
        }])
      }
      img.src = preview
    })
  }, [rows.length])

  const filteredGallery = useMemo(() =>
    gallery.filter(e => !gallerySearch || e.sourceName.toLowerCase().includes(gallerySearch.toLowerCase())),
    [gallery, gallerySearch]
  )

  useEffect(() => {
    fetchMaintenance()
  }, [fetchMaintenance])

  useEffect(() => {
    const handoff = getHandoffImages()
    if (handoff.length > 0) {
      (async () => {
        const files: File[] = []
        for (const h of handoff) {
          const f = await urlToFile(h.url, h.name)
          if (f) files.push(f)
        }
        if (files.length) {
          addImages(files)
          addLog(`📥 ${files.length} gambar diterima dari menu lain, siap di-upscale.`)
        }
      })()
    }
  }, [addImages, addLog])

  useEffect(() => {
    if (!authToken) { setNbWallet(null); return }
    fetchNexabotWallet(authToken).then((w) => { if (w) setNbWallet(w) }).catch(() => {})
  }, [authToken])

  function removeImage(id: string) {
    setRows(prev => {
      const row = prev.find(r => r.id === id)
      if (row) URL.revokeObjectURL(row.preview)
      return prev.filter(r => r.id !== id)
    })
  }

  function clearAll() {
    rows.forEach(r => URL.revokeObjectURL(r.preview))
    setRows([])
  }

  async function handleRun() {
    if (rows.length === 0 || running) return
    if (provider === 'nexabot' && authToken && user?.role !== 'admin' && nbWallet && !nbFreeForModel && nbWallet.balance < (nbWallet.price ?? NEXABOT_PRICE_FALLBACK)) {
      addToast(`Saldo NexaBot tidak cukup (${formatRp(nbWallet.balance)}). Top up / ambil paket dulu sebelum generate GPT Image.`, 'error')
      return
    }
    setRunning(true)
    setTimedOut(null)
    runningRef.current = true
    setLogs([])
    setProgress({ done: 0, total: rows.length })
    setRows(prev => prev.map(r => ({ ...r, status: 'queued' as const, url: undefined, error: undefined })))

    const runId = `upscale-${Date.now().toString(36)}`
    const trackId = startGenerationTask({
      page: 'upscaler',
      model: `AI Upscaler · ${provider}`,
      prompt: `${rows.length} gambar · ${mode}`,
      provider: provider === 'topaz' ? 'weavy' : provider,
    })

    const Concurrency = 2
    const queue = rows.map((r, i) => ({ index: i, file: r.file }))
    let completed = 0

    async function processOne(item: { index: number; file: File }) {
      const log = (msg: string, lvl?: LogEntry['level']) => {
        addLog(`#${item.index + 1}: ${msg}`, lvl || 'info')
        setRows(prev => prev.map((r, i) => i === item.index ? { ...r, status: 'processing' } : r))
      }
      let taskTid = ''
      let nbChargeTicket: number | null = null

      try {
        log('mulai...')

        let url: string
        if (provider === 'topaz') {
          url = await runTopazUpscale(item.file, {
            model: topazModel as any,
            upscale_factor: topazFactor,
            output_format: topazFormat as 'jpeg' | 'png',
            crop_to_fill: topazCrop,
          }, (msg) => log(msg))
        } else if (provider === 'magnific') {
          url = await runMagnificUpscale(item.file, mode, {
            scale_factor: magScale,
            engine: magEngine,
            optimized_for: magOptimized,
            creativity: magCreativity,
            hdr: magHdr,
            resemblance: magResemblance,
            fractality: magFractality,
            prompt: magPrompt || undefined,
          }, (msg) => log(msg))
        } else if (provider === 'runninghub') {
          const rotation = await withTokenRotation<string>(
            'runninghub',
            async (token, keyInfo) => {
              log(`🔑 key: ${keyInfo?.name || keyInfo?.id || 'default'}`)
              const submit = await submitRunningHubPhotoEnhance({
                imageFile: item.file,
                scaleBy: rhScaleBy,
                apiKey: token,
              })
              taskTid = submit.taskId
              log(`task: ${submit.taskId.slice(0, 20)}...`)
              const url = await pollRunningHubTask(submit.taskId, (status, pct) => {
                log(`${status} ${pct}%`)
              }, 1800000, token, 'Photo Enhance (RunningHub)')
              return url
            },
            {
              onKeySwitch: (from, to, attempt) => {
                log(`↻ rotate key RunningHub #${attempt}: ${from.name} → ${to.name}`, 'warn')
              },
            }
          )
          if (!rotation.ok) throw new Error(rotation.error || 'RunningHub failed')
          url = rotation.result!
        } else if (provider === 'nexabot') {
          const { submitNexabotGptImage, pollNexabotGptImage, downloadNexabotGptImage, runWithNexabotThrottleRetry, getNexabotApiKey, getNexabotCookies, compressForApi } = await import('@/lib/nexabot')

          // Satu tiket pemotongan saldo per gambar (member; admin bypass).
          let coveredByPackage = false
          if (authToken && user?.role !== 'admin') {
            const charge = await chargeNexabotWallet(authToken, 'gpt-image')
            nbChargeTicket = charge.usageId
            coveredByPackage = charge.unlimited
            setNbWallet((w) => (w ? { ...w, balance: charge.balance } : w))
            log(charge.unlimited ? '🎟️ paket aktif — gratis' : `💰 -${formatRp(charge.deducted)} (sisa ${formatRp(charge.balance)})`)
          } else if (user?.role === 'admin') {
            log('⚡ admin — skip saldo')
          }

          // Kredensial: prioritaskan kunci server, else API key / cookie milik sendiri.
          let serverReady = nexabotServerReady
          if (authToken) {
            const fresh = await fetchNexabotWallet(authToken).catch(() => null)
            if (fresh) { setNbWallet(fresh); serverReady = !!fresh.server_key?.available }
          }
          const nbApiKey = getNexabotApiKey()
          const nbCookies = getNexabotCookies()
          let auth: any
          if (nexabotPreferServerKey({ hasOwnKey: !!(nbApiKey || nbCookies), serverReady, coveredByPackage })) {
            auth = { master: true, ticket: nbChargeTicket }
          } else if (nbApiKey || nbCookies) {
            auth = { apiKey: nbApiKey, cookies: nbCookies, ticket: nbChargeTicket }
          } else {
            throw new Error('NexaBot: tidak ada API key aktif dan kunci server belum tersedia — tambahkan API key di Providers atau top up / ambil paket dulu.')
          }

          const small = await compressForApi(item.file, 1024, 0.72)
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const r = new FileReader()
            r.onload = () => resolve(String(r.result))
            r.onerror = () => reject(new Error('Gagal membaca file gambar'))
            r.readAsDataURL(small)
          })

          const ratio = rows[item.index]?.ratio ?? 1
          const aspect: 1 | 2 | 5 = nbAspect === 'auto'
            ? (ratio >= 1.4 ? 2 : ratio <= 0.72 ? 5 : 1)
            : nbAspect

          const enhancePrompt = `Upscale and enhance this image: maximum sharpness and fine detail, remove noise and compression artifacts, refine textures, photorealistic and faithful to the original. Keep the exact subject, composition, colors, framing and aspect ratio — do not add, remove, or rearrange any object.${nbPrompt.trim() ? ` Additional: ${nbPrompt.trim()}` : ''}`

          const submit = await runWithNexabotThrottleRetry(() => submitNexabotGptImage({ prompt: enhancePrompt, aspect, references: [dataUrl] }, auth), {
            onThrottle: (s) => log(`⏳ throttle upstream — tunggu ${s}s lalu submit otomatis...`, 'warn'),
          })
          if (!submit.ok || !submit.id) throw new Error(submit.error || 'Submit NexaBot GPT Image gagal')
          taskTid = submit.id
          log(`task ${submit.id.slice(0, 14)}… (biaya ${submit.cost ?? 0.1})`)

          const job = await pollNexabotGptImage(submit.id, auth, (msg) => log(msg))
          const imgs = (job.images || []).filter((im) => im && typeof im.url === 'string')
          if (!imgs.length) throw new Error('Tidak ada gambar hasil GPT Image')

          const dl = await downloadNexabotGptImage(imgs[0].url, auth)
          if (!dl.ok || !dl.blob) throw new Error(`Unduh hasil gagal: ${dl.error || 'blob kosong'}`)

          // URL relay butuh header auth → tak bisa dipakai <img>/galeri langsung.
          // Unggah byte ke R2 untuk tautan http permanen; fallback blob untuk sesi ini saja.
          const up = await uploadBlobToCdn(dl.blob, `gptimg-${submit.id}-${item.index}.jpg`)
          if (up.ok && up.url) url = up.url
          else { log(`penyimpanan R2 gagal (${up.error}) — pakai pratinjau sesi`, 'warn'); url = URL.createObjectURL(dl.blob) }
          nbChargeTicket = null // hasil jadi — saldo resmi terpakai, jangan di-refund
        } else {
          const rotation = await withTokenRotation<string>(
            'leonardo',
            async (token) => {
              return runLeonardoUpscale(token, item.file, {
                upscaler: leoUpscaler,
                pro_type: leoProType,
                upscale_factor: leoFactor,
                fix_artifacts: leoFixArtifacts,
              }, (msg) => log(msg))
            },
            {
              onKeySwitch: (from, to, attempt) => {
                log(`↻ rotate token Leonardo #${attempt}: ${from.name} → ${to.name}`, 'warn')
              },
            }
          )
          if (!rotation.ok) throw new Error(rotation.error || 'Leonardo failed')
          url = rotation.result!
        }

        setRows(prev => prev.map((r, i) => i === item.index ? { ...r, status: 'done', url } : r))
        completed++
        setProgress({ done: completed, total: rows.length })
        log('done', 'success')
        addResult({
          id: `${runId}-${item.index}`,
          url,
          prompt: item.file.name,
          date: new Date().toISOString(),
          page: 'upscaler',
          kind: 'image',
          provider,
          model: provider === 'topaz' ? 'Topaz Upscale' : provider === 'magnific' ? 'Magnific Upscale' : provider === 'leonardo' ? 'Aurora Upscale' : provider === 'nexabot' ? 'AI Enhance via GPT Image 2.5' : 'AI Photo Enhancer',
        }, { notify: false })

        const newItem: GalleryItem = {
          id: Math.random().toString(36).slice(2),
          url,
          sourceName: item.file.name,
          provider,
          mode,
          createdAt: new Date().toISOString(),
        }
        setGallery(prev => {
          const updated = [newItem, ...prev]
          saveGallery(updated)
          return updated
        })
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err)
        setRows(prev => prev.map((r, i) => i === item.index ? { ...r, status: 'error', error: msg } : r))
        completed++
        setProgress({ done: completed, total: rows.length })
        log(msg, 'error')
        if (provider === 'nexabot' && nbChargeTicket && authToken) {
          const refundedBalance = await refundNexabotWallet(authToken, nbChargeTicket).catch(() => null)
          nbChargeTicket = null
          if (refundedBalance != null) {
            setNbWallet((w) => (w ? { ...w, balance: refundedBalance } : w))
            log(`💸 saldo NexaBot dikembalikan — sisa ${formatRp(refundedBalance)}`, 'warn')
          }
        }
        if (/timeout/i.test(msg) && taskTid) {
          setTimedOut({ taskId: taskTid, index: item.index, fileName: item.file.name })
          log(`task ${taskTid.slice(0, 20)}... masih jalan di server — pakai "Lanjutkan" untuk cek lagi`, 'warn')
        }
      }
    }

    try {
      const workers = Array.from({ length: Math.min(Concurrency, queue.length) }, async () => {
        while (queue.length > 0) {
          const item = queue.shift()
          if (item) await processOne(item)
        }
      })
      await Promise.all(workers)
      addLog(`Selesai: ${completed}/${rows.length}`, 'success')
      addToast(`Upscale selesai: ${completed}/${rows.length} gambar`, 'success')
    } catch (err: any) {
      addLog(`Fatal: ${err.message}`, 'error')
    } finally {
      removeActiveTask(trackId)
      setRunning(false)
      runningRef.current = false
    }
  }

  async function continuePolling() {
    if (!timedOut || running) return
    const { taskId, index, fileName } = timedOut
    setRunning(true)
    runningRef.current = true
    const trackId = startGenerationTask({
      page: 'upscaler',
      model: 'AI Photo Enhancer · Lanjutkan',
      prompt: fileName,
      provider: 'runninghub',
    })
    addLog(`🔄 Lanjutkan polling task ${taskId.slice(0, 20)}... (${fileName})`)
    setRows(prev => prev.map((r, i) => i === index ? { ...r, status: 'processing', error: undefined } : r))
    try {
      const rotation = await withTokenRotation<string>(
        'runninghub',
        async (token) => {
          return pollRunningHubTask(taskId, (status, pct) => {
            addLog(`#${index + 1}: ${status} ${pct}%`)
          }, 1800000, token, 'Photo Enhance (RunningHub)')
        },
        {}
      )
      if (!rotation.ok) throw new Error(rotation.error || 'Polling failed')
      const url = rotation.result!
      setRows(prev => prev.map((r, i) => i === index ? { ...r, status: 'done', url } : r))
      addResult({
        id: `rh-enhance-${taskId}`,
        url,
        prompt: fileName,
        date: new Date().toISOString(),
        page: 'upscaler',
        kind: 'image',
        provider: 'runninghub',
        model: 'AI Photo Enhancer',
      })
      const newItem: GalleryItem = {
        id: Math.random().toString(36).slice(2),
        url,
        sourceName: fileName,
        provider: 'runninghub',
        mode,
        createdAt: new Date().toISOString(),
      }
      setGallery(prev => {
        const updated = [newItem, ...prev]
        saveGallery(updated)
        return updated
      })
      setTimedOut(null)
      addLog(`#${index + 1}: done`, 'success')
      addToast('Upscale selesai!', 'success')
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err)
      addLog(`Lanjut polling gagal: ${msg}`, 'error')
      if (!/timeout/i.test(msg)) setTimedOut(null)
      else addToast('Masih jalan — coba "Lanjutkan" lagi nanti', 'info')
    } finally {
      removeActiveTask(trackId)
      setRunning(false)
      runningRef.current = false
    }
  }

  async function downloadItem(item: GalleryItem) {
    try {
      let blob: Blob | null = null
      try {
        const res = await fetch(item.url, { mode: 'cors' })
        if (res.ok) blob = await res.blob()
      } catch (e) { console.warn('[Upscaler] Direct fetch failed:', e) }
      if (!blob) {
        const res = await fetch(`/api/public/proxy-image?url=${encodeURIComponent(item.url)}`)
        if (res.ok) blob = await res.blob()
      }
      if (!blob) throw Error('Download gagal')
      const ext = /\.(png|jpe?g|webp)(\?|$)/i.exec(item.url)?.[1]?.toLowerCase() || 'jpg'
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `upscale-${item.id}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    } catch (err: any) {
      addLog(`Download error: ${err.message}`, 'error')
    }
  }

  function removeGalleryItem(id: string) {
    setGallery(prev => {
      const updated = prev.filter(e => e.id !== id)
      saveGallery(updated)
      return updated
    })
  }

  function clearGallery() {
    if (gallery.length === 0) return
    if (!confirm(`Hapus semua ${gallery.length} hasil dari gallery?`)) return
    setGallery([])
    setSelectedIds(new Set())
    saveGallery([])
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const downloadSelected = async () => {
    const items = filteredGallery.filter((g) => selectedIds.has(g.id))
    if (items.length === 0) return
    try {
      const { downloadFilesAsZip, getExtensionFromUrl } = await import('@/lib/download-zip')
      await downloadFilesAsZip(
        items.map((item, i) => ({
          url: item.url,
          filename: `upscale-${String(i + 1).padStart(2, '0')}-${item.id}.${getExtensionFromUrl(item.url)}`,
        })),
        `upscaler-selected-${new Date().toISOString().slice(0, 10)}.zip`,
        'upscaler',
      )
    } catch (err: unknown) {
      addLog(`ZIP error: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const deleteSelected = () => {
    if (selectedIds.size === 0) return
    if (!confirm(`Hapus ${selectedIds.size} hasil terpilih?`)) return
    setGallery((prev) => {
      const updated = prev.filter((e) => !selectedIds.has(e.id))
      saveGallery(updated)
      return updated
    })
    setSelectedIds(new Set())
  }

  const pct = progress.total ? Math.round(progress.done / progress.total * 100) : 0

  return (
    <PageContent>
      <PageHeader
        eyebrow="Generate"
        title="AI Upscaler &"
        highlight="Enhancer"
        desc={`Topaz/Magnific via Weavy, Aurora Leonardo, atau AI Photo Enhancer via RunningHub. Bulk maksimum ${MAX_IMAGES} gambar sekaligus.`}
      />

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Config Panel */}
          <div className="lg:col-span-1 space-y-5">
            <Section title="Konfigurasi" sub="Pilih model AI & parameter">
              <div className="space-y-4">
                <Label>Model AI</Label>
                <Select
                  value={provider}
                  onChange={e => setProvider(e.target.value as any)}
                  disabled={running}
                  options={[
                    { value: 'topaz', label: 'Topaz Upscale (Weavy node)' },
                    { value: 'magnific', label: 'Magnific Upscale (Weavy node)' },
                    { value: 'leonardo', label: 'Aurora (Leonardo)' },
                    { value: 'runninghub', label: 'AI Photo Enhancer (RunningHub)' },
                    { value: 'nexabot', label: 'AI Enhance via GPT Image 2.5 (NexaBot)' },
                  ]}
                />

                <MaintenanceBanner providerId={provider === 'topaz' ? 'weavy' : provider as any} />

                {provider === 'runninghub' && !hasRunningHubKey && (
                  <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-500/10 rounded-lg p-2 border border-blue-500/20">
                    <Key className="h-4 w-4" />
                    <span>Photo Enhancer butuh RunningHub API key. Tambahkan di <b>Kelola Token</b> → provider <b>RunningHub</b>.</span>
                  </div>
                )}

                {provider === 'topaz' && !hasWeavyKey && (
                  <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-500/10 rounded-lg p-2 border border-blue-500/20">
                    <Key className="h-4 w-4" />
                    <span>Topaz via Weavy butuh token. Tambahkan di <b>Kelola Token</b> → provider <b>Weavy</b>.</span>
                  </div>
                )}
                {provider === 'magnific' && !magnificKey && (
                  <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-500/10 rounded-lg p-2 border border-blue-500/20">
                    <Key className="h-4 w-4" />
                    <span>Magnific butuh API key. Tambahkan di <b>Kelola Token</b> → provider <b>Magnific</b>.</span>
                  </div>
                )}

                {provider === 'nexabot' && !hasNexabotAuth && (
                  <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-500/10 rounded-lg p-2 border border-blue-500/20">
                    <Key className="h-4 w-4" />
                    <span>GPT Image 2.5 butuh login (saldo/paket NexaBot) atau API key NexaBot di <b>Kelola Token</b> → provider <b>NexaBot</b>.</span>
                  </div>
                )}

                <Label>Mode</Label>
                <Select
                  value={mode}
                  onChange={e => setMode(e.target.value as any)}
                  disabled={running}
                  options={[
                    { value: 'upscale', label: 'Upscale (resolusi lebih besar)' },
                    { value: 'enhance', label: 'Enhance (detil / precision)' },
                  ]}
                />

                {/* Topaz Settings */}
                {provider === 'topaz' && (
                  <>
                    <Label>Model Topaz</Label>
                    <Select value={topazModel} onChange={e => setTopazModel(e.target.value)} disabled={running}
                      options={TOPAZ_MODELS.map(m => ({ value: m, label: m }))} />
                    <Label>Upscale factor</Label>
                    <Select value={String(topazFactor)} onChange={e => setTopazFactor(Number(e.target.value))} disabled={running}
                      options={[{ value: '1', label: '1x' }, { value: '2', label: '2x' }, { value: '3', label: '3x' }, { value: '4', label: '4x' }]} />
                    <Label>Output format</Label>
                    <Select value={topazFormat} onChange={e => setTopazFormat(e.target.value)} disabled={running}
                      options={[{ value: 'jpeg', label: 'JPEG' }, { value: 'png', label: 'PNG' }]} />
                    <label className="flex items-center gap-2 text-sm text-foreground/90">
                      <input type="checkbox" checked={topazCrop} onChange={e => setTopazCrop(e.target.checked)} disabled={running} />
                      Crop to fill
                    </label>
                  </>
                )}

                {/* Magnific Settings */}
                {provider === 'magnific' && (
                  <>
                    <Label>Scale factor</Label>
                    <Select value={magScale} onChange={e => setMagScale(e.target.value)} disabled={running}
                      options={[{ value: '2x', label: '2x' }, { value: '4x', label: '4x' }, { value: '8x', label: '8x' }, { value: '16x', label: '16x' }]} />
                    <Label>Engine</Label>
                    <Select value={magEngine} onChange={e => setMagEngine(e.target.value as MagnificEngine)} disabled={running}
                      options={MAGNIFIC_ENGINES} />
                    <Label>Optimized for</Label>
                    <Select value={magOptimized} onChange={e => setMagOptimized(e.target.value as MagnificOptimizedFor)} disabled={running}
                      options={MAGNIFIC_OPTIMIZED} />
                    <div className="grid grid-cols-2 gap-3">
                      <Label>Creativity ({magCreativity})</Label>
                      <input type="number" min={-10} max={10} value={magCreativity} onChange={e => setMagCreativity(Number(e.target.value))} disabled={running}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" />
                      <Label>HDR ({magHdr})</Label>
                      <input type="number" min={-10} max={10} value={magHdr} onChange={e => setMagHdr(Number(e.target.value))} disabled={running}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" />
                      <Label>Resemblance ({magResemblance})</Label>
                      <input type="number" min={0} max={100} value={magResemblance} onChange={e => setMagResemblance(Number(e.target.value))} disabled={running}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" />
                      <Label>Fractality ({magFractality})</Label>
                      <input type="number" min={0} max={10} value={magFractality} onChange={e => setMagFractality(Number(e.target.value))} disabled={running}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" />
                    </div>
                    <Label>Prompt (opsional)</Label>
                    <Textarea rows={2} value={magPrompt} onChange={e => setMagPrompt(e.target.value)} disabled={running}
                      placeholder="Deskripsi tambahan..." />
                  </>
                )}

                {/* Leonardo Settings */}
                {provider === 'leonardo' && (
                  <>
                    <Label>Upscaler</Label>
                    <Select value={leoUpscaler} onChange={e => setLeoUpscaler(e.target.value as any)} disabled={running}
                      options={[{ value: 'legacy', label: 'Legacy' }, { value: 'ultra', label: 'Ultra' }, { value: 'pro', label: 'Pro (New)' }]} />
                    {leoUpscaler === 'pro' && (
                      <>
                        <Label>Type</Label>
                        <Select value={leoProType} onChange={e => setLeoProType(e.target.value as any)} disabled={running}
                          options={[{ value: 'precise', label: 'Precise' }, { value: 'creative', label: 'Creative' }]} />
                      </>
                    )}
                    <Label>Upscale Multiplier ({leoFactor}x)</Label>
                    <input type="range" min={2} max={8} step={1} value={leoFactor}
                      onChange={e => { const v = Number(e.target.value); setLeoFactor(v === 7 ? 8 : v) }}
                      disabled={running} className="w-full accent-primary" />
                    <div className="flex justify-between text-[12px] text-muted-foreground mt-1">
                      <span>2x</span><span>3x</span><span>4x</span><span>5x</span><span>6x</span><span>8x</span>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-foreground/90">
                      <input type="checkbox" checked={leoFixArtifacts} onChange={e => setLeoFixArtifacts(e.target.checked)} disabled={running} />
                      Fix AI Image Artifacts
                    </label>
                    <p className="text-[11px] text-muted-foreground">
                      Multiplier Leonardo: 2, 3, 4, 5, 6, atau 8x. Jika hasil melewati limit Aurora ±105MP, sistem otomatis menurunkan multiplier supaya job tidak gagal.
                    </p>
                  </>
                )}

                {/* RunningHub Settings */}
                {provider === 'runninghub' && (
                  <>
                    <Label>Scale (scale_by)</Label>
                    <Select value={String(rhScaleBy)} onChange={e => setRhScaleBy(Number(e.target.value))} disabled={running}
                      options={[{ value: '1', label: '1x' }, { value: '2', label: '2x' }, { value: '3', label: '3x' }, { value: '4', label: '4x' }]} />
                    <p className="text-[11px] text-muted-foreground">
                      AI Photo Enhancer — retus potret alami (kulit, wajah, rambut, pakaian). Hasil menjaga tampilan asli, cocok untuk UGC/fashion/profil.
                    </p>
                  </>
                )}

                {/* NexaBot GPT Image Settings */}
                {provider === 'nexabot' && (
                  <>
                    <Label>Aspect output</Label>
                    <Select value={String(nbAspect)} onChange={e => setNbAspect(e.target.value === 'auto' ? 'auto' : Number(e.target.value) as 1 | 2 | 5)} disabled={running}
                      options={[{ value: 'auto', label: 'Auto (ikuti rasio gambar)' }, { value: '1', label: '1:1' }, { value: '2', label: '16:9' }, { value: '5', label: '9:16' }]} />
                    <Label>Prompt tambahan (opsional)</Label>
                    <Textarea rows={3} value={nbPrompt} onChange={e => setNbPrompt(e.target.value)} disabled={running}
                      placeholder="Arahkan enhance, mis. 'keep skin texture natural, boost fabric detail'..." />
                    <p className="text-[11px] text-muted-foreground">
                      GPT Image 2.5 (via NexaBot) menghasilkan ulang gambar dengan detil lebih tajam. Biaya ±0,1 kredit/gambar (0 bila paket Unlimited aktif). Aspect dikunci ke 1:1 / 16:9 / 9:16, jadi rasio non-standar akan di-crop.
                    </p>
                    {nbWallet && user?.role !== 'admin' && (
                      <p className="text-[11px] text-muted-foreground">
                        Saldo NexaBot: <b>{formatRp(nbWallet.balance)}</b>{nbFreeForModel ? ' · generate ini dicakup paket (gratis)' : ` · ±${formatRp(nbWallet.price ?? NEXABOT_PRICE_FALLBACK)}/gambar`}
                      </p>
                    )}
                  </>
                )}

                <div className="flex gap-2 pt-2">
                  <Button onClick={handleRun} disabled={!canRun}>
                    {running ? 'Memproses...' : `Jalankan (${rows.length})`}
                  </Button>
                  <Button variant="outline" onClick={clearAll} disabled={running || rows.length === 0}>
                    Bersihkan
                  </Button>
                </div>
                {timedOut && !running && (
                  <Button variant="outline" onClick={continuePolling} disabled={running}>
                    🔄 Lanjutkan: {timedOut.fileName.slice(0, 25)}
                  </Button>
                )}
              </div>
            </Section>
          </div>

          {/* Image Grid */}
          <div className="lg:col-span-2 space-y-5">
            <Section
              title={`Gambar (${rows.length}/${MAX_IMAGES})`}
              sub="Drop / pilih gambar, satuan atau banyak sekaligus"
              right={
                <>
                  <button
                    onClick={() => filePickerRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-border cursor-pointer hover:bg-accent/40"
                  >
                    <Upload className="h-4 w-4" /> Tambah
                  </button>
                  <input ref={filePickerRef} type="file" accept="image/*" multiple hidden
                    onChange={e => { if (e.target.files) addImages(Array.from(e.target.files)); e.target.value = '' }} />
                </>
              }
            >
              {rows.length === 0 ? (
                <div className="text-sm text-muted-foreground p-8 text-center border border-dashed border-border rounded-xl">
                  Belum ada gambar. Klik <b>Tambah</b> untuk memilih file (maks {MAX_IMAGES}).
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {rows.map((row, idx) => (
                    <div key={row.id} className="relative rounded-xl overflow-hidden border border-border bg-background/40">
                      <div className="relative bg-black/40" style={{ aspectRatio: row.ratio || 1 }}>
                        <img src={row.preview} alt={row.file?.name || `Input upscale ${idx + 1}`} className="absolute inset-0 w-full h-full object-contain" />
                        {!running && (
                          <button onClick={() => removeImage(row.id)} aria-label={`Hapus ${row.file?.name || `gambar ${idx + 1}`}`}
                            className="absolute top-1 right-1 h-6 w-6 grid place-items-center rounded-full bg-black/70 text-white hover:bg-black/90">
                            <X className="h-3 w-3" />
                          </button>
                        )}
                        {row.status === 'processing' && (
                          <div className="absolute inset-0 bg-black/40 grid place-items-center">
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                          </div>
                        )}
                        {row.status === 'done' && (
                          <div className="absolute inset-0 bg-black/20 grid place-items-center">
                            <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                          </div>
                        )}
                        {row.status === 'error' && (
                          <div className="absolute inset-0 bg-black/20 grid place-items-center">
                            <AlertCircle className="h-6 w-6 text-red-400" />
                          </div>
                        )}
                      </div>
                      <div className="p-1.5 text-[12px] leading-tight">
                        <div className="truncate text-foreground/90">#{idx + 1} {row.file.name}</div>
                        {row.error ? (
                          <div className="truncate text-destructive">{row.error}</div>
                        ) : row.status === 'done' ? (
                          <div className="truncate text-emerald-400">done</div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        </div>

        {/* Log Panel */}
        <Section title="Log Info & Progress" sub={`Total ${logs.length} entri`}>
          <LogDetailActions logs={logs} onClear={clearLogs} />
          {(running || progress.total > 0) && (
            <div className="mb-3">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                <span>{running ? 'Memproses...' : 'Selesai'}</span>
                <span className="font-mono">{progress.done}/{progress.total} · {pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-card/60 border border-border overflow-hidden">
                <div className="h-full transition-all" style={{ width: `${pct}%`, background: 'var(--gradient-neon, linear-gradient(90deg, #6366f1, #a855f7))' }} />
              </div>
            </div>
          )}
          <div className="rounded-xl border border-border/60 bg-black/40 p-2 max-h-64 overflow-y-auto overflow-x-hidden text-[11px] font-mono min-w-0">
            {logs.length === 0 ? (
              <div className="text-muted-foreground px-1 py-2">Belum ada log. Jalankan proses untuk melihat aktivitas.</div>
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

        {/* Gallery */}
        <Section
          title="Gallery Hasil"
          sub="Gambar hasil upscale / enhance"
          right={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={filteredGallery.length === 0}
                onClick={async () => {
                  if (filteredGallery.length === 0) return
                  try {
                    const { default: JSZip } = await import('jszip')
                    const zip = new JSZip()
                    for (let i = 0; i < filteredGallery.length; i++) {
                      const item = filteredGallery[i]
                      try {
                        const res = await fetch(item.url)
                        const blob = await res.blob()
                        const ext = /\.(png|jpe?g|webp)(\?|$)/i.exec(item.url)?.[1] || 'jpg'
                        zip.file(`upscale-${String(i + 1).padStart(2, '0')}-${item.id}.${ext}`, blob)
                      } catch (e) { console.warn('[Upscaler] Failed to add image to ZIP:', e) }
                    }
                    const content = await zip.generateAsync({ type: 'blob' })
                    const a = document.createElement('a')
                    a.href = URL.createObjectURL(content)
                    a.download = `upscaler-gallery-${new Date().toISOString().slice(0, 10)}.zip`
                    a.click()
                    URL.revokeObjectURL(a.href)
                  } catch (err: any) {
                    addLog(`ZIP error: ${err.message}`, 'error')
                  }
                }}>
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Export ZIP</span>
              </Button>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive"
                disabled={gallery.length === 0} onClick={clearGallery}>
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Hapus Semua</span>
              </Button>
            </div>
          }
        >
          <div className="flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-2 mb-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={gallerySearch}
              onChange={e => setGallerySearch(e.target.value)}
              placeholder="Search nama file…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {filteredGallery.length === 0 ? (
            <EmptyState icon={<ImageIcon className="h-8 w-8" />} title="Belum ada hasil" description="Gambar hasil upscale akan muncul di sini" />
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3 text-xs">
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set(filteredGallery.map((g) => g.id)))}
                  className="px-2 py-1 rounded border border-border hover:bg-accent"
                >
                  Pilih semua ({filteredGallery.length})
                </button>
                {selectedIds.size > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelectedIds(new Set())}
                      className="px-2 py-1 rounded border border-border hover:bg-accent"
                    >
                      Batal ({selectedIds.size})
                    </button>
                    <button
                      type="button"
                      onClick={downloadSelected}
                      className="px-2 py-1 rounded border border-border hover:bg-accent inline-flex items-center gap-1"
                    >
                      <Download className="h-3 w-3" /> Zip terpilih
                    </button>
                    <button
                      type="button"
                      onClick={deleteSelected}
                      className="px-2 py-1 rounded border border-destructive/40 text-destructive hover:bg-destructive/10 inline-flex items-center gap-1"
                    >
                      <Trash2 className="h-3 w-3" /> Hapus terpilih
                    </button>
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                {filteredGallery.map(item => (
                  <div key={item.id} className={`rounded-xl overflow-hidden border bg-card/40 group ${selectedIds.has(item.id) ? 'border-primary' : 'border-border/60'}`}>
                    <div className="block relative bg-black/40">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleSelect(item.id)}
                        aria-label={`Pilih ${item.sourceName}`}
                        className="absolute top-2 left-2 h-4 w-4 z-10 accent-primary"
                      />
                      <a href={item.url} target="_blank" rel="noreferrer" className="block">
                        <img src={item.url} alt={item.sourceName || 'Hasil upscale'} className="w-full h-auto object-contain" loading="lazy" />
                      </a>
                    </div>
                  <div className="p-2 text-[11px] text-muted-foreground flex items-center justify-between gap-1">
                    <span className="truncate flex-1" title={item.sourceName}>{item.sourceName}</span>
                    <button onClick={() => downloadItem(item)} aria-label={`Download ${item.sourceName}`}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 px-2 py-1 hover:text-foreground hover:border-primary/50 transition" title="Download">
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => removeGalleryItem(item.id)} aria-label={`Hapus ${item.sourceName}`}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 px-2 py-1 hover:text-destructive hover:border-destructive/50 transition" title="Hapus">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              </div>
            </>
          )}
        </Section>
      </div>
    </PageContent>
  )
}
