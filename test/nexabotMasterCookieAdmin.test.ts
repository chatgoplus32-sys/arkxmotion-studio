// ─── Sesi Unlimited NexaBot (cookie server) diatur admin ────────────────────
//
// Paket Unlimited hanya dihormati lewat cookie login web, bukan API key. Yang
// diuji di sini:
//  1. Hanya admin yang boleh membaca status / menyimpan / menghapus cookie, dan
//     nilainya tidak pernah dikirim balik ke browser — termasuk lewat daftar
//     pengaturan umum.
//  2. Relay memakai cookie itu lewat /api/v1/generate — didahulukan untuk SEMUA
//     member berhak, karena paket Unlimited hanya dihormati di jalur web. Kunci
//     server hanya cadangan, dan cookie yang salah kolom tidak mematikan jalur
//     sesi.
//  3. Panel admin bisa memeriksa status sesi (unlimited / paket / berlaku
//     sampai / saldo) lewat /master-cookie/check tanpa melihat nilainya.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DB_PATH = path.join(os.tmpdir(), `arkxmotion-nxb-cookie-${process.pid}.db`)
process.env.ARKXMOTION_DB_PATH = DB_PATH
const JWT_SECRET = 'test-secret-nexabot-cookie'
process.env.JWT_SECRET = JWT_SECRET
// Tidak ada fallback kunci/cookie dari env: file ini menguji jalur dashboard.
delete process.env.NEXABOT_MASTER_API_KEY
delete process.env.NEXABOT_MASTER_KEY_MODE

import { createRequire } from 'node:module'
const requireRepo = createRequire(path.join(__dirname, '..', 'package.json'))
const Database = requireRepo('better-sqlite3') as new (file: string) => any

const COOKIE_VALUE = 'session=sesi-unlimited-RAHASIA-abc123; cf_clearance=xyz789'
const COOKIE_STORE = COOKIE_VALUE // persis seperti yang dikirim relay

interface Panggilan { method: string; url: string; cookie: string | null; apiKey: string | null }
const diterima: Panggilan[] = []

const upstream = http.createServer((req, res) => {
  req.on('data', () => {})
  req.on('end', () => {
    diterima.push({
      method: req.method || '',
      url: req.url || '',
      cookie: (req.headers.cookie as string) || null,
      apiKey: (req.headers['x-api-key'] as string) || null,
    })
    res.setHeader('Content-Type', 'application/json')
    if ((req.url || '').startsWith('/api/v1/credits')) {
      res.end(JSON.stringify({
        ok: true,
        data: {
          email: 'ops@nexabot.test',
          telegram_id: '998877',
          credits: 12.5,
          unlimited: true,
          plan: 'Unlimited Bulanan',
          expires_at: '2026-12-01T00:00:00Z',
        },
      }))
      return
    }
    res.end(JSON.stringify({ ok: true, job_id: 'job-' + diterima.length, status: 'queued' }))
  })
})

const terakhir = () => diterima[diterima.length - 1]

let server: any
let base = ''

const MEMBER_UNLIMITED = 8101
const MEMBER_BALANCE = 8102
const ADMIN = { id: 8100, email: 'admin-sesi@test.local', role: 'admin' }
const tokenUntuk = (payload: Record<string, unknown>) => jwt.sign(payload, JWT_SECRET)
const unlimitedToken = () => tokenUntuk({ id: MEMBER_UNLIMITED, role: 'user' })
const balanceToken = () => tokenUntuk({ id: MEMBER_BALANCE, role: 'user' })
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

async function submit(token: string, ticket?: string | number) {
  const res = await fetch(`${base}/api/public/nexabot/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(ticket === undefined ? {} : { 'X-Nexabot-Charge': String(ticket) }),
    },
    body: JSON.stringify({ mode: 't2v', prompt: 'uji sesi Unlimited server' }),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
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

const getStatus = async () => {
  const res = await fetch(`${base}/api/admin/nexabot/master-cookie`, {
    headers: { Authorization: `Bearer ${adminToken()}` },
  })
  return { status: res.status, text: await res.text() }
}

const getKeyStatus = async () => {
  const res = await fetch(`${base}/api/admin/nexabot/master-key`, {
    headers: { Authorization: `Bearer ${adminToken()}` },
  })
  return { status: res.status, text: await res.text() }
}

const checkSesi = async () => {
  const res = await fetch(`${base}/api/admin/nexabot/master-cookie/check`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken()}` },
  })
  return { status: res.status, text: await res.text() }
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
    [MEMBER_UNLIMITED, 'member-unlimited@test.local', 'user'],
    [MEMBER_BALANCE, 'member-saldo@test.local', 'user'],
    [ADMIN.id, ADMIN.email, 'admin'],
  ] as const) {
    jalankanSql(`INSERT OR IGNORE INTO users (id, email, password, name, role, approved) VALUES (?, ?, 'x', 'uji', ?, 1)`, id, email, role)
  }
  // Member dengan Paket Unlimited aktif — cookie didahulukan untuknya.
  jalankanSql(
    `INSERT INTO nexabot_topup (user_id, amount, status, kind, days, package_slug, expires_at)
     VALUES (?, 35000, 'approved', 'unlimited', 7, 'unlimited_weekly', datetime('now', '+7 days'))`,
    MEMBER_UNLIMITED,
  )
  // Member yang cuma punya saldo — di mode default tetap dilayani sesi cookie
  // server (didahulukan), dengan kunci server sebagai cadangan.
  jalankanSql(`INSERT INTO nexabot_balance (user_id, balance) VALUES (?, 20000)`, MEMBER_BALANCE)
})

after(() => {
  server.close()
  upstream.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix) } catch { /* belum ada / terkunci */ }
  }
})

// ── Hak akses ───────────────────────────────────────────────────────────────

test('member tidak boleh mengelola sesi Unlimited', async () => {
  const routes: { method: string; path: string; body?: string }[] = [
    { method: 'GET', path: '/api/admin/nexabot/master-cookie' },
    { method: 'PUT', path: '/api/admin/nexabot/master-cookie', body: JSON.stringify({ cookie: COOKIE_VALUE }) },
    { method: 'DELETE', path: '/api/admin/nexabot/master-cookie' },
    { method: 'POST', path: '/api/admin/nexabot/master-cookie/check' },
  ]
  for (const r of routes) {
    const res = await fetch(`${base}${r.path}`, {
      method: r.method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${unlimitedToken()}` },
      body: r.body,
    })
    assert.equal(res.status, 403, `${r.method} ${r.path} menerima member`)
  }
})

// ── Alur admin ──────────────────────────────────────────────────────────────

test('sebelum diatur: status jujur dan cek menolak tanpa menembak upstream', async () => {
  const { status, text } = await getStatus()
  assert.equal(status, 200)
  const data = JSON.parse(text)
  assert.equal(data.configured, false)
  assert.equal(data.source, 'none')

  const sebelum = diterima.length
  const cek = await checkSesi()
  assert.equal(cek.status, 200)
  const hasil = JSON.parse(cek.text).check
  assert.equal(hasil.ok, false)
  assert.match(String(hasil.error), /belum diatur/i)
  assert.equal(diterima.length, sebelum, 'cek tetap menembak upstream tanpa sesi')
})

test('cookie kosong / tidak valid ditolak', async () => {
  for (const cookie of ['   ', 'tanpa-tanda-sama-dengan']) {
    const res = await fetch(`${base}/api/admin/nexabot/master-cookie`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken()}` },
      body: JSON.stringify({ cookie }),
    })
    assert.equal(res.status, 400, `cookie ${JSON.stringify(cookie)} diterima`)
  }

  const status = await getStatus()
  assert.equal(JSON.parse(status.text).configured, false)
})

test('admin menyimpan cookie: status aktif, dan nilainya tidak pernah dikirim balik', async () => {
  // Bentuk "Copy as cURL" seperti yang biasa ditempel admin.
  const curl = `curl 'https://nexabot.id/api/v1/generate' \\\n  -H 'cookie: ${COOKIE_VALUE}' \\\n  -H 'content-type: application/json'`
  const put = await fetch(`${base}/api/admin/nexabot/master-cookie`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ cookie: curl }),
  })
  assert.equal(put.status, 200)
  const putText = await put.text()
  assert.ok(!putText.includes('RAHASIA'), 'nilai cookie dikirim balik di respons simpan')

  const sesudah = await getStatus()
  assert.equal(sesudah.status, 200)
  assert.ok(!sesudah.text.includes('RAHASIA'), 'nilai cookie dikirim balik di status')
  const data = JSON.parse(sesudah.text)
  assert.equal(data.configured, true)
  assert.equal(data.source, 'database')

  // Daftar pengaturan umum juga tidak boleh membocorkannya.
  const settings = await fetch(`${base}/api/admin/settings`, {
    headers: { Authorization: `Bearer ${adminToken()}` },
  })
  assert.equal(settings.status, 200)
  assert.ok(!(await settings.text()).includes('RAHASIA'), 'cookie bocor lewat daftar pengaturan umum')

  // Yang tersimpan adalah header Cookie satu baris, bukan seluruh cURL.
  const rows = bacaSql<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'nexabot_master_cookie'`)
  assert.equal(rows[0].value, COOKIE_STORE)
})

test('Cek Limit & Status membaca /api/v1/credits dengan cookie tersimpan', async () => {
  const cek = await checkSesi()
  assert.equal(cek.status, 200)
  const hasil = JSON.parse(cek.text).check

  assert.equal(hasil.ok, true, hasil.error)
  assert.equal(hasil.active, true)
  assert.equal(hasil.unlimited, true)
  assert.equal(hasil.plan, 'Unlimited Bulanan')
  assert.equal(hasil.until, '2026-12-01T00:00:00Z')
  assert.equal(hasil.balance, 12.5)
  assert.equal(hasil.email, 'ops@nexabot.test')
  assert.equal(hasil.telegram_id, '998877')
  assert.equal(hasil.status, 200)
  assert.ok(!cek.text.includes('RAHASIA'), 'nilai cookie ikut di hasil cek')

  const panggilan = terakhir()
  assert.equal(panggilan.url, '/api/v1/credits')
  assert.equal(panggilan.cookie, COOKIE_STORE)
  assert.equal(panggilan.apiKey, null)
})

test('member Unlimited memakai sesi server lewat /api/v1/generate tanpa kunci', async () => {
  const hasil = await submit(unlimitedToken(), tiketBaru(MEMBER_UNLIMITED))
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))

  const panggilan = terakhir()
  assert.equal(panggilan.url, '/api/v1/generate', 'relay tidak memakai jalur web /api/v1/generate')
  assert.equal(panggilan.cookie, COOKIE_STORE)
  assert.equal(panggilan.apiKey, null, 'relay tetap mengirim API key di jalur sesi')

  const rows = bacaSql<{ route: string; credential_kind: string; credential_source: string }>(
    `SELECT route, credential_kind, credential_source FROM nexabot_upstream_usage ORDER BY id DESC LIMIT 1`,
  )
  assert.equal(rows[0].route, 'generate')
  assert.equal(rows[0].credential_kind, 'cookie')
  assert.equal(rows[0].credential_source, 'master')
})

test('member bersaldo tanpa kunci server tetap dilayani lewat sesi cookie', async () => {
  // Insiden 2026-10-28: member baru top up Rp 10.000 lalu generate dan ditolak
  // "API key tidak valid" — kunci server yang tersimpan ternyata cookie sesi.
  // Sesi cookie yang sah harus tetap melayani member bersaldo: cukup top up.
  const hasil = await submit(balanceToken(), tiketBaru(MEMBER_BALANCE, 150))
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))

  const panggilan = terakhir()
  assert.equal(panggilan.url, '/api/v1/generate', 'relay tidak memakai jalur web /api/v1/generate')
  assert.equal(panggilan.cookie, COOKIE_STORE)
  assert.equal(panggilan.apiKey, null, 'relay mengirim API key di jalur sesi')

  const rows = bacaSql<{ credential_kind: string; credential_source: string }>(
    `SELECT credential_kind, credential_source FROM nexabot_upstream_usage ORDER BY id DESC LIMIT 1`,
  )
  assert.equal(rows[0].credential_kind, 'cookie')
  assert.equal(rows[0].credential_source, 'master')
})

test('mode unlimited: member bersaldo ditolak walau sesi cookie tersedia', async () => {
  process.env.NEXABOT_MASTER_KEY_MODE = 'unlimited'
  try {
    const sebelum = diterima.length
    const hasil = await submit(balanceToken(), tiketBaru(MEMBER_BALANCE, 150))
    assert.equal(hasil.status, 400)
    assert.match(String(hasil.json?.error), /Paket Unlimited/i)
    assert.equal(diterima.length, sebelum, 'relay tetap menembak upstream di mode unlimited')
  } finally {
    delete process.env.NEXABOT_MASTER_KEY_MODE
  }
})

test('cookie yang salah kolom (tersimpan sebagai kunci) tidak merusak member bersaldo', async () => {
  // Nilai yang sama ditempel ke dua kolom. Nilai di slot kunci harus diabaikan,
  // sehingga relay tetap memakai sesi cookie — bukan mengirim cookie sebagai
  // x-api-key yang pasti ditolak upstream.
  jalankanSql(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('nexabot_master_api_key', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    COOKIE_VALUE,
  )

  const status = await getKeyStatus()
  const data = JSON.parse(status.text)
  assert.equal(data.configured, false, 'cookie diterima sebagai kunci server')
  assert.equal(data.looks_like_cookie, true, 'panel admin tidak memperingatkan salah kolom')

  const hasil = await submit(balanceToken(), tiketBaru(MEMBER_BALANCE, 150))
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))
  assert.equal(terakhir().apiKey, null, 'nilai berbentuk cookie dikirim sebagai x-api-key')
  assert.equal(terakhir().cookie, COOKIE_STORE)

  jalankanSql(`DELETE FROM app_settings WHERE key = 'nexabot_master_api_key'`)
})

test('formulir pengaturan umum tidak bisa menimpa sesi Unlimited', async () => {
  const res = await fetch(`${base}/api/admin/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ settings: { nexabot_master_cookie: 'session=suntikan-lewat-settings' } }),
  })
  assert.equal(res.status, 200)

  const hasil = await submit(unlimitedToken(), tiketBaru(MEMBER_UNLIMITED))
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))
  assert.equal(terakhir().cookie, COOKIE_STORE, 'cookie server tertimpa lewat formulir pengaturan umum')
})

test('hapus sesi: status bersih dan relay berhenti memakai cookie', async () => {
  const del = await fetch(`${base}/api/admin/nexabot/master-cookie`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken()}` },
  })
  assert.equal(del.status, 200)
  assert.ok(!(await del.text()).includes('RAHASIA'), 'nilai cookie muncul di respons hapus')

  const status = await getStatus()
  const data = JSON.parse(status.text)
  assert.equal(data.configured, false)
  assert.equal(data.source, 'none')

  const sebelum = diterima.length
  const gagal = await submit(unlimitedToken())
  assert.equal(gagal.status, 400)
  assert.equal(diterima.length, sebelum, 'relay tetap menembak upstream setelah sesi dihapus')
})
