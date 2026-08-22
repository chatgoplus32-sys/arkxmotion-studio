import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.join(__dirname, '..', 'data', 'arkxmotion.db')

import fs from 'fs'
const dataDir = path.join(__dirname, '..', 'data')
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
    approved INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[]
if (!columns.some(c => c.name === 'approved')) {
  db.exec("ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 0")
}

// ── Email verification & password reset ──────────────────────────────────
if (!columns.some(c => c.name === 'email_verified')) {
  db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0")
  // Akun yang sudah ada sebelum fitur ini dianggap sudah terverifikasi
  db.exec('UPDATE users SET email_verified = 1')
}
if (!columns.some(c => c.name === 'email_verify_token')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verify_token TEXT')
}
if (!columns.some(c => c.name === 'email_verify_expires')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verify_expires DATETIME')
}
if (!columns.some(c => c.name === 'reset_token')) {
  db.exec('ALTER TABLE users ADD COLUMN reset_token TEXT')
}
if (!columns.some(c => c.name === 'reset_expires')) {
  db.exec('ALTER TABLE users ADD COLUMN reset_expires DATETIME')
}
if (!columns.some(c => c.name === 'payment_token')) {
  db.exec('ALTER TABLE users ADD COLUMN payment_token TEXT')
}

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL CHECK(provider IN ('roboneo', 'framia', 'weavy', 'createpulse')),
    name TEXT NOT NULL,
    token_value TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    credits INTEGER DEFAULT NULL,
    credit_group TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'sold')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

const tokenColumns = db.prepare("PRAGMA table_info(tokens)").all() as { name: string }[]
if (!tokenColumns.some(c => c.name === 'credits')) {
  db.exec("ALTER TABLE tokens ADD COLUMN credits INTEGER DEFAULT NULL")
}
if (!tokenColumns.some(c => c.name === 'credit_group')) {
  db.exec("ALTER TABLE tokens ADD COLUMN credit_group TEXT DEFAULT NULL")
}

db.exec(`
  CREATE TABLE IF NOT EXISTS token_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'rejected')),
    bulk_id TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (token_id) REFERENCES tokens(id)
  )
`)

const orderColumns = db.prepare("PRAGMA table_info(token_orders)").all() as { name: string }[]
if (!orderColumns.some(c => c.name === 'bulk_id')) {
  db.exec("ALTER TABLE token_orders ADD COLUMN bulk_id TEXT NOT NULL DEFAULT ''")
}

const adminUser = db.prepare("SELECT id FROM users WHERE role = 'admin' AND email = 'nuallakoko@gmail.com'").get() as { id: number } | undefined
if (adminUser) {
  db.prepare("UPDATE users SET approved = 1 WHERE id = ?").run(adminUser.id)
}

db.exec(`
  CREATE TABLE IF NOT EXISTS createpulse_balance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS createpulse_topup (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    proof_note TEXT NOT NULL DEFAULT '',
    admin_note TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS createpulse_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    model TEXT NOT NULL,
    cost INTEGER NOT NULL,
    batch_id TEXT,
    status TEXT NOT NULL DEFAULT 'used' CHECK(status IN ('used', 'refunded')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS provider_maintenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT UNIQUE NOT NULL,
    is_maintenance INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS generation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    page TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL DEFAULT '',
    credits INTEGER DEFAULT 0,
    slot_count INTEGER DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed')),
    result_url TEXT DEFAULT NULL,
    error TEXT DEFAULT NULL,
    duration_ms INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`)

db.exec(`CREATE INDEX IF NOT EXISTS idx_generation_logs_user_id ON generation_logs(user_id)`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_generation_logs_created_at ON generation_logs(created_at)`)

// ── Anti-spam: catatan percobaan daftar per IP ───────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS register_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)
db.exec('CREATE INDEX IF NOT EXISTS idx_register_attempts_ip_time ON register_attempts(ip, created_at)')

// ── Konfirmasi pembayaran member baru ────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS membership_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    proof_note TEXT NOT NULL DEFAULT '',
    admin_note TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`)
db.exec('CREATE INDEX IF NOT EXISTS idx_membership_payments_user ON membership_payments(user_id)')

// ── Pengaturan app (key-value) ───────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)
// Harga membership default Rp 150.000 (bisa diubah lewat halaman admin)
const feeRow = db.prepare("SELECT value FROM app_settings WHERE key = 'membership_fee'").get() as { value: string } | undefined
if (!feeRow) {
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('membership_fee', '150000')").run()
}

const providers = ['weavy', 'wavespeed', 'magnific', 'roboneo', 'createpulse', 'framia', 'firefly', 'leonardo', 'gemini', 'openai', 'shotstack', 'creatomate']
for (const p of providers) {
  const exists = db.prepare('SELECT id FROM provider_maintenance WHERE provider = ?').get(p)
  if (!exists) {
    db.prepare('INSERT INTO provider_maintenance (provider, is_maintenance, message) VALUES (?, 0, \'\')').run(p)
  }
}

export default db
