// ─── Penyimpanan token ───────────────────────────────────────────────────────
// Satu namespace untuk semua provider (dulu tiap ekstensi punya kunci sendiri:
// galleri5_tokens, oo_tokens, jwt_tokens, …), sehingga popup hanya perlu satu
// pembacaan dan tidak ada kunci yang tertinggal saat provider ditambah.
//
//   ah_tokens_v1 : { [providerId]: TokenEntry[] }
//   ah_app_url   : string — alamat app, untuk tombol "Copy & buka Providers"

import { mergeEntry } from './tokens.js'

export const TOKENS_KEY = 'ah_tokens_v1'
export const APP_URL_KEY = 'ah_app_url'

/** Baca seluruh state (map token + app URL). */
export async function loadState() {
  const raw = await chrome.storage.local.get([TOKENS_KEY, APP_URL_KEY])
  const tokens = raw[TOKENS_KEY] && typeof raw[TOKENS_KEY] === 'object' ? raw[TOKENS_KEY] : {}
  return { tokens, appUrl: typeof raw[APP_URL_KEY] === 'string' ? raw[APP_URL_KEY] : '' }
}

async function writeTokens(tokens) {
  await chrome.storage.local.set({ [TOKENS_KEY]: tokens })
}

/** Token milik satu provider. */
export async function listTokens(providerId) {
  const { tokens } = await loadState()
  return tokens[providerId] || []
}

/**
 * Simpan entri untuk provider, dedupe lewat mergeEntry. Mengembalikan entri yang
 * benar-benar tersimpan supaya pemanggil bisa melaporkan sumbernya.
 */
export async function putEntry(provider, entry) {
  const { tokens } = await loadState()
  const next = { ...tokens, [provider.id]: mergeEntry(tokens[provider.id] || [], entry, provider.max) }
  await writeTokens(next)
  await setBadge(provider.id, next[provider.id].length, provider.ink)
  return entry
}

/** Hapus satu entri (berdasarkan kunci dedupe-nya). */
export async function removeEntry(provider, key) {
  const { tokens } = await loadState()
  const next = { ...tokens, [provider.id]: (tokens[provider.id] || []).filter((item, i) => String(i) !== String(key)) }
  await writeTokens(next)
  await setBadge(provider.id, next[provider.id].length, provider.ink)
}

/** Kosongkan token satu provider. */
export async function clearProvider(provider) {
  const { tokens } = await loadState()
  const next = { ...tokens, [provider.id]: [] }
  await writeTokens(next)
  await setBadge(provider.id, 0, provider.ink)
}

export async function setAppUrl(url) {
  await chrome.storage.local.set({ [APP_URL_KEY]: String(url || '').replace(/\/+$/, '') })
}

/**
 * Badge = jumlah token provider yang sedang dibuka. Provider ini punya warna
 * sendiri, jadi badge sekaligus menandakan "ini tab provider yang mana".
 */
export async function setBadge(providerId, count, ink = '#7c3aed') {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: ink })
    await chrome.action.setBadgeText({ text: count ? String(count) : '' })
  } catch {
    /* action tidak selalu tersedia (mis. saat service worker bangun) */
  }
}

/** Hitung badge dari token provider tertentu tanpa menulis ulang apa pun. */
export async function refreshBadgeFor(provider) {
  const list = await listTokens(provider.id)
  await setBadge(provider.id, list.length, provider.ink)
}
