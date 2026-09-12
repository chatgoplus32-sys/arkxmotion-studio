// ─── Test harga NexaBot lewat jalur Express + SQLite ────────────────────────
// Bagian yang tidak terlihat dari test murni: nama kunci app_settings, validasi
// saat admin menyimpan, dan apakah endpoint publik benar-benar memakai harga
// yang disimpan admin (bukan default).
//
// DB dipisah lewat ARKXMOTION_DB_PATH supaya data dev tidak tersentuh; file
// test-*.db ada di dalam folder data/ yang sudah gitignored.
import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NEXABOT_PACKAGES, NEXABOT_PRICING_KEYS, parseNexabotPricing } from '../shared/pricing.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'data', 'test-nexabot-pricing.db')

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
process.env.ARKXMOTION_DB_PATH = DB_PATH

// Import dinamis: db.ts membaca ARKXMOTION_DB_PATH saat modul dimuat.
const db = (await import('../server/db.js')).default as any
const { getNexabotPricing, setNexabotPricing } = await import('../server/routes/nexabotWallet.js')
const { buildPublicPricing } = await import('../server/routes/publicPricing.js')

const DEFAULTS = parseNexabotPricing({})

function settingsRows(): { key: string; value: string }[] {
  return db
    .prepare("SELECT key, value FROM app_settings WHERE key LIKE 'nexabot%' ORDER BY key")
    .all() as { key: string; value: string }[]
}

beforeEach(() => {
  // Mulai tiap test dari default supaya urutannya tidak saling memengaruhi.
  setNexabotPricing({
    price: DEFAULTS.price,
    packages: Object.fromEntries(
      DEFAULTS.packages.map((p) => [p.slug, { price: p.price, days: p.days }]),
    ),
  })
})

after(() => {
  try { db.close() } catch { /* sudah tertutup */ }
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
})

test('DB kosong → semua varian jatuh ke default', () => {
  assert.deepEqual(getNexabotPricing(), DEFAULTS)
})

test('admin menyimpan harga per generate tanpa mengubah varian paket', () => {
  const pricing = setNexabotPricing({ price: 500 })

  assert.equal(pricing.price, 500)
  assert.deepEqual(pricing.packages, DEFAULTS.packages)
  assert.equal(getNexabotPricing().price, 500)
})

test('admin menyimpan satu varian saja (bulanan) — varian lain tidak tersentuh', () => {
  const pricing = setNexabotPricing({ packages: { unlimited_monthly: { price: 99000, days: 45 } } })

  const monthly = pricing.packages.find((p) => p.slug === 'unlimited_monthly')
  assert.deepEqual(monthly, { slug: 'unlimited_monthly', label: NEXABOT_PACKAGES[1].label, price: 99000, days: 45 })
  assert.equal(pricing.packages[0].price, DEFAULTS.packages[0].price)
  assert.equal(pricing.packages[2].price, DEFAULTS.packages[2].price)
  // Field lama mengikuti varian pertama, bukan varian yang baru diubah.
  assert.equal(pricing.unlimitedPrice, DEFAULTS.packages[0].price)
})

test('bentuk lama (unlimitedPrice/unlimitedDays) mengubah varian Mingguan', () => {
  const pricing = setNexabotPricing({ unlimitedPrice: 45000, unlimitedDays: 14 })

  assert.equal(pricing.unlimitedPrice, 45000)
  assert.equal(pricing.unlimitedDays, 14)
  assert.equal(pricing.packages[0].price, 45000)
  assert.equal(pricing.packages[0].days, 14)
})

test('kunci app_settings yang dipakai persis seperti katalog (kompatibilitas)', () => {
  setNexabotPricing({ price: 300, packages: { unlimited_yearly: { price: 900000, days: 365 } } })

  assert.deepEqual(
    settingsRows().map((r) => r.key),
    [
      NEXABOT_PRICING_KEYS.price,
      ...NEXABOT_PACKAGES.flatMap((p) => [p.priceKey, p.daysKey]),
    ].sort(),
  )
  const byKey = new Map(settingsRows().map((r) => [r.key, r.value]))
  assert.equal(byKey.get('nexabot_price'), '300')
  assert.equal(byKey.get('nexabot_unlimited_yearly_price'), '900000')
  assert.equal(byKey.get('nexabot_unlimited_yearly_days'), '365')
})

test('slug paket asing ditolak, bukan diam-diam dianggap paket utama', () => {
  assert.throws(
    () => setNexabotPricing({ packages: { unlimited_harian: { price: 5000 } } }),
    /Paket tidak dikenal: unlimited_harian/,
  )
})

test('nilai di luar batas ditolak dengan pesan yang menyebut variannya', () => {
  assert.throws(
    () => setNexabotPricing({ packages: { unlimited_yearly: { days: 9999 } } }),
    /Tahunan: durasi paket harus angka antara 1 dan 365/,
  )
  assert.throws(
    () => setNexabotPricing({ packages: { unlimited_monthly: { price: 0 } } }),
    /Bulanan: harga paket harus angka antara 1 dan 100000000/,
  )
  assert.throws(() => setNexabotPricing({ price: 0 }), /price harus angka antara 1 dan 10000000/)

  // Yang gagal tidak boleh setengah tersimpan.
  assert.deepEqual(getNexabotPricing(), DEFAULTS)
})

test('/api/public/pricing (Express) memakai harga yang disimpan admin', () => {
  setNexabotPricing({ price: 750, packages: { unlimited_monthly: { price: 123000, days: 30 } } })

  const body = buildPublicPricing()
  const nexabot = body.providers.nexabot

  assert.equal(body.ok, true)
  assert.equal(body.currency, 'IDR')
  assert.equal(nexabot.price_per_generate, 750)
  assert.deepEqual(nexabot.packages, getNexabotPricing().packages)
  assert.equal(nexabot.package.slug, 'unlimited_weekly')
  assert.equal(nexabot.package.price, getNexabotPricing().unlimitedPrice)
  assert.equal(nexabot.package.days, getNexabotPricing().unlimitedDays)
  assert.ok(body.providers.createpulse.price_range.min <= body.providers.createpulse.price_range.max)
})

test('bentuk respons Express = bentuk versi Vercel (kunci yang sama)', () => {
  const nexabot = buildPublicPricing().providers.nexabot
  assert.deepEqual(
    Object.keys(nexabot).sort(),
    ['min_topup', 'name', 'package', 'packages', 'price_per_generate'],
  )
  assert.deepEqual(Object.keys(nexabot.package).sort(), ['days', 'label', 'price', 'slug'])
  assert.deepEqual(Object.keys(nexabot.packages[0]).sort(), ['days', 'label', 'price', 'slug'])
})
