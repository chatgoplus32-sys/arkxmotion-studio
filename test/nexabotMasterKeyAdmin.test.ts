// ─── Kunci induk NexaBot diatur admin dari dashboard ────────────────────────
//
// Kunci ini adalah kredensial operator. Dua hal yang diuji di sini:
//  1. Hanya admin yang boleh membaca status / menulis / menghapusnya, dan
//     nilainya TIDAK PERNAH dikirim balik ke browser — termasuk lewat daftar
//     pengaturan umum yang dulu mengembalikan semua isi app_settings.
//  2. Relay benar-benar memakai kunci dari dashboard (bukan hanya dari .env),
//     dan berhenti memakainya begitu kunci dihapus.
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

const DB_PATH = path.join(os.tmpdir(), `arkxmotion-nxb-admin-${process.pid}.db`)
process.env.ARKXMOTION_DB_PATH = DB_PATH
const JWT_SECRET = 'test-secret-nexabot-admin'
process.env.JWT_SECRET = JWT_SECRET
// File ini menguji kunci dari dashboard, jadi tidak boleh ada fallback env.
delete process.env.NEXABOT_MASTER_API_KEY

import { createRequire } from 'node:module'
const requireRepo = createRequire(path.join(__dirname, '..', 'package.json'))
const Database = requireRepo('better-sqlite3') as new (file: string) => any

const DB_MASTER = 'kunci-dashboard-RAHASIA-123'
const ENV_MASTER = 'kunci-env-fallback-456'
const KUNCI_DITOLAK = 'kunci-ditolak-upstream-789'

interface Panggilan { url: string; apiKey: string | null }
const diterima: Panggilan[] = []

const upstream = http.createServer((req, res) => {
  req.on('data', () => {})
  req.on('end', () => {
    const apiKey = (req.headers['x-api-key'] as string) || null
    diterima.push({ url: req.url || '', apiKey })
    res.setHeader('Content-Type', 'application/json')
    if (apiKey === KUNCI_DITOLAK) {
      res.statusCode = 401
      res.end(JSON.stringify({ ok: false, error: 'API key tidak valid' }))
      return
    }
    if ((req.url || '').startsWith('/api/v1/api/credit')) {
      res.end(JSON.stringify({ ok: true, credit: 7.5, telegram_id: '667788' }))
      return
    }
    res.end(JSON.stringify({ ok: true, job_id: 'job-' + diterima.length, credits: 0.15 }))
  })
})

const terakhir = () => diterima[diterima.length - 1]

let server: any
let base = ''

const MEMBER = 8001
const ADMIN = { id: 800, email: 'admin-kunci@test.local', role: 'admin' }
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

async function submit() {
  // Setiap submit mensimulasikan /deduct: relay hanya mau memakai kredensial
  // server kalau tiket pembayarannya ada.
  const tiket = jalankanSql(
    `INSERT INTO nexabot_usage (user_id, model, cost, status) VALUES (?, 't2v', 150, 'used')`,
    MEMBER,
  ).lastInsertRowid

  const res = await fetch(`${base}/api/public/nexabot/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberToken()}`,
      'X-Nexabot-Charge': String(tiket),
    },
    body: JSON.stringify({ mode: 't2v', prompt: 'uji kunci dashboard' }),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as any, tiket: Number(tiket) }
}

const getStatus = async () => {
  const res = await fetch(`${base}/api/admin/nexabot/master-key`, {
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

  for (const [id, email, role] of [[MEMBER, 'member-kunci@test.local', 'user'], [ADMIN.id, ADMIN.email, 'admin']] as const) {
    jalankanSql(`INSERT OR IGNORE INTO users (id, email, password, name, role, approved) VALUES (?, ?, 'x', 'uji', ?, 1)`, id, email, role)
  }
  jalankanSql(`INSERT INTO nexabot_balance (user_id, balance) VALUES (?, 50000)`, MEMBER)
})

after(() => {
  server.close()
  upstream.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix) } catch { /* belum ada / terkunci */ }
  }
})

// ── Hak akses ───────────────────────────────────────────────────────────────

test('member tidak boleh membaca status kunci server', async () => {
  const res = await fetch(`${base}/api/admin/nexabot/master-key`, {
    headers: { Authorization: `Bearer ${memberToken()}` },
  })
  assert.equal(res.status, 403)
})

test('member tidak boleh menulis atau menghapus kunci server', async () => {
  for (const method of ['PUT', 'DELETE']) {
    const res = await fetch(`${base}/api/admin/nexabot/master-key`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberToken()}` },
      body: method === 'PUT' ? JSON.stringify({ apiKey: 'kunci-ilegal' }) : undefined,
    })
    assert.equal(res.status, 403, `${method} menerima member`)
  }
})

// ── Alur admin ──────────────────────────────────────────────────────────────

test('sebelum diatur: status jujur "belum ada" tanpa nilai kunci', async () => {
  const { status, text } = await getStatus()
  assert.equal(status, 200)

  const data = JSON.parse(text)
  assert.equal(data.configured, false)
  assert.equal(data.source, 'none')
})

test('admin menyimpan kunci: relay memakainya untuk member, dan nilai tidak pernah dikirim balik', async () => {
  const put = await fetch(`${base}/api/admin/nexabot/master-key`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ apiKey: `  ${DB_MASTER}\n` }), // spasi/newline copy-paste dibuang
  })
  assert.equal(put.status, 200)
  const putText = await put.text()
  assert.ok(!putText.includes(DB_MASTER), 'nilai kunci dikirim balik di respons simpan')

  const sesudah = await getStatus()
  assert.equal(sesudah.status, 200)
  assert.ok(!sesudah.text.includes(DB_MASTER), 'nilai kunci dikirim balik di status')
  const data = JSON.parse(sesudah.text)
  assert.equal(data.configured, true)
  assert.equal(data.source, 'database')

  const hasil = await submit()
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))
  assert.equal(terakhir().apiKey, DB_MASTER, 'relay tidak memakai kunci dari dashboard')

  const rows = bacaSql(`SELECT credential_source FROM nexabot_upstream_usage ORDER BY id DESC LIMIT 1`)
  assert.equal(rows[0].credential_source, 'master')

  // Nilai kunci sudah ada di app_settings; daftar pengaturan umum tetap tidak
  // boleh membocorkannya ke browser admin.
  const settings = await fetch(`${base}/api/admin/settings`, {
    headers: { Authorization: `Bearer ${adminToken()}` },
  })
  assert.equal(settings.status, 200)
  const settingsText = await settings.text()
  assert.ok(!settingsText.includes(DB_MASTER), 'kunci bocor lewat daftar pengaturan umum')
})

test('formulir pengaturan umum tidak bisa menimpa kunci server', async () => {
  const res = await fetch(`${base}/api/admin/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ settings: { nexabot_master_api_key: 'suntikan-lewat-settings' } }),
  })
  assert.equal(res.status, 200)

  const hasil = await submit()
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))
  assert.equal(terakhir().apiKey, DB_MASTER, 'kunci server tertimpa lewat formulir pengaturan umum')
})

test('kunci kosong ditolak, bukan menghapus kunci yang sudah ada', async () => {
  const res = await fetch(`${base}/api/admin/nexabot/master-key`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ apiKey: '   ' }),
  })
  assert.equal(res.status, 400)

  const status = await getStatus()
  assert.equal(JSON.parse(status.text).configured, true)
})

test('cookie sesi yang ditempel ke kolom kunci ditolak sebelum disimpan', async () => {
  const res = await fetch(`${base}/api/admin/nexabot/master-key`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ apiKey: 'session=sesi-RAHASIA-abc; cf_clearance=xyz' }),
  })
  assert.equal(res.status, 400)
  assert.match(String(((await res.json()) as any).error), /cookie sesi/i)

  const status = await getStatus()
  assert.equal(JSON.parse(status.text).configured, true, 'kunci lama ikut terhapus oleh input yang ditolak')
})

test('cookie yang terlanjur tersimpan di slot kunci diabaikan, bukan dikirim sebagai API key', async () => {
  // Insiden 2026-10-28: nilai yang sama ditempel ke dua kolom. Relay mengirim
  // cookie itu sebagai x-api-key, upstream membalas 401 "API key tidak valid",
  // dan member baru yang sudah top up saldo tidak bisa generate.
  jalankanSql(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    'nexabot_master_api_key',
    'session=sesi-RAHASIA-abc; cf_clearance=xyz',
  )

  const status = JSON.parse((await getStatus()).text)
  assert.equal(status.configured, false, 'cookie diterima sebagai kunci server')
  assert.equal(status.looks_like_cookie, true, 'panel admin tidak memperingatkan salah kolom')

  const sebelum = diterima.length
  const hasil = await submit()
  assert.equal(hasil.status, 400, JSON.stringify(hasil.json))
  assert.equal(diterima.length, sebelum, 'cookie yang salah kolom tetap dikirim ke upstream')

  // Cek Kunci menunjuk kolom yang salah, juga tanpa menembak upstream.
  const cek = await fetch(`${base}/api/admin/nexabot/master-key/check`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken()}` },
  })
  assert.equal(cek.status, 200)
  const hasilCek = JSON.parse(await cek.text()).check
  assert.equal(hasilCek.ok, false)
  assert.match(String(hasilCek.error), /cookie sesi/i)
  assert.equal(diterima.length, sebelum, 'Cek Kunci menembak upstream dengan nilai cookie')

  // Kembalikan kunci yang sah untuk tes berikutnya.
  jalankanSql(`UPDATE app_settings SET value = ? WHERE key = 'nexabot_master_api_key'`, DB_MASTER)
})

test('Cek Kunci memvalidasi kunci tersimpan dan melaporkan kredit tanpa membocorkan nilainya', async () => {
  const res = await fetch(`${base}/api/admin/nexabot/master-key/check`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken()}` },
  })
  assert.equal(res.status, 200)
  const text = await res.text()
  assert.ok(!text.includes(DB_MASTER), 'nilai kunci dikirim balik oleh Cek Kunci')

  const hasil = JSON.parse(text).check
  assert.equal(hasil.ok, true, hasil.error)
  assert.equal(hasil.valid, true)
  assert.equal(hasil.credit, 7.5)
  assert.equal(hasil.telegram_id, '667788')

  assert.equal(terakhir().url, '/api/v1/api/credit')
  assert.equal(terakhir().apiKey, DB_MASTER)
})

test('kredensial server yang ditolak upstream tidak menyalahkan member', async () => {
  const put = await fetch(`${base}/api/admin/nexabot/master-key`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ apiKey: KUNCI_DITOLAK }),
  })
  assert.equal(put.status, 200)

  const hasil = await submit()
  assert.equal(hasil.status, 401, JSON.stringify(hasil.json))
  assert.match(String(hasil.json?.error), /Akses NexaBot milik server ditolak penyedia/i)
  assert.ok(
    !String(hasil.json?.error).includes('API key tidak valid'),
    'pesan upstream mentah diteruskan ke member',
  )

  // Bukti mentah tetap diarsipkan supaya admin bisa menelusuri penyebabnya.
  const rows = bacaSql<{ status_code: number; credential_source: string }>(
    `SELECT status_code, credential_source FROM nexabot_upstream_usage ORDER BY id DESC LIMIT 1`,
  )
  assert.equal(rows[0].status_code, 401)
  assert.equal(rows[0].credential_source, 'master')

  // 401 = kredensialnya sendiri yang ditolak, bukan job yang terbentuk: tiket
  // dilepas supaya member tidak kehilangan Rp 150 untuk generate yang tidak ada.
  const tiket = bacaSql(`SELECT 1 FROM nexabot_charge_ticket WHERE usage_id = ?`, hasil.tiket)
  assert.equal(tiket.length, 0, 'tiket tetap terpakai padahal upstream tidak membuat job')

  const pulih = await fetch(`${base}/api/admin/nexabot/master-key`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ apiKey: DB_MASTER }),
  })
  assert.equal(pulih.status, 200)
})

test('kunci dihapus: fallback ke env kalau ada, dan relay menolak kalau tidak ada sama sekali', async () => {
  const del = await fetch(`${base}/api/admin/nexabot/master-key`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken()}` },
  })
  assert.equal(del.status, 200)
  const delText = await del.text()
  assert.ok(!delText.includes(DB_MASTER), 'nilai kunci muncul di respons hapus')

  let status = await getStatus()
  assert.equal(JSON.parse(status.text).configured, false)
  assert.equal(JSON.parse(status.text).source, 'none')

  // Tanpa env: relay tidak punya kunci untuk disuntikkan.
  const sebelum = diterima.length
  const gagal = await submit()
  assert.equal(gagal.status, 400)
  assert.match(String(gagal.json?.error), /X-Api-Key/i)
  assert.equal(diterima.length, sebelum, 'relay tetap menembak upstream tanpa kunci')

  // Dengan env: status berubah jujur ke 'env' dan relay memakai nilai itu.
  process.env.NEXABOT_MASTER_API_KEY = ENV_MASTER
  try {
    status = await getStatus()
    const data = JSON.parse(status.text)
    assert.equal(data.configured, true)
    assert.equal(data.source, 'env')

    const hasil = await submit()
    assert.equal(hasil.status, 200, JSON.stringify(hasil.json))
    assert.equal(terakhir().apiKey, ENV_MASTER)
  } finally {
    delete process.env.NEXABOT_MASTER_API_KEY
  }
})
