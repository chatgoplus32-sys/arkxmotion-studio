import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import adminTokenRoutes from './routes/adminTokens.js'
import tokenRoutes from './routes/tokens.js'
import createpulseRoutes from './routes/createpulse.js'
import adminTopupRoutes from './routes/adminTopup.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 6000

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
  credentials: true
}))

app.use(express.json())

app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/admin/tokens', adminTokenRoutes)
app.use('/api/admin/topup', adminTopupRoutes)
app.use('/api/tokens', tokenRoutes)
app.use('/api/createpulse', createpulseRoutes)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
