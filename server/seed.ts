import bcrypt from 'bcryptjs'
import db from './db.js'

async function seedAdmin() {
  const email = 'nuallakoko@gmail.com'
  const password = 'admin123'
  const name = 'Admin'
  const role = 'admin'

  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | undefined

  if (existingUser) {
    console.log(`User with email ${email} already exists`)
    process.exit(0)
  }

  const hashedPassword = await bcrypt.hash(password, 10)

  db.prepare(
    'INSERT INTO users (email, password, name, role, approved) VALUES (?, ?, ?, ?, ?)'
  ).run(email, hashedPassword, name, role, 1)

  console.log('Admin user created successfully!')
  console.log(`Email: ${email}`)
  console.log(`Password: ${password}`)
  console.log(`Role: ${role}`)

  process.exit(0)
}

seedAdmin().catch((error) => {
  console.error('Seed error:', error)
  process.exit(1)
})
