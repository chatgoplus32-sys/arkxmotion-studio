// ─── Test ketahanan submit/poll NexaBot (fetch di-stub) ─────────────────────
// Meniru kejadian nyata dari log browser:
//   /api/public/nexabot/credit & /job/:id → 504 (upstream menggantung >20s),
//   /api/public/nexabot/generate          → 429 (rate limit).
// Dulu satu 504 di tengah polling langsung menggagalkan job yang statusnya
// masih `queued` di NexaBot. Test ini mengunci perilaku baru: transient
// ditunggu lalu dicoba lagi, sedangkan 4xx asli tetap gagal cepat.
import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { pollNexabotJob, submitNexabot } from '../src/lib/nexabot.js'

const originalFetch = globalThis.fetch
const AUTH = { cookies: 'session=abc' }
/** Jeda kecil sekali supaya test tidak benar-benar menunggu detik-an. */
const FAST = { baseMs: 1, maxMs: 1, jitter: 0 }

let calls: string[] = []
let queue: Array<() => Response> = []

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

const QUEUED_JOB = { ok: true, job: { id: 'job-1', status: 'queued', mode: 'sfv', prompt: 'animasikan' } }
const DONE_JOB = { ok: true, job: { id: 'job-1', status: 'done', mode: 'sfv', prompt: 'animasikan' } }

/** Respons yang selalu sama (mis. 504 terus-menerus). */
function always(factory: () => Response) {
  queue.push(factory, factory, factory, factory, factory, factory, factory, factory, factory, factory, factory, factory, factory, factory, factory, factory)
}

beforeEach(() => {
  calls = []
  queue = []
  globalThis.fetch = (async (input: any) => {
    calls.push(String(input))
    const next = queue.shift()
    if (!next) throw new Error(`fetch dipanggil ke-${calls.length} tanpa respons yang disiapkan`)
    return next()
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// ── Poll: transient tidak menggagalkan job ─────────────────────────────────

test('poll: 504 lalu selesai → job tetap dianggap berjalan', async () => {
  queue.push(
    () => jsonResponse({ ok: false, error: 'NexaBot timeout — server mereka tidak merespons' }, 504),
    () => jsonResponse(QUEUED_JOB),
    () => jsonResponse(DONE_JOB),
  )

  const job = await pollNexabotJob('job-1', AUTH, undefined, FAST)

  assert.equal(job.status, 'done')
  assert.equal(calls.length, 3, '504 harus dicoba ulang, bukan langsung gagal')
})

test('poll: 429 + Retry-After dihormati (jeda dari upstream tetap dibatasi)', async () => {
  queue.push(
    () => jsonResponse({ ok: false, error: 'rate limit' }, 429, { 'Retry-After': '0' }),
    () => jsonResponse(DONE_JOB),
  )
  const retries: { status: number | null; delayMs: number }[] = []

  const job = await pollNexabotJob('job-1', AUTH, undefined, {
    ...FAST,
    onRetry: (info) => retries.push({ status: info.status, delayMs: info.delayMs }),
  })

  assert.equal(job.status, 'done')
  assert.equal(retries.length, 1)
  assert.equal(retries[0].status, 429)
  assert.equal(retries[0].delayMs, 0, 'Retry-After: 0 → langsung coba lagi')
})

test('poll: koneksi putus (fetch throw) juga transient', async () => {
  queue.push(
    () => { throw new TypeError('Failed to fetch') },
    () => jsonResponse(DONE_JOB),
  )

  const job = await pollNexabotJob('job-1', AUTH, undefined, FAST)
  assert.equal(job.status, 'done')
  assert.equal(calls.length, 2)
})

test('poll: 504 terus-menerus menyerah dengan pesan yang jelas (bukan menggantung)', async () => {
  always(() => jsonResponse({ ok: false, error: 'timeout' }, 504))

  await assert.rejects(
    () => pollNexabotJob('job-1', AUTH, undefined, FAST),
    /NexaBot tidak merespons \(12 percobaan berturut-turut gagal\)/,
  )
  assert.equal(calls.length, 12, 'berhenti setelah 12 kegagalan berturut-turut')
})

test('poll: batas waktu total dihormati', async () => {
  always(() => jsonResponse({ ok: false, error: 'timeout' }, 504))

  await assert.rejects(
    () => pollNexabotJob('job-1', AUTH, undefined, { ...FAST, maxTotalMs: -1 }),
    /polling timeout/,
  )
  assert.equal(calls.length, 1)
})

// ── Poll: yang memang fatal harus tetap fatal ──────────────────────────────

test('poll: 404 → job tidak ditemukan (gagal cepat, tidak diulang)', async () => {
  queue.push(() => jsonResponse({ ok: false, error: 'not found' }, 404))

  await assert.rejects(() => pollNexabotJob('job-1', AUTH, undefined, FAST), /tidak ditemukan/)
  assert.equal(calls.length, 1)
})

test('poll: 401/403 → pesan sesi kedaluwarsa (agar fallback ke API key jalan)', async () => {
  queue.push(() => jsonResponse({ ok: false, error: 'unauthorized' }, 403))

  await assert.rejects(() => pollNexabotJob('job-1', AUTH, undefined, FAST), /session cookie kedaluwarsa/)
  assert.equal(calls.length, 1)
})

test('poll: halaman HTML (cookie mati) tetap fatal, bukan diulang', async () => {
  queue.push(() => new Response('<!DOCTYPE html><html>login</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))

  await assert.rejects(() => pollNexabotJob('job-1', AUTH, undefined, FAST), /bukan JSON/)
  assert.equal(calls.length, 1)
})

test('poll: status failed dari upstream → error job gagal', async () => {
  queue.push(() => jsonResponse({ ok: true, job: { id: 'job-1', status: 'failed', mode: 'sfv', prompt: 'x', error: 'prompt ditolak' } }))

  await assert.rejects(() => pollNexabotJob('job-1', AUTH, undefined, FAST), /prompt ditolak/)
})

// ── Submit: 429 diulang, tapi 5xx TIDAK (hindari job ganda) ────────────────

test('submit: 429 lalu sukses → job dibuat sekali, retry dilaporkan', async () => {
  queue.push(
    () => jsonResponse({ ok: false, error: 'rate limit' }, 429, { 'Retry-After': '0' }),
    () => jsonResponse({ ok: true, job_id: 'job-9', status: 'queued', credit_cost: 0 }),
  )
  const retries: (number | null)[] = []

  const result = await submitNexabot({ mode: 'sfv', prompt: 'animasikan' }, AUTH, {
    ...FAST,
    maxAttempts: 3,
    onRetry: (info) => retries.push(info.status),
  })

  assert.equal(result.jobId, 'job-9')
  assert.equal(calls.length, 2)
  assert.deepEqual(retries, [429])
})

test('submit: 429 terus-menerus berhenti dengan pesan rate limit yang ramah', async () => {
  queue.push(
    () => jsonResponse({ ok: false, error: 'rate limit' }, 429),
    () => jsonResponse({ ok: false, error: 'rate limit' }, 429),
  )

  await assert.rejects(
    () => submitNexabot({ mode: 'sfv', prompt: 'x' }, AUTH, { ...FAST, maxAttempts: 2 }),
    /rate limit/i,
  )
  assert.equal(calls.length, 2, 'tidak boleh mencoba tanpa batas')
})

test('submit: 503 tidak diulang (job mungkin sudah terbentuk upstream)', async () => {
  queue.push(() => jsonResponse({ ok: false, error: 'unavailable' }, 503))

  await assert.rejects(
    () => submitNexabot({ mode: 'sfv', prompt: 'x' }, AUTH, { ...FAST, maxAttempts: 3 }),
    /HTTP 503/,
  )
  assert.equal(calls.length, 1)
})

test('submit: 401 → sesi kedaluwarsa tanpa retry', async () => {
  queue.push(() => jsonResponse({ ok: false, error: 'unauthorized' }, 401))

  await assert.rejects(
    () => submitNexabot({ mode: 'sfv', prompt: 'x' }, AUTH, { ...FAST, maxAttempts: 3 }),
    /session cookie kedaluwarsa/,
  )
  assert.equal(calls.length, 1)
})

test('submit: 402 → kredit tidak cukup', async () => {
  queue.push(() => jsonResponse({ ok: false, error: 'insufficient' }, 402))

  await assert.rejects(() => submitNexabot({ mode: 't2v', prompt: 'x' }, AUTH, FAST), /Kredit tidak cukup/)
})
