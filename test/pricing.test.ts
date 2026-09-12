// ─── Test logika harga NexaBot (murni, tanpa DB) ────────────────────────────
// shared/pricing.ts adalah satu-satunya sumber angka tarif: dipakai server
// Express, fungsi Vercel, endpoint publik, dan klien. Test di sini mengunci
// perilaku yang mudah rusak tanpa terlihat:
//  - kunci app_settings varian pertama = kunci LAMA (kompatibilitas data admin);
//  - app_settings kosong / setengah terisi / berisi nilai ngawur tidak pernah
//    membuat harga jadi 0 atau NaN — selalu jatuh ke default per field.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NEXABOT_PACKAGES,
  NEXABOT_PRICING_KEYS,
  NEXABOT_PRICING_SETTING_KEYS,
  NEXABOT_UNLIMITED_SLUG,
  describeNexabotPricing,
  findNexabotPackage,
  nexabotPackageName,
  parseNexabotPricing,
  validateNexabotPackageValue,
  validateNexabotPricing,
} from '../shared/pricing.js'

test('katalog: slug & kunci app_settings unik, varian pertama pakai kunci lama', () => {
  const slugs = NEXABOT_PACKAGES.map((p) => p.slug)
  assert.equal(new Set(slugs).size, slugs.length, 'slug varian harus unik')

  const keys = NEXABOT_PACKAGES.flatMap((p) => [p.priceKey, p.daysKey])
  assert.equal(new Set(keys).size, keys.length, 'kunci app_settings harus unik')

  // Varian pertama wajib memakai kunci LAMA: harga yang sudah disimpan admin
  // sebelum varian ini ada harus tetap terbaca sebagai paket Mingguan.
  assert.equal(NEXABOT_UNLIMITED_SLUG, NEXABOT_PACKAGES[0].slug)
  assert.equal(NEXABOT_PRICING_KEYS.unlimitedPrice, NEXABOT_PACKAGES[0].priceKey)
  assert.equal(NEXABOT_PRICING_KEYS.unlimitedDays, NEXABOT_PACKAGES[0].daysKey)

  // Daftar kunci yang dibaca server tidak boleh duplikat (dipakai IN / ANY).
  assert.equal(NEXABOT_PRICING_SETTING_KEYS.length, new Set(NEXABOT_PRICING_SETTING_KEYS).size)
  for (const key of [NEXABOT_PRICING_KEYS.price, NEXABOT_PRICING_KEYS.unlimitedPrice, NEXABOT_PRICING_KEYS.unlimitedDays]) {
    assert.ok(NEXABOT_PRICING_SETTING_KEYS.includes(key), `kunci lama ${key} harus ikut dibaca`)
  }
})

test('app_settings kosong → semua harga jatuh ke default', () => {
  const pricing = parseNexabotPricing({})

  assert.equal(pricing.price, 250)
  assert.equal(pricing.packages.length, NEXABOT_PACKAGES.length)
  assert.deepEqual(
    pricing.packages.map((p) => [p.slug, p.label, p.price, p.days]),
    NEXABOT_PACKAGES.map((p) => [p.slug, p.label, p.defaultPrice, p.days]),
  )
  // Field lama tetap mencerminkan varian pertama.
  assert.equal(pricing.unlimitedPrice, pricing.packages[0].price)
  assert.equal(pricing.unlimitedDays, pricing.packages[0].days)
})

test('app_settings null/undefined → tetap default, bukan error', () => {
  for (const saved of [null, undefined]) {
    const pricing = parseNexabotPricing(saved as never)
    assert.equal(pricing.price, 250)
    assert.deepEqual(pricing.packages, parseNexabotPricing({}).packages)
  }
})

test('harga tiap varian dibaca terpisah (tidak saling bocor)', () => {
  const pricing = parseNexabotPricing({
    nexabot_price: '500',
    nexabot_unlimited_price: '45000',
    nexabot_unlimited_days: '10',
    nexabot_unlimited_monthly_price: '99000',
    nexabot_unlimited_monthly_days: '30',
    nexabot_unlimited_yearly_price: '1200000',
    nexabot_unlimited_yearly_days: '365',
  })

  assert.equal(pricing.price, 500)
  assert.deepEqual(
    pricing.packages.map((p) => [p.slug, p.price, p.days]),
    [
      ['unlimited_weekly', 45000, 10],
      ['unlimited_monthly', 99000, 30],
      ['unlimited_yearly', 1200000, 365],
    ],
  )
})

test('kunci lama (data admin sebelum varian ada) terbaca sebagai paket Mingguan', () => {
  const pricing = parseNexabotPricing({ nexabot_unlimited_price: '45000', nexabot_unlimited_days: '14' })

  assert.equal(pricing.unlimitedPrice, 45000)
  assert.equal(pricing.unlimitedDays, 14)
  assert.deepEqual(pricing.packages[0], {
    slug: 'unlimited_weekly',
    label: NEXABOT_PACKAGES[0].label,
    price: 45000,
    days: 14,
  })
  // Varian lain tetap default — nilai lama tidak menular ke tetangganya.
  assert.equal(pricing.packages[1].price, NEXABOT_PACKAGES[1].defaultPrice)
  assert.equal(pricing.packages[2].price, NEXABOT_PACKAGES[2].defaultPrice)
})

test('nilai tidak masuk akal → default per field (harga tidak pernah 0/NaN)', () => {
  const pricing = parseNexabotPricing({
    nexabot_price: 'abc',
    nexabot_unlimited_price: '0',
    nexabot_unlimited_days: '9999',
    nexabot_unlimited_monthly_price: '-100',
    nexabot_unlimited_monthly_days: '',
    nexabot_unlimited_yearly_price: '999999999999',
    nexabot_unlimited_yearly_days: 'NaN',
  })

  assert.equal(pricing.price, 250)
  assert.equal(pricing.packages[0].price, NEXABOT_PACKAGES[0].defaultPrice)
  assert.equal(pricing.packages[0].days, NEXABOT_PACKAGES[0].days)
  assert.equal(pricing.packages[1].price, NEXABOT_PACKAGES[1].defaultPrice)
  assert.equal(pricing.packages[1].days, NEXABOT_PACKAGES[1].days)
  assert.equal(pricing.packages[2].price, NEXABOT_PACKAGES[2].defaultPrice)
  assert.equal(pricing.packages[2].days, NEXABOT_PACKAGES[2].days)

  for (const p of pricing.packages) {
    assert.ok(Number.isFinite(p.price) && p.price > 0, `${p.slug} harga harus angka positif`)
    assert.ok(Number.isInteger(p.days) && p.days > 0, `${p.slug} durasi harus hari bulat`)
  }
})

test('harga dibulatkan ke rupiah utuh', () => {
  const pricing = parseNexabotPricing({ nexabot_unlimited_price: '35000.6', nexabot_price: '249.5' })
  assert.equal(pricing.packages[0].price, 35001)
  assert.equal(pricing.price, 250)
})

test('validateNexabotPricing: nilai wajar lolos, di luar batas dapat pesan', () => {
  assert.equal(validateNexabotPricing('price', 250), null)
  assert.equal(validateNexabotPricing('unlimitedPrice', 35000), null)
  assert.equal(validateNexabotPricing('unlimitedDays', 365), null)

  for (const [key, value] of [['price', 0], ['price', 10_000_001], ['unlimitedPrice', 0], ['unlimitedDays', 0], ['unlimitedDays', 366]] as const) {
    const message = validateNexabotPricing(key, value)
    assert.ok(message, `${key}=${value} harus ditolak`)
    assert.match(message, new RegExp(key))
    assert.match(message, /antara/)
  }

  for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.ok(validateNexabotPricing('price', value), 'NaN/Infinity harus ditolak')
  }
})

test('validateNexabotPackageValue: batas yang sama untuk semua varian', () => {
  assert.equal(validateNexabotPackageValue('price', 1), null)
  assert.equal(validateNexabotPackageValue('price', 100_000_000), null)
  assert.equal(validateNexabotPackageValue('days', 1), null)
  assert.equal(validateNexabotPackageValue('days', 365), null)

  assert.match(validateNexabotPackageValue('price', 0)!, /harga paket/)
  assert.match(validateNexabotPackageValue('price', 100_000_001)!, /harga paket/)
  assert.match(validateNexabotPackageValue('days', 0)!, /durasi paket/)
  assert.match(validateNexabotPackageValue('days', 366)!, /durasi paket/)
})

test('findNexabotPackage: slug dikenal / kosong (klien lama) / asing', () => {
  assert.equal(findNexabotPackage('unlimited_yearly')?.slug, 'unlimited_yearly')
  // Tanpa slug = klien lama → varian utama, bukan error.
  assert.equal(findNexabotPackage()?.slug, NEXABOT_UNLIMITED_SLUG)
  assert.equal(findNexabotPackage('')?.slug, NEXABOT_UNLIMITED_SLUG)
  assert.equal(findNexabotPackage(null)?.slug, NEXABOT_UNLIMITED_SLUG)
  // Slug asing harus undefined supaya route bisa menolak (bukan diam-diam
  // menagih paket utama).
  assert.equal(findNexabotPackage('unlimited_harian'), undefined)
})

test('nama varian & pesan admin memakai label katalog', () => {
  assert.equal(nexabotPackageName('unlimited_monthly', 30), `${NEXABOT_PACKAGES[1].label} 30 hari`)
  assert.equal(nexabotPackageName('unlimited_harian', 3), 'Unlimited 3 hari')
  assert.equal(nexabotPackageName(undefined, 7), 'Unlimited 7 hari')

  const message = describeNexabotPricing(parseNexabotPricing({ nexabot_price: '500' }))
  assert.match(message, /Rp 500\/generate/)
  for (const plan of NEXABOT_PACKAGES) {
    assert.ok(message.includes(plan.label), `pesan harus menyebut paket ${plan.label}`)
  }
})
