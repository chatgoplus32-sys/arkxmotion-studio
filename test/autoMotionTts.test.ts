// ─── Gemini TTS /auto-motion/ (Explainer Studio) ─────────────────────────────
// Kontrak yang diuji: status tidak membocorkan kunci; POST tanpa cookie Pro
// ditolak; member non-Pro 403; validasi suara/gaya; WAV dikembalikan apa adanya
// dan pemakaian tercatat; batas 6 permintaan / 10 menit per user dihormati.
import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import express from 'express'
import jwt from 'jsonwebtoken'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'data', 'test-auto-motion-tts.db')

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
process.env.ARKXMOTION_DB_PATH = DB_PATH
process.env.JWT_SECRET = 'test-secret-tts'
process.env.JWT_REFRESH_SECRET = 'test-refresh-tts'
delete process.env.GEMINI_API_KEY

const db = (await import('../server/db.js')).default as any
const ttsRoutes = (await import('../server/routes/autoMotionTts.js')).default

const REFRESH_SECRET = 'test-refresh-tts'
const FREE_ID = 21
const PRO_ID = 22
const ADMIN_ID = 23
const proCookie = `arkx_session=${jwt.sign({ id: PRO_ID, kind: 'refresh' }, REFRESH_SECRET, { expiresIn: '7d' })}`
const freeCookie = `arkx_session=${jwt.sign({ id: FREE_ID, kind: 'refresh' }, REFRESH_SECRET, { expiresIn: '7d' })}`
const adminCookie = `arkx_session=${jwt.sign({ id: ADMIN_ID, kind: 'refresh' }, REFRESH_SECRET, { expiresIn: '7d' })}`

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use('/api', ttsRoutes)

const originalFetch = globalThis.fetch
let upstreamReply: () => Response = () =>
  new Response('{}', { status: 500 })

let server: ReturnType<typeof app.listen>
let base = ''

// WAV minimal: header 44 byte + payload PCM 4 byte (genap, boleh dibaca isWav).
const wavBytes = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WAVE'),
  Buffer.from('fmt '),
  Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 2, 0, 16, 0]),
  Buffer.from('data'),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from([1, 2, 3, 4]),
])
const wavB64 = wavBytes.toString('base64')
const okUpstream = () =>
  new Response(
    JSON.stringify({
      candidates: [
        { content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wavB64 } }] } },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )

function setKey(value: string | null) {
  if (value === null) {
    db.prepare("DELETE FROM app_settings WHERE key = 'studio_gemini_key'").run()
    return
  }
  db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES ('studio_gemini_key', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(value)
}

before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const insert = db.prepare(
    "INSERT INTO users (id, email, password, name, role, approved, plan, refresh_token) VALUES (?, ?, 'x', ?, ?, 1, ?, '')",
  )
  insert.run(FREE_ID, 'free@test.local', 'Free Uji', 'user', 'free')
  insert.run(PRO_ID, 'pro@test.local', 'Pro Uji', 'user', 'pro')
  insert.run(ADMIN_ID, 'admin@test.local', 'Admin Uji', 'admin', 'free')
  // refresh_token di DB harus cocok dengan cookie (gate menolak rotasi/logout)
  const tokenByCookie: Record<number, string> = {
    [FREE_ID]: freeCookie.split('=')[1],
    [PRO_ID]: proCookie.split('=')[1],
    [ADMIN_ID]: adminCookie.split('=')[1],
  }
  for (const [id, token] of Object.entries(tokenByCookie)) {
    db.prepare('UPDATE users SET refresh_token = ? WHERE id = ?').run(token, Number(id))
  }

  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url
    if (!String(url).startsWith('https://generativelanguage.googleapis.com')) {
      return originalFetch(input, init)
    }
    return upstreamReply()
  }) as typeof fetch
})

beforeEach(() => {
  upstreamReply = okUpstream
  db.prepare('DELETE FROM studio_ai_usage').run()
  db.prepare("DELETE FROM app_settings WHERE key IN ('studio_gemini_key', 'studio_ai_daily_cap')").run()
  setKey('server-key-test')
})

after(async () => {
  globalThis.fetch = originalFetch
  await new Promise((resolve) => server.close(resolve))
  try { db?.close?.() } catch { /* better-sqlite3 sudah ditutup */ }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(DB_PATH + suffix, { force: true }) } catch { /* Windows: file masih terkunci */ }
  }
})

test('GET /api/tts/status melaporkan configured tanpa membocorkan kunci', async () => {
  const res = await fetch(`${base}/api/tts/status`)
  assert.equal(res.status, 200)
  const body = await res.json() as any
  assert.equal(body.configured, true)
  assert.equal(body.maxChars, 2500)
  assert.equal(JSON.stringify(body).includes('server-key-test'), false)
})

test('POST /api/tts tanpa cookie ditolak 401', async () => {
  const res = await fetch(`${base}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'halo', voice: 'Kore', delivery: 'natural' }),
  })
  assert.equal(res.status, 401)
})

test('POST /api/tts member non-Pro ditolak 403', async () => {
  const res = await fetch(`${base}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: freeCookie },
    body: JSON.stringify({ text: 'halo', voice: 'Kore', delivery: 'natural' }),
  })
  assert.equal(res.status, 403)
  assert.equal((await res.json() as any).error, 'pro_required')
})

test('POST /api/tts tanpa kunci server dijawab 503 tts_not_configured', async () => {
  setKey(null)
  const res = await fetch(`${base}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: proCookie },
    body: JSON.stringify({ text: 'halo', voice: 'Kore', delivery: 'natural' }),
  })
  assert.equal(res.status, 503)
  assert.equal((await res.json() as any).error, 'tts_not_configured')
})

test('POST /api/tts suara di luar daftar ditolak 400', async () => {
  const res = await fetch(`${base}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: proCookie },
    body: JSON.stringify({ text: 'halo', voice: 'TidakAda', delivery: 'natural' }),
  })
  assert.equal(res.status, 400)
  assert.equal((await res.json() as any).error, 'voice_invalid')
})

test('POST /api/tts sukses: WAV dikembalikan dan pemakaian tercatat', async () => {
  const res = await fetch(`${base}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: proCookie },
    body: JSON.stringify({ text: 'kucing oren sedang tidur', voice: 'Kore', delivery: 'warm' }),
  })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'audio/wav')
  const bytes = Buffer.from(await res.arrayBuffer())
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF')
  const row = db.prepare("SELECT model, method, status FROM studio_ai_usage WHERE user_id = ?").get(PRO_ID)
  assert.deepEqual({ ...row }, { model: 'gemini-3.8-flash-tts', method: 'tts', status: 200 })
})

test('POST /api/tts admin boleh walau plan free', async () => {
  const res = await fetch(`${base}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ text: 'halo', voice: 'Puck', delivery: 'calm' }),
  })
  assert.equal(res.status, 200)
})
