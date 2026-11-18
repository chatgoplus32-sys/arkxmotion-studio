/**
 * SEGEL: semua jalur pembayaran QRIS BasuNiPay wajib auto-approve.
 *
 * Kenapa tes ini ada: `approveTopupRef` menolak tabel yang tidak terdaftar
 * di `QRIS_TABLES` (action `unknown_table`) — satu `refTable` yang lupa
 * didaftarkan membuat pembayaran lunas TIDAK PERNAH dikredit/diaktifkan,
 * tanpa error yang terlihat di mana pun. Tes ini mengunci dua hal:
 *
 *  1. Statis — setiap `refTable: '...'` yang dipakai server ada di
 *     QRIS_TABLES (dan sebaliknya: setiap entri registry benar-benar
 *     dipakai), plus kolom QRIS + balance table lengkap di DB, plus tidak
 *     ada pemanggilan `createBasunipayPayment` dengan refTable dinamis.
 *  2. Perilaku — untuk SETIAP tabel di QRIS_TABLES: seed baris pending +
 *     checkout BasuNiPay, poll (jawaban API = lunas), status wajib
 *     `approved` dan efeknya nyata: saldo/token naik, plan Pro aktif,
 *     provider manual ditandai lunas — lalu poll ulang tidak boleh
 *     mengkredit dua kali.
 *
 * Sifatnya dinamis (berjalan di atas QRIS_TABLES & skema yang ada), jadi
 * tabel/route baru yang belum didaftarkan atau belum di-seed langsung
 * gagal di sini.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.ARKXMOTION_DB_PATH = ':memory:'
process.env.ALERT_WEBHOOK_URL = ''
process.env.BASUNIPAY_ENABLED = 'true'
process.env.BASUNIPAY_API_KEY = 'test-only'
const { default: db } = await import('../server/db.js')
const { QRIS_TABLES, approveTopupRef } = await import('../server/lib/qrisPayment.js')
const { pollBasunipayPayments } = await import('../server/lib/basunipay.js')

// BasuNiPay selalu menjawab "lunas" — tes ini soal EFEK approve, bukan
// soal parsing response provider.
const originalFetch = globalThis.fetch
globalThis.fetch = async () => Response.json({ success: true, data: { status: 'paid' } })
after(() => { globalThis.fetch = originalFetch; db.close() })

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const rel = (p: string) => relative(ROOT, p).replaceAll('\\', '/')

function walkTs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walkTs(p))
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

const SERVER_FILES = walkTs(join(ROOT, 'server'))

/** Semua literal `refTable: '...'` di server → daftar file pemakainya. */
function refTableLiterals(): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const file of SERVER_FILES) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/refTable:\s*['"]([A-Za-z0-9_]+)['"]/g)) {
      map.set(m[1], [...(map.get(m[1]) || []), rel(file)])
    }
  }
  return map
}

function columnsOf(table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name)
}

// ── 1. Statis: registry vs pemakaian nyata ────────────────────────────────

test('setiap refTable literal di server terdaftar di QRIS_TABLES', () => {
  const registry = new Set(QRIS_TABLES.map((t) => t.table))
  const literals = refTableLiterals()
  assert.ok(literals.size > 0, 'harus ada minimal satu pemanggilan refTable literal')
  for (const [table, files] of literals) {
    assert.ok(
      registry.has(table),
      `refTable '${table}' (${files.join(', ')}) TIDAK ada di QRIS_TABLES — ` +
        `pembayaran akan ditolak 'unknown_table' dan tidak pernah auto-approve`,
    )
  }
})

test('setiap tabel di QRIS_TABLES benar-benar dipakai route/lib', () => {
  const literals = refTableLiterals()
  for (const t of QRIS_TABLES) {
    assert.ok(
      literals.has(t.table),
      `QRIS_TABLES['${t.table}'] tidak dipakai refTable literal mana pun — ` +
        `entri registry mati atau route-nya belum terpasang`,
    )
  }
})

test('semua pemanggil createBasunipayPayment di routes tervalidasi', () => {
  const routeFiles = SERVER_FILES.filter((f) => rel(f).startsWith('server/routes/'))
  let dicek = 0
  for (const file of routeFiles) {
    const src = readFileSync(file, 'utf8')
    const calls = (src.match(/createBasunipayPayment\(/g) || []).length
    if (!calls) continue
    dicek++
    const literals = (src.match(/refTable:\s*['"][A-Za-z0-9_]+['"]/g) || []).length
    // refTable dinamis (mis. dari body) hanya boleh kalau file yang sama
    // memvalidasinya terhadap whitelist QRIS_TABLES.
    const validated = /QRIS_TABLES\.(find|some|includes)/.test(src)
    assert.ok(
      literals >= calls || validated,
      `${rel(file)}: ${calls} panggilan createBasunipayPayment tapi hanya ${literals} ` +
        `refTable literal dan tidak ada validasi terhadap QRIS_TABLES — refTable ` +
        `tidak terdaftar dapat lolos`,
    )
  }
  assert.ok(dicek >= 1, 'minimal satu route harus memakai createBasunipayPayment')
})

test('kolom QRIS + balance table lengkap untuk semua entri registry', () => {
  const qrColumns = ['unique_code', 'amount_total', 'paid_amount', 'paid_at', 'pay_ref']
  assert.ok(QRIS_TABLES.length > 0)
  for (const t of QRIS_TABLES) {
    const cols = columnsOf(t.table)
    assert.ok(cols.length > 0, `tabel '${t.table}' tidak ada di skema DB`)
    for (const c of qrColumns) {
      assert.ok(cols.includes(c), `tabel '${t.table}' kehilangan kolom QRIS '${c}'`)
    }
    if (t.mode === 'credit') {
      assert.ok(t.balanceTable, `tabel '${t.table}' mode credit wajib punya balanceTable`)
      assert.ok(t.creditColumn, `tabel '${t.table}' mode credit wajib punya creditColumn`)
      const bcols = columnsOf(String(t.balanceTable))
      assert.ok(
        bcols.includes('user_id') && bcols.includes('balance'),
        `balance table '${t.balanceTable}' tidak punya user_id+balance`,
      )
    }
  }
})

// ── 2. Perilaku: bayar lunas → approve + efek nyata, tiap tabel ───────────

/** Kolom tambahan per tabel (kolom wajib lain punya default di skema). */
const SEED_EXTRA: Record<string, Record<string, string | number>> = {
  provider_topup_request: { provider: 'Roboneo', amount: 71000 },
  createpulse_topup: { amount: 52000 },
  nexabot_topup: { amount: 63000, kind: 'balance' },
  seavi_topup: { amount: 84000, tokens: 120 },
  posbot_topup: { amount: 45000 },
  runninghub_topup: { amount: 36000 },
  membership_payments: { amount: 250000 },
  pro_payments: { amount: 150000 },
  account_addon_payments: { amount: 100000 },
}

const UNIQUE_CODE = 137

function seedUser(userId: number): void {
  db.prepare(
    "INSERT INTO users (id, email, password, name, approved, plan) VALUES (?, ?, 'x', 'Segel Test', 0, 'free')",
  ).run(userId, `segel${userId}@example.test`)
}

/**
 * Baris top-up pending + checkout BasuNiPay-nya, persis seperti yang dibuat
 * route: `amount_total` = base + kode unik, `payable_amount` = yang wajib
 * dibayar (dan jadi nominal yang dikredit saat poll).
 */
function seedBasunipayPending(table: string, userId: number, extra: Record<string, string | number>) {
  const amount = Number(extra.amount)
  assert.ok(Number.isFinite(amount) && amount > 0, `SEED_EXTRA['${table}'].amount wajib terisi`)
  const payable = amount + UNIQUE_CODE
  const cols: Record<string, string | number> = {
    user_id: userId,
    status: 'pending',
    amount_total: payable,
    unique_code: UNIQUE_CODE,
    ...extra,
  }
  const names = Object.keys(cols)
  db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .run(...names.map((n) => cols[n]))
  const row = db
    .prepare(`SELECT id FROM ${table} WHERE user_id = ? ORDER BY id DESC LIMIT 1`)
    .get(userId) as { id: number }
  const orderId = `arkx_${table}_${userId}_segel`
  db.prepare(
    `INSERT INTO basunipay_payment (order_id, ref_table, ref_id, user_id, base_amount, unique_code, payable_amount, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
  ).run(orderId, table, row.id, userId, amount, UNIQUE_CODE, payable)
  return { rowId: row.id, orderId, amount, payable }
}

function balanceOf(table: string, userId: number): number {
  const row = db
    .prepare(`SELECT COALESCE(balance, 0) AS balance FROM ${table} WHERE user_id = ?`)
    .get(userId) as { balance: number } | undefined
  return row?.balance || 0
}

QRIS_TABLES.forEach((t, i) => {
  test(`BasuNiPay lunas → ${t.table} approve otomatis + efeknya nyata`, async () => {
    const extra = SEED_EXTRA[t.table]
    assert.ok(
      extra,
      `tabel baru '${t.table}' belum punya entry SEED_EXTRA — tambahkan kolom seed + assert efeknya`,
    )
    const userId = 810000 + i
    seedUser(userId)
    const seeded = seedBasunipayPending(t.table, userId, extra)

    const r = await pollBasunipayPayments()
    assert.ok(r.paid >= 1, `${t.table}: poll harus menemukan pembayaran lunas (dapat ${r.paid})`)

    const row = db.prepare(`SELECT status FROM ${t.table} WHERE id = ?`).get(seeded.rowId) as { status: string }
    assert.equal(row.status, 'approved', `${t.table} harus auto-approve tanpa admin`)
    const pay = db
      .prepare('SELECT status FROM basunipay_payment WHERE order_id = ?')
      .get(seeded.orderId) as { status: string }
    assert.equal(pay.status, 'paid', 'checkout BasuNiPay ditandai lunas')

    // Efek nyata per jenis tabel.
    if (t.table === 'membership_payments') {
      const u = db.prepare('SELECT approved, plan FROM users WHERE id = ?').get(userId) as {
        approved: number
        plan: string
      }
      assert.equal(u.approved, 1, 'registrasi langsung boleh login')
      assert.equal(u.plan, 'pro', 'fitur Pro langsung terbuka')
    } else if (t.table === 'pro_payments') {
      const u = db.prepare('SELECT plan FROM users WHERE id = ?').get(userId) as { plan: string }
      assert.equal(u.plan, 'pro', 'upgrade Pro langsung aktif')
    } else if (t.table === 'account_addon_payments') {
      const p = db.prepare('SELECT period_end FROM account_addon_payments WHERE id = ?').get(seeded.rowId) as {
        period_end: string | null
      }
      assert.ok(p.period_end, 'periode add-on 30 hari terisi otomatis')
    } else if (t.mode === 'credit') {
      const credit = t.creditColumn === 'tokens' ? Number(extra.tokens) || 0 : seeded.payable
      assert.ok(t.balanceTable)
      assert.equal(
        balanceOf(t.balanceTable, userId),
        credit,
        `${t.balanceTable} harus naik ${credit} (payable/kode unik ikut terkredit)`,
      )
    } else {
      const p = db.prepare(`SELECT paid_amount FROM ${t.table} WHERE id = ?`).get(seeded.rowId) as {
        paid_amount: number
      }
      assert.equal(p.paid_amount, seeded.payable, 'pembayaran lunas dicatat di baris')
    }

    // Jejak audit selalu tertulis.
    const log = db
      .prepare(
        "SELECT COUNT(*) AS n FROM payment_verify_log WHERE ref_table = ? AND action IN ('auto_approved', 'auto_activated')",
      )
      .get(t.table) as { n: number }
    assert.ok(log.n >= 1, `${t.table} harus tercatat di payment_verify_log`)

    // Poll ulang tidak boleh mengkredit/aktivasi dua kali.
    const again = await pollBasunipayPayments()
    assert.equal(again.paid, 0, 'pembayaran lunas tidak dipilih poller lagi')
    if (t.mode === 'credit' && t.balanceTable) {
      const credit = t.creditColumn === 'tokens' ? Number(extra.tokens) || 0 : seeded.payable
      assert.equal(balanceOf(t.balanceTable, userId), credit, 'saldo tidak dobel')
    }
  })
})

test('nexabot_topup kind=unlimited → paket aktif, bukan kredit saldo', async () => {
  const userId = 810900
  seedUser(userId)
  const seeded = seedBasunipayPending('nexabot_topup', userId, { amount: 99000, kind: 'unlimited', days: 30 })

  assert.ok((await pollBasunipayPayments()).paid >= 1)

  const row = db
    .prepare('SELECT status, expires_at, started_at FROM nexabot_topup WHERE id = ?')
    .get(seeded.rowId) as { status: string; expires_at: string | null; started_at: string | null }
  assert.equal(row.status, 'approved', 'paket Unlimited aktif otomatis')
  assert.ok(row.expires_at, 'masa berlaku terisi')
  assert.ok(row.started_at, 'tanggal mulai terisi')

  const saldo = db.prepare('SELECT COUNT(*) AS n FROM nexabot_balance WHERE user_id = ?').get(userId) as { n: number }
  assert.equal(saldo.n, 0, 'paket Unlimited TIDAK boleh dikredit sebagai saldo')

  const log = db
    .prepare("SELECT COUNT(*) AS n FROM payment_verify_log WHERE ref_table = 'nexabot_topup' AND action = 'auto_activated'")
    .get() as { n: number }
  assert.ok(log.n >= 1, 'aktivasi paket tercatat di log audit')
})

test('tabel di luar QRIS_TABLES tetap ditolak (gerbang unknown_table)', () => {
  const r = approveTopupRef('users', 1, 1000, { source: 'basunipay' })
  assert.equal(r.action, 'unknown_table', 'registry adalah satu-satunya pintu approve')
})
