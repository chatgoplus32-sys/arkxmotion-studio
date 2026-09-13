import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, PageContent } from '@/components/layout'
import { Button, Input, Textarea } from '@/components/ui'
import {
  Check,
  XCircle,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  RefreshCw,
  Loader2,
  Upload,
  ShoppingCart,
  ChevronDown,
  Key,
  ExternalLink,
  Wrench,
  Wallet,
} from 'lucide-react'
import { useProviderManager, ProviderId, HIDDEN_PROVIDERS } from '@/stores/providerManager'
import { useAuthStore } from '@/stores/authStore'
import ProviderStatusBar from '@/components/providers/ProviderStatusBar'
import TokenSyncHistory from '@/components/providers/TokenSyncHistory'
import { checkRoboneoBalance } from '@/lib/roboneo'
import { fetchLeonardoBalance } from '@/lib/leonardo'
import { checkWeavyBalance } from '@/lib/weavy'
import { checkRunningHubBalance } from '@/lib/runninghub'
import { checkFireflyBalance } from '@/lib/firefly'
import { parseNexabotCookieInput, parseNexabotApiKeyInput } from '@/lib/nexabot'
import { NEXABOT_CHECK_TIMEOUT_MS } from '@/lib/nexabot-constants'
import { refreshNexabotSessionMonitor } from '@/lib/nexabotSessionMonitor'
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
  oneover: '#a78bfa',
  firefly: '#FF6A00',
  riverside: '#FF6B6B',
  nexabot: '#00D4AA',
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
  { key: 'oneover', label: 'OneOver', desc: 'Video generation (Grok, Seedance 2.0/2.5, Kling, LTX) via oneover.com — Supabase session token.' },
  { key: 'firefly', label: 'Adobe Firefly', desc: 'Video generation (Veo 3.1, Firefly Video) via firefly.adobe.com — Adobe IMS Bearer token.' },
  { key: 'genspark', label: 'Genspark AI', desc: 'Kling V3 Motion Control + 14 video models (Veo, Sora, Hailuo, PixVerse) via genspark.ai Tool API — API key (gsk-...).' },
  { key: 'riverside', label: 'Riverside', desc: 'Riverside Business API — Professional video/audio recording, editing, and production platform.' },
  { key: 'nexabot', label: 'NexaBot', desc: 'NexaBot AI via nexabot.id — Google Omni (text, image & video ref). Mode session cookie (Unlimited) atau API key (nxb_...).' },
] as const

const VISIBLE_PROVIDER_LIST = PROVIDER_LIST.filter(p => !(HIDDEN_PROVIDERS as readonly string[]).includes(p.key))

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
    prefix: 'eyJhbGci... (Auth0 access_token, BUKAN id_token eyJjdHki...)',
    steps: [
      { text: 'Klik tombol "Grab Token dari framia.converge.ai" di bawah input → script copied ke clipboard.' },
      { text: 'Buka ', link: { url: 'https://framia.converge.ai', label: 'framia.converge.ai' }, },
      { text: 'Login dengan akun Google / email.' },
      { text: 'Buka DevTools Console (F12 → Console), paste script & Enter.' },
      { text: 'Access token (eyJhbGci...) otomatis copy ke clipboard.' },
      { text: 'Paste ke input di sebelah.' },
    ],
    tip: '⚠️ Penting: Framia pakai Auth0. Token harus eyJhbGci... (access_token), BUKAN eyJjdHki... (id_token/JWE). Kalau token kamu dimulai eyJjdHki, itu salah — pakai Grab Token button.',
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
    url: 'https://www.runninghub.ai/enterprise-api/consumerApi',
    urlLabel: 'runninghub.ai/enterprise-api/consumerApi',
    prefix: 'API key (Consumer-Member atau Enterprise-Shared)',
    steps: [
      { text: 'Buka runninghub.ai dan login.' },
      { text: 'Buka halaman API Key → klik "Create API Key".' },
      { text: 'Copy API key → paste ke input di sebelah.' },
    ],
    tip: 'Model: Kling 2.6/2.1 via Workflow API (base64). Consumer-Member key sudah bisa dipakai. Untuk Kling V3, butuh Enterprise-Shared key.',
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
    prefix: 'AMf-... (refresh token) atau eyJ... (ID token) atau JSON headers — AUTO-SYNC: extension auth-helper mengirim token terbaru otomatis',
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
  oneover: {
    url: 'https://oneover.com/create/animate',
    urlLabel: 'oneover.com',
    prefix: 'JSON: { access_token, refresh_token } atau refresh_token langsung — AUTO-SYNC: extension auth-helper mengirim token terbaru otomatis',
    steps: [
      { text: 'Buka ', link: { url: 'https://oneover.com', label: 'oneover.com' }, },
      { text: 'Login dengan akun yang sudah berlangganan.' },
      { text: 'Klik tombol "Grab Token dari oneover.com" di bawah input → script copied ke clipboard.' },
      { text: 'Buka DevTools Console (F12 → Console) di oneover.com, paste script & Enter.' },
      { text: 'Token JSON (access_token + refresh_token) otomatis copy ke clipboard.' },
      { text: 'Paste ke input di sebelah — app akan auto-parse JSON & simpan refresh_token.' },
    ],
    tip: 'OneOver pakai Supabase auth. Refresh token berumur ~30 hari & auto-refresh access token. Bila generate gagal, ambil ulang token dari oneover.com.',
  },
  firefly: {
    url: 'https://firefly.adobe.com/generate/video',
    urlLabel: 'firefly.adobe.com',
    prefix: 'JSON: { token, apiKey, account, session } atau token langsung — AUTO-SYNC: extension auth-helper mengirim token terbaru otomatis (IMS ~1 jam)',
    steps: [
      { text: 'Install ekstensi "ARKX Auth Helper" dari folder extensions/auth-helper (satu ekstensi untuk semua provider).' },
      { text: 'Buka ', link: { url: 'https://firefly.adobe.com', label: 'firefly.adobe.com' }, },
      { text: 'Login dengan akun Adobe yang berlangganan Firefly.' },
      { text: 'Klik "Generate" satu kali supaya request token-nya muncul — tidak perlu Start Capture lagi.' },
      { text: 'Buka popup ARKX Auth Helper → tab Adobe Firefly → klik Scan; Bearer token langsung tertangkap dari request halaman.' },
      { text: 'Klik "Copy token" — atau "Copy JSON" kalau ingin sekalian membawa apiKey/account/session — lalu paste ke input di sebelah.' },
    ],
    tip: 'Firefly pakai Adobe IMS Bearer token. Token expire dalam ~1 jam. Bila generate gagal, ambil ulang token dari firefly.adobe.com.',
  },
  genspark: {
    url: 'https://www.genspark.ai/settings/api-keys',
    urlLabel: 'genspark.ai/settings/api-keys',
    prefix: 'gsk-... atau gsk_...',
    steps: [
      { text: 'Buka genspark.ai dan login (bisa pakai Google/GitHub).' },
      { text: 'Klik profile icon → Settings → API Keys.' },
      { text: 'Klik "Create API Key", beri nama (mis. "arkxmotion").' },
      { text: 'Klik tombol mata/eye (Show/Reveal) di samping key untuk menampilkan key.' },
      { text: 'Copy API key yang muncul (format: gsk-... atau gsk_...) → paste ke input di sebelah.' },
    ],
    tip: 'Key tersembunyi (****) sampai kamu klik tombol mata/eye. Free tier: 100 credits/hari. Kling V3 Pro ≈ 80 cr.',
  },
  riverside: {
    url: 'https://riverside.com/dashboard',
    urlLabel: 'riverside.com/dashboard',
    prefix: 'eyJ… (session JWT) — ±10 menit, tapi AUTO-SYNC: extension mengirim token terbaru otomatis',
    steps: [
      { text: 'CARA PALING GAMPANG: install extension Riverside (halaman Plugins) — token terbaru ter-sync OTOMATIS ke app tiap ±4 menit, tanpa copy-paste. Buka tab riverside.com/dashboard biar keep-alive jalan.' },
      { text: 'Alternatif manual: klik tombol "Grab Token dari riverside.com" di bawah input → script copied ke clipboard.' },
      { text: 'Buka ', link: { url: 'https://riverside.com/dashboard', label: 'riverside.com/dashboard' }, },
      { text: 'Login dengan akun Riverside (Google / email).' },
      { text: 'Buka DevTools Console (F12 → Console), paste script & Enter → token copy ke clipboard.' },
      { text: 'PASTIKAN token masih segar: session JWT Riverside cuma bertahan ±10 menit. Grab ulang kalau sudah lewat.' },
      { text: 'Paste ke input di sebelah — app otomatis deteksi formatnya.' },
      { text: 'Alternatif manual lain: F12 → Network → klik request API apa pun → Headers → salin value header "Authorization: Bearer ..." (tanpa awalan "Bearer ").' },
    ],
    tip: 'PENTING: session JWT Riverside (eyJ…) cuma bertahan ±10 menit by design. Dashboard menahan login lewat refresh endpoint cookie (/auth/refresh/reactive) yang cuma bisa dipanggil dari dalam browser yang sudah login — app ini tidak bisa me-refresh token kamu (cross-origin, tanpa cookie). Solusi paling awet: install extension Riverside v1.3+ (halaman Plugins) — dia jalan di dalam halaman dashboard, auto-refresh tiap 4 menit, lalu OTOMATIS mengirim JWT terbaru ke app lewat /api/sync-tokens. App polling tiap 30 detik dan langsung mengganti key yang expired — token kamu praktis tidak pernah mati selama tab dashboard kebuka. Token AMf-… (Firebase) TIDAK dipakai Riverside — itu punya Galleri5/layanan lain, jangan ditempel untuk Riverside.',
  },
  nexabot: {
    url: 'https://nexabot.id',
    urlLabel: 'nexabot.id',
    prefix: 'nxb_...',
    steps: [
      { text: 'OPSI 1 — PAKET UNLIMITED (disarankan): login nexabot.id di browser, lalu isi panel “Session Login Unlimited (cookie)” di bawah (paste document.cookie). Generate otomatis lewat /api/v1/generate dan tidak dipotong kredit.' },
      { text: 'OPSI 2 — API key (pay-as-you-go): buka nexabot.id → Dashboard → API Keys → Create API Key.' },
      { text: 'Copy API key (format: nxb_...) → paste ke input di samping.' },
      { text: 'Top up saldo minimal 0.25 credits di menu Top Up (hanya untuk mode API key).' },
    ],
    tip: 'NexaBot punya satu model: Google Omni — tipe video ditentukan otomatis dari input (teks / gambar / video referensi). ADA DUA JALUR: (a) SESSION COOKIE dari login web dikirim ke /api/v1/generate — kalau akun yang login punya paket Unlimited, generate TIDAK dipotong kredit; (b) API KEY (nxb_...) lewat /api/v1/api — selalu pay-as-you-go 0.25 cr/request walau Unlimited aktif. Kalau key punya cookie, app otomatis memakai jalur session. Cookie bisa kedaluwarsa: kalau muncul error session, login ulang di nexabot.id dan paste cookie baru.',
  },
}

function maskKey(key: string): string {
  if (key.length <= 12) return key
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

/** "5 menit lalu" dari timestamp penyimpanan cookie sesi. */
function formatAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s} dtk lalu`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} menit lalu`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} jam lalu`
  return `${Math.floor(h / 24)} hari lalu`
}

/** NexaBot: input berupa blob cURL/JSON (satu key), bukan daftar 1-key-per-baris. */
function nexabotInputIsBlob(text: string): boolean {
  return /(^|\s)curl\b/i.test(text)
    || /x-api-key\s*[:=]/i.test(text)
    || /"headers"\s*:/i.test(text)
    || /\{\s*"cookie"/i.test(text)
}

/** "12 Sep 2026, 15.30 (6 jam 20 menit lagi)" untuk masa berlaku paket. */
function formatUntil(ms: number): string {
  const date = new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
  const diff = ms - Date.now()
  if (diff <= 0) return `${date} (sudah berakhir)`
  const mins = Math.floor(diff / 60000)
  const left = mins >= 1440
    ? `${Math.floor(mins / 1440)} hari ${Math.floor((mins % 1440) / 60)} jam`
    : mins >= 60
    ? `${Math.floor(mins / 60)} jam ${mins % 60} menit`
    : `${Math.max(1, mins)} menit`
  return `${date} (${left} lagi)`
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'active': return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
    case 'limited': return 'text-amber-300 bg-blue-500/10 border-blue-500/30'
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

// Genspark Session Cookies Input Component
function GensparkCookiesInput({ providerKeys, setKeyCookies }: {
  providerKeys: { id: string; key: string; status?: string; cookies?: string }[]
  setKeyCookies: (provider: string, keyId: string, cookies: string) => void
}) {
  const [input, setInput] = useState('')
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    if (!input.trim() || providerKeys.length === 0) return
    // Save cookies to the first active key
    const key = providerKeys.find(k => k.status === 'active') || providerKeys[0]
    if (key) {
      setKeyCookies('genspark', key.id, input.trim())
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return (
    <div className="mt-3 rounded-md bg-blue-500/10 border border-blue-500/30 p-3">
      <div className="text-[12px] font-semibold text-blue-400 mb-1.5">🍪 Session Cookies (untuk ask_proxy)</div>
      <div className="text-[11px] text-[#a0a0a0] mb-2 leading-relaxed">
        Buka <a href="https://www.genspark.ai" target="_blank" className="text-blue-400 underline">genspark.ai</a> (login), buka Console (F12), jalankan:
        <code className="block mt-1 bg-black/40 rounded p-1.5 text-[10px] font-mono text-blue-300">document.cookie</code>
        Copy hasilnya lalu paste di bawah ini.
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Paste session cookies dari browser..."
          className="flex-1 text-[11px] font-mono bg-black/30 border border-blue-500/30 text-white px-2 py-1 rounded focus:outline-none focus:border-blue-400"
        />
        <button
          onClick={handleSave}
          className={`text-[11px] px-3 py-1 rounded font-medium transition ${saved ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30'}`}
        >
          {saved ? '✓ Saved' : 'Save'}
        </button>
      </div>
      {providerKeys[0]?.cookies && (
        <div className="mt-1.5 text-[10px] text-green-400/70">
          ✓ Cookies tersimpan ({providerKeys[0].cookies.length} chars)
        </div>
      )}
    </div>
  )
}

// NexaBot Session Cookies Input — mode login web (cookie) supaya generate lewat
// /api/v1/generate menghormati paket Unlimited (tidak dipotong 0.25 cr).
function NexabotSessionInput({ providerKeys, addKey, setKeyCookies }: {
  providerKeys: { id: string; key: string; name?: string; status?: string; cookies?: string; cookiesAt?: number }[]
  addKey: (provider: string, key: string, name?: string) => void
  setKeyCookies: (provider: string, keyId: string, cookies: string) => void
}) {
  const sessionKey = providerKeys.find(k => k.cookies)
  const [input, setInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [info, setInfo] = useState<import('@/lib/nexabot').NexabotSessionInfo | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => { setInput(sessionKey?.cookies || '') }, [sessionKey?.id, sessionKey?.cookies])

  const runCheck = useCallback(async (cookies: string) => {
    if (!cookies) { setInfo(null); return }
    setChecking(true)
    try {
      const { checkNexabotSession } = await import('@/lib/nexabot')
      setInfo(await checkNexabotSession(cookies, { timeoutMs: NEXABOT_CHECK_TIMEOUT_MS }))
    } catch (e: any) {
      setInfo({
        ok: false, active: false, unlimited: false, plan: null,
        until: null, untilMs: null, balance: null, telegramId: null, email: null,
        error: e?.message || 'Gagal cek sesi',
      })
    }
    setChecking(false)
  }, [])

  // Auto-cek saat cookie berubah supaya user tahu sesi masih aktif sebelum generate.
  useEffect(() => {
    const cookies = sessionKey?.cookies || ''
    if (!cookies) { setInfo(null); return }
    runCheck(cookies)
  }, [sessionKey?.id, sessionKey?.cookies, runCheck])

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text?.trim()) setInput(text.trim())
    } catch {
      alert('Tidak bisa baca clipboard otomatis (izin ditolak). Klik kolom input lalu tekan Ctrl+V, atau aktifkan izin clipboard di browser.')
    }
  }

  const handleSave = () => {
    // Terima cookie mentah, header `Cookie:`, hasil “Copy as cURL”, atau JSON.
    const cookies = parseNexabotCookieInput(input)
    if (!cookies) return
    let keyId = sessionKey?.id
    if (!keyId) {
      // Belum ada key → buat satu key khusus session (tanpa API key).
      addKey('nexabot', '', 'Session (cookie)')
      keyId = useProviderManager.getState().keys.nexabot.slice(-1)[0]?.id
    }
    if (!keyId) return
    setKeyCookies('nexabot', keyId, cookies)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    // Cookie baru langsung dievaluasi pemantau: kalau sesi sehat, peringatan
    // "sesi mendekati kedaluwarsa" yang lama ikut direset tanpa menunggu tick.
    void refreshNexabotSessionMonitor()
  }

  return (
    <div className="mt-3 rounded-md border border-[#00D4AA]/30 bg-[#00D4AA]/10 p-3">
      <div className="text-[12px] font-semibold text-[#00D4AA] mb-1.5">🍪 Session Login Unlimited (cookie)</div>
      <div className="text-[11px] text-[#a0a0a0] mb-2 leading-relaxed">
        <b className="text-[#00D4AA]">Cara termudah:</b> install extension <b>NexaBot</b> di halaman <b>Plugins</b>, buka nexabot.id &amp; login — cookie sesi (termasuk <b>HttpOnly</b>) otomatis terkirim ke panel ini, tanpa copy-paste. Extension mengambil izin sync dari tab app yang sudah login, jadi di app yang dideploy cukup pastikan tab app ini tetap terbuka. Kasus manual: Login <a href="https://nexabot.id" target="_blank" className="text-[#00D4AA] underline">nexabot.id</a> (akun paket Unlimited) → DevTools (F12) → tab <b>Network</b> → klik request apa pun ke nexabot.id → klik kanan → <b>Copy → Copy as cURL (bash)</b>.
        <code className="block mt-1 bg-black/40 rounded p-1.5 text-[10px] font-mono text-[#00D4AA] break-all">curl 'https://nexabot.id/api/v1/credits' -H 'cookie: …'</code>
        Paste hasilnya di bawah — app mengambil header <span className="font-mono">Cookie</span> otomatis. Generate lalu lewat <span className="font-mono">/api/v1/generate</span> tanpa potong kredit.
        <div className="mt-1 text-[10px] text-amber-300/85">⚠ <span className="font-mono">document.cookie</span> sering tidak cukup: cookie sesi biasanya <b>HttpOnly</b> sehingga tidak muncul di Console. Extension NexaBot membaca cookie itu lewat API <span className="font-mono">chrome.cookies</span>; kalau belum pakai extension, gunakan <b>Copy as cURL</b>.</div>
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Paste cookie / header Cookie / Copy as cURL…"
          className="flex-1 text-[11px] font-mono bg-black/30 border border-[#00D4AA]/30 text-white px-2 py-1 rounded focus:outline-none focus:border-[#00D4AA]"
        />
        <button
          onClick={handlePaste}
          className="text-[11px] px-3 py-1 rounded font-medium border border-[#00D4AA]/30 bg-black/20 text-[#00D4AA] hover:bg-[#00D4AA]/20"
        >📋 Tempel</button>
        <button
          onClick={handleSave}
          className={`text-[11px] px-3 py-1 rounded font-medium transition ${saved ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-[#00D4AA]/20 text-[#00D4AA] border border-[#00D4AA]/30 hover:bg-[#00D4AA]/30'}`}
        >
          {saved ? '✓ Saved' : 'Simpan Sesi'}
        </button>
      </div>
      {sessionKey?.cookies && (
        <div className="mt-2 rounded-md border border-[#2a2a2a] bg-black/20 p-2 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-[#a0a0a0]">
              Cookie tersimpan {sessionKey.cookies.length} chars{sessionKey.cookiesAt ? ` · ${formatAgo(sessionKey.cookiesAt)}` : ''}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => runCheck(sessionKey.cookies || '')}
                disabled={checking}
                className="text-[10px] text-[#00D4AA] hover:text-[#00D4AA]/80 disabled:opacity-50"
              >{checking ? 'Cek…' : 'Cek ulang'}</button>
              <button
                onClick={() => { setKeyCookies('nexabot', sessionKey.id, ''); setInput(''); setInfo(null) }}
                className="text-[10px] text-rose-300 hover:text-rose-200"
              >Hapus</button>
            </div>
          </div>
          {checking && !info && (
            <div className="text-[10.5px] text-[#a0a0a0]">⏳ Mengecek status sesi…</div>
          )}
          {info?.ok && info.active && (
            <div className="text-[10.5px] leading-relaxed">
              {info.unlimited
                ? <span className="text-emerald-400 font-semibold">✓ Paket UNLIMITED aktif — generate lewat /api/v1/generate tanpa potong kredit</span>
                : <span className="text-amber-300">Sesi aktif, tapi paket Unlimited tidak terdeteksi — generate bisa tetap dipotong kredit</span>}
              <div className="text-[10px] text-[#a0a0a0] mt-0.5">
                {info.plan && <>Paket: <span className="font-mono">{info.plan}</span> · </>}
                {info.untilMs && <>Berlaku sampai <span className="font-mono">{formatUntil(info.untilMs)}</span> · </>}
                {info.balance != null && <>Saldo API: {info.balance} cr · </>}
                {info.email || info.telegramId || 'akun sesi'}
              </div>
            </div>
          )}
          {info?.ok && !info.active && (
            <div className="text-[10.5px] text-rose-300">
              ⚠ Masa berlaku sesi/paket sudah berakhir — login ulang di nexabot.id lalu paste cookie baru.
            </div>
          )}
          {info && !info.ok && (
            <div className="text-[10.5px] text-rose-300">
              ⚠ {info.error || 'Status sesi belum bisa dipastikan'}
              <span className="text-[#a0a0a0]"> — coba “Cek ulang” atau generate langsung.</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// NexaBot Telegram ID Input — NexaBot menagihkan biaya API (`credit_cost`, 0.25 cr)
// ke `telegram_id` yang dikirim saat submit (docs: "user id for credit billing").
// Paket Unlimited (1 Hari/2 Hari/…) terikat ke akun Telegram, jadi kalau paket
// ada di akun Telegram lain, ID-nya diisi di sini.
function NexabotTelegramInput({ providerKeys, setKeyTelegramId }: {
  providerKeys: { id: string; key: string; status?: string; telegramId?: string; cookies?: string }[]
  setKeyTelegramId: (provider: string, keyId: string, telegramId: string) => void
}) {
  const key = providerKeys.find(k => k.status === 'active' || k.status === 'unknown') || providerKeys[0]
  const [input, setInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [checking, setChecking] = useState(false)
  const [detected, setDetected] = useState<{ telegramId: string | null; registered: boolean; balance: number | null; error?: string } | null>(null)

  useEffect(() => { setInput(key?.telegramId || '') }, [key?.id, key?.telegramId])

  if (!key) return null

  const handleSave = () => {
    setKeyTelegramId('nexabot', key.id, input.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleDetect = async () => {
    setChecking(true)
    setDetected(null)
    try {
      const { checkNexabotBalance } = await import('@/lib/nexabot')
      const res = await checkNexabotBalance(key.key, { timeoutMs: NEXABOT_CHECK_TIMEOUT_MS })
      setDetected({
        telegramId: res.telegramId ?? null,
        registered: res.registered === true,
        balance: res.balance,
        error: res.ok ? undefined : res.error,
      })
    } catch (e: any) {
      setDetected({ telegramId: null, registered: false, balance: null, error: e?.message || 'Gagal cek akun' })
    }
    setChecking(false)
  }

  return (
    <div className="mt-3 rounded-md border border-[#2a2a2a] bg-[#141414] p-3 space-y-2">
      <div className="text-[12px] font-mono uppercase tracking-widest text-[#a0a0a0]">Telegram ID pemilik paket (opsional)</div>
      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="cth. 81334531"
          className="flex-1 rounded-md border border-[#2a2a2a] bg-[#0a0a0a] px-2.5 py-1.5 text-[12px] font-mono text-[#f5f5f5] outline-none focus:border-[#00a8ff]/60"
        />
        <button
          onClick={handleSave}
          className="rounded-md border border-[#00a8ff]/40 bg-[#00a8ff]/10 px-3 py-1.5 text-[11px] font-semibold text-[#00d4ff] hover:bg-[#00a8ff]/20"
        >
          {saved ? 'Tersimpan ✓' : 'Simpan'}
        </button>
        <button
          onClick={handleDetect}
          disabled={checking || !!key.cookies}
          className="rounded-md border border-[#2a2a2a] px-3 py-1.5 text-[11px] text-[#a0a0a0] hover:text-[#f5f5f5] disabled:opacity-50"
        >
          {checking ? 'Cek…' : 'Cek akun key'}
        </button>
      </div>
      {!!key.cookies && (
        <div className="text-[10.5px] text-emerald-400/80">
          Mode session aktif — cek saldo tidak berlaku (paket Unlimited lewat /api/v1/generate).
        </div>
      )}
      {detected && (
        <div className="text-[10.5px] text-[#a0a0a0]">
          {detected.error
            ? <>Gagal cek: <span className="text-rose-300">{detected.error}</span></>
            : <>Key ini terikat ke Telegram ID <span className="font-mono text-[#00d4ff]">{detected.telegramId || '—'}</span>{detected.registered ? ' (terdaftar)' : ' (belum terdaftar)'} · saldo {detected.balance ?? '—'} cr</>}
        </div>
      )}
      <div className="text-[10.5px] text-[#a0a0a0] leading-relaxed">
        NexaBot memotong <span className="text-[#00d4ff]">0.25 cr/request</span> dari saldo akun Telegram pemilik API key ini — biaya ini dipotong oleh NexaBot, bukan oleh ARKXMotion. Kalau paket Unlimited kamu ada di akun Telegram lain, isi ID-nya di sini agar request ditagihkan ke akun itu.
      </div>
    </div>
  )
}

export default function ProvidersPage() {
  const {
    keys,
    addKey,
    removeKey,
    updateKeyStatus,
    replaceKey,
    setKeyCookies,
    setKeyTelegramId,
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
  const navigate = useNavigate()
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState({ show: false, pct: 0, text: '' })
  const [viewHidden, setViewHidden] = useState(false)
  const [summaryPayload, setSummaryPayload] = useState<{ title: string; rows: Array<{ label: string; value: string | number; tone?: string }>; footer?: string } | null>(null)
  const [tokenBankOpen, setTokenBankOpen] = useState(false)
  const [editingBalanceIdx, setEditingBalanceIdx] = useState<number | null>(null)
  const [editingBalanceVal, setEditingBalanceVal] = useState('')

  const currentConfig = PROVIDER_LIST.find(p => p.key === selectedProvider)

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
      oneover: 'oneover',
      genspark: 'genspark',
      riverside: 'riverside',
      nexabot: 'nexabot',
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
      oneover: 'oneover',
      genspark: 'genspark',
      riverside: 'riverside',
      nexabot: 'nexabot',
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
    // NexaBot: hasil “Copy as cURL” multi-baris harus dibaca sebagai SATU key —
    // jangan dipecah per baris (dulu pecah → header invalid & cek saldo hang).
    // Bulk (1 key per baris) tetap didukung.
    const nexabotBlob = selectedProvider === 'nexabot' && nexabotInputIsBlob(inputValue)
    const rawLines = nexabotBlob
      ? [inputValue]
      : inputValue.split(/[\n,]/).map(l => l.trim()).filter(Boolean)
    const lines = selectedProvider === 'nexabot'
      ? rawLines.map(l => parseNexabotApiKeyInput(l)).filter(Boolean)
      : rawLines
    if (lines.length === 0) {
      if (selectedProvider === 'nexabot') {
        setSummaryPayload({
          title: 'Key NexaBot tidak dikenali',
          rows: [{ label: 'Status', value: 'Ditolak', tone: 'bad' }],
          footer: 'Field ini untuk API key (nxb_…). Kalau yang kamu tempel adalah cURL berisi cookie, gunakan panel “Session Login Unlimited (cookie)” di bawah.',
        })
      }
      return
    }

    const existing = new Set(savedKeys)
    let added = 0
    let skipped = 0

    // Auto-parse OneOver JSON format: { access_token, refresh_token }
    const parseOneOverKey = (line: string): string => {
      if (selectedProvider !== 'oneover') return line
      try {
        const parsed = JSON.parse(line)
        // If it's a JSON with refresh_token, use that as the key
        if (parsed.refresh_token) return parsed.refresh_token
        if (parsed.access_token) return parsed.access_token
      } catch (e) { console.warn('[Providers] Failed to parse OneOver JSON:', e) }
      return line
    }

    // Auto-parse Firefly JSON format: { token, apiKey, account, session }
    const parseFireflyKey = (line: string): string => {
      if (selectedProvider !== 'firefly') return line
      if (line.startsWith('{')) {
        try {
          const parsed = JSON.parse(line)
          if (parsed.token) return parsed.token
        } catch (e) { console.warn('[Providers] Failed to parse Firefly JSON:', e) }
      }
      return line
    }

    // Auto-parse Riverside JSON format: { access_token, refresh_token }
    // Plain JWT (eyJ…) is the normal input — only attempt JSON.parse when the
    // line actually looks like JSON, so tokens don't spam warnings.
    const parseRiversideKey = (line: string): { token: string; refreshToken?: string } => {
      if (selectedProvider !== 'riverside') return { token: line }
      if (line.startsWith('{')) {
        try {
          const parsed = JSON.parse(line)
          // PREFER refresh token (AMf-…) — tahan lama; JWT (eyJ…) hanya fallback
          const refreshToken = parsed.refresh_token || parsed.refreshToken
          const token = refreshToken || parsed.access_token || parsed.accessToken || parsed.token
          if (token) return { token }
        } catch (e) { console.warn('[Providers] Failed to parse Riverside JSON:', e) }
      }
      return { token: line }
    }

    lines.forEach(line => {
      const { token: key, refreshToken } = parseRiversideKey(parseFireflyKey(parseOneOverKey(line)))
      if (existing.has(key)) {
        skipped++
        return
      }
      addKey(selectedProvider as ProviderId, key, undefined, refreshToken)
      existing.add(key)
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
    const nexabotBlob = selectedProvider === 'nexabot' && nexabotInputIsBlob(bulkText)
    const lines = nexabotBlob
      ? [bulkText]
      : bulkText.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return

    const existing = new Set(savedKeys)
    let added = 0
    let skipped = 0

    lines.forEach(line => {
      let cleanKey = line.replace(/^[•\-*\s]+|[•\-*\s]+$/g, '').trim()
      // NexaBot: ambil API key dari cURL/JSON & buang nilai kotor.
      if (selectedProvider === 'nexabot') {
        cleanKey = parseNexabotApiKeyInput(cleanKey)
      }
      // Auto-parse Firefly JSON
      let refreshToken: string | undefined
      if (selectedProvider === 'firefly' && cleanKey.startsWith('{')) {
        try {
          const parsed = JSON.parse(cleanKey)
          if (parsed.token) cleanKey = parsed.token
        } catch (e) { console.warn('[Providers] Failed to parse Firefly JSON:', e) }
      }
      // Auto-parse OneOver JSON
      if (selectedProvider === 'oneover' && cleanKey.startsWith('{')) {
        try {
          const parsed = JSON.parse(cleanKey)
          if (parsed.refresh_token) cleanKey = parsed.refresh_token
          else if (parsed.access_token) cleanKey = parsed.access_token
        } catch (e) { console.warn('[Providers] Failed to parse OneOver JSON:', e) }
      }
      // Auto-parse Riverside JSON: { access_token, refresh_token }
      if (selectedProvider === 'riverside' && cleanKey.startsWith('{')) {
        try {
          const parsed = JSON.parse(cleanKey)
          // PREFER refresh token (AMf-…) — tahan lama; JWT (eyJ…) hanya fallback
          const tk = parsed.refresh_token || parsed.refreshToken || parsed.access_token || parsed.accessToken || parsed.token
          if (tk) {
            cleanKey = tk
            refreshToken = undefined
          }
        } catch (e) { console.warn('[Providers] Failed to parse Riverside JSON:', e) }
      }
      if (!cleanKey || existing.has(cleanKey)) {
        skipped++
        return
      }
      addKey(selectedProvider as ProviderId, cleanKey, undefined, refreshToken)
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
        } catch (e) { console.warn('[Providers] Failed to parse Galleri5 JSON headers:', e) }

        if (!isJwt && !isRefreshToken && !isJsonHeaders) {
          return { state: 'invalid', detail: 'Format tidak dikenal. Harus: (1) refresh token AMf-..., (2) ID token eyJ..., atau (3) JSON auth headers.' }
        }

        // Build auth headers from whatever format
        if (isRefreshToken) {
          // Refresh token — resolve to access token first
          try {
            const galleri5 = await import('@/lib/galleri5')
            const accessToken = await galleri5.resolveAccessTokenFromKey(trimmed)
            if (!accessToken) return { state: 'invalid', detail: 'Refresh token tidak bisa di-resolve. Pastikan token benar (AMf-... dari aistudio.galleri5.com).' }
            authHeaders = { Accept: '*/*', Authorization: `Bearer ${accessToken}` }
          } catch (err: any) {
            return { state: 'invalid', detail: err.message || 'Gagal resolve refresh token. Pastikan token dari aistudio.galleri5.com.' }
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
          const emailPart = result.email || ''
          const planPart = result.plan || ''
          const prefix = [emailPart, planPart].filter(Boolean).join(' · ')
          
          if (bal !== null && bal !== undefined) {
            if (bal >= 60) {
              return { state: 'active', balance: bal, email: result.email, detail: `${prefix}${prefix ? ' · ' : ''}Balance: ${bal} cr` }
            } else if (bal > 0) {
              return { state: 'active', balance: bal, email: result.email, detail: `${prefix}${prefix ? ' · ' : ''}Balance: ${bal} cr (rendah, min 60 cr)` }
            } else {
              return { state: 'empty', balance: 0, email: result.email, detail: `${prefix}${prefix ? ' · ' : ''}Balance: ${bal} cr — habis` }
            }
          }
          return { state: 'active', detail: `${result.email || 'Token valid'}${planPart ? ' · ' + planPart : ''}` }
        }
        if (isGalleri5TokenError(result.error || '')) {
          return { state: 'invalid', detail: result.error || 'Token expired / tidak valid' }
        }
        return { state: 'failed', detail: result.error || 'Gagal cek token' }
      } catch {
        return { state: 'failed', detail: 'Error checking token' }
      }
    }
    if (selectedProvider === 'firefly') {
      try {
        const result = await checkFireflyBalance(key)
        if (result.ok && result.balance != null) {
          const bal = result.balance
          if (bal > 0) {
            return { state: 'active', balance: bal, detail: `${result.plan || 'Firefly'} · Balance: ${bal} cr (used: ${result.used}/${result.total})` }
          } else {
            return { state: 'empty', balance: 0, detail: `${result.plan || 'Firefly'} · Balance: 0 — habis` }
          }
        }
        if (result.ok) {
          return { state: 'active', detail: 'Token valid' }
        }
        return { state: 'failed', detail: result.error || 'Gagal cek token' }
      } catch (err: any) {
        return { state: 'failed', detail: err.message || 'Error checking token' }
      }
    }
    if (selectedProvider === 'oneover') {
      try {
        const { resolveOneOverAccessToken, checkOneOverBalance, extractOneOverUserId } = await import('@/lib/oneover')
        const accessToken = await resolveOneOverAccessToken(key)
        const userId = extractOneOverUserId(accessToken)
        const result = await checkOneOverBalance(accessToken, userId || undefined)
        if (result.ok && result.balance != null) {
          const bal = result.balance
          if (bal > 0) {
            return { state: 'active', balance: bal, detail: `Balance: ${bal} credits` }
          } else {
            return { state: 'empty', balance: 0, detail: 'Balance: 0 — habis' }
          }
        }
        if (result.ok) {
          return { state: 'active', detail: 'Token valid' }
        }
        return { state: 'failed', detail: result.error || 'Gagal cek token' }
      } catch (err: any) {
        if (err.message?.includes('expired') || err.message?.includes('refresh')) {
          return { state: 'invalid', detail: 'Token expired — login ulang di oneover.com' }
        }
        return { state: 'failed', detail: err.message || 'Error checking token' }
      }
    }
    if (selectedProvider === 'framia') {
      try {
        const { fetchFramiaCredits } = await import('@/lib/framia')
        const credits = await fetchFramiaCredits(key)
        if (credits && typeof credits === 'object' && 'raw' in credits) {
          return { state: 'active', detail: credits.raw }
        }
        return { state: 'active', detail: 'Token valid' }
      } catch (err: any) {
        const msg = err?.message || ''
        if (/invalid|unauthorized|401|403/i.test(msg)) {
          return { state: 'invalid', detail: msg || 'Token tidak valid' }
        }
        return { state: 'failed', detail: msg || 'Error checking Framia token' }
      }
    }
    if (selectedProvider === 'genspark') {
      try {
        const { checkGensparkBalance } = await import('@/lib/genspark')
        const result = await checkGensparkBalance(key)
        if (result.ok) {
          const bal = result.balance
          const email = result.email
          const plan = result.plan
          const parts = [email, plan].filter(Boolean)
          if (bal !== null && bal !== undefined && bal > 0) {
            return { state: 'active', balance: bal, email: email || undefined, detail: `${parts.join(' · ')}${parts.length ? ' · ' : ''}Credits: ${bal}` }
          }
          // No explicit balance — show email + plan info
          const planLabel = plan || 'Free tier'
          const detail = parts.length > 0
            ? `${parts.join(' · ')} · ${planLabel} · 100 cr/day`
            : `API key valid · ${planLabel} · 100 cr/day`
          return { state: 'active', email: email || undefined, detail }
        }
        return { state: 'failed', detail: result.error || 'Gagal cek token' }
      } catch (err: any) {
        return { state: 'failed', detail: err.message || 'Error checking Genspark token' }
      }
    }
    if (selectedProvider === 'riverside') {
      try {
        const { checkRiversideBalance, isRiversideJwtNearExpiry, refreshRiversideJwt } = await import('@/lib/riverside')
        const result = await checkRiversideBalance(key)
        if (!result.ok) {
          return {
            state: result.state === 'invalid' ? 'invalid' : 'failed',
            detail: result.error || 'Gagal cek token',
          }
        }

        // JWT mendekati expired → coba auto-refresh pakai refresh token tersimpan
        if (isRiversideJwtNearExpiry(key)) {
          const keyObj = keys.riverside?.find((k) => k.key === key)
          if (keyObj?.refreshToken) {
            const refreshed = await refreshRiversideJwt(key, keyObj.refreshToken)
            if (refreshed.ok && refreshed.token) {
              replaceKey('riverside', keyObj.id, refreshed.token, keyObj.refreshToken)
              return {
                state: 'active',
                balance: null,
                email: refreshed.email,
                detail: `🔄 Token auto-refreshed ✓ (${refreshed.email || 'akun'})`,
              }
            }
            return {
              state: 'active',
              balance: null,
              email: result.email,
              detail: `${result.detail || 'Token valid'} — auto-refresh gagal (${refreshed.error || 'endpoint tidak merespons'}), grab ulang dari dashboard`,
            }
          }
          return {
            state: 'active',
            balance: null,
            email: result.email,
            detail: `${result.detail || 'Token valid'} — tidak ada refresh token tersimpan, grab ulang dari dashboard`,
          }
        }

        return {
          state: result.state,
          balance: result.balance,
          email: result.email,
          detail: result.detail || 'Token valid',
        }
      } catch (err: any) {
        return { state: 'failed', detail: err.message || 'Error checking Riverside token' }
      }
    }
    if (selectedProvider === 'nexabot') {
      // Cookie sesi SELALU menang atas API key (jalur Unlimited), termasuk kalau
      // baris key ini juga menyimpan API key. Jangan panggil cek saldo di sini —
      // endpoint /credit menggantung untuk key tak dikenal dan memicu timeout.
      const keyRow = keys.nexabot?.find(k => k.key === key)
      const sessionCookies = keyRow?.cookies
        || (keyRow?.key ? undefined : keys.nexabot?.find(k => k.cookies)?.cookies)
      if (sessionCookies) {
        try {
          const { checkNexabotSession } = await import('@/lib/nexabot')
          const s = await checkNexabotSession(sessionCookies, { timeoutMs: NEXABOT_CHECK_TIMEOUT_MS })
          if (!s.ok) {
            // 404 = endpoint belum ada di server (backend lama), bukan cookie invalid.
            const notFound = /404|tidak ditemukan/i.test(s.error || '')
            // 429/504/timeout dari gateway NexaBot BUKAN tanda cookie mati. Dulu
            // hiccup ini dicap 'invalid', jadi sesi Unlimited yang sehat ikut
            // dicabut, user diminta login ulang, dan key-nya dilewati precheck.
            if (s.transient) {
              return {
                state: 'limited',
                detail: s.error || 'Server NexaBot tidak merespons (timeout gateway) — coba cek lagi sebentar lagi',
              }
            }
            return {
              state: notFound ? 'failed' : 'invalid',
              detail: s.error || 'Cookie sesi ditolak — login ulang di nexabot.id lalu paste cookie baru',
            }
          }
          if (!s.active) {
            return { state: 'invalid', detail: 'Masa berlaku sesi/paket sudah berakhir — paste cookie baru' }
          }
          return {
            state: 'active',
            balance: s.balance ?? undefined,
            detail: s.unlimited
              ? `✓ Paket UNLIMITED aktif${s.plan ? ` · ${s.plan}` : ''} — tidak potong kredit`
              : `Sesi aktif${s.plan ? ` · ${s.plan}` : ''} — paket Unlimited tidak terdeteksi`,
          }
        } catch {
          return { state: 'active', detail: 'Session mode (cookie) — Unlimited via /api/v1/generate' }
        }
      }
      if (!key) {
        return { state: 'active', detail: 'Key session tanpa API key — siap generate' }
      }
      try {
        const { checkNexabotBalance } = await import('@/lib/nexabot')
        const result = await checkNexabotBalance(key, { timeoutMs: NEXABOT_CHECK_TIMEOUT_MS })
        if (!result.ok) {
          // Timeout/504 = NexaBot (atau jaringannya) yang lambat, bukan key-nya.
          // Tandai rate-limited supaya key tidak dicap mati dan tetap dipakai.
          if (result.transient) {
            return { state: 'limited', detail: result.error || 'Server NexaBot tidak merespons (timeout gateway) — coba cek lagi sebentar lagi' }
          }
          if (/tidak valid|invalid|unauthorized|forbidden|401|403/i.test(result.error || '')) {
            return { state: 'invalid', detail: result.error || 'API key NexaBot tidak valid' }
          }
          return { state: 'failed', detail: result.error || 'Gagal cek saldo NexaBot' }
        }
        const bal = result.balance
        const cost = result.creditCost
        const costPart = cost != null ? ` · ${cost} cr/request` : ''
        if (bal != null && bal > 0) {
          return { state: 'active', balance: bal, detail: `Credit: ${bal} cr${costPart}` }
        }
        return { state: 'empty', balance: 0, detail: `Credit: ${bal ?? 0} cr — habis` }
      } catch (err: any) {
        return { state: 'failed', detail: err.message || 'Error checking NexaBot API key' }
      }
    }
    return { state: 'unknown', detail: 'Cek limit belum tersedia untuk provider ini' }
  }, [selectedProvider, keys.riverside, keys.nexabot, replaceKey])

  const handleCheckAll = useCallback(async () => {
    if (savedKeys.length === 0) return
    setChecking(true)
    const newStatusMap: typeof statusMap = {}
    const providerKeys = keys[selectedProvider as ProviderId] || []
    // NexaBot /credit & /credits menggantung kalau ditembak paralel (log
    // nexabot-local: 5 probe sekaligus semuanya timeout 3×30s). Fan-out-nya
    // dikecilkan supaya tiap probe sempat dapat jawaban dari upstream.
    const concurrency = selectedProvider === 'nexabot' ? 2 : 5

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

    // Auto-sync credits to database for Credit Management page
    try {
      const token = useAuthStore.getState().token
      if (token) {
        // Read balance from providerManager store (updated by updateKeyStatus)
        const freshKeys = useProviderManager.getState().keys[selectedProvider as ProviderId] || []
        // credits null = saldo belum diketahui (cek timeout/504). Endpoint sync
        // melewati entri non-number, jadi kredit lama di Credit Management tidak
        // ditimpa 0 hanya karena upstream NexaBot menggantung.
        const syncUpdates = freshKeys.map((k) => ({
          credits: k.balance ?? null,
        }))
        if (syncUpdates.length > 0) {
          console.log(`[credits-sync] ${selectedProvider}: syncing ${syncUpdates.length} keys`, syncUpdates.map(u => u.credits))
          fetch('/api/admin/credits/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ provider: selectedProvider, updates: syncUpdates }),
          }).then(r => r.json()).then(d => {
            console.log(`[credits-sync] result:`, d)
          }).catch(err => {
            console.error(`[credits-sync] error:`, err)
          })
        }
      }
    } catch (err) {
      console.error('[credits-sync] exception:', err)
    }

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

      <ProviderStatusBar selectedProvider={selectedProvider} onSelect={setSelectedProvider} />
      <TokenSyncHistory />

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
                background: `conic-gradient(from 0deg, transparent 0deg, transparent 200deg, #00a8ff 280deg, #00d4ff 315deg, #00a8ff 340deg, transparent 360deg)`,
              }}
            />
            <span
              className="relative flex min-h-[84px] items-center justify-between gap-3 rounded-[10px] bg-[#0a0a0a] px-5 py-4 border border-[#2a2a2a]"
              style={{ boxShadow: 'inset 0 0 40px rgba(0, 168, 255, 0.15)' }}
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
                style={{ boxShadow: '0 0 30px rgba(0, 168, 255, 0.1)' }}
              >
                {VISIBLE_PROVIDER_LIST.map(p => {
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
                    oneover: 'oneover',
                    genspark: 'genspark',
                    riverside: 'riverside',
                    nexabot: 'nexabot',
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
                          borderColor: isActive ? '#00a8ff' : isMaint ? '#f97316' : '#2a2a2a',
                          boxShadow: isActive ? '0 0 18px rgba(0, 168, 255, 0.3)' : isMaint ? '0 0 12px rgba(0, 168, 255, 0.2)' : 'inset 0 0 0 1px rgba(0, 168, 255, 0.05)',
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ 
                              background: isMaint ? '#f97316' : isActive ? '#00a8ff' : color,
                              boxShadow: isMaint ? '0 0 10px rgba(0, 168, 255, 0.5)' : isActive ? '0 0 10px rgba(0, 168, 255, 0.5)' : `0 0 6px ${color}66`
                            }}
                          />
                          <span className="text-sm font-semibold text-[#f5f5f5]">{p.label}</span>
                          {isMaint && (
                            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">
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
            onClick={() => navigate(selectedProvider === 'createpulse' ? '/topup/createpulse' : '/beli-token')}
            className="relative inline-flex items-center gap-1.5 rounded-full border border-[#00a8ff]/50 bg-gradient-to-r from-[#00a8ff]/20 via-[#00a8ff]/10 to-[#00a8ff]/20 text-[#00d4ff] px-3.5 py-2 text-xs md:text-sm font-semibold md:font-bold md:px-5 md:py-2.5 shadow-[0_0_14px_rgba(0,168,255,0.35)] md:shadow-[0_0_20px_rgba(0,168,255,0.55)] hover:shadow-[0_0_28px_rgba(0,168,255,0.75)] hover:scale-[1.02] transition-all"
            title={selectedProvider === 'createpulse' ? 'Topup CreatePulse' : 'Beli token dari Token Bank'}
          >
            {selectedProvider === 'createpulse' ? <Wallet className="h-3.5 w-3.5 md:h-4 md:w-4" /> : <ShoppingCart className="h-3.5 w-3.5 md:h-4 md:w-4" />}
            {selectedProvider === 'createpulse' ? 'Topup CreatePulse' : 'Beli Token'}
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
              <div className="text-[12px] font-mono uppercase tracking-widest text-[#a0a0a0]">
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
                className="font-mono text-xs bg-[#0a0a0a] border-[#2a2a2a] text-[#f5f5f5] placeholder-[#666666] focus:border-[#00a8ff] focus:ring-[#00a8ff]/30"
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={bulkMode ? handleBulkUpload : handleAddKey} disabled={bulkMode ? !bulkText.trim() : !inputValue.trim()} className="gold-gradient text-[#0a0a0a] hover:opacity-90">
                  <Plus className="h-3.5 w-3.5" /> Tambah
                </Button>
                <Button variant="outline" onClick={() => setBulkMode(!bulkMode)} className="border-[#2a2a2a] bg-[#1a1a1a] text-[#f5f5f5] hover:bg-[#2a2a2a] hover:border-[#00a8ff]/50">
                  <Upload className="h-3.5 w-3.5" /> {bulkMode ? 'Single' : 'Bulk'}
                </Button>
                <Button variant="outline" onClick={handleCheckAll} disabled={checking || savedKeys.length === 0} className="border-[#2a2a2a] bg-[#1a1a1a] text-[#f5f5f5] hover:bg-[#2a2a2a] hover:border-[#00a8ff]/50">
                  {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Cek Limit & Status
                </Button>
                <Button variant="destructive" onClick={handleDeleteAll} disabled={savedKeys.length === 0}>
                  <Trash2 className="h-3.5 w-3.5" /> Hapus Semua
                </Button>
                {selectedProvider === 'oneover' && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const { getOneOverBookmarklet } = await import('@/lib/oneover')
                      const snippet = getOneOverBookmarklet()
                      await navigator.clipboard.writeText(snippet)
                      alert('📋 Script copied!\n\n1. Buka oneover.com (login dulu)\n2. Buka DevTools Console (F12 → Console)\n3. Paste script & Enter\n4. Token otomatis copy → paste di sini')
                    }}
                    className="border-violet-500/50 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 hover:border-violet-500/70"
                  >
                    <Key className="h-3.5 w-3.5" /> Grab Token dari oneover.com
                  </Button>
                )}
                {selectedProvider === 'framia' && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const { getFramiaBookmarklet } = await import('@/lib/framia')
                      const snippet = getFramiaBookmarklet()
                      await navigator.clipboard.writeText(snippet)
                      alert('📋 Script copied!\n\n1. Buka framia.converge.ai (login dulu)\n2. Buka DevTools Console (F12 → Console)\n3. Paste script & Enter\n4. Access token otomatis copy → paste di sini\n\n⚠️ Penting: Token harus dari Authorization header (eyJhbGci...), bukan id_token (eyJjdHki...)')
                    }}
                    className="border-orange-500/50 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 hover:border-orange-500/70"
                  >
                    <Key className="h-3.5 w-3.5" /> Grab Token dari framia.converge.ai
                  </Button>
                )}
                {selectedProvider === 'riverside' && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const { getRiversideBookmarklet, detectRiversideTokenFormat } = await import('@/lib/riverside')
                      const snippet = getRiversideBookmarklet()
                      await navigator.clipboard.writeText(snippet)
                      const first = keys.riverside?.[0]?.key
                      const fmt = first ? detectRiversideTokenFormat(first) : null
                      const fmtNote = fmt === 'jwt' ? ' (JWT — akan expired, ambil ulang ~1 jam)' : fmt === 'firebase-refresh' ? ' (Firebase refresh — tahan lama)' : fmt === 'opaque' ? ' (token panjang)' : ''
                      alert(`📋 Script copied!\n\n1. Buka riverside.com/dashboard (login dulu)\n2. Buka DevTools Console (F12 → Console)\n3. Paste script & Enter\n4. Token session otomatis copy → paste di sini\n\nToken tersimpan kamu: ${keys.riverside?.length || 0}${fmt ? ' · format: ' + fmt + fmtNote : ''}`)
                    }}
                    className="border-red-500/50 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/70"
                  >
                    <Key className="h-3.5 w-3.5" /> Grab Token dari riverside.com
                  </Button>
                )}
              </div>

              {selectedProvider === 'runninghub' && (
                <div className="neumorph p-3 space-y-2">
                  <label className="text-[12px] font-mono uppercase tracking-widest text-[#a0a0a0]">
                    Workflow ID (Opsional — default: Markasflow-V2 bawaan)
                  </label>
                  <Input
                    value={workflowId}
                    onChange={e => setWorkflowId(e.target.value)}
                    placeholder="Default: 2084995158336192513"
                    className="font-mono text-xs bg-[#0a0a0a] border-[#2a2a2a] text-[#f5f5f5] placeholder-[#666666] focus:border-[#00a8ff] focus:ring-[#00a8ff]/30"
                  />
                  <p className="text-[12px] text-[#666666]">
                    Kosongkan untuk pakai workflow bawaan. Isi hanya jika ingin pakai workflow custom dari RunningHub.
                  </p>
                </div>
              )}

              {progress.show && (
                <div className="rounded-md border border-[#2a2a2a] bg-[#141414] p-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1a1a1a]">
                    <div className="h-full gold-gradient transition-all" style={{ width: `${progress.pct}%` }} />
                  </div>
                  <div className="mt-1 text-[12px] text-[#a0a0a0]">{progress.text}</div>
                </div>
              )}

              {savedKeys.length > 0 && (
                <div className="mt-1 space-y-1.5">
                  <div className="text-[12px] font-mono uppercase tracking-widest text-[#a0a0a0]">
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
                                <div className="text-[12px] text-[#a0a0a0] truncate mt-0.5">{detail}</div>
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
                                  className="text-[12px] text-[#00a8ff] hover:text-[#f5f5f5] underline underline-offset-2 transition cursor-pointer"
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
                                    className="w-20 text-[12px] font-mono bg-[#0a0a0a] border border-[#00a8ff] text-[#f5f5f5] px-1.5 py-0.5 rounded focus:outline-none focus:border-[#f5f5f5]"
                                  />
                                  <button
                                    onClick={() => {
                                      const val = parseInt(editingBalanceVal)
                                      if (!isNaN(val) && val >= 0 && keyObj) {
                                        updateKeyStatus(selectedProvider as ProviderId, keyObj.id, keyObj.status || 'active', val)
                                      }
                                      setEditingBalanceIdx(null)
                                    }}
                                    className="text-[12px] text-[#22c55e] hover:text-[#4ade80] transition"
                                    title="Simpan"
                                  >
                                    <Check className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={() => setEditingBalanceIdx(null)}
                                    className="text-[12px] text-[#a0a0a0] hover:text-[#f5f5f5] transition"
                                    title="Batal"
                                  >
                                    <XCircle className="h-3 w-3" />
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                          {!isWeavy && detail && (
                            <span className="text-[12px] text-[#a0a0a0] truncate max-w-[220px]">{detail}</span>
                          )}
                          {!isWeavy && !detail && (
                            <span className="text-[12px] text-[#a0a0a0] truncate max-w-[220px]">—</span>
                          )}
                          <span className={`text-[12px] px-2 py-0.5 rounded-full border ${getStatusColor(state)}`}>
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
                            className="inline-flex items-center gap-1 rounded-full border border-[#2a2a2a] bg-[#1a1a1a] px-1.5 py-0.5 text-[12px] text-[#a0a0a0] hover:text-[#dc2626] hover:border-[#dc2626]/50 transition"
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
          <div className="text-[12px] font-mono uppercase tracking-widest text-[#a0a0a0]">Info</div>
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
              <div className="mt-3 rounded-lg border border-[#00a8ff]/30 bg-[#00a8ff]/5 p-3">
                <div className="text-[12px] font-mono uppercase tracking-widest text-[#00a8ff]/80">Pool Summary</div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-2xl font-black gold-text">
                    {isWeavyPool && totalBalance === 0 ? '???' : totalBalance.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-[#a0a0a0]">credits total</span>
                </div>
                <div className="mt-1 text-[11px] text-[#a0a0a0]">
                  {activeCount} active / {providerKeys.length} keys
                  {isWeavyPool && totalBalance === 0 && (
                    <span className="ml-2 text-[#00a8ff]">· Balance tidak tersedia untuk Free tier</span>
                  )}
                </div>
              </div>
            )
          })()}

              {TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE] && (
            <div className="mt-4 rounded-lg border border-[#00a8ff]/30 bg-[#00a8ff]/5 p-3">
              <div className="text-[12px] font-mono uppercase tracking-widest text-[#00a8ff]/80">Cara Dapat Token</div>
              <a
                href={TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE].url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1.5 text-sm text-[#00d4ff] hover:underline font-medium break-all"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                {TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE].urlLabel}
              </a>
              {TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE].prefix && (
                <div className="mt-1 text-[12px] text-[#a0a0a0]">
                  Format key: <code className="text-[#f5f5f5]/85">{TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE].prefix}</code>
                </div>
              )}
              <ol className="mt-2.5 list-decimal pl-4 space-y-1.5 text-[11px] text-[#a0a0a0] leading-relaxed">
                {TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE].steps.map((step, i) => (
                  <li key={i}>
                    {step.text}
                    {step.link && (
                      <a href={step.link.url} target="_blank" rel="noreferrer" className="text-[#00d4ff] underline hover:text-[#00a8ff]/80">
                        {step.link.label}
                      </a>
                    )}
                    {step.code && (
                      <pre className="mt-1 rounded-md bg-[#050505] border border-[#2a2a2a] p-2 overflow-x-auto text-[11px] font-mono text-[#f5f5f5]/80 whitespace-pre-wrap break-all">
                        {step.code}
                      </pre>
                    )}
                  </li>
                ))}
              </ol>
              {TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE].tip && (
                <div className="mt-2.5 rounded-md bg-[#00a8ff]/10 border border-[#00a8ff]/30 p-2 text-[10.5px] text-[#00d4ff]/90 leading-relaxed">
                  💡 {TOKEN_GUIDE[selectedProvider as keyof typeof TOKEN_GUIDE].tip}
                </div>
              )}
              {/* Genspark Session Cookies Input */}
              {selectedProvider === 'genspark' && (
                <GensparkCookiesInput
                  providerKeys={keys['genspark'] || []}
                  setKeyCookies={setKeyCookies}
                />
              )}
              {/* NexaBot Session Cookies Input (mode Unlimited) */}
              {selectedProvider === 'nexabot' && (
                <NexabotSessionInput
                  providerKeys={keys['nexabot'] || []}
                  addKey={addKey}
                  setKeyCookies={setKeyCookies}
                />
              )}
              {/* NexaBot Telegram ID Input */}
              {selectedProvider === 'nexabot' && (
                <NexabotTelegramInput
                  providerKeys={keys['nexabot'] || []}
                  setKeyTelegramId={setKeyTelegramId}
                />
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
