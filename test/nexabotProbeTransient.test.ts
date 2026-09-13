// ─── Test klasifikasi kegagalan probe NexaBot (fetch di-stub) ───────────────
// Log produksi: /api/public/nexabot/credit & /session menjawab 504 (anggaran
// proxy habis) atau klien abort karena timeout — dua-duanya masalah GATEWAY,
// bukan key/cookie. Dulu keduanya dicap 'invalid' sehingga sesi Unlimited yang
// sehat ikut dicabut dan user diminta login ulang. Test ini mengunci penanda
// `transient` yang dipakai UI untuk memilih status 'rate-limited'.
import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { checkNexabotBalance, checkNexabotSession } from '../src/lib/nexabot.js'

const originalFetch = globalThis.fetch
const API_KEY = 'nxb_abcdef123456'
const COOKIES = 'connect.sid=abc123'

let queue: Array<() => Response> = []

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function timeoutError() {
  const err: any = new Error('The operation was aborted due to timeout')
  err.name = 'TimeoutError'
  return err
}

beforeEach(() => {
  queue = []
  globalThis.fetch = (async () => {
    const next = queue.shift()
    if (!next) throw new Error('fetch dipanggil tanpa respons yang disiapkan')
    return next()
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('saldo: 504 & timeout ditandai transient, 401 tidak', async () => {
  queue.push(() => jsonResponse({ ok: false }, 504))
  const gateway = await checkNexabotBalance(API_KEY)
  assert.equal(gateway.ok, false)
  assert.equal(gateway.transient, true, '504 dari proxy = masalah gateway')
  assert.equal(gateway.status, 504)
  assert.match(gateway.error || '', /NexaBot/i)

  queue.push(() => { throw timeoutError() })
  const timedOut = await checkNexabotBalance(API_KEY)
  assert.equal(timedOut.transient, true, 'timeout/abort = transient')

  queue.push(() => jsonResponse({ ok: false, error: 'API key tidak valid' }, 401))
  const rejected = await checkNexabotBalance(API_KEY)
  assert.equal(rejected.transient, false, '401 = key-nya yang salah, bukan gateway')
  assert.equal(rejected.error, 'API key tidak valid')
})

test('sesi: 504 & timeout ditandai transient, 401 tidak', async () => {
  queue.push(() => jsonResponse({ ok: false }, 504))
  const gateway = await checkNexabotSession(COOKIES)
  assert.equal(gateway.ok, false)
  assert.equal(gateway.active, false)
  assert.equal(gateway.transient, true)

  queue.push(() => { throw timeoutError() })
  const timedOut = await checkNexabotSession(COOKIES)
  assert.equal(timedOut.transient, true, 'timeout bukan tanda cookie mati')

  queue.push(() => jsonResponse({ ok: false }, 401))
  const rejected = await checkNexabotSession(COOKIES)
  assert.equal(rejected.transient, false, '401 = cookie benar-benar ditolak')
})

test('sesi: jawaban 200 tetap terbaca normal (bukan transient)', async () => {
  queue.push(() => jsonResponse({ ok: true, credit: 7.5, unlimited: true }))
  const info = await checkNexabotSession(COOKIES)
  assert.equal(info.ok, true)
  assert.equal(info.unlimited, true)
  assert.equal(info.balance, 7.5)
  assert.equal(info.transient, false)
})
