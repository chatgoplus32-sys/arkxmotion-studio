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
  formatRhWalletCompact,
  formatRhWalletDetail,
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
let authSeen: string[] = []

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
    authSeen.push(String(init?.headers?.Authorization || init?.headers?.authorization || ''))
    try { bodiesSeen.push(init?.body ? JSON.parse(init.body) : null) } catch { bodiesSeen.push(init?.body) }
    return upstream(String(_url), init)
  }) as any
})

beforeEach(() => {
  bodiesSeen = []
  urlsSeen = []
  authSeen = []
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
  // memang hanya menerima API key sehingga menolak JWT dengan 806. Bukti token
  // masih hidup diambil dari /api/welfare/summary.
  upstream = (url) => String(url).includes('/api/welfare/summary')
    ? json({
        code: 0,
        data: {
          dailyGift: { amount: 5 },
          freeVideo: { total: 2, used: 1, remaining: 1, modelNames: ['M'] },
          freeImage: null,
          freePeriod: { endTime: '2026-12-01T00:00:00Z' },
        },
      })
    : json({ code: 806, msg: 'APIKEY_USER_NOT_FOUND', data: null })
  const out = await checkBalance(fakeJwt(FUTURE() + 1234))
  assert.equal(out.ok, true)
  assert.equal(out.isValidUser, true)
  assert.equal(out.balance, null)
  assert.match(out.keyType, /Access Token/)
  assert.equal(out.tokenWallet?.freeVideo?.remaining, 1)
})

test('akses token dicabut (412) → dilaporkan invalid, bukan "aktif"', async () => {
  upstream = (url) => String(url).includes('/api/welfare/summary')
    ? json({ code: 412, msg: 'TOKEN_INVALID', data: null })
    : json({ code: 806, msg: 'APIKEY_USER_NOT_FOUND', data: null })
  const out = await checkBalance(fakeJwt(FUTURE() + 4321))
  assert.equal(out.ok, false)
  assert.equal(out.invalidKey, true)
  assert.equal(out.isValidUser, false)
  assert.match(out.error, /sesi login/i)
  assert.match(out.error, /tidak berlaku/i)
})

test('token pengguna dicabut → generate memakai token server', async () => {
  const userToken = fakeJwt(FUTURE() + 777)
  const globalToken = fakeJwt(FUTURE() + 999)
  process.env.RUNNINGHUB_ACCESS_TOKEN = globalToken
  try {
    upstream = (url) => {
      const u = String(url)
      if (u.includes('/api/welfare/summary')) return json({ code: 412, msg: 'TOKEN_INVALID', data: null })
      if (u.includes('/api/key/list')) return json({ code: 0, data: [{ apiKeyId: '222', key: 'x', isSystemAuto: false }] })
      return json({ code: 0, data: { taskId: '1', status: '', errorCode: '1004', errorMessage: 'Task not found', results: null } })
    }
    const out = await postRunninghub({ action: 'query', apiKey: userToken, taskId: '1' })
    assert.equal(out.ok, true, JSON.stringify(out))
    assert.ok(
      authSeen.some((h) => h === `Bearer ${globalToken}`),
      'request upstream harus memakai token server setelah token pengguna ditolak 412',
    )
  } finally {
    process.env.RUNNINGHUB_ACCESS_TOKEN = ''
  }
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

test('motion-control dengan akses token: upload via sesi, submit via /task/webapp/create (RH Coin)', async () => {
  const accessKey = Buffer.from(JSON.stringify({ userId: 'uji-user', sign: 'x' })).toString('base64')
  upstream = (url) => {
    if (url?.includes('/api/instance/access/auth')) return json({ code: 0, data: { accessKey } })
    if (url?.includes('/upload/image')) return json({ name: 'hashimg.png', subfolder: '', type: 'input' })
    if (url?.includes('/task/webapp/create')) {
      return json({ code: 0, msg: 'success', data: { taskId: '999', clientId: 'c-1', taskStatus: 'QUEUED' } })
    }
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

  // Jalur web situs: menagih RH Coin akun, bukan wallet USD playground.
  const submitUrl = urlsSeen.find((u) => u.endsWith('/task/webapp/create'))
  assert.ok(submitUrl, 'submit harus lewat /task/webapp/create: ' + JSON.stringify(urlsSeen))
  const submitBody = bodiesSeen[urlsSeen.indexOf(submitUrl!)]
  assert.equal(submitBody?.webappId, '2092795737699856386')
  assert.ok(Array.isArray(submitBody?.inputs), 'inputs wajib ada: ' + JSON.stringify(submitBody))
  assert.equal(submitBody.inputs.length, 2)
  assert.deepEqual(submitBody.inputs.map((n: any) => n.nodeId).sort(), ['46', '47'])
  assert.ok(submitBody.inputs.every((n: any) => n.fieldValue), 'fieldValue harus terisi: ' + JSON.stringify(submitBody.inputs))

  // Jalur yang gagal (901) / menagih USD (playground) tidak boleh dipakai.
  assert.ok(!urlsSeen.some((u) => u.includes('/run/ai-app/')), JSON.stringify(urlsSeen))
  assert.ok(!urlsSeen.some((u) => u.includes('/api/playground/openapi/v2/run/')), JSON.stringify(urlsSeen))
})

test('submit jalur web ditolak (433 saldo RH Coin habis) → pesan sebabnya, bukan No taskId', async () => {
  const accessKey = Buffer.from(JSON.stringify({ userId: 'uji-user', sign: 'x' })).toString('base64')
  upstream = (url) => {
    if (url?.includes('/api/instance/access/auth')) return json({ code: 0, data: { accessKey } })
    if (url?.includes('/upload/image')) return json({ name: 'hash.png', subfolder: '', type: 'input' })
    if (url?.includes('/task/webapp/create')) {
      return json({ code: 433, msg: '余额不足', errorMessages: null, data: null })
    }
    return json({})
  }

  const out = await postRunninghub({
    action: 'motion-control',
    apiKey: fakeJwt(FUTURE()),
    imageBase64: PNG_1PX,
    videoBase64: PNG_1PX,
  })

  assert.equal(out.ok, false, JSON.stringify(out))
  assert.notEqual(out.error, 'No taskId returned')
  assert.match(String(out.error), /saldo|RH Coin/i)
})

// ── Ringkasan wallet untuk status / limit ─────────────────────────────────
// Cek Limit & Status RunningHub tidak menampilkan saldo karena access token
// tidak mengembalikan angka `balance`. Wallet (kredit video/image + poin)
// harus tetap tampil sebagai teks status.

test('wallet access token diformat untuk chip status dan baris detail', () => {  const wallet = {
    points: 30,
    pointsExpiresAt: null,
    freePeriodEnd: null,
    freeVideo: { total: 3, used: 1, remaining: 2, models: ['MInimax H3-RH Enhanced'] },
    freeImage: { total: 3, used: 0, remaining: 3, models: ['Nano Banana2-Low-Cost'] },
  }
  assert.equal(formatRhWalletCompact(wallet), 'V2/3 · I3/3 · 30 pt')
  assert.equal(
    formatRhWalletDetail(wallet),
    'kredit video 2/3 · kredit image 3/3 · poin harian 30',
  )
})

test('wallet tanpa kredit/poin tidak menghasilkan teks palsu', () => {
  assert.equal(formatRhWalletCompact(null), '')
  assert.equal(formatRhWalletDetail(null), '')
  assert.equal(
    formatRhWalletCompact({ points: null, pointsExpiresAt: null, freePeriodEnd: null, freeVideo: null, freeImage: null }),
    '',
  )
})

test('saldo poin yang jadi acuan — RH Coin tidak lagi ditampilkan', () => {
  const wallet = {
    coins: 145,
    pointsBalance: 0,
    points: null,
    pointsExpiresAt: null,
    freePeriodEnd: null,
    freeVideo: { total: 3, used: 0, remaining: 3, models: [] },
    freeImage: { total: 3, used: 0, remaining: 3, models: [] },
  }
  assert.equal(formatRhWalletCompact(wallet), '0 P · V3/3 · I3/3')
  assert.equal(
    formatRhWalletDetail(wallet),
    'saldo poin 0 · kredit video 3/3 · kredit image 3/3 · poin harian belum ada',
  )
})

test('RH Coin hanya jadi cadangan bila saldo poin tidak terbaca', () => {
  const wallet = {
    coins: 145,
    pointsBalance: null,
    points: null,
    pointsExpiresAt: null,
    freePeriodEnd: null,
    freeVideo: null,
    freeImage: null,
  }
  assert.equal(formatRhWalletCompact(wallet), '145 RC')
  assert.equal(formatRhWalletDetail(wallet), 'saldo koin 145')
})

test('cek saldo sesi JWT membaca RH Coin dari /uc/point/summary', async () => {
  upstream = (url) => {
    const u = String(url)
    if (u.includes('/uc/openapi/accountStatus')) {
      return json({ code: 0, msg: 'success', data: { apiType: 'consumer' } })
    }
    if (u.includes('/api/welfare/summary')) {
      return json({
        code: 0,
        data: {
          dailyGift: { amount: 0 },
          freeVideo: { total: 3, used: 0, remaining: 3, modelNames: [] },
          freeImage: null,
          freePeriod: null,
        },
      })
    }
    if (u.includes('/uc/point/summary')) {
      return json({ code: 0, data: { billingVersion: 'OLD', transitionCoinRemained: '145', balancePoint: 0 } })
    }
    return json({})
  }

  const out = await checkBalance(fakeJwt(FUTURE() + 555))
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.tokenWallet?.coins, 145)
  assert.equal(out.tokenWallet?.freeVideo?.remaining, 3)
  assert.match(String(out.message), /saldo poin 0/)
  assert.doesNotMatch(String(out.message), /RH Coin/)
})

test('billing baru: saldo poin ditampilkan walau RH Coin 0', async () => {
  // Kasus nyata akun RunningHub sekarang: transitionCoinRemained "0" karena
  // koin sudah dikonversi ke poin; yang dipotong saat generate adalah poin.
  upstream = (url) => {
    const u = String(url)
    if (u.includes('/uc/openapi/accountStatus')) {
      return json({ code: 0, msg: 'success', data: { apiType: 'consumer' } })
    }
    if (u.includes('/api/welfare/summary')) {
      return json({
        code: 0,
        data: {
          dailyGift: { amount: 30 },
          freeVideo: { total: 3, used: 0, remaining: 3, modelNames: [] },
          freeImage: { total: 3, used: 0, remaining: 3, modelNames: [] },
          freePeriod: null,
        },
      })
    }
    if (u.includes('/uc/point/summary')) {
      return json({
        code: 0,
        data: { billingVersion: 'NEW', transitionCoinRemained: '0', balancePoint: -58.511 },
      })
    }
    return json({})
  }

  const out = await checkBalance(fakeJwt(FUTURE() + 556))
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.tokenWallet?.coins, 0)
  assert.equal(out.tokenWallet?.pointsBalance, -58.511)
  assert.equal(out.tokenWallet?.billingVersion, 'NEW')
  assert.match(String(out.message), /saldo poin -58\.51/)
  assert.doesNotMatch(String(out.message), /RH Coin/)
  assert.equal(formatRhWalletCompact(out.tokenWallet), '-58.51 P · V3/3 · I3/3 · 30 pt')
})

test('deteksi hak watermark hasil dari /uc/getUserInfo (gratis vs member)', async () => {
  // RunningHub memberi hak "作品免水印" hanya ke akun berbayar; akun gratis
  // (memberInfo.userType "3") hasil generate-nya selalu diberi watermark.
  let member: any = { userType: '3', memberCode: null, memberExpiredTime: null }
  upstream = (url) => {
    const u = String(url)
    if (u.includes('/uc/openapi/accountStatus')) return json({ code: 0, msg: 'success', data: { apiType: 'consumer' } })
    if (u.includes('/api/welfare/summary')) {
      return json({ code: 0, data: { dailyGift: { amount: 30 }, freeVideo: { total: 3, used: 0, remaining: 3, modelNames: [] }, freeImage: null, freePeriod: null } })
    }
    if (u.includes('/uc/point/summary')) {
      return json({ code: 0, data: { billingVersion: 'NEW', transitionCoinRemained: '0', balancePoint: 30 } })
    }
    if (u.includes('/uc/getUserInfo')) return json({ code: 0, data: { id: 'uji', memberInfo: member } })
    return json({})
  }

  const gratis = await checkBalance(fakeJwt(FUTURE() + 557))
  assert.equal(gratis.tokenWallet?.watermarkFree, false)
  assert.match(String(gratis.message), /bertimestamp/)

  member = { userType: '1', memberCode: 'HOBBYIST_MONTH', memberExpiredTime: '2099-01-01T00:00:00Z' }
  const memberAcc = await checkBalance(fakeJwt(FUTURE() + 558))
  assert.equal(memberAcc.tokenWallet?.watermarkFree, true)
  assert.match(String(memberAcc.message), /tanpa watermark/)
})

test('claim-daily-gift: klaim hadiah harian pakai token user, kembalikan saldo terbaru', async () => {
  upstream = (url) => {
    const u = String(url)
    if (u.includes('/api/welfare/daily-gift/claim')) return json({ code: 0, msg: 'success', data: { amount: 30 } })
    if (u.includes('/uc/openapi/accountStatus')) return json({ code: 0, msg: 'success', data: { apiType: 'consumer' } })
    if (u.includes('/api/welfare/summary')) {
      return json({ code: 0, data: { dailyGift: { granted: true, amount: 30 }, freeVideo: { total: 3, used: 0, remaining: 3, modelNames: [] }, freeImage: null, freePeriod: null } })
    }
    if (u.includes('/uc/point/summary')) return json({ code: 0, data: { billingVersion: 'NEW', transitionCoinRemained: '0', balancePoint: 30 } })
    if (u.includes('/uc/getUserInfo')) return json({ code: 0, data: { id: 'uji', memberInfo: { userType: '3' } } })
    return json({})
  }

  const res = await originalFetch(`${base}/api/public/runninghub`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'claim-daily-gift', apiKey: fakeJwt(FUTURE() + 999) }),
  })
  const out = await res.json()
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.tokenWallet?.pointsBalance, 30)
  assert.match(String(out.message), /saldo poin 30/)
  assert.ok(urlsSeen.some(u => u.endsWith('/api/welfare/daily-gift/claim')), 'endpoint klaim harus dipanggil')
})

test('claim-daily-gift ditolak untuk API key biasa (bukan access token)', async () => {
  upstream = () => json({ code: 0, data: {} })
  const res = await originalFetch(`${base}/api/public/runninghub`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'claim-daily-gift', apiKey: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }),
  })
  const out = await res.json()
  assert.equal(out.ok, false)
  assert.match(String(out.error), /access token/i)
  assert.equal(urlsSeen.filter(u => u.endsWith('/api/welfare/daily-gift/claim')).length, 0)
})
