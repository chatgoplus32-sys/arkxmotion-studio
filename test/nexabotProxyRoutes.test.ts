// ─── Test proxy NexaBot lokal (Express) lewat HTTP sungguhan ────────────────
// Menguji efek yang dilihat klien: 504 pada /credit dan /job/:id dulu muncul
// walau upstream hanya hiccup sekali. Sekarang percobaan pertama yang timeout
// diulang di sisi proxy, sehingga klien menerima jawaban asli — sementara
// /submit & /generate tetap SEKALI jalan supaya job/kredit tidak ganda.
//
// Upstream di-stub lewat globalThis.fetch; jeda retry dikecilkan via env
// NEXABOT_PROXY_RETRY_* supaya test tidak menunggu setengah detik.
import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import nexabotRoutes from '../server/routes/nexabot.js'

const originalFetch = globalThis.fetch

function timeoutError() {
  const err: any = new Error('The operation was aborted due to timeout')
  err.name = 'TimeoutError'
  return err
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

let calls: string[] = []
let queue: Array<() => Response> = []

const app = express()
app.use(express.json())
app.use('/api/public/nexabot', nexabotRoutes)

let server: ReturnType<typeof app.listen>
let base = ''

before(async () => {
  process.env.NEXABOT_PROXY_RETRY_BASE_MS = '1'
  process.env.NEXABOT_PROXY_RETRY_MAX_MS = '1'
  // Retry-After upstream tetap DITERUSKAN ke klien, tapi proxy tidak ikut
  // menunggu 7 detik di dalam test.
  process.env.NEXABOT_PROXY_RETRY_MAX_RETRY_AFTER_MS = '1'

  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

beforeEach(() => {
  calls = []
  queue = []
  globalThis.fetch = (async (input: any) => {
    calls.push(String(input))
    const next = queue.shift()
    if (!next) throw new Error(`fetch dipanggil ke-${calls.length} tanpa langkah berikutnya`)
    return next()
  }) as typeof fetch
})

after(async () => {
  globalThis.fetch = originalFetch
  delete process.env.NEXABOT_PROXY_RETRY_BASE_MS
  delete process.env.NEXABOT_PROXY_RETRY_MAX_MS
  delete process.env.NEXABOT_PROXY_RETRY_MAX_RETRY_AFTER_MS
  await new Promise((resolve) => server.close(resolve))
})

// Klien test memakai fetch ASLI yang disimpan di awal — globalThis.fetch sudah
// diganti stub untuk meniru upstream, jadi jangan dipakai dari sisi test.
async function get(path: string, headers: Record<string, string> = {}) {
  const res = await originalFetch(`${base}${path}`, { headers })
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : undefined }
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await originalFetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : undefined }
}

test('/credit: satu timeout lalu sukses → klien tidak pernah melihat 504', async () => {
  queue.push(
    () => { throw timeoutError() },
    () => jsonResponse({ ok: true, credit: 4.75, credit_cost: 0.25 }),
  )

  const res = await get('/api/public/nexabot/credit', { 'X-Api-Key': 'nxb_test' })

  assert.equal(res.status, 200)
  assert.equal(res.body.credit, 4.75)
  assert.equal(calls.length, 2, 'percobaan kedua dijalankan proxy, bukan klien')
})

test('/credit: upstream benar-benar mati → 504 dengan pesan yang menyebut jenis request & percobaan', async () => {
  for (let i = 0; i < 8; i++) queue.push(() => { throw timeoutError() })

  const res = await get('/api/public/nexabot/credit', { 'X-Api-Key': 'nxb_test' })

  assert.equal(res.status, 504)
  assert.match(res.body.error, /cek saldo/)
  assert.match(res.body.error, /3×30s/)
  assert.equal(calls.length, 3, 'berhenti setelah 3 percobaan')
})

test('/credit: key salah (401) diteruskan tanpa diulang', async () => {
  queue.push(() => jsonResponse({ ok: false, error: 'unauthorized' }, 401))

  const res = await get('/api/public/nexabot/credit', { 'X-Api-Key': 'nxb_test' })

  assert.equal(res.status, 401)
  assert.equal(calls.length, 1)
})

test('/job/:id: 429 + Retry-After diulang, lalu sukses', async () => {
  queue.push(
    () => jsonResponse({ ok: false, error: 'rate limit' }, 429, { 'Retry-After': '0' }),
    () => jsonResponse({ ok: true, job: { id: 'j1', status: 'queued', mode: 'sfv', prompt: 'x' } }),
  )

  const res = await get('/api/public/nexabot/job/j1', { 'X-Nexabot-Cookie': 'session=abc' })

  assert.equal(res.status, 200)
  assert.equal(res.body.job.status, 'queued')
  assert.equal(calls.length, 2)
})

test('/job/:id: rate limit terus-menerus → status & Retry-After upstream diteruskan ke klien', async () => {
  queue.push(
    () => jsonResponse({ ok: false, error: 'rate limit' }, 429, { 'Retry-After': '7' }),
    () => jsonResponse({ ok: false, error: 'rate limit' }, 429, { 'Retry-After': '7' }),
  )

  const res = await get('/api/public/nexabot/job/j1', { 'X-Nexabot-Cookie': 'session=abc' })

  assert.equal(res.status, 429)
  assert.equal(res.headers.get('retry-after'), '7', 'klien bisa menghormati jeda yang diminta upstream')
  assert.equal(calls.length, 2, 'poll status: 2 percobaan')
})

test('/job/:id: halaman HTML (cookie mati) diteruskan apa adanya, bukan diulang', async () => {
  queue.push(() => new Response('<html>login</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))

  const res = await originalFetch(`${base}/api/public/nexabot/job/j1`, { headers: { 'X-Nexabot-Cookie': 'session=abc' } })
  const text = await res.text()

  assert.equal(res.status, 200)
  assert.match(text, /<html>/)
  assert.equal(calls.length, 1)
})

test('/generate: timeout TIDAK diulang (hindari job & kredit ganda)', async () => {
  queue.push(() => { throw timeoutError() })

  const res = await post('/api/public/nexabot/generate', { mode: 'sfv', prompt: 'animasikan' }, { 'X-Nexabot-Cookie': 'session=abc' })

  assert.equal(res.status, 504)
  assert.equal(calls.length, 1)
  assert.match(res.body.error, /generate via session/)
})

test('/submit: timeout TIDAK diulang, dan 429 upstream diteruskan', async () => {
  queue.push(() => { throw timeoutError() })
  const timedOut = await post('/api/public/nexabot/submit', { mode: 't2v', prompt: 'x' }, { 'X-Api-Key': 'nxb_test' })
  assert.equal(timedOut.status, 504)
  assert.equal(calls.length, 1)

  calls = []
  queue = [() => jsonResponse({ ok: false, error: 'rate limit' }, 429, { 'Retry-After': '3' })]
  const limited = await post('/api/public/nexabot/submit', { mode: 't2v', prompt: 'x' }, { 'X-Api-Key': 'nxb_test' })
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get('retry-after'), '3')
  assert.equal(calls.length, 1)
})

test('/modes: read-only, diulang saat upstream hiccup', async () => {
  queue.push(
    () => { throw timeoutError() },
    () => jsonResponse({ ok: true, modes: ['t2v', 'sfv'] }),
  )

  const res = await get('/api/public/nexabot/modes', { 'X-Api-Key': 'nxb_test' })

  assert.equal(res.status, 200)
  assert.deepEqual(res.body.modes, ['t2v', 'sfv'])
  assert.equal(calls.length, 2)
})
