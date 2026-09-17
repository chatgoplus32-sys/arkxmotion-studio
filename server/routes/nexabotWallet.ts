// ─── Wallet NexaBot (prepaid Rp) ────────────────────────────────────────────
// Pola sama seperti CreatePulse: user top up saldo Rupiah (approval admin),
// lalu tiap generate memotong saldo itu. Bedanya:
//  - saldo terpisah (tabel nexabot_*), jadi ledger CreatePulse tidak tersentuh;
//  - harga FLAT Rp 250/generate apa pun mode/model/panjang videonya;
//  - ada PAKET UNLIMITED dengan beberapa varian (Mingguan/Bulanan/Tahunan,
//    harga & durasi diatur admin di shared/pricing.ts + app_settings): selama
//    paket aktif, /deduct tidak memotong saldo sama sekali (tetap dicatat
//    sebagai usage Rp 0);
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
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.js'
import {
  NEXABOT_MIN_TOPUP,
  NEXABOT_UNLIMITED_SLUG,
  NEXABOT_PACKAGES,
  NEXABOT_PRICING_DEFAULTS,
  NEXABOT_PRICING_KEYS,
  NEXABOT_PRICING_SETTING_KEYS,
  findNexabotPackage,
  parseNexabotPricing,
  validateNexabotPackageValue,
  validateNexabotPricing,
  type NexabotPackagesPatch,
  type NexabotPricing,
  type NexabotPricingField,
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
  const keys = NEXABOT_PRICING_SETTING_KEYS
  const rows = db.prepare(
    `SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => '?').join(', ')})`
  ).all(...keys) as { key: string; value: string }[]
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
 *
 * Dua bentuk diterima supaya klien lama tetap jalan:
 *  - field lama: `price`, `unlimitedPrice`, `unlimitedDays` (varian pertama);
 *  - `packages`: harga & durasi per varian, contoh
 *    `{ unlimited_monthly: { price: 99000, days: 30 } }`.
 */
export function setNexabotPricing(
  patch: Partial<Record<NexabotPricingField, number>> & { packages?: NexabotPackagesPatch },
): NexabotPricing {
  for (const key of Object.keys(NEXABOT_PRICING_DEFAULTS) as NexabotPricingField[]) {
    const value = patch[key]
    if (value === undefined) continue
    const error = validateNexabotPricing(key, value)
    if (error) throw new Error(error)
    upsertSetting.run(NEXABOT_PRICING_KEYS[key], String(Math.round(value)))
  }

  for (const [slug, changes] of Object.entries(patch.packages || {})) {
    // Sengaja pencarian ketat: slug tak dikenal = salah kirim, bukan paket utama.
    const plan = NEXABOT_PACKAGES.find((p) => p.slug === slug)
    if (!plan) throw new Error(`Paket tidak dikenal: ${slug}`)
    for (const field of ['price', 'days'] as const) {
      const value = (changes || {})[field]
      if (value === undefined) continue
      const error = validateNexabotPackageValue(field, value)
      if (error) throw new Error(`${plan.label}: ${error}`)
      upsertSetting.run(field === 'price' ? plan.priceKey : plan.daysKey, String(Math.round(value)))
    }
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
 * Ajukan pembelian Paket Unlimited (varian dipilih lewat `slug`). Harga & durasi
 * ditentukan server dari varian yang dipilih (klien tidak mengirim amount), jadi
 * user tidak bisa "menawar" sendiri. Paket aktif saat admin approve, bukan saat
 * diajukan. Tanpa `slug` (klien lama) → varian utama.
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

    const { proof_note, slug } = req.body || {}
    const plan = findNexabotPackage(slug)
    if (!plan) {
      return res.status(400).json({
        error: `Paket tidak dikenal. Pilihan: ${NEXABOT_PACKAGES.map((p) => p.slug).join(', ')}`,
      })
    }

    // Tarif dikunci saat pengajuan (disimpan di baris paket), jadi kalau admin
    // mengubah harga setelahnya, pengajuan lama tetap dihargai seperti saat itu.
    const pricing = getNexabotPricing()
    const tier = pricing.packages.find((p) => p.slug === plan.slug)
    const price = tier?.price ?? plan.defaultPrice
    const days = tier?.days ?? plan.days

    const result = db.prepare(
      "INSERT INTO nexabot_topup (user_id, amount, kind, days, package_slug, proof_note, status) VALUES (?, ?, 'unlimited', ?, ?, ?, 'pending')"
    ).run(userId, price, days, plan.slug, String(proof_note || '').slice(0, 500))

    const pkg = db.prepare('SELECT * FROM nexabot_topup WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ package: pkg, message: `Pembelian paket ${plan.label} dikirim, menunggu approval admin` })
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
      // Varian termurah (biasanya Mingguan) disebut supaya user punya jalan
      // keluar paling ringan; varian lain tersedia di halaman top up.
      const entry = pricing.packages.reduce((a, b) => (b.price < a.price ? b : a), pricing.packages[0])
      return res.status(400).json({
        error: `Saldo NexaBot tidak cukup (Rp ${balance.toLocaleString('id-ID')}). Butuh Rp ${cost.toLocaleString('id-ID')} — top up dulu atau ambil Paket ${entry.label} Rp ${entry.price.toLocaleString('id-ID')} / ${entry.days} hari.`,
        balance,
        required: cost,
        packages: pricing.packages,
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

// ─── Laporan biaya upstream: apakah paket Unlimited mensubsidi? ─────────────
// GET /api/nexabot/admin/upstream-usage?days=30
//
// Menjawab pertanyaan yang tidak bisa dijawab pembukuan lokal: untuk setiap
// member, berapa job yang memakai kuota upstream, dengan kredensial JENIS apa,
// dan berapa yang benar-benar dilaporkan upstream sebagai biaya.
//
// Yang sengaja TIDAK dilakukan: menebak biaya. Kalau upstream tidak melaporkan
// angka untuk sebuah job, nilainya NULL dan job itu masuk hitungan
// `jobs_cost_unknown` — tidak diisi dengan harga lokal supaya angkanya terlihat
// rapi. Justru harga lokal untuk member Unlimited adalah 0, dan itu sumber
// subsidinya: `jobs_api_key` besar + `local_revenue` 0 berarti job member itu
// dibayar oleh pemilik API key, bukan oleh member yang sudah bayar flat.
router.get('/admin/upstream-usage', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const hari = Math.min(365, Math.max(1, Number(req.query.days) || 30))
    const sejakMs = Date.now() - hari * 24 * 60 * 60 * 1000

    const perUser = db.prepare(`
      SELECT user_id,
             COUNT(*) AS jobs,
             SUM(CASE WHEN credential_kind = 'cookie'  THEN 1 ELSE 0 END) AS jobs_cookie,
             SUM(CASE WHEN credential_kind = 'api-key' THEN 1 ELSE 0 END) AS jobs_api_key,
             SUM(CASE WHEN cost_value IS NOT NULL THEN 1 ELSE 0 END) AS jobs_cost_known,
             SUM(CASE WHEN cost_value IS NULL     THEN 1 ELSE 0 END) AS jobs_cost_unknown,
             SUM(COALESCE(cost_value, 0)) AS cost_known_sum,
             SUM(CASE WHEN credential_source = 'master' THEN 1 ELSE 0 END) AS jobs_master,
             SUM(CASE WHEN credential_source = 'client-master' THEN 1 ELSE 0 END) AS jobs_client_master,
             SUM(CASE WHEN credential_source IN ('own-key', 'own-cookie') THEN 1 ELSE 0 END) AS jobs_own,
             MAX(created_at) AS last_job_at
      FROM nexabot_upstream_usage
      WHERE created_at >= ?
      GROUP BY user_id
      ORDER BY jobs DESC
    `).all(sejakMs) as Array<{
      user_id: number | null
      jobs: number
      jobs_cookie: number
      jobs_api_key: number
      jobs_cost_known: number
      jobs_cost_unknown: number
      cost_known_sum: number
      jobs_master: number
      jobs_client_master: number
      jobs_own: number
      last_job_at: number
    }>

    // Kredensial per member: dua sidik jari berbeda = member memakai kredensial
    // miliknya sendiri DAN kredensial lain (biasanya induk) di jendela yang sama.
    const kredensial = db.prepare(`
      SELECT user_id, credential_kind, credential_source, credential_fingerprint,
             COUNT(*) AS jobs, MAX(created_at) AS last_job_at
      FROM nexabot_upstream_usage
      WHERE created_at >= ?
      GROUP BY user_id, credential_kind, credential_source, credential_fingerprint
      ORDER BY jobs DESC
    `).all(sejakMs) as Array<{
      user_id: number | null
      credential_kind: string
      credential_source: string
      credential_fingerprint: string
      jobs: number
      last_job_at: number
    }>

    const aktif = db.prepare(`
      SELECT user_id, MAX(expires_at) AS expires_at
      FROM nexabot_topup
      WHERE kind = 'unlimited' AND status = 'approved'
        AND expires_at IS NOT NULL AND datetime(expires_at) > datetime('now')
      GROUP BY user_id
    `).all() as Array<{ user_id: number; expires_at: string }>

    // Pemasukan lokal (harga yang benar-benar dipotong ke member) di jendela yang
    // sama. Untuk member Unlimited angkanya 0 — memang itu yang dijanjikan.
    const lokal = db.prepare(`
      SELECT user_id, COUNT(*) AS generates, SUM(cost) AS revenue
      FROM nexabot_usage
      WHERE created_at >= datetime('now', ?)
      GROUP BY user_id
    `).all(`-${hari} days`) as Array<{ user_id: number; generates: number; revenue: number }>

    const idTerpakai = perUser.map((r) => r.user_id).filter((v): v is number => typeof v === 'number')
    const email = new Map<number, string>()
    if (idTerpakai.length > 0) {
      const tanda = idTerpakai.map(() => '?').join(',')
      for (const u of db.prepare(`SELECT id, email FROM users WHERE id IN (${tanda})`).all(...idTerpakai) as Array<{ id: number; email: string }>) {
        email.set(u.id, u.email)
      }
    }

    const unlimitedByUser = new Map(aktif.map((r) => [r.user_id, r.expires_at]))
    const lokalByUser = new Map(lokal.map((r) => [r.user_id, r]))

    // Gabungan TIGA sumber: yang punya pemakaian upstream, yang punya pemakaian
    // lokal, dan yang paketnya sedang aktif. Tanpa penggabungan ini, member yang
    // membayar lokal tetapi job-nya tidak teratribusi (relay ini boleh dipanggil
    // tanpa JWT app) hilang dari total — padahal justru itu sisi pemasukannya,
    // dan menghilangkannya membuat subsidinya terlihat lebih besar dari fakta.
    const semuaId = new Set<number | null>()
    for (const r of perUser) semuaId.add(r.user_id)
    for (const r of lokal) semuaId.add(r.user_id)
    for (const r of aktif) semuaId.add(r.user_id)

    const baris = [...semuaId]
      .map((uid) => {
        const up = perUser.find((r) => r.user_id === uid)
        const kred = kredensial.filter((k) => k.user_id === uid)
        const rev = uid === null ? undefined : lokalByUser.get(uid)
        const cost = up?.cost_known_sum ?? 0
        const pemasukan = rev?.revenue ?? 0
        return {
          user_id: uid,
          email: uid === null ? null : email.get(uid) || null,
          unlimited_active: uid === null ? false : unlimitedByUser.has(uid),
          unlimited_expires_at: uid === null ? null : unlimitedByUser.get(uid) || null,
          jobs: up?.jobs ?? 0,
          jobs_cookie: up?.jobs_cookie ?? 0,
          jobs_api_key: up?.jobs_api_key ?? 0,
          jobs_cost_known: up?.jobs_cost_known ?? 0,
          jobs_cost_unknown: up?.jobs_cost_unknown ?? 0,
          cost_known_sum: Number(cost.toFixed(4)),
          // Sumber kredensial dipisah supaya pertanyaan "siapa jalan di kunci saya"
          // bisa dijawab langsung: 'master' = relay menyuntikkan kunci server,
          // 'client-master' = kunci induk MASIH dikirim klien (artinya ia beredar
          // di browser dan perlu ditarik), 'own' = kunci/cookie member sendiri.
          jobs_master: up?.jobs_master ?? 0,
          jobs_client_master: up?.jobs_client_master ?? 0,
          jobs_own: up?.jobs_own ?? 0,
          last_job_at: up?.last_job_at ?? null,
          local_generates: rev?.generates ?? 0,
          local_revenue: pemasukan,
          // Hanya berarti saat ada job yang biayanya dilaporkan upstream.
          subsidy_known: Number((cost - pemasukan).toFixed(4)),
          credentials: kred.map((k) => ({
            kind: k.credential_kind,
            source: k.credential_source,
            fingerprint: k.credential_fingerprint,
            jobs: k.jobs,
            last_job_at: k.last_job_at,
          })),
        }
      })
      .sort((a, b) => b.jobs - a.jobs || b.local_revenue - a.local_revenue)
    const jumlah = (f: (r: (typeof baris)[number]) => number) => baris.reduce((a, r) => a + f(r), 0)

    res.json({
      window_days: hari,
      since: sejakMs,
      note:
        'cost_known_sum hanya menjumlahkan job yang biayanya DILAPORKAN upstream; ' +
        'jobs_cost_unknown adalah sisanya dan sengaja tidak ditaksir. ' +
        'subsidy_known = biaya upstream yang diketahui − pemasukan lokal pada jendela ini. ' +
        'jobs_api_key besar pada member yang unlimited_active menandakan job-nya dibayar kredensial API key, bukan paketnya. ' +
        'jobs_master = job yang memakai kunci induk server (disuntikkan relay). ' +
        'jobs_client_master = kunci induk yang MASIH dikirim klien — artinya kunci itu masih ada di browser member dan sebaiknya ditarik dari peredaran.',
      totals: {
        jobs: jumlah((r) => r.jobs),
        jobs_cookie: jumlah((r) => r.jobs_cookie),
        jobs_api_key: jumlah((r) => r.jobs_api_key),
        jobs_cost_known: jumlah((r) => r.jobs_cost_known),
        jobs_cost_unknown: jumlah((r) => r.jobs_cost_unknown),
        cost_known_sum: Number(jumlah((r) => r.cost_known_sum).toFixed(4)),
        local_revenue: jumlah((r) => r.local_revenue),
        subsidy_known: Number(jumlah((r) => r.subsidy_known).toFixed(4)),
        jobs_master: jumlah((r) => r.jobs_master),
        jobs_client_master: jumlah((r) => r.jobs_client_master),
        jobs_own: jumlah((r) => r.jobs_own),
      },
      users: baris,
    })
  } catch (error) {
    console.error('NexaBot upstream usage report error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
