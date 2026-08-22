import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import adminTokenRoutes from './routes/adminTokens.js'
import tokenRoutes from './routes/tokens.js'
import createpulseRoutes from './routes/createpulse.js'
import adminTopupRoutes from './routes/adminTopup.js'
import generationLogRoutes from './routes/generationLogs.js'
import membershipRoutes from './routes/membership.js'

dotenv.config()

const app = express()
const PORT = Number(process.env.PORT) || 6000

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
app.use('/api/logs/generation', generationLogRoutes)
app.use('/api/membership', membershipRoutes)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

interface MaintenanceRow {
  provider: string
  is_maintenance: number
  message: string
}

app.get('/api/admin/public/maintenance', (_req, res) => {
  try {
    const rows = db.prepare('SELECT provider, is_maintenance, message FROM provider_maintenance WHERE is_maintenance = 1').all() as MaintenanceRow[]
    const result: Record<string, { isMaintenance: boolean; message: string }> = {}
    for (const row of rows) {
      result[row.provider] = {
        isMaintenance: true,
        message: row.message,
      }
    }
    res.json({ maintenance: result })
  } catch (error) {
    console.error('Public maintenance error:', error)
    res.json({ maintenance: {} })
  }
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
