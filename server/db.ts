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

const adminUser = db.prepare("SELECT id FROM users WHERE role = 'admin' AND email = 'nuallakoko@gmail.com'").get() as { id: number } | undefined
if (adminUser) {
  db.prepare("UPDATE users SET approved = 1 WHERE id = ?").run(adminUser.id)
}

export default db
