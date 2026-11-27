// ─── Notifikasi milik user (di luar namespace admin) ────────────────────────
//
// Endpoint BACA notifikasi sudah ada dan DIPAKAI ULANG — bukan diduplikasi:
//   GET   /api/admin/notifications/mine   (daftar + unread, di server/routes/admin.ts)
//   PATCH /api/admin/notifications/:id/read
// Panel lonceng (NotificationPanel) dan notificationStore memanggil keduanya.
//
// Yang BELUM ada dan ditambahkan di sini: tandai SEMUA notifikasi milik user
// sudah dibaca. Sengaja hanya baris `user_id = ?` milik pemanggil: kolom
// `read` di tabel notifications bersifat global, jadi menandai broadcast
// (user_id NULL) dibaca untuk satu user akan menandainya untuk semua orang.
// Broadcast tetap harus ditandai satu per satu lewat endpoint admin yang ada.
import { Router, type Response } from 'express'
import db from '../db.js'
import { authenticateToken, type AuthRequest } from '../middleware/auth.js'

const router = Router()

/** PATCH /api/notifications/read-all — tandai semua notifikasi pribadi sudah dibaca. */
router.patch('/read-all', authenticateToken, (req: AuthRequest, res: Response) => {
  const userId = req.user?.id
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const hasil = db
      .prepare(`UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0`)
      .run(userId)
    res.json({ ok: true, marked: hasil.changes })
  } catch (err) {
    console.error('[notifications] read-all gagal:', (err as Error)?.message || err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
