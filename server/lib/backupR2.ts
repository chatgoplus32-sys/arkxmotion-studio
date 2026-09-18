/**
 * Automatic SQLite backup to Cloudflare R2.
 *
 * Env vars:
 *   R2_ACCOUNT_ID      — Cloudflare account ID
 *   R2_ACCESS_KEY_ID   — R2 access key ID
 *   R2_SECRET_ACCESS_KEY — R2 secret access key
 *   R2_BUCKET_NAME     — R2 bucket name
 *   R2_PUBLIC_URL      — (optional) custom domain for public URLs
 *   BACKUP_INTERVAL_MS — jarak antar backup berkala (default: 6 jam)
 *   BACKUP_KEEP_LOCAL  — jumlah backup lokal yang disimpan (default: 7)
 *   BACKUP_KEEP_R2     — jumlah backup R2 yang disimpan (default: 30)
 *
 * Usage:
 *   import { startBackupScheduler, runBackupNow } from './lib/backupR2.js'
 *   startBackupScheduler()
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import { countRows, hasBackupableData, getStartupBackupStatus } from '../backup.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Config ────────────────────────────────────────────────────
// Dibaca saat modul dimuat, jadi .env WAJIB sudah termuat sebelum modul ini
// dievaluasi. Itu tugas server/env.ts, yang diimpor paling awal oleh index.ts —
// lihat test/envLoadOrder.test.ts. Tanpa itu nilai di bawah semuanya kosong, dan
// kredensial R2 yang sudah benar tinggal tidak terpakai.
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ''
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || ''
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || ''
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || ''
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || ''
const BACKUP_PREFIX = 'backups/database'
const MAX_LOCAL = Number(process.env.BACKUP_KEEP_LOCAL) || 7
const MAX_R2 = Number(process.env.BACKUP_KEEP_R2) || 30
const BACKUP_DIR = path.resolve(__dirname, '..', '..', 'data', 'backups')

// ── R2 Client ─────────────────────────────────────────────────
let s3Client: any = null
let PutObjectCommand: any = null
let ListObjectsV2Command: any = null
let DeleteObjectCommand: any = null

async function getR2Client() {
  if (s3Client) return s3Client
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    console.warn('[backup-r2] ⚠️  R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME')
    return null
  }
  try {
    const mod: any = await import('@aws-sdk/client-s3')
    PutObjectCommand = mod.PutObjectCommand
    ListObjectsV2Command = mod.ListObjectsV2Command
    DeleteObjectCommand = mod.DeleteObjectCommand
    s3Client = new mod.S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    })
    return s3Client
  } catch (err: any) {
    console.error('[backup-r2] Failed to create R2 client:', err.message)
    return null
  }
}

// ── Helpers ───────────────────────────────────────────────────
function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// ── Core backup function ──────────────────────────────────────
export interface BackupRunResult {
  ok: boolean
  localPath?: string
  r2Key?: string
  /** Diisi kalau tidak ada snapshot yang dibuat (selain ini = snapshot dibuat). */
  skipped?: 'database-empty'
  /**
   * Apa yang terjadi pada salinan off-site. Inilah yang membedakan "backup"
   * yang hanya ada di disk VPS dari "backup" yang punya salinan di luar VPS.
   */
  offsite?: 'uploaded' | 'not-configured' | 'failed'
  error?: string
}

/** Keadaan upaya terakhir, supaya pertanyaan "apakah off-site benar-benar
 *  jalan?" bisa dijawab dari /api/backup/status tanpa masuk ke VPS. */
let lastAttemptAt: string | null = null
let lastUploadAt: string | null = null
let lastUploadKey: string | null = null
let lastError: string | null = null

export async function runBackup(): Promise<BackupRunResult> {
  const startTime = Date.now()
  lastAttemptAt = new Date().toISOString()
  lastError = null

  try {
    // 1. Create local backup
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })

    const counts = [countRows('users'), countRows('tokens'), countRows('generation_logs')]
    if (counts.includes(null)) {
      console.warn(
        '[backup-r2] ⚠️  Isi database tidak sepenuhnya terbaca — snapshot tetap dibuat daripada dilewati',
      )
    }
    if (!hasBackupableData(counts)) {
      console.log('[backup-r2] ⏭️  Database still empty, skipping backup')
      return { ok: true, skipped: 'database-empty' }
    }

    const filename = `arkxmotion-${timestamp()}.db`
    const localPath = path.join(BACKUP_DIR, filename)
    await db.backup(localPath)

    const sizeKb = Math.round(fs.statSync(localPath).size / 1024)
    console.log(`[backup-r2] ✅ Local backup: ${filename} (${sizeKb} KB)`)

    // 2. Upload to R2
    const client = await getR2Client()
    if (!client) {
      // Bukan sekadar catatan: snapshot ini hanya ada di disk VPS yang sama
      // dengan aplikasi yang menjalankannya, jadi belum ada salinan off-site.
      console.warn(
        '[backup-r2] ⚠️  R2 belum dikonfigurasi — snapshot hanya di disk VPS, TIDAK ada salinan off-site',
      )
      pruneLocalBackups()
      return { ok: true, localPath, offsite: 'not-configured' }
    }

    const r2Key = `${BACKUP_PREFIX}/${filename}`
    const fileBuffer = fs.readFileSync(localPath)

    try {
      await client.send(new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: r2Key,
        Body: fileBuffer,
        ContentType: 'application/octet-stream',
        Metadata: {
          'backup-timestamp': new Date().toISOString(),
          'backup-size': String(sizeKb),
        },
      }))
    } catch (err: any) {
      // Gagal mengunggah tidak boleh menghapus apa pun: pemangkasan (lokal dan
      // R2) dilewati supaya tidak ada riwayat yang hilang justru ketika jalur
      // off-site sedang rusak.
      const message = String(err?.message || err)
      lastError = message
      console.error('[backup-r2] ❌ Unggahan ke R2 GAGAL: ' + message)
      console.error('[backup-r2]    Snapshot lokal tetap ada; pemangkasan dilewati.')
      return { ok: false, localPath, offsite: 'failed', error: message }
    }

    const cdnUrl = R2_PUBLIC_URL
      ? `${R2_PUBLIC_URL.replace(/\/$/, '')}/${r2Key}`
      : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.dev/${r2Key}`

    console.log(`[backup-r2] ✅ Uploaded to R2: ${r2Key} → ${cdnUrl}`)

    lastUploadAt = new Date().toISOString()
    lastUploadKey = r2Key

    // 3. Prune old backups
    pruneLocalBackups()
    await pruneR2Backups(client)

    const durationMs = Date.now() - startTime
    console.log(`[backup-r2] ✅ Backup complete in ${durationMs}ms`)

    return { ok: true, localPath, r2Key, offsite: 'uploaded' }
  } catch (err: any) {
    const message = String(err?.message || err)
    lastError = message
    console.error('[backup-r2] ❌ Backup failed:', message)
    return { ok: false, error: message }
  }
}

// ── Prune local backups ──────────────────────────────────────
function pruneLocalBackups() {
  try {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => /^arkxmotion-.*\.db$/.test(f))
      .map((f) => ({ f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    for (const old of files.slice(MAX_LOCAL)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old.f))
      console.log(`[backup-r2] 🗑️  Local prune: ${old.f}`)
    }
  } catch (err: any) {
    console.warn('[backup-r2] Local prune error:', err.message)
  }
}

// ── Prune R2 backups ─────────────────────────────────────────
async function pruneR2Backups(client: any) {
  try {
    const listRes = await client.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET_NAME,
      Prefix: BACKUP_PREFIX + '/',
    }))

    const objects = (listRes.Contents || [])
      .sort((a: any, b: any) => new Date(b.LastModified).getTime() - new Date(a.LastModified).getTime())

    const toDelete = objects.slice(MAX_R2)
    if (toDelete.length === 0) return

    console.log(`[backup-r2] 🗑️  Pruning ${toDelete.length} old R2 backups...`)
    for (const obj of toDelete) {
      await client.send(new DeleteObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: obj.Key,
      }))
    }
  } catch (err: any) {
    console.warn('[backup-r2] R2 prune error:', err.message)
  }
}

// ── Scheduler (simple cron-like) ─────────────────────────────
let backupInterval: ReturnType<typeof setInterval> | null = null
let firstRunTimer: ReturnType<typeof setTimeout> | null = null
let nextRunAt: string | null = null

/**
 * Jalankan backup terjadwal dan pastikan kegagalannya BERAKHIR DI LOG.
 * Versi sebelumnya memakai `.catch(() => {})`, sehingga kegagalan apa pun di
 * luar try/catch runBackup() hilang tanpa jejak.
 */
function runScheduledBackup() {
  runBackup()
    .then((result) => {
      if (!result.ok) {
        console.error('[backup-r2] ❌ Backup terjadwal gagal: ' + (result.error || 'tanpa keterangan'))
      }
    })
    .catch((err: any) => {
      console.error('[backup-r2] ❌ Backup terjadwal melempar error: ' + (err?.message || err))
    })
}

/**
 * Start periodic backup scheduler.
 * Default: every 6 hours. Set BACKUP_INTERVAL_MS env to customize.
 */
export function startBackupScheduler() {
  if (backupInterval) {
    console.warn('[backup-r2] ⚠️  Scheduler sudah jalan — startBackupScheduler() diabaikan')
    return
  }

  const intervalMs = Number(process.env.BACKUP_INTERVAL_MS) || 6 * 60 * 60 * 1000 // 6 hours

  console.log(`[backup-r2] ⏰ Scheduler started — backup every ${intervalMs / 1000 / 60} minutes`)

  // First backup after 5 minutes (don't block startup)
  nextRunAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  firstRunTimer = setTimeout(runScheduledBackup, 5 * 60 * 1000)

  // Recurring backup
  backupInterval = setInterval(() => {
    nextRunAt = new Date(Date.now() + intervalMs).toISOString()
    runScheduledBackup()
  }, intervalMs)
}

/** Stop the backup scheduler */
export function stopBackupScheduler() {
  // Timer pertama juga harus dibatalkan: tanpa ini scheduler "berhenti"
  // tapi backup 5 menit kemudian tetap berjalan, dan proses ikut tertahan.
  if (firstRunTimer) {
    clearTimeout(firstRunTimer)
    firstRunTimer = null
  }
  if (backupInterval) {
    clearInterval(backupInterval)
    backupInterval = null
    nextRunAt = null
    console.log('[backup-r2] ⏹️  Scheduler stopped')
  }
}

/** Get backup status */
export function getBackupStatus() {
  const localFiles = fs.existsSync(BACKUP_DIR)
    ? fs.readdirSync(BACKUP_DIR).filter((f) => /^arkxmotion-.*\.db$/.test(f))
    : []

  const totalSize = localFiles.reduce((acc, f) => {
    try { return acc + fs.statSync(path.join(BACKUP_DIR, f)).size } catch { return acc }
  }, 0)

  return {
    local: {
      count: localFiles.length,
      latest: localFiles.sort().pop() || null,
      totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
    },
    // Hasil snapshot saat start: dibuat / dilewati karena kosong / gagal /
    // tidak dijalankan. Inilah yang membedakan keempatnya tanpa perlu masuk
    // ke VPS — sebelum ini semuanya tampak sama saja: tidak ada snapshot.
    startup: getStartupBackupStatus(),
    r2: {
      configured: !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME),
      bucket: R2_BUCKET_NAME || null,
      // Tanpa ini, "configured: true" tidak bisa dibedakan dari "sudah pernah
      // benar-benar mengunggah" — persis celah yang membuat R2 tampak beres
      // padahal tidak pernah ada satu objek pun yang naik.
      lastAttemptAt,
      lastUploadAt,
      lastUploadKey,
      lastError,
    },
    scheduler: {
      running: backupInterval !== null,
      intervalMs: Number(process.env.BACKUP_INTERVAL_MS) || 6 * 60 * 60 * 1000,
      nextRunAt,
    },
  }
}
