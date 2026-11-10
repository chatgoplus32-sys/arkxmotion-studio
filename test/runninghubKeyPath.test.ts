// ─── Jalur API token RunningHub ─────────────────────────────────────────────
//
// Bug yang dijaga:
//  1. Cek saldo yang gagal karena gangguan upstream (HTML 502 / timeout)
//     menandai key invalid — key sehat mati permanen dan provider RunningHub
//     tidak bisa dipakai lagi sampai user paste ulang.
//  2. Key yang ditempel sebagai "Bearer …" / header apiKey: … / cURL ditolak.
//  3. Kode 806 (APIKEY_USER_NOT_FOUND) tampil mentah tanpa petunjuk.
import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import runninghubRoutes from '../server/routes/publicRunninghub.js'
import {
  parseRunningHubApiKeyInput,
  normalizeRunningHubApiKey,
} from '../src/lib/runninghub.js'

const originalFetch = globalThis.fetch

// Mode jalur lama: tes-tes di bawah menguji kredensial PER-PENGGUNA (API key),
// jadi token global RunningHub dimatikan selama suite berjalan. Env dibaca per
// request, jadi aman di-set di before() dan dikembalikan di after().
const savedAccessTokenEnv = process.env.RUNNINGHUB_ACCESS_TOKEN

/** JWT palsu dengan exp yang bisa diatur — untuk menguji jalur akses token. */
function fakeJwt(expSec: number): string {
  const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${b64url({ alg: 'HS512', typ: 'JWT' })}.${b64url({ sub: 'uji', exp: expSec })}.tanda-tangan-palsu`
}

let upstream: (url?: string, init?: any) => Response = () => new Response('{}', { status: 200 })
let bodiesSeen: any[] = []
let urlsSeen: string[] = []

const app = express()
app.use(express.json({ limit: '50mb' }))
app.use('/api/public/runninghub', runninghubRoutes)

let server: ReturnType<typeof app.listen>
let base = ''

before(async () => {
  // Suite ini menguji mode key per-pengguna — matikan token global dulu.
  process.env.RUNNINGHUB_ACCESS_TOKEN = ''
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  globalThis.fetch = (async (_url: any, init?: any) => {
    urlsSeen.push(String(_url))
    try { bodiesSeen.push(init?.body ? JSON.parse(init.body) : null) } catch { bodiesSeen.push(init?.body) }
    return upstream(String(_url), init)
  }) as any
})

beforeEach(() => {
  bodiesSeen = []
  urlsSeen = []
})

after(() => {
  if (savedAccessTokenEnv === undefined) delete process.env.RUNNINGHUB_ACCESS_TOKEN
  else process.env.RUNNINGHUB_ACCESS_TOKEN = savedAccessTokenEnv
  globalThis.fetch = originalFetch
  server?.close()
})

async function checkBalance(apiKey: string) {
  // Pakai fetch asli: globalThis.fetch sudah di-stub untuk upstream RunningHub.
  const res = await originalFetch(`${base}/api/public/runninghub`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'check-balance', apiKey }),
  })
  return res.json()
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

// ── Parser tempelan key ────────────────────────────────────────────────────

test('key mentah 32 hex diterima apa adanya', () => {
  const k = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  assert.equal(parseRunningHubApiKeyInput(k), k)
})

test('prefix Bearer, kutip, dan bullet dibersihkan', () => {
  assert.equal(normalizeRunningHubApiKey('  "Bearer  abc123def456 "  '), 'abc123def456')
  assert.equal(parseRunningHubApiKeyInput('• Bearer abc123def456'), 'abc123def456')
})

test('header dump apiKey: … / x-api-key: … diambil nilainya', () => {
  assert.equal(parseRunningHubApiKeyInput('apiKey: abc123def456'), 'abc123def456')
  assert.equal(parseRunningHubApiKeyInput(`-H "x-api-key: abc123def456"`), 'abc123def456')
})

test('JSON { apiKey } dan cURL multi-baris dibaca sebagai satu key', () => {
  assert.equal(parseRunningHubApiKeyInput('{"apiKey":"abc123def456"}'), 'abc123def456')
  const curl = `curl -X POST https://www.runninghub.ai/uc/openapi/accountStatus \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer abc123def456"`
  assert.equal(parseRunningHubApiKeyInput(curl), 'abc123def456')
})

test('URL dan cookie bukan key — ditolak, bukan ditebak', () => {
  assert.equal(parseRunningHubApiKeyInput('https://www.runninghub.ai/call-api'), '')
  assert.equal(parseRunningHubApiKeyInput('Cookie: sid=abc; token=def'), '')
})

// ── Cek saldo ──────────────────────────────────────────────────────────────

test('code 0 + remainCoins → valid, saldo terbaca, tipe key dilabeli', async () => {
  upstream = () => json({ code: 0, msg: 'SUCCESS', data: { remainCoins: '12.5', apiType: 'consumer' } })
  const out = await checkBalance('a1b2c3d4e5f60718293a4b5c6d7e8f90')
  assert.equal(out.ok, true)
  assert.equal(out.balance, 12.5)
  assert.equal(out.keyType, 'Consumer-Member')
})

test('code 0 tanpa remainCoins → pakai field saldo lain', async () => {
  upstream = () => json({ code: 0, data: { coins: 4 } })
  const out = await checkBalance('a1b2c3d4e5f60718293a4b5c6d7e8f90')
  assert.equal(out.ok, true)
  assert.equal(out.balance, 4)
})

test('806 APIKEY_USER_NOT_FOUND → invalidKey, pesan berpetunjuk', async () => {
  upstream = () => json({ code: 806, msg: 'APIKEY_USER_NOT_FOUND', data: null })
  const out = await checkBalance('a1b2c3d4e5f60718293a4b5c6d7e8f90')
  assert.equal(out.ok, false)
  assert.equal(out.invalidKey, true)
  assert.equal(out.transient, false)
  assert.match(out.error, /tidak dikenali/i)
  assert.match(out.error, /runninghub\.ai/i)
})

test('HTML 502 dari nginx → transient, key TIDAK ditandai invalid', async () => {
  upstream = () => new Response('<html><body>502 Bad Gateway</body></html>', {
    status: 502,
    headers: { 'Content-Type': 'text/html' },
  })
  const out = await checkBalance('a1b2c3d4e5f60718293a4b5c6d7e8f90')
  assert.equal(out.ok, false)
  assert.equal(out.invalidKey, false)
  assert.equal(out.transient, true)
})

test('balasan JSON tanpa code (maintenance) → transient', async () => {
  upstream = () => json({ data: null, msg: 'maintenance' })
  const out = await checkBalance('a1b2c3d4e5f60718293a4b5c6d7e8f90')
  assert.equal(out.invalidKey, false)
  assert.equal(out.transient, true)
})

test('key kotor "Bearer …" dibersihkan sebelum dikirim ke upstream', async () => {
  upstream = () => json({ code: 0, data: { remainCoins: 1 } })
  await checkBalance('Bearer a1b2c3d4e5f60718293a4b5c6d7e8f90')
  // check-balance mengirim apiKey di body accountStatus
  assert.equal(bodiesSeen[0]?.apiKey, 'a1b2c3d4e5f60718293a4b5c6d7e8f90')
})

// ── Akses token (perubahan auth RunningHub) ─────────────────────────────────
//
// RunningHub kini memakai access token (JWT). Server memegang token global
// (RUNNINGHUB_ACCESS_TOKEN) dan menggunakannya untuk SEMUA request upstream,
// kecuali pengguna mengirim akses token miliknya sendiri yang masih berlaku.

const FUTURE = () => Math.floor(Date.now() / 1000) + 3600

test('token global (env) menggantikan API key lama dari client', async () => {
  const token = fakeJwt(FUTURE())
  process.env.RUNNINGHUB_ACCESS_TOKEN = token
  try {
    upstream = () => json({ code: 0, data: { remainCoins: 3 } })
    const out = await checkBalance('a1b2c3d4e5f60718293a4b5c6d7e8f90')
    assert.equal(out.ok, true)
    assert.equal(out.balance, 3)
    assert.equal(bodiesSeen[0]?.apiKey, token)
    assert.equal(bodiesSeen[0]?.accessToken, token)
  } finally {
    process.env.RUNNINGHUB_ACCESS_TOKEN = ''
  }
})

test('access token pengguna (JWT berlaku) tidak diganti token global', async () => {
  const userToken = fakeJwt(FUTURE())
  const globalToken = fakeJwt(FUTURE() + 600)
  process.env.RUNNINGHUB_ACCESS_TOKEN = globalToken
  try {
    upstream = () => json({ code: 0, data: { remainCoins: 7 } })
    const out = await checkBalance(userToken)
    assert.equal(out.ok, true)
    assert.equal(bodiesSeen[0]?.apiKey, userToken)
  } finally {
    process.env.RUNNINGHUB_ACCESS_TOKEN = ''
  }
})

test('access token kedaluwarsa → ditolak dengan pesan jelas, upstream tidak dipanggil', async () => {
  upstream = () => json({ code: 0, data: { remainCoins: 1 } })
  const out = await checkBalance(fakeJwt(Math.floor(Date.now() / 1000) - 60))
  assert.equal(out.ok, false)
  assert.match(out.error, /kedaluwarsa/i)
  assert.equal(bodiesSeen.length, 0, 'request upstream tidak boleh terkirim')
})

test('placeholder server-managed tanpa token global → pesan konfigurasi, upstream tidak dipanggil', async () => {
  upstream = () => json({ code: 0, data: { remainCoins: 1 } })
  const out = await checkBalance('server-managed')
  assert.equal(out.ok, false)
  assert.match(out.error, /RUNNINGHUB_ACCESS_TOKEN/)
  assert.equal(bodiesSeen.length, 0, 'request upstream tidak boleh terkirim')
})

test('accountStatus menolak akses token → tetap dilaporkan aktif (bukan key invalid)', async () => {
  // Token global dimatikan supaya JWT client yang dipakai; accountStatus lama
  // memang hanya menerima API key sehingga menolak JWT dengan 806.
  upstream = () => json({ code: 806, msg: 'APIKEY_USER_NOT_FOUND', data: null })
  const out = await checkBalance(fakeJwt(FUTURE()))
  assert.equal(out.ok, true)
  assert.equal(out.isValidUser, true)
  assert.equal(out.balance, null)
  assert.match(out.keyType, /Access Token/)
})

// ── Jalur akses token (JWT): upload & submit lewat situs RunningHub ─────────
//
// OpenAPI RunningHub (/openapi/v2/*) menolak JWT ("ApiKey verification failed").
// Untuk sesi JWT relay memakai dua jalur resmi situsnya:
//   * submit/query → /api/playground/openapi/v2/*?apiKeyId=<id key milik akun>
//   * upload media → /upload/image + accessKey (/api/instance/access/auth)

const RH_KID = '2119296871366062081'
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function postRunninghub(body: unknown) {
  const res = await originalFetch(`${base}/api/public/runninghub`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

test('query dengan akses token diteruskan ke jalur playground + apiKeyId milik akun', async () => {
  upstream = (url) => {
    if (url?.includes('/api/key/list')) {
      return json({
        code: 0,
        data: [
          { apiKeyId: '111111', key: null, isSystemAuto: true },
          { apiKeyId: RH_KID, key: 'ccfa****c4a7', isSystemAuto: false },
        ],
      })
    }
    return json({ code: 0, data: { taskId: '1', status: '', errorCode: '1004', errorMessage: 'Task not found', results: null } })
  }

  const out = await postRunninghub({ action: 'query', apiKey: fakeJwt(FUTURE()), taskId: '1' })
  assert.equal(out.ok, true, JSON.stringify(out))

  const listUrl = urlsSeen.find((u) => u.includes('/api/key/list'))
  const queryUrl = urlsSeen.find((u) => u.includes('/api/playground/openapi/v2/query'))
  assert.ok(listUrl, 'apiKeyId diambil lewat /api/key/list dengan sesi JWT: ' + JSON.stringify(urlsSeen))
  assert.ok(queryUrl, 'query harus lewat jalur playground: ' + JSON.stringify(urlsSeen))
  assert.ok(queryUrl!.endsWith(`/api/playground/openapi/v2/query?apiKeyId=${RH_KID}`), queryUrl)
  // key sistem-auto (1303) tidak boleh dipakai
  assert.notEqual(queryUrl!.includes('111111'), true)
})

test('API key lama tetap memakai jalur OpenAPI lama (tanpa playground)', async () => {
  upstream = () => json({ code: 0, data: { taskId: '7', status: 'RUNNING', results: null } })
  const out = await postRunninghub({ action: 'query', apiKey: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', taskId: '7' })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.deepEqual(urlsSeen, ['https://www.runninghub.ai/openapi/v2/query'], JSON.stringify(urlsSeen))
})

test('motion-control dengan akses token: upload via sesi, submit via playground', async () => {
  const accessKey = Buffer.from(JSON.stringify({ userId: 'uji-user', sign: 'x' })).toString('base64')
  upstream = (url) => {
    if (url?.includes('/api/instance/access/auth')) return json({ code: 0, data: { accessKey } })
    if (url?.includes('/upload/image')) return json({ name: 'hashimg.png', subfolder: '', type: 'input' })
    if (url?.includes('/api/key/list')) {
      return json({ code: 0, data: [{ apiKeyId: RH_KID, key: 'ccfa****c4a7', isSystemAuto: false }] })
    }
    if (url?.includes('/run/ai-app/')) return json({ code: 0, data: { taskId: '999', status: 'QUEUED' } })
    return json({})
  }

  const out = await postRunninghub({
    action: 'motion-control',
    apiKey: fakeJwt(FUTURE()),
    imageBase64: PNG_1PX,
    imageFileName: 'motion.jpg',
    imageMimeType: 'image/jpeg',
    videoBase64: PNG_1PX,
    videoFileName: 'motion.mp4',
    videoMimeType: 'video/mp4',
  })

  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.data?.taskId, '999')
  assert.ok(urlsSeen.some((u) => u.endsWith('/api/instance/access/auth')), JSON.stringify(urlsSeen))
  assert.ok(urlsSeen.filter((u) => u.endsWith('/upload/image')).length === 2, 'image + video: ' + JSON.stringify(urlsSeen))
  assert.ok(urlsSeen.some((u) => u.includes('/api/playground/openapi/v2/run/ai-app/')), JSON.stringify(urlsSeen))
  assert.ok(urlsSeen.some((u) => u.includes(`apiKeyId=${RH_KID}`)), JSON.stringify(urlsSeen))
  // OpenAPI telanjang tidak boleh dipanggil dengan JWT
  assert.ok(!urlsSeen.some((u) => u.includes('://www.runninghub.ai/openapi/v2/')), JSON.stringify(urlsSeen))
})

test('balasan playground tanpa taskId tapi bawa errorCode → pesan sebabnya, bukan No taskId', async () => {
  const accessKey = Buffer.from(JSON.stringify({ userId: 'uji-user', sign: 'x' })).toString('base64')
  upstream = (url) => {
    if (url?.includes('/api/instance/access/auth')) return json({ code: 0, data: { accessKey } })
    if (url?.includes('/upload/image')) return json({ name: 'hash.png', subfolder: '', type: 'input' })
    if (url?.includes('/run/ai-app/')) {
      return json({
        code: 0,
        msg: 'success',
        data: {
          taskId: '',
          status: '',
          errorCode: '605',
          errorMessage: 'Your balance is insufficient. Please top up your account.',
        },
      })
    }
    return json({ code: 0, data: [{ apiKeyId: RH_KID, key: 'ccfa****c4a7', isSystemAuto: false }] })
  }

  const out = await postRunninghub({
    action: 'motion-control',
    apiKey: fakeJwt(FUTURE()),
    imageBase64: PNG_1PX,
    videoBase64: PNG_1PX,
  })

  assert.equal(out.ok, false, JSON.stringify(out))
  assert.notEqual(out.error, 'No taskId returned')
  assert.match(String(out.error), /saldo|top up/i)
})
