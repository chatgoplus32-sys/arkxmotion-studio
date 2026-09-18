import bcrypt from 'bcryptjs'
import db from './db.js'

const email = process.env.ADMIN_EMAIL
const password = process.env.ADMIN_PASSWORD
const name = 'Admin 2'
const role = 'admin'

if (!email || !password) {
  console.error('ADMIN_EMAIL dan ADMIN_PASSWORD wajib diisi di env')
  process.exit(1)
}

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | undefined
if (existing) {
  console.log(`User ${email} already exists`)
  process.exit(0)
}

const hashedPassword = await bcrypt.hash(password, 10)
db.prepare('INSERT INTO users (email, password, name, role, approved) VALUES (?, ?, ?, ?, ?)').run(email, hashedPassword, name, role, 1)

console.log('Admin 2 user created!')
console.log('Email:', email)
console.log('Role:', role)

process.exit(0)
