import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Input, Label, Badge, Select, Textarea } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import {
  Zap,
  Check,
  AlertCircle,
  XCircle,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  RefreshCw,
  Key,
  ArrowRight,
  Settings,
  Save,
  Upload,
  Clipboard,
  Loader2,
  ShoppingCart,
  FileText,
  ChevronDown,
  ExternalLink,
  Wrench,
} from 'lucide-react'
import { useProviderManager, PROVIDER_CONFIGS, ProviderId } from '@/stores/providerManager'
import { checkRoboneoBalance } from '@/lib/roboneo'
import { fetchLeonardoBalance } from '@/lib/leonardo'
import { checkWeavyBalance } from '@/lib/weavy'
import { checkRunningHubBalance } from '@/lib/runninghub'
import { checkGalleri5Balance, isGalleri5TokenError } from '@/lib/galleri5'

const PROVIDER_COLORS: Record<string, string> = {
  brain: '#f472b6',
  weavy: '#22d3ee',
  wavespeed: '#38bdf8',
  roboneo: '#34d399',
  runninghub: '#f97316',
  framia: '#fb923c',
  galleri5: '#e879f9',
  leonardo: '#facc15',
  render: '#94a3b8',
  createpulse: '#c084fc',
}

const PROVIDER_LIST = [
  { key: 'brain', label: 'Brain (Gemini)', desc: 'Dipakai Produk Storyboard & Naratif Video Maker. Multi-key auto-rotate saat kena limit/429.' },
  { key: 'weavy', label: 'Weavy', desc: 'Provider utama Kling Motion Control, Wan, Sora, Seedance.' },
  { key: 'wavespeed', label: 'Wavespeed', desc: 'Provider alternatif — cek balance via api.wavespeed.ai/api/v3/balance.' },
  { key: 'roboneo', label: 'Roboneo', desc: 'AI video generation via Roboneo (Meitu) — Seedance 2.0, Kling 3.0, Wan 2.6, Sora 2, VEO 3.0, Happy Horse, Google Omni.' },
  { key: 'runninghub', label: 'Motion Control HD (Markasflow-V2)', desc: 'RunningHub AI video generation via Markasflow-V2 — Kling 3.0 Pro/Standard.' },
  { key: 'framia', label: 'Framia', desc: 'Canvas workflow (Converge AI) — semua node & recipe: image, video, avatar, garment, storyboard.' },
  { key: 'leonardo', label: 'Leonardo.ai', desc: 'app.leonardo.ai via Cognito Bearer JWT — Text-to-Image (Phoenix, Diffusion XL, Kino, Anime, Vision).' },
  { key: 'createpulse', label: 'CreatePulse', desc: 'Video generation (Seedance 2.0/2.5, Veo Omni) via createpulse.online — pakai API key sendiri.' },
  { key: 'galleri5', label: 'G5 AI Studio', desc: 'Motion Control (Kling V3 & V2.6 motion transfer) via aistudio.galleri5.com — Firebase refresh token (auto-refresh).' },
] as const

const TOKEN_GUIDE: Record<string, {
  url: string
  urlLabel: string
  prefix?: string
  steps: Array<{ text: string; link?: { url: string; label: string }; code?: string }>
  tip?: string
}> = {
  brain: {
    url: 'https://aistudio.google.com/api-keys',
    urlLabel: 'aistudio.google.com/api-keys',
    prefix: 'AIza… / AQ…',
    steps: [
      { text: 'Buka Google AI Studio dan login pakai akun Google.' },
      { text: 'Klik tombol "Create API key" (pojok kanan atas).' },
      { text: 'Pilih project Google Cloud (atau "Create API key in new project").' },
      { text: 'Copy key yang muncul — bisa diawali AIza… (legacy) atau AQ… (auth key baru).' },
      { text: 'Paste ke textarea di sebelah. Boleh tambah banyak key sekaligus (1 per baris) untuk auto-rotate saat kena limit gratis.' },
    ],
    tip: 'Free tier Gemini: 15 request/menit, 1 juta token/hari untuk gemini-2.5-flash. Format AQ… adalah auth key baru Gemini dan tetap valid sebagai API key.',
  },
  weavy: {
    url: 'https://drive.google.com/file/d/1xJEUv31VdzF8FVXPzfcpRcnq8ahV3_8w/view?usp=sharing',
    urlLabel: 'Weavy Token Extractor',
    steps: [
      { text: 'Download Weavy Token Extractor (klik link di atas).' },
      { text: 'Ekstrak / unzip file yang sudah di-download.' },
      { text: 'Buka Manager Extension di browser (mis. chrome://extensions).' },
      { text: 'Aktifkan Developer mode di pojok kanan atas Manager Extension.' },
      { text: 'Klik tombol Load unpacked.' },
      { text: 'Cari folder Weavy Token Extension yang sudah di-ekstrak tadi, lalu Select Folder.' },
      { text: 'Pin Weavy Token Extension agar muncul di taskbar atas browser.' },
      { text: 'Buka ', link: { url: 'https://app.weavy.ai', label: 'app.weavy.ai' } },
      { text: 'Klik icon Weavy Token di taskbar → klik Extract Token, lalu klik Copy Token.' },
      { text: 'Paste token ke Bulk Input di sebelah dan simpan. Ulangi untuk tiap akun Weavy — makin banyak, makin besar credit pool.' },
    ],
    tip: 'Refresh token Weavy berumur panjang. Bila expired, ulangi langkah Extract Token dari extension.',
  },
  wavespeed: {
    url: 'https://wavespeed.ai/accesskey',
    urlLabel: 'wavespeed.ai/accesskey',
    prefix: 'wsk_live_…',
    steps: [
      { text: 'Register/login di wavespeed.ai.' },
      { text: 'Buka menu Dashboard → API Keys.' },
      { text: 'Klik "Create API Key", beri nama (mis. "aatools"), copy key wsk_live_…' },
      { text: 'Top-up saldo minimal $5 di menu Billing (bayar per detik video, mulai $0.04/s).' },
      { text: 'Paste key ke input di sebelah, klik Cek Saldo untuk verifikasi balance USD.' },
    ],
    tip: '1 klip 5 detik Kling v2.1 Standard ≈ $0.25. Saldo $5 = ±20 klip.',
  },
  roboneo: {
    url: 'https://www.roboneo.com/cli/en',
    urlLabel: 'roboneo.com/cli',
    prefix: '_v2… (ROBONEO_ACCESS_KEY dari CLI — long-lived)',
    steps: [
      { text: 'REKOMENDASI: pakai access-key dari Roboneo CLI supaya token tetap hidup meski browser di-logout.' },
      { text: 'Install CLI di terminal: `npm install -g roboneo-cli` lalu jalankan `roboneo login` (browser akan terbuka untuk otorisasi).', code: 'npm install -g roboneo-cli\nroboneo login' },
      { text: 'Setelah login sukses, CLI menampilkan `export ROBONEO_ACCESS_KEY=_v2…` — copy string setelah `=` (tanpa tanda kutip).' },
      { text: 'Paste ke input di sebelah. Key ini long-lived (bulan+), tidak mati saat kamu logout dari roboneo.com di browser.' },
      { text: 'Simpan beberapa key sekaligus (multi-akun) → auto-rotate saat rate-limit / credit habis. Token tersimpan di akunmu, sinkron antar device, dan bisa di-transfer via Token Bank.' },
      { text: 'Alternatif (session token, cepat expired): DevTools → Application → Local Storage → https://www.roboneo.com → copy value `access-token`.' },
    ],
    tip: 'Model yang didukung: Seedance 2.0, Kling 3.0, Wan 2.6, Sora 2, VEO 3.0, Happy Horse, Google Omni, Gemini Nano Banana 2. Panduan resmi: roboneo.com/cli/en.',
  },

  framia: {
    url: 'https://framia.converge.ai/',
    urlLabel: 'framia.converge.ai',
    prefix: 'eyJhbGci... (Auth0 Bearer JWT)',
    steps: [
      { text: 'Login di framia.converge.ai (Google / email — akun Converge AI).' },
      { text: 'Buka DevTools (F12) → tab Network → filter \'api.framia.pro\'.' },
      { text: 'Klik salah satu request (mis. /video/api/v1/user/credits) → Headers → Request Headers.' },
      { text: 'Copy value header "authorization" — HANYA bagian setelah "Bearer " (dimulai dengan eyJ...).' },
      { text: 'Paste ke input di sebelah. Token JWT berumur ~24 jam; setelah expired, ambil ulang dari Network tab.' },
      { text: 'Multi-token akan auto-rotate saat quota / expiry habis. Token tersimpan permanen di akunmu dan sinkron antar device.' },
    ],
    tip: 'Framia = platform canvas Converge AI. Semua node (skills) dan recipe (templates) muncul otomatis di halaman Generate → Framia begitu token tersimpan.',
  },
  leonardo: {
    url: 'https://app.leonardo.ai/',
    urlLabel: 'app.leonardo.ai',
    prefix: 'eyJ... (Cognito Bearer JWT, ~1 jam)',
    steps: [
      { text: 'Login di app.leonardo.ai (Google / email).' },
      { text: 'Buka DevTools (F12) → tab Network → filter \'api.leonardo.ai\'.' },
      { text: 'Klik salah satu request GraphQL → Headers → Request Headers.' },
      { text: 'Copy value header "authorization" — HANYA bagian setelah "Bearer " (dimulai dengan eyJ...).' },
      { text: 'Paste ke input di sebelah. Token Cognito berumur ~1 jam; setelah expired, ambil ulang dari Network tab (multi-token akan auto-rotate).' },
    ],
    tip: 'Model default: Phoenix, Leonardo Diffusion XL, Kino XL, Anime XL, Vision XL — semua otomatis muncul di halaman Generate → Leonardo.',
  },

  createpulse: {
    url: 'https://createpulse.online',
    urlLabel: 'createpulse.online',
    prefix: 'cp_… (API Key)',
    steps: [
      { text: 'Buka createpulse.online dan login (Google / email).' },
      { text: 'Buka menu Profile → API Keys (atau Dashboard).' },
      { text: 'Klik "Create API Key", beri nama.' },
      { text: 'Copy key cp_… — paste ke input di sebelah.' },
      { text: 'Top up saldo minimal Rp 15.000 di menu Top Up (biaya per generate ≈ Rp 1.500-2.250).' },
      { text: 'Multi-key akan auto-rotate saat quota / balance habis.' },
    ],
    tip: 'Model: Seedance 2.0/2.5 (Rp 1.500), Seedance 2.0 15s/Veo Omni (Rp 2.250). Token tersimpan di akunmu, bisa dipakai dari mana saja.',
  },
  runninghub: {
    url: 'https://www.runninghub.cn/enterprise-api/consumerApi',
    urlLabel: 'runninghub.cn/enterprise-api/consumerApi',
    prefix: 'API key 32 karakter',
    steps: [
      { text: 'Buka runninghub.cn dan login.' },
      { text: 'Buka menu Profile → API Keys (atau klik link di atas).' },
      { text: 'Klik "Create API Key", beri nama (mis. "arkxmotion").' },
      { text: 'Copy API key (string 32 karakter) — paste ke input di sebelah.' },
      { text: 'Workflow ID sudah default ke Markasflow-V2. Kosongkan saja atau ganti jika ingin workflow custom.' },
    ],
    tip: 'Model: Kling 3.0 Pro/Standard, Kling 2.6 Pro/Standard via ComfyUI di RunningHub cloud. API key tersimpan di browser.',
  },
  render: {
    url: 'https://shotstack.io/dashboard/',
    urlLabel: 'shotstack.io / creatomate.com',
    prefix: 'shotstack: … | creatomate: …',
    steps: [
      { text: 'Default render pakai FFmpeg WASM di browser (gratis, tanpa key). Cloud render hanya perlu bila video > 400 MB.' },
      { text: 'Shotstack: register di shotstack.io → Dashboard → API Keys. Free tier 20 menit/bulan.' },
      { text: 'Creatomate: register di creatomate.com → Project Settings → API. Free tier 50 render/bulan.' },
      { text: 'Paste key di panel Shotstack / Creatomate di sebelah. Bila kosong, dropdown Render engine akan disabled.' },
    ],
    tip: 'FFmpeg = default, gratis, di device kamu. Cloud = fallback untuk file besar / batch panjang.',
  },
  galleri5: {
    url: '/plugins',
    urlLabel: 'AA Plug-IN → AA Grabber Galery5',
    prefix: 'AMf-... (refresh token) atau eyJ... (ID token) atau JSON headers',
    steps: [
      { text: 'Cara cepat: buka menu AA Plug-IN → install "AA Grabber — Galery5", login di tab Akun, buka aistudio.galleri5.com, klik Ambil Token → otomatis masuk Token Manager.' },
      { text: 'Cara manual: login di aistudio.galleri5.com (Google / email).' },
      { text: 'Buka DevTools (F12) → Application → IndexedDB → firebaseLocalStorageDb → firebaseLocalStorage.' },
      { text: 'Buka entry firebase:authUser:... → stsTokenManager.' },
      { text: 'Copy value refreshToken (diawali AMf-...) — atau copy idToken (diawali eyJ...) jika ingin pakai ID token langsung.' },
      { text: 'Paste ke input di sebelah. Bisa banyak token (1 per baris) untuk auto-rotate.' },
      { text: 'Refresh token tahan lama — app menukarnya otomatis ke ID token tiap ~1 jam, jadi sisa credit tetap terbaca tanpa ambil ulang.' },
    ],
    tip: 'Galery5 dipakai khusus Motion Control (Kling V3 Standard 100 cr, V2.6 Pro 120 cr, V2.6 Standard 60 cr). Format: refresh token (AMf-...) recommended, ID token (eyJ...) juga bisa.',
  },

}

function getStorageKey(provider: string): string {
  const map: Record<string, string> = {
    brain: 'arkxmotion.brain.keys',
    weavy: 'arkxmotion.weavy.keys',
    wavespeed: 'arkxmotion.wavespeed.keys',
    roboneo: 'arkxmotion.roboneo.keys',
    framia: 'arkxmotion.framia.keys',
    leonardo: 'arkxmotion.leonardo.keys',
    createpulse: 'arkxmotion.createpulse.keys',
  }
  return map[provider] || `arkxmotion.${provider}.keys`
}

function loadKeys(provider: string): string[] {
  try {
    const raw = localStorage.getItem(getStorageKey(provider))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveKeys(provider: string, keys: string[]) {
  localStorage.setItem(getStorageKey(provider), JSON.stringify(keys))
}

function maskKey(key: string): string {
  if (key.length <= 12) return key
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'active': return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
    case 'limited': return 'text-amber-300 bg-amber-500/10 border-amber-500/30'
    case 'invalid':
    case 'failed': return 'text-rose-300 bg-rose-500/10 border-rose-500/30'
    case 'checking': return 'text-sky-300 bg-sky-500/10 border-sky-500/30'
    default: return 'text-muted-foreground bg-muted/30 border-border'
  }
}

function getStatusLabel(status: string): string {
  return {
    active: 'Active',
    limited: 'Rate-limited',
    invalid: 'Invalid',
    failed: 'Failed',
    checking: 'Checking…',
    unknown: '—',
  }[status] || '—'
}

export default function ProvidersPage() {
  const { user } = useAuthStore()
  const {
    keys,
    activeProvider,
    routing,
    maintenance,
    setActiveProvider,
    addKey,
    removeKey,
    updateKeyStatus,
    setRouting,
    fetchMaintenance,
    isProviderMaintenance,
    getMaintenanceMessage,
  } = useProviderManager()

  const [selectedProvider, setSelectedProvider] = useState(() => localStorage.getItem('arkxmotion.providers.selected') || 'brain')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [inputValue, setInputValue] = useState(() => localStorage.getItem(`arkxmotion.providers.draft.${localStorage.getItem('arkxmotion.providers.selected') || 'brain'}`) || '')
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkText, setBulkText] = useState(() => localStorage.getItem(`arkxmotion.providers.bulk.${localStorage.getItem('arkxmotion.providers.selected') || 'brain'}`) || '')
  const [workflowId, setWorkflowId] = useState(() => localStorage.getItem('runninghub.workflowId') || '')
  const [statusMap, setStatusMap] = useState<Record<string, { state: string; detail?: string; balance?: number; email?: string }>>({})
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState({ show: false, pct: 0, text: '' })
  const [viewHidden, setViewHidden] = useState(false)
  const [summaryPayload, setSummaryPayload] = useState<{ title: string; rows: Array<{ label: string; value: string | number; tone?: string }>; footer?: string } | null>(null)
  const [tokenBankOpen, setTokenBankOpen] = useState(false)
  const [editingBalanceIdx, setEditingBalanceIdx] = useState<number | null>(null)
  const [editingBalanceVal, setEditingBalanceVal] = useState('')

  const currentConfig = PROVIDER_LIST.find(p => p.key === selectedProvider)
  const currentColor = PROVIDER_COLORS[selectedProvider] || '#6366f1'

  const savedKeys = useMemo(
    () => keys[selectedProvider as ProviderId]?.map(k => k.key) || [],
    [selectedProvider, keys]
  )

  // Check if current selected provider is in maintenance
  const isCurrentMaintenance = useMemo(() => {
    const providerMap: Record<string, ProviderId> = {
      brain: 'gemini',
      weavy: 'weavy',
      wavespeed: 'wavespeed',
      roboneo: 'roboneo',
      runninghub: 'runninghub',
      framia: 'framia',
      leonardo: 'leonardo',
      createpulse: 'createpulse',
      galleri5: 'galleri5',
    }
    const providerId = providerMap[selectedProvider]
    return providerId ? isProviderMaintenance(providerId) : false
  }, [selectedProvider, isProviderMaintenance])

  const currentMaintenanceMessage = useMemo(() => {
    const providerMap: Record<string, ProviderId> = {
      brain: 'gemini',
      weavy: 'weavy',
      wavespeed: 'wavespeed',
      roboneo: 'roboneo',
      runninghub: 'runninghub',
      framia: 'framia',
      leonardo: 'leonardo',
      createpulse: 'createpulse',
      galleri5: 'galleri5',
    }
    const providerId = providerMap[selectedProvider]
    return providerId ? getMaintenanceMessage(providerId) : ''
  }, [selectedProvider, getMaintenanceMessage])

  useEffect(() => {
    fetchMaintenance()
  }, [fetchMaintenance])

  useEffect(() => {
    localStorage.setItem('arkxmotion.providers.selected', selectedProvider)
    setInputValue(localStorage.getItem(`arkxmotion.providers.draft.${selectedProvider}`) || '')
    setBulkText(localStorage.getItem(`arkxmotion.providers.bulk.${selectedProvider}`) || '')
    setStatusMap({})
  }, [selectedProvider])

  useEffect(() => {
    localStorage.setItem(`arkxmotion.providers.draft.${selectedProvider}`, inputValue)
  }, [inputValue, selectedProvider])

  useEffect(() => {
    localStorage.setItem(`arkxmotion.providers.bulk.${selectedProvider}`, bulkText)
  }, [bulkText, selectedProvider])

  useEffect(() => {
    if (workflowId) {
      localStorage.setItem('runninghub.workflowId', workflowId)
    }
  }, [workflowId])

  const handleAddKey = useCallback(() => {
    const lines = inputValue.split(/[\n,]/).map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return

    const existing = new Set(savedKeys)
    let added = 0
    let skipped = 0

    lines.forEach(line => {
      if (existing.has(line)) {
        skipped++
        return
      }
      addKey(selectedProvider as ProviderId, line)
      existing.add(line)
      added++
    })

    if (added > 0) {
      setSummaryPayload({
        title: 'Ringkasan Tambah Key',
        rows: [
          { label: 'Total input', value: lines.length },
          { label: 'Duplikat', value: skipped, tone: skipped ? 'warn' : 'muted' },
          { label: 'Berhasil ditambahkan', value: added, tone: 'ok' },
        ],
        footer: `Total key tersimpan: ${existing.size}`,
      })
    }
  }, [inputValue, savedKeys, selectedProvider, addKey])

  const handleBulkUpload = useCallback(() => {
    const lines = bulkText.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return

    const existing = new Set(savedKeys)
    let added = 0
    let skipped = 0

    lines.forEach(line => {
      const cleanKey = line.replace(/^[•\-*\s]+|[•\-*\s]+$/g, '').trim()
      if (!cleanKey || existing.has(cleanKey)) {
        skipped++
        return
      }
      addKey(selectedProvider as ProviderId, cleanKey)
      existing.add(cleanKey)
      added++
    })

    setSummaryPayload({
      title: 'Ringkasan Import Bulk',
      rows: [
        { label: 'Total input', value: lines.length },
        { label: 'Duplikat / kosong', value: skipped, tone: skipped ? 'warn' : 'muted' },
        { label: 'Berhasil ditambahkan', value: added, tone: 'ok' },
      ],
      footer: `Total key tersimpan: ${existing.size}`,
    })
  }, [bulkText, savedKeys, selectedProvider, addKey])

  const handleDeleteAll = useCallback(() => {
    savedKeys.forEach((_, i) => {
      const keyObj = keys[selectedProvider as ProviderId]?.[i]
      if (keyObj) removeKey(selectedProvider as ProviderId, keyObj.id)
    })
    setStatusMap({})
  }, [savedKeys, keys, selectedProvider, removeKey])

  const handleCheckKey = useCallback(async (key: string) => {
    if (selectedProvider === 'roboneo') {
      try {
        const result = await checkRoboneoBalance(key)
        if (result.ok && result.isValidUser !== false) {
          return { state: 'active', balance: result.balance, detail: `Balance: ${result.balance}` }
        } else if (result.isValidUser === false) {
          return { state: 'invalid', detail: 'Token tidak valid' }
        } else {
          return { state: 'empty', balance: result.balance, detail: `Balance: ${result.balance}` }
        }
      } catch {
        return { state: 'failed', detail: 'Error checking token' }
      }
    }
    if (selectedProvider === 'weavy') {
      console.log('[Providers] handleCheckKey weavy, key:', key.slice(0, 20) + '...')
      try {
        const result = await checkWeavyBalance(key)
        console.log('[Providers] checkWeavyBalance result:', result)
        if (result.ok) {
          const bal = result.balance
          const email = result.email
          const sub = result.subscriptionType
          const subLabel = sub === 'free' ? 'Free' : sub === 'pro' ? 'Pro' : sub || ''
          if (bal !== null && bal !== undefined) {
            if (bal > 0) {
              return { state: 'active', balance: bal, email, detail: `${email || ''}${subLabel ? ` · ${subLabel}` : ''} · Balance: ${bal} cr` }
            } else if (bal === 0) {
              return { state: 'empty', balance: 0, email, detail: `${email || ''}${subLabel ? ` · ${subLabel}` : ''} · Balance: 0 — habis` }
            }
          }
          return { state: 'active', email, detail: `${email || 'Token valid'}${subLabel ? ` · ${subLabel}` : ''}` }
        }
        if (result.error?.includes('expired') && !result.error?.includes('403')) {
          return { state: 'invalid', detail: 'Token expired — ambil baru dari browser (F12 → Network → app.weavy.ai → Authorization)' }
        }
        return { state: 'unknown', detail: result.error || 'Gagal cek token — coba lagi nanti' }
      } catch {
        return { state: 'unknown', detail: 'Error checking token' }
      }
    }
    if (selectedProvider === 'createpulse') {
      if (/^cp_/.test(key)) {
        return { state: 'active', detail: 'Format API key valid' }
      }
      return { state: 'invalid', detail: 'Format key harus cp_...' }
    }
    if (selectedProvider === 'runninghub') {
      try {
        const result = await checkRunningHubBalance(key)
        if (result.ok && result.isValidUser) {
          return { state: 'active', balance: result.balance, detail: `Balance: ${result.balance} RH coins` }
        } else {
          return { state: 'invalid', detail: result.error || 'Token tidak valid' }
        }
      } catch {
        return { state: 'failed', detail: 'Error checking token' }
      }
    }
    if (selectedProvider === 'leonardo') {
      try {
        const result = await fetchLeonardoBalance(key)
        if (result.ok) {
          const bal = result.balance ?? 0
          if (bal > 0) {
            return { state: 'active', balance: bal, detail: `Balance: ${bal}${result.email ? ` (${result.email})` : ''}` }
          } else if (bal === 0) {
            return { state: 'empty', balance: 0, detail: 'Balance: 0 — habis' }
          }
          return { state: 'active', detail: result.email ? `Email: ${result.email}` : 'Token valid' }
        }
        if (result.message?.includes('expired') || result.message?.includes('401') || result.message?.includes('403')) {
          return { state: 'invalid', detail: 'Token expired — ambil baru dari browser (F12 → Network → api.leonardo.ai → Authorization)' }
        }
        return { state: 'failed', detail: result.message || 'Gagal cek token' }
      } catch {
        return { state: 'failed', detail: 'Error checking token' }
      }
    }
    if (selectedProvider === 'galleri5') {
      try {
        const trimmed = key.trim()

        // Detect token format
        const isJwt = /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(trimmed)
        const isRefreshToken = !trimmed.includes('.') && /^[\w-]{60,}$/.test(trimmed)
        let isJsonHeaders = false
        let authHeaders: Record<string, string> | null = null
        try {
          const parsed = JSON.parse(trimmed)
          if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0) {
            authHeaders = parsed
            isJsonHeaders = true
          }
        } catch {}

        if (!isJwt && !isRefreshToken && !isJsonHeaders) {
          return { state: 'invalid', detail: 'Format tidak dikenal. Harus: (1) refresh token AMf-..., (2) ID token eyJ..., atau (3) JSON auth headers.' }
        }

        // Build auth headers from whatever format
        if (isRefreshToken) {
          // Refresh token — resolve to access token first
          try {
            const { default: galleri5 } = await import('@/lib/galleri5')
            const resolved = await galleri5.getGalleri5AuthHeaders()
            if (!resolved) return { state: 'invalid', detail: 'Refresh token tidak bisa di-resolve. Pastikan token benar (AMf-... dari aistudio.galleri5.com).' }
            authHeaders = resolved
          } catch {
            return { state: 'invalid', detail: 'Gagal resolve refresh token. Pastikan token dari aistudio.galleri5.com.' }
          }
        } else if (isJwt) {
          // JWT ID token — wrap as auth header
          authHeaders = { Accept: '*/*', Authorization: `Bearer ${trimmed}` }
        }
        // else: authHeaders already parsed from JSON

        if (!authHeaders) {
          return { state: 'invalid', detail: 'Gagal memproses token.' }
        }

        const result = await checkGalleri5Balance(authHeaders)
        if (result.ok) {
          const bal = result.balance
          if (bal !== null && bal !== undefined) {
            if (bal > 0) {
              return { state: 'active', balance: bal, detail: `${result.email || ''} · ${result.plan || ''} · Balance: ${bal} cr` }
            } else if (bal === 0) {
              return { state: 'empty', balance: 0, detail: `${result.email || ''} · Balance: 0 — habis` }
            }
          }
          return { state: 'active', detail: `${result.email || 'Token valid'} · ${result.plan || ''}` }
        }
        if (isGalleri5TokenError(result.error || '')) {
          return { state: 'invalid', detail: result.error || 'Token expired / tidak valid' }
        }
        return { state: 'failed', detail: result.error || 'Gagal cek token' }
      } catch {
        return { state: 'failed', detail: 'Error checking token' }
      }
    }
    return { state: 'unknown', detail: 'Cek limit belum tersedia untuk provider ini' }
  }, [selectedProvider])

  const handleCheckAll = useCallback(async () => {
    if (savedKeys.length === 0) return
    setChecking(true)
    const newStatusMap: typeof statusMap = {}
    const providerKeys = keys[selectedProvider as ProviderId] || []
    const concurrency = 5

    // Mark all as checking first
    for (const key of savedKeys) {
      newStatusMap[key] = { state: 'checking' }
    }
    setStatusMap({ ...newStatusMap })

    // Run checks in parallel batches
    let completed = 0
    for (let i = 0; i < savedKeys.length; i += concurrency) {
      const batch = savedKeys.slice(i, i + concurrency)
      const results = await Promise.allSettled(
        batch.map(async (key) => {
          const result = await handleCheckKey(key)
          return { key, result }
        })
      )
      for (const r of results) {
        if (r.status === 'fulfilled') {
          newStatusMap[r.value.key] = r.value.result
          // Persist balance/status to provider store
          const keyObj = providerKeys.find(k => k.key === r.value.key)
          if (keyObj) {
            const res = r.value.result
            const newStatus = res.state === 'active' ? 'active'
              : res.state === 'empty' ? 'empty'
              : res.state === 'invalid' ? 'invalid'
              : res.state === 'limited' ? 'rate-limited'
              : 'unknown'
            updateKeyStatus(selectedProvider as ProviderId, keyObj.id, newStatus as any, res.balance, res.email)
          }
        }
        completed++
      }
      setStatusMap({ ...newStatusMap })
      setProgress({
        show: true,
        pct: Math.round((completed / savedKeys.length) * 100),
        text: `Cek ${completed}/${savedKeys.length}`,
      })
    }

    const activeCount = Object.values(newStatusMap).filter(s => s.state === 'active').length
    const limitedCount = Object.values(newStatusMap).filter(s => s.state === 'limited').length
    const invalidCount = Object.values(newStatusMap).filter(s => s.state === 'invalid' || s.state === 'failed').length

    setProgress({ show: false, pct: 0, text: '' })
    setChecking(false)

    setSummaryPayload({
      title: `Ringkasan Cek ${currentConfig?.label || selectedProvider}`,
      rows: [
        { label: 'Total key dicek', value: savedKeys.length },
        { label: 'Aktif', value: activeCount, tone: 'ok' },
        { label: 'Rate-limited', value: limitedCount, tone: limitedCount ? 'warn' : 'muted' },
        { label: 'Invalid / ditolak', value: invalidCount, tone: invalidCount ? 'bad' : 'muted' },
      ],
    })
  }, [savedKeys, selectedProvider, handleCheckKey, currentConfig, keys, updateKeyStatus])

  return (
    <PageContent>
      <PageHeader
        eyebrow="Manage"
        title="Token / API"
        highlight="Manager"
        desc="Pusat kelola semua API key & token. Tersimpan terenkripsi di akun kamu — auto sync di semua perangkat."
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="w-full lg:w-[calc(66.666%-0.5rem)] relative">
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="group relative w-full overflow-hidden rounded-xl p-[2px] text-left"
            aria-haspopup="listbox"
            aria-expanded={dropdownOpen}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 h-[260%] w-[160%] -translate-x-1/2 -translate-y-1/2 animate-[spin_5s_linear_infinite] opacity-90"
              style={{
                background: `conic-gradient(from 0deg, transparent 0deg, transparent 200deg, #d4a017 280deg, #ffd700 315deg, #d4a017 340deg, transparent 360deg)`,
              }}
            />
            <span
              className="relative flex min-h-[84px] items-center justify-between gap-3 rounded-[10px] bg-[#0a0a0a] px-5 py-4 border border-[#2a2a2a]"
              style={{ boxShadow: 'inset 0 0 40px rgba(212, 160, 23, 0.15)' }}
            >
              <span className="min-w-0">
                <span
                  className="block truncate font-display text-2xl md:text-3xl font-black tracking-wide gold-text"
                >
                  {currentConfig?.label || selectedProvider}
                </span>
              </span>
              <ChevronDown className={`h-5 w-5 shrink-0 text-[#a0a0a0] transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </span>
          </button>

          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setDropdownOpen(false)} aria-hidden="true" />
              <ul
                role="listbox"
                className="absolute left-0 right-0 top-full mt-2 z-40 grid grid-cols-1 md:grid-cols-2 gap-2 rounded-2xl border border-[#2a2a2a] bg-[#0a0a0a] p-2 shadow-2xl max-h-[60vh] overflow-y-auto"
                style={{ boxShadow: '0 0 30px rgba(212, 160, 23, 0.1)' }}
              >
                {PROVIDER_LIST.map(p => {
                  const isActive = p.key === selectedProvider
                  const color = PROVIDER_COLORS[p.key]
                  const providerMap: Record<string, ProviderId> = {
                    brain: 'gemini',
                    weavy: 'weavy',
                    wavespeed: 'wavespeed',
                    roboneo: 'roboneo',
                    runninghub: 'runninghub',
                    framia: 'framia',
                    leonardo: 'leonardo',
                    createpulse: 'createpulse',
                    galleri5: 'galleri5',
                  }
                  const providerId = providerMap[p.key]
                  const isMaint = providerId ? isProviderMaintenance(providerId) : false
                  return (
                    <li key={p.key}>
                      <button
                        type="button"
                        onClick={() => { setSelectedProvider(p.key); setDropdownOpen(false) }}
                        className="w-full text-left rounded-xl border px-4 py-3 transition hover:bg-[#1a1a1a]"
                        style={{
                          borderColor: isActive ? '#d4a017' : isMaint ? '#f97316' : '#2a2a2a',
                          boxShadow: isActive ? '0 0 18px rgba(212, 160, 23, 0.3)' : isMaint ? '0 0 12px rgba(249, 115, 22, 0.2)' : 'inset 0 0 0 1px rgba(212, 160, 23, 0.05)',
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ 
                              background: isMaint ? '#f97316' : isActive ? '#d4a017' : color,
                              boxShadow: isMaint ? '0 0 10px rgba(249, 115, 22, 0.5)' : isActive ? '0 0 10px rgba(212, 160, 23, 0.5)' : `0 0 6px ${color}66`
                            }}
                          />
                          <span className="text-sm font-semibold text-[#f5f5f5]">{p.label}</span>
                          {isMaint && (
                            <span className="ml-auto inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">
                              <Wrench className="h-2.5 w-2.5" />
                              MAINTENANCE
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 w-full md:w-auto justify-end">
          <button
            onClick={() => setTokenBankOpen(true)}
            className="relative inline-flex items-center gap-1.5 rounded-full border border-[#d4a017]/50 bg-gradient-to-r from-[#d4a017]/20 via-[#d4a017]/10 to-[#d4a017]/20 text-[#ffd700] px-3.5 py-2 text-xs md:text-sm font-semibold md:font-bold md:px-5 md:py-2.5 shadow-[0_0_14px_rgba(212,160,23,0.35)] md:shadow-[0_0_20px_rgba(212,160,23,0.55)] hover:shadow-[0_0_28px_rgba(212,160,23,0.75)] hover:scale-[1.02] transition-all"
            title="Beli token dari Token Bank"
          >
            <ShoppingCart className="h-3.5 w-3.5 md:h-4 md:w-4" />
            Beli Token
          </button>
          <button
            onClick={() => setViewHidden(!viewHidden)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/50 px-3 py-1.5 text-xs font-medium hover:bg-sidebar-accent/40"
            title={viewHidden ? 'Tampilkan daftar key' : 'Sembunyikan daftar key'}
          >
            {viewHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {viewHidden ? 'View' : 'Hide'}
          </button>
        </div>
      </div>

      {/* Maintenance Banner */}
      {isCurrentMaintenance && (
        <div className="mb-4 p-4 rounded-xl border border-orange-500/50 bg-orange-500/10">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-orange-500/20 flex items-center justify-center shrink-0">
              <Wrench className="h-4 w-4 text-orange-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-orange-300">
                {currentConfig?.label || selectedProvider} sedang dalam Maintenance
              </div>
              {currentMaintenanceMessage ? (
                <div className="text-xs text-orange-200/70 mt-1 leading-relaxed">
                  {currentMaintenanceMessage}
                </div>
              ) : (
                <div className="text-xs text-orange-200/70 mt-1">
                  Provider ini sedang dalam pemeliharaan. Beberapa fitur mungkin tidak tersedia sementara.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {viewHidden ? (
            <div className="neumorph p-6 flex flex-col items-center text-center gap-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[#a0a0a0]">
                {currentConfig?.label || selectedProvider}
              </div>
              <div className="font-display text-3xl gold-text">{savedKeys.length}</div>
              <div className="text-xs text-[#a0a0a0]">key tersimpan (tersembunyi). Klik View untuk kelola / tambah key.</div>
              <button
                onClick={() => setViewHidden(false)}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-[#0a0a0a] gold-gradient"
              >
                <Eye className="h-3.5 w-3.5" />
                View {savedKeys.length > 0 ? `(${savedKeys.length})` : ''}
              </button>
            </div>
          ) : (
            <div className="neumorph p-4 space-y-3">
              <Textarea
                rows={6}
                value={bulkMode ? bulkText : inputValue}
                onChange={e => bulkMode ? setBulkText(e.target.value) : setInputValue(e.target.value)}
                placeholder={bulkMode
                  ? `token 1\ntoken 2\ntoken 3`
                  : `${TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE]?.prefix || 'API key...'}`
                }
                className="font-mono text-xs bg-[#0a0a0a] border-[#2a2a2a] text-[#f5f5f5] placeholder-[#666666] focus:border-[#d4a017] focus:ring-[#d4a017]/30"
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={bulkMode ? handleBulkUpload : handleAddKey} disabled={bulkMode ? !bulkText.trim() : !inputValue.trim()} className="gold-gradient text-[#0a0a0a] hover:opacity-90">
                  <Plus className="h-3.5 w-3.5" /> Tambah
                </Button>
                <Button variant="outline" onClick={() => setBulkMode(!bulkMode)} className="border-[#2a2a2a] bg-[#1a1a1a] text-[#f5f5f5] hover:bg-[#2a2a2a] hover:border-[#d4a017]/50">
                  <Upload className="h-3.5 w-3.5" /> {bulkMode ? 'Single' : 'Bulk'}
                </Button>
                <Button variant="outline" onClick={handleCheckAll} disabled={checking || savedKeys.length === 0} className="border-[#2a2a2a] bg-[#1a1a1a] text-[#f5f5f5] hover:bg-[#2a2a2a] hover:border-[#d4a017]/50">
                  {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Cek Limit & Status
                </Button>
                <Button variant="destructive" onClick={handleDeleteAll} disabled={savedKeys.length === 0}>
                  <Trash2 className="h-3.5 w-3.5" /> Hapus Semua
                </Button>
              </div>

              {selectedProvider === 'runninghub' && (
                <div className="neumorph p-3 space-y-2">
                  <label className="text-[10px] font-mono uppercase tracking-widest text-[#a0a0a0]">
                    Workflow ID (Opsional — default: Markasflow-V2 bawaan)
                  </label>
                  <Input
                    value={workflowId}
                    onChange={e => setWorkflowId(e.target.value)}
                    placeholder="Default: 2084995158336192513"
                    className="font-mono text-xs bg-[#0a0a0a] border-[#2a2a2a] text-[#f5f5f5] placeholder-[#666666] focus:border-[#d4a017] focus:ring-[#d4a017]/30"
                  />
                  <p className="text-[10px] text-[#666666]">
                    Kosongkan untuk pakai workflow bawaan. Isi hanya jika ingin pakai workflow custom dari RunningHub.
                  </p>
                </div>
              )}

              {progress.show && (
                <div className="rounded-md border border-[#2a2a2a] bg-[#141414] p-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1a1a1a]">
                    <div className="h-full gold-gradient transition-all" style={{ width: `${progress.pct}%` }} />
                  </div>
                  <div className="mt-1 text-[10px] text-[#a0a0a0]">{progress.text}</div>
                </div>
              )}

              {savedKeys.length > 0 && (
                <div className="mt-1 space-y-1.5">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#a0a0a0]">
                    Key tersimpan ({savedKeys.length})
                  </div>
                  {savedKeys.map((key, i) => {
                    const keyObj = keys[selectedProvider as ProviderId]?.[i]
                    const status = statusMap[key]
                    const state = status?.state || keyObj?.status || 'unknown'
                    const balance = status?.balance ?? keyObj?.balance
                    const email = status?.email ?? keyObj?.email
                    const detail = status?.detail || (email ? `${email}${keyObj?.balance != null ? ` · ${keyObj.balance} cr` : ''}` : null)
                    const isWeavy = selectedProvider === 'weavy'
                    const isEditing = editingBalanceIdx === i
                    const isActive = state === 'active'
                    const isEmpty = state === 'empty' || (isWeavy && balance === 0)
                    const dotColor = isEmpty ? 'bg-red-500' : isActive ? 'bg-green-500' : state === 'checking' ? 'bg-yellow-500 animate-pulse' : 'bg-gray-500'
                    return (
                      <div key={i} className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 ${isActive ? 'border-green-500/30 bg-green-500/5' : isEmpty ? 'border-red-500/20 bg-red-500/5' : 'border-[#2a2a2a] bg-[#141414]'}`}>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                          {isWeavy ? (
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-mono text-[#f5f5f5]/85 truncate" title={key}>{maskKey(key)}</div>
                              {detail && (
                                <div className="text-[10px] text-[#a0a0a0] truncate mt-0.5">{detail}</div>
                              )}
                            </div>
                          ) : (
                            <code className="text-[11px] font-mono text-[#f5f5f5]/85 truncate">{maskKey(key)}</code>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isWeavy && (
                            <>
                              {balance != null ? (
                                <span
                                  className={`text-[11px] font-mono font-bold cursor-pointer hover:underline ${balance > 0 ? 'text-green-400' : 'text-red-400'}`}
                                  onClick={() => { setEditingBalanceIdx(i); setEditingBalanceVal(String(balance)) }}
                                  title="Klik untuk edit balance"
                                >
                                  {balance.toLocaleString()} cr
                                </span>
                              ) : !isEditing ? (
                                <button
                                  onClick={() => { setEditingBalanceIdx(i); setEditingBalanceVal('') }}
                                  className="text-[10px] text-[#d4a017] hover:text-[#f5f5f5] underline underline-offset-2 transition cursor-pointer"
                                  title="Input manual balance"
                                >
                                  ??? cr
                                </button>
                              ) : null}
                              {isEditing && (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    value={editingBalanceVal}
                                    onChange={e => setEditingBalanceVal(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        const val = parseInt(editingBalanceVal)
                                        if (!isNaN(val) && val >= 0 && keyObj) {
                                          updateKeyStatus(selectedProvider as ProviderId, keyObj.id, keyObj.status || 'active', val)
                                        }
                                        setEditingBalanceIdx(null)
                                      }
                                      if (e.key === 'Escape') setEditingBalanceIdx(null)
                                    }}
                                    placeholder="0"
                                    autoFocus
                                    className="w-20 text-[10px] font-mono bg-[#0a0a0a] border border-[#d4a017] text-[#f5f5f5] px-1.5 py-0.5 rounded focus:outline-none focus:border-[#f5f5f5]"
                                  />
                                  <button
                                    onClick={() => {
                                      const val = parseInt(editingBalanceVal)
                                      if (!isNaN(val) && val >= 0 && keyObj) {
                                        updateKeyStatus(selectedProvider as ProviderId, keyObj.id, keyObj.status || 'active', val)
                                      }
                                      setEditingBalanceIdx(null)
                                    }}
                                    className="text-[10px] text-[#22c55e] hover:text-[#4ade80] transition"
                                    title="Simpan"
                                  >
                                    <Check className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={() => setEditingBalanceIdx(null)}
                                    className="text-[10px] text-[#a0a0a0] hover:text-[#f5f5f5] transition"
                                    title="Batal"
                                  >
                                    <XCircle className="h-3 w-3" />
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                          {!isWeavy && detail && (
                            <span className="text-[10px] text-[#a0a0a0] truncate max-w-[220px]">{detail}</span>
                          )}
                          {!isWeavy && !detail && (
                            <span className="text-[10px] text-[#a0a0a0] truncate max-w-[220px]">—</span>
                          )}
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getStatusColor(state)}`}>
                            {getStatusLabel(state)}
                          </span>
                          <button
                            onClick={() => {
                              if (keyObj) removeKey(selectedProvider as ProviderId, keyObj.id)
                              setStatusMap(prev => {
                                const next = { ...prev }
                                delete next[key]
                                return next
                              })
                            }}
                            className="inline-flex items-center gap-1 rounded-full border border-[#2a2a2a] bg-[#1a1a1a] px-1.5 py-0.5 text-[10px] text-[#a0a0a0] hover:text-[#dc2626] hover:border-[#dc2626]/50 transition"
                            title="Hapus key ini"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="neumorph p-4 h-fit">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[#a0a0a0]">Info</div>
          <div className="mt-1 font-display text-base text-[#f5f5f5] gold-text">{currentConfig?.label}</div>
          <p className="mt-2 text-xs text-[#a0a0a0] leading-relaxed">{currentConfig?.desc}</p>

          <div className="mt-4 rounded-lg border border-[#2a2a2a] bg-[#141414] p-3 text-[11px] leading-relaxed text-[#a0a0a0]">
            🔒 Key dienkripsi (AES-GCM) di database akunmu & cache browser dipisahkan per akun. Otomatis tersinkron ketika kamu login di perangkat lain.
          </div>

          {(() => {
            const providerKeys = keys[selectedProvider as ProviderId] || []
            const totalBalance = providerKeys.reduce((sum, k) => sum + (k.balance ?? 0), 0)
            const activeCount = providerKeys.filter(k => k.status === 'active').length
            const isWeavyPool = selectedProvider === 'weavy'
            if (providerKeys.length === 0) return null
            return (
              <div className="mt-3 rounded-lg border border-[#d4a017]/30 bg-[#d4a017]/5 p-3">
                <div className="text-[10px] font-mono uppercase tracking-widest text-[#d4a017]/80">Pool Summary</div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-2xl font-black gold-text">
                    {isWeavyPool && totalBalance === 0 ? '???' : totalBalance.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-[#a0a0a0]">credits total</span>
                </div>
                <div className="mt-1 text-[11px] text-[#a0a0a0]">
                  {activeCount} active / {providerKeys.length} keys
                  {isWeavyPool && totalBalance === 0 && (
                    <span className="ml-2 text-[#d4a017]">· Balance tidak tersedia untuk Free tier</span>
                  )}
                </div>
              </div>
            )
          })()}

              {TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE] && (
            <div className="mt-4 rounded-lg border border-[#d4a017]/30 bg-[#d4a017]/5 p-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[#d4a017]/80">Cara Dapat Token</div>
              <a
                href={TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE].url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1.5 text-sm text-[#ffd700] hover:underline font-medium break-all"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                {TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE].urlLabel}
              </a>
              {TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE].prefix && (
                <div className="mt-1 text-[10px] text-[#a0a0a0]">
                  Format key: <code className="text-[#f5f5f5]/85">{TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE].prefix}</code>
                </div>
              )}
              <ol className="mt-2.5 list-decimal pl-4 space-y-1.5 text-[11px] text-[#a0a0a0] leading-relaxed">
                {TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE].steps.map((step, i) => (
                  <li key={i}>
                    {step.text}
                    {step.link && (
                      <a href={step.link.url} target="_blank" rel="noreferrer" className="text-[#ffd700] underline hover:text-[#d4a017]/80">
                        {step.link.label}
                      </a>
                    )}
                    {step.code && (
                      <pre className="mt-1 rounded-md bg-[#050505] border border-[#2a2a2a] p-2 overflow-x-auto text-[9px] font-mono text-[#f5f5f5]/80 whitespace-pre-wrap break-all">
                        {step.code}
                      </pre>
                    )}
                  </li>
                ))}
              </ol>
              {TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE].tip && (
                <div className="mt-2.5 rounded-md bg-[#d4a017]/10 border border-[#d4a017]/30 p-2 text-[10.5px] text-[#ffd700]/90 leading-relaxed">
                  💡 {TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE].tip}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {summaryPayload && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150" onClick={() => setSummaryPayload(null)}>
          <div onClick={e => e.stopPropagation()} className="neumorph w-full max-w-md p-6 relative animate-in zoom-in-95 duration-200" style={{ background: '#0a0a0a' }}>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="h-9 w-9 rounded-full grid place-items-center shrink-0 gold-gradient">
                <Check className="h-5 w-5 text-[#0a0a0a]" />
              </div>
              <div className="font-display text-lg text-[#f5f5f5] gold-text">{summaryPayload.title}</div>
            </div>
            <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] divide-y divide-[#2a2a2a]">
              {summaryPayload.rows.map((row, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3.5 py-2 text-[12.5px]">
                  <span className="text-[#a0a0a0]">{row.label}</span>
                  <span className={`font-semibold font-mono tabular-nums ${row.tone === 'ok' ? 'text-emerald-400' : row.tone === 'warn' ? 'text-amber-300' : row.tone === 'bad' ? 'text-rose-400' : row.tone === 'muted' ? 'text-[#a0a0a0]' : 'text-[#f5f5f5]'}`}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
            {summaryPayload.footer && (
              <div className="mt-3 text-[11px] text-[#a0a0a0] text-center leading-relaxed">{summaryPayload.footer}</div>
            )}
            <div className="mt-5 flex justify-center">
              <Button onClick={() => setSummaryPayload(null)} className="min-w-[120px] justify-center gold-gradient text-[#0a0a0a]">OK</Button>
            </div>
          </div>
        </div>
      )}

      {tokenBankOpen && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150" onClick={() => setTokenBankOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="neumorph w-full max-w-md p-6 relative animate-in zoom-in-95 duration-200" style={{ background: '#0a0a0a' }}>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="h-9 w-9 rounded-full grid place-items-center shrink-0 gold-gradient">
                <ShoppingCart className="h-5 w-5 text-[#0a0a0a]" />
              </div>
              <div className="font-display text-lg text-[#f5f5f5] gold-text">Token Bank</div>
            </div>
            <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-4 text-center">
              <p className="text-sm text-[#a0a0a0] mb-4">Beli token provider langsung dari dashboard ini.</p>
              <Button onClick={() => setTokenBankOpen(false)} className="min-w-[120px] justify-center gold-gradient text-[#0a0a0a]">OK</Button>
            </div>
          </div>
        </div>
      )}
    </PageContent>
  )
}
