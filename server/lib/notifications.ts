// ─── Notifikasi in-app (dipakai worker antrean) ────────────────────────────
//
// Tabel `notifications` SUDAH ADA di repo (dipakai pengumuman admin — lihat
// server/routes/admin.ts: POST /notifications, GET /notifications/mine).
// Modul ini TIDAK membuat tabel baru; ia hanya menulis baris notifikasi
// personal (target 'users', user_id terisi) untuk job generasi, plus
// membersihkan notifikasi lama. Panel lonceng yang sudah ada
// (src/components/ui/NotificationPanel.tsx) membacanya lewat endpoint
// /api/admin/notifications/mine yang sudah ada — tidak ada endpoint baca baru.
//
// Kolom `link` ditambahkan migrasi di server/db.ts (ALTER TABLE bila belum
// ada): klik notifikasi job mengarah ke /queue, bukan sekadar teks.
import db from '../db.js'

export type NotificationType = 'info' | 'warning' | 'success' | 'error' | 'announcement'

export interface BuatNotifikasi {
  userId: number
  type: NotificationType
  title: string
  message: string
  /** Tujuan klik (mis. '/queue'). Kosong = tidak bisa diklik. */
  link?: string
}

/**
 * Tulis satu baris notifikasi personal. Mengembalikan id baris.
 * Judul dibatasi 200 karakter, pesan 2000, link 500 — sama seperti batas
 * yang dipakai rute admin.
 */
export function createNotification(input: BuatNotifikasi): number {
  const hasil = db
    .prepare(
      `INSERT INTO notifications (title, message, type, target, user_id, link)
       VALUES (?, ?, ?, 'users', ?, ?)`,
    )
    .run(
      input.title.slice(0, 200),
      input.message.slice(0, 2000),
      input.type,
      input.userId,
      (input.link || '').slice(0, 500),
    )
  return Number(hasil.lastInsertRowid)
}

/** Baris job minimal yang dibutuhkan untuk menyusun teks notifikasi. */
export interface JobUntukNotifikasi {
  user_id: number
  provider: string
  job_id: string
  page: string
  prompt: string
  status: string
  result_url: string
  last_error: string
}

const LABEL_PROVIDER: Record<string, string> = {
  nexabot: 'NexaBot',
  posbot: 'PosBot',
}

function labelProvider(provider: string): string {
  return LABEL_PROVIDER[provider] || provider
}

function cuplikanPrompt(job: JobUntukNotifikasi): string {
  const prompt = (job.prompt || '').trim()
  if (prompt) return prompt.length > 120 ? `${prompt.slice(0, 120)}…` : prompt
  return `Job ${job.job_id.slice(0, 12)}…`
}

/**
 * Buat notifikasi untuk satu job yang selesai/gagal. Mengembalikan id
 * notifikasi, atau null kalau statusnya bukan terminal (tidak ada yang
 * dibuat). Link selalu '/queue' — hasil NexaBot yang belum disimpan tetap
 * diunduh lewat halaman Antrean (alur resume yang sudah ada).
 */
export function buatNotifikasiJob(job: JobUntukNotifikasi): number | null {
  const label = labelProvider(job.provider)
  const cuplikan = cuplikanPrompt(job)
  if (job.status === 'done') {
    return createNotification({
      userId: job.user_id,
      type: 'success',
      title: 'Generate selesai',
      message: `${label} · ${cuplikan} — hasilnya sudah bisa dilihat di Antrean.`,
      link: '/queue',
    })
  }
  if (job.status === 'failed') {
    return createNotification({
      userId: job.user_id,
      type: 'error',
      title: 'Generate gagal',
      message: `${label} · ${cuplikan} — ${job.last_error || 'coba lagi dari halaman asal.'}`,
      link: '/queue',
    })
  }
  return null
}

/**
 * Hapus notifikasi yang dibuat lebih dari `olderThanDays` hari lalu.
 * created_at memakai CURRENT_TIMESTAMP (UTC), jadi perbandingannya memakai
 * datetime('now') SQLite. Mengembalikan jumlah baris yang dihapus.
 */
export function pruneOldNotifications(olderThanDays = 30): number {
  const hari = Math.max(1, Math.floor(olderThanDays))
  const hasil = db
    .prepare(`DELETE FROM notifications WHERE created_at < datetime('now', ?)`)
    .run(`-${hari} days`)
  return hasil.changes
}
