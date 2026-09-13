// ─── Registry provider auth-helper ───────────────────────────────────────────
// SATU-SATUNYA tempat daftar provider didefinisikan. Popup, background, dan
// content script membaca dari sini, jadi menambah provider = menambah satu entri
// di bawah (plus host-nya di manifest.json — MV3 mewajibkan daftar statis di
// sana, jadi host memang muncul dua kali dan itu satu-satunya duplikasi yang
// tidak bisa dihindari).
//
// Bentuk entri:
//   id, label, emoji, ink   — identitas & warna aksen di popup
//   hosts                   — mencocokkan tab aktif dan mengklasifikasi capture
//   max                     — batas token disimpan per provider
//   capture                 — sumber capture: 'network' (interceptor MAIN world),
//                             'reader' (fungsi di lib/readers.js), 'cookies'
//                             (chrome.cookies, bisa HttpOnly)
//   readers                 — nama reader di lib/readers.js
//   refresh                 — 'supabase' | 'firebase' | null
//   balance                 — 'galleri5' | 'oneover' | null
//   copy                    — format tombol Copy utama: 'raw' | 'access' | 'refresh' | 'json'
//   extras                  — tombol copy tambahan
//   appField                — nama field di halaman Providers app
//   sync                    — { provider, prefer } → auto-push ke app lewat
//                             /api/sync-tokens (lib/appSync.js). Provider tanpa
//                             slot di app cukup tidak punya kunci ini.
//   hint                    — instruksi singkat di popup

// ── Konstanta provider ───────────────────────────────────────────────────────
// Dua "key" di bawah adalah client key PUBLIK (anon Supabase & Firebase Web API
// key): nilainya memang ikut terkirim di setiap request browser dan keamanannya
// dijaga oleh RLS/policy di sisi server, bukan oleh kerahasiaan key. Nilai yang
// sama sudah dipakai app di src/lib/galleri5.ts dan src/lib/oneover.ts.

export const FIREBASE_API_KEY = 'AIzaSyBejuWIKZ7yQT9bdG_jnb4RrkW3DoFCNNo'
export const G5_BACKEND = 'https://aistudio-backend.calmdesert-ca599847.centralindia.azurecontainerapps.io'
export const ONEOVER_SUPABASE_URL = 'https://mjuwtqkfhtpgavwjrual.supabase.co'
export const ONEOVER_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdXd0cWtmaHRwZ2F2d2pydWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyMzcxODgsImV4cCI6MjA4MjgxMzE4OH0.h7PCq_fZJ7JfsQtxMuqLyhSvL4JMgOvBumsw2rBwJOc'
export const ONEOVER_STORAGE_KEY = 'sb-mjuwtqkfhtpgavwjrual-auth-token'
export const ONEOVER_COOKIE_PREFIX = 'sb-mjuwtqkfhtpgavwjrual-auth-token'

export const DEFAULT_APP_URL = 'https://arkxmotion-studio.win'

export const PROVIDERS = [
  {
    id: 'galleri5',
    label: 'G5 AI Studio',
    emoji: '🎬',
    ink: '#e879f9',
    appField: 'galleri5',
    // App menukar refresh token (AMf-...) sendiri tiap jam, jadi refresh token
    // yang paling tahan lama untuk dikirim otomatis.
    sync: { provider: 'galleri5', prefer: 'refresh' },
    hosts: ['aistudio.galleri5.com'],
    max: 5,
    capture: ['network', 'reader'],
    readers: ['firebaseIndexedDb'],
    refresh: 'firebase',
    balance: 'galleri5',
    // App menukar refresh token (AMf-...) ke ID token sendiri tiap ~1 jam, jadi
    // refresh token yang paling tahan lama untuk ditempel.
    copy: 'refresh',
    extras: ['access'],
    hint: 'Login di aistudio.galleri5.com — token ikut tertangkap dari request halaman. Default Copy = refresh token (AMf-...); ID token lewat tombol kedua.',
  },
  {
    id: 'oneover',
    label: 'OneOver',
    emoji: '🔮',
    ink: '#a78bfa',
    appField: 'oneover',
    // App menyimpan refresh_token dari JSON sesi, jadi itu yang dikirim.
    sync: { provider: 'oneover', prefer: 'refresh' },
    hosts: ['oneover.com'],
    max: 5,
    capture: ['network', 'reader', 'cookies'],
    readers: ['supabaseLocalStorage'],
    refresh: 'supabase',
    balance: 'oneover',
    // App bisa mem-parse JSON { access_token, refresh_token } dan menyimpan
    // refresh_token-nya, jadi format itu yang disalin default.
    copy: 'json',
    extras: ['refresh'],
    hint: 'Login di oneover.com. Cookie HttpOnly dibaca lewat chrome.cookies, jadi sesi tetap bisa diambil walau localStorage tidak berisi token.',
  },
  {
    id: 'firefly',
    label: 'Adobe Firefly',
    emoji: '🔥',
    ink: '#FF6A00',
    appField: 'firefly',
    // Adobe IMS hanya punya access token (~1 jam) — tidak ada yang bisa di-refresh.
    sync: { provider: 'firefly', prefer: 'token' },
    hosts: ['firefly.adobe.com'],
    max: 5,
    capture: ['network', 'reader'],
    readers: ['fireflyPageScan'],
    refresh: null,
    balance: null,
    // Adobe IMS Bearer token ~1 jam dan tidak bisa di-refresh tanpa cookie IMS,
    // jadi yang disalin token aksesnya apa adanya.
    copy: 'raw',
    extras: ['json'],
    hint: 'Buka firefly.adobe.com dan jalankan satu kali Generate; Bearer token tertangkap dari request halaman — tanpa permission debugger dan tanpa prompt izin.',
  },
  {
    id: 'jwt',
    label: 'JWT generik',
    emoji: '🔑',
    ink: '#64b5f6',
    appField: null,
    // Tanpa `sync`: halaman Providers tidak punya slot untuk token generik,
    // jadi jalurnya tetap copy-paste manual.
    // Tanpa host: provider ini tidak punya content script tetap, tab-nya
    // dipindai saat diminta (activeTab + scripting) supaya tidak perlu izin
    // <all_urls> seperti ekstensi lama.
    hosts: [],
    max: 10,
    capture: ['reader'],
    readers: ['activeTabJwt'],
    refresh: null,
    balance: null,
    copy: 'raw',
    extras: [],
    hint: 'Untuk provider tanpa auto-capture (Leonardo Cognito, Framia Auth0, dsb): buka tab yang sudah login, lalu klik Scan Tab.',
  },
]

/** Provider berdasarkan id. */
export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) || null
}

/** Provider yang cocok dengan sebuah hostname (mis. dari tab aktif). */
export function providerForHost(host) {
  const clean = String(host || '').toLowerCase()
  if (!clean) return null
  return (
    PROVIDERS.find((p) => p.hosts.some((h) => clean === h || clean.endsWith('.' + h))) || null
  )
}

/** URL match pattern untuk tabs.query, dari daftar host provider. */
export function providerTabPatterns(provider) {
  if (!provider.hosts.length) return []
  return provider.hosts.map((h) => `*://*.${h}/*`)
}

/** Label tombol copy utama per format. */
export const COPY_LABELS = {
  raw: '📋 Copy token',
  access: '📋 Copy access token',
  refresh: '📋 Copy refresh token',
  json: '📋 Copy JSON',
}
