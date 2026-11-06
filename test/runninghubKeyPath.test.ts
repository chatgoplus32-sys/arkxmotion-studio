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

let upstream: () => Response = () => new Response('{}', { status: 200 })
let bodiesSeen: any[] = []

const app = express()
app.use(express.json({ limit: '50mb' }))
app.use('/api/public/runninghub', runninghubRoutes)

let server: ReturnType<typeof app.listen>
let base = ''

before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  globalThis.fetch = (async (_url: any, init?: any) => {
    try { bodiesSeen.push(init?.body ? JSON.parse(init.body) : null) } catch { bodiesSeen.push(init?.body) }
    return upstream()
  }) as any
})

beforeEach(() => {
  bodiesSeen = []
})

after(() => {
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
