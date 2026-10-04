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
import { NEXABOT_PROXY_POLICY } from '../shared/nexabotProxy.js'

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
    () => jsonResponse({ ok: true, credit: 4.75, credit_cost: 0.15 }),
  )

  const res = await get('/api/public/nexabot/credit', { 'X-Api-Key': 'nxb_test' })

  assert.equal(res.status, 200)
  assert.equal(res.body.credit, 4.75)
  assert.equal(calls.length, 2, 'percobaan kedua dijalankan proxy, bukan klien')
})

test('/credit: upstream benar-benar mati → 504 dengan pesan yang menyebut jenis request & percobaan', async () => {
  const policy = NEXABOT_PROXY_POLICY.credit
  for (let i = 0; i < policy.attempts + 2; i++) queue.push(() => { throw timeoutError() })

  const res = await get('/api/public/nexabot/credit', { 'X-Api-Key': 'nxb_test' })

  assert.equal(res.status, 504)
  assert.match(res.body.error, /cek saldo/)
  // Angka di pesan mengikuti policy, bukan ditulis tangan: policy-nya memang
  // perlu bisa disetel tanpa membuat test berbohong.
  assert.match(res.body.error, new RegExp(`${policy.attempts}×${Math.round(policy.timeoutMs / 1000)}s`))
  assert.equal(calls.length, policy.attempts, `berhenti setelah ${policy.attempts} percobaan`)
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

test('/generate: resolution diteruskan ke upstream', async () => {
  let sentBody = ''
  const prevFetch = globalThis.fetch
  globalThis.fetch = (async (_input: any, init?: any) => {
    sentBody = String(init?.body ?? '')
    return jsonResponse({ ok: true, job_id: 'job-res', status: 'queued' })
  }) as typeof fetch
  try {
    const res = await post('/api/public/nexabot/generate', { mode: 't2v', prompt: 'drone shot', resolution: 1080 }, { 'X-Nexabot-Cookie': 'session=abc' })
    assert.equal(res.status, 200)
    assert.equal(JSON.parse(sentBody).resolution, 1080)
  } finally {
    globalThis.fetch = prevFetch
  }
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

// Insiden nyata: submit menggantung ~61s lalu koneksi ke nexabot.id putus
// (undici: TypeError "fetch failed"). Pesannya harus menyebut penyebab asli dan
// TIDAK menyarankan mengulang begitu saja — job bisa sudah terbentuk di sana.
test('/submit: koneksi upstream putus → 502 yang menjelaskan risikonya', async () => {
  const cause: any = new Error('socket hang up')
  cause.code = 'ECONNRESET'
  const netError: any = new TypeError('fetch failed')
  netError.cause = cause
  queue.push(() => { throw netError })

  const res = await post('/api/public/nexabot/submit', { mode: 'sfv', prompt: 'animasikan' }, { 'X-Api-Key': 'nxb_test' })

  assert.equal(res.status, 502)
  assert.equal(calls.length, 1, 'submit tetap sekali jalan (tidak pernah diulang)')
  assert.match(res.body.error, /submit ke NexaBot/)
  assert.match(res.body.error, /ECONNRESET/, 'penyebab asli ikut terbaca')
  assert.match(res.body.error, /MUNGKIN sudah terbentuk/, 'jangan menyuruh retry buta')
})


// ── GPT Image 2.5 (nexabot.id/gpt-image) ─────────────────────────────────────
// POST sekali jalan: job & 0,1 cr tidak boleh ganda. GET status read-only.

test('/gpt-image: hasil upstream diteruskan apa adanya', async () => {
  queue.push(() => jsonResponse({ ok: true, id: 'gptjob-123' }))
  const res = await post('/api/public/nexabot/gpt-image', { prompt: 'kucing astronot', aspect: 2, references: [] }, { 'X-Api-Key': 'nxb_test' })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.id, 'gptjob-123')
  assert.equal(calls.length, 1)
  assert.match(calls[0], /\/api\/v1\/gpt-image$/)
})

test('/gpt-image: timeout TIDAK diulang (job & kredit tidak ganda)', async () => {
  queue.push(() => { throw timeoutError() })
  const res = await post('/api/public/nexabot/gpt-image', { prompt: 'x', aspect: 1 }, { 'X-Api-Key': 'nxb_test' })
  assert.equal(calls.length, 1, 'gpt-image tetap sekali jalan')
  assert.match(res.body.error, /generate GPT Image/)
})

test('/gpt-image: tanpa kredensial → 400 jelas', async () => {
  const res = await post('/api/public/nexabot/gpt-image', { prompt: 'x' })
  assert.equal(res.status, 400)
  assert.match(res.body.error, /X-Api-Key/)
  assert.equal(calls.length, 0, 'upstream tidak pernah dipanggil')
})

test('/gpt-image: 429 upstream diteruskan tanpa membuat job', async () => {
  queue.push(() => jsonResponse({ ok: false, error: 'rate limited' }, 429, { 'Retry-After': '7' }))
  const res = await post('/api/public/nexabot/gpt-image', { prompt: 'x' }, { 'X-Api-Key': 'nxb_test' })
  assert.equal(res.status, 429)
  assert.equal(calls.length, 1, '429 tidak diulang di proxy')
})

test('/gpt-image/:id: status job diteruskan', async () => {
  queue.push(() => jsonResponse({ ok: true, job: { status: 'completed', images: [{ url: 'https://cdn.example/x.png' }] } }))
  const res = await get('/api/public/nexabot/gpt-image/gptjob-123', { 'X-Api-Key': 'nxb_test' })
  assert.equal(res.status, 200)
  assert.equal(res.body.job.status, 'completed')
  assert.match(calls[0], /\/api\/v1\/gpt-image\/gptjob-123$/)
})


test('/gpt-image/:id/download: header auth diteruskan, gambar di-stream', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
  queue.push(() => new Response(png, { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': '4' } }))
  const res = await originalFetch(`${base}/api/public/nexabot/gpt-image/gptjob-1/download?index=0`, { headers: { 'X-Api-Key': 'nxb_test' } })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/png')
  const buf = new Uint8Array(await res.arrayBuffer())
  assert.deepEqual(Array.from(buf), Array.from(png), 'byte gambar diteruskan utuh')
  assert.match(calls[0], /\/api\/v1\/gpt-image\/gptjob-1\/download\?index=0/)
})

test('/gpt-image/:id/download: tanpa kredensial → 400 tanpa memanggil upstream', async () => {
  const res = await originalFetch(`${base}/api/public/nexabot/gpt-image/gpt-job/download`)
  assert.equal(res.status, 400)
  assert.equal(calls.length, 0)
})

test('/gpt-image/:id/download: ?download=1 → attachment', async () => {
  queue.push(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/png' } }))
  const res = await originalFetch(`${base}/api/public/nexabot/gpt-image/abc/download?index=0&download=1`, { headers: { 'X-Api-Key': 'nxb_test' } })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-disposition') || '', /attachment; filename="nexabot-gpt-image-abc\.png"/)
})
