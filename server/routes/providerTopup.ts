import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.js'
import { MANUAL_TOPUP_MAX, MANUAL_TOPUP_MIN } from '../../shared/pricing.js'

/**
 * Top-up manual untuk provider tanpa dompet (Roboneo/Weavy/Framia, dll.).
 *
 * Token Bank dikunci dan provider-provider itu memakai kunci milik member
 * sendiri, jadi tidak ada saldo yang bisa dikreditkan otomatis. Alurnya:
 * member mengajukan nominal + bukti transfer, admin memverifikasi lalu
 * menyerahkan kunci/saldo provider dan menandai permintaan selesai.
 */
const router = Router()

/** Batas permintaan pending supaya antrean admin tidak dibanjiri. */
export const MAX_PENDING_MANUAL_TOPUPS = 3
const PROVIDER_PATTERN = /^[a-z0-9_-]{1,40}$/
const NOTE_MAX = 300

interface RequestRow {
  id: number
  user_id: number
  provider: string
  amount: number
  note: string
  status: 'pending' | 'approved' | 'rejected'
  admin_note: string
  created_at: string
  updated_at: string
}

function findRequest(id: unknown): RequestRow | undefined {
  const requestId = Number(id)
  if (!Number.isInteger(requestId) || requestId <= 0) return undefined
  return db.prepare('SELECT * FROM provider_topup_request WHERE id = ?').get(requestId) as
    | RequestRow
    | undefined
}

router.post('/request', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const provider = String(req.body?.provider || '').trim().toLowerCase()
    const amount = Math.round(Number(req.body?.amount))
    const note = String(req.body?.note || '').trim().slice(0, NOTE_MAX)

    if (!PROVIDER_PATTERN.test(provider)) {
      return res.status(400).json({ error: 'Provider tidak valid' })
    }
    if (!Number.isFinite(amount) || amount < MANUAL_TOPUP_MIN || amount > MANUAL_TOPUP_MAX) {
      return res.status(400).json({
        error: `Nominal harus Rp ${MANUAL_TOPUP_MIN.toLocaleString('id-ID')}–Rp ${MANUAL_TOPUP_MAX.toLocaleString('id-ID')}`,
      })
    }

    const pending = db.prepare(
      "SELECT COUNT(*) AS jumlah FROM provider_topup_request WHERE user_id = ? AND status = 'pending'",
    ).get(userId) as { jumlah: number }
    if (pending.jumlah >= MAX_PENDING_MANUAL_TOPUPS) {
      return res.status(429).json({
        error: `Masih ada ${MAX_PENDING_MANUAL_TOPUPS} permintaan menunggu persetujuan admin`,
      })
    }

    const result = db.prepare(
      'INSERT INTO provider_topup_request (user_id, provider, amount, note, status) VALUES (?, ?, ?, ?, ?)',
    ).run(userId, provider, amount, note, 'pending')

    const request = findRequest(result.lastInsertRowid)
    res.status(201).json({ request, message: 'Permintaan top-up terkirim, menunggu verifikasi admin' })
  } catch (error) {
    console.error('Manual topup request error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/mine', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const requests = db.prepare(
      'SELECT * FROM provider_topup_request WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    ).all(userId)
    res.json({ requests })
  } catch (error) {
    console.error('List my manual topups error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/admin/pending', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const requests = db.prepare(`
      SELECT t.*, u.email, u.name AS user_name
      FROM provider_topup_request t
      JOIN users u ON t.user_id = u.id
      WHERE t.status = 'pending'
      ORDER BY t.created_at ASC
    `).all()
    res.json({ requests })
  } catch (error) {
    console.error('List pending manual topups error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/admin/all', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const requests = db.prepare(`
      SELECT t.*, u.email, u.name AS user_name
      FROM provider_topup_request t
      JOIN users u ON t.user_id = u.id
      ORDER BY t.created_at DESC
      LIMIT 200
    `).all()
    res.json({ requests })
  } catch (error) {
    console.error('List all manual topups error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/admin/:id', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const status = String(req.body?.status || '')
    if (status !== 'approved' && status !== 'rejected') {
      return res.status(400).json({ error: 'Status harus approved atau rejected' })
    }
    const adminNote = String(req.body?.admin_note || '').trim().slice(0, NOTE_MAX)
    const request = findRequest(req.params.id)
    if (!request) return res.status(404).json({ error: 'Permintaan tidak ditemukan' })
    if (request.status !== 'pending') {
      return res.status(409).json({ error: 'Permintaan ini sudah diproses' })
    }

    db.prepare(
      "UPDATE provider_topup_request SET status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
    ).run(status, adminNote, request.id)

    res.json({ request: findRequest(request.id) })
  } catch (error) {
    console.error('Update manual topup error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
