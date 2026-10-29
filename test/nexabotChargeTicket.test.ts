// ─── Tiket X-Nexabot-Charge: satu potongan = satu job ───────────────────────
//
// Potongan Rp 150 dilakukan klien lewat /api/nexabot/deduct. Sebelum ada tiket,
// relay tidak pernah tahu apakah potongan itu terjadi: member bisa memanggil
// relay langsung dan memakai kunci/sesi server berkali-kali hanya berbekal saldo
// > 0 — biaya upstream-nya ditanggung operator.
//
// Tes ini menguji penegakan itu pada relay sungguhan dengan upstream tiruan:
//  - kredensial server tanpa tiket → 402 SEBELUM upstream disentuh;
//  - tiket sah → job dibuat, tiket hangus, tidak bisa dipakai lagi;
//  - tiket milik orang lain / kedaluwarsa / sudah direfund → 402;
//  - upstream menolak sebelum job (429) → tiket dilepas, boleh diulang;
//  - kunci/cookie milik member dan admin tidak terpengaruh.
//
// Juga menguji jendela refund 60 menit di wallet: refund otomatis klien paling
// lambat ~35 menit setelah potong, jadi usage yang jauh lebih tua dari itu tidak
// boleh lagi diuangkan kembali.
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

const DB_PATH = path.join(os.tmpdir(), `arkxmotion-nxb-tiket-${process.pid}.db`)
process.env.ARKXMOTION_DB_PATH = DB_PATH
const JWT_SECRET = 'test-secret-nexabot-tiket'
process.env.JWT_SECRET = JWT_SECRET
process.env.NEXABOT_MASTER_API_KEY = 'kunci-induk-untuk-tiket-777'
delete process.env.NEXABOT_MASTER_KEY_MODE
delete process.env.NEXABOT_MASTER_DAILY_CAP

import { createRequire } from 'node:module'
const requireRepo = createRequire(path.join(__dirname, '..', 'package.json'))
const Database = requireRepo('better-sqlite3') as new (file: string) => any

const MASTER = process.env.NEXABOT_MASTER_API_KEY
const KUNCI_SENDIRI = 'kunci-pribadi-member-tiket'

interface Panggilan { url: string; apiKey: string | null }
const diterima: Panggilan[] = []
/** Tes 429: upstream menolak SEBELUM job dibuat, lalu kembali normal. */
let tolakSekali = false

const upstream = http.createServer((req, res) => {
  req.on('data', () => {})
  req.on('end', () => {
    diterima.push({ url: req.url || '', apiKey: (req.headers['x-api-key'] as string) || null })
    res.setHeader('Content-Type', 'application/json')
    if (tolakSekali) {
      tolakSekali = false
      res.statusCode = 429
      res.end(JSON.stringify({ ok: false, error: 'rate limited' }))
      return
    }
    if ((req.url || '').startsWith('/api/v1/gpt-image')) {
      res.end(JSON.stringify({ ok: true, id: 'img-' + diterima.length }))
      return
    }
    res.end(JSON.stringify({ ok: true, job_id: 'job-' + diterima.length, credits: 0.15 }))
  })
})

const terakhir = () => diterima[diterima.length - 1]

let server: any
let base = ''

const MEMBER = 8201
const LAIN = 8202
const ADMIN = { id: 8200, email: 'admin-tiket@test.local', role: 'admin' }
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

/** Baris usage seperti hasil /deduct (bukti bayar). */
function potong(userId: number, opts: { cost?: number; umurMenit?: number; status?: string } = {}): number {
  const { cost = 150, umurMenit = 0, status = 'used' } = opts
  const info = jalankanSql(
    `INSERT INTO nexabot_usage (user_id, model, cost, status, created_at)
     VALUES (?, 't2v', ?, ?, datetime('now', ?))`,
    userId,
    cost,
    status,
    `-${umurMenit} minutes`,
  )
  return Number(info.lastInsertRowid)
}

async function submit(headers: Record<string, string>) {
  // Kunci job per-lane bersifat proses-wide (satu akun = satu job). File ini
  // menguji tiket pembayaran, bukan penjadwalan, jadi mulai dari lane bersih.
  resetNexabotLaneJobs()
  const res = await fetch(`${base}/api/public/nexabot/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ mode: 't2v', prompt: 'uji tiket' }),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

async function gptImage(headers: Record<string, string>) {
  const res = await fetch(`${base}/api/public/nexabot/gpt-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ prompt: 'uji tiket gambar', aspect: 2 }),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

async function refund(token: string, usageId: number) {
  const res = await fetch(`${base}/api/nexabot/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ usage_id: usageId }),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

const saldoOf = (userId: number) =>
  (bacaSql<{ balance: number }>(`SELECT balance FROM nexabot_balance WHERE user_id = ?`, userId)[0] || { balance: 0 }).balance

const statusTiket = (usageId: number) =>
  bacaSql<{ state: string; job_id: string | null }>(
    `SELECT state, job_id FROM nexabot_charge_ticket WHERE usage_id = ?`,
    usageId,
  )[0]

before(async () => {
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()))
  process.env.NEXABOT_BASE = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`

  const relayRoutes = (await import('../server/routes/nexabot.js')).default
  const walletRoutes = (await import('../server/routes/nexabotWallet.js')).default

  const app = express()
  app.use(express.json())
  app.use('/api/public/nexabot', relayRoutes)
  app.use('/api/nexabot', walletRoutes)
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  for (const [id, email, role] of [
    [MEMBER, 'member-tiket@test.local', 'user'],
    [LAIN, 'lain-tiket@test.local', 'user'],
    [ADMIN.id, ADMIN.email, 'admin'],
  ] as const) {
    jalankanSql(`INSERT OR IGNORE INTO users (id, email, password, name, role, approved) VALUES (?, ?, 'x', 'uji', ?, 1)`, id, email, role)
  }
  for (const id of [MEMBER, LAIN, ADMIN.id]) {
    jalankanSql(`INSERT INTO nexabot_balance (user_id, balance) VALUES (?, 50000)`, id)
  }
})

after(() => {
  server.close()
  upstream.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix) } catch { /* belum ada / terkunci */ }
  }
})

// ── Penegakan tiket ─────────────────────────────────────────────────────────

test('kredensial server tanpa tiket ditolak 402 dan upstream tidak dipanggil', async () => {
  const sebelum = diterima.length
  const hasil = await submit({ Authorization: `Bearer ${memberToken()}` })

  assert.equal(hasil.status, 402, JSON.stringify(hasil.json))
  assert.match(String(hasil.json?.error), /tiket|terverifikasi/i)
  assert.equal(diterima.length, sebelum, 'relay menembak upstream tanpa bukti bayar')
})

test('tiket sah: job dibuat, tiket hangus, dan tidak bisa dipakai untuk job kedua', async () => {
  const tiket = potong(MEMBER)

  const pertama = await submit({ Authorization: `Bearer ${memberToken()}`, 'X-Nexabot-Charge': String(tiket) })
  assert.equal(pertama.status, 200, JSON.stringify(pertama.json))
  assert.equal(terakhir().apiKey, MASTER, 'kunci induk tidak dipakai')

  const tiketDb = statusTiket(tiket)
  assert.equal(tiketDb?.state, 'consumed', 'tiket tidak ditandai terpakai setelah job dibuat')
  assert.ok(tiketDb?.job_id, 'job_id upstream tidak dicatat di tiket')

  const kedua = await submit({ Authorization: `Bearer ${memberToken()}`, 'X-Nexabot-Charge': String(tiket) })
  assert.equal(kedua.status, 402, 'satu potongan dipakai untuk dua job')
  assert.match(String(kedua.json?.error), /sudah dipakai/i)
})

test('tiket milik member lain ditolak', async () => {
  const tiketLain = potong(LAIN)
  const hasil = await submit({ Authorization: `Bearer ${memberToken()}`, 'X-Nexabot-Charge': String(tiketLain) })
  assert.equal(hasil.status, 402, JSON.stringify(hasil.json))
  assert.match(String(hasil.json?.error), /tidak ditemukan/i)
  assert.equal(statusTiket(tiketLain), undefined)
})

test('tiket kedaluwarsa (lebih dari 30 menit) ditolak', async () => {
  const tiket = potong(MEMBER, { umurMenit: 31 })
  const hasil = await submit({ Authorization: `Bearer ${memberToken()}`, 'X-Nexabot-Charge': String(tiket) })
  assert.equal(hasil.status, 402, JSON.stringify(hasil.json))
  assert.match(String(hasil.json?.error), /kedaluwarsa/i)
})

test('usage yang sudah direfund tidak bisa dipakai sebagai tiket', async () => {
  const tiket = potong(MEMBER, { status: 'refunded' })
  const hasil = await submit({ Authorization: `Bearer ${memberToken()}`, 'X-Nexabot-Charge': String(tiket) })
  assert.equal(hasil.status, 402, JSON.stringify(hasil.json))
  assert.match(String(hasil.json?.error), /tidak berlaku/i)
})

test('upstream menolak sebelum job (429): tiket dilepas dan boleh diulang', async () => {
  const tiket = potong(MEMBER)
  tolakSekali = true

  const gagal = await submit({ Authorization: `Bearer ${memberToken()}`, 'X-Nexabot-Charge': String(tiket) })
  assert.equal(gagal.status, 429, JSON.stringify(gagal.json))
  assert.equal(statusTiket(tiket), undefined, 'tiket tetap tertahan padahal upstream menolak tanpa job')

  const ulang = await submit({ Authorization: `Bearer ${memberToken()}`, 'X-Nexabot-Charge': String(tiket) })
  assert.equal(ulang.status, 200, JSON.stringify(ulang.json))
  assert.equal(statusTiket(tiket)?.state, 'consumed')
})

test('admin tidak perlu tiket (pemilik kredensial server)', async () => {
  const sebelum = diterima.length
  const hasil = await submit({ Authorization: `Bearer ${adminToken()}` })
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))
  assert.equal(diterima.length, sebelum + 1)
  assert.equal(terakhir().apiKey, MASTER)
})

test('kunci milik member sendiri tidak butuh tiket', async () => {
  const hasil = await submit({ Authorization: `Bearer ${memberToken()}`, 'x-api-key': KUNCI_SENDIRI })
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))
  assert.equal(terakhir().apiKey, KUNCI_SENDIRI)
})

test('jalur gpt-image juga menuntut tiket dan mencatatnya', async () => {
  const tanpaTiket = await gptImage({ Authorization: `Bearer ${memberToken()}` })
  assert.equal(tanpaTiket.status, 402, JSON.stringify(tanpaTiket.json))

  const tiket = potong(MEMBER)
  const hasil = await gptImage({ Authorization: `Bearer ${memberToken()}`, 'X-Nexabot-Charge': String(tiket) })
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))

  const tiketDb = statusTiket(tiket)
  assert.equal(tiketDb?.state, 'consumed')
  assert.equal(tiketDb?.job_id, 'img-' + diterima.length)

  const baris = bacaSql<{ route: string; credential_source: string }>(
    `SELECT route, credential_source FROM nexabot_upstream_usage ORDER BY id DESC LIMIT 1`,
  )
  assert.equal(baris[0].route, 'gpt-image')
  assert.equal(baris[0].credential_source, 'master')
})

// ── Jendela refund ──────────────────────────────────────────────────────────

test('refund untuk usage baru tetap mengembalikan saldo', async () => {
  const tiket = potong(MEMBER)
  jalankanSql(`UPDATE nexabot_balance SET balance = balance - 150 WHERE user_id = ?`, MEMBER)
  const sebelum = saldoOf(MEMBER)

  const hasil = await refund(memberToken(), tiket)
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))
  assert.equal(hasil.json?.refunded, 150)
  assert.equal(saldoOf(MEMBER), sebelum + 150)
  assert.equal(bacaSql<{ status: string }>(`SELECT status FROM nexabot_usage WHERE id = ?`, tiket)[0].status, 'refunded')
})

test('refund untuk usage lebih dari 60 menit ditolak dan saldo tidak berubah', async () => {
  const tiket = potong(MEMBER, { umurMenit: 61 })
  const sebelum = saldoOf(MEMBER)

  const hasil = await refund(memberToken(), tiket)
  assert.equal(hasil.status, 400, JSON.stringify(hasil.json))
  assert.match(String(hasil.json?.error), /60 menit/i)
  assert.equal(saldoOf(MEMBER), sebelum, 'saldo bertambah dari refund usage lama')
  assert.equal(
    bacaSql<{ status: string }>(`SELECT status FROM nexabot_usage WHERE id = ?`, tiket)[0].status,
    'used',
    'usage lama tetap ditandai used setelah refund ditolak',
  )
})

test('usage Unlimited lama (cost 0) boleh dilabeli refund — tidak ada uang yang kembali', async () => {
  const tiket = potong(MEMBER, { cost: 0, umurMenit: 120 })
  const sebelum = saldoOf(MEMBER)

  const hasil = await refund(memberToken(), tiket)
  assert.equal(hasil.status, 200, JSON.stringify(hasil.json))
  assert.equal(hasil.json?.refunded, 0)
  assert.equal(saldoOf(MEMBER), sebelum)
})
