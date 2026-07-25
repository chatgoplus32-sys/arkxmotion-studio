import bcrypt from 'bcryptjs'
import db from './db.js'

const email = 'nuallakoko@gmail.com'
const password = 'admin123'
const name = 'Admin'
const role = 'admin'

db.prepare('DELETE FROM users WHERE email = ?').run(email)

const hashedPassword = await bcrypt.hash(password, 10)
db.prepare('INSERT INTO users (email, password, name, role, approved) VALUES (?, ?, ?, ?, ?)').run(email, hashedPassword, name, role, 1)

console.log('Admin user created!')
console.log('Email:', email)
console.log('Password:', password)
console.log('Role:', role)
console.log('Approved: true')

const users = db.prepare('SELECT id, email, name, role, approved FROM users').all()
console.log('\nAll users:', JSON.stringify(users, null, 2))

process.exit(0)
