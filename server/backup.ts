import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backupDir = path.join(__dirname, '..', 'data', 'backups')

/** Jumlah backup terbaru yang disimpan — yang lebih lama dihapus otomatis. */
const MAX_BACKUPS = 10

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

/** Hapus backup paling lama kalau jumlahnya melewati MAX_BACKUPS. */
function pruneOldBackups(): void {
  try {
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => /^arkxmotion-.*\.db$/.test(f))
      .map((f) => ({ f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime) // terbaru dulu

    for (const old of files.slice(MAX_BACKUPS)) {
      fs.unlinkSync(path.join(backupDir, old.f))
      console.log(`[backup] 🗑️  Backup lama dihapus: ${old.f}`)
    }
  } catch (err: any) {
    console.warn('[backup] Gagal membersihkan backup lama:', err?.message || err)
  }
}

/**
 * Snapshot database ke `data/backups/arkxmotion-<waktu>.db` saat server start.
 * Memakai API `db.backup()` better-sqlite3 sehingga konsisten walau mode WAL
 * dan server sedang melayani request. Tidak pernah membuat server gagal jalan.
 */
export async function backupOnStartup(): Promise<string | null> {
  try {
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })

    const hasData =
      countRows('users') > 0 || countRows('tokens') > 0 || countRows('generation_logs') > 0
    if (!hasData) {
      console.log('[backup] ⏭️  Dilewati — database masih kosong, tidak ada data untuk diamankan')
      return null
    }

    const dest = path.join(backupDir, `arkxmotion-${timestamp()}.db`)
    await db.backup(dest)

    const sizeKb = Math.round(fs.statSync(dest).size / 1024)
    console.log(`[backup] ✅ Backup dibuat: data/backups/${path.basename(dest)} (${sizeKb} KB)`)

    pruneOldBackups()
    return dest
  } catch (err: any) {
    console.error('[backup] ⚠️  Backup gagal (server tetap jalan):', err?.message || err)
    return null
  }
}
