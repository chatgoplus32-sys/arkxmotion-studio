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

    // Auto-verify email saat approve (admin trust = email valid)
    db.prepare('UPDATE users SET approved = 1, email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)

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
    // Konfirmasi pembayaran = akun member aktif + auto-verify email
    db.prepare('UPDATE users SET approved = 1, email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(payment.user_id)

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

// GET /api/admin/analytics — usage analytics for admin dashboard
router.get('/analytics', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c
    const totalLogs = (db.prepare('SELECT COUNT(*) as c FROM generation_logs').get() as any).c
    const totalCredits = (db.prepare('SELECT COALESCE(SUM(credits),0) as c FROM generation_logs WHERE status = "completed"').get() as any).c
    const completedCount = (db.prepare('SELECT COUNT(*) as c FROM generation_logs WHERE status = "completed"').get() as any).c
    const failedCount = (db.prepare('SELECT COUNT(*) as c FROM generation_logs WHERE status = "failed"').get() as any).c
    const pendingCount = (db.prepare('SELECT COUNT(*) as c FROM generation_logs WHERE status = "pending"').get() as any).c

    const byProvider = db.prepare(
      'SELECT provider, COUNT(*) as count, COALESCE(SUM(credits),0) as credits, COUNT(CASE WHEN status="completed" THEN 1 END) as completed FROM generation_logs GROUP BY provider ORDER BY count DESC'
    ).all()

    const byModel = db.prepare(
      'SELECT model, provider, COUNT(*) as count, COALESCE(SUM(credits),0) as credits FROM generation_logs GROUP BY model ORDER BY count DESC LIMIT 20'
    ).all()

    const byDay = db.prepare(
      'SELECT DATE(created_at) as day, COUNT(*) as count, COALESCE(SUM(credits),0) as credits FROM generation_logs GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 30'
    ).all()

    const topUsers = db.prepare(
      'SELECT u.name, u.email, COUNT(g.id) as generations, COALESCE(SUM(g.credits),0) as credits FROM generation_logs g JOIN users u ON g.user_id = u.id GROUP BY g.user_id ORDER BY credits DESC LIMIT 10'
    ).all()

    res.json({
      totalUsers, totalLogs, totalCredits, completedCount, failedCount, pendingCount,
      byProvider, byModel, byDay, topUsers,
    })
  } catch (err: any) {
    console.error('[admin-analytics] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/activity — recent activity feed across all users
router.get('/activity', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const provider = req.query.provider as string | undefined
    const status = req.query.status as string | undefined
    const userId = req.query.user_id as string | undefined

    let query = `
      SELECT g.*, u.name as user_name, u.email as user_email
      FROM generation_logs g
      LEFT JOIN users u ON g.user_id = u.id
      WHERE 1=1`
    const params: any[] = []

    if (provider) { query += ` AND g.provider = ?`; params.push(provider) }
    if (status) { query += ` AND g.status = ?`; params.push(status) }
    if (userId) { query += ` AND g.user_id = ?`; params.push(Number(userId)) }

    query += ` ORDER BY g.created_at DESC LIMIT ?`
    params.push(limit)

    const logs = db.prepare(query).all(...params)

    res.json({ logs })
  } catch (err: any) {
    console.error('[admin-activity] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/users/bulk — bulk approve or delete users
router.post('/users/bulk', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { action, ids } = req.body as { action: 'approve' | 'delete'; ids: number[] }
    if (!action || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Missing action or ids' })
    }
    if (!['approve', 'delete'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' })
    }

    // Filter out admin users
    const placeholders = ids.map(() => '?').join(',')
    const admins = db.prepare(`SELECT id FROM users WHERE id IN (${placeholders}) AND role = 'admin'`).all(...ids) as { id: number }[]
    const adminIds = new Set(admins.map(a => a.id))
    const safeIds = ids.filter(id => !adminIds.has(id))

    if (safeIds.length === 0) {
      return res.status(400).json({ error: 'Cannot perform action on admin users' })
    }

    const safePlaceholders = safeIds.map(() => '?').join(',')
    if (action === 'approve') {
      db.prepare(`UPDATE users SET approved = 1, email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (${safePlaceholders})`).run(...safeIds)
      res.json({ message: `${safeIds.length} user(s) approved`, skipped: adminIds.size })
    } else {
      db.prepare(`DELETE FROM users WHERE id IN (${safePlaceholders})`).run(...safeIds)
      res.json({ message: `${safeIds.length} user(s) deleted`, skipped: adminIds.size })
    }
  } catch (err: any) {
    console.error('[admin-bulk] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/export/users — export users as CSV
router.get('/export/users', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const users = db.prepare(
      `SELECT id, email, name, role, approved, email_verified, created_at, updated_at
       FROM users ORDER BY created_at DESC`
    ).all() as any[]

    const header = 'ID,Email,Name,Role,Approved,Email Verified,Created At,Updated At'
    const rows = users.map(u =>
      `${u.id},"${u.email}","${u.name}",${u.role},${u.approved ? 'Yes' : 'No'},${u.email_verified ? 'Yes' : 'No'},${u.created_at},${u.updated_at}`
    )

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="users-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send([header, ...rows].join('\n'))
  } catch (err: any) {
    console.error('[admin-export-users] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/export/activity — export activity logs as CSV
router.get('/export/activity', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 500, 5000)
    const logs = db.prepare(
      `SELECT g.*, u.name as user_name, u.email as user_email
       FROM generation_logs g
       LEFT JOIN users u ON g.user_id = u.id
       ORDER BY g.created_at DESC
       LIMIT ?`
    ).all(limit) as any[]

    const header = 'ID,User,Email,Provider,Model,Status,Credits,Error,Created At'
    const rows = logs.map(l =>
      `${l.id},"${l.user_name || ''}","${l.user_email || ''}",${l.provider || ''},${l.model || ''},${l.status || ''},${l.credits || 0},"${(l.error || '').replace(/"/g, '')}",${l.created_at || ''}`
    )

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="activity-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send([header, ...rows].join('\n'))
  } catch (err: any) {
    console.error('[admin-export-activity] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── Credit Management ─────────────────────────────────────────────

// GET /api/admin/credits — list all tokens with credits info
router.get('/credits', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const tokens = db.prepare(
      `SELECT id, provider, name, credits, credit_group, status, created_at, updated_at
       FROM tokens ORDER BY provider, name`
    ).all() as any[]

    // Summary per provider
    const summary = db.prepare(
      `SELECT provider,
              COUNT(*) as total,
              SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) as available,
              SUM(CASE WHEN credits IS NOT NULL THEN credits ELSE 0 END) as total_credits
       FROM tokens GROUP BY provider ORDER BY provider`
    ).all() as any[]

    res.json({ tokens, summary })
  } catch (err: any) {
    console.error('[admin-credits] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/admin/credits/:id — update credits for a token
router.patch('/credits/:id', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const { credits, credit_group } = req.body as { credits?: number; credit_group?: string }

    const token = db.prepare('SELECT id, provider, name FROM tokens WHERE id = ?').get(id) as any
    if (!token) return res.status(404).json({ error: 'Token not found' })

    if (credits !== undefined) {
      if (!Number.isFinite(credits) || credits < 0) {
        return res.status(400).json({ error: 'Credits must be a non-negative number' })
      }
      db.prepare('UPDATE tokens SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(credits, id)
    }
    if (credit_group !== undefined) {
      db.prepare('UPDATE tokens SET credit_group = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(credit_group || null, id)
    }

    res.json({ ok: true, message: `Token ${token.name} updated` })
  } catch (err: any) {
    console.error('[admin-credits-update] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/credits/bulk — bulk update credits
router.post('/credits/bulk', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { ids, credits } = req.body as { ids: number[]; credits: number }
    if (!Array.isArray(ids) || ids.length === 0 || !Number.isFinite(credits) || credits < 0) {
      return res.status(400).json({ error: 'Invalid ids or credits' })
    }
    const placeholders = ids.map(() => '?').join(',')
    db.prepare(`UPDATE tokens SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(credits, ...ids)
    res.json({ ok: true, message: `${ids.length} token(s) credits set to ${credits}` })
  } catch (err: any) {
    console.error('[admin-credits-bulk] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/credits/sync — sync credits from provider check results
// Accepts { provider, updates: [{ credits }] } — updates matched by provider + order
router.post('/credits/sync', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { provider, updates } = req.body as { provider: string; updates: { credits: number }[] }
    if (!provider || !Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'Missing provider or updates' })
    }
    // Get all tokens for this provider, ordered by id
    const tokens = db.prepare('SELECT id FROM tokens WHERE provider = ? ORDER BY id').all(provider) as { id: number }[]
    let synced = 0
    const stmt = db.prepare('UPDATE tokens SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    for (let i = 0; i < updates.length && i < tokens.length; i++) {
      if (typeof updates[i].credits === 'number') {
        stmt.run(updates[i].credits, tokens[i].id)
        synced++
      }
    }
    res.json({ ok: true, synced })
  } catch (err: any) {
    console.error('[admin-credits-sync] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/credits/reset — reset all credits to 0
router.post('/credits/reset', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const result = db.prepare('UPDATE tokens SET credits = 0, updated_at = CURRENT_TIMESTAMP').run()
    res.json({ ok: true, message: `${result.changes} token(s) credits reset to 0` })
  } catch (err: any) {
    console.error('[admin-credits-reset] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/credits/export — export credits as CSV
router.get('/credits/export', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const tokens = db.prepare(
      `SELECT id, provider, name, credits, credit_group, status, created_at
       FROM tokens ORDER BY provider, name`
    ).all() as any[]
    const header = 'ID,Provider,Name,Credits,Credit Group,Status,Created At'
    const rows = tokens.map(t =>
      `${t.id},${t.provider},"${t.name}",${t.credits ?? ''},${t.credit_group || ''},${t.status},${t.created_at}`
    )
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="credits-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send([header, ...rows].join('\n'))
  } catch (err: any) {
    console.error('[admin-credits-export] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── System Settings ───────────────────────────────────────────────

// GET /api/admin/settings — list all settings
router.get('/settings', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const rows = db.prepare('SELECT key, value, updated_at FROM app_settings ORDER BY key').all() as any[]
    const settings: Record<string, string> = {}
    rows.forEach(r => { settings[r.key] = r.value })

    // Also get provider maintenance status
    const maintenance = db.prepare('SELECT provider, is_maintenance, message FROM provider_maintenance ORDER BY provider').all() as any[]

    res.json({ settings, maintenance })
  } catch (err: any) {
    console.error('[admin-settings] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/admin/settings — update settings
router.put('/settings', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { settings, maintenance } = req.body as {
      settings?: Record<string, string>
      maintenance?: { provider: string; is_maintenance: boolean; message: string }[]
    }

    if (settings) {
      const upsert = db.prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
      )
      for (const [key, value] of Object.entries(settings)) {
        upsert.run(key, String(value))
      }
    }

    if (maintenance && Array.isArray(maintenance)) {
      for (const m of maintenance) {
        db.prepare(
          `UPDATE provider_maintenance SET is_maintenance = ?, message = ? WHERE provider = ?`
        ).run(m.is_maintenance ? 1 : 0, m.message || '', m.provider)
      }
    }

    res.json({ ok: true, message: 'Settings updated' })
  } catch (err: any) {
    console.error('[admin-settings-update] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/health — system health dashboard data (no Node builtins — uses process only)
router.get('/health', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const osMod = await import('node:os')
    const upSec = osMod.uptime()
    const memTotal = osMod.totalmem()
    const memFree = osMod.freemem()
    const memUsed = memTotal - memFree
    const memPct = Math.round((memUsed / memTotal) * 100)
    const cpuList = osMod.cpus()
    const loadAvg = osMod.loadavg()

    // Database stats
    const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c
    const totalTokens = (db.prepare('SELECT COUNT(*) as c FROM tokens').get() as any).c
    const totalLogs = (db.prepare('SELECT COUNT(*) as c FROM generation_logs').get() as any).c
    const recentLogs = (db.prepare(
      `SELECT COUNT(*) as c FROM generation_logs WHERE created_at >= datetime('now', '-24 hours')`
    ).get() as any).c
    const pendingPayments = (db.prepare(
      `SELECT COUNT(*) as c FROM membership_payments WHERE status = 'pending'`
    ).get() as any).c
    const pendingUsers = (db.prepare(
      `SELECT COUNT(*) as c FROM users WHERE approved = 0 AND role != 'admin'`
    ).get() as any).c

    // Provider maintenance
    const maintenance = db.prepare('SELECT provider, is_maintenance FROM provider_maintenance WHERE is_maintenance = 1').all() as any[]

    // Disk usage (approximate via db file size)
    const pathMod = await import('node:path')
    const fsMod = await import('node:fs')
    const dbPath = pathMod.join(process.cwd(), 'server', 'arkxmotion.db')
    let dbSize = 0
    try { dbSize = fsMod.statSync(dbPath).size } catch {}

    res.json({
      server: {
        uptime: Math.round(upSec),
        uptimeFormatted: `${Math.floor(upSec / 86400)}d ${Math.floor((upSec % 86400) / 3600)}h ${Math.floor((upSec % 3600) / 60)}m`,
        pid: process.pid,
        nodeVersion: process.version,
        platform: osMod.platform(),
        arch: osMod.arch(),
      },
      memory: {
        total: memTotal,
        used: memUsed,
        free: memFree,
        percentUsed: memPct,
        totalFormatted: `${Math.round(memTotal / 1024 / 1024)} MB`,
        usedFormatted: `${Math.round(memUsed / 1024 / 1024)} MB`,
      },
      cpu: {
        model: cpuList[0]?.model || 'Unknown',
        cores: cpuList.length,
        loadAvg: loadAvg.map((l: number) => Math.round(l * 100) / 100),
      },
      database: {
        size: dbSize,
        sizeFormatted: dbSize > 1024 * 1024 ? `${(dbSize / 1024 / 1024).toFixed(1)} MB` : `${(dbSize / 1024).toFixed(1)} KB`,
        totalUsers,
        totalTokens,
        totalLogs,
        recentLogs24h: recentLogs,
      },
      queue: {
        pendingPayments,
        pendingUsers,
        maintenanceProviders: maintenance.map((m: any) => m.provider),
      },
    })
  } catch (err: any) {
    console.error('[admin-health] error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── Notifications ──────────────────────────────────────────────────────
// GET /api/admin/notifications — list all notifications (admin)
router.get('/notifications', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(_req.query.limit as string) || 50, 200)
    const offset = parseInt(_req.query.offset as string) || 0
    const rows = db.prepare(
      'SELECT n.*, u.email as user_email FROM notifications n LEFT JOIN users u ON n.user_id = u.id ORDER BY n.created_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as any[]
    const total = (db.prepare('SELECT COUNT(*) as c FROM notifications').get() as any).c
    res.json({ notifications: rows, total })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/notifications/unread — count unread for current user
router.get('/notifications/unread', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const isAdmin = req.user!.role === 'admin'
    let count: number
    if (isAdmin) {
      count = (db.prepare(
        `SELECT COUNT(*) as c FROM notifications WHERE read = 0 AND (target = 'all' OR target = 'admins')`
      ).get() as any).c
    } else {
      count = (db.prepare(
        `SELECT COUNT(*) as c FROM notifications WHERE read = 0 AND user_id = ? AND (target = 'all' OR target = 'users')`
      ).get(userId) as any).c
    }
    res.json({ count })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/admin/notifications/mine — notifications for current user
router.get('/notifications/mine', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const isAdmin = req.user!.role === 'admin'
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100)
    let rows: any[]
    if (isAdmin) {
      rows = db.prepare(
        `SELECT * FROM notifications WHERE (target = 'all' OR target = 'admins') ORDER BY created_at DESC LIMIT ?`
      ).all(limit)
    } else {
      rows = db.prepare(
        `SELECT * FROM notifications WHERE user_id = ? AND (target = 'all' OR target = 'users') ORDER BY created_at DESC LIMIT ?`
      ).all(userId, limit)
    }
    const unread = (db.prepare(
      'SELECT COUNT(*) as c FROM notifications WHERE read = 0 AND (user_id = ? OR user_id IS NULL) AND (target = ? OR target = ?)'
    ).get(userId, isAdmin ? 'admins' : 'users', 'all') as any).c
    res.json({ notifications: rows, unread })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/notifications — send notification (admin)
router.post('/notifications', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { title, message, type = 'info', target = 'all', user_id = null } = req.body || {}
    if (!title || !message) return res.status(400).json({ error: 'Title and message are required' })
    const validTypes = ['info', 'warning', 'success', 'error', 'announcement']
    const validTargets = ['all', 'users', 'admins']
    if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid notification type' })
    if (!validTargets.includes(target)) return res.status(400).json({ error: 'Invalid target' })
    const result = db.prepare(
      'INSERT INTO notifications (title, message, type, target, user_id) VALUES (?, ?, ?, ?, ?)'
    ).run(title.slice(0, 200), message.slice(0, 2000), type, target, user_id || null)
    res.status(201).json({ id: result.lastInsertRowid, ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/notifications/broadcast — broadcast to all users
router.post('/notifications/broadcast', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const { title, message, type = 'announcement' } = req.body || {}
    if (!title || !message) return res.status(400).json({ error: 'Title and message are required' })
    const result = db.prepare(
      'INSERT INTO notifications (title, message, type, target) VALUES (?, ?, ?, ?)'
    ).run(title.slice(0, 200), message.slice(0, 2000), type, 'all')
    res.status(201).json({ id: result.lastInsertRowid, ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/admin/notifications/:id/read — mark as read
router.patch('/notifications/:id/read', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/admin/notifications/:id — delete notification
router.delete('/notifications/:id', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    db.prepare('DELETE FROM notifications WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/notifications/clear-all — clear all notifications (admin)
router.post('/notifications/clear-all', authenticateToken, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    db.prepare('DELETE FROM notifications').run()
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
