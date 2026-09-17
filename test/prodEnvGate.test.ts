// ─── Gerbang 3a: proses produksi harus benar-benar NODE_ENV=production ───────
// Gerbang ini membaca environment proses MENURUT OS (/proc/<pid>/environ), jadi
// mengujinya berarti menjalankan skripnya sungguhan dengan berkas environ
// sintetis — bukan menebak dari kode. Kasus yang paling penting: proses yang
// melayani tanpa NODE_ENV sama sekali, yaitu keadaan produksi 17 Sep 2026 yang
// membuat backup otomatis mati tanpa terlihat.
//
// Dua penjaga sumber ikut di bawah: ecosystem.config.cjs harus tetap
// mendeklarasikan NODE_ENV=production, dan deploy harus me-restart lewat berkas
// itu — bukan `pm2 restart <nama>`, yang menyegarkan environment dari shell
// sesi SSH (tanpa NODE_ENV).

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const GATE = path.join(ROOT, 'scripts', 'check-prod-env.sh')

const server = http.createServer((req, res) => {
  if (req.url === '/api/backup/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ startup: { outcome: 'not-run', reason: 'NODE_ENV=(tidak diset)' } }))
    return
  }
  res.writeHead(404)
  res.end('{}')
})

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port

test.after(() => server.close())

interface Hasil {
  code: number
  out: string
}

/** Berkas /proc/<pid>/environ sintetis: entri dipisah NUL, seperti aslinya. */
function tulisEnviron(entries: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prodenv-'))
  const file = path.join(dir, 'environ')
  const buf = Buffer.from(entries.join('\0') + (entries.length ? '\0' : ''), 'utf8')
  fs.writeFileSync(file, buf)
  return file
}

function jalankanGerbang(env: Record<string, string>): Promise<Hasil> {
  return new Promise((resolve) => {
    const child = spawn('bash', [GATE], {
      cwd: ROOT,
      env: {
        ...process.env,
        PM2_PID: '4242',
        BASE_URL: `http://127.0.0.1:${port}`,
        ...env,
      },
    })
    let out = ''
    child.stdout.on('data', (d) => (out += String(d)))
    child.stderr.on('data', (d) => (out += String(d)))
    child.on('close', (code) => resolve({ code: code ?? -1, out }))
  })
}

// ── Perilaku gerbang ────────────────────────────────────────────────────────

test('NODE_ENV=production → lolos', async () => {
  const file = tulisEnviron(['PATH=/usr/bin', 'NODE_ENV=production', 'PORT=6000', 'pm_id=0'])
  const hasil = await jalankanGerbang({ ENVIRON_FILE: file })
  assert.equal(hasil.code, 0, hasil.out)
  assert.match(hasil.out, /GERBANG 3a LOLOS/)
})

test('KASUS PRODUKSI: tanpa NODE_ENV → gagal dan sebabnya dinamai', async () => {
  // Keadaan nyata proses pm2 17 Sep 2026: PORT ada, NODE_ENV sama sekali tidak.
  const file = tulisEnviron(['PATH=/usr/bin', 'PORT=6000', 'pm_id=0'])
  const hasil = await jalankanGerbang({ ENVIRON_FILE: file })
  assert.equal(hasil.code, 1, hasil.out)
  assert.match(hasil.out, /TIDAK PUNYA NODE_ENV/)
  assert.match(hasil.out, /mode dev/)
  assert.match(hasil.out, /pm2 startOrReload ecosystem\.config\.cjs/)
})

test('NODE_ENV=development → gagal, nilainya ikut dicetak', async () => {
  const file = tulisEnviron(['NODE_ENV=development', 'PORT=6000'])
  const hasil = await jalankanGerbang({ ENVIRON_FILE: file })
  assert.equal(hasil.code, 1, hasil.out)
  assert.match(hasil.out, /NODE_ENV='development', bukan 'production'/)
})

test('NODE_ENV kosong → gagal, bukan dianggap production', async () => {
  const file = tulisEnviron(['NODE_ENV=', 'PORT=6000'])
  const hasil = await jalankanGerbang({ ENVIRON_FILE: file })
  assert.equal(hasil.code, 1, hasil.out)
  assert.match(hasil.out, /NODE_ENV='', bukan 'production'/)
})

test('variabel lain yang berakhiran NODE_ENV tidak dihitung', async () => {
  // MY_NODE_ENV=production pernah cukup untuk membuat pencocokan longgar lolos.
  const file = tulisEnviron(['MY_NODE_ENV=production', 'APP_NODE_ENV=production'])
  const hasil = await jalankanGerbang({ ENVIRON_FILE: file })
  assert.equal(hasil.code, 1, hasil.out)
  assert.match(hasil.out, /TIDAK PUNYA NODE_ENV/)
})

test('NODE_ENV=productionProduction tidak lolos (bukan kecocokan sebagian)', async () => {
  const file = tulisEnviron(['NODE_ENV=productionProduction'])
  const hasil = await jalankanGerbang({ ENVIRON_FILE: file })
  assert.equal(hasil.code, 1, hasil.out)
})

test('environment yang tidak terbaca → gagal dengan petunjuk, bukan lolos', async () => {
  const hasil = await jalankanGerbang({ ENVIRON_FILE: '/tmp/tidak-ada-environ-xyz' })
  assert.equal(hasil.code, 1, hasil.out)
  assert.match(hasil.out, /tidak bisa dibaca/)
})

test('kegagalan mencetak diagnosis: deklarasi ecosystem dan laporan aplikasi', async () => {
  const file = tulisEnviron(['PORT=6000'])
  const hasil = await jalankanGerbang({ ENVIRON_FILE: file })
  assert.match(hasil.out, /yang dideklarasikan ecosystem\.config\.cjs/)
  assert.match(hasil.out, /NODE_ENV: 'production'/)
  assert.match(hasil.out, /laporan aplikasi sendiri/)
  assert.match(hasil.out, /not-run/)
})

// ── Penjaga sumber: konfigurasi dan deploy tidak boleh lepas satu sama lain ──

function baca(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

/** Baris kode saja — komentar `#` dan `//` dibuang supaya penjaga tidak cocok
 *  dengan kalimat penjelas yang justru menyebut pola lamanya. */
function kode(rel: string): string {
  return baca(rel)
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return !t.startsWith('#') && !t.startsWith('//')
    })
    .join('\n')
}

test('ecosystem.config.cjs mendeklarasikan NODE_ENV production dan PORT', () => {
  const eco = kode('ecosystem.config.cjs')
  assert.match(eco, /NODE_ENV:\s*'production'/, 'NODE_ENV produksi hilang dari ecosystem.config.cjs')
  assert.match(eco, /PORT:\s*6000/)
})

test('deploy me-restart lewat ecosystem.config.cjs, bukan pm2 restart <nama>', () => {
  const wf = kode('.github/workflows/deploy-vps.yml')
  assert.match(wf, /pm2 startOrReload ecosystem\.config\.cjs/, 'deploy harus menerapkan environment dari berkas ecosystem')
  assert.doesNotMatch(
    wf,
    /pm2\s+restart\s+arkxmotion/,
    '`pm2 restart <nama>` menyegarkan environment dari shell sesi SSH, sehingga NODE_ENV tidak pernah sampai ke proses',
  )
})

test('deploy benar-benar MEMANGGIL gerbang 3a, sebelum gerbang 3', () => {
  // Bukan sekadar menyebut: yang diperiksa adalah baris perintahnya, karena
  // pesan petunjuk juga memuat nama skrip ini dan itu tidak menjalankan apa pun.
  const wf = kode('.github/workflows/deploy-vps.yml')
  const panggil3a = /^[ \t]*if ! bash scripts\/check-prod-env\.sh; then[ \t]*$/m
  const panggil3 = /^[ \t]*if ! bash scripts\/check-boot-backup\.sh "\$RESTART_MARKER"; then[ \t]*$/m

  assert.match(wf, panggil3a, 'deploy tidak memanggil gerbang 3a sebagai baris perintah — skripnya ada tapi tidak dijalankan')
  assert.match(wf, panggil3, 'deploy tidak memanggil gerbang 3 sebagai baris perintah')

  const i3a = wf.search(panggil3a)
  const i3 = wf.search(panggil3)
  assert.ok(i3a < i3, 'gerbang 3a harus diperiksa sebelum gerbang 3, supaya sebabnya dinamai lebih dulu')
})
