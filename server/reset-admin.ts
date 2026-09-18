import bcrypt from 'bcryptjs'
import db from './db.js'

const email = process.env.ADMIN_EMAIL
const password = process.env.ADMIN_PASSWORD
const name = 'Admin'
const role = 'admin'

if (!email || !password) {
  console.error('ADMIN_EMAIL dan ADMIN_PASSWORD wajib diisi di env')
  process.exit(1)
}

db.prepare('DELETE FROM users WHERE email = ?').run(email)

const hashedPassword = await bcrypt.hash(password, 10)
db.prepare('INSERT INTO users (email, password, name, role, approved) VALUES (?, ?, ?, ?, ?)').run(email, hashedPassword, name, role, 1)

console.log('Admin user created!')
console.log('Email:', email)
console.log('Role:', role)
console.log('Approved: true')

process.exit(0)
