// ─── Test ekstensi auth-helper (murni, tanpa Chrome) ─────────────────────────
// Ekstensi ini tidak punya build step dan tidak bisa dijalankan di Node, tapi
// bagian yang paling mudah rusak justru yang murni: kecocokan host, dedupe
// entri token, format clipboard per provider, dan parsing cookie Supabase yang
// penuh kasus tepi. Semua itu diuji di sini — termasuk janji bahwa diagnostik
// TIDAK pernah menampilkan nilai cookie.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  COPY_LABELS,
  ONEOVER_COOKIE_PREFIX,
  PROVIDERS,
  providerForHost,
  providerTabPatterns,
} from '../extensions/auth-helper/providers.js'
import { expiryLabel, isJwt, isRefreshToken, jwtIdentity } from '../extensions/auth-helper/lib/jwt.js'
import {
  bestEntry,
  buildEntry,
  copyPayloadFor,
  entryKey,
  maskToken,
  mergeEntry,
} from '../extensions/auth-helper/lib/tokens.js'
import { activeTabJwt, firebaseIndexedDb, supabaseLocalStorage } from '../extensions/auth-helper/lib/readers.js'
import { cookieDiagnostics, readSupabaseCookies } from '../extensions/auth-helper/lib/cookies.js'

// ── Fixture ──────────────────────────────────────────────────────────────────

const b64url = (value: string) =>
  Buffer.from(value, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** JWT palsu dengan payload yang bisa diatur. */
function makeJwt(payload: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.signature-part`
}

const REFRESH_60 = 'AMf-' + 'a'.repeat(60)
const APP_JWT_RE = /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/
const APP_REFRESH_RE = /^[\w-]{60,}$/

// ── Registry ─────────────────────────────────────────────────────────────────

test('registry: id unik dan format copy selalu dikenali popup', () => {
  const ids = PROVIDERS.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const provider of PROVIDERS) {
    assert.ok(provider.label && provider.hint && provider.ink, `${provider.id} metadata kurang`)
    assert.ok(Object.hasOwn(COPY_LABELS, provider.copy), `${provider.id} format copy tidak dikenal`)
    for (const extra of provider.extras) {
      assert.ok(Object.hasOwn(COPY_LABELS, extra), `${provider.id} extra "${extra}" tidak punya label`)
    }
  }
})

test('registry: capture hanya memakai sumber yang didukung', () => {
  const allowed = ['network', 'reader', 'cookies']
  for (const provider of PROVIDERS) {
    for (const source of provider.capture) {
      assert.ok(allowed.includes(source), `${provider.id} memakai sumber tak dikenal: ${source}`)
    }
    // Provider yang membaca halaman harus mendeklarasikan reader-nya.
    if (provider.capture.includes('reader')) assert.ok(provider.readers.length > 0, `${provider.id} tanpa reader`)
  }
})

test('registry: pencocokan host tepat dan tidak tertipu domain mirip', () => {
  assert.equal(providerForHost('aistudio.galleri5.com').id, 'galleri5')
  assert.equal(providerForHost('oneover.com').id, 'oneover')
  assert.equal(providerForHost('www.oneover.com').id, 'oneover')
  assert.equal(providerForHost('firefly.adobe.com').id, 'firefly')
  // Domain yang hanya *mengandung* nama provider tidak boleh cocok.
  assert.equal(providerForHost('oneover.com.evil.example'), null)
  assert.equal(providerForHost('notoneover.com'), null)
  assert.equal(providerForHost(''), null)
})

test('registry: provider generik tanpa host, pola tab hanya dari host sendiri', () => {
  const generic = PROVIDERS.find((p) => p.id === 'jwt')
  assert.deepEqual(generic.hosts, [])
  assert.deepEqual(providerTabPatterns(generic), [])
  assert.deepEqual(providerTabPatterns(PROVIDERS.find((p) => p.id === 'galleri5')), [
    '*://*.aistudio.galleri5.com/*',
  ])
})

// ── Predikat token selaras dengan app ────────────────────────────────────────

test('predikat token sama persis dengan klasifikasi di app', () => {
  // Aturan app ada di src/pages/Providers.tsx (JWT eyJ… dan refresh token ≥60 char).
  const samples = [
    makeJwt({ sub: 'abc' }),
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
    REFRESH_60,
    'a'.repeat(59),
    'AMf-short',
    'eyJ.has.dot.and.extra',
    '',
  ]
  for (const sample of samples) {
    assert.equal(isJwt(sample), APP_JWT_RE.test(sample.trim()), `isJwt beda untuk: ${sample.slice(0, 20)}`)
    assert.equal(
      isRefreshToken(sample),
      !sample.includes('.') && APP_REFRESH_RE.test(sample.trim()),
      `isRefreshToken beda untuk: ${sample.slice(0, 20)}`,
    )
  }
})

test('identitas & label umur token dibaca dari payload', () => {
  const exp = Date.now() + 42 * 60_000
  const token = makeJwt({ sub: 'user-1', email: 'budi@example.com', exp: Math.floor(exp / 1000) })
  assert.deepEqual(jwtIdentity(token), { email: 'budi@example.com', sub: 'user-1' })
  assert.match(expiryLabel(exp), /^sisa 4[12] mnt$/)
  assert.match(expiryLabel(Date.now() - 3 * 60_000), /^kedaluwarsa 3 mnt lalu$/)
  assert.equal(expiryLabel(null), 'tanpa exp')
  assert.equal(maskToken('x'.repeat(50)).includes('x'.repeat(30)), false)
})

// ── Entri token ──────────────────────────────────────────────────────────────

test('entri didedupe per akun dan refresh token lama tidak hilang', () => {
  const first = buildEntry({
    token: makeJwt({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 600 }),
    refreshToken: REFRESH_60,
    source: 'network',
  })
  const second = buildEntry({
    token: makeJwt({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 9000 }),
    source: 'refresh',
  })
  assert.equal(entryKey(first), entryKey(second))

  const merged = mergeEntry([first], second, 5)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].source, 'refresh')
  // Token akses baru, tapi refresh token dari entri lama tetap terpakai.
  assert.equal(merged[0].refreshToken, REFRESH_60)
})

test('daftar dibatasi max dan entri terbaru selalu di depan', () => {
  const entries = Array.from({ length: 7 }, (_, i) =>
    buildEntry({ token: makeJwt({ sub: `user-${i}` }), source: `s${i}` }),
  )
  let list: any[] = []
  for (const entry of entries) list = mergeEntry(list, entry, 5)
  assert.equal(list.length, 5)
  assert.equal(list[0].source, 's6')
  assert.equal(list.some((e) => e.source === 's0'), false)
})

test('bestEntry memilih token yang masih hidup dan punya refresh token', () => {
  const expired = buildEntry({ token: makeJwt({ sub: 'old', exp: 1 }), refreshToken: REFRESH_60 })
  const alive = buildEntry({ token: makeJwt({ sub: 'new', exp: Math.floor(Date.now() / 1000) + 3600 }) })
  assert.equal(bestEntry([expired, alive]).sub, 'new')
  // Kalau semuanya kedaluwarsa, yang punya refresh token tetap dipilih.
  assert.equal(bestEntry([expired]).refreshToken, REFRESH_60)
  assert.equal(bestEntry([]), null)
})

test('format clipboard mengikuti yang diterima halaman Providers', () => {
  const galleri5 = PROVIDERS.find((p) => p.id === 'galleri5')
  const oneover = PROVIDERS.find((p) => p.id === 'oneover')
  const firefly = PROVIDERS.find((p) => p.id === 'firefly')
  const entry = buildEntry({
    token: makeJwt({ sub: 'u1', email: 'a@b.c' }),
    refreshToken: REFRESH_60,
    extra: { apiKey: 'key-123', account: 'acc-1', session: 'sess-1' },
  })

  // Galleri5: refresh token yang disalin default (app menukarnya sendiri).
  assert.equal(copyPayloadFor(galleri5, entry, 'refresh'), REFRESH_60)
  assert.equal(copyPayloadFor(galleri5, entry, 'access'), entry.token)

  // OneOver: JSON yang bisa di-parse app.
  const oneoverJson = JSON.parse(copyPayloadFor(oneover, entry, 'json'))
  assert.equal(oneoverJson.access_token, entry.token)
  assert.equal(oneoverJson.refresh_token, REFRESH_60)

  // Firefly: JSON berisi field yang disebut hint app, plus token mentah.
  const fireflyJson = JSON.parse(copyPayloadFor(firefly, entry, 'json'))
  assert.equal(fireflyJson.token, entry.token)
  assert.equal(fireflyJson.apiKey, 'key-123')
  assert.equal(fireflyJson.account, 'acc-1')
  assert.equal(copyPayloadFor(firefly, entry, 'raw'), entry.token)

  // Format refresh tanpa refresh token jatuh ke token akses, bukan string kosong.
  const accessOnly = buildEntry({ token: makeJwt({ sub: 'x' }) })
  assert.equal(copyPayloadFor(galleri5, accessOnly, 'refresh'), accessOnly.token)
  assert.equal(copyPayloadFor(galleri5, null, 'raw'), '')
})

// ── Cookie Supabase (OneOver) ────────────────────────────────────────────────

function withCookies(byDomain: Record<string, any[]>, run: () => Promise<void>) {
  const previous = (globalThis as any).chrome
  ;(globalThis as any).chrome = {
    cookies: {
      getAll: (filter: { domain: string }, callback: (cookies: any[]) => void) =>
        callback(byDomain[filter.domain] || []),
    },
  }
  return run().finally(() => {
    ;(globalThis as any).chrome = previous
  })
}

const supabaseEntry = { access_token: makeJwt({ sub: 'u9' }), refresh_token: REFRESH_60 }

test('cookie Supabase: cookie terpotong, JWT mentah, dan refresh token HttpOnly', async () => {
  const payload = JSON.stringify(supabaseEntry)
  const half = Math.floor(payload.length / 2)
  await withCookies(
    {
      'oneover.com': [
        { name: 'lain', value: 'bukan-token' },
        { name: `${ONEOVER_COOKIE_PREFIX}.0`, value: payload.slice(0, half) },
        { name: `${ONEOVER_COOKIE_PREFIX}.1`, value: payload.slice(half) },
      ],
      '.supabase.co': [
        { name: 'raw-jwt', value: makeJwt({ sub: 'u10' }) },
        { name: 'plain-refresh', value: REFRESH_60, httpOnly: true },
      ],
    },
    async () => {
      const entries = await readSupabaseCookies(['oneover.com', '.supabase.co'])
      const tokens = entries.map((e) => e.token).filter(Boolean)
      const refreshes = entries.map((e) => e.refreshToken).filter(Boolean)
      assert.ok(tokens.includes(supabaseEntry.access_token), 'cookie terpotong tidak terbaca')
      assert.ok(tokens.includes(makeJwt({ sub: 'u10' })), 'JWT mentah tidak terbaca')
      assert.ok(refreshes.includes(supabaseEntry.refresh_token), 'refresh token cookie terpotong hilang')
      assert.ok(refreshes.includes(REFRESH_60), 'refresh token cookie HttpOnly hilang')
      // Nilai pendek yang bukan token tidak boleh ikut diklaim.
      assert.equal(entries.some((e) => String(e.token || e.refreshToken).includes('bukan')), false)
    },
  )
})

test('cookie Supabase: nilai base64-<json> dikenali dan tidak dihitung dua kali', async () => {
  const encoded = 'base64-' + Buffer.from(JSON.stringify(supabaseEntry), 'utf-8').toString('base64')
  await withCookies(
    {
      'oneover.com': [{ name: ONEOVER_COOKIE_PREFIX, value: encoded }],
      '.oneover.com': [{ name: ONEOVER_COOKIE_PREFIX, value: encoded }],
    },
    async () => {
      const entries = await readSupabaseCookies(['oneover.com', '.oneover.com'])
      assert.equal(entries.filter((e) => e.token === supabaseEntry.access_token).length, 1)
    },
  )
})

test('diagnostik cookie tidak pernah membocorkan nilai token', async () => {
  const secret = makeJwt({ sub: 'secret-user' })
  await withCookies(
    {
      'oneover.com': [{ name: 'auth-token', value: secret, httpOnly: true }],
      '.supabase.co': [],
    },
    async () => {
      const lines = await cookieDiagnostics(['oneover.com', '.supabase.co'])
      const text = lines.join('\n')
      assert.ok(text.includes('auth-token'), 'nama cookie seharusnya tetap dilaporkan')
      assert.ok(text.includes('httpOnly=true'))
      assert.equal(text.includes(secret), false, 'nilai token bocor ke diagnostik')
      assert.ok(text.includes('.supabase.co → 0 cookie'))
    },
  )
})

// ── Reader halaman ───────────────────────────────────────────────────────────

function withStorage(
  store: Record<string, string>,
  run: () => void,
  session: Record<string, string> = {},
  cookie = '',
) {
  const make = (data: Record<string, string>) => {
    const keys = Object.keys(data)
    return {
      get length() {
        return keys.length
      },
      key: (i: number) => keys[i] ?? null,
      getItem: (k: string) => (k in data ? data[k] : null),
    }
  }
  const previous = {
    localStorage: (globalThis as any).localStorage,
    sessionStorage: (globalThis as any).sessionStorage,
    document: (globalThis as any).document,
  }
  ;(globalThis as any).localStorage = make(store)
  ;(globalThis as any).sessionStorage = make(session)
  ;(globalThis as any).document = { cookie }
  try {
    run()
  } finally {
    Object.assign(globalThis, previous)
  }
}

test('reader Supabase membaca kunci baku, kunci sb-*, lalu JSON sesi mana pun', () => {
  const storageKey = ONEOVER_COOKIE_PREFIX
  const token = makeJwt({ sub: 'local-user' })

  withStorage({ [storageKey]: JSON.stringify({ access_token: token, refresh_token: REFRESH_60 }) }, () => {
    const entries = supabaseLocalStorage({ storageKey }).entries
    assert.equal(entries[0].token, token)
    assert.equal(entries[0].refreshToken, REFRESH_60)
  })

  withStorage({ 'sb-lain-auth-token': JSON.stringify({ current_session: { access_token: token } }) }, () => {
    assert.equal(supabaseLocalStorage({ storageKey }).entries[0].token, token)
  })

  withStorage({ 'apa-saja': JSON.stringify({ session: { access_token: token, refresh_token: REFRESH_60 } }) }, () => {
    const entries = supabaseLocalStorage({ storageKey }).entries
    assert.equal(entries.length, 1)
    assert.equal(entries[0].refreshToken, REFRESH_60)
  })

  withStorage({}, () => {
    assert.deepEqual(supabaseLocalStorage({ storageKey }).entries, [])
  })
})

test('reader JWT generik mengambil token dari cookie dan storage tanpa duplikat', () => {
  const token = makeJwt({ sub: 'generic' })
  withStorage(
    { 'firebase:authUser:abc': JSON.stringify({ stsTokenManager: { accessToken: token } }), dup: token },
    () => {
      const entries = activeTabJwt().entries
      assert.equal(entries.filter((e) => e.token === token).length, 1)
      assert.ok(entries[0].source)
    },
    { sesi: token },
    `session=${encodeURIComponent(token)}; theme=dark`,
  )
})

test('reader Firebase IndexedDB tidak melempar saat database gagal dibuka', async () => {
  const previous = (globalThis as any).indexedDB
  ;(globalThis as any).indexedDB = {
    open: () => {
      const request: any = {}
      setTimeout(() => request.onerror && request.onerror(new Error('blocked')), 0)
      return request
    },
  }
  try {
    const { entries } = await firebaseIndexedDb()
    assert.deepEqual(entries, [])
  } finally {
    ;(globalThis as any).indexedDB = previous
  }
})
