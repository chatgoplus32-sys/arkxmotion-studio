// ─── Klaim hadiah harian RunningHub via cron server ────────────────────────
// Yang dijaga di sini:
//  1. Hanya JWT yang boleh masuk registry — API key 32-hex tidak bisa memakai
//     hadiah harian dan tidak boleh ikut disimpan server.
//  2. Endpoint wajib beridentitas; token tidak pernah dikembalikan lagi.
//  3. Mengganti daftar token menghapus token lama (credential tidak menumpuk).
//  4. Hari klaim memakai UTC+8 (reset RunningHub), bukan tanggal lokal server.
//  5. Balasan "sudah diklaim" dihitung sukses, token ditolak tidak diulang.
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import express from 'express'
import jwt from 'jsonwebtoken'
import os from 'node:os'

const DB_PATH = path.join(os.tmpdir(), `arkxmotion-rh-claim-${process.pid}.db`)
process.env.ARKXMOTION_DB_PATH = DB_PATH

const JWT_SECRET = 'test-secret-rh-claim'
process.env.JWT_SECRET = JWT_SECRET

const originalFetch = globalThis.fetch
const { default: claimRoutes } = await import('../server/routes/runninghubDailyClaim.js')
const {
  claimDayKey,
  normalizeClaimTokens,
  replaceAutoClaimTokens,
  runAutoClaimForUser,
} = await import('../server/lib/runninghubDailyClaim.js')
const { rhClaimDailyGift } = await import('../server/routes/publicRunninghub.js')
const db = (await import('../server/db.js')).default

const USER_ID = 71
const appToken = jwt.sign({ id: USER_ID, email: 'user@test.local', role: 'user' }, JWT_SECRET)

const FUTURE = () => Math.floor(Date.now() / 1000) + 3600

function fakeJwt(expSec: number, sub = 'akun-runninghub-71'): string {
  const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${b64url({ alg: 'HS512', typ: 'JWT' })}.${b64url({ sub, exp: expSec })}.tanda-tangan`
}

const app = express()
app.use(express.json())
app.use('/api/runninghub/daily-claim', claimRoutes)

let server: ReturnType<typeof app.listen>
let base = ''

before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => {
  server?.close()
  globalThis.fetch = originalFetch
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix) } catch { /* belum ada / terkunci */ }
  }
})

async function call(method: string, body?: unknown, token?: string) {
  const res = await originalFetch(`${base}/api/runninghub/daily-claim${method === 'GET' ? '' : method === 'POST' ? '/run' : ''}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as any, text: '' }
}

/** Stub hanya untuk panggilan upstream RunningHub; server tes tetap asli. */
async function withUpstream(
  handler: (url: string, init?: any) => Response,
  fn: () => Promise<void>,
): Promise<void> {
  globalThis.fetch = (async (url: any, init?: any) => handler(String(url), init)) as any
  try {
    await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('hari klaim berganti tepat tengah malam UTC+8', () => {
  assert.equal(claimDayKey(Date.UTC(2026, 10, 10, 15, 59, 59)), '2026-11-10')
  assert.equal(claimDayKey(Date.UTC(2026, 10, 10, 16, 0, 0)), '2026-11-11')
})

test('registry hanya menerima JWT valid, buang API key dan duplikat', () => {
  const a = fakeJwt(FUTURE())
  const b = fakeJwt(FUTURE() + 5)
  const out = normalizeClaimTokens([
    a,
    'faa75749d2fa40bbbdc8f196b4fc78dd',
    `Bearer ${b}`,
    a,
    'eyJhbGciOiJIUzI1NiJ9.bukan-json.tanda',
    123,
  ])
  assert.deepEqual(out, [a, b])
})

test('endpoint klaim otomatis menolak pemanggil tanpa identitas', async () => {
  assert.equal((await call('GET')).status, 401)
  assert.equal((await call('PUT', { enabled: true, tokens: [] })).status, 401)
  assert.equal((await call('POST', {}, undefined)).status, 401)
})

test('simpan token: tersimpan, ter-mask, dan daftar lama dihapus', async () => {
  const j1 = fakeJwt(FUTURE())
  const j2 = fakeJwt(FUTURE() + 1, 'akun-kedua-72')

  const saved = await call('PUT', { enabled: true, tokens: [j1, j2] }, appToken)
  assert.equal(saved.status, 200)
  assert.equal(saved.body.enabled, true)
  assert.equal(saved.body.tokens.length, 2)
  assert.ok(saved.body.tokens.every((t: any) => !String(t.account).includes(j1)))
  assert.ok(!JSON.stringify(saved.body).includes(j1), 'token utuh tidak boleh keluar')

  const one = await call('PUT', { enabled: true, tokens: [j1] }, appToken)
  assert.equal(one.body.tokens.length, 1)

  const off = await call('PUT', { enabled: false, tokens: [j1] }, appToken)
  assert.equal(off.body.enabled, false)
  assert.equal(off.body.tokens.length, 0)

  const rows = (db.prepare('SELECT COUNT(*) AS n FROM runninghub_claim_token WHERE user_id = ?').get(USER_ID) as any).n
  assert.equal(rows, 0)
})

test('klasifikasi balasan klaim: sukses, sudah, ditolak, dan gangguan', async () => {
  const token = fakeJwt(FUTURE())
  let seenAuth = ''

  await withUpstream((url, init) => {
    seenAuth = String(init?.headers?.Authorization || '')
    assert.match(url, /\/api\/welfare\/daily-gift\/claim$/)
    return new Response(JSON.stringify({ code: 0, msg: 'success' }), { status: 200 })
  }, async () => {
    const res = await rhClaimDailyGift(token, { wallet: false })
    assert.equal(res.outcome, 'claimed')
  })
  assert.equal(seenAuth, `Bearer ${token}`)

  await withUpstream(
    () => new Response(JSON.stringify({ code: 400, msg: 'today already claimed' }), { status: 200 }),
    async () => {
      const res = await rhClaimDailyGift(token, { wallet: false })
      assert.equal(res.outcome, 'already')
    },
  )

  await withUpstream(
    () => new Response(JSON.stringify({ code: 412, msg: 'TOKEN_INVALID' }), { status: 200 }),
    async () => {
      const res = await rhClaimDailyGift(token, { wallet: false })
      assert.equal(res.outcome, 'rejected')
    },
  )

  await withUpstream(
    () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
    async () => {
      const res = await rhClaimDailyGift(token, { wallet: false })
      assert.equal(res.outcome, 'error')
    },
  )
})

test('run klaim: sekali per akun per hari, token ditolak tidak diulang', async () => {
  const j1 = fakeJwt(FUTURE(), 'akun-satu')
  const j2 = fakeJwt(FUTURE() + 2, 'akun-dua')
  replaceAutoClaimTokens(USER_ID, [j1, j2])

  let calls = 0
  const authSeen: string[] = []
  await withUpstream((_url, init) => {
    calls++
    const auth = String(init?.headers?.Authorization || '')
    authSeen.push(auth)
    if (auth === `Bearer ${j1}`) {
      return new Response(JSON.stringify({ code: 0, msg: 'success' }), { status: 200 })
    }
    return new Response(JSON.stringify({ code: 400, msg: 'sudah领取' }), { status: 200 })
  }, async () => {
    const first = await runAutoClaimForUser(USER_ID, { force: true })
    assert.equal(first?.claimed, 1)
    assert.equal(first?.already, 1)
    assert.equal(first?.failed, 0)
    assert.equal(calls, 2)

    // Putaran berikutnya di hari yang sama: semuanya dilewati.
    const second = await runAutoClaimForUser(USER_ID, { force: true })
    assert.equal(second?.processed, 0)
    assert.equal(second?.skipped, 2)
    assert.equal(calls, 2)
  })
  assert.equal(authSeen.length, 2)

  const status = await call('GET', undefined, appToken)
  assert.equal(status.body.summary.total, 2)
  assert.equal(status.body.summary.claimedToday, 2)
  assert.equal(status.body.summary.rejected, 0)
})
