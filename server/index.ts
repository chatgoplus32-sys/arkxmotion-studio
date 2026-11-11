// Harus impor PALING AWAL: memuat .env sebelum modul lain mana pun dievaluasi.
// Modul-modul di bawah membaca process.env di top level, jadi urutan inilah yang
// membuat nilainya terbaca. Penjelasan lengkap ada di server/env.ts.
import './env.js'

import { fileURLToPath } from 'url'
import path from 'path'
import express from 'express'
import cors from 'cors'
import fs from 'fs'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
import db from './db.js'
import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import adminTokenRoutes from './routes/adminTokens.js'
import tokenRoutes from './routes/tokens.js'
import providerTopupRoutes from './routes/providerTopup.js'
import createpulseRoutes from './routes/createpulse.js'
import adminTopupRoutes from './routes/adminTopup.js'
import { monitorMiddleware, getMetrics } from './lib/monitor.js'
import { checkHealth } from './lib/alerts.js'
import generationLogRoutes from './routes/generationLogs.js'
import membershipRoutes from './routes/membership.js'
import cronRoutes from './routes/cron.js'
import syncTokensRoutes from './routes/syncTokens.js'
import nexabotRoutes from './routes/nexabot.js'
import studioAiRoutes from './routes/studioAi.js'
import nexabotWalletRoutes from './routes/nexabotWallet.js'
import seaviWalletRoutes from './routes/seaviWallet.js'
import publicPricingRoutes from './routes/publicPricing.js'
import publicStatsRoutes from './routes/publicStats.js'
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
import publicSeaviRoutes from './routes/publicSeavi.js'
import publicPosbotRoutes from './routes/publicPosbot.js'
import publicShotstackRoutes from './routes/publicShotstack.js'
import publicCreatomateRoutes from './routes/publicCreatomate.js'
import publicOneoverRoutes from './routes/publicOneover.js'
import publicGensparkRoutes from './routes/publicGenspark.js'
import publicFreebeatRoutes from './routes/publicFreebeat.js'
import publicGensparkUploadRoutes from './routes/publicGensparkUpload.js'
import publicRunninghubRoutes from './routes/publicRunninghub.js'
import publicWeavyRoutes from './routes/publicWeavy.js'
import publicWeavyProxyRoutes from './routes/publicWeavyProxy.js'
import publicWeavyCreditsRoutes from './routes/publicWeavyCredits.js'
import publicR2UploadRoutes from './routes/publicR2Upload.js'
import watermarkEngineRoutes from './routes/watermarkEngine.js'
import { UPLOAD_DIR, DISK_FILE_BASE, UPLOAD_RETENTION_DAYS, pruneOldUploads, freeDiskBytes, mediaStorageMode } from './lib/mediaStorage.js'
import publicAutoClipRoutes from './routes/publicAutoClip.js'
import publicFireflyRoutes from './routes/publicFirefly.js'
import publicTiktokRoutes from './routes/publicTiktok.js'
import { backupOnStartup, noteStartupBackupDisabled } from './backup.js'
import { startBackupScheduler, getBackupStatus, runBackup } from './lib/backupR2.js'
import { authenticateToken, requireAdmin } from './middleware/auth.js'
import chatgptRoutes from './routes/chatgpt.js'
import publicDolaRoutes from './routes/publicDola.js'
import markastoolsRoutes from './routes/markastools.js'
import featureRequestRoutes from './routes/featureRequests.js'
import runninghubDailyClaimRoutes from './routes/runninghubDailyClaim.js'
import { startRunningHubDailyClaimScheduler } from './lib/runninghubDailyClaim.js'

// .env sudah dimuat server/env.ts (impor pertama), yaitu sebelum modul-modul di
// atas dievaluasi. Tidak ada pemuatan kedua di sini supaya hanya ada satu sumber
// kebenaran: kalau impornya berpindah, test/envLoadOrder.test.ts yang gagal.

const app = express()
const PORT = Number(process.env.PORT) || 6000
const isProd = process.env.NODE_ENV === 'production'
const FRONTEND_DIR = path.resolve(__dirname, '..', 'dist')

const extraOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://localhost:6000',
  'https://arkxmotion-studio.win',
  ...extraOrigins,
]

// Aset mesin watermark video (@pilio/gemini-watermark-remover) disajikan dari
// node_modules: iframe engine jadi same-origin tanpa menambah ±44 MB aset ke
// repo. Harus sebelum cors(): browser mengirim Origin untuk setiap import ES
// module, dan gerbang CORS API akan menjatuhkannya jadi 500 di mesin ONNX.
app.use('/api/public/watermark-engine', watermarkEngineRoutes)

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true
}))

// Upload route MUST be before express.json() to get raw multipart body
app.use('/api/public/upload-catbox', publicUploadCatboxRoutes)
// Relay MarkasTools (pass-through mentah, JSON maupun multipart) — juga
// harus sebelum express.json() supaya body tidak dipotong parser.
app.use('/api/public/markastools', markastoolsRoutes)

app.use(monitorMiddleware)
app.use(express.json({ limit: '50mb' }))

// --- API Routes ---
app.use('/api/auth', authRoutes)
app.use('/api/feature-request', featureRequestRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/admin/tokens', adminTokenRoutes)
app.use('/api/admin/topup', adminTopupRoutes)
app.use('/api/tokens', tokenRoutes)
app.use('/api/provider-topup', providerTopupRoutes)
app.use('/api/createpulse', createpulseRoutes)
app.use('/api/logs/generation', generationLogRoutes)
app.use('/api/membership', membershipRoutes)
app.use('/api/cron', cronRoutes)
app.use('/api/sync-tokens', syncTokensRoutes)
app.use('/api/public/nexabot', nexabotRoutes)
app.use('/api/public/studio-ai', studioAiRoutes)
app.use('/api/public/pricing', publicPricingRoutes)
app.use('/api/public/stats', publicStatsRoutes)
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
app.use('/api/public/seavi', publicSeaviRoutes)
app.use('/api/public/posbot', publicPosbotRoutes)
app.use('/api/public/shotstack', publicShotstackRoutes)
app.use('/api/public/creatomate', publicCreatomateRoutes)
app.use('/api/public/oneover', publicOneoverRoutes)
app.use('/api/public/genspark', publicGensparkRoutes)
app.use('/api/public/freebeat', publicFreebeatRoutes)
app.use('/api/public/genspark-upload', publicGensparkUploadRoutes)
app.use('/api/public/runninghub', publicRunninghubRoutes)
app.use('/api/public/weavy', publicWeavyRoutes)
app.use('/api/public/weavy-proxy', publicWeavyProxyRoutes)
app.use('/api/public/weavy-credits', publicWeavyCreditsRoutes)
app.use('/api/public/r2-upload', publicR2UploadRoutes)
// Storage fallback disk (dipakai bila kredensial R2 belum di-set di VPS):
// file hasil generator dilayani dari folder upload di disk via /api path
// (nginx hanya me-proxy /api/* ke express; path lain menjawab file frontend).
app.use(DISK_FILE_BASE, express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }))
// Dua ini dulu hanya ada di stack Vercel yang kini mati (api/public/*), sehingga
// di produksi VPS keduanya menjawab 404 walau frontend masih memanggilnya.
app.use('/api/public/firefly', publicFireflyRoutes)
app.use('/api/public/tiktok-download', publicTiktokRoutes)
app.use('/api/nexabot', nexabotWalletRoutes)
app.use('/api/seavi', seaviWalletRoutes)
app.use('/api/runninghub', runninghubDailyClaimRoutes)
app.use('/api/chatgpt', chatgptRoutes)
app.use('/api/dola', publicDolaRoutes)
app.use('/api/public/autoclip', publicAutoClipRoutes)

app.get("/api/health", async (_req, res) => {
  try {
    const health = await checkHealth()
    res.json(health)
  } catch {
    res.json({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime() })
  }
})

app.get("/api/metrics", (_req, res) => {
  res.json(getMetrics())
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

// Status backup + pemicu manual.
//
// Didaftarkan SEBELUM blok frontend di bawah: di production blok itu memasang
// catch-all '/{*splat}' yang menjawab setiap jalur /api/ dengan 404, dan Express
// mencocokkan rute menurut urutan pendaftaran. Kalau urutannya terbalik, kedua
// rute ini mati justru di lingkungan yang paling membutuhkannya — dan hanya di
// production, karena di dev catch-all itu tidak dipasang.
app.get("/api/backup/status", authenticateToken, requireAdmin, (_req, res) => {
  res.json(getBackupStatus())
})

app.post("/api/backup/run", authenticateToken, requireAdmin, async (_req, res) => {
  const result = await runBackup()
  res.json(result)
})

// --- Production: serve built frontend ---
if (isProd && fs.existsSync(FRONTEND_DIR)) {
  // Static assets dengan header cache yang benar per jenis file:
  // - index.html & sw.js: jangan pernah di-cache lama. Kalau browser memegang
  //   HTML lama, dia tetap memuat bundle JS lama setelah deploy (bug hasil
  //   MC senyap: halaman terbangun dengan JS sebelum fix ditempel audio).
  // - Aset Vite di /assets/ sudah ber-hash (nama berubah tiap build) jadi
  //   aman di-cache 1 tahun immutable.
  app.use(express.static(FRONTEND_DIR, {
    maxAge: '30d',
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
        return
      }
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    },
  }))

  // SPA fallback — non-API routes serve index.html
  app.get('/{*splat}', (req, res) => {
    // Skip API routes (shouldn't hit here, but safety)
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API route not found' })
    }
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'))
  })
} else {
  // Dev mode — serve public/ only, rely on Vite dev server proxy
  app.use(express.static(path.resolve('public')))
  app.use('/downloads', express.static(path.resolve('public/downloads')))
}

// --- Global error handler ---
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("[server] Unhandled error:", err.stack || err)
  if (!res.headersSent) {
    // 413 payload-too-large: pesan jelas (mis. foto base64 > limit) bukan "Internal server error"
    if (err.status === 413 || /too large|too big|limit/i.test(String(err.message || ''))) {
      res.status(413).json({ error: "File terlalu besar — maksimal 50MB per request. Kecilkan/kompres file lalu coba lagi." })
      return
    }
    res.status(err.status || 500).json({ error: "Internal server error" })
  }
})

// --- Unhandled rejections ---
process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason)
})

process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception:", err)
})

// Backup otomatis — snapshot saat start dan scheduler R2 — hanya kalau memang
// diminta. Default: aktif hanya di production, sehingga sesi dev tidak menulis
// (dan memangkas) isi data/backups/. Override: AUTO_BACKUP=1 paksa aktif,
// AUTO_BACKUP=0 paksa mati.
const autoBackupSetting = (process.env.AUTO_BACKUP ?? '').trim().toLowerCase()
const autoBackupEnabled = autoBackupSetting
  ? !['0', 'false', 'off', 'no'].includes(autoBackupSetting)
  : isProd

if (autoBackupEnabled) {
  void backupOnStartup()
  if (process.env.R2_ACCOUNT_ID) {
    startBackupScheduler()
  }
} else {
  // Dicatat supaya /api/backup/status bisa membedakan "dimatikan" dari
  // "gagal" — tanpa ini, tidak ada snapshot selalu terlihat sama saja.
  noteStartupBackupDisabled(
    'gerbang AUTO_BACKUP tertutup: AUTO_BACKUP=' +
      (process.env.AUTO_BACKUP ?? '(kosong)') +
      ', NODE_ENV=' +
      (process.env.NODE_ENV ?? '(tidak diset)') +
      '. Set AUTO_BACKUP=1 untuk memaksa aktif.',
  )
  console.log(
    `[${isProd ? 'PROD' : 'DEV'}] Backup otomatis dilewati. Set AUTO_BACKUP=1 kalau ingin snapshot database saat start.`,
  )
}

{
  const mode = mediaStorageMode()
  console.log(`[media-storage] hasil generate → ${mode.backend} · ${mode.detail}`)
}

// Retention hasil generate di disk. Tanpa R2, uploads/ tumbuh ~1,5 GB/hari;
// kalau disk penuh, nginx gagal men-buffer body besar dan membalas halaman HTML
// sehingga frontend hanya melihat "Unexpected token '<'". Jalankan sekali saat
// start (langsung membebaskan ruang) lalu tiap 6 jam.
if (UPLOAD_RETENTION_DAYS > 0) {
  const jalankanRetention = () => {
    const hasil = pruneOldUploads(UPLOAD_RETENTION_DAYS)
    if (hasil.deleted || hasil.failed) {
      console.log(
        `[retention] hapus ${hasil.deleted} file > ${UPLOAD_RETENTION_DAYS} hari ` +
        `(${(hasil.bytes / 1073741824).toFixed(2)} GB)${hasil.failed ? `, ${hasil.failed} gagal` : ''}; ` +
        `sisa disk ${Math.round((freeDiskBytes() ?? 0) / 1048576)}MB`,
      )
    }
  }
  jalankanRetention()
  setInterval(jalankanRetention, 6 * 60 * 60 * 1000).unref()
}

// Klaim hadiah harian RunningHub untuk token yang didaftarkan pengguna.
// Default aktif di production; status per hari disimpan di DB sehingga restart
// tidak membuat klaim dobel maupun terlewat.
startRunningHubDailyClaimScheduler()

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${isProd ? 'PROD' : 'DEV'}] Server running on http://0.0.0.0:${PORT}`)
  if (isProd) {
    console.log(`[${isProd ? 'PROD' : 'DEV'}] Serving frontend from ${FRONTEND_DIR}`)
  }
})
