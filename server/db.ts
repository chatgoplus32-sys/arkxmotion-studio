import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Path DB bisa ditimpa lewat env supaya test memakai file sendiri dan tidak
// menyentuh data dev (tanpa env, perilakunya sama seperti sebelumnya).
export const dbPath =
  process.env.ARKXMOTION_DB_PATH || path.join(__dirname, '..', 'data', 'arkxmotion.db')

import fs from 'fs'
const dataDir = path.dirname(dbPath)
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
    provider TEXT NOT NULL CHECK(provider IN ('brain','weavy','wavespeed','roboneo','runninghub','framia','leonardo','createpulse','galleri5','oneover','firefly','riverside','nexabot')),
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

// ─── Wallet NexaBot ────────────────────────────────────────────────────────
// Sama seperti CreatePulse (prepaid Rp per generate), tapi saldo terpisah:
// harga flat Rp 250/generate dan tidak menyentuh ledger CreatePulse.
db.exec(`
  CREATE TABLE IF NOT EXISTS nexabot_balance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`)

// `kind` memisahkan top up saldo ('balance') dari pembelian paket Unlimited
// ('unlimited'). Kolom `days` + `expires_at` hanya terisi untuk paket, dan diisi
// saat admin approve — bukan saat user mengajukan. `package_slug` menyimpan
// varian yang dibeli (mist. unlimited_monthly) supaya riwayat & antrian admin
// bisa menampilkan namanya, bukan cuma jumlah hari.
db.exec(`
  CREATE TABLE IF NOT EXISTS nexabot_topup (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    kind TEXT NOT NULL DEFAULT 'balance' CHECK(kind IN ('balance', 'unlimited')),
    days INTEGER NOT NULL DEFAULT 0,
    package_slug TEXT NOT NULL DEFAULT '',
    started_at DATETIME,
    expires_at DATETIME,
    proof_note TEXT NOT NULL DEFAULT '',
    admin_note TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`)

// Migrasi DB lama: kolom paket Unlimited ditambahkan kalau belum ada.
const nexabotTopupColumns = db.prepare("PRAGMA table_info(nexabot_topup)").all() as { name: string }[]
if (!nexabotTopupColumns.some(c => c.name === 'kind')) {
  db.exec("ALTER TABLE nexabot_topup ADD COLUMN kind TEXT NOT NULL DEFAULT 'balance'")
}
if (!nexabotTopupColumns.some(c => c.name === 'days')) {
  db.exec('ALTER TABLE nexabot_topup ADD COLUMN days INTEGER NOT NULL DEFAULT 0')
}
if (!nexabotTopupColumns.some(c => c.name === 'started_at')) {
  db.exec('ALTER TABLE nexabot_topup ADD COLUMN started_at DATETIME')
}
if (!nexabotTopupColumns.some(c => c.name === 'expires_at')) {
  db.exec('ALTER TABLE nexabot_topup ADD COLUMN expires_at DATETIME')
}
if (!nexabotTopupColumns.some(c => c.name === 'package_slug')) {
  db.exec("ALTER TABLE nexabot_topup ADD COLUMN package_slug TEXT NOT NULL DEFAULT ''")
}
db.exec('CREATE INDEX IF NOT EXISTS idx_nexabot_topup_active ON nexabot_topup(user_id, kind, status)')

db.exec(`
  CREATE TABLE IF NOT EXISTS nexabot_usage (
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

db.exec(`
  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)
db.exec('CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_email_time ON login_attempts(ip, email, created_at)')

const userCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[]
if (!userCols.some(c => c.name === 'refresh_token')) {
  db.exec('ALTER TABLE users ADD COLUMN refresh_token TEXT')
}
if (!userCols.some(c => c.name === 'refresh_expires')) {
  db.exec('ALTER TABLE users ADD COLUMN refresh_expires DATETIME')
}

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

const providers = ['weavy', 'wavespeed', 'magnific', 'roboneo', 'createpulse', 'framia', 'firefly', 'leonardo', 'gemini', 'openai', 'shotstack', 'creatomate', 'riverside', 'nexabot']
for (const p of providers) {
  const exists = db.prepare('SELECT id FROM provider_maintenance WHERE provider = ?').get(p)
  if (!exists) {
    db.prepare('INSERT INTO provider_maintenance (provider, is_maintenance, message) VALUES (?, 0, \'\')').run(p)
  }
}

// ── Notifications (admin → user broadcasts & system alerts) ─────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'info' CHECK(type IN ('info', 'warning', 'success', 'error', 'announcement')),
    target TEXT NOT NULL DEFAULT 'all' CHECK(target IN ('all', 'users', 'admins')),
    user_id INTEGER DEFAULT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`)
db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)')
db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read)')
db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at)')

// ── Biaya upstream NexaBot per job ────────────────────────────────────
// Pertanyaan yang tabel ini jawab: "paket Unlimited yang saya jual menutup biaya
// atau saya yang mensubsidi?" Tanpa catatan ini, pemakaian member yang gratis
// (biaya lokal 0) tidak meninggalkan jejak apa pun, padahal job-nya tetap
// dibayar ke nexabot lewat kredensial yang dipakai.
//
// Dua hal yang dicatat dan dua hal yang SENGAJA tidak:
//  - dicatat: jenis kredensial (cookie sesi vs API key) dan sidik jarinya, supaya
//    terlihat job seorang member memakai kredensial siapa (kredensial miliknya
//    atau kredensial induk) tanpa pernah menyimpan rahasianya;
//  - dicatat: angka biaya HANYA kalau upstream melaporkannya. Kalau tidak,
//    nilainya NULL dan jumlah job-nya yang jadi ukuran — bukan angka karangan;
//  - tidak dicatat: isi kredensial (cookie/API key) dalam bentuk apa pun;
//  - tidak dicatat: rute baca seperti poll job/health/credit, supaya tabelnya
//    tidak tenggelam oleh poll tiap detik.
db.exec(`
  CREATE TABLE IF NOT EXISTS nexabot_upstream_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    route TEXT NOT NULL,
    credential_kind TEXT NOT NULL CHECK(credential_kind IN ('cookie', 'api-key')),
    credential_fingerprint TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    cost_field TEXT,
    cost_value REAL,
    evidence TEXT,
    created_at INTEGER NOT NULL
  )
`)
// user_id sengaja tanpa foreign key: baris boleh tidak teratribusi (relay ini
// terbuka untuk pemanggil tanpa identitas), dan itu keadaan yang sah.
db.exec('CREATE INDEX IF NOT EXISTS idx_nxb_usage_user ON nexabot_upstream_usage(user_id, created_at)')
db.exec('CREATE INDEX IF NOT EXISTS idx_nxb_usage_created ON nexabot_upstream_usage(created_at)')

// ── Antrean credential dari extension (sync-tokens) ───────────────────
// Dulu antrean ini hanya hidup di memori proses. Setiap deploy me-restart
// server, dan cookie sesi nexabot yang baru dikirim extension tapi belum sempat
// diambil poller app (interval 30 detik) ikut hilang — pengguna melihat sync
// "berhasil" tapi login-nya tidak pernah masuk. Sekarang antrean ditulis ke DB,
// jadi ia melewati restart. Versi Vercel (api/sync-tokens.ts) menyimpannya di
// Postgres per user; tabel ini padanannya untuk server Express.
db.exec(`
  CREATE TABLE IF NOT EXISTS sync_token_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    token TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'token',
    source TEXT,
    created_at INTEGER NOT NULL
  )
`)
// user_id sengaja TANPA foreign key: antrean ini data sementara, dan baris milik
// pengguna yang sudah dihapus cukup dipangkas oleh TTL. FK di sini akan mengubah
// sync yang sah menjadi error 500 begitu ada baris users yang hilang.
db.exec('CREATE INDEX IF NOT EXISTS idx_sync_queue_user_provider ON sync_token_queue(user_id, provider)')
db.exec('CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_token_queue(created_at)')
// Credential yang sama tidak perlu disimpan dua kali untuk user+provider yang
// sama; router memakai INSERT OR IGNORE dan mengandalkan batasan unik ini.
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_queue_unique ON sync_token_queue(user_id, provider, token)')

export default db
