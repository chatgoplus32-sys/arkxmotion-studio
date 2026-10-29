// ─── Antrean submit NexaBot per kredensial ─────────────────────────────────
// Log lapangan: dua member menekan generate bersamaan → dua submit menembak
// akun NexaBot yang sama → upstream membalas 429 `Rate limit` untuk keduanya
// dan TIDAK ADA job yang terbentuk. Kegagalannya bukan karena kredit atau
// prompt, tapi karena tabrakan.
//
// Yang diuji di sini:
//  1. unit lane — serialisasi per kredensial, posisi antrean, batas sabar;
//  2. rute HTTP — /submit & /generate hanya mengirim satu request upstream ke
//     satu akun pada satu waktu, dan penunggu yang kehabisan sabar menjawab 429
//     BUATAN KITA (Retry-After + tiket tidak hangus), bukan request yang ditolak
//     NexaBot.
import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import nexabotRoutes from '../server/routes/nexabot.js'
import {
  NEXABOT_JOB_LOCK,
  acquireNexabotSubmitSlot,
  isNexabotJobFinishedText,
  isNexabotUpstreamBusyText,
  markNexabotJobFinished,
  markNexabotJobRunning,
  markNexabotLaneCooldown,
  nexabotLaneBusy,
  nexabotSubmitLaneKey,
  nexabotSubmitLaneLabel,
  nexabotSubmitLaneStats,
  nexabotSubmitQueueConfig,
  resetNexabotLaneJobs,
  touchNexabotJob,
} from '../shared/nexabotProxy.js'

const tick = (ms = 10): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const cfg = (over: Partial<ReturnType<typeof nexabotSubmitQueueConfig>> = {}) => ({
  ...nexabotSubmitQueueConfig({} as NodeJS.ProcessEnv),
  ...over,
})

// ═══════════════════ 1. Lane (unit) ═══════════════════

test('config antrean submit: default + override env', () => {
  const bawaan = nexabotSubmitQueueConfig({} as NodeJS.ProcessEnv)
  assert.equal(bawaan.concurrency, 1, 'satu akun NexaBot dilayani bergantian')
  assert.ok(bawaan.maxWaitMs >= 15_000, 'member boleh mengantre cukup lama sebelum menyerah')

  const diubah = nexabotSubmitQueueConfig({
    NEXABOT_SUBMIT_CONCURRENCY: '3.9',
    NEXABOT_SUBMIT_QUEUE_MAX_WAIT_MS: '8000',
    NEXABOT_SUBMIT_RETRY_AFTER_S: '5',
  } as NodeJS.ProcessEnv)
  assert.equal(diubah.concurrency, 3, 'dibulatkan ke bawah, minimum 1')
  assert.equal(diubah.maxWaitMs, 8000)
  assert.equal(diubah.retryAfterSeconds, 5)

  const ngawur = nexabotSubmitQueueConfig({ NEXABOT_SUBMIT_CONCURRENCY: '0', NEXABOT_SUBMIT_RETRY_AFTER_S: '-2' } as NodeJS.ProcessEnv)
  assert.equal(ngawur.concurrency, 1, 'env tidak masuk akal tidak bisa mematikan antrean')
  assert.equal(ngawur.retryAfterSeconds, bawaan.retryAfterSeconds)
})

test('kunci lane: sama akun = sama antrean, beda akun = beda antrean', () => {
  const cookieA = nexabotSubmitLaneKey({ kind: 'cookie', source: 'own-cookie', secret: 'session-satu' })
  const cookieA2 = nexabotSubmitLaneKey({ kind: 'cookie', source: 'master', secret: 'session-satu' })
  const cookieB = nexabotSubmitLaneKey({ kind: 'cookie', source: 'own-cookie', secret: 'session-dua' })
  const kunciA = nexabotSubmitLaneKey({ kind: 'api-key', source: 'own-key', secret: 'session-satu' })

  assert.equal(cookieA, cookieA2, 'sumber kredensial tidak mengubah akun upstream-nya')
  assert.notEqual(cookieA, cookieB, 'kredensial berbeda jangan ikut mengantre di belakang yang lain')
  assert.notEqual(cookieA, kunciA, 'jenis kredensial berbeda = jalur berbeda')
  assert.equal(nexabotSubmitLaneKey(null), 'lane:tanpa-kredensial')
})

test('label lane aman untuk log: tidak pernah berisi kredensialnya', () => {
  const rahasia = 'session-rahasia-jangan-dimasukin-log'
  assert.equal(nexabotSubmitLaneLabel({ kind: 'cookie', source: 'master', secret: rahasia }), 'sesi server')
  assert.equal(nexabotSubmitLaneLabel({ kind: 'api-key', source: 'master', secret: rahasia }), 'kunci server')
  assert.equal(nexabotSubmitLaneLabel({ kind: 'api-key', source: 'client-master', secret: rahasia }), 'kunci master di browser')
  assert.equal(nexabotSubmitLaneLabel({ kind: 'cookie', source: 'own-cookie', secret: rahasia }), 'sesi member')
  assert.equal(nexabotSubmitLaneLabel({ kind: 'api-key', source: 'own-key', secret: rahasia }), 'kunci member')
  for (const label of ['sesi server', 'kunci server', 'kunci master di browser', 'sesi member', 'kunci member']) {
    assert.ok(!label.includes(rahasia))
  }
})

test('lane concurrency 1: pemanggil kedua menunggu, tidak jalan bersamaan', async () => {
  const lane = nexabotSubmitLaneKey({ kind: 'cookie', source: 'own-cookie', secret: 'serial-1' })
  const first = await acquireNexabotSubmitSlot(lane, cfg())
  assert.ok(first)
  assert.equal(first.position, 0, 'yang pertama tidak mengantre')
  // Bukan 0 persis: acquire tetap satu putaran event loop, dan timer bisa
  // meleset 1 ms di mesin yang sibuk.
  assert.ok(first.waitMs <= 5, `pemanggil pertama menunggu ${first.waitMs}ms`)

  let pemanggilKeduaSelesai = false
  const kedua = acquireNexabotSubmitSlot(lane, cfg({ maxWaitMs: 5000 })).then((slot) => {
    pemanggilKeduaSelesai = true
    return slot
  })

  await tick(25)
  assert.equal(pemanggilKeduaSelesai, false, 'slot belum lepas, pemanggil kedua masih mengantre')
  assert.deepEqual(nexabotSubmitLaneStats(lane), { active: 1, waiting: 1 })

  first.release()
  const slotKedua = await kedua
  assert.ok(slotKedua, 'slot diwariskan ke penunggu, bukan hangus')
  assert.equal(slotKedua.position, 1)
  assert.ok(slotKedua.waitMs >= 10, 'lama menunggu tercatat supaya bisa dibaca di log')
  slotKedua.release()
  assert.equal(nexabotSubmitLaneStats(lane), null, 'lane kosong dibuang, Map tidak tumbuh tanpa batas')
})

test('penunggu yang kelamaan menunggu menyerah — dan lane tetap sehat', async () => {
  const lane = nexabotSubmitLaneKey({ kind: 'cookie', source: 'own-cookie', secret: 'macet-1' })
  const holder = await acquireNexabotSubmitSlot(lane, cfg())
  assert.ok(holder)

  const mulai = Date.now()
  const penunggu = await acquireNexabotSubmitSlot(lane, cfg({ maxWaitMs: 30 }))
  assert.equal(penunggu, null, 'batas sabar habis → tidak dapat slot')
  assert.ok(Date.now() - mulai >= 25, 'menunggu sampai batas, bukan menyerah lebih awal')

  const cadangan = await acquireNexabotSubmitSlot(lane, cfg({ maxWaitMs: 30 }))
  assert.equal(cadangan, null, 'slot pemegang masih terpakai, tidak ada slot bocor dari penunggu yang menyerah')

  holder.release()
  const setelahLepas = await acquireNexabotSubmitSlot(lane, cfg())
  assert.ok(setelahLepas, 'lane bisa dipakai lagi setelah pemegang melepas')
  setelahLepas.release()
  assert.equal(nexabotSubmitLaneStats(lane), null)
})

test('lane berbeda tidak saling menahan (kunci member sendiri tidak kena antrean akun orang lain)', async () => {
  const laneA = nexabotSubmitLaneKey({ kind: 'api-key', source: 'own-key', secret: 'kunci-A' })
  const laneB = nexabotSubmitLaneKey({ kind: 'api-key', source: 'own-key', secret: 'kunci-B' })

  const a = await acquireNexabotSubmitSlot(laneA, cfg({ maxWaitMs: 50 }))
  const b = await acquireNexabotSubmitSlot(laneB, cfg({ maxWaitMs: 50 }))
  assert.ok(a && b, 'dua akun berbeda boleh submit bersamaan')
  a.release()
  b.release()
})

// ═══════════════════ 1b. Job yang berjalan (unit) ═══════════════════
// Akun Unlimited hanya menjalankan satu job; antrean submit saja tidak cukup.

test('job yang berjalan menahan lane sampai benar-benar dilepas', () => {
  const lane = nexabotSubmitLaneKey({ kind: 'cookie', source: 'master', secret: 'job-unit-1' })
  markNexabotJobRunning(lane, 'job-1', { nowMs: 1000 })

  const sibuk = nexabotLaneBusy(lane, 2000)
  assert.equal(sibuk.busy, true)
  assert.equal(sibuk.reason, 'job')
  assert.equal(sibuk.jobId, 'job-1')
  assert.ok(sibuk.retryAfterSeconds > 0, 'klien harus diberi tahu kapan boleh mencoba lagi')

  assert.equal(touchNexabotJob('job-1', 3000), true, 'poll memperbarui tanda hidup job')
  assert.equal(touchNexabotJob('job-lain', 3000), false, 'job yang tidak tercatat tidak mengubah apa pun')

  assert.equal(markNexabotJobFinished('job-1'), true)
  assert.equal(nexabotLaneBusy(lane, 3001).busy, false, 'lane langsung boleh dipakai setelah job selesai')
  assert.equal(markNexabotJobFinished('job-1'), false, 'pelepasan idempoten, bukan error')
})

test('Retry-After sibuk memakai est_seconds job, dibatasi atas', () => {
  const lane = nexabotSubmitLaneKey({ kind: 'cookie', source: 'master', secret: 'job-unit-2' })
  markNexabotJobRunning(lane, 'job-2', { nowMs: 0, estSeconds: 90 })
  // Sisa 80 detik → dibatasi maxBusyRetryAfterSeconds (60).
  assert.equal(nexabotLaneBusy(lane, 10_000).retryAfterSeconds, NEXABOT_JOB_LOCK.maxBusyRetryAfterSeconds)

  const tanpaEst = nexabotSubmitLaneKey({ kind: 'cookie', source: 'master', secret: 'job-unit-3' })
  markNexabotJobRunning(tanpaEst, 'job-3', { nowMs: 0 })
  assert.equal(nexabotLaneBusy(tanpaEst, 10_000).retryAfterSeconds, NEXABOT_JOB_LOCK.busyRetryAfterSeconds)
})

test('job yang berhenti dipoll / melewati batas keras dilepas otomatis', () => {
  const diam = nexabotSubmitLaneKey({ kind: 'cookie', source: 'master', secret: 'job-unit-4' })
  markNexabotJobRunning(diam, 'job-4', { nowMs: 0 })
  assert.equal(nexabotLaneBusy(diam, NEXABOT_JOB_LOCK.idleMs - 1).busy, true)
  assert.equal(nexabotLaneBusy(diam, NEXABOT_JOB_LOCK.idleMs + 1).busy, false, 'tab ditutup ≠ lane terkunci selamanya')

  const tua = nexabotSubmitLaneKey({ kind: 'cookie', source: 'master', secret: 'job-unit-5' })
  markNexabotJobRunning(tua, 'job-5', { nowMs: 0 })
  touchNexabotJob('job-5', NEXABOT_JOB_LOCK.maxHoldMs - 1)
  assert.equal(
    nexabotLaneBusy(tua, NEXABOT_JOB_LOCK.maxHoldMs + 1).busy,
    false,
    'job yang terus dipoll pun tetap dilepas setelah batas keras',
  )
})

test('cooldown upstream menahan lane walau tidak ada job yang tercatat', () => {
  const lane = nexabotSubmitLaneKey({ kind: 'cookie', source: 'master', secret: 'job-unit-6' })
  markNexabotLaneCooldown(lane, 5000, 1000)

  const sibuk = nexabotLaneBusy(lane, 2000)
  assert.equal(sibuk.busy, true)
  assert.equal(sibuk.reason, 'cooldown')
  assert.equal(sibuk.retryAfterSeconds, 4)

  assert.equal(nexabotLaneBusy(lane, 6000).busy, false, 'cooldown habis → lane boleh ditembak lagi')
})

test('deteksi teks upstream: job berjalan vs status selesai', () => {
  assert.ok(isNexabotUpstreamBusyText('Generate sedang berjalan. Tunggu selesai sebelum generate lagi (mode unlimited).'))
  assert.ok(isNexabotUpstreamBusyText('Terlalu banyak permintaan generate. Tunggu sebentar.'))
  assert.equal(isNexabotUpstreamBusyText('{"ok":true,"job_id":"x"}'), false)

  assert.equal(isNexabotJobFinishedText(JSON.stringify({ ok: true, job: { status: 'done' } })), true)
  assert.equal(isNexabotJobFinishedText(JSON.stringify({ ok: true, job: { status: 'failed' } })), true)
  assert.equal(isNexabotJobFinishedText(JSON.stringify({ ok: true, job: { status: 'processing' } })), false)
  assert.equal(isNexabotJobFinishedText(JSON.stringify({ ok: true, status: 'completed' })), true)
  assert.equal(isNexabotJobFinishedText('bukan json'), false)
})

// ═══════════════════ 2. Rute HTTP ═══════════════════

const originalFetch = globalThis.fetch
const KUE_A = 'session-antre-a'
const KUE_B = 'session-antre-b'

let langkah: Array<() => Response | Promise<Response>> = []
let calls: string[] = []
let bersamaan = 0
let puncak = 0

function upstreamOk(body: unknown) {
  return () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

/** Respons upstream yang baru datang setelah `ms` — meniru submit yang lambat. */
function upstreamLambat(ms: number, body: unknown) {
  return async () => {
    await tick(ms)
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
}

const app = express()
app.use(express.json())
app.use('/api/public/nexabot', nexabotRoutes)

let server: ReturnType<typeof app.listen>
let base = ''

before(async () => {
  process.env.NEXABOT_PROXY_RETRY_BASE_MS = '1'
  process.env.NEXABOT_PROXY_RETRY_MAX_MS = '1'
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

beforeEach(() => {
  langkah = []
  calls = []
  bersamaan = 0
  puncak = 0
  resetNexabotLaneJobs()
  process.env.NEXABOT_SUBMIT_CONCURRENCY = '1'
  process.env.NEXABOT_SUBMIT_QUEUE_MAX_WAIT_MS = '5000'
  process.env.NEXABOT_SUBMIT_RETRY_AFTER_S = '3'
  for (const k of ['NEXABOT_JOB_BUSY_RETRY_AFTER_S', 'NEXABOT_JOB_BUSY_COOLDOWN_MS', 'NEXABOT_JOB_MAX_RETRY_AFTER_S']) {
    delete process.env[k]
  }
  globalThis.fetch = (async (input: any) => {
    calls.push(String(input))
    bersamaan += 1
    puncak = Math.max(puncak, bersamaan)
    const next = langkah.shift()
    if (!next) throw new Error(`fetch dipanggil ke-${calls.length} tanpa langkah berikutnya`)
    try {
      return await next()
    } finally {
      bersamaan -= 1
    }
  }) as typeof fetch
})

after(async () => {
  globalThis.fetch = originalFetch
  delete process.env.NEXABOT_PROXY_RETRY_BASE_MS
  delete process.env.NEXABOT_PROXY_RETRY_MAX_MS
  for (const k of [
    'NEXABOT_SUBMIT_CONCURRENCY',
    'NEXABOT_SUBMIT_QUEUE_MAX_WAIT_MS',
    'NEXABOT_SUBMIT_RETRY_AFTER_S',
    'NEXABOT_JOB_BUSY_RETRY_AFTER_S',
    'NEXABOT_JOB_BUSY_COOLDOWN_MS',
    'NEXABOT_JOB_MAX_RETRY_AFTER_S',
  ]) {
    delete process.env[k]
  }
  resetNexabotLaneJobs()
  await new Promise((resolve) => server.close(resolve))
})

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await originalFetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : undefined }
}

test('/submit saat job sebelumnya masih berjalan: ditahan relay, lanjut setelah job selesai', async () => {
  langkah = [
    upstreamOk({ ok: true, job_id: 'job-satu' }),
    upstreamOk({ ok: true, job: { id: 'job-satu', status: 'done' } }),
    upstreamOk({ ok: true, job_id: 'job-dua' }),
  ]

  const pertama = await post('/api/public/nexabot/submit', { mode: 't2v', prompt: 'satu' }, { 'X-Nexabot-Cookie': KUE_A })
  assert.equal(pertama.status, 200)

  const kedua = await post('/api/public/nexabot/submit', { mode: 't2v', prompt: 'dua' }, { 'X-Nexabot-Cookie': KUE_A })
  assert.equal(kedua.status, 429)
  assert.equal(kedua.body.queued, true, 'klien tahu ini antrean kita, bukan rate limit acak')
  assert.match(kedua.body.error, /satu job/)
  assert.match(kedua.body.error, /saldo belum terpotong/)
  assert.ok(Number(kedua.headers.get('retry-after')) >= 1)
  assert.equal(calls.length, 1, 'submit kedua tidak pernah sampai ke upstream')

  const poll = await getJson('/api/public/nexabot/job/job-satu', { 'X-Nexabot-Cookie': KUE_A })
  assert.equal(poll.status, 200)
  assert.equal(calls.length, 2)

  const ketiga = await post('/api/public/nexabot/submit', { mode: 't2v', prompt: 'tiga' }, { 'X-Nexabot-Cookie': KUE_A })
  assert.equal(ketiga.status, 200, 'job selesai → giliran member berikutnya jalan')
  assert.equal(ketiga.body.job_id, 'job-dua')
  assert.equal(calls.length, 3)
})

test('job yang gagal juga melepas lane', async () => {
  langkah = [
    upstreamOk({ ok: true, job_id: 'job-gagal' }),
    upstreamOk({ ok: true, job: { id: 'job-gagal', status: 'failed' } }),
    upstreamOk({ ok: true, job_id: 'job-setelah-gagal' }),
  ]

  await post('/api/public/nexabot/submit', { mode: 't2v', prompt: 'satu' }, { 'X-Nexabot-Cookie': KUE_A })
  await getJson('/api/public/nexabot/job/job-gagal', { 'X-Nexabot-Cookie': KUE_A })
  const berikutnya = await post('/api/public/nexabot/submit', { mode: 't2v', prompt: 'dua' }, { 'X-Nexabot-Cookie': KUE_A })

  assert.equal(berikutnya.status, 200, 'job gagal tidak boleh mengunci akun')
  assert.equal(berikutnya.body.job_id, 'job-setelah-gagal')
})

test('dua submit bersamaan di satu akun: hanya satu yang dikirim ke upstream', async () => {
  langkah = [upstreamLambat(80, { ok: true, job_id: 'job-bersamaan' })]

  const hasil = await Promise.all([
    post('/api/public/nexabot/submit', { mode: 't2v', prompt: 'satu' }, { 'X-Nexabot-Cookie': KUE_A }),
    post('/api/public/nexabot/submit', { mode: 't2v', prompt: 'dua' }, { 'X-Nexabot-Cookie': KUE_A }),
  ])

  assert.deepEqual(hasil.map((r) => r.status).sort(), [200, 429], 'satu jalan, satu dipersilakan menunggu')
  assert.equal(calls.length, 1)
  assert.equal(puncak, 1, 'tidak pernah dua submit bersamaan ke akun yang sama')
})

test('upstream menolak karena job lain berjalan → cooldown, submit berikutnya tidak menembak upstream', async () => {
  process.env.NEXABOT_JOB_BUSY_COOLDOWN_MS = '60000'
  langkah = [
    upstreamOk({ ok: false, error: 'Generate sedang berjalan. Tunggu selesai sebelum generate lagi (mode unlimited).' }),
    upstreamOk({ ok: true, job_id: 'job-nanti' }),
  ]

  const pertama = await post('/api/public/nexabot/submit', { mode: 't2v', prompt: 'satu' }, { 'X-Nexabot-Cookie': KUE_A })
  assert.equal(pertama.status, 200, 'penolakan upstream diteruskan apa adanya')
  assert.equal(pertama.body.ok, false)

  const kedua = await post('/api/public/nexabot/submit', { mode: 't2v', prompt: 'dua' }, { 'X-Nexabot-Cookie': KUE_A })
  assert.equal(kedua.status, 429)
  assert.equal(kedua.body.queued, true)
  assert.equal(calls.length, 1, 'setelah upstream bilang sibuk, relay berhenti menembak')
})

test('/submit dengan kredensial berbeda tidak diurutkan', async () => {
  langkah = [upstreamLambat(60, { ok: true, job_id: 'job-a' }), upstreamOk({ ok: true, job_id: 'job-b' })]

  await Promise.all([
    post('/api/public/nexabot/submit', { mode: 't2v', prompt: 'satu' }, { 'X-Nexabot-Cookie': KUE_A }),
    post('/api/public/nexabot/submit', { mode: 't2v', prompt: 'dua' }, { 'X-Nexabot-Cookie': KUE_B }),
  ])

  assert.equal(calls.length, 2)
  assert.equal(puncak, 2, 'dua akun berbeda boleh ditembak bersamaan')
})

test('antrean penuh: 429 buatan kita + Retry-After, tanpa menyentuh upstream', async () => {
  process.env.NEXABOT_SUBMIT_QUEUE_MAX_WAIT_MS = '40'
  // Tanpa job_id: yang diuji di sini murni antrean submit (slot), bukan kunci job.
  langkah = [upstreamLambat(400, { ok: true }), upstreamOk({ ok: true, job_id: 'job-baru' })]

  const pertama = post('/api/public/nexabot/submit', { mode: 't2v', prompt: 'sedang jalan' }, { 'X-Nexabot-Cookie': KUE_A })
  await tick(30)
  const kedua = await post('/api/public/nexabot/submit', { mode: 't2v', prompt: 'kena antrean' }, { 'X-Nexabot-Cookie': KUE_A })

  assert.equal(kedua.status, 429)
  assert.equal(kedua.headers.get('retry-after'), '3', 'Retry-After dari env supaya klien tahu kapan boleh lagi')
  assert.equal(kedua.body.ok, false)
  assert.equal(kedua.body.queued, true, 'klien bisa membedakan antrean kita dari rate limit NexaBot')
  assert.equal(kedua.body.retry_after_seconds, 3)
  assert.match(kedua.body.error, /belum terpotong/, 'janji saldo aman harus eksplisit')
  assert.equal(calls.length, 1, 'yang kena antrean tidak pernah dikirim ke upstream')

  await pertama
})

test('/generate (jalur sesi) juga ditahan saat job masih berjalan', async () => {
  langkah = [upstreamLambat(300, { ok: true, job_id: 'gen-satu' }), upstreamOk({ ok: true, job_id: 'gen-dua' })]

  const pertama = post('/api/public/nexabot/generate', { mode: 'i2v', prompt: 'satu' }, { 'X-Nexabot-Cookie': KUE_A })
  await tick(30)
  const kedua = await post('/api/public/nexabot/generate', { mode: 'i2v', prompt: 'dua' }, { 'X-Nexabot-Cookie': KUE_A })

  assert.equal(kedua.status, 429)
  assert.equal(kedua.body.queued, true)
  assert.equal(calls.length, 1)
  assert.equal((await pertama).status, 200)
})

test('/jobpoll read-only TIDAK ikut mengantre di belakang submit', async () => {
  langkah = [
    upstreamLambat(200, { ok: true, job_id: 'job-tahan' }),
    upstreamOk({ ok: true, status: 'completed', video_url: 'https://cdn/job-tahan.mp4' }),
  ]

  const submit = post('/api/public/nexabot/submit', { mode: 't2v', prompt: 'jalan lambat' }, { 'X-Nexabot-Cookie': KUE_A })
  await tick(30)
  const mulai = Date.now()
  const poll = await getJson('/api/public/nexabot/job/job-tahan', { 'X-Nexabot-Cookie': KUE_A })
  assert.equal(poll.status, 200, 'poll status tidak boleh ditahan antrean submit')
  assert.ok(Date.now() - mulai < 150, 'poll dijawab sebelum submit lambat selesai')

  await submit
})

async function getJson(path: string, headers: Record<string, string> = {}) {
  const res = await originalFetch(`${base}${path}`, { headers })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}
