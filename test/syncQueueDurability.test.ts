// ─── Antrean cookie nexabot harus melewati restart server ───────────────────
//
// Kenapa tes ini ada: cookie sesi nexabot.id ditangkap extension SEKALI per
// kejadian (`chrome.tabs.onUpdated` di tab nexabot.id) lalu dikirim
// fire-and-forget ke /api/sync-tokens. App mengambilnya dari antrean lewat poller
// 30 detik. Jendela antara kirim dan ambil hanya ≤30 detik — tapi setiap deploy
// me-restart server. Selama antrean itu hidup di memori proses, satu restart di
// jendela itu membuat cookie hilang tanpa jejak: extension melaporkan sukses,
// app tidak pernah menerima apa pun, dan cookie itu tidak dikirim ulang sampai
// pengguna membuka nexabot.id lagi atau menekan sync manual.
//
// Karena itu tes ini menjalankan SERVER SUNGGUHAN dua kali terhadap database yang
// sama (`server/index.ts`, bukan router di memori), lalu membuktikan cookie yang
// dikirim ke proses pertama masih terbaca oleh proses kedua. Ia juga mengunci
// sifat-sifat yang bisa rusak diam-diam: TTL per jenis credential, dedupe, batas
// 10 token terbaru, dan isolasi antar pengguna yang harus tetap berlaku setelah
// restart.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import jwt from 'jsonwebtoken'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

// DB terpisah supaya data dev tidak tersentuh — dan supaya kedua proses server
// benar-benar berbagi satu berkas yang sama (itulah yang sedang diuji).
const DB_PATH = path.join(os.tmpdir(), `arkxmotion-sync-durable-${process.pid}.db`)
const JWT_SECRET = 'test-secret-sync-durability'
const TSX_CLI = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')

// better-sqlite3 diambil dari node_modules repo produk (jalur tes ada di luar
// paket yang mengimpornya).
const requireRepo = createRequire(path.join(ROOT, 'package.json'))
const Database = requireRepo('better-sqlite3') as new (file: string) => {
  prepare: (sql: string) => { run: (...args: unknown[]) => { changes: number }; get: (...args: unknown[]) => unknown }
  close: () => void
}

const PENGGUNA = { A: 4201, B: 4202, C: 4203, D: 4204 }
const COOKIE_A = 'session=sesi-nexabot-milik-A; token=rahasia-a'
const COOKIE_B = 'session=sesi-nexabot-milik-B; token=rahasia-b'

const tandaTangan = (id: number) => jwt.sign({ id, email: `u${id}@test.local`, role: 'user' }, JWT_SECRET)

let anak: ChildProcess | null = null
let base = ''

async function portBebas(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
  })
}

/**
 * Nyalakan server sungguhan (proses terpisah, port baru) terhadap DB yang sama.
 * NODE_ENV dikosongkan supaya tidak masuk mode produksi dan tidak menyentuh
 * jalur backup; AUTO_BACKUP=0 memastikan tidak ada snapshot yang ditulis.
 */
async function nyalakanServer(): Promise<void> {
  const port = await portBebas()
  base = `http://127.0.0.1:${port}`
  const log: string[] = []

  anak = spawn(process.execPath, [TSX_CLI, 'server/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      ARKXMOTION_DB_PATH: DB_PATH,
      JWT_SECRET,
      PORT: String(port),
      AUTO_BACKUP: '0',
      NODE_ENV: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  anak.stdout?.on('data', (d) => log.push(String(d)))
  anak.stderr?.on('data', (d) => log.push(String(d)))

  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`${base}/api/health`)
      if (res.ok) return
    } catch {
      /* belum listen */
    }
    if (anak.exitCode !== null) break
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`server tidak siap dalam 90 detik; log:\n${log.join('').slice(-1500)}`)
}

/** Matikan server dan pastikan benar-benar berhenti sebelum langkah berikutnya. */
async function matikanServer(): Promise<void> {
  const proses = anak
  const baseLama = base
  anak = null
  if (!proses || proses.exitCode !== null) return

  const berhenti = new Promise<void>((resolve) => proses.once('exit', () => resolve()))
  proses.kill('SIGKILL')
  if (process.platform === 'win32' && proses.pid) {
    // tsx bisa menjalankan proses anak; /T memastikan seluruh pohonnya berhenti.
    spawn('taskkill', ['/pid', String(proses.pid), '/f', '/t'], { shell: true }).once('exit', () => {})
  }
  await Promise.race([berhenti, new Promise((r) => setTimeout(r, 10000))])

  // Konfirmasi dari luar: port-nya sudah tidak menjawab lagi.
  for (let i = 0; i < 10; i++) {
    try {
      await fetch(`${baseLama}/api/health`)
    } catch {
      return
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}

async function kirim(id: number, body: unknown) {
  const res = await fetch(`${base}/api/sync-tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tandaTangan(id)}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

async function ambil(id: number, provider: string, opts: { full?: boolean } = {}) {
  const res = await fetch(`${base}/api/sync-tokens/${provider}${opts.full ? '?full=1' : ''}`, {
    headers: { Authorization: `Bearer ${tandaTangan(id)}` },
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

async function consume(id: number, provider: string, token: string) {
  const res = await fetch(`${base}/api/sync-tokens/${provider}/consume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tandaTangan(id)}` },
    body: JSON.stringify({ token }),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

/** Baris yang benar-benar ada di DB — bukti fisik, tidak bergantung proses server. */
function barisDiDb(userId: number): number {
  const db = new Database(DB_PATH)
  const row = db.prepare('SELECT COUNT(*) AS n FROM sync_token_queue WHERE user_id = ?').get(userId) as { n: number }
  db.close()
  return row.n
}

/** Sisipkan baris "kuno" langsung ke DB untuk menguji TTL tanpa menunggu. */
function sisipkanKuno(userId: number, provider: string, token: string, kind: string, umurMs: number) {
  const db = new Database(DB_PATH)
  db.prepare(
    'INSERT INTO sync_token_queue (user_id, provider, token, kind, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(userId, provider, token, kind, 'test', Date.now() - umurMs)
  db.close()
}

after(async () => {
  await matikanServer()
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(DB_PATH + suffix)
    } catch {
      /* belum ada / masih terkunci */
    }
  }
})

// ── Alur utama ──────────────────────────────────────────────────────────────

test('cookie nexabot tersimpan di proses pertama', async () => {
  await nyalakanServer()

  // Sisa perilaku keamanan tetap berlaku di server sungguhan.
  const tanpaAuth = await fetch(`${base}/api/sync-tokens/nexabot?full=1`)
  assert.equal(tanpaAuth.status, 401, 'antrean bisa dibaca tanpa identitas')

  const kirimA = await kirim(PENGGUNA.A, { provider: 'nexabot', token: COOKIE_A, kind: 'cookie', source: 'extension' })
  assert.equal(kirimA.status, 200, JSON.stringify(kirimA.body))
  assert.equal(kirimA.body.tokenCount, 1)

  const kirimB = await kirim(PENGGUNA.B, { provider: 'nexabot', token: COOKIE_B, kind: 'cookie', source: 'extension' })
  assert.equal(kirimB.status, 200, JSON.stringify(kirimB.body))

  const lihatA = await ambil(PENGGUNA.A, 'nexabot', { full: true })
  assert.equal(lihatA.body.count, 1)
  assert.equal(lihatA.body.tokens[0].token, COOKIE_A)
  assert.equal(lihatA.body.tokens[0].kind, 'cookie')

  // Cookie mentah hanya untuk pemiliknya — dan hanya saat diminta penuh.
  const lihatB = await ambil(PENGGUNA.B, 'nexabot', { full: true })
  assert.equal(lihatB.body.tokens[0].token, COOKIE_B)
  const masked = await ambil(PENGGUNA.A, 'nexabot')
  assert.match(masked.body.tokens[0].token, /\.\.\.$/)
  assert.ok(!masked.body.tokens[0].token.includes('rahasia-a'))
})

test('cookie bertahan saat server restart — inti perbaikannya', async () => {
  await matikanServer()

  // Bukti fisik dulu: barisnya memang ada di DB, bukan di memori proses lama.
  assert.equal(barisDiDb(PENGGUNA.A), 1, 'cookie tidak tersimpan di DB sebelum restart')
  assert.equal(barisDiDb(PENGGUNA.B), 1)

  // Proses baru, port baru, database yang sama.
  await nyalakanServer()

  const lihatA = await ambil(PENGGUNA.A, 'nexabot', { full: true })
  assert.equal(lihatA.status, 200)
  assert.equal(lihatA.body.count, 1, 'cookie hilang setelah restart')
  assert.equal(lihatA.body.tokens[0].token, COOKIE_A, 'nilai cookie berubah/hilang setelah restart')
  assert.equal(lihatA.body.tokens[0].kind, 'cookie')

  // Isolasi antar pengguna harus tetap utuh setelah restart.
  const lihatB = await ambil(PENGGUNA.B, 'nexabot', { full: true })
  assert.equal(lihatB.body.count, 1)
  assert.equal(lihatB.body.tokens[0].token, COOKIE_B)
  assert.ok(!lihatB.body.tokens[0].token.includes('rahasia-a'), 'pengguna B membaca cookie pengguna A')
})

test('consume setelah restart hanya menghapus milik sendiri', async () => {
  const hapus = await consume(PENGGUNA.A, 'nexabot', COOKIE_A)
  assert.equal(hapus.body.removed, 1)

  const kosong = await ambil(PENGGUNA.A, 'nexabot', { full: true })
  assert.equal(kosong.body.count, 0)

  const lihatB = await ambil(PENGGUNA.B, 'nexabot', { full: true })
  assert.equal(lihatB.body.count, 1, 'consume pengguna A ikut menghapus antrean pengguna B')
})

test('umur menentukan nasib: cookie 24 jam, token 1 jam', async () => {
  const DUA_JAM = 2 * 60 * 60 * 1000
  const DUA_PULUH_LIMA_JAM = 25 * 60 * 60 * 1000

  sisipkanKuno(PENGGUNA.C, 'nexabot-lama', 'session=cookie-2-jam', 'cookie', DUA_JAM)
  sisipkanKuno(PENGGUNA.C, 'nexabot-lama', 'session=cookie-25-jam', 'cookie', DUA_PULUH_LIMA_JAM)
  sisipkanKuno(PENGGUNA.C, 'nexabot-lama', 'jwt-2-jam', 'token', DUA_JAM)

  const hasil = await ambil(PENGGUNA.C, 'nexabot-lama', { full: true })
  assert.equal(hasil.body.count, 1, 'cookie 2 jam seharusnya masih hidup (TTL cookie 24 jam)')
  assert.equal(hasil.body.tokens[0].token, 'session=cookie-2-jam')

  const semua = hasil.body.tokens.map((t: { token: string }) => t.token)
  assert.ok(!semua.includes('session=cookie-25-jam'), 'cookie berumur 25 jam tidak dipangkas')
  assert.ok(!semua.includes('jwt-2-jam'), 'token berumur 2 jam tidak dipangkas (TTL-nya 1 jam)')
})

test('credential yang sama tidak digandakan, dan hanya 10 terbaru disimpan', async () => {
  const ulang1 = await kirim(PENGGUNA.D, { provider: 'nexabot', token: 'session=d0', kind: 'cookie' })
  assert.equal(ulang1.body.tokenCount, 1)

  const ulang2 = await kirim(PENGGUNA.D, { provider: 'nexabot', token: 'session=d0', kind: 'cookie' })
  assert.equal(ulang2.body.message, 'Token already synced', 'credential yang sama digandakan')
  assert.equal(ulang2.body.tokenCount, 1)

  for (let i = 1; i <= 12; i++) {
    const res = await kirim(PENGGUNA.D, { provider: 'nexabot', token: `session=d${i}`, kind: 'cookie' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
  }

  const isi = await ambil(PENGGUNA.D, 'nexabot', { full: true })
  const tersimpan = isi.body.tokens.map((t: { token: string }) => t.token)
  assert.equal(tersimpan.length, 10, 'batas 10 token terbaru tidak berlaku')
  assert.ok(tersimpan.includes('session=d12'), 'token terbaru tidak masuk')
  assert.ok(!tersimpan.includes('session=d0'), 'token terlama tidak dipangkas')
  assert.ok(!tersimpan.includes('session=d1'), 'token terlama tidak dipangkas')
})
