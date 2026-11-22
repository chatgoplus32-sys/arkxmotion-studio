/**
 * TikTok Symphony — segel bahwa:
 *  1. Provider terdaftar di registry harga & endpoint publik (bisa diatur admin).
 *  2. Harga default Rp 700 & override admin menang.
 *  3. Kredensial server-level tersimpan di app_settings & status tidak membocorkan nilai.
 *  4. Wallet & tabel top-up terdaftar di QRIS_TABLES (auto-verify BasuNiPay).
 *  5. Route tiktok terpasang di server.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.ARKXMOTION_DB_PATH = ':memory:'
process.env.ALERT_WEBHOOK_URL = ''
const { default: db } = await import('../server/db.js')
const { providerUnitCharge, PROVIDER_IDS, getProviderPricing } = await import('../server/lib/providerPricing.js')
const { buildPublicPricing } = await import('../server/routes/publicPricing.js')
const {
  getTiktokCredentials,
  tiktokCredentialsStatus,
  saveTiktokCredentials,
  deleteTiktokCredentials,
} = await import('../server/lib/tiktokSymphony.js')
const { QRIS_TABLES } = await import('../server/lib/qrisPayment.js')
const { TIKTOK_DEFAULT_PRICE } = await import('../shared/pricing.js')

after(() => db.close())

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

test('tiktok terdaftar di registry harga & endpoint publik', () => {
  assert.ok(PROVIDER_IDS.includes('tiktok'))
  const pub = buildPublicPricing() as any
  assert.ok(pub.providers.tiktok, 'endpoint publik harus menyertakan tiktok')
  assert.equal(pub.providers.tiktok.name, 'TikTok Symphony')
  assert.equal(pub.providers.tiktok.models['SEEDANCE_2_0_FAST'], TIKTOK_DEFAULT_PRICE)
  assert.ok(pub.providers.tiktok.default_price === TIKTOK_DEFAULT_PRICE)
})

test('harga default Rp 700 & override admin menang', () => {
  assert.equal(providerUnitCharge('tiktok', 'SEEDANCE_2_0_FAST'), 700)
  assert.equal(providerUnitCharge('tiktok'), 700)
  const pricing = getProviderPricing('tiktok')
  assert.equal(pricing.catalog['SEEDANCE_2_0_FAST'], 700)

  // Simulasi override admin lewat app_settings (sama seperti setProviderPricing).
  const cfg = { tiktok: { models: { SEEDANCE_2_0_FAST: 999 } } }
  db.prepare(`INSERT INTO app_settings (key, value) VALUES ('provider_pricing', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(cfg))
  assert.equal(providerUnitCharge('tiktok', 'SEEDANCE_2_0_FAST'), 999)
  db.prepare("DELETE FROM app_settings WHERE key = 'provider_pricing'").run()
})

test('kredensial server-level tersimpan & status tidak membocorkan nilai', () => {
  const rahasia = 'sk_live_RAHASIA_JANGAN_TAMPIL'
  deleteTiktokCredentials()
  saveTiktokCredentials(rahasia, 'TTO-12345')
  const cred = getTiktokCredentials()
  assert.equal(cred.accessToken, rahasia)
  assert.equal(cred.ttoId, 'TTO-12345')

  const status = tiktokCredentialsStatus()
  assert.equal(status.configured, true)
  assert.equal(status.source, 'database')
  assert.ok(status.ttoConfigured)
  assert.ok(!JSON.stringify(status).includes(rahasia), 'status TIDAK boleh memuat nilai kunci')

  deleteTiktokCredentials()
  const afterDelete = tiktokCredentialsStatus()
  assert.equal(afterDelete.configured, false)
})

test('tiktok_topup terdaftar di QRIS_TABLES dengan wallet tiktok_balance', () => {
  const t = QRIS_TABLES.find((x) => x.table === 'tiktok_topup')
  assert.ok(t, 'tiktok_topup wajib terdaftar supaya auto-verify BasuNiPay jalan')
  assert.equal(t!.mode, 'credit')
  assert.equal(t!.balanceTable, 'tiktok_balance')
  assert.equal(t!.creditColumn, 'amount')
})

test('statis: route & client terpasang', () => {
  const idx = read('server/index.ts')
  assert.match(idx, /\/api\/tiktok-symphony/)
  assert.match(idx, /\/api\/public\/tiktok-symphony/)
  const admin = read('server/routes/admin.ts')
  assert.match(admin, /\/tiktok\/credentials/)
  assert.match(admin, /\/tiktok\/credentials\/exchange/)
  const tiktokLib = read('server/lib/tiktokSymphony.ts')
  assert.match(tiktokLib, /oauth2\/access_token/)
  assert.match(tiktokLib, /return_advertiser_ids/)
  const app = read('src/App.tsx')
  assert.match(app, /\/generate\/tiktok-symphony/)
  assert.match(app, /\/topup\/tiktok/)
})
