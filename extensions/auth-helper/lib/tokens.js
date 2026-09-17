// ─── Bentuk entri token & format penyalinan ──────────────────────────────────
// Satu entri mewakili satu sesi (satu akun) untuk satu provider:
//   { token, refreshToken, kind, email, sub, exp, capturedAt, source, extra }
//
// `token` adalah token akses/ID (biasanya JWT) dan `refreshToken` opsional.
// Entri didedupe per akun (klaim `sub`, kalau tidak ada pakai sidik jari token)
// supaya menangkap token yang sama berulang kali tidak menumpuk kartu di popup.

import { fingerprint, isJwt, isRefreshToken, jwtExpiryMs, jwtIdentity } from './jwt.js'

/** Buat entri ternormalisasi dari hasil capture mana pun. */
export function buildEntry({ token = '', refreshToken = '', kind = '', source = '', extra = {} } = {}) {
  const access = String(token || '').trim().replace(/^Bearer\s+/i, '')
  const refresh = String(refreshToken || '').trim()
  const _primary = access || refresh
  const identity = access ? jwtIdentity(access) : refresh ? jwtIdentity(refresh) : { email: '', sub: '' }
  return {
    token: access,
    refreshToken: refresh,
    kind: kind || (isJwt(access) ? 'access' : isRefreshToken(refresh) ? 'refresh' : 'unknown'),
    email: identity.email,
    sub: identity.sub,
    exp: access ? jwtExpiryMs(access) : null,
    capturedAt: Date.now(),
    source,
    extra: Object.keys(extra).length ? extra : {},
  }
}

/** Apakah entri ini layak disimpan (ada token yang bisa dipakai). */
export function isUsableEntry(entry) {
  return !!(entry && (isJwt(entry.token) || isRefreshToken(entry.refreshToken) || entry.token.length > 40))
}

/** Kunci dedupe: utamakan identitas akun, fallback ke sidik jari token. */
export function entryKey(entry) {
  const account = entry.sub || ''
  return account ? `sub:${account}` : `fp:${fingerprint(entry.token || entry.refreshToken)}`
}

/**
 * Gabungkan entri baru ke daftar: entri untuk akun yang sama digantikan (token
 * terbaru menang, refresh token lama dipertahankan kalau yang baru tidak punya),
 * lalu dipotong `max` dan tetap urut terbaru dulu.
 */
export function mergeEntry(list, entry, max = 5) {
  const key = entryKey(entry)
  const existing = (list || []).find((item) => entryKey(item) === key)
  const merged = existing && !entry.refreshToken && existing.refreshToken
    ? { ...entry, refreshToken: existing.refreshToken }
    : entry
  const rest = (list || []).filter((item) => entryKey(item) !== key)
  return [merged, ...rest].slice(0, Math.max(1, max))
}

/** Entri terbaik untuk disalin: utamakan yang belum kedaluwarsa & punya refresh. */
export function bestEntry(list) {
  const items = list || []
  if (!items.length) return null
  const now = Date.now()
  const alive = items.filter((item) => !item.exp || item.exp > now)
  const pool = alive.length ? alive : items
  return pool.find((item) => item.refreshToken) || pool[0]
}

/** Potongan token untuk ditampilkan (tidak pernah menampilkan token utuh). */
export function maskToken(token) {
  const t = String(token || '')
  if (t.length <= 24) return t
  return `${t.slice(0, 14)}…${t.slice(-6)}`
}

/**
 * Isi clipboard untuk sebuah format. Format `json` disesuaikan per provider
 * supaya cocok dengan yang di-parse halaman Providers:
 *  - oneover → { access_token, refresh_token } (app menyimpan refresh_token-nya)
 *  - firefly → { token, apiKey, account, session } (field yang disebut hint app)
 */
export function copyPayloadFor(provider, entry, format = 'raw') {
  if (!entry) return ''
  const access = entry.token || ''
  const refresh = entry.refreshToken || ''
  const raw = access || refresh

  if (format === 'refresh') return refresh || raw
  if (format === 'access') return access || raw
  if (format === 'json') {
    if (provider?.id === 'firefly') {
      const extra = entry.extra || {}
      return JSON.stringify({
        token: raw,
        apiKey: extra.apiKey || '',
        account: extra.account || '',
        session: extra.session || '',
      })
    }
    if (provider?.id === 'oneover') {
      return JSON.stringify({ access_token: access, refresh_token: refresh })
    }
    return JSON.stringify({ access_token: access, refresh_token: refresh, token: raw })
  }
  return raw
}
