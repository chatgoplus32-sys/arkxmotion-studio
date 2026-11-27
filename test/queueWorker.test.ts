// ─── Test worker antrean generasi ────────────────────────────────────────────
//
// Pola mengikuti test/adminDeleteUser.test.ts: DB sementara sendiri
// (ARKXMOTION_DB_PATH di-set SEBELUM import db), JWT_SECRET uji, dan
// upstream DIPALSUKAN — tidak ada request ke nexabot.id / api.posbot.web.id
// yang keluar dari test ini. fetch stub disuntikkan ke jalankanTickSekali.
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'data', 'test-queue-worker.db')

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
process.env.ARKXMOTION_DB_PATH = DB_PATH
process.env.JWT_SECRET = 'test-secret-queue-worker'
// Kunci server PALSU untuk test (bukan kredensial asli): worker membacanya
// dari env/app_settings persis seperti di produksi.
process.env.POSBOT_MASTER_API_KEY = 'test-posbot-key-uji'

const db = (await import('../server/db.js')).default as any
const worker = await import('../server/lib/queueWorker.js')

const USER_ID = 1
const now = Date.now()

function seedJob(input: {
  provider: string
  jobId: string
  status?: string
  credentialSource?: string
  serverPoll?: number
  pollMisses?: number
  notifiedAt?: number | null
  prompt?: string
  updatedAt?: number
}) {
  const res = db
    .prepare(
      `INSERT INTO generation_job
       (user_id, provider, job_id, page, prompt, status, credential_source, server_poll, poll_misses, notified_at, created_at, updated_at)
       VALUES (?, ?, ?, 'motion', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      USER_ID,
      input.provider,
      input.jobId,
      input.prompt || '',
      input.status || 'pending',
      input.credentialSource ?? 'server',
      input.serverPoll ?? 1,
      input.pollMisses ?? 0,
      input.notifiedAt ?? null,
      now - 600_000,
      input.updatedAt ?? now - 600_000,
    )
  return Number(res.lastInsertRowid)
}

function bacaJob(jobId: string) {
  return db.prepare('SELECT * FROM generation_job WHERE job_id = ?').get(jobId) as any
}

function hitungNotifikasi(userId = USER_ID) {
  return (db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').get(userId) as { n: number }).n
}

/** fetch palsu: handler menerima (url, init) dan mengembalikan { status, ok, json }. */
function fetchPalsu(handler: (url: string, init: any) => { status: number; body: unknown }) {
  const panggilan: { url: string; init: any }[] = []
  const fn = (async (url: string, init: any) => {
    panggilan.push({ url, init })
    const { status, body } = handler(url, init)
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
  }) as unknown as typeof fetch
  return { fn, panggilan }
}

before(() => {
  db.prepare(`INSERT INTO users (id, email, password, name, role, approved) VALUES (?, 'u@test.local', 'x', 'User Uji', 'user', 1)`).run(USER_ID)
  // Satu akun server NexaBot PALSU (api key uji) supaya serverAccounts() tidak kosong.
  db.prepare(`INSERT INTO app_settings (key, value) VALUES ('nexabot_master_accounts', ?)`)
    .run(JSON.stringify([{ id: 'acc_uji', label: 'Akun uji', api_key: 'test-nexabot-key-uji' }]))
})

after(async () => {
  try { db.close() } catch { /* sudah tertutup */ }
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
})

test('petakanStatusNexabot: completed/failed/berjalan/tidak-dikenal', () => {
  const p = (obj: unknown) => worker.petakanStatusNexabot(JSON.stringify(obj))
  assert.equal(p({ job: { status: 'completed' } }), 'selesai')
  assert.equal(p({ status: 'success' }), 'selesai')
  assert.equal(p({ job: { status: 'completed_with_error' } }), 'selesai')
  assert.equal(p({ job: { status: 'failed' } }), 'gagal')
  assert.equal(p({ status: 'cancelled' }), 'gagal')
  assert.equal(p({ job: { status: 'processing' } }), 'berjalan')
  assert.equal(p({ job: { status: 'queued' } }), 'berjalan')
  assert.equal(p({}), 'sementara')
  assert.equal(worker.petakanStatusNexabot(''), 'sementara')
  assert.equal(worker.petakanStatusNexabot('bukan-json'), 'sementara')
})

test('petakanStatusPosbot: completed membawa result_url, failed membawa error', () => {
  const ok = worker.petakanStatusPosbot({ status: 'completed', result_url: 'https://cdn/contoh.mp4' })
  assert.equal(ok.keadaan, 'selesai')
  assert.equal(ok.resultUrl, 'https://cdn/contoh.mp4')
  const gagal = worker.petakanStatusPosbot({ status: 'failed', error: 'saldo habis' })
  assert.equal(gagal.keadaan, 'gagal')
  assert.match(gagal.error || '', /saldo habis/)
  assert.equal(worker.petakanStatusPosbot({ status: 'processing', progress: 40 }).keadaan, 'berjalan')
  assert.equal(worker.petakanStatusPosbot({}).keadaan, 'sementara')
})

test('transisi yang dilaporkan klien diberitahu SEKALI saja (idempoten)', () => {
  seedJob({ provider: 'nexabot', jobId: 'job-klien-1', status: 'done', credentialSource: 'client', prompt: 'video kucing' })
  const sebelum = hitungNotifikasi()
  const dibuat1 = worker.beritahuTransisiKlien()
  assert.equal(dibuat1, 1)
  assert.equal(hitungNotifikasi(), sebelum + 1)
  const notif = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(USER_ID) as any
  assert.equal(notif.type, 'success')
  assert.equal(notif.link, '/queue')
  assert.match(notif.message, /video kucing/)
  assert.notEqual(bacaJob('job-klien-1').notified_at, null)
  // Tick kedua: tidak ada notifikasi baru.
  assert.equal(worker.beritahuTransisiKlien(), 0)
  assert.equal(hitungNotifikasi(), sebelum + 1)
})

test('worker: job PosBot kunci-server selesai → done + result_url + notifikasi', async () => {
  seedJob({ provider: 'posbot', jobId: 'pb-100', prompt: 'iklan sepatu' })
  const { fn, panggilan } = fetchPalsu((url) => {
    assert.match(url, /api\.posbot\.web\.id\/api\/v1\/status\/pb-100/)
    return { status: 200, body: { status: 'completed', result_url: 'https://cdn/pb-100.mp4' } }
  })
  const hasil = await worker.jalankanTickSekali(fn)
  assert.equal(hasil.selesai, 1)
  const job = bacaJob('pb-100')
  assert.equal(job.status, 'done')
  assert.equal(job.result_url, 'https://cdn/pb-100.mp4')
  assert.notEqual(job.notified_at, null)
  const notif = db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'success' ORDER BY id DESC LIMIT 1").get(USER_ID) as any
  assert.ok(notif, 'notifikasi selesai harus ada')
  assert.match(notif.message, /iklan sepatu/)
  assert.equal(panggilan.length, 1)
})

test('worker: job NexaBot kunci-server selesai → done, result_url tetap kosong (disimpan klien)', async () => {
  seedJob({ provider: 'nexabot', jobId: 'nx-200', prompt: 'animasi logo' })
  const { fn, panggilan } = fetchPalsu((url, init) => {
    assert.match(url, /nexabot\.id\/api\/v1\/jobs\/nx-200/)
    assert.equal(init.headers['x-api-key'], 'test-nexabot-key-uji')
    return { status: 200, body: { job: { status: 'completed' } } }
  })
  const hasil = await worker.jalankanTickSekali(fn)
  assert.equal(hasil.selesai, 1)
  const job = bacaJob('nx-200')
  assert.equal(job.status, 'done')
  assert.equal(job.result_url, '')
  assert.equal(panggilan.length, 1)
})

test('worker: job gagal upstream → failed + notifikasi error', async () => {
  seedJob({ provider: 'posbot', jobId: 'pb-300' })
  const { fn } = fetchPalsu(() => ({ status: 200, body: { status: 'failed', error: 'model ditolak' } }))
  const hasil = await worker.jalankanTickSekali(fn)
  assert.equal(hasil.gagal, 1)
  const job = bacaJob('pb-300')
  assert.equal(job.status, 'failed')
  assert.match(job.last_error, /model ditolak/)
  const notif = db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'error' ORDER BY id DESC LIMIT 1").get(USER_ID) as any
  assert.ok(notif)
})

test('worker: 404 TIDAK PERNAH menandai gagal — 3 miss mematikan polling server', async () => {
  seedJob({ provider: 'posbot', jobId: 'pb-404' })
  const notifSebelum = hitungNotifikasi()
  const { fn, panggilan } = fetchPalsu(() => ({ status: 404, body: {} }))
  for (let tick = 1; tick <= 3; tick++) {
    await worker.jalankanTickSekali(fn)
    const job = bacaJob('pb-404')
    assert.equal(job.status, 'pending', `tick ${tick}: status harus tetap pending`)
    assert.equal(job.poll_misses, tick)
  }
  const job = bacaJob('pb-404')
  assert.equal(job.server_poll, 0, 'setelah 3 miss polling server harus mati')
  assert.equal(hitungNotifikasi(), notifSebelum, 'tidak ada notifikasi untuk 404')
  const sebelum = panggilan.length
  await worker.jalankanTickSekali(fn)
  assert.equal(panggilan.length, sebelum, 'job yang dimatikan tidak boleh dipoll lagi')
})

test('worker: job berkunci pribadi TIDAK PERNAH dipoll upstream', async () => {
  seedJob({ provider: 'posbot', jobId: 'pb-pribadi', credentialSource: 'client' })
  seedJob({ provider: 'nexabot', jobId: 'nx-pribadi', credentialSource: 'client' })
  const { fn, panggilan } = fetchPalsu(() => ({ status: 200, body: { status: 'completed', result_url: 'https://cdn/x.mp4' } }))
  await worker.jalankanTickSekali(fn)
  assert.equal(panggilan.length, 0, 'tidak boleh ada panggilan upstream untuk kunci pribadi')
  assert.equal(bacaJob('pb-pribadi').status, 'pending')
  assert.equal(bacaJob('nx-pribadi').status, 'pending')
})

test('worker: job yang masih dipegang tab hidup dilewati (grace klaim)', async () => {
  // pending tapi updated_at baru 10 detik lalu (< grace 90 detik)
  seedJob({ provider: 'posbot', jobId: 'pb-baru', updatedAt: Date.now() - 10_000 })
  const { fn, panggilan } = fetchPalsu(() => ({ status: 200, body: { status: 'completed', result_url: 'https://cdn/x.mp4' } }))
  await worker.jalankanTickSekali(fn)
  assert.equal(panggilan.length, 0)
  assert.equal(bacaJob('pb-baru').status, 'pending')
})
