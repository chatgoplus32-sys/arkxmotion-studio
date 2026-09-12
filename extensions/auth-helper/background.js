// ─── auth-helper — background service worker ─────────────────────────────────
// Semua keputusan "token ini milik provider mana, lalu diapakan" ada di sini,
// mengikuti registry di providers.js. Content script hanya melaporkan apa yang
// dilihatnya (header request, isi storage) tanpa tahu provider mana pun.

import {
  DEFAULT_APP_URL,
  FIREBASE_API_KEY,
  G5_BACKEND,
  ONEOVER_COOKIE_PREFIX,
  ONEOVER_SUPABASE_ANON_KEY,
  ONEOVER_SUPABASE_URL,
  ONEOVER_STORAGE_KEY,
  PROVIDERS,
  providerById,
  providerForHost,
  providerTabPatterns,
} from './providers.js'
import { READERS } from './lib/readers.js'
import { bestEntry, buildEntry, copyPayloadFor, isUsableEntry } from './lib/tokens.js'
import {
  clearProvider,
  listTokens,
  loadState,
  putEntry,
  refreshBadgeFor,
  removeEntry,
  setAppUrl,
} from './lib/store.js'
import { cookieDiagnostics, readSupabaseCookies } from './lib/cookies.js'

const ONEOVER_COOKIE_DOMAINS = ['oneover.com', '.oneover.com', '.supabase.co']

// ── Utilitas kecil ───────────────────────────────────────────────────────────

function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function providerForUrl(url) {
  const provider = providerForHost(hostOf(url))
  if (provider) return provider
  // Host backend/sekunder (mis. securetoken.googleapis.com) tidak muncul di
  // daftar host provider, jadi cocokkan lewat substring sebagai jaring pengaman.
  const clean = String(url || '').toLowerCase()
  return (
    PROVIDERS.find((p) => p.hosts.some((h) => clean.includes(h))) ||
    (clean.includes('supabase.co') ? providerById('oneover') : null)
  )
}

function ok(data = {}) {
  return { ok: true, ...data }
}

function fail(error) {
  return { ok: false, error: String(error && error.message ? error.message : error) }
}

function rawCollection(target, items) {
  for (const item of items || []) target.push(item)
}

// ── Penyimpanan hasil capture ────────────────────────────────────────────────

/**
 * Simpan sekumpulan hasil mentah (dari interceptor, reader, atau cookie) untuk
 * satu provider. Entri tanpa token yang bisa dipakai diabaikan.
 */
async function storeRaw(provider, raws, source) {
  let stored = 0
  for (const raw of raws) {
    const entry = buildEntry({ ...raw, source: raw.source || source })
    if (!isUsableEntry(entry)) continue
    await putEntry(provider, entry)
    stored++
  }
  return stored
}

/** Tangani payload dari content script (interceptor jaringan / pembaca storage). */
async function handleCapture(payload) {
  const provider = payload.providerId ? providerById(payload.providerId) : providerForUrl(payload.url)
  if (!provider) return fail('host tidak dikenali provider mana pun')
  const raws = []
  if (payload.token) {
    raws.push({
      token: payload.token,
      refreshToken: payload.refreshToken || '',
      source: payload.source || 'network',
      extra: payload.extra || {},
    })
  }
  rawCollection(raws, payload.tokens)
  if (!raws.length) return fail('payload tanpa token')
  const stored = await storeRaw(provider, raws, payload.source)
  return ok({ providerId: provider.id, stored })
}

// ── Scan tab (reader halaman) ────────────────────────────────────────────────

async function tabsForProvider(provider) {
  const patterns = providerTabPatterns(provider)
  if (!patterns.length) {
    // Provider generik (JWT): pakai tab yang sedang aktif — popup yang memanggil
    // handler ini sudah memberi izin activeTab.
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
    return active ? [active] : []
  }
  const tabs = []
  for (const url of patterns) {
    try {
      tabs.push(...(await chrome.tabs.query({ url })))
    } catch {
      /* pola tidak cocok / host tidak diizinkan */
    }
  }
  return tabs.filter((tab, index) => tab.id != null && tabs.findIndex((t) => t.id === tab.id) === index)
}

async function runReadersOnTab(provider, tab) {
  const entries = []
  for (const name of provider.readers) {
    const reader = READERS[name]
    if (!reader) continue
    const ctx = {
      storageKey: provider.id === 'oneover' ? ONEOVER_STORAGE_KEY : '',
      host: hostOf(tab.url || ''),
    }
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: reader,
        args: [ctx],
      })
      for (const entry of (result && result.result && result.result.entries) || []) {
        entries.push({ ...entry, source: `${entry.source || name} @${ctx.host}` })
      }
    } catch (error) {
      console.warn(`[auth-helper] reader ${name} gagal di ${ctx.host}:`, error.message)
    }
  }
  return entries
}

/** Scan manual: jalankan reader provider (kalau punya) plus cookie untuk OneOver. */
async function handleScan({ providerId } = {}) {
  const provider = providerById(providerId)
  if (!provider) return fail('provider tidak dikenal')
  const tabs = await tabsForProvider(provider)
  const raws = []
  for (const tab of tabs) rawCollection(raws, await runReadersOnTab(provider, tab))
  if (provider.capture.includes('cookies') && provider.id === 'oneover') {
    rawCollection(raws, await readSupabaseCookies(ONEOVER_COOKIE_DOMAINS))
  }
  const stored = await storeRaw(provider, raws, 'scan')
  return ok({
    providerId: provider.id,
    tabs: tabs.map((tab) => hostOf(tab.url || '')),
    found: raws.length,
    stored,
  })
}

// ── Refresh token ────────────────────────────────────────────────────────────

async function refreshFirebaseToken(refreshToken) {
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  })
  if (!res.ok) return { ok: false, error: `Firebase HTTP ${res.status}` }
  const data = await res.json()
  if (!data.id_token && !data.access_token) return { ok: false, error: 'Firebase tidak mengirim token' }
  return {
    ok: true,
    accessToken: data.id_token || data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: Number(data.expires_in) || 3600,
  }
}

async function refreshSupabaseToken(refreshToken) {
  const res = await fetch(`${ONEOVER_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ONEOVER_SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    return { ok: false, error: data.error_description || data.error || `Supabase HTTP ${res.status}` }
  }
  return {
    ok: true,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: Number(data.expires_in) || 3600,
  }
}

async function handleRefresh({ providerId, key, refreshToken } = {}) {
  const provider = providerById(providerId)
  if (!provider || !provider.refresh) return fail('provider ini tidak bisa di-refresh')
  const list = await listTokens(provider.id)
  const entry = (key != null && list[Number(key)]) || bestEntry(list)
  const token = refreshToken || (entry && entry.refreshToken)
  if (!token) return fail('tidak ada refresh token tersimpan untuk provider ini')

  const result =
    provider.refresh === 'firebase' ? await refreshFirebaseToken(token) : await refreshSupabaseToken(token)
  if (!result.ok) return result

  await putEntry(
    provider,
    buildEntry({
      token: result.accessToken,
      refreshToken: result.refreshToken,
      source: `refresh:${provider.refresh}`,
    }),
  )
  return ok({ accessToken: result.accessToken, refreshToken: result.refreshToken, expiresIn: result.expiresIn })
}

// ── Cek saldo ────────────────────────────────────────────────────────────────

function decodeSub(token) {
  try {
    const payload = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload)).sub || ''
  } catch {
    return ''
  }
}

/** Access token yang masih segar; kalau kedaluwarsa, refresh dulu. */
async function accessTokenFor(provider) {
  const list = await listTokens(provider.id)
  const entry = bestEntry(list)
  if (!entry) return null
  const fresh = entry.exp && entry.exp > Date.now() + 30_000
  if (entry.token && fresh) return entry.token
  if (entry.refreshToken && provider.refresh) {
    const refreshed = await handleRefresh({ providerId: provider.id })
    if (refreshed.ok) return refreshed.accessToken
  }
  return entry.token || null
}

async function handleBalance({ providerId, token } = {}) {
  const provider = providerById(providerId)
  if (!provider || !provider.balance) return fail('provider ini tidak punya cek saldo')

  const accessToken = token || (await accessTokenFor(provider))
  if (!accessToken) return fail('tidak ada token tersimpan — klik Scan dulu')

  if (provider.balance === 'galleri5') {
    const res = await fetch(`${G5_BACKEND}/api/v1/auth/me/info`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
    if (!res.ok) return fail(`G5 HTTP ${res.status}`)
    const data = await res.json().catch(() => ({}))
    const value = data.balance ?? data.credits ?? data.credit ?? data.remaining ?? data.data?.balance
    return ok({ balance: value ?? null, raw: value == null ? data : undefined })
  }

  const stored = (await listTokens(provider.id)).find((entry) => entry.token === accessToken)
  const userId = (stored && stored.sub) || decodeSub(accessToken)
  const url = `${ONEOVER_SUPABASE_URL}/functions/v1/get-credit-balance${userId ? `?user_id=${encodeURIComponent(userId)}` : ''}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, apikey: ONEOVER_SUPABASE_ANON_KEY },
  })
  if (!res.ok) return fail(`Supabase HTTP ${res.status}`)
  const data = await res.json().catch(() => ({}))
  return ok({ balance: data.balance ?? data.credits ?? null })
}

// ── Input manual & diagnostik ────────────────────────────────────────────────

/** Terima JSON sesi, JSON header, atau token mentah (dipisah spasi/baris). */
function parseManualInput(text) {
  const raws = []
  const trimmed = String(text || '').trim()
  if (!trimmed) return raws
  try {
    const parsed = JSON.parse(trimmed)
    const value = parsed.current_session || parsed.session || parsed
    raws.push({
      token: value.access_token || value.token || value.accessToken || '',
      refreshToken: value.refresh_token || value.refreshToken || '',
      extra: value,
      source: 'manual',
    })
    return raws
  } catch {
    /* bukan JSON: perlakukan sebagai daftar token */
  }
  for (const line of trimmed.split(/\s+/)) {
    const clean = line.trim()
    if (clean.length < 20) continue
    raws.push(clean.includes('.') ? { token: clean, source: 'manual' } : { refreshToken: clean, source: 'manual' })
  }
  return raws
}

async function handleAdd({ providerId, text } = {}) {
  const provider = providerById(providerId)
  if (!provider) return fail('provider tidak dikenal')
  const raws = parseManualInput(text)
  if (!raws.length) return fail('tidak ada token yang terbaca dari input')
  const stored = await storeRaw(provider, raws, 'manual')
  return ok({ providerId: provider.id, stored })
}

async function handleDiagnostics({ providerId } = {}) {
  const provider = providerById(providerId)
  if (!provider) return fail('provider tidak dikenal')
  if (provider.id !== 'oneover') {
    return ok({ lines: ['Diagnostik cookie hanya relevan untuk OneOver (sesi Supabase HttpOnly).'] })
  }
  return ok({ lines: await cookieDiagnostics(ONEOVER_COOKIE_DOMAINS) })
}

// ── Snapshot untuk popup ─────────────────────────────────────────────────────

async function handleState() {
  const { tokens, appUrl } = await loadState()
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const activeProvider = activeTab ? providerForHost(hostOf(activeTab.url || '')) : null
  return ok({
    appUrl: appUrl || DEFAULT_APP_URL,
    defaultAppUrl: DEFAULT_APP_URL,
    activeTabHost: activeTab ? hostOf(activeTab.url || '') : '',
    activeProviderId: activeProvider ? activeProvider.id : null,
    providers: PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      emoji: p.emoji,
      ink: p.ink,
      hint: p.hint,
      appField: p.appField,
      hosts: p.hosts,
      copy: p.copy,
      extras: p.extras,
      canRefresh: !!p.refresh,
      canBalance: !!p.balance,
      canScan: p.readers.length > 0 || p.capture.includes('cookies'),
      cookiePrefix: p.id === 'oneover' ? ONEOVER_COOKIE_PREFIX : '',
      count: (tokens[p.id] || []).length,
    })),
    tokens,
  })
}

// ── Router pesan ─────────────────────────────────────────────────────────────

const HANDLERS = {
  state: handleState,
  capture: handleCapture,
  scan: handleScan,
  refresh: handleRefresh,
  balance: handleBalance,
  add: handleAdd,
  diagnostics: handleDiagnostics,
  clear: async ({ providerId }) => {
    const provider = providerById(providerId)
    if (!provider) return fail('provider tidak dikenal')
    await clearProvider(provider)
    return ok({ providerId: provider.id })
  },
  remove: async ({ providerId, key }) => {
    const provider = providerById(providerId)
    if (!provider) return fail('provider tidak dikenal')
    await removeEntry(provider, key)
    return ok({ providerId: provider.id })
  },
  app_url: async ({ url }) => {
    await setAppUrl(url)
    return ok({ appUrl: url })
  },
  // Dipakai tombol mengambang di halaman: kirim isi clipboard yang sudah
  // diformat sesuai provider, supaya aturannya tetap satu tempat dengan popup.
  best_token: async ({ providerId }) => {
    const provider = providerById(providerId)
    if (!provider) return fail('provider tidak dikenal')
    const entry = bestEntry(await listTokens(provider.id))
    if (!entry) return ok({ payload: '', label: provider.label })
    return ok({ payload: copyPayloadFor(provider, entry, provider.copy), label: provider.label })
  },
  provider_for_host: async ({ host }) => {
    const provider = providerForHost(host)
    if (!provider) return ok({ provider: null })
    return ok({
      provider: { id: provider.id, label: provider.label, emoji: provider.emoji, ink: provider.ink },
    })
  },
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = msg && msg.type ? HANDLERS[msg.type] : null
  if (!handler) {
    sendResponse(fail(`pesan tidak dikenal: ${msg && msg.type}`))
    return false
  }
  Promise.resolve(handler(msg))
    .then(sendResponse)
    .catch((error) => sendResponse(fail(error)))
  return true // respons asinkron
})

// ── Otomatisasi ringan ───────────────────────────────────────────────────────

// Auto-scan saat tab provider selesai dimuat. Throttle per tab supaya navigasi
// SPA tidak memicu pemindaian berulang.
const lastAutoScan = new Map()

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab || !tab.url) return
  const provider = providerForHost(hostOf(tab.url))
  if (!provider || !provider.readers.length) return
  const last = lastAutoScan.get(tabId) || 0
  if (Date.now() - last < 15_000) return
  lastAutoScan.set(tabId, Date.now())
  try {
    const raws = await runReadersOnTab(provider, tab)
    if (raws.length) await storeRaw(provider, raws, 'auto-scan')
  } catch (error) {
    console.warn('[auth-helper] auto-scan gagal:', error.message)
  }
})

// Badge mengikuti provider yang sedang dibuka, jadi sekilas terlihat berapa
// token yang tersimpan untuk situs itu.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId)
    const provider = providerForHost(hostOf((tab && tab.url) || ''))
    if (provider) await refreshBadgeFor(provider)
  } catch {
    /* tab bisa sudah ditutup */
  }
})

chrome.runtime.onInstalled.addListener(async () => {
  const { appUrl } = await loadState()
  if (!appUrl) await setAppUrl(DEFAULT_APP_URL)
  for (const provider of PROVIDERS) await refreshBadgeFor(provider)
})

console.log('[auth-helper] background siap — provider:', PROVIDERS.map((p) => p.id).join(', '))
