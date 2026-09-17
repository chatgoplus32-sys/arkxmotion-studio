// ─── Lubang kredensial di /api/sync-tokens ──────────────────────────────────
// Sebelum perbaikan ini: seluruh route terbuka tanpa identitas dan antrenya
// berkunci nama provider saja, sehingga `GET /api/sync-tokens/nexabot?full=1`
// mengembalikan cookie sesi nexabot.id milik pengguna LAIN kepada siapa pun yang
// memanggil — cukup satu kunjungan ke situs yang bisa menembak endpoint itu —
// dan `POST`-nya juga terbuka, jadi credential apa pun bisa disuntikkan ke
// antrean yang dipakai semua orang.
//
// Tes ini menembak HTTP sungguhan (router asli di port acak) karena yang diuji
// adalah perilaku izin: 401 tanpa identitas, dan tidak ada satu pengguna pun
// yang bisa membaca atau mengubah antrean pengguna lain. Versi Vercel
// (api/sync-tokens.ts) adalah cermin dari router ini dan sudah per user sejak
// awal; yang dikunci di sini jalur Express yang benar-benar melayani produksi.
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import express from 'express'
import jwt from 'jsonwebtoken'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const JWT_SECRET = 'test-secret-sync-tokens'
process.env.JWT_SECRET = JWT_SECRET

const syncTokensRoutes = (await import('../server/routes/syncTokens.js')).default

const USER_A = 11
const USER_B = 22
const USER_C = 33
const tokenA = jwt.sign({ id: USER_A, email: 'a@test.local', role: 'user' }, JWT_SECRET)
const tokenB = jwt.sign({ id: USER_B, email: 'b@test.local', role: 'user' }, JWT_SECRET)
const tokenC = jwt.sign({ id: USER_C, email: 'c@test.local', role: 'user' }, JWT_SECRET)

const app = express()
app.use(express.json())
app.use('/api/sync-tokens', syncTokensRoutes)

let server: ReturnType<typeof app.listen>
let base = ''

before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => server.close())

const auth = (t?: string) => (t ? { Authorization: `Bearer ${t}` } : {})

async function kirim(body: unknown, t?: string) {
  const res = await fetch(`${base}/api/sync-tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(t) },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

async function ambil(provider: string, opts: { full?: boolean; token?: string } = {}) {
  const res = await fetch(`${base}/api/sync-tokens/${provider}${opts.full ? '?full=1' : ''}`, {
    headers: auth(opts.token),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

async function semuaProvider(t?: string) {
  const res = await fetch(`${base}/api/sync-tokens/all`, { headers: auth(t) })
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

async function consume(provider: string, token: string, t?: string) {
  const res = await fetch(`${base}/api/sync-tokens/${provider}/consume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(t) },
    body: JSON.stringify({ token }),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

const COOKIE_A = 'session=cookie-sesi-milik-pengguna-A'
const COOKIE_B = 'session=cookie-sesi-milik-pengguna-B'

// ── Identitas wajib di setiap route ─────────────────────────────────────────

test('POST tanpa identitas ditolak dan tidak menyimpan apa pun', async () => {
  const hasil = await kirim({ provider: 'tanpa-auth-post', token: 'x' })
  assert.equal(hasil.status, 401, JSON.stringify(hasil.body))

  const milikA = await ambil('tanpa-auth-post', { full: true, token: tokenA })
  assert.equal(milikA.body.count, 0, 'credential dari POST tanpa identitas tersimpan di antrean')
})

test('GET /:provider?full=1 tanpa identitas ditolak', async () => {
  const hasil = await ambil('nexabot', { full: true })
  assert.equal(hasil.status, 401, JSON.stringify(hasil.body))
})

test('GET /all tanpa identitas ditolak', async () => {
  const hasil = await semuaProvider()
  assert.equal(hasil.status, 401, JSON.stringify(hasil.body))
})

test('POST /:provider/consume tanpa identitas ditolak', async () => {
  const hasil = await consume('nexabot', COOKIE_A)
  assert.equal(hasil.status, 401, JSON.stringify(hasil.body))
})

test('JWT yang tidak sah ditolak dan tidak menyimpan apa pun', async () => {
  const hasil = await kirim({ provider: 'jwt-palsu', token: 'x' }, 'bukan.jwt.sungguhan')
  assert.equal(hasil.status, 403, JSON.stringify(hasil.body))

  const milikA = await ambil('jwt-palsu', { token: tokenA })
  assert.equal(milikA.body.count, 0)
})

// ── Fitur tetap jalan untuk pemiliknya ──────────────────────────────────────

test('pemilik bisa mengirim lalu mengambil kredensialnya sendiri', async () => {
  const kirimHasil = await kirim({ provider: 'nexabot', token: COOKIE_A, kind: 'cookie' }, tokenA)
  assert.equal(kirimHasil.status, 200, JSON.stringify(kirimHasil.body))
  assert.equal(kirimHasil.body.ok, true)

  const hasil = await ambil('nexabot', { full: true, token: tokenA })
  assert.equal(hasil.status, 200)
  assert.equal(hasil.body.count, 1)
  assert.equal(hasil.body.tokens[0].token, COOKIE_A)
  assert.equal(hasil.body.tokens[0].kind, 'cookie')
})

test('tanpa full=1 nilainya di-mask', async () => {
  const hasil = await ambil('nexabot', { token: tokenA })
  assert.equal(hasil.body.count, 1)
  assert.notEqual(hasil.body.tokens[0].token, COOKIE_A)
  assert.match(hasil.body.tokens[0].token, /\.\.\.$/)
  assert.ok(!hasil.body.tokens[0].token.includes('milik-pengguna-A'))
})

// ── Isolasi antar pengguna (inti perbaikan) ─────────────────────────────────

test('KASUS UTAMA: pengguna lain tidak bisa membaca kredensial orang lain', async () => {
  // A sudah mengirim cookie nexabot di tes sebelumnya.
  const milikB = await ambil('nexabot', { full: true, token: tokenB })
  assert.equal(milikB.status, 200)
  assert.equal(milikB.body.count, 0, 'pengguna B melihat credential milik pengguna A')
  assert.deepEqual(milikB.body.tokens, [])
})

test('pengguna lain tidak bisa menyuntikkan credential ke antrean orang lain', async () => {
  // Kalau POST tidak ter-scope, B bisa menimpa/menambah entry yang dibaca A.
  const kirimB = await kirim({ provider: 'nexabot', token: COOKIE_B, kind: 'cookie' }, tokenB)
  assert.equal(kirimB.status, 200)

  const milikA = await ambil('nexabot', { full: true, token: tokenA })
  assert.equal(milikA.body.count, 1, 'antrean A ikut terisi oleh credential pengguna B')
  assert.equal(milikA.body.tokens[0].token, COOKIE_A)

  const milikB = await ambil('nexabot', { full: true, token: tokenB })
  assert.equal(milikB.body.count, 1)
  assert.equal(milikB.body.tokens[0].token, COOKIE_B)
})

test('GET /all hanya memuat antrean pemanggil', async () => {
  await kirim({ provider: 'leonardo', token: 'token-leonardo-A' }, tokenA)

  const milikA = await semuaProvider(tokenA)
  assert.ok(milikA.body.tokens.leonardo, 'A kehilangan providernya sendiri')
  assert.ok(!milikA.body.tokens.riverside, 'provider yang tidak pernah dikirim A ikut muncul')

  const milikB = await semuaProvider(tokenB)
  assert.ok(!milikB.body.tokens.leonardo, 'B melihat provider milik A lewat /all')
  assert.deepEqual(Object.keys(milikB.body.tokens), ['nexabot'])
})

test('consume milik orang lain tidak menghapus apa pun', async () => {
  const hasil = await consume('nexabot', COOKIE_A, tokenB)
  assert.equal(hasil.status, 200)
  assert.equal(hasil.body.removed, 0)

  const milikA = await ambil('nexabot', { full: true, token: tokenA })
  assert.equal(milikA.body.count, 1, 'credential A terhapus oleh consume pengguna lain')
})

test('consume milik sendiri menghapus entri itu', async () => {
  const hasil = await consume('nexabot', COOKIE_A, tokenA)
  assert.equal(hasil.body.removed, 1)

  const milikA = await ambil('nexabot', { token: tokenA })
  assert.equal(milikA.body.count, 0)
})

// ── Pengaman masukan ────────────────────────────────────────────────────────

test('nama provider yang aneh ditolak', async () => {
  for (const provider of ['../../etc/passwd', 'nama provider', '']) {
    const hasil = await kirim({ provider, token: 'x' }, tokenA)
    assert.equal(hasil.status, 400, `provider ${JSON.stringify(provider)} diterima`)
  }
})

test('jumlah provider per pengguna dibatasi', async () => {
  const batas = 50
  for (let i = 0; i < batas; i++) {
    const hasil = await kirim({ provider: `provider-${i}`, token: `t${i}` }, tokenC)
    assert.equal(hasil.status, 200, `provider ke-${i} ditolak lebih awal`)
  }
  const kelebihan = await kirim({ provider: 'provider-ekstra', token: 't' }, tokenC)
  assert.equal(kelebihan.status, 400, 'provider di atas batas diterima')
})

// ── Penjaga sumber ──────────────────────────────────────────────────────────

function baca(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

test('setiap route sync didaftarkan setelah authenticateToken', () => {
  const src = baca('server/routes/syncTokens.ts')
  const posisiAuth = src.indexOf('router.use(authenticateToken)')
  assert.ok(posisiAuth > 0, 'authenticateToken tidak dipasang lagi di router sync')

  for (const rute of ["router.post('/',", "router.get('/all'", "router.get('/:provider'", "router.post('/:provider/consume'"]) {
    const pos = src.indexOf(rute)
    assert.ok(pos > 0, `rute ${rute} tidak ditemukan`)
    assert.ok(pos > posisiAuth, `rute ${rute} didaftarkan SEBELUM authenticateToken, jadi terbuka tanpa identitas`)
  }
})

test('antrean tidak lagi berkunci nama provider saja', () => {
  const src = baca('server/routes/syncTokens.ts')
  // Bentuk lama: pendingTokens.get(provider) / set(provider, ...) — global.
  assert.doesNotMatch(src, /pendingTokens\.(get|set|delete)\(provider/, 'masih ada akses antrean yang mengabaikan identitas pengguna')
  assert.match(src, /queueKey\(userId, provider\)/)
})

test('semua extension yang POST ke /api/sync-tokens mengirim Authorization', () => {
  // Server menolak POST tanpa identitas, jadi extension yang lupa mengirim JWT
  // akan gagal diam-diam (hanya badge di popup). Kontraknya dikunci di sini, dan
  // TIDAK ada daftar pengecualian: ketiga extension di repo ini
  // (nexabot-token-ext, auth-helper, riverside-token-ext) membaca JWT login app
  // dari tab app lewat chrome.scripting. Kalau ada extension baru yang menembak
  // endpoint ini tanpa identitas, tes ini yang gagal lebih dulu.
  const berkas: string[] = []
  const telusuri = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) telusuri(p)
      else if (entry.name.endsWith('.js')) berkas.push(p)
    }
  }
  telusuri(path.join(ROOT, 'extensions'))

  const pengirim = berkas.filter((f) => fs.readFileSync(f, 'utf8').includes('sync-tokens'))
  assert.ok(pengirim.length >= 3, 'extension pengirim ke /api/sync-tokens tidak ditemukan?')

  const akarEkstensi = path.join(ROOT, 'extensions')
  const tanpaAuth = pengirim
    .filter((f) => !fs.readFileSync(f, 'utf8').includes('Bearer'))
    .map((f) => path.relative(akarEkstensi, f).split(path.sep).join('/'))

  assert.deepEqual(
    tanpaAuth.sort(),
    [],
    'ada extension yang POST ke /api/sync-tokens tanpa Authorization — sync-nya akan ditolak 401',
  )
})
