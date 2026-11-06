// ─── Test relay MarkasTools lokal (Express) lewat HTTP sungguhan ────────────
// Relay meneruskan cookie session (header X-Markastools-Cookie) ke upstream
// ai.markastools.id sebagai header `Cookie`, dan body diteruskan apa adanya
// (JSON maupun multipart) — persis pola X-Nexabot-Cookie untuk NexaBot.
// Upstream di-stub lewat globalThis.fetch.
import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import markastoolsRoutes from '../server/routes/markastools.js'

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

let calls: string[] = []
let headersSeen: any[] = []
let bodies: any[] = []
let queue: Array<() => Response> = []

const app = express()
// Relay HARUS terdaftar sebelum express.json() supaya body mentah
// (terutama multipart upload) tidak dipotong parser — sama seperti di
// server/index.ts.
app.use('/api/public/markastools', markastoolsRoutes)
app.use(express.json({ limit: '50mb' }))

let server: ReturnType<typeof app.listen>
let base = ''

before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

beforeEach(() => {
  calls = []
  headersSeen = []
  bodies = []
  queue = []
  globalThis.fetch = (async (input: any, init?: any) => {
    calls.push(String(input))
    headersSeen.push(init?.headers || {})
    // Body bisa string (JSON manual) atau Blob (hasil baca stream) — normalisasi ke teks.
    bodies.push(init?.body ? (typeof init.body === 'string' ? init.body : await init.body.text ? await init.body.text() : String(init.body)) : null)
    const next = queue.shift()
    if (!next) throw new Error(`fetch dipanggil ke-${calls.length} tanpa langkah berikutnya`)
    return next()
  }) as typeof fetch
})

after(async () => {
  globalThis.fetch = originalFetch
  await new Promise((resolve) => server.close(resolve))
})

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

test('tanpa cookie → 400 tanpa memanggil upstream', async () => {
  const res = await get('/api/public/markastools/api/me')
  assert.equal(res.status, 400)
  assert.match(res.body.error, /X-Markastools-Cookie/)
  assert.equal(calls.length, 0)
})

test('/api/me: cookie diteruskan sebagai header Cookie upstream', async () => {
  queue.push(() => jsonResponse({ ok: true, user: { id: 7, name: 'Budi', email: 'budi@example.id' } }))

  const res = await get('/api/public/markastools/api/me', { 'X-Markastools-Cookie': 'session=abc' })

  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(calls[0], 'https://ai.markastools.id/api/me')
  assert.equal(headersSeen[0]['Cookie'], 'session=abc')
})

test('/api/runninghub/accounts: body JSON diteruskan apa adanya (tambah akun MF-)', async () => {
  queue.push(() => jsonResponse({ ok: true, account: { id: 3, name: 'markasflow-v2' } }))

  const res = await post(
    '/api/public/markastools/api/runninghub/accounts',
    { name: 'markasflow-v2', api_key: 'MF-RKN3GXAWDVB5LTFX838HQR4' },
    { 'X-Markastools-Cookie': 'session=abc' },
  )

  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(calls[0], 'https://ai.markastools.id/api/runninghub/accounts')
  assert.equal(headersSeen[0]['Cookie'], 'session=abc')
  assert.deepEqual(JSON.parse(bodies[0]), { name: 'markasflow-v2', api_key: 'MF-RKN3GXAWDVB5LTFX838HQR4' })
})

test('/api/order/generate: status & body upstream diteruskan ke klien', async () => {
  queue.push(() => jsonResponse({ ok: false, error: 'ACTIVATION_REQUIRED' }, 403))

  const res = await post(
    '/api/public/markastools/api/order/generate',
    { model: 'MarkasFlow Motion HD', server: 0, image_url: 'https://cdn/x.jpg' },
    { 'X-Markastools-Cookie': 'session=abc' },
  )

  assert.equal(res.status, 403)
  assert.equal(res.body.code, undefined)
  assert.match(res.body.error, /ACTIVATION_REQUIRED/)
})

test('/api/poll: 504 upstream diteruskan apa adanya (read-only client yang menunggu)', async () => {
  queue.push(() => jsonResponse({ ok: false, error: 'Server sedang sibuk' }, 504))

  const res = await get('/api/public/markastools/api/poll', { 'X-Markastools-Cookie': 'session=abc' })

  assert.equal(res.status, 504)
  assert.equal(calls.length, 1)
})
