// ─── Auto-sync credential ke app ─────────────────────────────────────────────
// App menyimpan JWT login di localStorage (`arkxmotion_token`, lihat
// src/stores/authStore.ts) dan punya endpoint POST /api/sync-tokens yang
// menyimpan credential per user_id. Ekstensi ini mengambil JWT itu dari tab app
// yang sedang login — izin milik user sendiri, tanpa copy-paste — lalu memakai
// token itu sebagai beban autentikasi saat mengirim credential provider.
//
// Alur yang sama dipakai riverside-token-ext dan nexabot-token-ext; bedanya di
// sini dipakai bersama oleh semua provider yang punya kunci `sync` di registry.
//
// Dua hal yang sengaja TIDAK dilakukan:
//  - mengirim ke origin yang tidak dipilih user. JWT app ditandatangani
//    JWT_SECRET milik server itu, jadi origin lain hanya akan menolak 401 —
//    dan mengirim token provider ke host asing berarti membocorkan token.
//  - menyentuh tanda tangan JWT. Payload dikirim apa adanya; server yang tahu
//    artinya (queue in-memory di dev, Postgres per user di produksi).

import { DEFAULT_APP_URL } from '../providers.js'

/** Key localStorage tempat app menyimpan JWT login. */
export const APP_TOKEN_STORAGE_KEY = 'arkxmotion_token'

/** Kandidat origin tab app: dev server Vite/Express dan deployment Vercel. */
export const APP_TAB_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:6000',
  DEFAULT_APP_URL,
]

const APP_TOKEN_KEY = 'ah_app_token'
const APP_TOKEN_ORIGIN_KEY = 'ah_app_token_origin'
const SYNC_ENABLED_KEY = 'ah_sync_enabled'
const SYNC_STATUS_KEY = 'ah_sync_status'
const SYNC_SENT_KEY = 'ah_sync_sent'

// ── Fungsi murni (diuji di test/authHelperSync.test.ts) ─────────────────────

/**
 * Daftar origin yang layak dicoba: buang yang kosong, duplikat, dan bukan
 * http(s). Origin dari App URL pilihan user ikut di sini, tapi apa pun yang
 * bukan web diabaikan supaya token tidak pernah dikirim ke skema lain.
 */
export function uniqueOrigins(list) {
  const result = []
  for (const item of list || []) {
    const clean = String(item || '').trim().replace(/\/+$/, '')
    if (!clean || result.includes(clean)) continue
    if (!/^https?:\/\//i.test(clean)) continue
    result.push(clean)
  }
  return result
}

/**
 * Token yang dikirim ke app untuk sebuah provider.
 *  - `prefer: 'refresh'` (G5 & OneOver): refresh token lebih tahan lama dan app
 *    memang menukarnya sendiri ke access token;
 *  - `prefer: 'token'` (Firefly): Adobe IMS tidak punya refresh token.
 */
export function syncTokenFor(provider, entry) {
  if (!provider || !provider.sync || !entry) return ''
  if (provider.sync.prefer === 'refresh') return entry.refreshToken || entry.token || ''
  return entry.token || entry.refreshToken || ''
}

/** Body POST /api/sync-tokens. `kind: 'token'` = masuk ke field `key` app. */
export function syncBodyFor(provider, entry, source = 'auth-helper') {
  return {
    provider: provider.sync.provider,
    token: syncTokenFor(provider, entry),
    kind: 'token',
    source: String(source || 'auth-helper').slice(0, 80),
  }
}

/**
 * Sidik jari token untuk mencegah kirim berulang.
 *
 * Sengaja BUKAN potongan awal token: dua JWT dari issuer yang sama berbagi
 * header base64 yang panjang, jadi prefix-nya bisa identik walau tokennya
 * berbeda — token baru akan dianggap "sudah pernah dikirim" dan tidak pernah
 * sampai ke app. FNV-1a 32-bit + panjang token membedakannya dengan murah, dan
 * yang disimpan hanya hash-nya (bukan rahasianya).
 */
export function syncFingerprint(token) {
  const text = String(token || '')
  if (!text) return ''
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${hash.toString(36)}:${text.length}`
}

// ── Status & preferensi ─────────────────────────────────────────────────────

export async function getSyncEnabled() {
  const data = await chrome.storage.local.get(SYNC_ENABLED_KEY)
  return data[SYNC_ENABLED_KEY] !== false // aktif secara default
}

export async function setSyncEnabled(enabled) {
  await chrome.storage.local.set({ [SYNC_ENABLED_KEY]: !!enabled })
}

export async function getSyncStatuses() {
  const data = await chrome.storage.local.get(SYNC_STATUS_KEY)
  return data[SYNC_STATUS_KEY] || {}
}

async function setSyncStatus(providerId, status) {
  const statuses = await getSyncStatuses()
  statuses[providerId] = status
  await chrome.storage.local.set({ [SYNC_STATUS_KEY]: statuses })
}

// ── Membaca JWT app dari tab yang login ─────────────────────────────────────

function readLocalStorageValue(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

async function readAppTokenFromTabs(origins) {
  for (const origin of origins) {
    let tabs = []
    try {
      // Pola match Chrome mengabaikan port, jadi `http://localhost/*` sudah
      // mencakup 5173/6000, sedangkan origin di sini tetap spesifik per port.
      tabs = await chrome.tabs.query({ url: `${origin}/*` })
    } catch {
      continue
    }
    for (const tab of tabs) {
      if (tab.id == null) continue
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: readLocalStorageValue,
          args: [APP_TOKEN_STORAGE_KEY],
        })
        const token = result && result.result
        if (token && typeof token === 'string' && token.length > 20) return { token, origin }
      } catch {
        // Tab tidak bisa di-script (chrome://, tab dibekukan, dsb) → kandidat lain.
      }
    }
  }
  return null
}

/**
 * JWT app + origin asalnya. Cache dipakai hanya kalau origin-nya masih ada di
 * daftar yang diizinkan — kalau user mengganti App URL, JWT lama tidak lagi
 * dikirim ke sana.
 */
export async function getAppToken({ refresh = false, origins } = {}) {
  const candidates = uniqueOrigins(origins && origins.length ? origins : APP_TAB_ORIGINS)
  if (!refresh) {
    const cached = await chrome.storage.local.get([APP_TOKEN_KEY, APP_TOKEN_ORIGIN_KEY])
    const token = cached[APP_TOKEN_KEY]
    const origin = cached[APP_TOKEN_ORIGIN_KEY]
    if (token && origin && candidates.includes(origin)) return { token, origin }
  }
  const found = await readAppTokenFromTabs(candidates)
  if (!found) return null
  await chrome.storage.local.set({ [APP_TOKEN_KEY]: found.token, [APP_TOKEN_ORIGIN_KEY]: found.origin })
  return found
}

export async function forgetAppToken() {
  await chrome.storage.local.remove([APP_TOKEN_KEY, APP_TOKEN_ORIGIN_KEY])
}

// ── Kirim credential ────────────────────────────────────────────────────────

async function postCredential(base, body, appToken) {
  const res = await fetch(`${base}/api/sync-tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(appToken ? { Authorization: `Bearer ${appToken}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const parsed = JSON.parse(text)
      if (parsed && parsed.error) message = parsed.error
    } catch {
      /* body bukan JSON */
    }
    return { ok: false, status: res.status, message }
  }
  return { ok: true, message: 'terkirim' }
}

/**
 * Kirim token terbaik milik `provider` ke app.
 * Opsi `force` dipakai tombol "Kirim sekarang" (mengabaikan sakelar dan dedupe),
 * sedangkan capture otomatis memakai mode diam lewat `autoSyncProvider`.
 */
export async function pushToApp(provider, entry, { source = 'auth-helper', force = false, origins } = {}) {
  if (!provider || !provider.sync) return { ok: false, message: 'provider tidak mendukung sync' }
  const enabled = await getSyncEnabled()
  if (!enabled && !force) return { ok: false, message: 'sync otomatis sedang dimatikan', skipped: true }

  const body = syncBodyFor(provider, entry, source)
  if (!body.token) return { ok: false, message: 'tidak ada token untuk dikirim' }

  if (!force) {
    const sent = await chrome.storage.local.get(SYNC_SENT_KEY)
    const fingerprint = syncFingerprint(body.token)
    if (sent[SYNC_SENT_KEY] && sent[SYNC_SENT_KEY][provider.id] === fingerprint) {
      return { ok: true, message: 'token ini sudah pernah dikirim', skipped: true }
    }
  }

  const found = await getAppToken({ origins })
  if (!found) {
    const status = { ok: false, at: Date.now(), message: 'buka tab app sambil login dulu' }
    await setSyncStatus(provider.id, status)
    return status
  }

  let result = await postCredential(found.origin, body, found.token)
  if (!result.ok && (result.status === 401 || result.status === 403)) {
    // JWT kedaluwarsa / login app berubah → baca ulang sekali.
    await forgetAppToken()
    const fresh = await getAppToken({ refresh: true, origins })
    if (fresh) result = await postCredential(fresh.origin, body, fresh.token)
  }

  const status = { ok: !!result.ok, at: Date.now(), message: result.message, origin: found.origin }
  await setSyncStatus(provider.id, status)
  if (result.ok) {
    const sent = await chrome.storage.local.get(SYNC_SENT_KEY)
    const map = sent[SYNC_SENT_KEY] || {}
    map[provider.id] = syncFingerprint(body.token)
    await chrome.storage.local.set({ [SYNC_SENT_KEY]: map })
  }
  return status
}

/** Buang riwayat "sudah terkirim" — dipakai sebelum percobaan ulang manual. */
export async function resetSyncHistory(providerId) {
  const sent = await chrome.storage.local.get(SYNC_SENT_KEY)
  const map = sent[SYNC_SENT_KEY] || {}
  if (providerId) delete map[providerId]
  else for (const key of Object.keys(map)) delete map[key]
  await chrome.storage.local.set({ [SYNC_SENT_KEY]: map })
  return map
}
