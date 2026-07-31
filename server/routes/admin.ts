import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.js'

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

router.get('/users', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const users = db.prepare(
      'SELECT id, email, name, role, approved, created_at, updated_at FROM users ORDER BY created_at DESC'
    ).all() as UserRow[]

    res.json({ users: users.map(u => ({ ...u, approved: !!u.approved })) })
  } catch (error) {
    console.error('List users error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/users/pending', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const users = db.prepare(
      'SELECT id, email, name, role, approved, created_at FROM users WHERE approved = 0 AND role != ? ORDER BY created_at DESC'
    ).all('admin') as UserRow[]

    res.json({ users: users.map(u => ({ ...u, approved: !!u.approved })) })
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
