// ─── Relay AI Studio: gerbang Pro, kunci server, batas harian ───────────────
// Yang diuji di sini adalah kontrak yang menentukan uang operator: member
// non-Pro tidak boleh menyentuh kunci Gemini server, kunci itu tidak boleh
// bocor ke klien, dan batas harian benar-benar menolak setelah tercapai.
import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import express from 'express'
import jwt from 'jsonwebtoken'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'data', 'test-studio-ai.db')

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
process.env.ARKXMOTION_DB_PATH = DB_PATH
const JWT_SECRET = 'test-secret-studio-ai'
process.env.JWT_SECRET = JWT_SECRET
delete process.env.GEMINI_API_KEY

const db = (await import('../server/db.js')).default as any
const studioRoutes = (await import('../server/routes/studioAi.js')).default
const { resetStudioModelCooldown, STUDIO_FALLBACK_MODELS } = await import('../server/lib/studioAi.js')

const FREE_ID = 11
const PRO_ID = 12
const ADMIN_ID = 13
const freeToken = jwt.sign({ id: FREE_ID, email: 'free@test.local', role: 'user' }, JWT_SECRET)
const proToken = jwt.sign({ id: PRO_ID, email: 'pro@test.local', role: 'user' }, JWT_SECRET)
const adminToken = jwt.sign({ id: ADMIN_ID, email: 'admin@test.local', role: 'admin' }, JWT_SECRET)

const app = express()
app.use(express.json({ limit: '50mb' }))
app.use('/api/public/studio-ai', studioRoutes)

const originalFetch = globalThis.fetch
let upstreamCalls: Array<{ url: string; headers: Record<string, string>; body: any }> = []
let upstreamReply: () => Response = () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'halo' }] } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

let server: ReturnType<typeof app.listen>
let base = ''

function setKey(value: string) {
  db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES ('studio_gemini_key', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(value)
}

before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const insert = db.prepare(
    "INSERT INTO users (id, email, password, name, role, approved, plan) VALUES (?, ?, 'x', ?, ?, 1, ?)",
  )
  insert.run(FREE_ID, 'free@test.local', 'Free Uji', 'user', 'free')
  insert.run(PRO_ID, 'pro@test.local', 'Pro Uji', 'user', 'pro')
  insert.run(ADMIN_ID, 'admin@test.local', 'Admin Uji', 'admin', 'free')
})

beforeEach(() => {
  upstreamCalls = []
  upstreamReply = () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'halo' }] } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  db.prepare('DELETE FROM studio_ai_usage').run()
  db.prepare("DELETE FROM app_settings WHERE key IN ('studio_gemini_key', 'studio_ai_daily_cap')").run()
  resetStudioModelCooldown()
  setKey('server-key-test')

  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url
    if (!url.startsWith('https://generativelanguage.googleapis.com')) {
      return originalFetch(input, init)
    }
    upstreamCalls.push({
      url,
      headers: (init?.headers || {}) as Record<string, string>,
      body: JSON.parse(String(init?.body || '{}')),
    })
    return upstreamReply()
  }) as typeof fetch
})

after(() => {
  globalThis.fetch = originalFetch
  server.close()
})

function post(target: string, token: string, body: unknown = { contents: [{ parts: [{ text: 'hi' }] }] }) {
  return originalFetch(`${base}/api/public/studio-ai/v1beta/models/${target}?alt=sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

test('status melaporkan kunci server terpasang tanpa membocorkan nilainya', async () => {
  const res = await originalFetch(`${base}/api/public/studio-ai/status`)
  const json = (await res.json()) as any
  assert.equal(res.status, 200)
  assert.equal(json.configured, true)
  assert.equal(JSON.stringify(json).includes('server-key-test'), false)
})

function getUsage(token?: string) {
  return originalFetch(`${base}/api/public/studio-ai/usage`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

test('/usage menolak permintaan tanpa login', async () => {
  const res = await getUsage()
  assert.equal(res.status, 401)
})

test('/usage melaporkan pemakaian member Pro', async () => {
  await post('gemini-3-flash-preview:generateContent', proToken)
  await post('gemini-3-flash-preview:generateContent', proToken)
  const res = await getUsage(proToken)
  const json = (await res.json()) as any
  assert.equal(res.status, 200)
  assert.equal(json.eligible, true)
  assert.equal(json.dailyCap, 40)
  assert.equal(json.used, 2)
  assert.equal(json.remaining, 38)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(JSON.stringify(json).includes('server-key-test'), false)
})

test('/usage menandai member gratis tidak berhak memakai relay', async () => {
  const res = await getUsage(freeToken)
  const json = (await res.json()) as any
  assert.equal(res.status, 200)
  assert.equal(json.eligible, false)
  assert.equal(json.reason, 'pro')
  assert.equal(json.used, 0)
})

test('member gratis ditolak 402 dan tidak ada panggilan ke Gemini', async () => {
  const res = await post('gemini-3-flash-preview:generateContent', freeToken)
  const json = (await res.json()) as any
  assert.equal(res.status, 402)
  assert.match(json.error.message, /Pro/)
  assert.equal(upstreamCalls.length, 0)
})

test('member Pro diteruskan ke Gemini dengan kunci server + query asli', async () => {
  const res = await post('gemini-3-flash-preview:generateContent', proToken)
  const json = (await res.json()) as any
  assert.equal(res.status, 200)
  assert.equal(json.candidates[0].content.parts[0].text, 'halo')
  assert.equal(upstreamCalls.length, 1)
  const call = upstreamCalls[0]
  assert.equal(
    call.url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?alt=sse',
  )
  assert.equal(call.headers['x-goog-api-key'], 'server-key-test')
  assert.equal(call.body.contents[0].parts[0].text, 'hi')
  assert.equal(JSON.stringify(json).includes('server-key-test'), false)
})

test('admin boleh walau plan free', async () => {
  const res = await post('gemini-2.5-flash-preview-tts:generateContent', adminToken)
  assert.equal(res.status, 200)
  assert.equal(upstreamCalls.length, 1)
})

test('tanpa kunci server dijawab 503 dengan petunjuk jelas', async () => {
  db.prepare("DELETE FROM app_settings WHERE key = 'studio_gemini_key'").run()
  const res = await post('gemini-3-flash-preview:generateContent', proToken)
  const json = (await res.json()) as any
  assert.equal(res.status, 503)
  assert.match(json.error.message, /studio_gemini_key/)
  assert.equal(upstreamCalls.length, 0)
})

test('method di luar daftar ditolak 400 (relay bukan proxy bebas)', async () => {
  const res = await post('gemini-3-flash-preview:deleteModel', proToken)
  assert.equal(res.status, 400)
  assert.equal(upstreamCalls.length, 0)
})

test('model non-Gemini ditolak 400', async () => {
  const res = await post('gpt-4o:generateContent', proToken)
  assert.equal(res.status, 400)
  assert.equal(upstreamCalls.length, 0)
})

test('batas harian menolak panggilan berikutnya dengan 429', async () => {
  db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES ('studio_ai_daily_cap', '2', CURRENT_TIMESTAMP)",
  ).run()
  const now = Date.now()
  const ins = db.prepare(
    'INSERT INTO studio_ai_usage (user_id, model, method, status, ms, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
  ins.run(PRO_ID, 'gemini-3-flash-preview', 'generateContent', 200, 10, now)
  ins.run(PRO_ID, 'gemini-3-flash-preview', 'generateContent', 200, 10, now)

  const res = await post('gemini-3-flash-preview:generateContent', proToken)
  const json = (await res.json()) as any
  assert.equal(res.status, 429)
  assert.match(json.error.message, /2\/2/)
  assert.equal(upstreamCalls.length, 0)
})

test('panggilan yang berhasil tercatat sebagai pemakaian harian', async () => {
  await post('gemini-3-flash-preview:generateContent', proToken)
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM studio_ai_usage WHERE user_id = ?')
    .get(PRO_ID) as { n: number }
  assert.equal(Number(row.n), 1)
})

test('model yang ditolak kuota dialihkan ke model cadangan yang benar-benar bisa dipakai', async () => {
  const fallback = STUDIO_FALLBACK_MODELS[0]
  upstreamReply = () =>
    upstreamCalls.length <= 1
      ? new Response(JSON.stringify({ error: { code: 429, message: 'quota' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'cadangan' }] } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })

  const res = await post('gemini-3-flash-preview:generateContent', proToken)
  const json = (await res.json()) as any
  assert.equal(res.status, 200)
  assert.equal(json.candidates[0].content.parts[0].text, 'cadangan')
  assert.equal(upstreamCalls.length, 2)
  assert.match(upstreamCalls[1].url, new RegExp(`/models/${fallback}:`))

  const row = db
    .prepare('SELECT model FROM studio_ai_usage WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .get(PRO_ID) as { model: string }
  assert.equal(row.model, fallback)

  // Panggilan berikutnya langsung ke model cadangan selama cooldown.
  upstreamReply = () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  await post('gemini-3-flash-preview:generateContent', proToken)
  assert.equal(upstreamCalls.length, 3)
  assert.match(upstreamCalls[2].url, new RegExp(`/models/${fallback}:`))
})

test('kegagalan upstream tetap dijawab sebagai kesalahan Gemini, bukan 500 polos', async () => {
  upstreamReply = () =>
    new Response(JSON.stringify({ error: { code: 400, message: 'API key not valid' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  const res = await post('gemini-3-flash-preview:generateContent', proToken)
  const json = (await res.json()) as any
  assert.equal(res.status, 400)
  assert.match(json.error.message, /API key not valid/)
})
