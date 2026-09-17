// ─── Kunci induk NexaBot tidak lagi beredar di browser ──────────────────────
//
// Sebelum ini, jalur API key mengharuskan klien mengirim `x-api-key` sendiri.
// Artinya kunci apa pun yang dipakai member ada di localStorage browser mereka:
// bisa dibaca lewat devtools lalu dipakai langsung ke nexabot.id — di luar app,
// tidak tercatat, tidak dipotong saldo, tapi tetap ditagihkan ke pemilik akun.
// Dan karena kuncinya satu, mencabut akses satu orang tidak mungkin tanpa
// memutus semua orang.
//
// Tes ini menguji relay sungguhan dengan upstream TIRUAN yang merekam header yang
// diterimanya, sehingga bisa dibuktikan: kunci induk benar-benar disuntikkan di
// server, hanya untuk member yang berhak, tidak pernah dikirim oleh klien, dan
// tidak pernah bisa keluar lewat toko token.
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

const DB_PATH = path.join(os.tmpdir(), `arkxmotion-nxb-master-${process.pid}.db`)
process.env.ARKXMOTION_DB_PATH = DB_PATH
const JWT_SECRET = 'test-secret-nexabot-master'
process.env.JWT_SECRET = JWT_SECRET

const MASTER = 'kunci-induk-RAHASIA-999'
const KUNCI_MEMBER = 'kunci-pribadi-member-123'

const requireRepo = createRequire(path.join(ROOT, 'package.json'))
const Database = requireRepo('better-sqlite3') as new (file: string) => any

// ── Upstream tiruan: merekam header yang benar-benar diterima ───────────────
interface Panggilan { url: string; apiKey: string | null; cookie: string | null }
const diterima: Panggilan[] = []

const upstream = http.createServer((req, res) => {
  req.on('data', () => {})
  req.on('end', () => {
    diterima.push({
      url: req.url || '',
      apiKey: (req.headers['x-api-key'] as string) || null,
      cookie: (req.headers['cookie'] as string) || null,
    })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, job_id: 'job-' + diterima.length, credits: 0.25 }))
  })
})

const terakhir = () => diterima[diterima.length - 1]

let server: any
let base = ''

const BERHAK = 7001
const MISKIN = 7002
const ADMIN = { id: 700, email: 'admin@test.local', role: 'admin' }
const tokenUntuk = (payload: Record<string, unknown>) => jwt.sign(payload, JWT_SECRET)

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

async function submit(headers: Record<string, string>) {
  const res = await fetch(`${base}/api/public/nexabot/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ mode: 't2v', prompt: 'uji' }),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

before(async () => {
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()))
  process.env.NEXABOT_BASE = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
  process.env.NEXABOT_MASTER_API_KEY = MASTER

  const relayRoutes = (await import('../server/routes/nexabot.js')).default
  const walletRoutes = (await import('../server/routes/nexabotWallet.js')).default
  const tokenRoutes = (await import('../server/routes/tokens.js')).default
  const adminTokenRoutes = (await import('../server/routes/adminTokens.js')).default

  const app = express()
  app.use(express.json())
  app.use('/api/public/nexabot', relayRoutes)
  app.use('/api/nexabot', walletRoutes)
  app.use('/api/tokens', tokenRoutes)
  app.use('/api/admin/tokens', adminTokenRoutes)
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  // User dasar (tabel wallet punya foreign key ke users).
  for (const [id, email, role] of [[BERHAK, 'berhak@test.local', 'user'], [MISKIN, 'miskin@test.local', 'user'], [ADMIN.id, ADMIN.email, 'admin']] as const) {
    jalankanSql(`INSERT OR IGNORE INTO users (id, email, password, name, role, approved) VALUES (?, ?, 'x', 'uji', ?, 1)`, id, email, role)
  }
})

after(() => {
  server.close()
  upstream.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix) } catch { /* belum ada / terkunci */ }
  }
})

// ── Penyuntikan di server ───────────────────────────────────────────────────

test('member bersaldo tanpa mengirim kunci: relay menyuntikkan kunci induk', async () => {
  jalankanSql(`INSERT INTO nexabot_balance (user_id, balance) VALUES (?, 50000)`, BERHAK)

  const hasil = await submit({ Authorization: `Bearer ${tokenUntuk({ id: BERHAK, role: 'user' })}` })
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))

  assert.equal(terakhir().apiKey, MASTER, 'kunci induk tidak sampai ke upstream')
  const rows = bacaSql(`SELECT * FROM nexabot_upstream_usage ORDER BY id DESC LIMIT 1`)
  assert.equal(rows[0].credential_source, 'master', 'sumber kredensial tidak ditandai master')
  assert.equal(rows[0].user_id, BERHAK, 'pemakaian kunci induk tidak teratribusi ke member')
})

test('member tanpa saldo dan tanpa paket tidak boleh memakai kunci induk, dan upstream tidak dipanggil', async () => {
  const sebelum = diterima.length
  const hasil = await submit({ Authorization: `Bearer ${tokenUntuk({ id: MISKIN, role: 'user' })}` })

  assert.equal(hasil.status, 400, JSON.stringify(hasil.json))
  assert.match(String(hasil.json?.error), /saldo|paket/i)
  assert.equal(diterima.length, sebelum, 'relay tetap menembak upstream padahal membernya tidak berhak')
})

test('paket Unlimited aktif juga membuka kunci induk', async () => {
  jalankanSql(
    `INSERT INTO nexabot_topup (user_id, amount, status, kind, days, package_slug, started_at, expires_at)
     VALUES (?, 99000, 'approved', 'unlimited', 30, 'unlimited_monthly', datetime('now'), datetime('now', '+30 days'))`,
    MISKIN,
  )

  const hasil = await submit({ Authorization: `Bearer ${tokenUntuk({ id: MISKIN, role: 'user' })}` })
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))
  assert.equal(terakhir().apiKey, MASTER)
})

test('kunci milik member sendiri tetap dipakai apa adanya', async () => {
  const hasil = await submit({ 'x-api-key': KUNCI_MEMBER, Authorization: `Bearer ${tokenUntuk({ id: BERHAK, role: 'user' })}` })
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))
  assert.equal(terakhir().apiKey, KUNCI_MEMBER, 'kunci pribadi member ditimpa kunci induk')

  const rows = bacaSql(`SELECT * FROM nexabot_upstream_usage ORDER BY id DESC LIMIT 1`)
  assert.equal(rows[0].credential_source, 'own-key')
})

test('kunci induk yang MASIH dikirim klien ditandai sebagai jejak yang harus ditarik', async () => {
  // Ini keadaan yang ingin dihabiskan: kunci induk beredar di browser. Ia tetap
  // harus lolos kebijakan, dan sumbernya dicatat supaya terlihat di laporan.
  const hasil = await submit({ 'x-api-key': MASTER, Authorization: `Bearer ${tokenUntuk({ id: BERHAK, role: 'user' })}` })
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))

  const rows = bacaSql(`SELECT * FROM nexabot_upstream_usage ORDER BY id DESC LIMIT 1`)
  assert.equal(rows[0].credential_source, 'client-master', 'kunci induk dari klien tidak ditandai')
})

test('kunci induk yang dikirim klien tetap ditolak kalau membernya tidak berhak', async () => {
  const sebelum = diterima.length
  const hasil = await submit({ 'x-api-key': MASTER, Authorization: `Bearer ${tokenUntuk({ id: ADMIN.id, role: 'admin' })}` })
  assert.equal(hasil.status, 400, JSON.stringify(hasil.json))
  assert.equal(diterima.length, sebelum)
})

test('mode off: tidak ada penyuntikan sama sekali', async () => {
  process.env.NEXABOT_MASTER_KEY_MODE = 'off'
  try {
    const sebelum = diterima.length
    const hasil = await submit({ Authorization: `Bearer ${tokenUntuk({ id: BERHAK, role: 'user' })}` })
    assert.equal(hasil.status, 400)
    assert.match(String(hasil.json?.error), /Missing X-Api-Key/)
    assert.equal(diterima.length, sebelum)
  } finally {
    delete process.env.NEXABOT_MASTER_KEY_MODE
  }
})

test('batas harian kunci induk ditegakkan', async () => {
  process.env.NEXABOT_MASTER_DAILY_CAP = '1'
  try {
    const sebelum = diterima.length
    // BERHAK sudah memakai kunci induk (source master) di tes pertama.
    const hasil = await submit({ Authorization: `Bearer ${tokenUntuk({ id: BERHAK, role: 'user' })}` })
    assert.equal(hasil.status, 400, JSON.stringify(hasil.json))
    assert.match(String(hasil.json?.error), /batas harian/i)
    assert.equal(diterima.length, sebelum, 'relay tetap menembak upstream di atas batas')
  } finally {
    delete process.env.NEXABOT_MASTER_DAILY_CAP
  }
})

test('rute baca hanya butuh identitas: polling tetap jalan walau paket habis', async () => {
  // Job yang SUDAH berjalan sah tidak boleh kehilangan polling hanya karena paket
  // atau saldo member habis di tengah jalan.
  const paket = await fetch(`${base}/api/public/nexabot/modes`, {
    headers: { Authorization: `Bearer ${tokenUntuk({ id: ADMIN.id, role: 'admin' })}` },
  })
  assert.equal(paket.status, 200, 'rute baca menolak member yang tidak punya saldo/paket')
  assert.equal(terakhir().apiKey, MASTER)

  const tanpaIdentitas = await fetch(`${base}/api/public/nexabot/modes`)
  assert.equal(tanpaIdentitas.status, 400, 'rute baca menerima pemanggil tanpa identitas')
})

test('relay tetap melayani pemakai tanpa akun yang membawa kunci sendiri', async () => {
  // Relay ini publik: klien boleh memakai kredensial nexabot-nya sendiri tanpa akun app.
  const hasil = await submit({ 'x-api-key': 'kunci-luar-tanpa-akun' })
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))
  assert.equal(terakhir().apiKey, 'kunci-luar-tanpa-akun')
})

test('nilai kunci induk tidak pernah tersimpan di catatan pemakaian', async () => {
  const rows = bacaSql(`SELECT * FROM nexabot_upstream_usage`)
  assert.ok(rows.length > 0)
  for (const row of rows) {
    assert.ok(!JSON.stringify(row).includes(MASTER), 'nilai kunci induk tersimpan di catatan pemakaian')
  }
})

// ── Toko token: kunci induk tidak boleh keluar lewat jalur ini ──────────────

test('token yang nilainya kunci induk tidak bisa dibeli', async () => {
  jalankanSql(
    `INSERT INTO tokens (provider, name, token_value, price, status) VALUES ('weavy', 'kunci server (uji)', ?, 1000, 'available')`,
    MASTER,
  )
  const id = bacaSql<{ id: number }>(`SELECT id FROM tokens WHERE token_value = ?`, MASTER)[0].id

  const res = await fetch(`${base}/api/tokens/buy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenUntuk({ id: BERHAK, role: 'user' })}` },
    body: JSON.stringify({ token_ids: [id] }),
  })
  assert.equal(res.status, 400, 'kunci induk sampai terjual')

  const sesudah = bacaSql<{ status: string }>(`SELECT status FROM tokens WHERE id = ?`, id)[0]
  assert.equal(sesudah.status, 'available', 'kunci induk berubah status jadi terjual')
})

test('catatan pembelian menyensor nilai kunci induk', async () => {
  const id = bacaSql<{ id: number }>(`SELECT id FROM tokens WHERE token_value = ?`, MASTER)[0].id
  jalankanSql(
    `INSERT INTO token_orders (user_id, token_id, status, bulk_id) VALUES (?, ?, 'confirmed', 'bulk-uji')`,
    BERHAK,
    id,
  )

  const res = await fetch(`${base}/api/tokens/note/bulk-uji`, {
    headers: { Authorization: `Bearer ${tokenUntuk({ id: BERHAK, role: 'user' })}` },
  })
  assert.equal(res.status, 200)
  const isi = await res.text()
  assert.ok(!isi.includes(MASTER), 'nilai kunci induk tertulis di catatan pembelian')
  assert.match(isi, /sengaja tidak ditampilkan/i)
})

// ── Jalur admin: dashboard juga sebuah browser ──────────────────────────────

const adminToken = () => tokenUntuk({ id: ADMIN.id, role: 'admin' })

test('daftar token admin menyensor nilai kunci induk, nilai lain apa adanya', async () => {
  const KUNCI_BOLEH_DILIHAT = 'kunci-weavy-biasa-456'
  jalankanSql(
    `INSERT OR IGNORE INTO tokens (provider, name, token_value, price, status) VALUES ('weavy', 'kunci biasa (uji)', ?, 500, 'available')`,
    KUNCI_BOLEH_DILIHAT,
  )

  const res = await fetch(`${base}/api/admin/tokens`, { headers: { Authorization: `Bearer ${adminToken()}` } })
  assert.equal(res.status, 200)

  const isi = await res.text()
  assert.ok(!isi.includes(MASTER), 'kunci induk terkirim ke browser admin')

  const { tokens } = JSON.parse(isi) as { tokens: { token_value: string }[] }
  const punyaMaster = tokens.find((t) => t.token_value.includes('sengaja tidak ditampilkan'))
  assert.ok(punyaMaster, 'tidak ada penanda sensor pada kunci induk di daftar admin')
  assert.ok(
    tokens.some((t) => t.token_value === KUNCI_BOLEH_DILIHAT),
    'kunci biasa ikut tersensor — admin jadi tidak bisa melihat token yang memang dijual',
  )
})

test('daftar pesanan admin menyensor nilai kunci induk', async () => {
  const res = await fetch(`${base}/api/admin/tokens/orders`, {
    headers: { Authorization: `Bearer ${adminToken()}` },
  })
  assert.equal(res.status, 200)

  const isi = await res.text()
  assert.ok(!isi.includes(MASTER), 'kunci induk terkirim lewat daftar pesanan admin')

  const { orders } = JSON.parse(isi) as { orders: { tokens: { token_value: string }[] }[] }
  const semua = orders.flatMap((o) => o.tokens)
  assert.ok(semua.length > 0, 'tidak ada pesanan untuk diperiksa')
  assert.ok(
    semua.some((t) => t.token_value.includes('sengaja tidak ditampilkan')),
    'nilai kunci induk lolos apa adanya di daftar pesanan admin',
  )
})

// ── Laporan: pertanyaan "siapa yang jalan di kunci saya" ────────────────────

test('laporan admin memisahkan job di kunci server dari kunci yang masih beredar', async () => {
  const res = await fetch(`${base}/api/nexabot/admin/upstream-usage?days=1`, {
    headers: { Authorization: `Bearer ${adminToken()}` },
  })
  assert.equal(res.status, 200)

  const laporan = (await res.json()) as {
    totals: { jobs_master: number; jobs_client_master: number }
    users: {
      user_id: number
      jobs_master: number
      jobs_client_master: number
      credentials: { source: string; jobs: number }[]
    }[]
  }

  // Dua baris sebelumnya sudah menghasilkan satu job di kunci server (member
  // bersaldo tanpa mengirim kunci) dan satu job dengan kunci induk yang masih
  // dikirim klien. Kalau keduanya dilebur, pertanyaan pemilik kunci tidak
  // terjawab — dan justru itu gunanya laporan ini.
  assert.ok(laporan.totals.jobs_master > 0, 'job yang dibayar kunci server tidak terlihat di laporan')
  assert.ok(laporan.totals.jobs_client_master > 0, 'kunci induk yang masih dikirim klien tidak terlihat di laporan')

  const berhak = laporan.users.find((u) => u.user_id === BERHAK)
  assert.ok(berhak, 'member tidak muncul di laporan')
  const sumber = berhak.credentials.map((k) => k.source)
  assert.ok(sumber.includes('master'), `sumber 'master' tidak tercatat: ${JSON.stringify(sumber)}`)
  assert.ok(sumber.includes('client-master'), `sumber 'client-master' tidak tercatat: ${JSON.stringify(sumber)}`)

  // Angka di kolom gabungan harus cocok dengan rincian kredensial yang sama-sama
  // disajikan di respons ini. Tanpa ikatan itu, kolom yang melebur kunci server
  // dengan kunci yang masih beredar akan tetap terlihat "benar" — dan justru
  // pertanyaan pemilik kunci itu yang jadi tidak terjawab.
  const jumlahSumber = (s: string) =>
    berhak.credentials.filter((k) => k.source === s).reduce((a, k) => a + k.jobs, 0)
  assert.equal(jumlahSumber('master') > 0, true, 'tidak ada rincian kredensial ber-source master')
  assert.equal(
    berhak.jobs_master,
    jumlahSumber('master'),
    "hitungan jobs_master tidak cocok dengan rincian kredensial ber-source 'master'",
  )
  assert.equal(
    berhak.jobs_client_master,
    jumlahSumber('client-master'),
    "hitungan jobs_client_master tidak cocok dengan rincian kredensial ber-source 'client-master'",
  )
})
