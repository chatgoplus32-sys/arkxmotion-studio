// ─── Test migrasi DB lama (package_slug + kunci harga lama) ─────────────────
// DB dev/produksi yang dibuat sebelum varian paket ada tidak punya kolom
// `package_slug` dan hanya punya kunci harga Mingguan. Test ini membuat DB
// dengan skema lama itu, lalu memuat server/db.ts di atasnya dan memastikan:
//  - migrasi menambah kolomnya sendiri (idempoten, tidak error);
//  - baris paket lama tidak hilang (paket yang dijual tetap punya harga/durasi);
//  - harga lama di app_settings terbaca sebagai varian Mingguan, sementara
//    varian baru tetap default.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { NEXABOT_PACKAGES, nexabotPackageName, parseNexabotPricing } from '../shared/pricing.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'data', 'test-nexabot-legacy.db')

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })

// Skema LAMA: kolom paket sudah ada, `package_slug` belum.
const legacy = new Database(DB_PATH)
legacy.exec(`
  CREATE TABLE nexabot_topup (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    kind TEXT NOT NULL DEFAULT 'balance' CHECK(kind IN ('balance', 'unlimited')),
    days INTEGER NOT NULL DEFAULT 0,
    started_at DATETIME,
    expires_at DATETIME,
    proof_note TEXT NOT NULL DEFAULT '',
    admin_note TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)
legacy.exec(`
  CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)
legacy.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run('nexabot_unlimited_price', '45000')
legacy.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run('nexabot_unlimited_days', '10')
legacy
  .prepare("INSERT INTO nexabot_topup (user_id, amount, kind, days, status) VALUES (?, ?, 'unlimited', ?, 'approved')")
  .run(1, 45000, 10)
legacy.close()

// Import dinamis: db.ts menjalankan migrasi saat modul dimuat.
process.env.ARKXMOTION_DB_PATH = DB_PATH
const db = (await import('../server/db.js')).default as any
const { getNexabotPricing } = await import('../server/routes/nexabotWallet.js')

after(() => {
  try { db.close() } catch { /* sudah tertutup */ }
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
})

test('migrasi menambahkan kolom package_slug pada DB lama', () => {
  const columns = db.prepare('PRAGMA table_info(nexabot_topup)').all() as { name: string; notnull: number; dflt_value: string | null }[]
  const slug = columns.find((c) => c.name === 'package_slug')

  assert.ok(slug, 'kolom package_slug harus ada setelah migrasi')
  assert.equal(slug.notnull, 1)
  assert.equal(slug.dflt_value, "''")
  // Guard kolom inilah yang membuat migrasi berikutnya no-op (idempoten).
  assert.ok(columns.some((c) => c.name === 'package_slug'))
})

test('baris paket lama tidak hilang dan tetap punya harga & durasi', () => {
  const row = db.prepare('SELECT * FROM nexabot_topup WHERE kind = ?').get('unlimited') as any

  assert.equal(row.amount, 45000)
  assert.equal(row.days, 10)
  assert.equal(row.status, 'approved')
  // Kolom baru terisi default, bukan NULL.
  assert.equal(row.package_slug, '')
  // Riwayat lama tetap terbaca manusiawi walau slug-nya kosong.
  assert.equal(nexabotPackageName(row.package_slug, row.days), 'Unlimited 10 hari')
})

test('harga lama jadi varian Mingguan, varian baru tetap default', () => {
  const pricing = getNexabotPricing()

  assert.equal(pricing.packages[0].price, 45000)
  assert.equal(pricing.packages[0].days, 10)
  assert.equal(pricing.packages[1].price, NEXABOT_PACKAGES[1].defaultPrice)
  assert.equal(pricing.packages[2].days, NEXABOT_PACKAGES[2].days)
  // Field lama (dipakai kode lama) ikut terisi dari nilai yang sama.
  assert.equal(pricing.unlimitedPrice, 45000)
  assert.equal(pricing.unlimitedDays, 10)
  assert.deepEqual(
    parseNexabotPricing({ nexabot_unlimited_price: '45000', nexabot_unlimited_days: '10' }),
    pricing,
  )
})
