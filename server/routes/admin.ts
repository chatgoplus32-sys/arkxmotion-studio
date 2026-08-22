import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.js'
import { sendVerificationEmail } from './auth.js'
import { getMembershipFee, setMembershipFee } from './membership.js'

const router = Router()

interface UserRow {
  id: number
  email: string
  name: string
  role: string
  approved: number
  created_at: string
  updated_at: string
}

function attachPayment(user: any): any {
  const payment = db.prepare(
    'SELECT id, amount, status, proof_note, admin_note, created_at FROM membership_payments WHERE user_id = ? ORDER BY id DESC LIMIT 1'
  ).get(user.id) as { id: number; amount: number; status: string; proof_note: string; admin_note: string; created_at: string } | undefined
  return {
    ...user,
    approved: !!user.approved,
    email_verified: !!user.email_verified,
    payment: payment
      ? { id: payment.id, amount: payment.amount, status: payment.status, proofNote: payment.proof_note, adminNote: payment.admin_note, createdAt: payment.created_at }
      : null,
  }
}

router.get('/users', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const users = db.prepare(
      'SELECT id, email, name, role, approved, email_verified, created_at, updated_at FROM users ORDER BY created_at DESC'
    ).all() as UserRow[]

    res.json({ users: users.map(attachPayment) })
  } catch (error) {
    console.error('List users error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/users/pending', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const users = db.prepare(
      'SELECT id, email, name, role, approved, email_verified, created_at FROM users WHERE approved = 0 AND role != ? ORDER BY created_at DESC'
    ).all('admin') as UserRow[]

    res.json({ users: users.map(attachPayment) })
  } catch (error) {
    console.error('List pending users error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/users/:id/approve', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params

    const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(id) as UserRow | undefined
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Cannot approve admin users' })
    }

    db.prepare('UPDATE users SET approved = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)

    res.json({ message: `User ${user.email} approved successfully` })
  } catch (error) {
    console.error('Approve user error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/users/:id/reject', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params

    const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(id) as UserRow | undefined
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Cannot reject admin users' })
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id)

    res.json({ message: `User ${user.email} rejected and removed` })
  } catch (error) {
    console.error('Reject user error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/users/:id', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params

    const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(id) as UserRow | undefined
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Cannot delete admin users' })
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id)

    res.json({ message: `User ${user.email} deleted successfully` })
  } catch (error) {
    console.error('Delete user error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── Konfigurasi membership (harga) ────────────────────────────────

router.get('/membership/config', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    res.json({ ok: true, membershipFee: getMembershipFee() })
  } catch (error) {
    console.error('Get membership config error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/membership/config', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const fee = Number((req.body as any)?.membershipFee)
    if (!Number.isFinite(fee) || fee <= 0) {
      return res.status(400).json({ error: 'Nominal harus angka lebih dari 0' })
    }
    setMembershipFee(fee)
    res.json({ ok: true, message: `Harga membership diubah menjadi Rp ${fee.toLocaleString('id-ID')}`, membershipFee: fee })
  } catch (error) {
    console.error('Set membership config error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── Konfirmasi pembayaran member ─────────────────────────────────

router.get('/membership/payments', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT mp.id, mp.user_id, mp.amount, mp.status, mp.proof_note, mp.admin_note, mp.created_at,
             u.email, u.name, u.approved AS user_approved
      FROM membership_payments mp
      JOIN users u ON u.id = mp.user_id
      ORDER BY CASE mp.status WHEN 'pending' THEN 0 ELSE 1 END, mp.created_at DESC
    `).all() as any[]
    res.json({
      payments: rows.map(p => ({
        id: p.id,
        userId: p.user_id,
        amount: p.amount,
        status: p.status,
        proofNote: p.proof_note,
        adminNote: p.admin_note,
        createdAt: p.created_at,
        email: p.email,
        name: p.name,
        userApproved: !!p.user_approved,
      })),
    })
  } catch (error) {
    console.error('List membership payments error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/membership/payments/:id/approve', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const payment = db.prepare(
      "SELECT mp.id, mp.user_id, mp.status, u.email FROM membership_payments mp JOIN users u ON u.id = mp.user_id WHERE mp.id = ?"
    ).get(id) as { id: number; user_id: number; status: string; email: string } | undefined
    if (!payment) return res.status(404).json({ error: 'Pembayaran tidak ditemukan' })
    if (payment.status === 'approved') return res.status(400).json({ error: 'Pembayaran ini sudah disetujui' })

    db.prepare("UPDATE membership_payments SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id)
    // Konfirmasi pembayaran = akun member aktif
    db.prepare('UPDATE users SET approved = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(payment.user_id)

    res.json({ ok: true, message: `Pembayaran ${payment.email} disetujui & akun diaktifkan` })
  } catch (error) {
    console.error('Approve membership payment error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/membership/payments/:id/reject', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const adminNote = String((req.body as any)?.admin_note || '').slice(0, 500)
    const payment = db.prepare(
      "SELECT mp.id, mp.user_id, mp.status, u.email FROM membership_payments mp JOIN users u ON u.id = mp.user_id WHERE mp.id = ?"
    ).get(id) as { id: number; user_id: number; status: string; email: string } | undefined
    if (!payment) return res.status(404).json({ error: 'Pembayaran tidak ditemukan' })

    db.prepare("UPDATE membership_payments SET status = 'rejected', admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(adminNote, id)
    res.json({ ok: true, message: `Pembayaran ${payment.email} ditolak` })
  } catch (error) {
    console.error('Reject membership payment error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Kirim ulang link verifikasi email untuk user yang belum verifikasi
router.post('/users/:id/resend-verification', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params

    const user = db.prepare('SELECT id, email, name, role, email_verified FROM users WHERE id = ?').get(id) as
      | { id: number; email: string; name: string; role: string; email_verified?: number }
      | undefined
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }
    if (user.email_verified) {
      return res.status(400).json({ error: 'Email user ini sudah terverifikasi' })
    }

    const devVerifyLink = await sendVerificationEmail(user)
    res.json({ ok: true, message: `Link verifikasi dikirim ke ${user.email}`, devVerifyLink })
  } catch (error) {
    console.error('Resend verification error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── Maintenance Routes ────────────────────────────────────────────

interface MaintenanceRow {
  id: number
  provider: string
  is_maintenance: number
  message: string
  updated_at: string
}

router.get('/maintenance', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const rows = db.prepare('SELECT provider, is_maintenance, message, updated_at FROM provider_maintenance ORDER BY provider').all() as MaintenanceRow[]
    res.json({
      maintenance: rows.map(r => ({
        provider: r.provider,
        isMaintenance: !!r.is_maintenance,
        message: r.message,
        updatedAt: r.updated_at,
      }))
    })
  } catch (error) {
    console.error('Get maintenance error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/maintenance', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { provider, isMaintenance, message } = req.body || {}
    if (!provider) {
      return res.status(400).json({ error: 'Provider is required' })
    }

    db.prepare('UPDATE provider_maintenance SET is_maintenance = ?, message = ?, updated_at = CURRENT_TIMESTAMP WHERE provider = ?')
      .run(isMaintenance ? 1 : 0, message || '', provider)

    res.json({
      message: `Maintenance status updated for ${provider}`,
      provider,
      isMaintenance: !!isMaintenance,
      maintenanceMessage: message || '',
    })
  } catch (error) {
    console.error('Update maintenance error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Public maintenance endpoint (no auth)
router.get('/public/maintenance', (_req: AuthRequest, res: Response) => {
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

export default router
