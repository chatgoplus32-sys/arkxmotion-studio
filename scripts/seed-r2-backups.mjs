#!/usr/bin/env node
/**
 * SEED BACKUP LOKAL KE R2 — sekali jalan, sebelum scheduler menyala.
 *
 * Kenapa perlu: `runBackup()` hanya mengunggah snapshot yang BARU ia buat.
 * Begitu scheduler berjalan, `pruneLocalBackups()` memangkas lokal ke
 * BACKUP_KEEP_LOCAL (default 7) — dan snapshot lama yang belum pernah naik ke R2
 * akan hilang permanen, bukan cuma "dipindah". Skrip ini menutup lubang itu:
 * unggah dulu yang sudah ada, baru biarkan pemangkasan bekerja.
 *
 * Sifatnya:
 *   - idempoten: objek yang sudah ada di R2 dilewati, jadi aman dijalankan ulang
 *   - tidak pernah menghapus apa pun (tidak ada DeleteObject sama sekali)
 *   - urut dari yang paling lama, supaya LastModified di R2 sejalan dengan nama
 *     berkas — pemangkasan R2 sendiri mengurutkan pakai LastModified
 *   - berakhir dengan verifikasi LIST: exit 0 hanya kalau SEMUA berkas lokal
 *     benar-benar ada di bucket
 *
 * Pemakaian (dari root project, membaca .env):
 *   node scripts/seed-r2-backups.mjs --dry-run
 *   node scripts/seed-r2-backups.mjs
 *
 * Jalankan `node scripts/verify-r2.mjs` lebih dulu: kalau round-trip dasar belum
 * berhasil, mengunggah 30 berkas hanya menghabiskan waktu.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKUP_DIR = path.join(ROOT, 'data', 'backups')
const PREFIX = 'backups/database/'
const DRY = process.argv.includes('--dry-run')

if (process.argv.includes('--help')) {
  console.log('Pemakaian: node scripts/seed-r2-backups.mjs [--dry-run]')
  console.log('  Mengunggah data/backups/arkxmotion-*.db yang belum ada di R2.')
  console.log('  Tidak menghapus apa pun. Idempoten.')
  process.exit(0)
}

// ── Muat .env (pola sama dengan scripts/verify-r2.mjs) ─────────────────────
function loadEnv() {
  const file = path.join(ROOT, '.env')
  if (!fs.existsSync(file)) return
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '')
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnv()

const ACCOUNT = process.env.R2_ACCOUNT_ID || ''
const KEY_ID = process.env.R2_ACCESS_KEY_ID || ''
const SECRET = process.env.R2_SECRET_ACCESS_KEY || ''
const BUCKET = process.env.R2_BUCKET_NAME || ''
const MAX_R2 = Number(process.env.BACKUP_KEEP_R2) || 30

const missing = [
  ['R2_ACCOUNT_ID', ACCOUNT],
  ['R2_ACCESS_KEY_ID', KEY_ID],
  ['R2_SECRET_ACCESS_KEY', SECRET],
  ['R2_BUCKET_NAME', BUCKET],
].filter(([, v]) => !v).map(([k]) => k)

if (missing.length) {
  console.log('❌ R2 BELUM DIKONFIGURASI — kunci berikut kosong/tidak ada:')
  for (const k of missing) console.log(`   - ${k}`)
  console.log('\n   Isi di .env, lalu jalankan: node scripts/verify-r2.mjs')
  process.exit(1)
}

// ── Berkas lokal ───────────────────────────────────────────────────────────
if (!fs.existsSync(BACKUP_DIR)) {
  console.log(`❌ Folder backup tidak ada: ${BACKUP_DIR}`)
  process.exit(1)
}

const locals = fs
  .readdirSync(BACKUP_DIR)
  .filter((f) => /^arkxmotion-.*\.db$/.test(f))
  .map((f) => ({ name: f, full: path.join(BACKUP_DIR, f), size: fs.statSync(path.join(BACKUP_DIR, f)).size }))
  .sort((a, b) => a.name.localeCompare(b.name)) // lama → baru

console.log(`📦 Snapshot lokal: ${locals.length} berkas (${(locals.reduce((a, f) => a + f.size, 0) / 1024 / 1024).toFixed(2)} MB)`)
console.log(`🪣 Bucket: "${BUCKET}" @ ${ACCOUNT}, prefix "${PREFIX}"`)
console.log('')

if (locals.length === 0) {
  console.log('Tidak ada snapshot lokal untuk diunggah. Selesai tanpa perubahan.')
  process.exit(0)
}

// ── SDK ────────────────────────────────────────────────────────────────────
let S3Client, PutObjectCommand, ListObjectsV2Command
try {
  ;({ S3Client, PutObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3'))
} catch (err) {
  console.log('❌ Gagal memuat @aws-sdk/client-s3:', err.message)
  console.log('   Jalankan: npm install')
  process.exit(1)
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET },
})

async function listKeys() {
  const keys = new Set()
  let token
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token }),
    )
    for (const obj of res.Contents || []) keys.add(obj.Key)
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  return keys
}

let existing
try {
  existing = await listKeys()
} catch (err) {
  console.log(`❌ Gagal membaca daftar objek di R2 (${err.name || 'Error'}): ${err.message}`)
  console.log('   Periksa kredensial/bucket dengan: node scripts/verify-r2.mjs')
  process.exit(1)
}

const todo = locals.filter((f) => !existing.has(PREFIX + f.name))
console.log(`☁️  Sudah ada di R2 : ${locals.length - todo.length} dari ${locals.length}`)
console.log(`⬆️  Akan diunggah   : ${todo.length}`)

if (todo.length === 0) {
  console.log('\n✅ Semua snapshot lokal sudah punya salinan di R2. Tidak ada yang perlu diunggah.')
  process.exit(0)
}

if (DRY) {
  console.log('\n(dry-run) Rencana unggahan, dari yang paling lama:')
  for (const f of todo) console.log(`   + ${PREFIX}${f.name}  (${Math.round(f.size / 1024)} KB)`)
  console.log('\nJalankan tanpa --dry-run untuk benar-benar mengunggah.')
  process.exit(0)
}

// ── Unggah ─────────────────────────────────────────────────────────────────
console.log('')
let uploaded = 0
let failed = 0
for (const f of todo) {
  const key = PREFIX + f.name
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: fs.readFileSync(f.full),
        ContentType: 'application/octet-stream',
        Metadata: {
          'backup-timestamp': fs.statSync(f.full).mtime.toISOString(),
          'backup-size': String(Math.round(f.size / 1024)),
        },
      }),
    )
    uploaded++
    console.log(`   ✓ ${key}  (${Math.round(f.size / 1024)} KB)`)
  } catch (err) {
    failed++
    console.log(`   ✗ ${key} — ${err.name || 'Error'}: ${err.message}`)
  }
}

// ── Verifikasi: bukan "tidak ada error", tapi "ada di bucket" ───────────────
console.log('\n🔎 Verifikasi dengan membaca ulang daftar objek…')
const sesudah = await listKeys()
const hilang = locals.filter((f) => !sesudah.has(PREFIX + f.name)).map((f) => f.name)

const totalR2 = [...sesudah].filter((k) => k.startsWith(PREFIX)).length
console.log(`   Objek backup di R2 sekarang: ${totalR2}`)

if (hilang.length) {
  console.log(`\n❌ ${hilang.length} berkas tetap tidak ada di R2 setelah diunggah:`)
  for (const n of hilang.slice(0, 10)) console.log(`   - ${n}`)
  process.exit(1)
}

console.log(`\n✅ SELESAI — ${uploaded} diunggah, ${failed} gagal, dan semua ${locals.length} snapshot lokal sudah terkonfirmasi ada di R2.`)

if (totalR2 > MAX_R2) {
  console.log('')
  console.log(`⚠️  R2 sekarang menyimpan ${totalR2} objek, sedangkan BACKUP_KEEP_R2 = ${MAX_R2}.`)
  console.log(`   Backup terjadwal berikutnya akan memangkas ${totalR2 - MAX_R2} objek paling lama dari R2.`)
  console.log(`   Kalau seluruh riwayat ini ingin disimpan, naikkan BACKUP_KEEP_R2 di .env sebelum`)
  console.log('   scheduler menyala, lalu restart: pm2 restart arkxmotion --update-env')
}
process.exit(failed > 0 ? 1 : 0)
