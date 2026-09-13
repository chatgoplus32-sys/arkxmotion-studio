// ─── Test antrean & single-flight probe NexaBot ─────────────────────────────
// Log produksi: cek beberapa key sekaligus → banyak request /credit menembak
// upstream BERSAMAAN → NexaBot menggantung untuk semuanya. Modul ini mengunci
// dua pengaman untuk aksi read-only: panggilan identik dibagi (single-flight),
// sisanya mengantre, dan submit/generate tidak pernah ikut ditahan.
import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchNexabotUpstream,
  isNexabotShareableProbe,
  nexabotProbeQueueConfig,
  nexabotProbeShareKey,
} from '../shared/nexabotProxy.js'

const URL_CREDIT = 'https://nexabot.id/api/v1/api/credit'
const noSleep = async (): Promise<void> => {}

function initForKey(key: string): RequestInit {
  return { method: 'GET', headers: { 'x-api-key': key } }
}

function tick(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** fetch palsu yang mencatat berapa panggilan sempat jalan bersamaan. */
function countingFetch(delayMs: number, body: unknown = { ok: true, credit: 5 }) {
  let inFlight = 0
  let peak = 0
  let calls = 0
  const fetchImpl = (async () => {
    calls += 1
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await tick(delayMs)
    inFlight -= 1
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fetchImpl, calls: () => calls, peak: () => peak }
}

/** fetch palsu yang hanya berhenti saat AbortSignal-nya menyala. */
const hangUntilAbort = ((_url: string, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal as AbortSignal | undefined
    const fail = () => {
      const err: any = new Error('The operation was aborted due to timeout')
      err.name = 'AbortError'
      reject(err)
    }
    if (signal?.aborted) return fail()
    signal?.addEventListener('abort', fail, { once: true })
  })) as unknown as typeof fetch

const initialConcurrency = process.env.NEXABOT_PROBE_CONCURRENCY
const initialMaxWait = process.env.NEXABOT_PROBE_QUEUE_MAX_WAIT_MS

beforeEach(() => {
  // Satu slot supaya urutan antrean mudah diamati.
  process.env.NEXABOT_PROBE_CONCURRENCY = '1'
  process.env.NEXABOT_PROBE_QUEUE_MAX_WAIT_MS = '5000'
})

afterEach(() => {
  if (initialConcurrency === undefined) delete process.env.NEXABOT_PROBE_CONCURRENCY
  else process.env.NEXABOT_PROBE_CONCURRENCY = initialConcurrency
  if (initialMaxWait === undefined) delete process.env.NEXABOT_PROBE_QUEUE_MAX_WAIT_MS
  else process.env.NEXABOT_PROBE_QUEUE_MAX_WAIT_MS = initialMaxWait
})

test('probe read-only mengantre: tidak ada dua /credit yang jalan bersamaan', async () => {
  const { fetchImpl, calls, peak } = countingFetch(25)

  const results = await Promise.all(
    ['nxb_a', 'nxb_b', 'nxb_c'].map((key) =>
      fetchNexabotUpstream(URL_CREDIT, initForKey(key), { action: 'credit', fetchImpl, sleep: noSleep }),
    ),
  )

  assert.equal(calls(), 3, 'setiap key tetap dipanggil sekali')
  assert.equal(peak(), 1, 'concurrency 1 → upstream tidak pernah ditembak bersamaan')
  for (const r of results) {
    assert.equal(r.response.status, 200)
    assert.deepEqual(await r.response.json(), { ok: true, credit: 5 })
  }
})

test('single-flight: panggilan identik berbagi satu respons upstream', async () => {
  const { fetchImpl, calls } = countingFetch(25, { ok: true, credit: 7.5 })

  const [first, second] = await Promise.all([
    fetchNexabotUpstream(URL_CREDIT, initForKey('nxb_same'), { action: 'credit', fetchImpl, sleep: noSleep }),
    fetchNexabotUpstream(URL_CREDIT, initForKey('nxb_same'), { action: 'credit', fetchImpl, sleep: noSleep }),
  ])

  assert.equal(calls(), 1, 'request kembar tidak menembak upstream dua kali')
  assert.equal(second.shared, true, 'pemanggil kedua tahu responsnya dipakai bersama')
  assert.notEqual(first.shared, true, 'pemanggil pertama bukan pemakai bersama')
  // Yang penting: dua-duanya tetap bisa membaca body-nya sendiri.
  assert.deepEqual(await first.response.json(), { ok: true, credit: 7.5 })
  assert.deepEqual(await second.response.json(), { ok: true, credit: 7.5 })
})

test('hanya kredensial yang sama yang dibagi — key berbeda tetap dipanggil sendiri', async () => {
  const { fetchImpl, calls } = countingFetch(20)

  await Promise.all([
    fetchNexabotUpstream(URL_CREDIT, initForKey('nxb_one'), { action: 'credit', fetchImpl, sleep: noSleep }),
    fetchNexabotUpstream(URL_CREDIT, initForKey('nxb_two'), { action: 'credit', fetchImpl, sleep: noSleep }),
  ])

  assert.equal(calls(), 2)
})

test('antrean penuh: penunggu yang kelamaan menyerah, bukan menggantung', async () => {
  process.env.NEXABOT_PROBE_QUEUE_MAX_WAIT_MS = '20'
  const policy = { timeoutMs: 600, attempts: 1 }

  const holder = fetchNexabotUpstream(URL_CREDIT, initForKey('nxb_holder'), {
    action: 'credit', fetchImpl: hangUntilAbort, sleep: noSleep, policy,
  })
  await tick(5) // pastikan slot sudah dipegang

  await assert.rejects(
    () => fetchNexabotUpstream(URL_CREDIT, initForKey('nxb_waiting'), {
      action: 'credit', fetchImpl: hangUntilAbort, sleep: noSleep, policy,
    }),
    /antrean probe penuh/,
  )

  // Slot tetap dilepas setelah probe yang memegangnya selesai.
  await assert.rejects(() => holder, /cek saldo/i)
})

test('submit tidak pernah ikut antrean probe (job/kredit tidak boleh tertahan)', async () => {
  const holder = fetchNexabotUpstream(URL_CREDIT, initForKey('nxb_holder2'), {
    action: 'credit', fetchImpl: hangUntilAbort, sleep: noSleep, policy: { timeoutMs: 600, attempts: 1 },
  })
  await tick(5)

  let submitCalls = 0
  const submitFetch = (async () => {
    submitCalls += 1
    return new Response(JSON.stringify({ ok: true, job: { id: 'job-1' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch

  const res = await fetchNexabotUpstream(
    'https://nexabot.id/api/v1/api',
    { method: 'POST', headers: { 'x-api-key': 'nxb_holder2' } },
    { action: 'submit', fetchImpl: submitFetch, sleep: noSleep },
  )

  assert.equal(res.response.status, 200)
  assert.equal(submitCalls, 1, 'submit jalan walau slot probe sedang terpakai')
  await assert.rejects(() => holder)
})

test('helper: aksi yang boleh dibagi/diantrekan & kunci single-flight', () => {
  for (const action of ['credit', 'session', 'modes'] as const) {
    assert.equal(isNexabotShareableProbe(action), true, `${action} harus read-only`)
  }
  for (const action of ['submit', 'generate', 'download', 'job', 'generic'] as const) {
    assert.equal(isNexabotShareableProbe(action), false, `${action} tidak boleh dibagi/ditahan`)
  }

  const a = nexabotProbeShareKey(URL_CREDIT, initForKey('nxb_x'), 'credit')
  const b = nexabotProbeShareKey(URL_CREDIT, initForKey('nxb_x'), 'credit')
  const c = nexabotProbeShareKey(URL_CREDIT, initForKey('nxb_y'), 'credit')
  assert.equal(a, b, 'kredensial + endpoint sama → satu panggilan')
  assert.notEqual(a, c, 'kredensial beda → jangan dibagi')
})

test('config antrean mengikuti env (minimal 1 supaya tidak deadlock)', () => {
  process.env.NEXABOT_PROBE_CONCURRENCY = '4'
  process.env.NEXABOT_PROBE_QUEUE_MAX_WAIT_MS = '1234'
  assert.deepEqual(nexabotProbeQueueConfig(), { concurrency: 4, maxWaitMs: 1234 })

  process.env.NEXABOT_PROBE_CONCURRENCY = '0'
  assert.equal(nexabotProbeQueueConfig().concurrency, 1)
})
