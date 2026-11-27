// ─── Test helper notifikasi + endpoint read-all ─────────────────────────────
//
// Pola mengikuti test/adminDeleteUser.test.ts: DB sementara sendiri
// (ARKXMOTION_DB_PATH di-set SEBELUM import db), JWT_SECRET uji, route
// dipasang di express port 0. Tidak ada email/push di sini — notifikasi
// in-app saja, sesuai scope yang disetujui.
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import express from 'express'
import jwt from 'jsonwebtoken'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'data', 'test-notifications.db')

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
process.env.ARKXMOTION_DB_PATH = DB_PATH
const JWT_SECRET = 'test-secret-notifications'
process.env.JWT_SECRET = JWT_SECRET

const db = (await import('../server/db.js')).default as any
const notif = await import('../server/lib/notifications.js')
const notificationsRoutes = (await import('../server/routes/notifications.js')).default

const USER1 = 1
const USER2 = 2
const tokenUser1 = jwt.sign({ id: USER1, email: 'u1@test.local', role: 'user' }, JWT_SECRET)
const tokenUser2 = jwt.sign({ id: USER2, email: 'u2@test.local', role: 'user' }, JWT_SECRET)

const app = express()
app.use(express.json())
app.use('/api/notifications', notificationsRoutes)

let server: ReturnType<typeof app.listen>
let base = ''

before(async () => {
  server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  db.prepare(`INSERT INTO users (id, email, password, name, role, approved) VALUES (?, 'u1@test.local', 'x', 'User Satu', 'user', 1)`).run(USER1)
  db.prepare(`INSERT INTO users (id, email, password, name, role, approved) VALUES (?, 'u2@test.local', 'x', 'User Dua', 'user', 1)`).run(USER2)
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  try { db.close() } catch { /* sudah tertutup */ }
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })
})

async function api(method: string, path: string, opts: { token?: string } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

function jumlahBelumDibaca(userId: number) {
  return (db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0').get(userId) as { n: number }).n
}

test('createNotification: menulis baris personal + link, judul dipotong 200 karakter', () => {
  const id = notif.createNotification({
    userId: USER1,
    type: 'success',
    title: 'Generate selesai',
    message: 'NexaBot · video kucing — hasilnya sudah bisa dilihat di Antrean.',
    link: '/queue',
  })
  assert.ok(id > 0)
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as any
  assert.equal(row.target, 'users')
  assert.equal(row.user_id, USER1)
  assert.equal(row.link, '/queue')
  assert.equal(row.read, 0)

  const panjang = notif.createNotification({
    userId: USER1,
    type: 'info',
    title: 'x'.repeat(500),
    message: 'm',
  })
  const rowPanjang = db.prepare('SELECT * FROM notifications WHERE id = ?').get(panjang) as any
  assert.equal(rowPanjang.title.length, 200)
})

test('buatNotifikasiJob: done → success + link /queue; failed → error; pending → null', () => {
  const jobDasar = { user_id: USER1, provider: 'nexabot', job_id: 'nx-1', page: 'motion', prompt: 'animasi logo', result_url: '', last_error: '' }
  const idDone = notif.buatNotifikasiJob({ ...jobDasar, status: 'done' })
  assert.ok(idDone)
  const rowDone = db.prepare('SELECT * FROM notifications WHERE id = ?').get(idDone) as any
  assert.equal(rowDone.type, 'success')
  assert.equal(rowDone.link, '/queue')
  assert.match(rowDone.title, /selesai/)
  assert.match(rowDone.message, /animasi logo/)

  const idGagal = notif.buatNotifikasiJob({ ...jobDasar, job_id: 'nx-2', status: 'failed', last_error: 'saldo habis' })
  assert.ok(idGagal)
  const rowGagal = db.prepare('SELECT * FROM notifications WHERE id = ?').get(idGagal) as any
  assert.equal(rowGagal.type, 'error')
  assert.match(rowGagal.message, /saldo habis/)

  assert.equal(notif.buatNotifikasiJob({ ...jobDasar, job_id: 'nx-3', status: 'pending' }), null)
  assert.equal(notif.buatNotifikasiJob({ ...jobDasar, job_id: 'nx-4', status: 'processing' }), null)
})

test('pruneOldNotifications: hanya menghapus yang lebih tua dari 30 hari', () => {
  db.prepare(`INSERT INTO notifications (title, message, target, user_id, created_at) VALUES ('lama', 'm', 'users', ?, datetime('now', '-40 days'))`).run(USER1)
  db.prepare(`INSERT INTO notifications (title, message, target, user_id, created_at) VALUES ('baru', 'm', 'users', ?, datetime('now', '-5 days'))`).run(USER1)
  const dihapus = notif.pruneOldNotifications(30)
  assert.equal(dihapus, 1)
  const sisa = db.prepare(`SELECT title FROM notifications WHERE user_id = ? AND title IN ('lama', 'baru')`).all(USER1) as any[]
  assert.deepEqual(sisa.map((r) => r.title), ['baru'])
})

test('PATCH /read-all tanpa token → 401', async () => {
  const res = await api('PATCH', '/api/notifications/read-all')
  assert.equal(res.status, 401)
})

test('PATCH /read-all hanya menandai baris milik pemanggil', async () => {
  db.prepare(`INSERT INTO notifications (title, message, target, user_id) VALUES ('u1-a', 'm', 'users', ?)`).run(USER1)
  db.prepare(`INSERT INTO notifications (title, message, target, user_id) VALUES ('u1-b', 'm', 'users', ?)`).run(USER1)
  db.prepare(`INSERT INTO notifications (title, message, target, user_id) VALUES ('u2-a', 'm', 'users', ?)`).run(USER2)
  db.prepare(`INSERT INTO notifications (title, message, target, user_id) VALUES ('siaran', 'm', 'all', NULL)`).run()

  const sebelumU2 = jumlahBelumDibaca(USER2)
  assert.ok(sebelumU2 >= 1)

  const res = await api('PATCH', '/api/notifications/read-all', { token: tokenUser1 })
  assert.equal(res.status, 200, JSON.stringify(res.data))
  assert.ok((res.data as any).marked >= 2)

  assert.equal(jumlahBelumDibaca(USER1), 0, 'semua baris user 1 harus terbaca')
  assert.equal(jumlahBelumDibaca(USER2), sebelumU2, 'baris user 2 tidak boleh tersentuh')
  const siaran = db.prepare(`SELECT read FROM notifications WHERE title = 'siaran'`).get() as any
  assert.equal(siaran.read, 0, 'broadcast (user_id NULL) tidak ditandai oleh read-all — keterbatasan skema yang didokumentasikan')
})

test('route terpasang + worker dijalankan di server/index.ts', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.ts'), 'utf8')
  assert.ok(source.includes("app.use('/api/notifications'"), 'route /api/notifications tidak terpasang')
  assert.ok(source.includes('startQueueWorker()'), 'queue worker tidak dijalankan saat start')
})
