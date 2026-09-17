#!/usr/bin/env node
/**
 * VERIFIKASI R2 — membuktikan unggahan benar-benar terjadi, bukan sekadar
 * "tidak ada error".
 *
 * Kenapa ada: `/api/public/r2-upload` mengembalikan 500 "R2 not configured"
 * baik ketika kredensial memang belum diisi MAUPUN ketika kode gagal memuat
 * SDK-nya (bug `require` di file ESM). Dua kondisi itu tidak bisa dibedakan
 * dari respons HTTP, jadi satu-satunya bukti yang sah adalah benar-benar
 * menulis objek ke bucket lalu membacanya kembali.
 *
 * Yang dilakukan, berurutan:
 *   1. PUT  objek uji kecil ke bucket
 *   2. LIST untuk memastikan objek itu benar-benar ada di bucket
 *   3. GET  dan bandingkan isinya dengan yang dikirim
 *   4. DELETE objek uji (bersih-bersih)
 *
 * Pemakaian (dari root project, membaca .env):
 *   node scripts/verify-r2.mjs
 *
 * Exit 0 = round-trip sungguh berhasil. Exit 1 = gagal, dengan langkah mana.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── Muat .env (tanpa dependency tambahan) ───────────────────────────────────
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
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '')

const missing = [
  ['R2_ACCOUNT_ID', ACCOUNT],
  ['R2_ACCESS_KEY_ID', KEY_ID],
  ['R2_SECRET_ACCESS_KEY', SECRET],
  ['R2_BUCKET_NAME', BUCKET],
].filter(([, v]) => !v).map(([k]) => k)

if (missing.length) {
  console.log('❌ R2 BELUM DIKONFIGURASI — kunci berikut kosong/tidak ada:')
  for (const k of missing) console.log(`   - ${k}`)
  console.log('\n   Isi di .env, format:  R2_ACCOUNT_ID=xxxx')
  console.log('   Setelah itu restart proses:  pm2 restart arkxmotion --update-env')
  process.exit(1)
}

console.log(`🔎 Verifikasi R2 — bucket "${BUCKET}" @ ${ACCOUNT}`)
console.log('')

let S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand
try {
  // Dynamic import: proyek ini ESM ("type":"module"), `require` tidak ada
  // saat runtime — memakainya justru jadi bug yang skrip ini dimaksudkan
  // untuk mendeteksi.
  ;({ S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } =
    await import('@aws-sdk/client-s3'))
} catch (err) {
  console.log('❌ Gagal memuat @aws-sdk/client-s3:', err.message)
  console.log('   Jalankan: npm install')
  process.exit(1)
}
console.log('1. SDK @aws-sdk/client-s3           ✓ termuat')

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET },
})

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const key = `_verify/roundtrip-${stamp}.txt`
const body = `arkxmotion r2 round-trip ${stamp} ${crypto.randomUUID()}`

let step = 2
try {
  await client.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: 'text/plain',
  }))
  console.log(`${step++}. PUT  objek uji                   ✓ ${key}`)

  const listed = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: key }))
  const found = (listed.Contents || []).some((o) => o.Key === key)
  if (!found) throw new Error('objek tidak muncul di ListObjectsV2 — unggahan tidak benar-benar tersimpan')
  console.log(`${step++}. LIST objek ada di bucket         ✓ terkonfirmasi`)

  const got = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  const back = await got.Body.transformToString()
  if (back !== body) throw new Error('isi objek berbeda dari yang dikirim')
  console.log(`${step++}. GET  isi objek identik           ✓ cocok`)

  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
  console.log(`${step++}. DELETE objek uji                 ✓ dibersihkan`)

  console.log('\n✅ R2 ROUND-TRIP BERHASIL — kredensial, bucket, dan jaringan benar-benar bekerja.')
  if (PUBLIC_URL) console.log(`   URL publik: ${PUBLIC_URL}/<key>`)
  else console.log('   (R2_PUBLIC_URL belum diisi — URL publik objek tidak akan dikembalikan)')
  process.exit(0)
} catch (err) {
  console.log(`❌ GAGAL pada langkah ${step}: ${err.name || 'Error'}: ${err.message}`)
  if (err.name === 'NoSuchBucket') console.log('   → nama bucket salah atau bucket belum dibuat')
  else if (/EPROTO|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|getaddrinfo/.test(String(err.message))) {
    console.log('   → koneksi/TLS ke endpoint R2 gagal; cek R2_ACCOUNT_ID dan jaringan keluar')
  } else if (/AccessDenied|SignatureDoesNotMatch|InvalidAccessKeyId/.test(String(err.message))) {
    console.log('   → kredensial ditolak; cek R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY dan izin token')
  }
  process.exit(1)
}
