// ─── Wallet NexaBot (prepaid Rp) — versi Vercel ─────────────────────────────
// Cermin dari server/routes/nexabotWallet.ts (Express lokal). Dipakai produksi
// lewat rewrite vercel.json: /api/nexabot/* → /api/nexabot-wallet?sub=*.
//
// Sama seperti CreatePulse: saldo Rp per user, top up diajukan ke admin, dan
// tiap generate memotong Rp 150 (flat). Saldo terpisah dari CreatePulse.
// Tambahan: PAKET UNLIMITED dengan beberapa varian (Mingguan/Bulanan/Tahunan,
// harga & durasi diatur admin) — selama paket aktif, /deduct tidak memotong
// saldo (usage tetap dicatat dengan cost 0).
// Varian ber-scope (Premium Booster) membebaskan keluarga model tertentu —
// lihat isBoosterModelName di shared/pricing.ts — dan bukan sisanya; keputusan
// itu dibuat server lewat daftar slug, bukan dari klaim klien.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import jwt from 'jsonwebtoken'
import { neon } from '@neondatabase/serverless'
import {
  NEXABOT_MIN_TOPUP,
  NEXABOT_UNLIMITED_SLUG,
  NEXABOT_PACKAGES,
  NEXABOT_PRICING_SETTING_KEYS,
  NEXABOT_SCOPED_SLUGS,
  findNexabotPackage,
  isBoosterModelName,
  parseNexabotPricing,
  type NexabotPricing,
} from '../shared/pricing.js'

/**
 * Harga NexaBot dibaca dari `app_settings` (diatur admin lewat System Settings),
 * jadi ubah tarif tidak perlu deploy ulang — termasuk harga varian paket
 * Unlimited (Mingguan/Bulanan/Tahunan). Bentuk & validasinya ikut
 * shared/pricing.ts supaya identik dengan sisi Express dan endpoint publik.
 *
 * Cache singkat: tiap generate tidak perlu menambah satu round-trip Neon.
 * Perubahan admin tetap berlaku dalam hitungan detik; tiap instance serverless
 * punya cache sendiri, jadi tidak ada koordinasi yang dibutuhkan.
 */
const PRICING_TTL_MS = 15_000
let pricingCache: { at: number; value: NexabotPricing } | null = null

// Refund hanya untuk generate yang masih baru (sama dengan server Express):
// klien otomatis me-refund paling lambat ~35 menit setelah potong.
const NEXABOT_REFUND_WINDOW_MS = 60 * 60 * 1000

async function getNexabotPricing(sql: any): Promise<NexabotPricing> {
  if (pricingCache && Date.now() - pricingCache.at < PRICING_TTL_MS) return pricingCache.value

  // Default lengkap (termasuk varian paket) supaya /deduct & /balance tidak
  // pernah kehabisan daftar paket walau app_settings belum ada.
  let value: NexabotPricing = parseNexabotPricing({})
  try {
    // Semua kunci harga (per generate + tiap varian paket) dibaca sekali jalan.
    const rows = await sql`SELECT key, value FROM app_settings WHERE key = ANY(${NEXABOT_PRICING_SETTING_KEYS})`
    const saved: Record<string, string> = {}
    for (const r of rows || []) saved[String(r.key)] = String(r.value)
    value = parseNexabotPricing(saved)
    pricingCache = { at: Date.now(), value }
  } catch (e) {
    // Tabel app_settings belum ada / DB hiccup → pakai default, jangan cache.
    console.warn('[nexabot-wallet] pricing read failed, using defaults:', e)
  }
  return value
}

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return neon(url)
}

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('JWT_SECRET env var is required')

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function verifyUser(req: VercelRequest): { id: number; email: string; role: string } | null {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return null
  try {
    return jwt.verify(token, JWT_SECRET) as { id: number; email: string; role: string }
  } catch {
    return null
  }
}

async function ensureTables(sql: any) {
  try {
    await sql`CREATE TABLE IF NOT EXISTS nexabot_balance (id SERIAL PRIMARY KEY, user_id INTEGER UNIQUE NOT NULL, balance INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS nexabot_topup (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')), kind TEXT NOT NULL DEFAULT 'balance', days INTEGER NOT NULL DEFAULT 0, package_slug TEXT NOT NULL DEFAULT '', started_at TIMESTAMP, expires_at TIMESTAMP, proof_note TEXT NOT NULL DEFAULT '', admin_note TEXT NOT NULL DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS nexabot_usage (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, model TEXT NOT NULL DEFAULT '', cost INTEGER NOT NULL, batch_id TEXT, status TEXT NOT NULL DEFAULT 'used' CHECK(status IN ('used', 'refunded')), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    // Harga NexaBot hidup di sini (diatur admin), jadi tabelnya harus ada
    // walau user membuka halaman top up sebelum admin pernah menyentuh settings.
    await sql`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    // Migrasi DB lama (tabel sudah ada sebelum fitur paket): kolom paket
    // ditambahkan kalau belum ada. Idempoten, jadi aman dipanggil tiap request.
    await sql`ALTER TABLE nexabot_topup ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'balance'`
    await sql`ALTER TABLE nexabot_topup ADD COLUMN IF NOT EXISTS days INTEGER NOT NULL DEFAULT 0`
    await sql`ALTER TABLE nexabot_topup ADD COLUMN IF NOT EXISTS package_slug TEXT NOT NULL DEFAULT ''`
    await sql`ALTER TABLE nexabot_topup ADD COLUMN IF NOT EXISTS started_at TIMESTAMP`
    await sql`ALTER TABLE nexabot_topup ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`
  } catch (e) { console.warn('[nexabot-wallet] ensureTables:', e) }
}

/** Sisa hari dari TIMESTAMP Postgres (Date object atau string). */
function daysLeft(expiresAt: any): number {
  if (!expiresAt) return 0
  const end = expiresAt instanceof Date ? expiresAt.getTime() : new Date(String(expiresAt).replace(' ', 'T')).getTime()
  if (!Number.isFinite(end)) return 0
  return Math.max(0, Math.ceil((end - Date.now()) / 86400000))
}

/** Sisa jam dari TIMESTAMP Postgres — untuk paket seharian seperti Premium Booster. */
function hoursLeft(expiresAt: any): number {
  if (!expiresAt) return 0
  const end = expiresAt instanceof Date ? expiresAt.getTime() : new Date(String(expiresAt).replace(' ', 'T')).getTime()
  if (!Number.isFinite(end)) return 0
  return Math.max(0, Math.ceil((end - Date.now()) / 3600000))
}

function unlimitedPayload(pkg: any) {
  if (!pkg?.expires_at) return { active: false, expires_at: null, days_left: 0, hours_left: 0, package_id: null, package_slug: null, days: 0 }
  return {
    active: true,
    expires_at: pkg.expires_at,
    days_left: daysLeft(pkg.expires_at),
    // Paket seharian selalu tampak "1 hari lagi" kalau UI cuma punya days_left,
    // padahal tinggal 3 jam.
    hours_left: hoursLeft(pkg.expires_at),
    package_id: pkg.id,
    // Slug + days: UI menyebut nama paketnya, bukan cuma "Unlimited".
    package_slug: pkg.package_slug || null,
    days: pkg.days || 0,
  }
}

/**
 * Cermin sisi Express: `hanyaSemuaMode` (default) mengabaikan paket ber-scope
 * (mis. Premium Booster) supaya status `unlimited` tidak menjanjikan gratis untuk
 * mode yang tetap dipotong. `false` = paket mana pun yang berlaku untuk job ini.
 */
async function getActivePackage(sql: any, userId: number, hanyaSemuaMode = true) {
  const rows = hanyaSemuaMode
    ? await sql`
        SELECT id, amount, days, started_at, expires_at, package_slug
        FROM nexabot_topup
        WHERE user_id = ${userId} AND kind = 'unlimited' AND status = 'approved'
          AND expires_at IS NOT NULL AND expires_at > NOW()
          AND (package_slug IS NULL OR package_slug <> ALL(${NEXABOT_SCOPED_SLUGS}))
        ORDER BY expires_at DESC
        LIMIT 1
      `
    : await sql`
        SELECT id, amount, days, started_at, expires_at, package_slug
        FROM nexabot_topup
        WHERE user_id = ${userId} AND kind = 'unlimited' AND status = 'approved'
          AND expires_at IS NOT NULL AND expires_at > NOW()
        ORDER BY expires_at DESC
        LIMIT 1
      `
  return rows[0] || null
}

/** Paket yang membebaskan generate untuk model ini (global ATAU scope cocok). */
async function getActivePackageForModel(sql: any, userId: number, model?: string) {
  return getActivePackage(sql, userId, !isBoosterModelName(model))
}

/**
 * Pengajuan paket yang masih menunggu approval, dihitung per kelas. Kelas
 * ber-scope (mis. Premium Booster) dibandingkan dengan kelas sisanya — baris
 * legacy `package_slug = ''` termasuk kelas "semua mode".
 */
async function hasPendingPackage(sql: any, userId: number, kelasBerScope: boolean) {
  if (NEXABOT_SCOPED_SLUGS.length === 0) {
    const rows = await sql`
      SELECT id FROM nexabot_topup
      WHERE user_id = ${userId} AND kind = 'unlimited' AND status = 'pending'
      LIMIT 1
    `
    return rows.length > 0
  }
  const rows = kelasBerScope
    ? await sql`
        SELECT id FROM nexabot_topup
        WHERE user_id = ${userId} AND kind = 'unlimited' AND status = 'pending'
          AND package_slug = ANY(${NEXABOT_SCOPED_SLUGS})
        LIMIT 1
      `
    : await sql`
        SELECT id FROM nexabot_topup
        WHERE user_id = ${userId} AND kind = 'unlimited' AND status = 'pending'
          AND (package_slug IS NULL OR package_slug <> ALL(${NEXABOT_SCOPED_SLUGS}))
        LIMIT 1
      `
  return rows.length > 0
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = verifyUser(req)
  if (!user) return res.status(403).json({ error: 'Access denied' })

  try {
    const sql = getSql()
    await ensureTables(sql)
    const url = req.url || ''
    const sub = (req.query.sub || '') as string

    // GET balance (+ harga, minimal topup, dan status paket supaya UI memakai
    // angka otoritatif server)
    if (sub === 'balance' || url.includes('/balance')) {
      const rows = await sql`SELECT balance FROM nexabot_balance WHERE user_id = ${user.id}`
      const balance = rows.length > 0 ? rows[0].balance : 0
      if (rows.length === 0) {
        await sql`INSERT INTO nexabot_balance (user_id, balance) VALUES (${user.id}, 0) ON CONFLICT (user_id) DO NOTHING`
      }
      const pkg = await getActivePackage(sql, user.id)
      const pricing = await getNexabotPricing(sql)
      return res.status(200).json({
        balance,
        price: pricing.price,
        min_topup: NEXABOT_MIN_TOPUP,
        unlimited: unlimitedPayload(pkg),
        // Status khusus Premium Booster (ber-scope: hanya Seedance 2.5, Omni
        // Flash 1.1 & GPT Image) — sama seperti sisi Express.
        booster_unlimited: unlimitedPayload(await getActivePackage(sql, user.id, false)),
        // `package` = varian utama (kompatibilitas), `packages` = semua varian
        // yang bisa dipilih user di halaman top up.
        package: {
          slug: NEXABOT_UNLIMITED_SLUG,
          label: pricing.packages[0]?.label || 'Unlimited',
          price: pricing.unlimitedPrice,
          days: pricing.unlimitedDays,
        },
        packages: pricing.packages,
      })
    }

    // POST topup
    if (sub === 'topup' || (url.includes('/topup') && !url.includes('/topups'))) {
      const { amount, proof_note } = req.body || {}
      if (!amount || amount < NEXABOT_MIN_TOPUP) {
        return res.status(400).json({ error: `Minimal topup Rp ${NEXABOT_MIN_TOPUP.toLocaleString('id-ID')}` })
      }
      const rows = await sql`INSERT INTO nexabot_topup (user_id, amount, kind, proof_note, status) VALUES (${user.id}, ${amount}, 'balance', ${proof_note || ''}, 'pending') RETURNING *`
      return res.status(201).json({ topup: rows[0], message: 'Topup request submitted, waiting admin approval' })
    }

    // POST package — varian dipilih lewat `slug`, tapi harga & durasinya tetap
    // ditentukan server (klien tidak mengirim amount). Tanpa slug (klien lama)
    // → varian utama.
    if (sub === 'package' || url.includes('/package')) {
      const { proof_note, slug } = req.body || {}
      const plan = findNexabotPackage(slug)
      if (!plan) {
        return res.status(400).json({
          error: `Paket tidak dikenal. Pilihan: ${NEXABOT_PACKAGES.map((p) => p.slug).join(', ')}`,
        })
      }

      // Antrian pending dicek PER KELAS paket (sama seperti sisi Express):
      // pengajuan Premium Booster tidak boleh terblok oleh pengajuan Bulanan
      // yang belum di-approve, tapi dua pengajuan di kelas yang sama ditolak.
      const kelasBerScope = (plan.scope || 'all') !== 'all'
      if (await hasPendingPackage(sql, user.id, kelasBerScope)) {
        return res.status(400).json({
          error: `Masih ada pembelian paket ${plan.label} yang menunggu approval admin`,
        })
      }

      // Tarif dikunci saat pengajuan, jadi perubahan harga setelahnya tidak
      // mengubah nilai pengajuan yang sudah masuk antrian admin.
      const pricing = await getNexabotPricing(sql)
      const tier = pricing.packages.find((p) => p.slug === plan.slug)
      const price = tier?.price ?? plan.defaultPrice
      const days = tier?.days ?? plan.days
      const rows = await sql`
        INSERT INTO nexabot_topup (user_id, amount, kind, days, package_slug, proof_note, status)
        VALUES (${user.id}, ${price}, 'unlimited', ${days}, ${plan.slug}, ${String(proof_note || '').slice(0, 500)}, 'pending')
        RETURNING *
      `
      return res.status(201).json({ package: rows[0], message: `Pembelian paket ${plan.label} dikirim, menunggu approval admin` })
    }

    // GET topups mine — riwayat gabungan top up saldo & paket.
    if (sub === 'topups-mine' || url.includes('/topups/mine')) {
      const rows = await sql`SELECT * FROM nexabot_topup WHERE user_id = ${user.id} ORDER BY created_at DESC`
      return res.status(200).json({
        topups: rows,
        unlimited: unlimitedPayload(await getActivePackage(sql, user.id)),
        booster_unlimited: unlimitedPayload(await getActivePackage(sql, user.id, false)),
      })
    }

    // POST deduct — harga ditentukan server (flat per generate), bukan dari klien.
    if (sub === 'deduct' || url.includes('/deduct')) {
      const { model, batch_id } = req.body || {}

      const balRows = await sql`SELECT balance FROM nexabot_balance WHERE user_id = ${user.id}`
      let balance = balRows.length > 0 ? balRows[0].balance : 0
      if (balRows.length === 0) {
        await sql`INSERT INTO nexabot_balance (user_id, balance) VALUES (${user.id}, 0) ON CONFLICT (user_id) DO NOTHING`
        balance = 0
      }

      // Paket aktif untuk mode ini → generate gratis, usage tetap dicatat (cost 0).
      // Seedance 2.5, Omni Flash 1.1 dan GPT Image juga dihitung oleh Premium
      // Booster (ber-scope); untuk music/tts paket itu sengaja diabaikan server,
      // bukan oleh klien.
      const pkg = await getActivePackageForModel(sql, user.id, model)
      const gratisBooster = isBoosterModelName(model)
      const pricing = await getNexabotPricing(sql)
      const cost = pkg ? 0 : pricing.price

      if (balance < cost) {
        // Varian termurah yang MEMBEBASKAN MODE INI disebut supaya user punya jalan
        // keluar paling ringan — Premium Booster tidak ditawarkan untuk mode
        // yang tidak dibebaskannya (music/tts).
        const kandidat = pricing.packages.filter((p) => gratisBooster || !NEXABOT_SCOPED_SLUGS.includes(p.slug))
        const daftar = kandidat.length ? kandidat : pricing.packages
        const entry = daftar.reduce((a: any, b: any) => (b.price < a.price ? b : a), daftar[0])
        return res.status(400).json({
          error: `Saldo NexaBot tidak cukup (Rp ${balance.toLocaleString('id-ID')}). Butuh Rp ${cost.toLocaleString('id-ID')} — top up dulu atau ambil Paket ${entry.label} Rp ${entry.price.toLocaleString('id-ID')} / ${entry.days} hari.`,
          balance,
          required: cost,
          packages: pricing.packages,
        })
      }

      if (cost > 0) {
        await sql`UPDATE nexabot_balance SET balance = balance - ${cost}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ${user.id}`
      }
      const inserted = await sql`INSERT INTO nexabot_usage (user_id, model, cost, batch_id, status) VALUES (${user.id}, ${model || ''}, ${cost}, ${batch_id || ''}, 'used') RETURNING id`
      const updated = await sql`SELECT balance FROM nexabot_balance WHERE user_id = ${user.id}`
      return res.status(200).json({
        balance: updated[0].balance,
        deducted: cost,
        usage_id: inserted[0]?.id,
        unlimited: !!pkg,
        expires_at: pkg?.expires_at || null,
      })
    }

    // POST refund — pakai usage_id (presisi) atau batch_id sebagai cadangan.
    if (sub === 'refund' || url.includes('/refund')) {
      const { usage_id, batch_id } = req.body || {}

      // Umur dihitung di SQL supaya tidak bergantung pada zona waktu.
      let usage
      if (usage_id) {
        usage = await sql`SELECT id, cost, EXTRACT(EPOCH FROM (now() - created_at)) * 1000 AS age_ms FROM nexabot_usage WHERE user_id = ${user.id} AND id = ${usage_id} AND status = 'used'`
      } else if (batch_id) {
        usage = await sql`SELECT id, cost, EXTRACT(EPOCH FROM (now() - created_at)) * 1000 AS age_ms FROM nexabot_usage WHERE user_id = ${user.id} AND batch_id = ${batch_id} AND status = 'used'`
      }
      if (!usage || usage.length === 0) return res.status(404).json({ error: 'Usage not found' })

      // Usage ber-cost 0 (Unlimited) hanya dilabeli ulang, jadi jendela ini
      // tidak berlaku untuknya.
      if (Number(usage[0].cost) > 0 && Number(usage[0].age_ms) > NEXABOT_REFUND_WINDOW_MS) {
        return res.status(400).json({
          error: 'Refund hanya berlaku untuk generate dalam 60 menit terakhir. Hubungi admin kalau generate-nya gagal padahal saldo sudah terpotong.',
          refunded: 0,
        })
      }

      await sql`UPDATE nexabot_usage SET status = 'refunded' WHERE id = ${usage[0].id}`
      // Usage dari paket Unlimited ber-cost 0 → tidak ada yang dikembalikan,
      // tapi tetap ditandai refunded supaya tidak dihitung generate sukses.
      if (Number(usage[0].cost) > 0) {
        await sql`UPDATE nexabot_balance SET balance = balance + ${usage[0].cost}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ${user.id}`
      }
      const updated = await sql`SELECT balance FROM nexabot_balance WHERE user_id = ${user.id}`
      return res.status(200).json({ balance: updated[0].balance, refunded: usage[0].cost })
    }

    return res.status(404).json({ error: 'Not found: ' + url })
  } catch (err: any) {
    console.error('NexaBot wallet API error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
