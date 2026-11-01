// ─── Sesi app kedaluwarsa di tengah poll ≠ kunci NexaBot mati ───────────────
//
// Log produksi 2026-11-01 (Seedance 30 detik, tab sempat dibekukan browser):
//   08:02:47 Polling 7/120 …(8 menit tidak ada apa-apa)…
//   08:10:39 ⚠️ Key "Session (cookie)" is invalid: NexaBot job tidak ditemukan
//            atau gagal — NexaBot HTTP 400: {"ok":false,"error":"Kunci NexaBot
//            milik server hanya untuk member yang login (Authorization: Bearer…
//   08:10:39 🔄 Token invalid! Switching key #1 → submit job BARU (kredit ke-2)
//
// Access token app hidup 15 menit dan diperpanjang oleh tick di App.tsx; tab
// beku = tick tidak jalan = token mati, sementara job-nya masih sehat. Relay
// menjawab 400 tentang SESI APP, bukan tentang kunci NexaBot.
//
// Yang dikunci di sini:
//  1. poll menyegarkan sesi lalu menanyakan job yang sama (satu job, satu kredit);
//  2. kalau sesi tidak bisa disegarkan, errornya kelas NexabotAppSessionError
//     dan tokenRotation TIDAK menganggapnya kunci invalid → tidak ada submit kedua.
import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const originalFetch = globalThis.fetch
const FAST = { baseMs: 1, maxMs: 1, jitter: 0 }

const IDENTITY_400 = {
  ok: false,
  error:
    'Kunci NexaBot milik server hanya untuk member yang login (Authorization: Bearer <token app>). ' +
    'Tanpa itu, pakai kunci NexaBot Anda sendiri lewat header X-Api-Key.',
}
const QUEUED_JOB = { ok: true, job: { id: 'job-1', status: 'queued', mode: 'sfv', prompt: 'animasikan' } }
const DONE_JOB = { ok: true, job: { id: 'job-1', status: 'done', mode: 'sfv', prompt: 'animasikan' } }

const b64u = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
const jwtDenganExp = (expDetik: number) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ id: 1, exp: expDetik })}.sig`

let storage: Record<string, string> = {}
let calls: { url: string; headers: Record<string, string> }[] = []
let antrean: Array<() => Response> = []

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const stub = {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => { storage[k] = String(v) },
  removeItem: (k: string) => { delete storage[k] },
}

beforeEach(() => {
  storage = {}
  calls = []
  antrean = []
  ;(globalThis as any).window = { localStorage: stub }
  ;(globalThis as any).localStorage = stub
  globalThis.fetch = (async (input: any, init?: any) => {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(init?.headers || {})) headers[k] = String(v)
    calls.push({ url: String(input), headers })
    const url = String(input)
    // Perpanjangan sesi app (authStore.refresh) — selalu sukses di test 1.
    if (url.includes('/api/auth/refresh')) {
      return jsonResponse({ token: jwtDenganExp(Math.floor(Date.now() / 1000) + 900) })
    }
    const next = antrean.shift()
    if (!next) throw new Error(`fetch dipanggil ke-${calls.length} tanpa respons yang disiapkan (${url})`)
    return next()
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  delete (globalThis as any).window
  delete (globalThis as any).localStorage
})

/** Zustand store dibuat sekali per proses: set state manual supaya tiap test mulai bersih. */
async function aturSesi(token: string | null, refreshToken: string | null) {
  const { useAuthStore } = await import('../src/stores/authStore.js')
  useAuthStore.setState({ token, refreshToken })
  if (token) storage.arkxmotion_token = token
  if (refreshToken) storage.arkxmotion_refresh = refreshToken
}

test('poll: 400 "butuh login app" → sesi disegarkan, job yang sama ditanya lagi', async () => {
  const { pollNexabotJob } = await import('../src/lib/nexabot.js')
  const tokenMati = jwtDenganExp(Math.floor(Date.now() / 1000) - 60)
  await aturSesi(tokenMati, 'rt-1')

  antrean.push(
    () => jsonResponse(IDENTITY_400, 400),
    () => jsonResponse(QUEUED_JOB),
    () => jsonResponse(DONE_JOB),
  )

  const job = await pollNexabotJob('job-1', { cookies: 'session=abc' }, undefined, FAST)

  assert.equal(job.status, 'done', 'hasil yang sudah dibayar tidak boleh hilang karena sesi app')
  const poll = calls.filter((c) => c.url.includes('/job/job-1'))
  assert.equal(poll.length, 3, '400 identitas diulang, bukan diteruskan sebagai kegagalan')
  assert.ok(calls.some((c) => c.url.includes('/api/auth/refresh')), 'sesi app disegarkan lebih dulu')
  assert.match(poll[2].headers.Authorization, /^Bearer /)
  assert.notEqual(poll[2].headers.Authorization, `Bearer ${tokenMati}`, 'poll terakhir memakai token SEGAR')
})

test('poll: tanpa refresh token → NexabotAppSessionError, dan kunci TIDAK dirotasi', async () => {
  const { pollNexabotJob, NexabotAppSessionError, isNexabotRotatableError } = await import('../src/lib/nexabot.js')
  await aturSesi(jwtDenganExp(Math.floor(Date.now() / 1000) - 60), null)

  antrean.push(
    () => jsonResponse(IDENTITY_400, 400),
    () => jsonResponse(IDENTITY_400, 400),
    () => jsonResponse(IDENTITY_400, 400),
    () => jsonResponse(IDENTITY_400, 400),
  )

  const err: any = await pollNexabotJob('job-1', { cookies: 'session=abc' }, undefined, FAST).then(
    () => null,
    (e) => e,
  )
  assert.ok(err instanceof NexabotAppSessionError, `harus NexabotAppSessionError, dapat ${err?.name}: ${err?.message}`)
  assert.match(err.message, /Sesi app kedaluwarsa/)
  assert.match(err.message, /Kunci NexaBot Anda tidak bermasalah/)
  // Inti regressi: pesan ini dulu cocok dengan pola "login" di detectTokenError,
  // sehingga withTokenRotation mengirim job BARU dengan kunci lain (0.2 cr ke-2)
  // dan meninggalkan video yang sudah jadi.
  assert.equal(isNexabotRotatableError(err), false, 'bukan alasan untuk rotasi kunci / submit ulang')
  // Kunci yang memang mati tetap dirotasi.
  assert.equal(isNexabotRotatableError(new Error('NexaBot: API key tidak valid (401)')), true)
  assert.equal(calls.filter((c) => c.url.includes('/job/job-1')).length, 1, 'gagal cepat tanpa submit baru — sesi memang tidak bisa disegarkan')
})

test('poll: 403 "Sesi pengguna tidak dikenali" juga diperlakukan sebagai sesi app', async () => {
  const { pollNexabotJob } = await import('../src/lib/nexabot.js')
  await aturSesi(jwtDenganExp(Math.floor(Date.now() / 1000) - 60), 'rt-1')

  antrean.push(
    () => jsonResponse({ ok: false, error: 'Sesi pengguna tidak dikenali — silakan login ulang' }, 403),
    () => jsonResponse(DONE_JOB),
  )

  const job = await pollNexabotJob('job-1', { cookies: 'session=abc' }, undefined, FAST)
  assert.equal(job.status, 'done')
})

test('poll: 403 dari upstream (bukan relay) tetap sesi cookie kedaluwarsa → fallback API key jalan', async () => {
  const { pollNexabotJob } = await import('../src/lib/nexabot.js')
  await aturSesi(jwtDenganExp(Math.floor(Date.now() / 1000) + 900), 'rt-1')

  antrean.push(() => jsonResponse({ ok: false, error: 'unauthorized' }, 403))

  await assert.rejects(
    () => pollNexabotJob('job-1', { cookies: 'session=abc' }, undefined, FAST),
    /session cookie kedaluwarsa/,
  )
})
