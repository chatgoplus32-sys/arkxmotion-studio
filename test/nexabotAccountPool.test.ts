// ─── Pool akun server NexaBot ───────────────────────────────────────────────
//
// Satu akun hanya boleh menjalankan satu job. Sebelum ada pool, itu berarti
// seluruh member mengantre di satu akun. Yang diuji di sini:
//  1. Admin bisa menambah/menghapus akun tambahan, dan nilainya tidak pernah
//     kembali ke browser (termasuk lewat daftar pengaturan umum).
//  2. Submit mengisi lane akun yang sedang kosong — tiga akun = tiga job
//     berjalan bersamaan, bukan tiga kali menunggu.
//  3. Kalau SEMUA akun sibuk, relay menjawab 429 antrean tanpa menembak upstream.
//  4. Id job hanya berlaku di akun pembuatnya: poll memakai akun yang membuat
//     job itu, lalu kembali ke akun default setelah job selesai.
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import express from 'express'
import jwt from 'jsonwebtoken'
import { resetNexabotLaneJobs } from '../shared/nexabotProxy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DB_PATH = path.join(os.tmpdir(), `arkxmotion-nxb-pool-${process.pid}.db`)
process.env.ARKXMOTION_DB_PATH = DB_PATH
const JWT_SECRET = 'test-secret-nexabot-pool'
process.env.JWT_SECRET = JWT_SECRET
const MASTER = 'kunci-utama-pool-111'
process.env.NEXABOT_MASTER_API_KEY = MASTER
delete process.env.NEXABOT_MASTER_KEY_MODE
delete process.env.NEXABOT_MASTER_DAILY_CAP

const KUNCI_A = 'pool-key-A-222'
const KUNCI_B = 'pool-key-B-333'

import { createRequire } from 'node:module'
const requireRepo = createRequire(path.join(__dirname, '..', 'package.json'))
const Database = requireRepo('better-sqlite3') as new (file: string) => any

interface Panggilan { method: string; url: string; apiKey: string | null; cookie: string | null }
const diterima: Panggilan[] = []
/** Job ke-n diberi id `job-n` supaya akun pembuatnya bisa ditelusuri. */
let submitKe = 0
/** Poll pertama sebuah job masih berjalan; poll kedua melaporkan selesai. */
const pollDihitung = new Map<string, number>()
/**
 * Jeda balasan upstream. Tes submit bersamaan butuh ini: tanpa jeda, submit
 * pertama sudah memasang kunci lane sebelum submit kedua memilih akun, sehingga
 * balapan yang sebenarnya (dua pilihan akun sebelum ada job) tidak pernah terjadi.
 */
let tundaMs = 0

const upstream = http.createServer((req, res) => {
  req.on('data', () => {})
  req.on('end', () => {
    const url = req.url || ''
    diterima.push({
      method: req.method || '',
      url,
      apiKey: (req.headers['x-api-key'] as string) || null,
      cookie: (req.headers['cookie'] as string) || null,
    })
    res.setHeader('Content-Type', 'application/json')

    const poll = url.match(/^\/api\/v1\/jobs\/(.+)$/)
    if (poll) {
      const jobId = poll[1]
      const n = (pollDihitung.get(jobId) || 0) + 1
      pollDihitung.set(jobId, n)
      res.end(JSON.stringify({ ok: true, job: { id: jobId, status: n === 1 ? 'processing' : 'done' } }))
      return
    }

    submitKe += 1
    const body = JSON.stringify({ ok: true, job_id: `job-${submitKe}`, credits: 0.15, est_seconds: 120 })
    if (tundaMs > 0) setTimeout(() => res.end(body), tundaMs)
    else res.end(body)
  })
})

const terakhir = () => diterima[diterima.length - 1]

let server: any
let base = ''

const MEMBER = 8301
const ADMIN = { id: 8300, email: 'admin-pool@test.local', role: 'admin' }
const tokenUntuk = (payload: Record<string, unknown>) => jwt.sign(payload, JWT_SECRET)
const memberToken = () => tokenUntuk({ id: MEMBER, role: 'user' })
const adminToken = () => tokenUntuk(ADMIN)

function jalankanSql(sql: string, ...args: unknown[]) {
  const db = new Database(DB_PATH)
  const info = db.prepare(sql).run(...args)
  db.close()
  return info
}

function bacaSql<T = any>(sql: string, ...args: unknown[]): T[] {
  const db = new Database(DB_PATH)
  const rows = db.prepare(sql).all(...args) as T[]
  db.close()
  return rows
}

/** Tiket pembayaran (usage_id dari /deduct) — wajib untuk kredensial server. */
function tiketBaru(userId: number, cost = 0): string {
  const info = jalankanSql(
    `INSERT INTO nexabot_usage (user_id, model, cost, status) VALUES (?, 't2v', ?, 'used')`,
    userId,
    cost,
  )
  return String(info.lastInsertRowid)
}

const daftarAkun = async () => {
  const res = await fetch(`${base}/api/admin/nexabot/master-accounts`, {
    headers: { Authorization: `Bearer ${adminToken()}` },
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* body bukan JSON */ }
  return { status: res.status, text, json }
}

const tambahAkun = async (body: Record<string, unknown>) => {
  const res = await fetch(`${base}/api/admin/nexabot/master-accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

async function submit() {
  const res = await fetch(`${base}/api/public/nexabot/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberToken()}`,
      'X-Nexabot-Charge': tiketBaru(MEMBER),
    },
    body: JSON.stringify({ mode: 't2v', prompt: 'uji pool akun' }),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

/** Submit dengan header kredensial pilihan (mis. kunci/cookie server dari browser). */
async function submitDengan(headers: Record<string, string>, token = memberToken(), tiket?: string) {
  const res = await fetch(`${base}/api/public/nexabot/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(tiket ? { 'X-Nexabot-Charge': tiket } : {}),
      ...headers,
    },
    body: JSON.stringify({ mode: 't2v', prompt: 'uji kredensial klien' }),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

async function poll(jobId: string) {
  const res = await fetch(`${base}/api/public/nexabot/job/${jobId}`, {
    headers: { Authorization: `Bearer ${memberToken()}` },
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

before(async () => {
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()))
  process.env.NEXABOT_BASE = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`

  const relayRoutes = (await import('../server/routes/nexabot.js')).default
  const adminRoutes = (await import('../server/routes/admin.js')).default

  const app = express()
  app.use(express.json())
  app.use('/api/public/nexabot', relayRoutes)
  app.use('/api/admin', adminRoutes)
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  for (const [id, email, role] of [
    [MEMBER, 'member-pool@test.local', 'user'],
    [ADMIN.id, ADMIN.email, 'admin'],
  ] as const) {
    jalankanSql(`INSERT OR IGNORE INTO users (id, email, password, name, role, approved) VALUES (?, ?, 'x', 'uji', ?, 1)`, id, email, role)
  }
  jalankanSql(`INSERT INTO nexabot_balance (user_id, balance) VALUES (?, 20000)`, MEMBER)
})

after(() => {
  server.close()
  upstream.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix) } catch { /* belum ada / terkunci */ }
  }
})

// ── Hak akses & validasi ────────────────────────────────────────────────────

test('member tidak boleh mengelola pool akun', async () => {
  const routes: { method: string; path: string; body?: string }[] = [
    { method: 'GET', path: '/api/admin/nexabot/master-accounts' },
    { method: 'POST', path: '/api/admin/nexabot/master-accounts', body: JSON.stringify({ apiKey: 'x' }) },
    { method: 'DELETE', path: '/api/admin/nexabot/master-accounts/utama' },
    { method: 'POST', path: '/api/admin/nexabot/master-accounts/utama/check' },
  ]
  for (const r of routes) {
    const res = await fetch(`${base}${r.path}`, {
      method: r.method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberToken()}` },
      body: r.body,
    })
    assert.equal(res.status, 403, `${r.method} ${r.path} menerima member`)
  }
})

test('input akun divalidasi: cookie di kolom kunci, isian kosong, hapus akun utama', async () => {
  const cookieDiKunci = await tambahAkun({ apiKey: 'session=abc; x=y' })
  assert.equal(cookieDiKunci.status, 400)
  assert.match(String(cookieDiKunci.json?.error), /cookie/i)

  const kosong = await tambahAkun({})
  assert.equal(kosong.status, 400)
  assert.match(String(kosong.json?.error), /minimal satu/i)

  const hapusUtama = await fetch(`${base}/api/admin/nexabot/master-accounts/utama`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken()}` },
  })
  assert.equal(hapusUtama.status, 400)
})

// ── Daftar akun ─────────────────────────────────────────────────────────────

test('akun tambahan tersimpan dan nilainya tidak pernah dikirim ke browser', async () => {
  const a = await tambahAkun({ label: 'Akun A', apiKey: KUNCI_A })
  assert.equal(a.status, 200, JSON.stringify(a.json))
  const b = await tambahAkun({ label: 'Akun B', apiKey: KUNCI_B })
  assert.equal(b.status, 200, JSON.stringify(b.json))

  const daftar = await daftarAkun()
  assert.equal(daftar.status, 200)
  const akun = daftar.json.accounts as any[]
  assert.equal(akun.length, 3, 'akun utama + dua tambahan')
  assert.equal(akun[0].id, 'utama')
  assert.equal(akun[0].legacy, true)
  assert.deepEqual(akun.slice(1).map((x) => x.label).sort(), ['Akun A', 'Akun B'])
  assert.ok(akun.slice(1).every((x) => x.has_key && !x.has_cookie))

  assert.doesNotMatch(daftar.text, new RegExp(KUNCI_A))
  assert.doesNotMatch(daftar.text, new RegExp(KUNCI_B))
  assert.doesNotMatch(daftar.text, new RegExp(MASTER))

  // Pengaturan umum juga tidak boleh membocorkan JSON akun mentah.
  const settings = await fetch(`${base}/api/admin/settings`, {
    headers: { Authorization: `Bearer ${adminToken()}` },
  })
  const settingsText = await settings.text()
  assert.doesNotMatch(settingsText, new RegExp(KUNCI_A))
  assert.doesNotMatch(settingsText, /nexabot_master_accounts/)
})

// ── Penyebaran lane ─────────────────────────────────────────────────────────

test('tiga submit berurutan memakai tiga akun berbeda', async () => {
  resetNexabotLaneJobs()

  const satu = await submit()
  assert.equal(satu.status, 200, JSON.stringify(satu.json))
  assert.equal(terakhir().apiKey, MASTER)

  const dua = await submit()
  assert.equal(dua.status, 200, JSON.stringify(dua.json))
  assert.equal(terakhir().apiKey, KUNCI_A, 'lane akun utama sibuk, submit kedua harus pindah akun')

  const tiga = await submit()
  assert.equal(tiga.status, 200, JSON.stringify(tiga.json))
  assert.equal(terakhir().apiKey, KUNCI_B, 'dua lane sibuk, submit ketiga harus ke akun terakhir')
})

test('semua lane sibuk: relay menjawab 429 antrean tanpa menembak upstream', async () => {
  const sebelum = diterima.length
  const hasil = await submit()
  assert.equal(hasil.status, 429, JSON.stringify(hasil.json))
  assert.equal(hasil.json?.queued, true)
  assert.equal(diterima.length, sebelum, 'upstream disentuh padahal semua akun sibuk')
})

test('dua submit bersamaan memakai dua akun berbeda', async () => {
  // Lane dari tes sebelumnya dilepas: yang diuji di sini pemilihan akun, bukan
  // penjadwalan job yang sudah berjalan.
  resetNexabotLaneJobs()

  tundaMs = 150
  try {
    const [satu, dua] = await Promise.all([submit(), submit()])
    assert.equal(satu.status, 200, JSON.stringify(satu.json))
    assert.equal(dua.status, 200, JSON.stringify(dua.json))
    assert.notEqual(satu.json?.job_id, dua.json?.job_id)
  } finally {
    tundaMs = 0
  }

  const akunDipakai = diterima.slice(-2).map((x) => x.apiKey).sort()
  assert.deepEqual(
    akunDipakai,
    [MASTER, KUNCI_A].sort(),
    'dua submit yang datang bersamaan jatuh ke akun yang sama — submit kedua akan mengantre padahal akun lain kosong',
  )
})

test('kunci server yang dikirim browser dilayani lane pool, jejaknya tetap dicatat', async () => {
  // Browser yang masih menyimpan kunci server mengirimnya sebagai X-Api-Key.
  // Dulu relay memakai kunci itu apa adanya, jadi semua generate dari browser
  // berebut satu akun. Sekarang lanenya dipilih dari pool — kuncinya tetap milik
  // operator yang sama, jadi tidak ada biaya tambahan.
  resetNexabotLaneJobs()

  tundaMs = 150
  try {
    const [satu, dua] = await Promise.all([
      submitDengan({ 'x-api-key': KUNCI_A }, memberToken(), tiketBaru(MEMBER)),
      submitDengan({ 'x-api-key': KUNCI_A }, memberToken(), tiketBaru(MEMBER)),
    ])
    assert.equal(satu.status, 200, JSON.stringify(satu.json))
    assert.equal(dua.status, 200, JSON.stringify(dua.json))
  } finally {
    tundaMs = 0
  }

  const akunDipakai = diterima.slice(-2).map((x) => x.apiKey).sort()
  assert.deepEqual(akunDipakai, [MASTER, KUNCI_A].sort(), 'kunci dari browser dipaku ke satu akun')

  const jejak = bacaSql<{ credential_source: string }>(
    `SELECT credential_source FROM nexabot_upstream_usage ORDER BY id DESC LIMIT 2`,
  )
  assert.deepEqual(
    jejak.map((x) => x.credential_source),
    ['client-master', 'client-master'],
    'laporan admin kehilangan jejak bahwa kunci server masih beredar di browser',
  )
})

// ── Afinitas job → akun ─────────────────────────────────────────────────────

test('poll job memakai akun yang membuatnya', async () => {
  const dua = await poll('job-2')
  assert.equal(dua.status, 200, JSON.stringify(dua.json))
  assert.equal(terakhir().url, '/api/v1/jobs/job-2')
  assert.equal(terakhir().apiKey, KUNCI_A, 'poll job akun A dikirim dengan kunci akun lain')

  const tiga = await poll('job-3')
  assert.equal(tiga.status, 200, JSON.stringify(tiga.json))
  assert.equal(terakhir().apiKey, KUNCI_B)
})

test('setelah job selesai, poll berikutnya kembali ke akun default', async () => {
  // Poll kedua untuk job-2 melaporkan selesai → lane A dilepas dan afinitas lupa.
  const selesai = await poll('job-2')
  assert.equal(selesai.status, 200)
  assert.equal(terakhir().apiKey, KUNCI_A, 'poll terakhir job-2 tetap harus ke akun pembuatnya')

  const sesudahnya = await poll('job-2')
  assert.equal(sesudahnya.status, 200)
  assert.equal(terakhir().apiKey, MASTER, 'afinitas job tidak dilepas setelah job selesai')
})

// ── Hapus akun ──────────────────────────────────────────────────────────────

test('akun tambahan bisa dihapus dan lane-nya tidak dipakai lagi', async () => {
  const daftar = await daftarAkun()
  const b = (daftar.json.accounts as any[]).find((x) => x.label === 'Akun B')
  assert.ok(b)

  const res = await fetch(`${base}/api/admin/nexabot/master-accounts/${b.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken()}` },
  })
  assert.equal(res.status, 200)
  const sisa = (await res.json()).accounts as any[]
  assert.equal(sisa.length, 2)
  assert.ok(!sisa.some((x) => x.label === 'Akun B'))

  const baris = bacaSql<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'nexabot_master_accounts'`,
  )
  assert.doesNotMatch(baris[0].value, new RegExp(KUNCI_B))
})

// ── Kredensial klien yang ternyata milik pool ───────────────────────────────

test('cookie sesi yang dikirim browser tapi milik pool: lane pool + wajib tiket', async () => {
  const COOKIE_POOL = 'session=cookie-pool-uji; x=1'
  const tambah = await tambahAkun({ label: 'Akun Cookie', cookie: COOKIE_POOL })
  assert.equal(tambah.status, 200, JSON.stringify(tambah.json))

  resetNexabotLaneJobs()

  // Tanpa tiket: relay yang menyuntikkan kredensial server, jadi aturannya sama
  // dengan kunci server — bukan cookie pribadi member yang bebas tiket.
  const tanpaTiket = await submitDengan({ 'X-Nexabot-Cookie': COOKIE_POOL })
  assert.equal(tanpaTiket.status, 402, JSON.stringify(tanpaTiket.json))
  assert.match(String(tanpaTiket.json?.error), /tiket|terverifikasi/i)

  const nomor = tiketBaru(MEMBER)
  const hasil = await submitDengan({ 'X-Nexabot-Cookie': COOKIE_POOL }, memberToken(), String(nomor))
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))

  const terpakai = diterima[diterima.length - 1]
  assert.equal(terpakai.apiKey, null, 'cookie pool malah diganti kunci akun lain')
  assert.match(String(terpakai.cookie), /cookie-pool-uji/, 'cookie pool tidak dipakai upstream')

  const baris = bacaSql<{ credential_source: string }>(
    `SELECT credential_source FROM nexabot_upstream_usage ORDER BY id DESC LIMIT 1`,
  )
  assert.equal(baris[0].credential_source, 'master')
})
