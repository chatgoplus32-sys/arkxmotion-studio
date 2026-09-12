// ─── Wallet NexaBot (prepaid Rp) ────────────────────────────────────────────
// Pola sama seperti CreatePulse: user top up saldo Rupiah (approval admin),
// lalu tiap generate memotong saldo itu. Bedanya:
//  - saldo terpisah (tabel nexabot_*), jadi ledger CreatePulse tidak tersentuh;
//  - harga FLAT Rp 250/generate apa pun mode/model/panjang videonya;
//  - ada PAKET UNLIMITED 1 MINGGU (Rp 35.000): selama paket aktif, /deduct
//    tidak memotong saldo sama sekali (tetap dicatat sebagai usage Rp 0);
//  - /deduct mengembalikan `usage_id` sehingga refund saat generate gagal
//    menunjuk catatan pemotongan yang tepat (CreatePulse hanya bisa "model
//    terakhir" yang bisa salah kalau ada dua job jalan bersamaan).
//
// Pengajuan paket disimpan di tabel `nexabot_topup` yang sama (kind='unlimited')
// supaya antrian approval admin cuma satu tempat: approve → paket diaktifkan,
// approve → top up saldo biasa ditambahkan ke balance.
//
// Generate lewat jalur session Unlimited maupun fallback API key sama-sama
// dihitung satu generate.
import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import {
  NEXABOT_MIN_TOPUP,
  NEXABOT_UNLIMITED_SLUG,
  NEXABOT_PRICING_DEFAULTS,
  NEXABOT_PRICING_KEYS,
  parseNexabotPricing,
  validateNexabotPricing,
  type NexabotPricing,
} from '../../shared/pricing.js'

// Definisi harga tinggal di shared/pricing.ts supaya server, fungsi Vercel, dan
// endpoint publik /api/public/pricing tidak pernah beda angka.
// Di bawah ini yang tersisa hanya pembacaan/penyimpanan (butuh `db`).
//
// Harga NexaBot TIDAK hardcode: admin mengaturnya dari halaman System Settings
// dan nilainya hidup di tabel `app_settings`, jadi ubah tarif tidak perlu deploy
// ulang. Server selalu membaca nilai efektif saat request (bukan saat boot).
export { NEXABOT_MIN_TOPUP, NEXABOT_UNLIMITED_SLUG, NEXABOT_PRICING_DEFAULTS }
export type { NexabotPricing }

const router = Router()

function readPricingSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM app_settings WHERE key IN (?, ?, ?)').all(
    NEXABOT_PRICING_KEYS.price,
    NEXABOT_PRICING_KEYS.unlimitedPrice,
    NEXABOT_PRICING_KEYS.unlimitedDays,
  ) as { key: string; value: string }[]
  const out: Record<string, string> = {}
  for (const row of rows) out[row.key] = row.value
  return out
}

/** Harga efektif: nilai app_settings kalau valid, kalau tidak pakai default. */
export function getNexabotPricing(): NexabotPricing {
  return parseNexabotPricing(readPricingSettings())
}

const upsertSetting = db.prepare(
  `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
)

/**
 * Simpan harga baru. Field yang tidak dikirim dibiarkan seperti sekarang, dan
 * nilai di luar batas wajar ditolak dengan pesan yang menyebut batasnya.
 */
export function setNexabotPricing(patch: Partial<NexabotPricing>): NexabotPricing {
  for (const key of Object.keys(NEXABOT_PRICING_DEFAULTS) as (keyof NexabotPricing)[]) {
    const value = patch[key]
    if (value === undefined) continue
    const error = validateNexabotPricing(key, value)
    if (error) throw new Error(error)
    upsertSetting.run(NEXABOT_PRICING_KEYS[key], String(Math.round(value)))
  }
  return getNexabotPricing()
}

function ensureBalanceRow(userId: number): number {
  const row = db.prepare('SELECT balance FROM nexabot_balance WHERE user_id = ?').get(userId) as { balance: number } | undefined
  if (row) return row.balance
  db.prepare('INSERT INTO nexabot_balance (user_id, balance) VALUES (?, 0)').run(userId)
  return 0
}

interface PackageRow {
  id: number
  amount: number
  days: number
  started_at: string | null
  expires_at: string | null
}

/**
 * Paket Unlimited yang masih berlaku. SQLite menyimpan CURRENT_TIMESTAMP dalam
 * UTC, jadi perbandingannya juga pakai datetime('now') supaya tidak tergantung
 * timezone mesin.
 */
function getActivePackage(userId: number): PackageRow | undefined {
  return db.prepare(`
    SELECT id, amount, days, started_at, expires_at
    FROM nexabot_topup
    WHERE user_id = ? AND kind = 'unlimited' AND status = 'approved'
      AND expires_at IS NOT NULL AND datetime(expires_at) > datetime('now')
    ORDER BY datetime(expires_at) DESC
    LIMIT 1
  `).get(userId) as PackageRow | undefined
}

function daysLeft(expiresAt: string | null): number {
  if (!expiresAt) return 0
  const end = new Date(expiresAt.replace(' ', 'T') + 'Z').getTime()
  if (!Number.isFinite(end)) return 0
  return Math.max(0, Math.ceil((end - Date.now()) / 86400000))
}

function unlimitedPayload(pkg: PackageRow | undefined) {
  if (!pkg?.expires_at) return { active: false, expires_at: null, days_left: 0, package_id: null }
  return { active: true, expires_at: pkg.expires_at, days_left: daysLeft(pkg.expires_at), package_id: pkg.id }
}

router.get('/balance', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const balance = ensureBalanceRow(userId)
    const pricing = getNexabotPricing()
    // `price`, `min_topup`, dan detail paket ikut dikirim supaya UI memakai
    // angka otoritatif server (termasuk tarif yang baru diubah admin), bukan
    // konstanta yang bisa langsung usang di klien.
    res.json({
      balance,
      price: pricing.price,
      min_topup: NEXABOT_MIN_TOPUP,
      unlimited: unlimitedPayload(getActivePackage(userId)),
      package: {
        slug: NEXABOT_UNLIMITED_SLUG,
        price: pricing.unlimitedPrice,
        days: pricing.unlimitedDays,
      },
    })
  } catch (error) {
    console.error('NexaBot balance error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/topup', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { amount, proof_note } = req.body
    if (!amount || amount < NEXABOT_MIN_TOPUP) {
      return res.status(400).json({ error: `Minimal topup Rp ${NEXABOT_MIN_TOPUP.toLocaleString('id-ID')}` })
    }

    const result = db.prepare(
      "INSERT INTO nexabot_topup (user_id, amount, kind, proof_note, status) VALUES (?, ?, 'balance', ?, 'pending')"
    ).run(userId, amount, proof_note || '')

    const topup = db.prepare('SELECT * FROM nexabot_topup WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ topup, message: 'Topup request submitted, waiting admin approval' })
  } catch (error) {
    console.error('NexaBot topup error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * Ajukan pembelian Paket Unlimited 1 minggu. Harga & durasi ditentukan server
 * (klien tidak mengirim amount), jadi user tidak bisa "menawar" sendiri.
 * Paket aktif saat admin approve, bukan saat diajukan.
 */
router.post('/package', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const pending = db.prepare(
      "SELECT id FROM nexabot_topup WHERE user_id = ? AND kind = 'unlimited' AND status = 'pending'"
    ).get(userId) as { id: number } | undefined
    if (pending) {
      return res.status(400).json({ error: 'Masih ada pembelian Paket Unlimited yang menunggu approval admin' })
    }

    const { proof_note } = req.body || {}
    // Tarif dikunci saat pengajuan (disimpan di baris paket), jadi kalau admin
    // mengubah harga setelahnya, pengajuan lama tetap dihargai seperti saat itu.
    const pricing = getNexabotPricing()
    const result = db.prepare(
      "INSERT INTO nexabot_topup (user_id, amount, kind, days, proof_note, status) VALUES (?, ?, 'unlimited', ?, ?, 'pending')"
    ).run(userId, pricing.unlimitedPrice, pricing.unlimitedDays, String(proof_note || '').slice(0, 500))

    const pkg = db.prepare('SELECT * FROM nexabot_topup WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ package: pkg, message: 'Pembelian paket dikirim, menunggu approval admin' })
  } catch (error) {
    console.error('NexaBot package error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Riwayat gabungan: top up saldo (kind='balance') & paket (kind='unlimited').
router.get('/topups/mine', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const topups = db.prepare('SELECT * FROM nexabot_topup WHERE user_id = ? ORDER BY created_at DESC').all(userId)
    res.json({ topups, unlimited: unlimitedPayload(getActivePackage(userId)) })
  } catch (error) {
    console.error('NexaBot list topups error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/deduct', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { model, batch_id } = req.body
    const balance = ensureBalanceRow(userId)

    // Paket Unlimited aktif → generate gratis. Usage tetap dicatat (cost 0)
    // supaya jumlah generate per user tetap terlihat di riwayat/statistik.
    const pkg = getActivePackage(userId)
    const pricing = getNexabotPricing()
    const cost = pkg ? 0 : pricing.price

    if (balance < cost) {
      return res.status(400).json({
        error: `Saldo NexaBot tidak cukup (Rp ${balance.toLocaleString('id-ID')}). Butuh Rp ${cost.toLocaleString('id-ID')} — top up dulu atau ambil Paket Unlimited Rp ${pricing.unlimitedPrice.toLocaleString('id-ID')} / ${pricing.unlimitedDays} hari.`,
        balance,
        required: cost,
      })
    }

    if (cost > 0) {
      db.prepare('UPDATE nexabot_balance SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(cost, userId)
    }
    const insert = db.prepare('INSERT INTO nexabot_usage (user_id, model, cost, batch_id, status) VALUES (?, ?, ?, ?, ?)')
      .run(userId, model || '', cost, batch_id || '', 'used')

    const updated = db.prepare('SELECT balance FROM nexabot_balance WHERE user_id = ?').get(userId) as { balance: number }
    res.json({
      balance: updated.balance,
      deducted: cost,
      usage_id: Number(insert.lastInsertRowid),
      unlimited: !!pkg,
      expires_at: pkg?.expires_at || null,
    })
  } catch (error) {
    console.error('NexaBot deduct error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/refund', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    // `usage_id` adalah cara presisi (dikembalikan /deduct). batch_id disimpan
    // sebagai cadangan untuk pemanggil lama.
    const { usage_id, batch_id } = req.body

    let usage
    if (usage_id) {
      usage = db.prepare("SELECT * FROM nexabot_usage WHERE user_id = ? AND id = ? AND status = 'used'").get(userId, usage_id) as { id: number; cost: number } | undefined
    } else if (batch_id) {
      usage = db.prepare("SELECT * FROM nexabot_usage WHERE user_id = ? AND batch_id = ? AND status = 'used'").get(userId, batch_id) as { id: number; cost: number } | undefined
    }

    if (!usage) return res.status(404).json({ error: 'Usage not found' })

    db.prepare('UPDATE nexabot_usage SET status = ? WHERE id = ?').run('refunded', usage.id)
    // Usage dari paket Unlimited ber-cost 0 → tidak ada yang perlu dikembalikan,
    // tapi tetap ditandai refunded supaya tidak dihitung sebagai generate sukses.
    if (usage.cost > 0) {
      db.prepare('UPDATE nexabot_balance SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(usage.cost, userId)
    }

    const updated = db.prepare('SELECT balance FROM nexabot_balance WHERE user_id = ?').get(userId) as { balance: number }
    res.json({ balance: updated.balance, refunded: usage.cost })
  } catch (error) {
    console.error('NexaBot refund error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
