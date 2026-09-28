#!/usr/bin/env node
/**
 * Buat (atau set ulang) akun demo untuk PREVIEW LOKAL.
 *
 * Kenapa ada: `server/seed.ts` sengaja tidak mengubah akun yang sudah ada, jadi
 * password akun dev sering tak diketahui lagi — sementara password produksi
 * TIDAK berlaku di database dev (DB-nya terpisah). Skrip ini menulis ke DB dev
 * saja, jadi akun produksi tidak pernah tersentuh.
 *
 * Pemakaian:
 *   node scripts/seed-demo-user.mjs                       # password acak, dicetak sekali
 *   node scripts/seed-demo-user.mjs --email me@dev.test --password rahasia --role admin
 *   node scripts/seed-demo-user.mjs --clear-attempts      # hanya bersihkan rate limit login
 *
 * Tidak ada password bawaan di dalam skrip ini: kalau tidak diberi, password
 * dibuat acak dan dicetak. Rahasia literal di berkas yang ter-commit adalah pola
 * yang justru dihindari skrip deploy — jadi jangan tambahkan password default.
 *
 * Akun ini hanya hidup di DB lokal: DB dev tidak pernah diunggah ke VPS
 * (deploy melewati berkas .db), jadi tidak bisa bocor ke produksi.
 */
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DB_PATH = process.env.ARKXMOTION_DB_PATH || path.join(ROOT, 'data', 'arkxmotion.db')
const DEFAULT_EMAIL = 'demo@arkxmotion.local'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

/** Password acak yang mudah diketik ulang dari terminal. */
function generatePassword() {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(16)
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
}

const email = String(arg('email', DEFAULT_EMAIL)).toLowerCase().trim()
const role = arg('role', 'admin')
const name = arg('name', 'Demo Preview')
const clearOnly = process.argv.includes('--clear-attempts')
const givenPassword = arg('password', process.env.DEMO_PASSWORD || '')
const password = givenPassword || generatePassword()
const generated = !givenPassword

if (!email.includes('@')) {
  console.error(`❌ email tidak valid: ${email}`)
  process.exit(1)
}

if (password.length < 8) {
  console.error('❌ password minimal 8 karakter')
  process.exit(1)
}

const db = new Database(DB_PATH)
db.pragma('foreign_keys = ON')

// Bersihkan penghitung percobaan login gagal (5 per 15 menit per IP+email),
// supaya kalau baru saja salah password berkali-kali tidak terkunci.
const cleared = db.prepare('DELETE FROM login_attempts WHERE email = ?').run(email)
console.log(`🧹 penghitung percobaan gagal dibersihkan untuk ${email}: ${cleared.changes} baris`)

if (clearOnly) {
  console.log('✅ selesai (mode --clear-attempts, akun tidak diubah)')
  process.exit(0)
}

const hash = bcrypt.hashSync(password, 10)
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)

if (existing) {
  db.prepare(
    `UPDATE users SET password = ?, name = ?, role = ?, approved = 1, email_verified = 1,
     updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(hash, name, role, existing.id)
  console.log(`♻️  akun diperbarui: ${email} (id ${existing.id})`)
} else {
  const info = db
    .prepare(
      `INSERT INTO users (email, password, name, role, approved, email_verified, created_at)
       VALUES (?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP)`,
    )
    .run(email, hash, name, role)
  console.log(`✅ akun dibuat: ${email} (id ${info.lastInsertRowid})`)
}

console.log(`   role: ${role} | approved: ya | verifikasi email: ya`)
if (generated) {
  console.log(`   password (acak, hanya tampil sekarang): ${password}`)
} else {
  console.log('   password: <sesuai yang kamu berikan lewat --password atau DEMO_PASSWORD>')
}
console.log(`   database: ${DB_PATH}`)
console.log('\nLogin lewat preview di http://localhost:5173/login')
