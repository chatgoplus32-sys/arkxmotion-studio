import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'

const router = Router()

// Member mengetik masukan fitur ARKX Motion Studio; disimpan sebagai notifikasi
// `target = 'admins'` supaya langsung tampil di menu Notifikasi admin tanpa
// perlu tabel baru. user_id diisi agar admin tahu siapa pengirimnya.
router.post('/', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const text = String(req.body?.text ?? '').trim()
    if (text.length < 10) return res.status(400).json({ error: 'Tulis minimal 10 karakter' })
    if (text.length > 2000) return res.status(400).json({ error: 'Maksimal 2000 karakter' })

    const user = req.user!
    const head = text.split('\n')[0].slice(0, 80)
    db.prepare(
      "INSERT INTO notifications (title, message, type, target, user_id) VALUES (?, ?, 'announcement', 'admins', ?)"
    ).run(`Request Fitur: ${head}`, `${text}\n\n— ${user.email}`, user.id)

    res.status(201).json({ ok: true })
  } catch (err: any) {
    console.error('[feature-request] error:', err.message)
    res.status(500).json({ error: 'Gagal menyimpan request fitur' })
  }
})

export default router
