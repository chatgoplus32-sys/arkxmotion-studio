// ─── Test harga provider lewat jalur Express + SQLite ───────────────────────
// Yang diuji: kunci app_settings, validasi saat admin menyimpan, dan apakah
// jalur potong saldo/token (providerUnitCharge) serta endpoint publik benar
// benar memakai harga yang disimpan admin — bukan default kode.
//
// DB dipisah lewat ARKXMOTION_DB_PATH supaya data dev tidak tersentuh; file
// test-*.db ada di dalam folder data/ yang sudah gitignored.
import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CREATEPULSE_DEFAULT_PRICE,
  CREATEPULSE_MODEL_PRICES,
  POSBOT_DEFAULT_CHARGE,
  POSBOT_MODEL_PRICES,
  RUNNINGHUB_CHARGE,
  SEAVI_DEFAULT_CHARGE,
  SEAVI_MODEL_TOKENS,
  getPosbotCharge,
  getSeaviCharge,
} from '../shared/pricing.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'data', 'test-provider-pricing.db')

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
process.env.ARKXMOTION_DB_PATH = DB_PATH
const JWT_SECRET = 'test-secret-provider-pricing'
process.env.JWT_SECRET = JWT_SECRET

// Import dinamis: db.ts membaca ARKXMOTION_DB_PATH saat modul dimuat.
const db = (await import('../server/db.js')).default as any
const {
  PROVIDER_IDS,
  getAllProviderPricing,
  getProviderPricing,
  providerUnitCharge,
  resetProviderPricing,
  setProviderPricing,
} = await import('../server/lib/providerPricing.js')
const { buildPublicPricing } = await import('../server/routes/publicPricing.js')
const adminRoutes = (await import('../server/routes/admin.js')).default
const express = (await import('express')).default
const jwt = (await import('jsonwebtoken')).default

const adminToken = jwt.sign({ id: 2, email: 'admin@test.local', role: 'admin' }, JWT_SECRET)
const userToken = jwt.sign({ id: 1, email: 'user@test.local', role: 'user' }, JWT_SECRET)

const app = express()
app.use(express.json())
app.use('/api/admin', adminRoutes)

let server: any
let base = ''

const startServer = async () => {
  server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as any).port}`
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

const SEAVI_MODEL = Object.keys(SEAVI_MODEL_TOKENS)[0]
const SEAVI_MAHAL = SEAVI_MODEL_TOKENS[SEAVI_MODEL]
const POSBOT_MODEL = Object.keys(POSBOT_MODEL_PRICES)[0]
const POSBOT_HARGA = POSBOT_MODEL_PRICES[POSBOT_MODEL]
const CP_MODEL = Object.keys(CREATEPULSE_MODEL_PRICES)[0]
const CP_HARGA = CREATEPULSE_MODEL_PRICES[CP_MODEL]

function settingsRows(): { key: string; value: string }[] {
  return db
    .prepare("SELECT key, value FROM app_settings WHERE key LIKE 'provider%' ORDER BY key")
    .all() as { key: string; value: string }[]
}

beforeEach(() => {
  // Mulai tiap test dari default supaya urutannya tidak saling memengaruhi.
  for (const p of PROVIDER_IDS) resetProviderPricing(p)
})

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  try { db.close() } catch { /* sudah tertutup */ }
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
})

test('DB kosong → semua provider jatuh ke katalog kode', () => {
  assert.equal(providerUnitCharge('seavi', SEAVI_MODEL), SEAVI_MAHAL)
  assert.equal(providerUnitCharge('seavi', 'model-tanpa-harga'), SEAVI_DEFAULT_CHARGE)
  assert.equal(providerUnitCharge('posbot', POSBOT_MODEL), POSBOT_HARGA)
  assert.equal(providerUnitCharge('posbot', 'model-tanpa-harga'), POSBOT_DEFAULT_CHARGE)
  assert.equal(providerUnitCharge('runninghub'), RUNNINGHUB_CHARGE)
  assert.equal(providerUnitCharge('createpulse', CP_MODEL), CP_HARGA)
  assert.equal(providerUnitCharge('createpulse', 'model-tanpa-harga'), CREATEPULSE_DEFAULT_PRICE)
})

test('override harga model Seavi dipakai jalur charge, termasuk id ber-prefix sv:', () => {
  const harga = SEAVI_MAHAL + 3

  const eff = setProviderPricing('seavi', { models: { [SEAVI_MODEL]: harga } })

  assert.equal(eff.catalog[SEAVI_MODEL], harga)
  assert.equal(eff.models[SEAVI_MODEL], harga)
  assert.equal(providerUnitCharge('seavi', SEAVI_MODEL), harga)
  assert.equal(providerUnitCharge('seavi', `sv:${SEAVI_MODEL}`), harga)
  // Model lain tetap seperti katalog.
  assert.equal(eff.catalog[POSBOT_MODEL], undefined)
})

test('harga default PosBot berlaku untuk model tanpa override, override menang', () => {
  setProviderPricing('posbot', { default: 4242 })
  assert.equal(providerUnitCharge('posbot', 'model-tanpa-harga'), 4242)
  assert.equal(providerUnitCharge('posbot', POSBOT_MODEL), POSBOT_HARGA)

  setProviderPricing('posbot', { models: { [POSBOT_MODEL]: 999 } })
  assert.equal(providerUnitCharge('posbot', POSBOT_MODEL), 999)
  assert.equal(providerUnitCharge('posbot', 'model-tanpa-harga'), 4242)
})

test('RunningHub: tarif flat ikut berubah di /balance dan charge', () => {
  const eff = setProviderPricing('runninghub', { flat: 2500 })

  assert.equal(eff.kind, 'flat')
  assert.equal(eff.flat, 2500)
  assert.equal(providerUnitCharge('runninghub'), 2500)
  // Provider lain tidak tersentuh.
  assert.equal(providerUnitCharge('createpulse', CP_MODEL), CP_HARGA)
})

test('CreatePulse: override model & default ikut ke endpoint publik', () => {
  setProviderPricing('createpulse', { models: { [CP_MODEL]: 7777 }, default: 2000 })

  const cp = buildPublicPricing().providers.createpulse
  assert.equal(cp.default_price, 2000)
  assert.equal(cp.models[CP_MODEL], 7777)
  assert.equal(cp.price_range.min, 2000)
  assert.equal(cp.price_range.max, 7777)
  assert.equal(providerUnitCharge('createpulse', CP_MODEL), 7777)
})

test('nilai null menghapus override → kembali ke katalog kode', () => {
  setProviderPricing('seavi', { models: { [SEAVI_MODEL]: 9 }, default: 5 })

  setProviderPricing('seavi', { models: { [SEAVI_MODEL]: null }, default: null })

  const eff = getProviderPricing('seavi')
  assert.equal(eff.catalog[SEAVI_MODEL], SEAVI_MAHAL)
  assert.deepEqual(eff.models, {})
  assert.equal(eff.default, SEAVI_DEFAULT_CHARGE)
})

test('reset membuang semua override provider itu saja', () => {
  setProviderPricing('seavi', { default: 5 })
  setProviderPricing('posbot', { default: 4000 })

  resetProviderPricing('seavi')

  assert.equal(getProviderPricing('seavi').default, SEAVI_DEFAULT_CHARGE)
  assert.equal(getProviderPricing('posbot').default, 4000)
  assert.deepEqual(settingsRows().map((r) => r.key), ['provider_pricing'])
})

test('semua override disimpan di satu kunci app_settings (bukan ribuan baris)', () => {
  setProviderPricing('seavi', { models: { [SEAVI_MODEL]: 4 } })
  setProviderPricing('posbot', { models: { [POSBOT_MODEL]: 1234 } })
  setProviderPricing('runninghub', { flat: 2000 })

  const rows = settingsRows()
  assert.equal(rows.length, 1)
  const parsed = JSON.parse(rows[0].value)
  assert.deepEqual(Object.keys(parsed).sort(), ['posbot', 'runninghub', 'seavi'])
})

test('harga di luar batas / bukan angka ditolak dan tidak setengah tersimpan', () => {
  setProviderPricing('seavi', { default: 3 })

  assert.throws(() => setProviderPricing('seavi', { default: 0 }), /Harga default/)
  assert.throws(() => setProviderPricing('seavi', { models: { [SEAVI_MODEL]: 0 } }), /Harga model/)
  assert.throws(() => setProviderPricing('posbot', { default: -5 }), /Harga default/)
  assert.throws(() => setProviderPricing('runninghub', { flat: 'abc' }), /Tarif flat/)
  assert.throws(() => setProviderPricing('createpulse', { models: [] as any }), /models/)

  // Nilai lama tetap utuh, tidak berubah jadi parse-error.
  assert.equal(getProviderPricing('seavi').default, 3)
})

test('provider asing ditolak dengan pesan yang jelas', () => {
  assert.throws(() => setProviderPricing('nexabot' as any, { default: 1 }), /Provider tidak dikenal/)
  assert.throws(() => resetProviderPricing('foo' as any), /Provider tidak dikenal/)
})

test('getAllProviderPricing mencakup keempat wallet + bentuk respons admin', () => {
  const all = getAllProviderPricing()
  assert.deepEqual(Object.keys(all).sort(), ['createpulse', 'posbot', 'runninghub', 'seavi'])
  for (const p of PROVIDER_IDS) {
    const eff = all[p]
    assert.equal(eff.provider, p)
    assert.ok(eff.limits.min >= 1)
    assert.ok(eff.limits.max > eff.limits.min)
  }
  // Bentuk ini yang dikirim `GET /api/admin/provider-pricing`.
  assert.deepEqual(Object.keys(all.seavi).sort(), [
    'catalog', 'default', 'flat', 'kind', 'limits', 'models', 'provider',
  ])
})

test('endpoint publik: RunningHub & Seavi memakai harga efektif', () => {
  setProviderPricing('runninghub', { flat: 1750 })
  setProviderPricing('seavi', { models: { [SEAVI_MODEL]: 5 } })

  const body = buildPublicPricing()
  assert.equal(body.providers.runninghub.flat_generate, 1750)
  assert.equal(body.providers.seavi.models[SEAVI_MODEL], 5)
  assert.equal(body.providers.nexabot.price_per_generate, buildPublicPricing().providers.nexabot.price_per_generate)
})

test('fungsi harga lama di shared/pricing tetap sama dengan default lib', () => {
  // Jaring pengaman: kalau katalog kode diubah tapi lib tidak, tes ini gagal.
  assert.equal(providerUnitCharge('seavi', SEAVI_MODEL), getSeaviCharge(SEAVI_MODEL))
  assert.equal(providerUnitCharge('posbot', POSBOT_MODEL), getPosbotCharge(POSBOT_MODEL))
})

// ─── Endpoint admin (Express sungguhan: auth + validasi + bentuk respons) ───

before(startServer)

test('GET /api/admin/provider-pricing menolak non-admin (403)', async () => {
  const res = await fetch(`${base}/api/admin/provider-pricing`, { headers: auth(userToken) })
  assert.equal(res.status, 403)
})

test('GET /api/admin/provider-pricing mengembalikan keempat provider', async () => {
  const res = await fetch(`${base}/api/admin/provider-pricing`, { headers: auth(adminToken) })
  assert.equal(res.status, 200)
  const body = await res.json() as any
  assert.equal(body.ok, true)
  assert.deepEqual(Object.keys(body.providers).sort(), ['createpulse', 'posbot', 'runninghub', 'seavi'])
})

test('PATCH /api/admin/provider-pricing menyimpan & langsung dipakai charge', async () => {
  const res = await fetch(`${base}/api/admin/provider-pricing`, {
    method: 'PATCH',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'runninghub', flat: 3100 }),
  })
  assert.equal(res.status, 200)
  const body = await res.json() as any
  assert.equal(body.pricing.flat, 3100)
  assert.equal(providerUnitCharge('runninghub'), 3100)
})

test('PATCH dengan provider asing / harga tidak masuk akal → 400 dengan pesan', async () => {
  const asing = await fetch(`${base}/api/admin/provider-pricing`, {
    method: 'PATCH',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'nexabot', flat: 1000 }),
  })
  assert.equal(asing.status, 400)
  assert.match((await asing.json() as any).error, /Provider tidak dikenal/)

  const negatif = await fetch(`${base}/api/admin/provider-pricing`, {
    method: 'PATCH',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'posbot', default: -1 }),
  })
  assert.equal(negatif.status, 400)
  assert.match((await negatif.json() as any).error, /Harga default/)
  // Tidak tersimpan setengah jalan.
  assert.equal(getProviderPricing('posbot').default, POSBOT_DEFAULT_CHARGE)
})

test('POST /api/admin/provider-pricing/reset mengembalikan harga kode', async () => {
  setProviderPricing('seavi', { default: 7 })

  const res = await fetch(`${base}/api/admin/provider-pricing/reset`, {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'seavi' }),
  })
  assert.equal(res.status, 200)
  const body = await res.json() as any
  assert.equal(body.pricing.default, SEAVI_DEFAULT_CHARGE)
  assert.equal(providerUnitCharge('seavi', SEAVI_MODEL), SEAVI_MAHAL)
})
