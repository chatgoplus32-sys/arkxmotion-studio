// Gerbang Pro untuk /studio/ & /auto-motion/ — berkas aplikasi penuh bukan
// untuk umum. Diuji: tanpa cookie, non-Pro, Pro/admin, token yang dicabut
// (logout/rotasi), dan token palsu — semua harus ditolak kecuali Pro/admin.
import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import jwt from 'jsonwebtoken'
import { fileURLToPath } from 'node:url'

const DB_PATH = path.join(os.tmpdir(), `arkxmotion-progate-${process.pid}.db`)
process.env.ARKXMOTION_DB_PATH = DB_PATH
process.env.JWT_SECRET = 'test-secret-progate'
process.env.JWT_REFRESH_SECRET = 'test-refresh-progate'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { requireProPage } = await import('../server/middleware/requireProPage.js')
const { createRequire } = await import('node:module')
const requireRepo = createRequire(path.join(__dirname, '..', 'package.json'))
const Database = requireRepo('better-sqlite3') as new (file: string) => any

const REFRESH_SECRET = 'test-refresh-progate'

function seedUser(id: number, role: string, plan: string, refreshToken: string | null) {
  const db = new Database(DB_PATH)
  db.prepare(
    "INSERT INTO users (id, email, password, name, role, approved, plan, refresh_token, refresh_expires) VALUES (?, ?, 'x', ?, ?, 1, ?, ?, datetime('now', '+7 days'))",
  ).run(id, `u${id}@test.local`, `User ${id}`, role, plan, refreshToken)
  db.close()
}

function makeRes() {
  const r: any = {
    redirectedTo: undefined as string | undefined,
    statusCode: 200,
    body: undefined as string | undefined,
    redirect(code: number, url: string) { r.statusCode = code; r.redirectedTo = url; return r },
    set() { return r },
    status(code: number) { r.statusCode = code; return r },
    send(body: string) { r.body = body; return r },
  }
  return r
}

function reqWithCookie(cookie: string | null) {
  const headers: Record<string, string> = {}
  if (cookie !== null) headers.cookie = cookie
  return { headers, originalUrl: '/studio/' } as any
}

function runGate(req: any) {
  const res = makeRes()
  let nextCalled = false
  requireProPage(req, res, () => { nextCalled = true })
  return { res, nextCalled }
}

const mk = (id: number) => jwt.sign({ id, kind: 'refresh' }, REFRESH_SECRET, { expiresIn: '7d' })

test('tanpa cookie → dialihkan ke /login', () => {
  seedUser(1, 'admin', 'pro', null)
  const { res, nextCalled } = runGate(reqWithCookie(null))
  assert.equal(nextCalled, false)
  assert.match(String(res.redirectedTo), /^\/login\?next=%2Fstudio%2F/)
})

test('member non-Pro (role user, plan free) → 403 halaman upgrade', () => {
  const tok = mk(10)
  seedUser(10, 'user', 'free', tok)
  const { res, nextCalled } = runGate(reqWithCookie(`arkx_session=${tok}`))
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 403)
  assert.match(String(res.body), /Upgrade ke Pro/)
})

test('member Pro → lanjut (next dipanggil)', () => {
  const tok = mk(11)
  seedUser(11, 'user', 'pro', tok)
  const { nextCalled } = runGate(reqWithCookie(`arkx_session=${tok}`))
  assert.equal(nextCalled, true)
})

test('admin → lanjut', () => {
  const tok = mk(12)
  seedUser(12, 'admin', 'free', tok)
  const { nextCalled } = runGate(reqWithCookie(`arkx_session=${tok}`))
  assert.equal(nextCalled, true)
})

test('refresh token tidak cocok dengan DB (sudah logout/rotasi) → /login', () => {
  const tok = mk(13)
  seedUser(13, 'user', 'pro', 'token-lain-yang-tersimpan')
  const { res, nextCalled } = runGate(reqWithCookie(`arkx_session=${tok}`))
  assert.equal(nextCalled, false)
  assert.match(String(res.redirectedTo), /^\/login/)
})

test('token palsu (tanda tangan salah) → /login', () => {
  const tok = jwt.sign({ id: 14, kind: 'refresh' }, 'rahasia-lain', { expiresIn: '7d' })
  seedUser(14, 'admin', 'pro', tok)
  const { res, nextCalled } = runGate(reqWithCookie(`arkx_session=${tok}`))
  assert.equal(nextCalled, false)
  assert.match(String(res.redirectedTo), /^\/login/)
})

process.on('exit', () => { try { fs.unlinkSync(DB_PATH) } catch {} })
