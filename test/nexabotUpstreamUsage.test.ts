// ─── Biaya upstream NexaBot dicatat per job ─────────────────────────────────
//
// Pertanyaan yang harus bisa dijawab setelah ini: "paket Unlimited yang saya jual
// menutup biaya atau saya yang mensubsidi?" Pembukuan lokal tidak bisa menjawab,
// karena member Unlimited memang dicatat dengan biaya 0 — justru itu masalahnya.
//
// Tes ini menjalankan relay sungguhan dengan upstream TIRUAN (NEXABOT_BASE
// diarahkan ke server lokal di tes ini), jadi yang diuji adalah perilaku relay
// yang sebenarnya: rute mana yang dicatat, atribusi ke member mana, dan apa yang
// tersimpan saat upstream melaporkan biaya — juga saat TIDAK melaporkannya.
//
// Dua hal yang tidak boleh terjadi dan dikunci di sini: rahasia kredensial tidak
// boleh tersimpan dalam bentuk apa pun, dan biaya yang tidak dilaporkan upstream
// tidak boleh diisi angka karangan.
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import express from 'express'
import jwt from 'jsonwebtoken'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const DB_PATH = path.join(os.tmpdir(), `arkxmotion-nxb-usage-${process.pid}.db`)
process.env.ARKXMOTION_DB_PATH = DB_PATH
const JWT_SECRET = 'test-secret-nexabot-usage'
process.env.JWT_SECRET = JWT_SECRET

const requireRepo = createRequire(path.join(ROOT, 'package.json'))
const Database = requireRepo('better-sqlite3') as new (file: string) => any

// ── Upstream tiruan ──────────────────────────────────────────────────────────
// `biayaDilaporkan = false` meniru upstream yang tidak mengirim angka biaya.
let biayaDilaporkan = true
const permintaanUpstream: string[] = []

const upstream = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    permintaanUpstream.push(`${req.method} ${req.url}`)
    res.setHeader('Content-Type', 'application/json')

    if (req.method === 'POST' && (req.url === '/api/v1/generate' || req.url === '/api/v1/api')) {
      const jawab: Record<string, unknown> = { ok: true, job_id: 'job-' + permintaanUpstream.length, status: 'queued' }
      if (biayaDilaporkan) jawab.credits = 0.25
      res.end(JSON.stringify(jawab))
      return
    }
    if (req.method === 'GET' && req.url.startsWith('/api/v1/jobs/')) {
      res.end(JSON.stringify({ ok: true, status: 'done', url: 'https://cdn.example/v.mp4' }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ ok: false, error: 'not found' }))
  })
})

let upstreamPort = 0

let server: ReturnType<ReturnType<typeof express>['listen']>
let base = ''
let relayRoutes: any
let walletRoutes: any

const MEMBER = 1001
const MEMBER_LAIN = 1002
const ADMIN = { id: 900, email: 'admin@test.local', role: 'admin' }
const COOKIE = 'session=cookie-RAHASIA-nexabot; token=token-RAHASIA'
const API_KEY = 'apikey-RAHASIA-12345'

const tokenUntuk = (payload: Record<string, unknown>) => jwt.sign(payload, JWT_SECRET)

async function panggilRelay(jalur: string, opts: { headers?: Record<string, string>; method?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}${jalur}`, {
    method: opts.method || 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* bukan JSON */ }
  return { status: res.status, text, json }
}

const kirimGenerate = (headers: Record<string, string>) =>
  panggilRelay('/api/public/nexabot/generate', { headers, body: { mode: 't2v', prompt: 'uji' } })

const kirimSubmit = (headers: Record<string, string>) =>
  panggilRelay('/api/public/nexabot/submit', { headers, body: { mode: 't2v', prompt: 'uji' } })

function barisPemakaian() {
  const db = new Database(DB_PATH)
  const rows = db.prepare('SELECT * FROM nexabot_upstream_usage ORDER BY id ASC').all()
  db.close()
  return rows as Array<Record<string, any>>
}

function jalankanSql(sql: string, ...args: unknown[]) {
  const db = new Database(DB_PATH)
  const info = db.prepare(sql).run(...args)
  db.close()
  return info
}

before(async () => {
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => {
    upstreamPort = (upstream.address() as AddressInfo).port
    resolve()
  }))
  // HARUS sebelum modul relay dimuat: NEXABOT_BASE dibaca saat impor.
  process.env.NEXABOT_BASE = `http://127.0.0.1:${upstreamPort}`

  relayRoutes = (await import('../server/routes/nexabot.js')).default
  walletRoutes = (await import('../server/routes/nexabotWallet.js')).default

  const app = express()
  app.use(express.json())
  app.use('/api/public/nexabot', relayRoutes)
  app.use('/api/nexabot', walletRoutes)
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => {
  server.close()
  upstream.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix) } catch { /* belum ada / terkunci */ }
  }
})

// ── Pencatatan per job ──────────────────────────────────────────────────────

test('generate dengan cookie dicatat sebagai cookie, biaya dari upstream disimpan', async () => {
  const hasil = await kirimGenerate({ 'x-nexabot-cookie': COOKIE, Authorization: `Bearer ${tokenUntuk({ id: MEMBER, role: 'user' })}` })

  assert.equal(hasil.status, 200, hasil.text)
  // Relay harus tetap meneruskan respons upstream apa adanya.
  assert.equal(hasil.json?.ok, true)
  assert.ok(hasil.json?.job_id, 'job_id upstream tidak diteruskan')

  const rows = barisPemakaian()
  assert.equal(rows.length, 1, `harusnya 1 baris pemakaian, ada ${rows.length}`)
  const row = rows[0]
  assert.equal(row.user_id, MEMBER, 'pemakaian tidak teratribusi ke member yang memicunya')
  assert.equal(row.route, 'generate')
  assert.equal(row.credential_kind, 'cookie')
  assert.equal(row.status_code, 200)
  assert.equal(Number(row.cost_value), 0.25, 'angka biaya upstream tidak tersimpan')
  assert.match(String(row.cost_field), /credit/i)
})

test('submit dengan API key dicatat sebagai api-key', async () => {
  const sebelum = barisPemakaian().length
  const hasil = await kirimSubmit({ 'x-api-key': API_KEY, Authorization: `Bearer ${tokenUntuk({ id: MEMBER, role: 'user' })}` })
  assert.equal(hasil.status, 200, hasil.text)

  const rows = barisPemakaian()
  assert.equal(rows.length, sebelum + 1)
  const row = rows[rows.length - 1]
  assert.equal(row.credential_kind, 'api-key')
  assert.equal(row.route, 'submit')
  assert.equal(row.user_id, MEMBER)
})

test('rute baca (poll job) TIDAK dicatat', async () => {
  // Kalau poll ikut dicatat, tabelnya tenggelam oleh poll tiap detik dan
  // angkanya tidak lagi menggambarkan pemakaian kuota.
  const sebelum = barisPemakaian().length
  const hasil = await panggilRelay('/api/public/nexabot/job/job-1', {
    method: 'GET',
    headers: { 'x-api-key': API_KEY },
  })
  assert.equal(hasil.status, 200, hasil.text)
  assert.equal(barisPemakaian().length, sebelum, 'rute baca ikut tercatat')
})

test('tanpa JWT app tetap tercatat dan respons tetap sukses — hanya atribusinya kosong', async () => {
  const sebelum = barisPemakaian().length
  const hasil = await kirimGenerate({ 'x-nexabot-cookie': COOKIE })
  assert.equal(hasil.status, 200, hasil.text)

  const rows = barisPemakaian()
  assert.equal(rows.length, sebelum + 1)
  assert.equal(rows[rows.length - 1].user_id, null, 'pemanggil tanpa identitas seharusnya tercatat tanpa user')
})

test('JWT app yang tidak sah tidak menjatuhkan relay', async () => {
  const sebelum = barisPemakaian().length
  const hasil = await kirimGenerate({ 'x-nexabot-cookie': COOKIE, Authorization: 'Bearer bukan.jwt.sah' })
  assert.equal(hasil.status, 200, hasil.text)
  assert.equal(barisPemakaian().length, sebelum + 1)
  assert.equal(barisPemakaian()[sebelum].user_id, null)
})

test('rahasia kredensial tidak pernah tersimpan', async () => {
  const rows = barisPemakaian()
  assert.ok(rows.length > 0)
  for (const row of rows) {
    const teks = JSON.stringify(row)
    assert.ok(!teks.includes(COOKIE), 'cookie tersimpan di baris pemakaian')
    assert.ok(!teks.includes('RAHASIA-nexabot'), 'potongan cookie tersimpan')
    assert.ok(!teks.includes(API_KEY), 'API key tersimpan')
  }
  // Sidik jarinya harus ada, dan harus berbeda antar kredensial.
  const sidik = new Set(rows.map((r) => r.credential_fingerprint))
  assert.ok(sidik.size >= 2, 'sidik jari kredensial tidak membedakan cookie dari API key')
  for (const s of sidik) assert.match(String(s), /^[0-9a-f]{12}$/)
})

test('biaya yang tidak dilaporkan upstream dibiarkan kosong, bukan diisi angka', async () => {
  biayaDilaporkan = false
  try {
    const sebelum = barisPemakaian().length
    const hasil = await kirimGenerate({ 'x-nexabot-cookie': COOKIE, Authorization: `Bearer ${tokenUntuk({ id: MEMBER, role: 'user' })}` })
    assert.equal(hasil.status, 200, hasil.text)

    const row = barisPemakaian()[sebelum]
    assert.equal(row.user_id, MEMBER)
    assert.equal(row.cost_value, null, 'biaya diisi padahal upstream tidak melaporkannya')
    assert.equal(row.cost_field, null)
    assert.equal(row.evidence, null)
  } finally {
    biayaDilaporkan = true
  }
})

// ── Laporan: angka subsidinya ───────────────────────────────────────────────

test('laporan admin memisahkan job per jenis kredensial dan menghitung subsidinya', async () => {
  // Member punya paket Unlimited aktif → biaya lokalnya 0, tapi job-nya tetap
  // dibayar upstream. Itu yang harus terlihat di laporan.
  // Baris wallet punya foreign key ke users, jadi user-nya harus ada lebih dulu
  // (relay publik tidak punya kewajiban itu — tabel pemakaian upstream sengaja
  // tanpa FK supaya pemanggil tanpa akun tetap bisa tercatat).
  for (const [id, email, role] of [[MEMBER, 'member@test.local', 'user'], [MEMBER_LAIN, 'lain@test.local', 'user'], [ADMIN.id, ADMIN.email, 'admin']] as const) {
    jalankanSql(
      `INSERT OR IGNORE INTO users (id, email, password, name, role, approved) VALUES (?, ?, 'x', 'uji', ?, 1)`,
      id, email, role,
    )
  }

  jalankanSql(
    `INSERT INTO nexabot_topup (user_id, amount, status, kind, days, package_slug, started_at, expires_at)
     VALUES (?, 99000, 'approved', 'unlimited', 30, 'unlimited_monthly', datetime('now'), datetime('now', '+30 days'))`,
    MEMBER,
  )
  // Member lain tanpa paket: dia membayar lokal, jadi pemasukan terlihat.
  jalankanSql(
    `INSERT INTO nexabot_usage (user_id, model, cost, batch_id, status) VALUES (?, 't2v', 250, '', 'used')`,
    MEMBER_LAIN,
  )

  const res = await fetch(`${base}/api/nexabot/admin/upstream-usage?days=30`, {
    headers: { Authorization: `Bearer ${tokenUntuk(ADMIN)}` },
  })
  assert.equal(res.status, 200)
  const laporan = await res.json()

  const member = laporan.users.find((u: any) => u.user_id === MEMBER)
  assert.ok(member, 'member tidak muncul di laporan')
  assert.equal(member.email, 'member@test.local', 'email member tidak ikut dilaporkan')
  assert.equal(member.unlimited_active, true, 'paket Unlimited aktif tidak terbaca')
  assert.ok(member.unlimited_expires_at, 'masa berlaku paket tidak ikut dilaporkan')
  assert.ok(member.jobs_api_key >= 1, 'job yang memakai API key tidak dihitung')
  assert.ok(member.jobs_cookie >= 1, 'job yang memakai cookie tidak dihitung')
  assert.equal(member.local_revenue, 0, 'member Unlimited seharusnya tidak membayar lokal')
  assert.ok(member.subsidy_known > 0, 'subsidi tidak terlihat padahal biaya upstream dilaporkan')
  assert.equal(member.jobs_cost_unknown, 1, 'job tanpa angka biaya tidak dipisahkan')

  // Sidik jari kredensial per member: dua jenis = dua kredensial berbeda.
  assert.equal(member.credentials.length >= 2, true, 'kredensial per member tidak dirinci')

  const tanpaIdentitas = laporan.users.find((u: any) => u.user_id === null)
  assert.ok(tanpaIdentitas, 'pemakaian tanpa identitas tidak muncul sebagai keranjang sendiri')
  assert.ok(tanpaIdentitas.jobs >= 1)
  assert.equal(tanpaIdentitas.unlimited_active, false)

  assert.ok(laporan.totals.jobs >= member.jobs)
  assert.equal(laporan.totals.local_revenue, 250, 'pemasukan lokal member lain tidak ikut terhitung')
  assert.match(String(laporan.note), /upstream/i)
})

test('laporan hanya untuk admin', async () => {
  const tanpaAuth = await fetch(`${base}/api/nexabot/admin/upstream-usage`)
  assert.equal(tanpaAuth.status, 401)

  const sebagaiMember = await fetch(`${base}/api/nexabot/admin/upstream-usage`, {
    headers: { Authorization: `Bearer ${tokenUntuk({ id: MEMBER, role: 'user' })}` },
  })
  assert.equal(sebagaiMember.status, 403)
})
