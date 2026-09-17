// ─── NexaBot Session Cookie Manager — Background ────────────────────────────
//
// NexaBot mode session butuh header `Cookie` dari login nexabot.id supaya
// generate lewat /api/v1/generate menghormati paket Unlimited (tidak dipotong
// 0.25 cr/request seperti jalur API key).
//
// Masalahnya: cookie sesi biasanya HttpOnly → `document.cookie` di Console
// KOSONG, dan satu-satunya cara manual adalah Network → "Copy as cURL".
// chrome.cookies BISA membaca HttpOnly (dengan permission "cookies"), jadi
// extension ini yang mengambil cookie itu untuk user:
//   1. auto-grab saat tab nexabot.id selesai load / cookie berubah,
//   2. kirim ke app lewat POST /api/sync-tokens { provider:'nexabot', kind:'cookie' },
//   3. sisakan tombol "Copy Cookie" satu klik sebagai cadangan manual,
//   4. kirim ULANG cookie tersimpan secara berkala, supaya sesi pulih sendiri
//      kalau kiriman pertama tidak sampai (app belum dibuka, JWT app
//      kedaluwarsa, server app baru restart) tanpa user menekan apa pun.
//
// Di app yang sudah dideploy, endpoint sync itu butuh JWT user (credential
// disimpan per user, bukan queue publik). JWT-nya diambil otomatis dari tab app
// yang sedang login — user tidak perlu paste apa pun, cuma app harus kebuka.

const STORAGE_KEY = 'nxb_session'
const APP_URL_KEY = 'nxb_app_url'
const APP_TOKEN_KEY = 'nxb_app_token'
const APP_TOKEN_ORIGIN_KEY = 'nxb_app_token_origin'
const SYNC_MSG_KEY = 'nxb_last_sync_msg'

// Kirim ulang berkala (lihat resyncStoredSession di bawah).
const RESYNC_ALARM = 'nxb-resync'
const RESYNC_PERIOD_MINUTES = 15
// Selaras dengan TTL cookie di server (24 jam): lebih tua dari ini pasti
// dipangkas antrean, jadi mengirimnya ulang tidak ada gunanya.
const RESYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000

const DEFAULT_APP_URL = 'http://localhost:6000'

// App menyimpan JWT login di localStorage dengan key ini (src/stores/authStore.ts).
const APP_TOKEN_STORAGE_KEY = 'arkxmotion_token'

// Kandidat origin frontend app: dev server Vite + domain produksi. Dipakai
// untuk mencari tab yang sudah login (URL app di popup tetap dicoba lebih dulu).
//
// Domain produksi WAJIB ada di sini: sejak /api/sync-tokens membutuhkan JWT,
// extension yang tidak bisa menemukan tab app yang login tidak bisa mengirim
// apa pun (server menjawab 401). Host Vercel pernah ada di daftar ini, tapi
// deployment-nya sudah dimatikan (402 DEPLOYMENT_DISABLED), jadi diganti dengan
// domain yang benar-benar melayani.
const APP_TAB_CANDIDATES = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:6000',
  'https://arkxmotion-studio.win',
]

// Bentuk query yang berbeda-beda supaya cookie host-only (www) ikut terbaca.
const COOKIE_QUERIES = [
  { domain: 'nexabot.id' },
  { url: 'https://nexabot.id/' },
  { url: 'https://www.nexabot.id/' },
]

function setBadge(text, color) {
  chrome.action.setBadgeText({ text })
  if (color) chrome.action.setBadgeBackgroundColor({ color })
}

async function getAppUrl() {
  const data = await chrome.storage.local.get(APP_URL_KEY)
  return String(data[APP_URL_KEY] || DEFAULT_APP_URL).replace(/\/+$/, '')
}

async function setSyncStatus(ok, message) {
  await chrome.storage.local.set({ [SYNC_MSG_KEY]: { ok, at: Date.now(), message } })
}

// ── Cookie nexabot.id (HttpOnly included) ───────────────────────────────────
async function collectCookies() {
  const seen = {}
  const unique = []
  for (const query of COOKIE_QUERIES) {
    let list = []
    try {
      list = await chrome.cookies.getAll(query)
    } catch {
      list = []
    }
    for (const c of list || []) {
      if (!c || !c.name) continue
      const id = c.name + '\u0000' + c.value
      if (seen[id]) continue
      seen[id] = true
      unique.push(c)
    }
  }
  return unique
}

function toCookieHeader(list) {
  const seen = {}
  const parts = []
  for (const c of list) {
    if (seen[c.name]) continue
    seen[c.name] = true
    parts.push(c.name + '=' + c.value)
  }
  return parts.join('; ')
}

function looksLikeSession(name) {
  return /session|token|auth|jwt|sid|uid/i.test(name)
}

// ── JWT app: dibaca otomatis dari tab app yang login ────────────────────────
async function readTokenFromTabs() {
  const data = await chrome.storage.local.get(APP_URL_KEY)
  const origins = [String(data[APP_URL_KEY] || DEFAULT_APP_URL), ...APP_TAB_CANDIDATES]
  const checked = {}

  for (const origin of origins) {
    const base = String(origin || '').replace(/\/+$/, '')
    if (!base || checked[base]) continue
    checked[base] = true

    let tabs = []
    try {
      tabs = await chrome.tabs.query({ url: base + '/*' })
    } catch {
      tabs = []
    }

    for (const tab of tabs) {
      if (!tab.id) continue
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (key) => { try { return localStorage.getItem(key) } catch { return null } },
          args: [APP_TOKEN_STORAGE_KEY],
        })
        const token = results && results[0] && results[0].result
        if (token && typeof token === 'string') return { token, origin: base }
      } catch {
        // Tab tidak bisa di-script (chrome://, tab disk, dsb) — lanjut kandidat lain.
      }
    }
  }
  return null
}

async function getAppToken({ refresh = false } = {}) {
  if (!refresh) {
    const cached = await chrome.storage.local.get(APP_TOKEN_KEY)
    if (cached[APP_TOKEN_KEY]) return cached[APP_TOKEN_KEY]
  }
  const found = await readTokenFromTabs()
  if (!found) return null
  await chrome.storage.local.set({
    [APP_TOKEN_KEY]: found.token,
    [APP_TOKEN_ORIGIN_KEY]: found.origin,
  })
  return found.token
}

function invalidateAppToken() {
  return chrome.storage.local.remove([APP_TOKEN_KEY, APP_TOKEN_ORIGIN_KEY])
}

// ── Auto-sync cookie ke app ─────────────────────────────────────────────────
async function syncToApp(cookies, source) {
  const base = await getAppUrl()
  if (!base) return

  const token = await getAppToken()
  // Tanpa JWT app, POST-nya pasti ditolak 401. Lebih baik tidak dikirim dan
  // sebabnya disebutkan, daripada gagal dengan pesan yang tidak bisa ditindak.
  if (!token) {
    await setSyncStatus(false, 'Butuh login di app: buka tab app ARKXMotion, lalu coba lagi')
    return
  }

  try {
    const res = await fetch(base + '/api/sync-tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify({
        provider: 'nexabot',
        token: cookies,
        kind: 'cookie',
        source: source || 'extension:cookie',
      }),
    })

    // 401/403 di produksi = belum login / JWT app kedaluwarsa. Buang cache
    // token biar percobaan berikutnya membaca ulang dari tab app.
    if (res.status === 401 || res.status === 403) {
      await invalidateAppToken()
      await setSyncStatus(false, 'Login dulu di app (buka tab app) supaya extension boleh sync')
      return
    }

    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    await setSyncStatus(true, (data && data.message) || 'Terkirim ke app')
  } catch (e) {
    // Server app mungkin sedang mati — simpan status, jangan ganggu user.
    await setSyncStatus(false, 'Gagal sync: ' + e.message)
  }
}

// ── Kirim ulang cookie tersimpan secara berkala ─────────────────────────────
// Extension dulu hanya mengirim cookie SAAT MENANGKAP (tab nexabot.id selesai
// load atau cookie berubah). Kalau kiriman itu tidak sampai — app sedang tidak
// dibuka, JWT app kedaluwarsa, atau server app baru saja restart — cookie yang
// sudah susah payah diambil itu tidak pernah dikirim ulang, dan user harus
// menekan sync manual atau membuka nexabot.id lagi. Padahal menekan tombol
// adalah hal yang justru ingin dihindari user.
//
// Jadi cookie yang sudah tersimpan dikirim ulang secara berkala. Aman diulang:
// server menyimpan antrean per user+provider dan mengabaikan credential yang
// sama persis, jadi kiriman kedua tidak menggandakan apa pun. Kalau app sudah
// menyimpannya, ini hanya mengisi ulang antrean dengan nilai yang sama.
//
// Batas umurnya sengaja ada: server memangkas credential jenis cookie setelah
// 24 jam, jadi mengirim ulang cookie yang lebih tua dari itu hanya menghasilkan
// baris yang pasti dibuang. Selebihnya extension TIDAK berpura-pura bisa
// memperbaiki: cookie baru hanya bisa didapat dengan membuka nexabot.id, dan
// statusnya mengatakan itu apa adanya.
async function resyncStoredSession(reason) {
  const data = await chrome.storage.local.get(STORAGE_KEY)
  const session = data[STORAGE_KEY]
  // Belum pernah menangkap apa pun: diam saja, jangan menimpa status terakhir
  // dengan pesan yang tidak ada hubungannya dengan yang sedang dilihat user.
  if (!session || !session.cookies) return { ok: false, error: 'no-session' }

  const umur = Date.now() - Number(session.capturedAt || 0)
  if (!(umur >= 0) || umur > RESYNC_MAX_AGE_MS) {
    await setSyncStatus(
      false,
      'Cookie tersimpan sudah lebih dari 24 jam — buka nexabot.id supaya extension menangkap yang baru',
    )
    setBadge('!', '#ef4444')
    return { ok: false, error: 'stale-session' }
  }

  return syncToApp(session.cookies, 'auto-resync:' + reason)
}

/**
 * Pastikan alarm kirim-ulang terpasang.
 *
 * `alarms.get` dipakai lebih dulu, bukan langsung `create`: service worker MV3
 * bangun-tidur berkali-kali, dan `create` dengan nama yang sama MENGGANTI
 * jadwalnya — termasuk delay awalnya. Kalau dipanggil tiap kali worker bangun,
 * pengiriman ulang akan terjadi jauh lebih sering daripada tiap 15 menit.
 */
async function ensureResyncAlarm() {
  try {
    const sudahAda = await chrome.alarms.get(RESYNC_ALARM)
    if (sudahAda) return
    chrome.alarms.create(RESYNC_ALARM, { delayInMinutes: 1, periodInMinutes: RESYNC_PERIOD_MINUTES })
  } catch {
    // Permission "alarms" tidak ada / API tidak tersedia. Penangkapan cookie
    // tetap harus jalan, jadi kegagalan di sini tidak boleh menjatuhkan sisanya.
    setBadge('!', '#ef4444')
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || alarm.name !== RESYNC_ALARM) return
  resyncStoredSession('alarm')
})

// Browser dijalankan lagi (termasuk setelah komputer restart): kirim ulang
// sekali di awal, jangan tunggu siklus 15 menit pertama.
chrome.runtime.onStartup.addListener(() => {
  ensureResyncAlarm()
  resyncStoredSession('browser-startup')
})

chrome.runtime.onInstalled.addListener(() => {
  ensureResyncAlarm()
})

// Worker juga bisa dimulai ulang tanpa event apa pun; alarm-nya dipastikan ada.
ensureResyncAlarm()

// ── Ambil cookie + simpan + auto-sync ───────────────────────────────────────
let grabbing = null

async function grabSession(source) {
  if (grabbing) return grabbing
  grabbing = (async () => {
    const list = await collectCookies()
    const header = toCookieHeader(list)
    if (!header) {
      setBadge('!', '#ef4444')
      return { ok: false, error: 'Cookie nexabot.id tidak ditemukan — login dulu di nexabot.id' }
    }

    const session = {
      cookies: header,
      count: list.length,
      names: list.map((c) => c.name),
      hasSession: list.some((c) => looksLikeSession(c.name)),
      capturedAt: Date.now(),
      source: source || '',
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: session })
    setBadge('✓', '#00D4AA')
    syncToApp(header, source)
    return { ok: true, session }
  })()

  try {
    return await grabbing
  } finally {
    grabbing = null
  }
}

// ── Auto-grab saat tab nexabot.id selesai load ───────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return
  if (!tab || !tab.url || tab.url.indexOf('nexabot.id') === -1) return
  // Beri waktu SPA menyelesaikan login / set cookie sebelum kita baca.
  setTimeout(() => { grabSession('auto-nav') }, 2500)
})

// ── Auto-grab saat cookie nexabot.id berubah (login, refresh sesi) ──────────
let cookieChangeTimer = null
chrome.cookies.onChanged.addListener((changeInfo) => {
  const cookie = changeInfo && changeInfo.cookie
  if (!cookie || !cookie.domain || cookie.domain.indexOf('nexabot.id') === -1) return
  clearTimeout(cookieChangeTimer)
  cookieChangeTimer = setTimeout(() => { grabSession('cookie-change') }, 1500)
})

// ── Message dari popup & content script ─────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'grab') {
    grabSession(msg.source || 'popup').then(sendResponse)
    return true
  }

  if (msg && msg.type === 'get_session') {
    chrome.storage.local.get([STORAGE_KEY, APP_URL_KEY, SYNC_MSG_KEY, APP_TOKEN_KEY, APP_TOKEN_ORIGIN_KEY]).then((data) => {
      sendResponse({
        session: data[STORAGE_KEY] || null,
        appUrl: data[APP_URL_KEY] || DEFAULT_APP_URL,
        lastSync: data[SYNC_MSG_KEY] || null,
        linked: !!data[APP_TOKEN_KEY],
        linkedOrigin: data[APP_TOKEN_ORIGIN_KEY] || null,
      })
    })
    return true
  }

  if (msg && msg.type === 'set_app_url') {
    const url = String(msg.url || '').trim().replace(/\/+$/, '') || DEFAULT_APP_URL
    // Ganti server app → token lama tidak berlaku untuk origin baru.
    invalidateAppToken().then(() => chrome.storage.local.set({ [APP_URL_KEY]: url })).then(() => {
      sendResponse({ ok: true, appUrl: url })
    })
    return true
  }

  // Ambil ulang JWT app dari tab app yang login (tombol "Hubungkan ke app").
  if (msg && msg.type === 'link_app') {
    invalidateAppToken()
      .then(() => getAppToken({ refresh: true }))
      .then((token) => {
        if (!token) {
          sendResponse({
            ok: false,
            error: 'Token app tidak ditemukan — buka app ARKXMotion di tab lain dan login dulu, lalu coba lagi.',
          })
          return
        }
        sendResponse({ ok: true })
      })
    return true
  }

  if (msg && msg.type === 'sync_now') {
    grabSession('manual-sync').then((res) => {
      if (!res || !res.ok) { sendResponse(res || { ok: false }); return }
      syncToApp(res.session.cookies, 'manual-sync').then(() => sendResponse(res))
    })
    return true
  }

  if (msg && msg.type === 'clear') {
    chrome.storage.local.remove([STORAGE_KEY, SYNC_MSG_KEY]).then(() => {
      setBadge('')
      sendResponse({ ok: true })
    })
    return true
  }

  return false
})
