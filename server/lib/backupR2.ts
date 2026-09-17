/**
 * Automatic SQLite backup to Cloudflare R2.
 *
 * Env vars:
 *   R2_ACCOUNT_ID      — Cloudflare account ID
 *   R2_ACCESS_KEY_ID   — R2 access key ID
 *   R2_SECRET_ACCESS_KEY — R2 secret access key
 *   R2_BUCKET_NAME     — R2 bucket name
 *   R2_PUBLIC_URL      — (optional) custom domain for public URLs
 *   BACKUP_CRON        — cron expression (default: "0 2 * * *" = daily 2am)
 *   BACKUP_KEEP LOCAL  — local backups to keep (default: 7)
 *   BACKUP_KEEP_R2     — R2 backups to keep (default: 30)
 *
 * Usage:
 *   import { startBackupScheduler, runBackupNow } from './lib/backupR2.js'
 *   startBackupScheduler()
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Config ────────────────────────────────────────────────────
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

function getR2Client() {
  if (s3Client) return s3Client
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    console.warn('[backup-r2] ⚠️  R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME')
    return null
  }
  try {
    const { S3Client, PutObjectCommand: P, ListObjectsV2Command: L, DeleteObjectCommand: D } = require('@aws-sdk/client-s3')
    PutObjectCommand = P
    ListObjectsV2Command = L
    DeleteObjectCommand = D
    s3Client = new S3Client({
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

function countRows(table: string): number {
  try {
    return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
  } catch {
    return 0
  }
}

// ── Core backup function ──────────────────────────────────────
export async function runBackup(): Promise<{ ok: boolean; localPath?: string; r2Key?: string; error?: string }> {
  const startTime = Date.now()

  try {
    // 1. Create local backup
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })

    const hasData =
      countRows('users') > 0 || countRows('tokens') > 0 || countRows('generation_logs') > 0
    if (!hasData) {
      console.log('[backup-r2] ⏭️  Database still empty, skipping backup')
      return { ok: true }
    }

    const filename = `arkxmotion-${timestamp()}.db`
    const localPath = path.join(BACKUP_DIR, filename)
    await db.backup(localPath)

    const sizeKb = Math.round(fs.statSync(localPath).size / 1024)
    console.log(`[backup-r2] ✅ Local backup: ${filename} (${sizeKb} KB)`)

    // 2. Upload to R2
    const client = getR2Client()
    if (!client) {
      console.log('[backup-r2] ⚠️  R2 not configured, local backup only')
      pruneLocalBackups()
      return { ok: true, localPath }
    }

    const r2Key = `${BACKUP_PREFIX}/${filename}`
    const fileBuffer = fs.readFileSync(localPath)

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

    const cdnUrl = R2_PUBLIC_URL
      ? `${R2_PUBLIC_URL.replace(/\/$/, '')}/${r2Key}`
      : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.dev/${r2Key}`

    console.log(`[backup-r2] ✅ Uploaded to R2: ${r2Key} → ${cdnUrl}`)

    // 3. Prune old backups
    pruneLocalBackups()
    await pruneR2Backups(client)

    const durationMs = Date.now() - startTime
    console.log(`[backup-r2] ✅ Backup complete in ${durationMs}ms`)

    return { ok: true, localPath, r2Key }
  } catch (err: any) {
    console.error('[backup-r2] ❌ Backup failed:', err.message)
    return { ok: false, error: err.message }
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

/**
 * Start periodic backup scheduler.
 * Default: every 6 hours. Set BACKUP_INTERVAL_MS env to customize.
 */
export function startBackupScheduler() {
  const intervalMs = Number(process.env.BACKUP_INTERVAL_MS) || 6 * 60 * 60 * 1000 // 6 hours

  console.log(`[backup-r2] ⏰ Scheduler started — backup every ${intervalMs / 1000 / 60} minutes`)

  // First backup after 5 minutes (don't block startup)
  setTimeout(() => {
    runBackup().catch(() => {})
  }, 5 * 60 * 1000)

  // Recurring backup
  backupInterval = setInterval(() => {
    runBackup().catch(() => {})
  }, intervalMs)
}

/** Stop the backup scheduler */
export function stopBackupScheduler() {
  if (backupInterval) {
    clearInterval(backupInterval)
    backupInterval = null
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
    r2: {
      configured: !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME),
      bucket: R2_BUCKET_NAME || null,
    },
    scheduler: {
      running: backupInterval !== null,
      intervalMs: Number(process.env.BACKUP_INTERVAL_MS) || 6 * 60 * 60 * 1000,
    },
  }
}
