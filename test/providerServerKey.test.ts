// ─── Kunci server Alriz / Seavi: member top up tanpa API key sendiri ────────
//
// Relay /api/public/{alriz,seavi} bisa memasang kunci milik operator untuk
// member yang sudah top up. Karena itu relay wajib tahu bahwa generate memang
// sudah dibayar: klien mengirim `X-App-Token` (identitas) dan, pada request
// yang membuat job, `X-Provider-Charge` (usage_id dari wallet).
//
// Yang diuji di sini (relay sungguhan + upstream tiruan):
//  - tanpa identitas → 401; tanpa tiket → 402 SEBELUM upstream disentuh;
//  - tiket sah → upstream menerima kunci server, jatah tiket bertambah;
//  - satu potongan multi-slot (units) boleh untuk tepat N job, bukan N+1;
//  - request BACA hanya butuh identitas (polling tetap jalan walau saldo habis);
//  - upstream menolak sebelum job (429) → jatah tiket dilepas;
//  - admin tidak perlu tiket; kunci milik member tidak butuh tiket;
//  - /balance melaporkan server_key sesuai kebijakan yang sama dengan relay.
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

const DB_PATH = path.join(os.tmpdir(), `arkxmotion-server-key-${process.pid}.db`)
process.env.ARKXMOTION_DB_PATH = DB_PATH
const JWT_SECRET = 'test-secret-server-key'
process.env.JWT_SECRET = JWT_SECRET
const ALRIZ_MASTER = 'kunci-alriz-server-123'
const SEAVI_MASTER = 'kunci-seavi-server-456'
process.env.ALRIZ_MASTER_API_KEY = ALRIZ_MASTER
process.env.SEAVI_MASTER_API_KEY = SEAVI_MASTER

import { createRequire } from 'node:module'
const requireRepo = createRequire(path.join(__dirname, '..', 'package.json'))
const Database = requireRepo('better-sqlite3') as new (file: string) => any

interface Panggilan {
  url: string
  apiKey: string | null
  auth: string | null
}
const diterima: Panggilan[] = []
/** Tes 429: upstream menolak SEBELUM job dibuat, lalu kembali normal. */
let tolakSekali = false

const upstream = http.createServer((req, res) => {
  req.on('data', () => {})
  req.on('end', () => {
    diterima.push({
      url: req.url || '',
      apiKey: (req.headers['x-api-key'] as string) || null,
      auth: (req.headers['authorization'] as string) || null,
    })
    res.setHeader('Content-Type', 'application/json')

    if (tolakSekali) {
      tolakSekali = false
      res.statusCode = 429
      res.end(JSON.stringify({ ok: false, error: 'rate limited' }))
      return
    }

    if ((req.url || '') === '/api/jobs' && req.method === 'POST') {
      res.end(JSON.stringify({ job_id: `aj-${diterima.length}` }))
      return
    }
    if ((req.url || '') === '/v1/generate' && req.method === 'POST') {
      res.end(JSON.stringify({ id: `sv-${diterima.length}` }))
      return
    }
    res.end(JSON.stringify({ ok: true, status: 'PROCESSING' }))
  })
})

const terakhir = () => diterima[diterima.length - 1]

let server: any
let base = ''

const MEMBER = 9301
const MISKIN = 9302
const LAIN = 9303
const ADMIN = { id: 9300, email: 'admin-server-key@test.local', role: 'admin' }
const tokenUntuk = (payload: Record<string, unknown>) => jwt.sign(payload, JWT_SECRET)
const memberToken = () => tokenUntuk({ id: MEMBER, role: 'user' })
const miskinToken = () => tokenUntuk({ id: MISKIN, role: 'user' })
const lainToken = () => tokenUntuk({ id: LAIN, role: 'user' })
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

const tiket = (provider: 'alriz' | 'seavi', usageId: number) =>
  bacaSql<{ max_jobs: number; used_jobs: number; last_job_id: string | null }>(
    `SELECT max_jobs, used_jobs, last_job_id FROM provider_charge_ticket WHERE provider = ? AND usage_id = ?`,
    provider,
    usageId,
  )[0]

async function submitAlriz(headers: Record<string, string>) {
  const res = await fetch(`${base}/api/public/alriz?path=jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ model: 'mc-kling-2.6-std' }),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

async function submitSeavi(headers: Record<string, string>) {
  const res = await fetch(`${base}/api/public/seavi?path=generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ model: 'kling3_server10', input: {}, params: {} }),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

async function potongAlriz(token: string, quantity = 1): Promise<number> {
  const res = await fetch(`${base}/api/alriz/deduct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: 'mc-kling-2.6-std', quantity, batch_id: `b-${Date.now()}` }),
  })
  const json = await res.json()
  assert.equal(res.status, 200, JSON.stringify(json))
  assert.equal(typeof json.usage_id, 'number', 'deduct tidak mengembalikan usage_id')
  return json.usage_id
}

async function potongSeavi(token: string, quantity = 1): Promise<number> {
  const res = await fetch(`${base}/api/seavi/deduct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: 'kling3_server10', quantity, batch_id: `b-${Date.now()}` }),
  })
  const json = await res.json()
  assert.equal(res.status, 200, JSON.stringify(json))
  assert.equal(typeof json.usage_id, 'number', 'deduct tidak mengembalikan usage_id')
  return json.usage_id
}

before(async () => {
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()))
  const port = (upstream.address() as AddressInfo).port
  process.env.ALRIZ_BASE = `http://127.0.0.1:${port}/api`
  process.env.SEAVI_BASE = `http://127.0.0.1:${port}/v1`

  const alrizRelay = (await import('../server/routes/publicAlriz.js')).default
  const seaviRelay = (await import('../server/routes/publicSeavi.js')).default
  const alrizWallet = (await import('../server/routes/alrizWallet.js')).default
  const seaviWallet = (await import('../server/routes/seaviWallet.js')).default

  const app = express()
  app.use(express.json())
  app.use('/api/public/alriz', alrizRelay)
  app.use('/api/public/seavi', seaviRelay)
  app.use('/api/alriz', alrizWallet)
  app.use('/api/seavi', seaviWallet)
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  for (const [id, email, role] of [
    [MEMBER, 'member-server-key@test.local', 'user'],
    [MISKIN, 'miskin-server-key@test.local', 'user'],
    [LAIN, 'lain-server-key@test.local', 'user'],
    [ADMIN.id, ADMIN.email, 'admin'],
  ] as const) {
    jalankanSql(
      `INSERT OR IGNORE INTO users (id, email, password, name, role, approved) VALUES (?, ?, 'x', 'uji', ?, 1)`,
      id,
      email,
      role,
    )
  }
  jalankanSql(`INSERT INTO alriz_balance (user_id, balance) VALUES (?, 50000)`, MEMBER)
  jalankanSql(`INSERT INTO alriz_balance (user_id, balance) VALUES (?, 50000)`, LAIN)
  jalankanSql(`INSERT INTO seavi_balance (user_id, balance) VALUES (?, 20)`, MEMBER)
})

after(() => {
  server.close()
  upstream.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix) } catch { /* belum ada / terkunci */ }
  }
})

// ── Identitas ───────────────────────────────────────────────────────────────

test('tanpa kunci member dan tanpa identitas app ditolak 401', async () => {
  const sebelum = diterima.length
  const hasil = await submitAlriz({})
  assert.equal(hasil.status, 401, JSON.stringify(hasil.json))
  assert.match(String(hasil.json?.error), /login/i)
  assert.equal(diterima.length, sebelum, 'relay menembak upstream tanpa identitas')
})

test('identitas app tanpa tiket ditolak 402 dan upstream tidak dipanggil', async () => {
  const sebelum = diterima.length
  const hasil = await submitAlriz({ 'X-App-Token': memberToken() })
  assert.equal(hasil.status, 402, JSON.stringify(hasil.json))
  assert.match(String(hasil.json?.error), /tiket|terverifikasi/i)
  assert.equal(diterima.length, sebelum)
})

// ── Alriz ───────────────────────────────────────────────────────────────────

test('Alriz: tiket sah → kunci server dipakai, jatah tercatat, tidak bisa dipakai dua kali', async () => {
  const usageId = await potongAlriz(memberToken())
  const headers = { 'X-App-Token': memberToken(), 'X-Provider-Charge': String(usageId) }

  const pertama = await submitAlriz(headers)
  assert.equal(pertama.status, 200, JSON.stringify(pertama.json))
  assert.equal(terakhir().apiKey, ALRIZ_MASTER, 'relay tidak memakai kunci server')
  assert.equal(tiket('alriz', usageId)?.used_jobs, 1)
  assert.ok(tiket('alriz', usageId)?.last_job_id, 'job_id upstream tidak dicatat')

  const kedua = await submitAlriz(headers)
  assert.equal(kedua.status, 402, JSON.stringify(kedua.json))
  assert.match(String(kedua.json?.error), /sudah dipakai/i)
})

test('Alriz: tiket milik member lain ditolak', async () => {
  const usageId = await potongAlriz(lainToken())
  const hasil = await submitAlriz({ 'X-App-Token': memberToken(), 'X-Provider-Charge': String(usageId) })
  assert.equal(hasil.status, 402, JSON.stringify(hasil.json))
  assert.match(String(hasil.json?.error), /tidak ditemukan/i)
  assert.equal(tiket('alriz', usageId), undefined)
})

test('Alriz: member tanpa saldo & tanpa pembayaran terakhir ditolak 402 dengan pesan saldo', async () => {
  const hasil = await submitAlriz({ 'X-App-Token': miskinToken(), 'X-Provider-Charge': '999' })
  assert.equal(hasil.status, 402, JSON.stringify(hasil.json))
  assert.match(String(hasil.json?.error), /Saldo Alriz kosong/i)
})

test('Alriz: request baca hanya butuh identitas (polling tetap jalan)', async () => {
  const res = await fetch(`${base}/api/public/alriz?path=jobs/aj-1`, {
    headers: { 'X-App-Token': memberToken() },
  })
  assert.equal(res.status, 200)
  assert.equal(terakhir().apiKey, ALRIZ_MASTER)
})

test('Alriz: upstream 429 melepas jatah tiket, boleh diulang', async () => {
  const usageId = await potongAlriz(memberToken())
  const headers = { 'X-App-Token': memberToken(), 'X-Provider-Charge': String(usageId) }
  tolakSekali = true

  const gagal = await submitAlriz(headers)
  assert.equal(gagal.status, 429, JSON.stringify(gagal.json))
  assert.equal(tiket('alriz', usageId)?.used_jobs, 0, 'jatah tetap terpakai padahal upstream menolak tanpa job')

  const ulang = await submitAlriz(headers)
  assert.equal(ulang.status, 200, JSON.stringify(ulang.json))
  assert.equal(tiket('alriz', usageId)?.used_jobs, 1)
})

test('Alriz: admin memakai kunci server tanpa tiket', async () => {
  const sebelum = diterima.length
  const hasil = await submitAlriz({ 'X-App-Token': adminToken() })
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))
  assert.equal(diterima.length, sebelum + 1)
  assert.equal(terakhir().apiKey, ALRIZ_MASTER)
})

test('Alriz: kunci milik member diteruskan apa adanya tanpa tiket', async () => {
  const kunciSendiri = 'kunci-alriz-member'
  const hasil = await submitAlriz({ Authorization: `Bearer ${kunciSendiri}` })
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))
  assert.equal(terakhir().apiKey, kunciSendiri)
})

// ── Seavi ───────────────────────────────────────────────────────────────────

test('Seavi: satu potongan 3 slot boleh untuk tepat 3 job', async () => {
  const usageId = await potongSeavi(memberToken(), 3)
  const headers = { 'X-App-Token': memberToken(), 'X-Provider-Charge': String(usageId) }

  for (let i = 1; i <= 3; i++) {
    const hasil = await submitSeavi(headers)
    assert.equal(hasil.status, 200, `job ${i}: ${JSON.stringify(hasil.json)}`)
    assert.equal(terakhir().auth, `Bearer ${SEAVI_MASTER}`, 'relay tidak memakai kunci server Seavi')
    assert.equal(tiket('seavi', usageId)?.used_jobs, i)
  }

  const keempat = await submitSeavi(headers)
  assert.equal(keempat.status, 402, JSON.stringify(keempat.json))
  assert.match(String(keempat.json?.error), /3 job/i)
})

test('Seavi: kunci milik member diteruskan apa adanya tanpa tiket', async () => {
  const kunciSendiri = 'kunci-seavi-member'
  const hasil = await submitSeavi({ Authorization: `Bearer ${kunciSendiri}` })
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))
  assert.equal(terakhir().auth, `Bearer ${kunciSendiri}`)
})

// ── Laporan kelayakan ke UI ─────────────────────────────────────────────────

test('wallet melaporkan server_key sesuai kebijakan relay', async () => {
  const kaya = await fetch(`${base}/api/alriz/balance`, { headers: { Authorization: `Bearer ${memberToken()}` } })
  const dataKaya = await kaya.json()
  assert.equal(dataKaya.server_key?.available, true, JSON.stringify(dataKaya))

  const miskin = await fetch(`${base}/api/alriz/balance`, { headers: { Authorization: `Bearer ${miskinToken()}` } })
  const dataMiskin = await miskin.json()
  assert.equal(dataMiskin.server_key?.available, false, JSON.stringify(dataMiskin))
  assert.match(String(dataMiskin.server_key?.reason), /kosong/i)

  const seavi = await fetch(`${base}/api/seavi/balance`, { headers: { Authorization: `Bearer ${memberToken()}` } })
  const dataSeavi = await seavi.json()
  assert.equal(dataSeavi.server_key?.available, true, JSON.stringify(dataSeavi))
})
