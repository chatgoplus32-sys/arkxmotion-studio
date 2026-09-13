import path from 'path'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import db from './db.js'
import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import adminTokenRoutes from './routes/adminTokens.js'
import tokenRoutes from './routes/tokens.js'
import createpulseRoutes from './routes/createpulse.js'
import adminTopupRoutes from './routes/adminTopup.js'
import generationLogRoutes from './routes/generationLogs.js'
import membershipRoutes from './routes/membership.js'
import cronRoutes from './routes/cron.js'
import syncTokensRoutes from './routes/syncTokens.js'
import nexabotRoutes from './routes/nexabot.js'
import nexabotWalletRoutes from './routes/nexabotWallet.js'
import publicPricingRoutes from './routes/publicPricing.js'
import publicCreatepulseRoutes from './routes/publicCreatepulse.js'
import publicMaintenanceRoutes from './routes/publicMaintenance.js'
import publicUploadCatboxRoutes from './routes/publicUploadCatbox.js'
import publicLeonardoRoutes from './routes/publicLeonardo.js'
import publicMagnificRoutes from './routes/publicMagnific.js'
import publicGalleri5Routes from './routes/publicGalleri5.js'
import publicValidateMediaRoutes from './routes/publicValidateMedia.js'
import publicRoboneoRoutes from './routes/publicRoboneo.js'
import publicRoboneoMembershipRoutes from './routes/publicRoboneoMembership.js'
import publicLeonardoUploadRoutes from './routes/publicLeonardoUpload.js'
import publicVideoProxyRoutes from './routes/publicVideoProxy.js'
import publicFramiaRoutes from './routes/publicFramia.js'
import publicShotstackRoutes from './routes/publicShotstack.js'
import publicCreatomateRoutes from './routes/publicCreatomate.js'
import publicOneoverRoutes from './routes/publicOneover.js'
import publicGensparkRoutes from './routes/publicGenspark.js'
import publicGensparkUploadRoutes from './routes/publicGensparkUpload.js'
import publicRunninghubRoutes from './routes/publicRunninghub.js'
import publicWeavyRoutes from './routes/publicWeavy.js'
import publicWeavyProxyRoutes from './routes/publicWeavyProxy.js'
import publicWeavyCreditsRoutes from './routes/publicWeavyCredits.js'
import publicR2UploadRoutes from './routes/publicR2Upload.js'
import { backupOnStartup } from './backup.js'

dotenv.config()

const app = express()
const PORT = Number(process.env.PORT) || 6000

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000', 'https://arkxmotion-studio.win'],
  credentials: true
}))

app.use(express.static(path.resolve('public')))
app.use('/downloads', express.static(path.resolve('public/downloads')))

// Upload route MUST be before express.json() to get raw multipart body
app.use('/api/public/upload-catbox', publicUploadCatboxRoutes)

app.use(express.json({ limit: '10mb' }))

app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/admin/tokens', adminTokenRoutes)
app.use('/api/admin/topup', adminTopupRoutes)
app.use('/api/tokens', tokenRoutes)
app.use('/api/createpulse', createpulseRoutes)
app.use('/api/logs/generation', generationLogRoutes)
app.use('/api/membership', membershipRoutes)
app.use('/api/cron', cronRoutes)
app.use('/api/sync-tokens', syncTokensRoutes)
app.use('/api/public/nexabot', nexabotRoutes)
// Harga efektif provider (publik, read-only) — dipakai halaman landing & cek cepat.
app.use('/api/public/pricing', publicPricingRoutes)
// Public API proxies (production needs these since Vite dev middleware doesn't run)
app.use('/api/public/createpulse', publicCreatepulseRoutes)
app.use('/api/public/maintenance', publicMaintenanceRoutes)
app.use('/api/public/leonardo', publicLeonardoRoutes)
app.use('/api/public/magnific', publicMagnificRoutes)
app.use('/api/public/galleri5', publicGalleri5Routes)
app.use('/api/public/validate-media', publicValidateMediaRoutes)
app.use('/api/public/roboneo', publicRoboneoRoutes)
app.use('/api/public/roboneo-membership', publicRoboneoMembershipRoutes)
app.use('/api/public/leonardo-upload', publicLeonardoUploadRoutes)
app.use('/api/public/video-proxy', publicVideoProxyRoutes)
app.use('/api/public/framia', publicFramiaRoutes)
app.use('/api/public/shotstack', publicShotstackRoutes)
app.use('/api/public/creatomate', publicCreatomateRoutes)
app.use('/api/public/oneover', publicOneoverRoutes)
app.use('/api/public/genspark', publicGensparkRoutes)
app.use('/api/public/genspark-upload', publicGensparkUploadRoutes)
app.use('/api/public/runninghub', publicRunninghubRoutes)
app.use('/api/public/weavy', publicWeavyRoutes)
app.use('/api/public/weavy-proxy', publicWeavyProxyRoutes)
app.use('/api/public/weavy-credits', publicWeavyCreditsRoutes)
app.use('/api/public/r2-upload', publicR2UploadRoutes)
// Wallet NexaBot (saldo Rp prepaid) — beda dari /api/public/nexabot yang
// meneruskan generate ke upstream nexabot.id.
app.use('/api/nexabot', nexabotWalletRoutes)

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

// Backup database otomatis saat server start — fire-and-forget, tidak memblokir startup
void backupOnStartup()

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
