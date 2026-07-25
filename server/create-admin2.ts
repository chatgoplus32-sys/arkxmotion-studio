import bcrypt from 'bcryptjs'
import db from './db.js'

const email = 'admin2@gmail.com'
const password = 'admin123'
const name = 'Admin 2'
const role = 'admin'

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | undefined
if (existing) {
  console.log(`User ${email} already exists`)
  const users = db.prepare('SELECT id, email, name, role, approved FROM users').all()
  console.log('All users:', JSON.stringify(users, null, 2))
  process.exit(0)
}

const hashedPassword = await bcrypt.hash(password, 10)
db.prepare('INSERT INTO users (email, password, name, role, approved) VALUES (?, ?, ?, ?, ?)').run(email, hashedPassword, name, role, 1)

console.log('Admin 2 user created!')
console.log('Email:', email)
console.log('Password:', password)
console.log('Role:', role)

const users = db.prepare('SELECT id, email, name, role, approved FROM users').all()
console.log('\nAll users:', JSON.stringify(users, null, 2))

process.exit(0)
