// ─── Penjaga urutan pemuatan .env ───────────────────────────────────────────
// ESM mengevaluasi seluruh impor sebuah modul SEBELUM body-nya. Jadi
// `dotenv.config()` yang ditulis di body server/index.ts berjalan setelah modul
// seperti lib/backupR2.ts membaca `process.env.R2_*` di top level.
//
// Ini bukan teori: dengan isi .env yang sama, menukar urutan dua impor di
// index.ts mengubah getBackupStatus().r2.configured dari true menjadi false —
// kredensial R2 yang sudah benar tinggal tidak terpakai, tanpa error, sementara
// scheduler tetap menyala karena barisnya ada di body.
//
// Satu-satunya yang menjaga itu sekarang: `import './env.js'` sebagai impor
// PALING AWAL. Tes ini memastikan tidak ada yang memindahkannya ke bawah.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const indexSource = fs.readFileSync(path.join(ROOT, 'server', 'index.ts'), 'utf8')
const envSource = fs.readFileSync(path.join(ROOT, 'server', 'env.ts'), 'utf8')

/** Impor yang benar-benar dievaluasi, urut: komentar dan baris kosong dilewati. */
function importLines(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('import '))
}

test('server/env.ts adalah modul yang memuat .env', () => {
  assert.match(envSource, /dotenv\.config\(\)/, 'env.ts harus memanggil dotenv.config()')
  assert.match(envSource, /from 'dotenv'/, 'env.ts harus mengimpor dotenv')
})

test('impor paling awal server/index.ts adalah ./env.js', () => {
  const imports = importLines(indexSource)
  assert.ok(imports.length > 10, 'index.ts seharusnya punya banyak impor')
  assert.equal(
    imports[0],
    "import './env.js'",
    'impor ./env.js harus PALING AWAL — kalau tidak, modul yang membaca process.env di top level akan melihat nilai kosong',
  )
})

test('tidak ada pemuatan .env kedua di index.ts', () => {
  // Satu sumber kebenaran: kalau ada dotenv.config() lagi di body, pembaca akan
  // mengira itulah yang memuat .env, padahal yang menentukan urutan adalah impor.
  assert.doesNotMatch(
    indexSource,
    /dotenv\.config\(\)/,
    'index.ts tidak boleh memuat .env sendiri lagi — itu tugas server/env.ts',
  )
})

test('modul yang membaca process.env di top level diimpor setelah env.js', () => {
  const imports = importLines(indexSource)
  const envIndex = imports.indexOf("import './env.js'")
  assert.ok(envIndex !== -1, 'index.ts harus mengimpor ./env.js')

  for (const modul of ['./backup.js', './lib/backupR2.js', './lib/alerts.js', './routes/auth.js']) {
    const idx = imports.findIndex((line) => line.includes(`'${modul}'`))
    assert.ok(idx !== -1, `${modul} seharusnya diimpor index.ts`)
    assert.ok(idx > envIndex, `${modul} diimpor sebelum env.js — .env belum termuat saat dievaluasi`)
  }
})
