// ─── Rute seed admin tidak lagi terbuka ─────────────────────────────────────
//
// `api/auth.ts?path=seed` membuat atau mengatur ulang akun admin. Sebelum ini
// rutenya tidak dijaga apa pun — dispatch-nya hanya mengurus CORS dan OPTIONS —
// dan handler-nya bahkan tidak memeriksa metode HTTP, sementara password admin
// yang dipasangnya tertanam di dalam berkas itu sendiri, yang berarti sudah ada
// di repo publik.
//
// Tes ini ada karena penghapusan baris penjaga tidak akan terlihat oleh apa pun
// selain tes: tak ada tipe yang berubah, dan berkas fungsi Vercel ini tidak
// disentuh tes lain. Yang diuji perilakunya — metode selain POST ditolak, kunci
// dari environment wajib ada dan harus cocok, dan konfigurasi yang kurang
// mematikan rutenya (503) alih-alih membukanya.
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'

const ENV_KEYS = ['JWT_SECRET', 'SEED_KEY', 'ADMIN_EMAIL', 'ADMIN_PASSWORD']
const saved: Record<string, string | undefined> = {}
const KEY = 'kunci-uji-yang-benar'

before(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key]
  // api/auth.ts menolak diimpor tanpa JWT_SECRET, dan tes ini tidak menguji JWT.
  process.env.JWT_SECRET = saved.JWT_SECRET || 'kunci-uji-tes-seed'
})

after(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

type Response = { status?: number; body?: unknown; headers: Record<string, string> }

function makeRes() {
  const out: Response = { headers: {} }
  const res = {
    setHeader: (name: string, value: string) => { out.headers[name] = value },
    status(code: number) { out.status = code; return res },
    json(payload: unknown) { out.body = payload; return res },
    end() { return res },
  }
  return { res, out }
}

async function callSeed(request: {
  method: string
  headers?: Record<string, string>
  query?: Record<string, string>
}): Promise<Response> {
  const handler = (await import('../api/auth.js')).default as (
    req: unknown,
    res: unknown,
  ) => Promise<unknown>
  const { res, out } = makeRes()
  await handler(
    {
      method: request.method,
      headers: request.headers || {},
      query: { path: 'seed', ...(request.query || {}) },
    },
    res,
  )
  return out
}

test('PREFLIGHT masih dilayani (200) supaya CORS tidak ikut rusak', async () => {
  delete process.env.SEED_KEY
  const out = await callSeed({ method: 'OPTIONS' })
  assert.equal(out.status, 200)
})

test('metode selain POST ditolak (405) — dulu handler ini tidak memeriksa metode', async () => {
  delete process.env.SEED_KEY
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const out = await callSeed({ method })
    assert.equal(out.status, 405, `${method} seharusnya 405, dapat ${out.status}`)
  }
})

test('tanpa SEED_KEY rutenya dimatikan (503), bukan dibiarkan terbuka', async () => {
  delete process.env.SEED_KEY
  const out = await callSeed({ method: 'POST' })
  assert.equal(out.status, 503)
  assert.match(String((out.body as { error?: string }).error), /SEED_KEY/)
})

test('kunci yang salah ditolak (401)', async () => {
  process.env.SEED_KEY = KEY
  const out = await callSeed({ method: 'POST', headers: { 'x-seed-key': 'kunci-yang-salah' } })
  assert.equal(out.status, 401)
})

test('tanpa kunci sama sekali juga 401', async () => {
  process.env.SEED_KEY = KEY
  const out = await callSeed({ method: 'POST' })
  assert.equal(out.status, 401)
})

test('kunci benar tapi ADMIN_EMAIL/PASSWORD kosong berhenti (500) tanpa menyentuh database', async () => {
  process.env.SEED_KEY = KEY
  delete process.env.ADMIN_EMAIL
  delete process.env.ADMIN_PASSWORD
  const out = await callSeed({ method: 'POST', headers: { 'x-seed-key': KEY } })
  assert.equal(out.status, 500)
  assert.ok(!('password' in (out.body as Record<string, unknown>)), 'respons tidak boleh memuat password')
})

test('respons tidak pernah memuat field password', async () => {
  delete process.env.SEED_KEY
  const out = await callSeed({ method: 'POST' })
  assert.ok(!('password' in (out.body as Record<string, unknown>)))
})
