// ─── Pembacaan cookie (sisi background) ──────────────────────────────────────
// Cookie sesi Supabase biasanya HttpOnly, jadi halaman tidak bisa membacanya
// lewat document.cookie. chrome.cookies bisa, dan itulah sebabnya permission
// "cookies" tetap ada di ekstensi ini meski permission berat lainnya dibuang.

import { ONEOVER_COOKIE_PREFIX } from '../providers.js'
import { isJwt, isRefreshToken } from './jwt.js'

function getCookies(domain) {
  return new Promise((resolve) => {
    try {
      chrome.cookies.getAll({ domain }, (cookies) => resolve(cookies || []))
    } catch {
      resolve([])
    }
  })
}

/** Nilai cookie Supabase: `base64-<json>`, JSON langsung, atau string mentah. */
function parseSupabaseCookieValue(value) {
  const raw = String(value || '')
  const candidates = [raw.startsWith('base64-') ? raw.slice(7) : raw]
  for (const candidate of candidates) {
    try {
      const json = atob(candidate)
      const parsed = JSON.parse(json)
      const session = parsed.current_session || parsed.session || parsed
      if (session && session.access_token) {
        return { token: session.access_token, refreshToken: session.refresh_token || '' }
      }
    } catch {
      /* bukan base64 JSON */
    }
    try {
      const parsed = JSON.parse(candidate)
      const session = parsed.current_session || parsed.session || parsed
      if (session && session.access_token) {
        return { token: session.access_token, refreshToken: session.refresh_token || '' }
      }
    } catch {
      /* bukan JSON */
    }
  }
  return null
}

/** Gabungkan cookie yang terpotong (sb-xxx.0, sb-xxx.1, …) lalu parse. */
function parseChunkedCookies(cookies, prefix) {
  const chunks = []
  for (const cookie of cookies) {
    if (cookie.name && cookie.name.startsWith(prefix + '.')) {
      const index = Number.parseInt(cookie.name.slice(prefix.length + 1), 10)
      if (Number.isFinite(index)) chunks[index] = cookie.value
    }
  }
  if (!chunks.length || chunks.some((part) => part == null)) return null
  try {
    const parsed = JSON.parse(chunks.join(''))
    const session = parsed.current_session || parsed
    if (session && session.access_token) {
      return { token: session.access_token, refreshToken: session.refresh_token || '' }
    }
  } catch {
    /* gabungan tidak valid */
  }
  return null
}

/**
 * Cari sesi Supabase di cookie untuk domain yang diberikan. Urutan strategi
 * mengikuti implementasi lama yang sudah terbukti: kunci baku → cookie terpotong
 * → cookie mana pun yang berisi JWT/refresh token.
 */
export async function readSupabaseCookies(domains) {
  const seen = new Set()
  const found = []
  for (const domain of domains) {
    const cookies = await getCookies(domain)
    const exact = cookies.find((c) => c.name === ONEOVER_COOKIE_PREFIX)
    const entries = [
      exact ? { ...parseSupabaseCookieValue(exact.value), source: `cookie:${exact.name}` } : null,
      (() => {
        const chunked = parseChunkedCookies(cookies, ONEOVER_COOKIE_PREFIX)
        return chunked ? { ...chunked, source: `cookie-chunked:${ONEOVER_COOKIE_PREFIX}` } : null
      })(),
      ...cookies
        .filter((c) => isJwt(c.value))
        .map((c) => ({ token: c.value, refreshToken: '', source: `cookie:${c.name}` })),
      ...cookies
        .filter((c) => !isJwt(c.value) && isRefreshToken(c.value))
        .map((c) => ({ token: '', refreshToken: c.value, source: `cookie:${c.name}` })),
    ]
    for (const entry of entries) {
      if (!entry) continue
      if (!entry.token && !entry.refreshToken) continue
      const key = entry.token || entry.refreshToken
      if (seen.has(key)) continue
      seen.add(key)
      found.push(entry)
    }
  }
  return found
}

/**
 * Diagnostik cookie TANPA nilai: nama, domain, flag, dan panjang nilainya saja.
 * Versi lama menampilkan potongan nilai cookie — itu berarti menampilkan token
 * sesi ke layar, jadi sekarang sengaja tidak.
 */
export async function cookieDiagnostics(domains) {
  const lines = []
  for (const domain of domains) {
    const cookies = await getCookies(domain)
    lines.push(`${domain} → ${cookies.length} cookie`)
    for (const cookie of cookies) {
      lines.push(
        `  ${cookie.name} (${String(cookie.value || '').length} char, httpOnly=${!!cookie.httpOnly}, secure=${!!cookie.secure})`,
      )
    }
  }
  return lines
}
