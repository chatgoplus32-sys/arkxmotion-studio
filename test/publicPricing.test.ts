// ─── Test kontrak /api/public/pricing (versi Vercel) ────────────────────────
// Endpoint ini dibaca halaman landing tanpa login, jadi bentuk responsnya
// adalah kontrak: kalau `packages`/`package` hilang atau harga jadi 0, halaman
// publik ikut salah. Test dijalankan TANPA DATABASE_URL supaya yang diuji
// adalah jalur "app_settings belum ada" (paling sering terjadi di deployment
// baru) dan jalur "DB tidak bisa dibaca" — dua-duanya harus tetap 200 + default,
// bukan error.
import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/public/pricing.js'
import {
  CREATEPULSE_DEFAULT_PRICE,
  CREATEPULSE_MIN_TOPUP,
  NEXABOT_MIN_TOPUP,
  NEXABOT_PACKAGES,
  NEXABOT_UNLIMITED_SLUG,
  parseNexabotPricing,
} from '../shared/pricing.js'

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL

interface Capture {
  statusCode: number | null
  headers: Record<string, string>
  body: any
  ended: boolean
}

function fakeRes() {
  const capture: Capture = { statusCode: null, headers: {}, body: undefined, ended: false }
  const res: any = {
    setHeader(name: string, value: string) {
      capture.headers[name.toLowerCase()] = String(value)
      return res
    },
    status(code: number) {
      capture.statusCode = code
      return res
    },
    json(payload: unknown) {
      capture.body = payload
      return res
    },
    end() {
      capture.ended = true
      return res
    },
  }
  return { res, capture }
}

async function call(method: string, url = '/api/public/pricing') {
  const { res, capture } = fakeRes()
  await handler({ method, url, headers: {}, query: {} } as any, res)
  return capture
}

/** Jalankan handler dengan console.warn dibungkam (jalur DB-error memang warn). */
async function callQuietly(method: string) {
  const warn = console.warn
  console.warn = () => {}
  try {
    return await call(method)
  } finally {
    console.warn = warn
  }
}

beforeEach(() => {
  delete process.env.DATABASE_URL
})

after(() => {
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL
})

test('GET tanpa DATABASE_URL → 200 dengan harga default (bukan error)', async () => {
  const capture = await callQuietly('GET')

  assert.equal(capture.statusCode, 200)
  assert.equal(capture.body.ok, true)
  assert.equal(capture.body.currency, 'IDR')
  assert.ok(!Number.isNaN(Date.parse(capture.body.updated_at)), 'updated_at harus ISO date')
})

test('respons NexaBot: harga per generate, min topup, varian utama & semua varian', async () => {
  const capture = await callQuietly('GET')
  const nexabot = capture.body.providers.nexabot

  assert.equal(nexabot.name, 'NexaBot')
  assert.equal(nexabot.price_per_generate, 250)
  assert.equal(nexabot.min_topup, NEXABOT_MIN_TOPUP)

  // `package` (varian utama) tetap ada untuk klien lama.
  assert.equal(nexabot.package.slug, NEXABOT_UNLIMITED_SLUG)
  assert.equal(nexabot.package.price, NEXABOT_PACKAGES[0].defaultPrice)
  assert.equal(nexabot.package.days, NEXABOT_PACKAGES[0].days)

  // `packages` = semua varian, bentuknya sama dengan hasil parsing shared.
  assert.deepEqual(nexabot.packages, parseNexabotPricing({}).packages)
  for (const pkg of nexabot.packages) {
    assert.equal(typeof pkg.slug, 'string')
    assert.ok(pkg.slug.length > 0)
    assert.equal(typeof pkg.label, 'string')
    assert.ok(Number.isInteger(pkg.price) && pkg.price > 0, `${pkg.slug} harga harus integer > 0`)
    assert.ok(Number.isInteger(pkg.days) && pkg.days > 0, `${pkg.slug} durasi harus integer > 0`)
  }
})

test('respons CreatePulse: rentang harga & tarif model ikut terkirim', async () => {
  const capture = await callQuietly('GET')
  const createpulse = capture.body.providers.createpulse

  assert.equal(createpulse.name, 'CreatePulse')
  assert.equal(createpulse.min_topup, CREATEPULSE_MIN_TOPUP)
  assert.equal(createpulse.default_price, CREATEPULSE_DEFAULT_PRICE)
  assert.ok(createpulse.price_range.min <= createpulse.price_range.max)
  assert.ok(Object.keys(createpulse.models).length > 0)
})

test('header cache & CORS diisi (harga publik boleh di-cache singkat)', async () => {
  const capture = await callQuietly('GET')

  assert.equal(capture.headers['access-control-allow-origin'], '*')
  assert.match(capture.headers['cache-control'], /public/)
  assert.match(capture.headers['cache-control'], /s-maxage=\d+/)
})

test('OPTIONS → 200 tanpa body (preflight CORS)', async () => {
  const capture = await callQuietly('OPTIONS')

  assert.equal(capture.statusCode, 200)
  assert.equal(capture.body, undefined)
  assert.equal(capture.ended, true)
})

test('POST → 405 (endpoint read-only)', async () => {
  const capture = await callQuietly('POST')

  assert.equal(capture.statusCode, 405)
  assert.match(capture.body.error, /not allowed/i)
})

test('DATABASE_URL rusak → tetap 200 dengan default, bukan 500', async () => {
  // Port 1 menolak koneksi seketika: mensimulasikan Neon yang tidak bisa dihubungi.
  process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/nonexistent'

  const capture = await callQuietly('GET')

  assert.equal(capture.statusCode, 200)
  assert.deepEqual(capture.body.providers.nexabot.packages, parseNexabotPricing({}).packages)
  assert.equal(capture.body.providers.nexabot.price_per_generate, 250)
})
