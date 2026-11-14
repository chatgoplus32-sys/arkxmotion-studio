// ─── Pool token master RunningHub: rotasi + kesehatan + klaim harian ────────
//
// Ini jantung permintaan "upload master token yang banyak, auto rotate":
// member top up saldo lalu generate tanpa token sendiri, relay memutar token
// operator. Yang diuji di sini (murni logika DB, tanpa upstream):
//  - addBulk: dedupe, tolak yang bukan kredensial RunningHub / JWT kedaluwarsa;
//  - list/summary: TIDAK pernah memantulkan nilai token, akun disamarkan;
//  - candidates: round-robin antar token sehat, buang rejected/cooldown/expired;
//  - markFailure: invalid→rejected permanen, saldo→cooldown 1 jam, rate→2 menit;
//  - markSuccess mengangkat cooldown; tokenById untuk afinitas task;
//  - klaim harian hanya JWT yang belum diklaim hari itu, mengangkat cooldown;
//  - afinitas task→token tersimpan dan ikut terhapus saat token dibuang;
//  - env RUNNINGHUB_ACCESS_TOKEN = entri implisit id 0; batas RH_POOL_MAX.
import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DB_PATH = path.join(os.tmpdir(), `arkxmotion-rh-pool-${process.pid}.db`)
process.env.ARKXMOTION_DB_PATH = DB_PATH
process.env.JWT_SECRET = 'test-secret-rh-pool'
process.env.RUNNINGHUB_ACCESS_TOKEN = ''

const requireRepo = createRequire(path.join(__dirname, '..', 'package.json'))
const Database = requireRepo('better-sqlite3') as new (file: string) => any

let pool: typeof import('../server/lib/runninghubPool.js')

// ── Kredensial tiruan ───────────────────────────────────────────────────────
const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
const jwtDengan = (exp: number, sub: string) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp, sub })}.sig`
const jwtValid = (sub: string) => jwtDengan(Math.floor(Date.now() / 1000) + 3600, sub)
const jwtKedaluwarsa = (sub: string) => jwtDengan(Math.floor(Date.now() / 1000) - 3600, sub)
const apiKey = (c: string) => c.repeat(32).slice(0, 32)

/** Sisipkan baris mentah (mis. JWT yang sudah kedaluwarsa) lewat koneksi lain. */
function insertRaw(token: string, kind: 'jwt' | 'key', account: string, status = 'active') {
  const db = new Database(DB_PATH)
  const now = Date.now()
  const info = db
    .prepare(
      `INSERT INTO runninghub_master_token
       (label, token, kind, account, status, cooldown_until, last_error, created_at, updated_at)
       VALUES ('', ?, ?, ?, ?, 0, '', ?, ?)`,
    )
    .run(token, kind, account, status, now, now)
  db.close()
  return Number(info.lastInsertRowid)
}

function resetPool() {
  for (const row of pool.rhPoolList()) pool.rhPoolDelete(row.id)
  process.env.RUNNINGHUB_ACCESS_TOKEN = ''
  pool.rhPoolMarkSuccess(0) // bersihkan kesehatan env (id 0)
}

const ids = () => pool.rhPoolList().map((r) => r.id)

before(async () => {
  pool = await import('../server/lib/runninghubPool.js')
})

beforeEach(() => resetPool())

after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix) } catch { /* belum ada / terkunci */ }
  }
})

// ── Tambah massal ───────────────────────────────────────────────────────────

test('addBulk: dedupe + tolak MarkasTools/whitespace/JWT kedaluwarsa', () => {
  const v = jwtValid('11111111')
  const res = pool.rhPoolAddBulk(
    [v, v, 'MF-ABC123', 'abc def', jwtKedaluwarsa('22222222'), '   ', apiKey('a')],
    'batch',
  )
  assert.deepEqual(res, { added: 2, skipped: 1, invalid: 3 })
  assert.equal(pool.rhPoolList().length, 2)
})

test('addBulk menerima string multi-baris / koma dan memberi label', () => {
  const a = jwtValid('aaaaaaaa')
  const b = apiKey('b')
  const res = pool.rhPoolAddBulk(`${a}\n${b},${a}`, 'operator-1')
  assert.deepEqual(res, { added: 2, skipped: 1, invalid: 0 })
  assert.ok(pool.rhPoolList().every((r) => r.label === 'operator-1'))
})

test('addBulk menghormati batas RH_POOL_MAX', () => {
  const banyak = Array.from({ length: pool.RH_POOL_MAX + 5 }, (_, i) => jwtValid(`cap-${i}`))
  const res = pool.rhPoolAddBulk(banyak)
  assert.equal(res.added, pool.RH_POOL_MAX)
  assert.equal(pool.rhPoolSummary().total, pool.RH_POOL_MAX)
})

// ── Kerahasiaan ─────────────────────────────────────────────────────────────

test('list tidak pernah memantulkan nilai token dan menyamarkan akun', () => {
  const rahasia = jwtValid('1234567890')
  pool.rhPoolAddBulk([rahasia])
  const list = pool.rhPoolList()
  assert.equal(list.length, 1)
  assert.ok(!('token' in list[0]), 'nilai token bocor ke daftar admin')
  assert.equal(list[0].account, '123…7890')
  assert.ok(!JSON.stringify(list).includes(rahasia), 'token muncul di JSON daftar')
})

test('summary menghitung status dan menandai env', () => {
  pool.rhPoolAddBulk([jwtValid('s1'), apiKey('c')])
  const [jwtId] = ids()
  pool.rhPoolMarkFailure(jwtId, 'invalid', 'ditolak')

  const s = pool.rhPoolSummary()
  assert.equal(s.total, 2)
  assert.equal(s.active, 1)
  assert.equal(s.rejected, 1)
  assert.equal(s.usable, 1)
  assert.equal(s.envConfigured, false)
  assert.equal(s.max, pool.RH_POOL_MAX)

  process.env.RUNNINGHUB_ACCESS_TOKEN = jwtValid('env')
  const s2 = pool.rhPoolSummary()
  assert.equal(s2.envConfigured, true)
  assert.equal(s2.total, 3)
  assert.equal(s2.usable, 2) // key DB + env
})

// ── Rotasi ──────────────────────────────────────────────────────────────────

test('candidates berputar round-robin antar token sehat', () => {
  pool.rhPoolAddBulk([jwtValid('r1'), jwtValid('r2'), jwtValid('r3')])
  const sehat = ids()
  assert.equal(sehat.length, 3)

  const pertama: number[] = []
  for (let i = 0; i < 3; i++) {
    const cand = pool.rhPoolCandidates()
    assert.equal(cand.length, 3, 'rotasi tidak boleh membuang token sehat')
    assert.deepEqual([...cand.map((c) => c.id)].sort(), [...sehat].sort())
    pertama.push(cand[0].id)
  }
  assert.equal(new Set(pertama).size, 3, 'tiga panggilan harus mulai dari tiga token berbeda')
})

test('candidates membuang rejected, cooldown, dan JWT kedaluwarsa', () => {
  pool.rhPoolAddBulk([jwtValid('keep'), jwtValid('rej'), jwtValid('cool')])
  const [keep, rej, cool] = ids()
  const expired = insertRaw(jwtKedaluwarsa('exp'), 'jwt', 'exp')

  pool.rhPoolMarkFailure(rej, 'invalid', '412')
  pool.rhPoolMarkFailure(cool, 'saldo', '605')

  const cand = pool.rhPoolCandidates()
  assert.deepEqual(cand.map((c) => c.id), [keep])
  assert.ok(!cand.some((c) => c.id === expired))
})

test('env menjadi kandidat id 0 saat di-set', () => {
  const env = jwtValid('env-acct')
  process.env.RUNNINGHUB_ACCESS_TOKEN = env
  const cand = pool.rhPoolCandidates()
  assert.equal(cand.length, 1)
  assert.equal(cand[0].id, 0)
  assert.equal(cand[0].token, env)
  assert.equal(cand[0].kind, 'jwt')
})

// ── Kesehatan token ─────────────────────────────────────────────────────────

test('markFailure: invalid→rejected, saldo→cooldown 1 jam, rate→2 menit', () => {
  pool.rhPoolAddBulk([jwtValid('f1'), jwtValid('f2'), jwtValid('f3')])
  const [a, b, c] = ids()
  const sebelum = Date.now()

  pool.rhPoolMarkFailure(a, 'invalid', '806')
  pool.rhPoolMarkFailure(b, 'saldo', '605')
  pool.rhPoolMarkFailure(c, 'rate', '429')

  const rows = pool.rhPoolList()
  const rowA = rows.find((r) => r.id === a)!
  const rowB = rows.find((r) => r.id === b)!
  const rowC = rows.find((r) => r.id === c)!

  assert.equal(rowA.status, 'rejected')
  assert.equal(rowB.status, 'cooldown')
  assert.equal(rowC.status, 'cooldown')
  assert.ok(Math.abs(rowB.cooldown_until - sebelum - 60 * 60 * 1000) < 5000, 'cooldown saldo ≠ 1 jam')
  assert.ok(Math.abs(rowC.cooldown_until - sebelum - 2 * 60 * 1000) < 5000, 'cooldown rate ≠ 2 menit')
})

test('markSuccess mengangkat cooldown dan rejected', () => {
  pool.rhPoolAddBulk([jwtValid('s1')])
  const [id] = ids()
  pool.rhPoolMarkFailure(id, 'saldo', '605')
  assert.equal(pool.rhPoolList()[0].status, 'cooldown')

  pool.rhPoolMarkSuccess(id)
  const row = pool.rhPoolList()[0]
  assert.equal(row.status, 'active')
  assert.equal(row.cooldown_until, 0)
  assert.equal(row.last_error, '')
  assert.ok(row.last_used_at, 'last_used_at tidak tercatat')
  assert.deepEqual(pool.rhPoolCandidates().map((c) => c.id), [id])
})

test('tokenById mengembalikan token sehat, null untuk rejected/kedaluwarsa', () => {
  pool.rhPoolAddBulk([jwtValid('ok')])
  const [ok] = ids()
  const rejected = insertRaw(jwtValid('no'), 'jwt', 'no', 'rejected')
  const expired = insertRaw(jwtKedaluwarsa('exp'), 'jwt', 'exp')

  assert.equal(pool.rhPoolTokenById(ok)?.id, ok)
  assert.equal(pool.rhPoolTokenById(rejected), null)
  assert.equal(pool.rhPoolTokenById(expired), null)
  assert.equal(pool.rhPoolTokenById(999999), null)
})

// ── Afinitas task ───────────────────────────────────────────────────────────

test('afinitas task→token tersimpan dan terhapus saat token dibuang', () => {
  pool.rhPoolAddBulk([jwtValid('t1')])
  const [id] = ids()
  pool.rhRememberTaskToken('task-abc', id)
  assert.equal(pool.rhTaskTokenId('task-abc'), id)
  assert.equal(pool.rhTaskTokenId('tidak-ada'), null)

  pool.rhPoolDelete(id)
  assert.equal(pool.rhTaskTokenId('task-abc'), null, 'afinitas yatim setelah token dihapus')
})

// ── Klaim harian ────────────────────────────────────────────────────────────

test('claimDue hanya JWT belum diklaim hari itu; markClaimed mengangkat cooldown', () => {
  const hari = '2026-11-14'
  pool.rhPoolAddBulk([jwtValid('c1'), jwtValid('c2'), apiKey('d')])
  const [c1, c2] = ids()
  const expired = insertRaw(jwtKedaluwarsa('exp'), 'jwt', 'exp')

  const due = pool.rhPoolClaimDue(hari)
  assert.deepEqual(due.map((c) => c.id).sort(), [c1, c2].sort())
  assert.ok(!due.some((c) => c.id === expired), 'JWT kedaluwarsa ikut antrean klaim')

  // c2 sedang cooldown saldo; klaim sukses harus mengangkatnya.
  pool.rhPoolMarkFailure(c2, 'saldo', '605')
  pool.rhPoolMarkClaimed(c1, hari, 500)
  pool.rhPoolMarkClaimed(c2, hari, 30)

  const rows = pool.rhPoolList()
  const rowC1 = rows.find((r) => r.id === c1)!
  const rowC2 = rows.find((r) => r.id === c2)!
  assert.equal(rowC1.last_claim_day, hari)
  assert.equal(rowC1.points_balance, 500)
  assert.equal(rowC2.status, 'active', 'klaim tidak mengangkat cooldown')
  assert.equal(rowC2.cooldown_until, 0)

  const dueLagi = pool.rhPoolClaimDue(hari)
  assert.deepEqual(dueLagi, [], 'token yang sudah diklaim hari itu tidak boleh antre lagi')
})

test('claimDue melewati token rejected', () => {
  const hari = '2026-11-14'
  pool.rhPoolAddBulk([jwtValid('x1'), jwtValid('x2')])
  const [x1] = ids()
  pool.rhPoolMarkFailure(x1, 'invalid', '806')
  const due = pool.rhPoolClaimDue(hari)
  assert.ok(!due.some((c) => c.id === x1))
  assert.equal(due.length, 1)
})