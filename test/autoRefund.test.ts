// ─── Refund otomatis dari Sisi Server saat gagal SEBELUM job terbentuk ──────
// Sampai 15 Nov 2026, pengembalian saldo/token hanya terjadi kalau FRONTEND
// memanggil /refund. Itu menjadikan saldo member bergantung pada halaman "ingat"
// memanggilnya di jalur gagal — dan member menutup tab / restart / bug di catch
// artinya saldo terpotong tanpa job sama sekali.
//
// Sekarang server mengembalikan saldonya sendiri di titik pelepasan tiket:
//   - settleTicket (Seavi/Posbot/RunningHub): upstream menolak sebelum job
//     (429/400/401/403/404/409/422, atau 503 "coba lagi") → saldo/token
//     dikembalikan otomatis, tidak menunggu klien;
//   - autoRefundUsage: idempoten — refund ganda (klien DAN server) tidak pernah
//     menggandakan saldo, pemanggilan sesudah usage `refunded` = no-op;
//   - 5xx/timeout sengaja TIDAK direfund di relay: job bisa saja sudah terbentuk.
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DB_PATH = path.join(os.tmpdir(), `arkxmotion-autorefund-${process.pid}-${Date.now()}.db`)
const PREFIX_DB_TES = 'arkxmotion-autorefund-'
function bersihkanSisaDbTes() {
  let nama: string[]
  try {
    nama = fs.readdirSync(os.tmpdir())
  } catch {
    return // tmpdir tidak terbaca — bukan tugas tes ini
  }
  const batas = Date.now() - 60 * 60 * 1000
  for (const n of nama) {
    if (!n.startsWith(PREFIX_DB_TES)) continue
    const p = path.join(os.tmpdir(), n)
    try {
      if (fs.statSync(p).mtimeMs > batas) continue // masih ditulis run lain
      fs.rmSync(p, { force: true })
    } catch {
      /* terkunci atau sudah hilang — abaikan */
    }
  }
}
bersihkanSisaDbTes()
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })

process.env.ARKXMOTION_DB_PATH = DB_PATH

const { createRequire } = await import('node:module')
const requireRepo = createRequire(path.join(__dirname, '..', 'package.json'))
const Database = requireRepo('better-sqlite3') as new (file: string) => any

const { settleTicket } = await import('../server/lib/providerRelay.js')
const { autoRefundUsage } = await import('../server/lib/autoRefund.js')

function jalankanSql(sql: string, ...args: unknown[]) {
  const db = new Database(DB_PATH)
  const info = db.prepare(sql).run(...args)
  db.close()
  return info
}

function bacaSql<T = any>(sql: string, ...args: unknown[]): T[] {
  const db = new Database(DB_PATH)
  const rows = db.prepare(sql).all(...args) as T[]
  db.close()
  return rows
}

const MEMBER = 5101
const TABEL = {
  seavi: { usage: 'seavi_usage', balance: 'seavi_balance', cost: 2 },
  posbot: { usage: 'posbot_usage', balance: 'posbot_balance', cost: 1000 },
  runninghub: { usage: 'runninghub_usage', balance: 'runninghub_balance', cost: 1500 },
} as const

function seedUsage(provider: keyof typeof TABEL, userId: number, cost?: number) {
  const spec = TABEL[provider]
  const harga = cost ?? spec.cost
  const info = jalankanSql(
    `INSERT INTO ${spec.usage} (user_id, model, cost, units, batch_id, status) VALUES (?, 'uji', ?, 1, ?, 'used')`,
    userId,
    harga,
    `b-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  return Number(info.lastInsertRowid)
}

function seedBalance(provider: keyof typeof TABEL, userId: number, balance: number) {
  jalankanSql(`INSERT INTO ${TABEL[provider].balance} (user_id, balance) VALUES (?, ?)`, userId, balance)
}

function saldo(provider: keyof typeof TABEL, userId: number) {
  return bacaSql<{ balance: number }>(
    `SELECT balance FROM ${TABEL[provider].balance} WHERE user_id = ?`,
    userId,
  )[0]?.balance
}

function statusUsage(provider: keyof typeof TABEL, usageId: number) {
  return bacaSql<{ status: string }>(
    `SELECT status FROM ${TABEL[provider].usage} WHERE id = ?`,
    usageId,
  )[0]?.status
}

before(() => {
  for (const [id, email] of [
    [MEMBER, 'member-autorefund@test.local'],
    [5102, 'member2-autorefund@test.local'],
    [5103, 'member3-autorefund@test.local'],
    [5104, 'member4-autorefund@test.local'],
    [5105, 'member5-autorefund@test.local'],
    [5106, 'member6-autorefund@test.local'],
  ] as const) {
    jalankanSql(
      `INSERT OR IGNORE INTO users (id, email, password, name, role, approved) VALUES (?, ?, 'x', 'uji', 'user', 1)`,
      id,
      email,
    )
  }
  seedBalance('seavi', 5102, 10)
  seedBalance('posbot', 5102, 50000)
  seedBalance('runninghub', 5102, 100000)
  seedBalance('seavi', MEMBER, 1) // cost 0 case: usage dengan cost 0 tidak mengembalikan saldo
})

after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix) } catch { /* belum ada / terkunci */ }
  }
})

test('Seavi: upstream menolak (429) → token dikembalikan otomatis', () => {
  seedBalance('seavi', 5103, 10)
  const usageId = seedUsage('seavi', 5103, 2)
  settleTicket('seavi', usageId, 429, '{"ok":false,"error":"rate limited"}')
  assert.equal(saldo('seavi', 5103), 12, 'token harus kembali (+2)')
  assert.equal(statusUsage('seavi', usageId), 'refunded')
})

test('PosBot: parameter ditolak (400) → saldo dikembalikan otomatis', () => {
  seedBalance('posbot', 5104, 50000)
  const usageId = seedUsage('posbot', 5104, 1000)
  settleTicket('posbot', usageId, 400, '{"error":"param salah"}')
  assert.equal(saldo('posbot', 5104), 51000, 'Rp harus kembali (+1000)')
  assert.equal(statusUsage('posbot', usageId), 'refunded')
})

test('RunningHub: forbidden (403) → saldo dikembalikan otomatis', () => {
  seedBalance('runninghub', 5105, 100000)
  const usageId = seedUsage('runninghub', 5105, 1500)
  settleTicket('runninghub', usageId, 403, '{"ok":false,"error":"forbidden"}')
  assert.equal(saldo('runninghub', 5105), 101500, 'Rp harus kembali (+1500)')
  assert.equal(statusUsage('runninghub', usageId), 'refunded')
})

test('503 "coba lagi" (pre-job) → dikembalikan; 503/500 (ambigu) → tidak', () => {
  seedBalance('runninghub', 5106, 100000)
  const usageRetry = seedUsage('runninghub', 5106)
  settleTicket('runninghub', usageRetry, 503, 'coba lagi dalam 30 detik')
  assert.equal(saldo('runninghub', 5106), 101500, '503 "coba lagi" = pre-job → harus kembali')

  const usageAmbigu = seedUsage('runninghub', 5106)
  settleTicket('runninghub', usageAmbigu, 503, 'internal error')
  assert.equal(saldo('runninghub', 5106), 101500, '503 ambigu = job mungkin sudah terbentuk → TIDAK dikembalikan')
  assert.equal(statusUsage('runninghub', usageAmbigu), 'used')

  const usageServer = seedUsage('runninghub', 5106)
  settleTicket('runninghub', usageServer, 500, '{"error":"boom"}')
  assert.equal(saldo('runninghub', 5106), 101500, '500 = job mungkin sudah terbentuk → TIDAK dikembalikan')
  assert.equal(statusUsage('runninghub', usageServer), 'used')
})

test('Job berhasil terbentuk (2xx + job id) → TIDAK dikembalikan', () => {
  const usageId = seedUsage('seavi', 5102)
  settleTicket('seavi', usageId, 200, '{"id":"sv-job-1"}')
  assert.equal(saldo('seavi', 5102), 10, 'job dibuat → tiket hangus, saldo tetap terpotong')
  assert.equal(statusUsage('seavi', usageId), 'used', 'usage tetap used (bukan refunded)')
})

test('autoRefundUsage: idempoten — pemanggilan ganda tidak menggandakan saldo', () => {
  const usageId = seedUsage('posbot', 5102)
  const pertama = autoRefundUsage('posbot_usage', 'posbot_balance', usageId)
  const kedua = autoRefundUsage('posbot_usage', 'posbot_balance', usageId)
  assert.equal(pertama.refunded, 1)
  assert.equal(pertama.amount, 1000)
  assert.equal(kedua.refunded, 0, 'refund ganda harus no-op')
  assert.equal(kedua.amount, 0)
  assert.equal(saldo('posbot', 5102), 51000, 'saldo tidak boleh bertambah dua kali')
})

test('autoRefundUsage: usage cost 0 → usage refunded, saldo tetap', () => {
  const usageId = seedUsage('seavi', MEMBER, 0)
  const sebelum = saldo('seavi', MEMBER)
  const hasil = autoRefundUsage('seavi_usage', 'seavi_balance', usageId)
  assert.equal(hasil.refunded, 1, 'usage cost 0 tetap ditandai refunded')
  assert.equal(hasil.amount, 0, 'tidak ada uang yang kembali')
  assert.equal(saldo('seavi', MEMBER), sebelum, 'saldo tidak boleh berubah')
  assert.equal(statusUsage('seavi', usageId), 'refunded')
})

test('autoRefundUsage: usage tidak ada / usageId tidak valid → aman, tanpa efek', () => {
  const sebelum = saldo('posbot', 5102)
  assert.deepEqual(autoRefundUsage('posbot_usage', 'posbot_balance', null), { refunded: 0, amount: 0 })
  assert.deepEqual(autoRefundUsage('posbot_usage', 'posbot_balance', NaN), { refunded: 0, amount: 0 })
  assert.deepEqual(autoRefundUsage('posbot_usage', 'posbot_balance', 999999), { refunded: 0, amount: 0 })
  assert.equal(saldo('posbot', 5102), sebelum)
})

test('klien refund sesudah server auto-refund → no-op, saldo tidak bertambah dua kali', () => {
  const usageId = seedUsage('runninghub', 5102)
  settleTicket('runninghub', usageId, 429, 'rate limited')
  assert.equal(saldo('runninghub', 5102), 101500)
  // Simulasikan klien yang "telat" memanggil lagi — usage sudah refunded.
  const tetap = autoRefundUsage('runninghub_usage', 'runninghub_balance', usageId)
  assert.equal(tetap.refunded, 0)
  assert.equal(saldo('runninghub', 5102), 101500, 'saldo tidak boleh bertambah dua kali')
})
