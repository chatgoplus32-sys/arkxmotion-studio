// ─── Test auto-sync auth-helper (murni, tanpa Chrome) ────────────────────────
// Auto-sync menyentuh tiga hal yang mudah rusak tanpa terlihat: origin mana yang
// boleh menerima credential, token mana yang dikirim per provider, dan
// konsistensi daftar provider antara ekstensi (registry) dengan app
// (AUTO_SYNC_PROVIDERS). Yang pertama & kedua diuji langsung; yang ketiga diuji
// dengan membaca sumber app, karena dua daftar itu memang tinggal di dua repo
// berbeda dan pernah jadi sumber bug "tombol mati".

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { PROVIDERS, DEFAULT_APP_URL } from '../extensions/auth-helper/providers.js'
import {
  APP_TAB_ORIGINS,
  syncBodyFor,
  syncFingerprint,
  syncTokenFor,
  uniqueOrigins,
} from '../extensions/auth-helper/lib/appSync.js'

const SYNCED = PROVIDERS.filter((p) => p.sync)

const accessToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhY2NvdW50In0.signature'
const refreshToken = 'AMf-' + 'b'.repeat(60)

/** JWT palsu dengan payload yang bisa diatur (header sama seperti token asli). */
function makeJwt(payload: Record<string, unknown>) {
  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.signature`
}

// ── Origin yang boleh menerima credential ────────────────────────────────────

test('uniqueOrigins: buang kosong, duplikat, dan skema bukan web', () => {
  const list = uniqueOrigins([
    'https://app.example/',
    'https://app.example',
    ' http://localhost:5173/ ',
    '',
    null,
    'chrome-extension://abc',
    'file:///tmp/x',
    'javascript:alert(1)',
    42,
  ])
  assert.deepEqual(list, ['https://app.example', 'http://localhost:5173'])
})

test('uniqueOrigins: URL pilihan user tetap di depan, kandidat dikenal menyusul', () => {
  const userUrl = 'https://arkxmotion-studio-git-preview.vercel.app'
  const list = uniqueOrigins([userUrl, ...APP_TAB_ORIGINS])
  assert.equal(list[0], userUrl)
  assert.ok(list.includes(DEFAULT_APP_URL))
})

test('kandidat origin app selalu web dan tanpa duplikat', () => {
  const list = uniqueOrigins(APP_TAB_ORIGINS)
  assert.equal(list.length, new Set(APP_TAB_ORIGINS).size, 'APP_TAB_ORIGINS punya duplikat')
  for (const origin of list) assert.match(origin, /^https?:\/\//)
})

// ── Registry: kunci `sync` harus lengkap ────────────────────────────────────

test('registry: provider yang punya sync mengisi provider & prefer dengan benar', () => {
  assert.ok(SYNCED.length >= 3, 'harus ada provider yang bisa auto-sync')
  for (const provider of SYNCED) {
    assert.equal(provider.sync.provider, provider.appField, `${provider.id}: provider ≠ appField`)
    assert.ok(
      provider.sync.prefer === 'refresh' || provider.sync.prefer === 'token',
      `${provider.id}: prefer "${provider.sync.prefer}" tidak dikenal`,
    )
  }
})

// ── Token mana yang dikirim ─────────────────────────────────────────────────

test('syncTokenFor: refresh token untuk provider yang app-nya menukar sendiri', () => {
  const entry = { token: accessToken, refreshToken }
  assert.equal(syncTokenFor(PROVIDERS.find((p) => p.id === 'galleri5'), entry), refreshToken)
  assert.equal(syncTokenFor(PROVIDERS.find((p) => p.id === 'oneover'), entry), refreshToken)
})

test('syncTokenFor: Firefly mengirim access token karena IMS tidak punya refresh', () => {
  const firefly = PROVIDERS.find((p) => p.id === 'firefly')
  assert.equal(syncTokenFor(firefly, { token: accessToken, refreshToken }), accessToken)
})

test('syncTokenFor: jatuh ke token yang ada bila pilihan prefer kosong', () => {
  const galleri5 = PROVIDERS.find((p) => p.id === 'galleri5')
  assert.equal(syncTokenFor(galleri5, { token: accessToken }), accessToken)
  assert.equal(syncTokenFor(galleri5, { refreshToken }), refreshToken)
  assert.equal(syncTokenFor(galleri5, null), '')
})

test('syncTokenFor: provider tanpa sync tidak pernah dianggap punya token', () => {
  const jwt = PROVIDERS.find((p) => p.id === 'jwt')
  assert.equal(jwt.sync, undefined)
  assert.equal(syncTokenFor(jwt, { token: accessToken }), '')
})

test('syncBodyFor: bentuk body sesuai kontrak /api/sync-tokens', () => {
  const galleri5 = PROVIDERS.find((p) => p.id === 'galleri5')
  const body = syncBodyFor(galleri5, { token: accessToken, refreshToken })
  assert.deepEqual(body, {
    provider: 'galleri5',
    token: refreshToken,
    kind: 'token',
    source: 'auth-helper',
  })
  assert.equal(syncBodyFor(galleri5, { token: accessToken }, 'ext:capture').source, 'ext:capture')
  assert.equal(syncBodyFor(galleri5, { refreshToken }, 'x'.repeat(200)).source.length, 80)
})

// ── Dedupe ──────────────────────────────────────────────────────────────────

test('syncFingerprint: stabil, membedakan token, dan tidak memuat tokennya', () => {
  const long = 'y'.repeat(200)
  assert.equal(syncFingerprint(long), syncFingerprint(long))
  assert.equal(syncFingerprint(''), '')
  assert.ok(syncFingerprint(long).length <= 16, 'sidik jari harus pendek')
  assert.ok(!syncFingerprint(long).includes('y'.repeat(8)), 'sidik jari tidak boleh memuat potongan token')

  // Dua JWT dari issuer sama punya header serupa: hash harus tetap beda walau
  // token hanya berbeda di ujungnya (dulu ini gagal karena memakai prefix).
  const jwtA = `${makeJwt({ sub: 'a' })}${'z'.repeat(40)}`
  const jwtB = `${makeJwt({ sub: 'a' })}${'z'.repeat(39)}y`
  assert.ok(jwtA.slice(0, 32) === jwtB.slice(0, 32), 'prasyarat test: prefix-nya memang sama')
  assert.notEqual(syncFingerprint(jwtA), syncFingerprint(jwtB))
})

// ── Konsistensi ekstensi ↔ app ──────────────────────────────────────────────

test('setiap provider sync di registry terdaftar di AUTO_SYNC_PROVIDERS app', () => {
  const source = readFileSync(new URL('../src/lib/tokenAutoSync.ts', import.meta.url), 'utf8')
  const start = source.indexOf('export const AUTO_SYNC_PROVIDERS')
  const end = source.indexOf('\n]', start)
  assert.ok(start > 0 && end > start, 'blok AUTO_SYNC_PROVIDERS tidak ditemukan')
  const block = source.slice(start, end)

  for (const provider of SYNCED) {
    assert.ok(
      block.includes(`id: '${provider.sync.provider}'`),
      `${provider.sync.provider} dikirim ekstensi tapi tidak dipolling app — tambahkan ke AUTO_SYNC_PROVIDERS`,
    )
  }
})

test('setiap provider sync punya cabang cek saldo di app', () => {
  const source = readFileSync(new URL('../src/lib/tokenAutoSync.ts', import.meta.url), 'utf8')
  for (const provider of SYNCED) {
    assert.ok(
      source.includes(`def.id === '${provider.sync.provider}'`),
      `runProviderCheck tidak menangani ${provider.sync.provider} — status & balance key tidak akan terisi`,
    )
  }
})
