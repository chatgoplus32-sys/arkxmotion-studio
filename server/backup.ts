import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db, { dbPath } from './db.js'

/**
 * Hasil upaya snapshot saat start yang terakhir. `backupOnStartup()` dulu
 * mengembalikan null untuk TIGA sebab yang berbeda — database kosong,
 * exception, atau jalurnya memang tidak pernah dijalankan — sehingga "tidak
 * ada snapshot" tidak bisa dibedakan satu sama lain dari luar. Deploy 17 Sep,
 * 7faf8f0, dan 55a4bfa semuanya menampakkan gejala itu, dan tiap kali
 * penyebabnya harus dicari ke dalam VPS.
 */
export type StartupBackupResult =
  | { outcome: 'created'; at: string; snapshot: string; path: string }
  | { outcome: 'skipped-empty'; at: string; reason: string; counts: Array<number | null> }
  | { outcome: 'failed'; at: string; reason: string }
  | { outcome: 'not-run'; at: string; reason: string }

let lastStartupBackup: StartupBackupResult | null = null

export function getStartupBackupStatus(): StartupBackupResult | null {
  return lastStartupBackup
}

/**
 * Dicatat ketika gerbang AUTO_BACKUP menutup jalur backup otomatis. Tanpa
 * catatan ini, "tidak ada snapshot" di produksi ambigu antara dimatikan dan
 * gagal — persis kebingungan yang membuat penyebabnya lama tidak ketahuan.
 */
export function noteStartupBackupDisabled(reason: string): void {
  lastStartupBackup = { outcome: 'not-run', at: new Date().toISOString(), reason }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backupDir = path.join(__dirname, '..', 'data', 'backups')

/** Jumlah backup terbaru yang disimpan — yang lebih lama dihapus otomatis. */
const MAX_BACKUPS = 30

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * Jumlah baris sebuah tabel, atau `null` kalau tidak bisa dibaca.
 *
 * `null` dan `0` sengaja dibedakan: tabel yang belum dibuat (instalasi baru)
 * memang berarti 0, tapi kegagalan membaca — database terkunci, skema rusak,
 * koneksi bermasalah — BUKAN berarti kosong. Dulu keduanya jadi 0, sehingga
 * snapshot saat boot bisa dilewati tanpa jejak yang jelas di log.
 */
export function countRows(table: string): number | null {
  try {
    return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
  } catch (err: any) {
    const message = String(err?.message || err)
    // Tabel yang belum ada bukan kegagalan — memang belum ada isinya.
    if (/no such table/i.test(message)) return 0
    console.warn(`[backup] ⚠️  Tidak bisa membaca tabel ${table}: ${message}`)
    return null
  }
}

/**
 * Apakah isi database layak diamankan.
 *
 * Backup dijalankan kalau ada tabel berisi data, ATAU kalau ada tabel yang
 * tidak bisa dibaca: ketidaktahuan bukan alasan melewatkan snapshot. Hanya
 * database yang terbaca jelas kosong (semua 0) yang dilewati.
 */
export function hasBackupableData(counts: Array<number | null>): boolean {
  if (counts.some((c) => c === null)) return true
  return counts.some((c) => (c ?? 0) > 0)
}

/** Hapus backup paling lama kalau jumlahnya melewati MAX_BACKUPS. */
function pruneOldBackups(dir: string = backupDir): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^arkxmotion-.*\.db$/.test(f))
      .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime) // terbaru dulu

    for (const old of files.slice(MAX_BACKUPS)) {
      fs.unlinkSync(path.join(dir, old.f))
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
export async function backupOnStartup(dir: string = backupDir): Promise<string | null> {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const counts = [countRows('users'), countRows('tokens'), countRows('generation_logs')]
    if (counts.includes(null)) {
      console.warn(
        '[backup] ⚠️  Isi database tidak sepenuhnya terbaca — snapshot tetap dibuat daripada dilewati',
      )
    }
    if (!hasBackupableData(counts)) {
      // Tabel yang tidak ada juga dihitung 0, jadi sebab yang paling mungkin
      // dari "semuanya 0" adalah proses ini membuka database yang berbeda —
      // karena itu path database yang benar-benar dipakai ikut dicatat.
      const ringkas = `users=${counts[0]} tokens=${counts[1]} generation_logs=${counts[2]}`
      lastStartupBackup = {
        outcome: 'skipped-empty',
        at: new Date().toISOString(),
        counts,
        reason:
          `ketiga tabel terbaca kosong (${ringkas}); tabel yang tidak ada ikut dihitung 0, ` +
          `jadi database yang dibuka perlu dipastikan: ${dbPath}`,
      }
      console.log('[backup] ⏭️  Dilewati — database masih kosong, tidak ada data untuk diamankan')
      return null
    }

    const dest = path.join(dir, `arkxmotion-${timestamp()}.db`)
    await db.backup(dest)

    const sizeKb = Math.round(fs.statSync(dest).size / 1024)
    console.log(`[backup] ✅ Backup dibuat: ${dest} (${sizeKb} KB)`)

    lastStartupBackup = {
      outcome: 'created',
      at: new Date().toISOString(),
      snapshot: path.basename(dest),
      path: dest,
    }

    pruneOldBackups(dir)
    return dest
  } catch (err: any) {
    const message = String(err?.message || err)
    lastStartupBackup = { outcome: 'failed', at: new Date().toISOString(), reason: message }
    console.error('[backup] ⚠️  Backup gagal (server tetap jalan):', message)
    return null
  }
}
