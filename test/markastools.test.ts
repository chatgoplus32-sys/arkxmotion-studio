// ─── Test lib MarkasTools (fetch di-stub) ───────────────────────────────────
// Mengunci kontrak request yang dibangun klien ARKXMotion terhadap hasil
// reverse engineering ai.markastools.id:
//   POST /api/runninghub/accounts  {name, api_key}  (api_key = token MF-…)
//   POST /api/order/upload         FormData "file"  → {url}
//   POST /api/order/generate       JSON order       → {job?.id}
//   GET  /api/poll                 → {jobs: [...]}
import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  addMarkastoolsAccount,
  checkMarkastoolsSession,
  findMarkasResultUrls,
  parseMarkastoolsCookieInput,
  submitMarkasOrder,
  uploadMarkasMedia,
} from '../src/lib/markastools.js'

const originalFetch = globalThis.fetch
const COOKIE = 'session=abc'

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

let calls: string[] = []
let bodies: any[] = []

beforeEach(() => {
  calls = []
  bodies = []
  globalThis.fetch = (async (input: any, init?: any) => {
    calls.push(String(input))
    bodies.push(init?.body ? String(init.body) : null)
    return jsonResponse({ ok: true })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('checkMarkastoolsSession: cookie kosong → error lokal tanpa fetch', async () => {
  const r = await checkMarkastoolsSession('   ')
  assert.equal(r.ok, false)
  assert.equal(calls.length, 0)
})

test('checkMarkastoolsSession: GET /api/me dengan header X-Markastools-Cookie', async () => {
  globalThis.fetch = (async (input: any, init?: any) => {
    calls.push(String(input))
    assert.equal((init?.headers as Record<string, string>)['X-Markastools-Cookie'], COOKIE)
    return jsonResponse({ ok: true, user: { id: 7, name: 'Budi', email: 'budi@example.id' } })
  }) as typeof fetch

  const r = await checkMarkastoolsSession(COOKIE)
  assert.equal(r.ok, true)
  assert.equal(r.user.email, 'budi@example.id')
  assert.equal(calls[0], '/api/public/markastools/api/me')
})

test('addMarkastoolsAccount: POST /api/runninghub/accounts {name, api_key}', async () => {
  globalThis.fetch = (async (input: any, init?: any) => {
    calls.push(String(input))
    bodies.push(init?.body ? String(init.body) : null)
    return jsonResponse({ ok: true, account: { id: 3, name: 'markasflow-v2' } })
  }) as typeof fetch

  const r = await addMarkastoolsAccount('markasflow-v2', 'MF-TESTTOKEN00000000000000000', COOKIE)
  assert.equal(r.ok, true)
  assert.equal(calls[0], '/api/public/markastools/api/runninghub/accounts')
  assert.deepEqual(JSON.parse(bodies[0]), { name: 'markasflow-v2', api_key: 'MF-TESTTOKEN00000000000000000' })
})

test('addMarkastoolsAccount: token kosong → error lokal tanpa fetch', async () => {
  const r = await addMarkastoolsAccount('markasflow-v2', '  ', COOKIE)
  assert.equal(r.ok, false)
  assert.equal(calls.length, 0)
})

test('submitMarkasOrder: POST /api/order/generate dengan field lengkap', async () => {
  globalThis.fetch = (async (input: any, init?: any) => {
    calls.push(String(input))
    bodies.push(init?.body ? String(init.body) : null)
    return jsonResponse({ ok: true, job: { id: 'job-42' } })
  }) as typeof fetch

  const r = await submitMarkasOrder({
    model: 'MarkasFlow Motion HD',
    server: 0,
    imageUrl: 'https://cdn/x.jpg',
    imageUrls: ['https://cdn/x.jpg'],
    videoUrl: 'https://cdn/ref.mp4',
    prompt: 'dance',
    orientation: 'video',
    rasio: '9:16',
    keepSound: true,
  }, COOKIE)

  assert.equal(r.ok, true)
  assert.equal(r.jobId, 'job-42')
  assert.equal(calls[0], '/api/public/markastools/api/order/generate')
  const body = JSON.parse(bodies[0])
  assert.equal(body.model, 'MarkasFlow Motion HD')
  assert.equal(body.image_url, 'https://cdn/x.jpg')
  assert.equal(body.keep_sound, true)
  assert.equal(body.orientation, 'video')
})

test('uploadMarkasMedia: upload-ticket lalu (server) upload → {url}', async () => {
  const urls: string[] = []
  globalThis.fetch = (async (input: any) => {
    urls.push(String(input))
    return jsonResponse({ ok: true, url: 'https://pool/media-1.jpg' })
  }) as typeof fetch

  const url = await uploadMarkasMedia(new File(['img'], 'x.jpg', { type: 'image/jpeg' }), COOKIE)
  assert.equal(url, 'https://pool/media-1.jpg')
  // Alur 2 panggilan: dulu minta tiket unggah, lalu unggah lewat server.
  assert.deepEqual(urls, [
    '/api/public/markastools/api/order/upload-ticket',
    '/api/public/markastools/api/order/upload',
  ])
})

test('uploadMarkasMedia: mode client (ticket.upload_url) unggah langsung ke CDN', async () => {
  const calls: Array<{ url: string; init?: any }> = []
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.endsWith('/api/order/upload-ticket')) {
      return jsonResponse({ ok: true, upload_url: 'https://pool.cdn/upload', access_token: 'tok-1', recipe_id: 'rec-7' })
    }
    return jsonResponse({ ok: true, url: 'https://pool/direct.jpg' })
  }) as typeof fetch

  const url = await uploadMarkasMedia(new File(['img'], 'x.jpg', { type: 'image/jpeg' }), COOKIE)
  assert.equal(url, 'https://pool/direct.jpg')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url, 'https://pool.cdn/upload')
  const headers = (calls[1].init?.headers || {}) as Record<string, string>
  assert.equal(headers.Authorization, 'Bearer tok-1')
  assert.equal(headers['x-app-recipeid'], 'rec-7')
})

test('findMarkasResultUrls: menggali URL hasil di payload job', () => {
  const job = {
    id: 'job-42',
    status: 'COMPLETED',
    output: { video_url: 'https://cdn/hasil.mp4' },
    result: { url: 'https://cdn/hasil.mp4' },
  }
  const assets = findMarkasResultUrls(job)
  assert.ok(assets.length >= 2)
  const video = assets.find((a) => a.path === 'output.video_url')
  assert.equal(video?.url, 'https://cdn/hasil.mp4')
})

test('parseMarkastoolsCookieInput: menerima header Cookie & cURL', () => {
  assert.equal(parseMarkastoolsCookieInput('Cookie: session=abc; x=1'), 'session=abc; x=1')
  assert.equal(
    parseMarkastoolsCookieInput(`curl 'https://ai.markastools.id/api/me' -H 'cookie: session=xyz'`),
    'session=xyz',
  )
})
