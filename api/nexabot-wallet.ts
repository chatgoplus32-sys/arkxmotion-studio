// ─── Wallet NexaBot (prepaid Rp) — versi Vercel ─────────────────────────────
// Cermin dari server/routes/nexabotWallet.ts (Express lokal). Dipakai produksi
// lewat rewrite vercel.json: /api/nexabot/* → /api/nexabot-wallet?sub=*.
//
// Sama seperti CreatePulse: saldo Rp per user, top up diajukan ke admin, dan
// tiap generate memotong Rp 250 (flat). Saldo terpisah dari CreatePulse.
// Tambahan: PAKET UNLIMITED 1 MINGGU (Rp 35.000) — selama paket aktif, /deduct
// tidak memotong saldo (usage tetap dicatat dengan cost 0).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import jwt from 'jsonwebtoken'
import { neon } from '@neondatabase/serverless'
import {
  NEXABOT_MIN_TOPUP,
  NEXABOT_UNLIMITED_SLUG,
  NEXABOT_PRICING_DEFAULTS,
  parseNexabotPricing,
  type NexabotPricing,
} from '../shared/pricing.js'

/**
 * Harga NexaBot dibaca dari `app_settings` (diatur admin lewat System Settings),
 * jadi ubah tarif tidak perlu deploy ulang. Bentuk & validasinya ikut
 * shared/pricing.ts supaya identik dengan sisi Express dan endpoint publik.
 *
 * Cache singkat: tiap generate tidak perlu menambah satu round-trip Neon.
 * Perubahan admin tetap berlaku dalam hitungan detik; tiap instance serverless
 * punya cache sendiri, jadi tidak ada koordinasi yang dibutuhkan.
 */
const PRICING_TTL_MS = 15_000
let pricingCache: { at: number; value: NexabotPricing } | null = null

async function getNexabotPricing(sql: any): Promise<NexabotPricing> {
  if (pricingCache && Date.now() - pricingCache.at < PRICING_TTL_MS) return pricingCache.value

  let value: NexabotPricing = { ...NEXABOT_PRICING_DEFAULTS }
  try {
    const rows = await sql`SELECT key, value FROM app_settings WHERE key IN ('nexabot_price', 'nexabot_unlimited_price', 'nexabot_unlimited_days')`
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
    await sql`CREATE TABLE IF NOT EXISTS nexabot_topup (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')), kind TEXT NOT NULL DEFAULT 'balance', days INTEGER NOT NULL DEFAULT 0, started_at TIMESTAMP, expires_at TIMESTAMP, proof_note TEXT NOT NULL DEFAULT '', admin_note TEXT NOT NULL DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS nexabot_usage (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, model TEXT NOT NULL DEFAULT '', cost INTEGER NOT NULL, batch_id TEXT, status TEXT NOT NULL DEFAULT 'used' CHECK(status IN ('used', 'refunded')), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    // Harga NexaBot hidup di sini (diatur admin), jadi tabelnya harus ada
    // walau user membuka halaman top up sebelum admin pernah menyentuh settings.
    await sql`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    // Migrasi DB lama (tabel sudah ada sebelum fitur paket): kolom paket
    // ditambahkan kalau belum ada. Idempoten, jadi aman dipanggil tiap request.
    await sql`ALTER TABLE nexabot_topup ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'balance'`
    await sql`ALTER TABLE nexabot_topup ADD COLUMN IF NOT EXISTS days INTEGER NOT NULL DEFAULT 0`
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

function unlimitedPayload(pkg: any) {
  if (!pkg?.expires_at) return { active: false, expires_at: null, days_left: 0, package_id: null }
  return { active: true, expires_at: pkg.expires_at, days_left: daysLeft(pkg.expires_at), package_id: pkg.id }
}

async function getActivePackage(sql: any, userId: number) {
  const rows = await sql`
    SELECT id, amount, days, started_at, expires_at
    FROM nexabot_topup
    WHERE user_id = ${userId} AND kind = 'unlimited' AND status = 'approved'
      AND expires_at IS NOT NULL AND expires_at > NOW()
    ORDER BY expires_at DESC
    LIMIT 1
  `
  return rows[0] || null
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
        package: { slug: NEXABOT_UNLIMITED_SLUG, price: pricing.unlimitedPrice, days: pricing.unlimitedDays },
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

    // POST package — harga & durasi ditentukan server (klien tidak kirim amount).
    if (sub === 'package' || url.includes('/package')) {
      const pending = await sql`SELECT id FROM nexabot_topup WHERE user_id = ${user.id} AND kind = 'unlimited' AND status = 'pending'`
      if (pending.length > 0) {
        return res.status(400).json({ error: 'Masih ada pembelian Paket Unlimited yang menunggu approval admin' })
      }
      const { proof_note } = req.body || {}
      // Tarif dikunci saat pengajuan, jadi perubahan harga setelahnya tidak
      // mengubah nilai pengajuan yang sudah masuk antrian admin.
      const pricing = await getNexabotPricing(sql)
      const rows = await sql`
        INSERT INTO nexabot_topup (user_id, amount, kind, days, proof_note, status)
        VALUES (${user.id}, ${pricing.unlimitedPrice}, 'unlimited', ${pricing.unlimitedDays}, ${String(proof_note || '').slice(0, 500)}, 'pending')
        RETURNING *
      `
      return res.status(201).json({ package: rows[0], message: 'Pembelian paket dikirim, menunggu approval admin' })
    }

    // GET topups mine — riwayat gabungan top up saldo & paket.
    if (sub === 'topups-mine' || url.includes('/topups/mine')) {
      const rows = await sql`SELECT * FROM nexabot_topup WHERE user_id = ${user.id} ORDER BY created_at DESC`
      const pkg = await getActivePackage(sql, user.id)
      return res.status(200).json({ topups: rows, unlimited: unlimitedPayload(pkg) })
    }

    // POST deduct — harga ditentukan server (flat Rp 250), bukan dari klien.
    if (sub === 'deduct' || url.includes('/deduct')) {
      const { model, batch_id } = req.body || {}

      const balRows = await sql`SELECT balance FROM nexabot_balance WHERE user_id = ${user.id}`
      let balance = balRows.length > 0 ? balRows[0].balance : 0
      if (balRows.length === 0) {
        await sql`INSERT INTO nexabot_balance (user_id, balance) VALUES (${user.id}, 0) ON CONFLICT (user_id) DO NOTHING`
        balance = 0
      }

      // Paket Unlimited aktif → generate gratis, tapi usage tetap dicatat (cost 0).
      const pkg = await getActivePackage(sql, user.id)
      const pricing = await getNexabotPricing(sql)
      const cost = pkg ? 0 : pricing.price

      if (balance < cost) {
        return res.status(400).json({
          error: `Saldo NexaBot tidak cukup (Rp ${balance.toLocaleString('id-ID')}). Butuh Rp ${cost.toLocaleString('id-ID')} — top up dulu atau ambil Paket Unlimited Rp ${pricing.unlimitedPrice.toLocaleString('id-ID')} / ${pricing.unlimitedDays} hari.`,
          balance,
          required: cost,
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

      let usage
      if (usage_id) {
        usage = await sql`SELECT * FROM nexabot_usage WHERE user_id = ${user.id} AND id = ${usage_id} AND status = 'used'`
      } else if (batch_id) {
        usage = await sql`SELECT * FROM nexabot_usage WHERE user_id = ${user.id} AND batch_id = ${batch_id} AND status = 'used'`
      }
      if (!usage || usage.length === 0) return res.status(404).json({ error: 'Usage not found' })

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
