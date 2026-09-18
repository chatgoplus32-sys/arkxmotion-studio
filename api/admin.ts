import type { VercelRequest, VercelResponse } from '@vercel/node'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { neon } from '@neondatabase/serverless'
import { sendEmail, appUrl } from './mailer.js'
import {
  NEXABOT_PACKAGES,
  NEXABOT_PRICING_DEFAULTS,
  NEXABOT_PRICING_KEYS,
  NEXABOT_PRICING_SETTING_KEYS,
  describeNexabotPricing,
  parseNexabotPricing,
  validateNexabotPackageValue,
  validateNexabotPricing,
  type NexabotPackagesPatch,
  type NexabotPricing,
  type NexabotPricingField,
} from '../shared/pricing.js'

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return neon(url)
}

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('JWT_SECRET env var is required')

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function verifyAdmin(req: VercelRequest): { id: number; email: string; role: string } | null {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return null
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: number; email: string; role: string }
    return decoded.role === 'admin' ? decoded : null
  } catch {
    return null
  }
}

function getSegments(req: VercelRequest): string[] {
  const urlPath = req.url?.split('?')[0] || ''
  return urlPath.split('/').filter(Boolean)
}

function verifyUser(req: VercelRequest): { id: number; email: string; role: string } | null {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return null
  try {
    return jwt.verify(token, JWT_SECRET) as { id: number; email: string; role: string }
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  // Allow non-admin users for notification unread/mine endpoints
  const segments = getSegments(req)
  const isNotificationUserRoute = segments.includes('notifications') && (
    segments.includes('unread') || segments.includes('mine')
  )

  if (isNotificationUserRoute) {
    if (!verifyUser(req)) return res.status(401).json({ error: 'Authentication required' })
  } else {
    if (!verifyAdmin(req)) return res.status(403).json({ error: 'Admin access required' })
  }

  try {
    // Ensure tables and columns exist (idempotent)
    const sql = getSql()
    try { await sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT NULL` } catch { /* column already exists */ }
    try { await sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS credit_group TEXT DEFAULT NULL` } catch { /* column already exists */ }
    try { await sql`CREATE TABLE IF NOT EXISTS generation_logs (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, page TEXT NOT NULL DEFAULT '', provider TEXT, model TEXT, status TEXT NOT NULL DEFAULT 'pending', credits INTEGER DEFAULT 0, error TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)` } catch { /* table already exists */ }
    try { await sql`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, title TEXT NOT NULL, message TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'info', target TEXT NOT NULL DEFAULT 'all', user_id INTEGER DEFAULT NULL, read INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)` } catch { /* table already exists */ }
    try { await sql`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)` } catch { /* table already exists */ }
    try { await sql`CREATE TABLE IF NOT EXISTS provider_maintenance (id SERIAL PRIMARY KEY, provider TEXT UNIQUE NOT NULL, is_maintenance INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)` } catch { /* table already exists */ }
    // Kolom paket Unlimited NexaBot — supaya halaman approval admin tetap benar
    // walau fungsi wallet-nya belum pernah dipanggil sejak deploy.
    try { await sql`ALTER TABLE nexabot_topup ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'balance'` } catch { /* table/column not ready yet */ }
    try { await sql`ALTER TABLE nexabot_topup ADD COLUMN IF NOT EXISTS days INTEGER NOT NULL DEFAULT 0` } catch { /* table/column not ready yet */ }
    try { await sql`ALTER TABLE nexabot_topup ADD COLUMN IF NOT EXISTS started_at TIMESTAMP` } catch { /* table/column not ready yet */ }
    try { await sql`ALTER TABLE nexabot_topup ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP` } catch { /* table/column not ready yet */ }

    // /api/admin/topup/* routes
    if (segments.includes('topup') || segments.includes('topups')) {
      return handleTopupRoutes(req, res, segments)
    }

    // /api/admin/tokens/* routes
    if (segments.includes('tokens')) {
      return handleTokenRoutes(req, res, segments)
    }

    // /api/admin/nexabot/* (konfigurasi harga NexaBot)
    if (segments.includes('nexabot') || req.query.nexabot) {
      return handleNexabotConfigRoutes(req, res)
    }

    // /api/admin/membership/* (konfirmasi pembayaran member)
    if (segments.includes('membership') || req.query.membership) {
      return handleMembershipRoutes(req, res)
    }

    // /api/admin/status
    if (segments.includes('status')) {
      return handleStatusRoutes(req, res)
    }

    // /api/admin/maintenance
    if (segments.includes('maintenance')) {
      return handleMaintenanceRoutes(req, res)
    }

    // /api/admin/analytics
    if (segments.includes('analytics')) {
      return handleAnalytics(req, res)
    }

    // /api/admin/activity
    if (segments.includes('activity')) {
      return handleActivity(req, res)
    }

    // /api/admin/credits/*
    if (segments.includes('credits')) {
      return handleCreditsRoutes(req, res, segments)
    }

    // /api/admin/settings
    if (segments.includes('settings')) {
      return handleSettingsRoutes(req, res)
    }

    // /api/admin/health
    if (segments.includes('health')) {
      return handleHealth(req, res)
    }

    // /api/admin/notifications/*
    if (segments.includes('notifications')) {
      return handleNotificationsRoutes(req, res, segments)
    }

    // /api/admin/* user management routes (existing)
    return handleUserRoutes(req, res, segments)
  } catch (err: any) {
    console.error('Admin handler error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

// ─── User Management ───────────────────────────────────────────────

async function handleUserRoutes(req: VercelRequest, res: VercelResponse, segments: string[]) {
  const rawId = req.query.id
  const id = rawId ? Number(Array.isArray(rawId) ? rawId[0] : rawId) : undefined
  const rawAction = req.query.action
  const action = Array.isArray(rawAction) ? rawAction[0] : rawAction

  if (segments.includes('pending') || (!id && !segments.includes('tokens') && req.url?.includes('pending'))) {
    if (req.method === 'GET') return handlePending(res)
  }

  if (id && action === 'approve' && req.method === 'POST') {
    return handleApprove(res, id)
  }

  if (id && !action && req.method === 'DELETE') {
    return handleDelete(res, id)
  }

  if (!id && req.method === 'GET') {
    return handleList(res)
  }

  if (id && action === 'reset-password' && req.method === 'PATCH') {
    return handleResetPassword(res, id, req.body)
  }

  if (id && action === 'resend-verification' && req.method === 'POST') {
    return handleResendVerification(res, id)
  }

  return res.status(404).json({ error: 'Not found' })
}

async function attachPayment(sql: any, users: any[]): Promise<any[]> {
  const out: any[] = []
  for (const u of users) {
    let payment: any = null
    try {
      const pays = await sql`SELECT id, amount, status, proof_note, admin_note, created_at FROM membership_payments WHERE user_id = ${u.id} ORDER BY id DESC LIMIT 1`
      if (pays[0]) {
        payment = {
          id: pays[0].id, amount: pays[0].amount, status: pays[0].status,
          proofNote: pays[0].proof_note, adminNote: pays[0].admin_note, createdAt: pays[0].created_at,
        }
      }
    } catch (e) { console.warn('[admin] Failed to attach payment for user:', e) }
    out.push({ ...u, approved: !!u.approved, email_verified: !!u.email_verified, payment })
  }
  return out
}

async function handleList(res: VercelResponse) {
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT id, email, name, role, approved, email_verified, created_at, updated_at
      FROM users ORDER BY created_at DESC
    `
    return res.status(200).json({ users: await attachPayment(sql, rows) })
  } catch (err: any) {
    console.error('List users error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function handlePending(res: VercelResponse) {
  try {
    const sql = getSql()
    const rows = await sql`
      SELECT id, email, name, role, approved, email_verified, created_at
      FROM users WHERE approved = 0 AND role != 'admin'
      ORDER BY created_at DESC
    `
    return res.status(200).json({ users: await attachPayment(sql, rows) })
  } catch (err: any) {
    console.error('List pending users error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function handleApprove(res: VercelResponse, id: number) {
  try {
    const sql = getSql()
    const rows = await sql`SELECT id, email, name, role FROM users WHERE id = ${id}`
    const user = rows[0]
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.role === 'admin') return res.status(400).json({ error: 'Cannot approve admin users' })

    await sql`UPDATE users SET approved = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
    return res.status(200).json({ message: `User ${user.email} approved successfully` })
  } catch (err: any) {
    console.error('Approve user error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function handleDelete(res: VercelResponse, id: number) {
  try {
    const sql = getSql()
    const rows = await sql`SELECT id, email, role FROM users WHERE id = ${id}`
    const user = rows[0]
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.role === 'admin') return res.status(400).json({ error: 'Cannot delete admin users' })

    await sql`DELETE FROM users WHERE id = ${id}`
    return res.status(200).json({ message: `User ${user.email} deleted successfully` })
  } catch (err: any) {
    console.error('Delete user error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function handleResetPassword(res: VercelResponse, id: number, body: any) {
  try {
    const { new_password } = body || {}
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'Password minimal 8 karakter' })
    }

    const sql = getSql()
    const rows = await sql`SELECT id, email, role FROM users WHERE id = ${id}`
    const user = rows[0]
    if (!user) return res.status(404).json({ error: 'User not found' })

    const bcrypt = await import('bcryptjs')
    const hashedPassword = await bcrypt.hash(new_password, 10)
    await sql`UPDATE users SET password = ${hashedPassword}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`

    return res.status(200).json({ message: `Password ${user.email} berhasil direset` })
  } catch (err: any) {
    console.error('Reset password error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

// ─── Topup Management (merged from api/admin/topup.ts) ─────────────

/**
 * Wallet mana yang sedang di-approve. Nilainya hanya diambil dari daftar putih
 * (`createpulse` default, `nexabot`), lalu query per provider ditulis eksplisit —
 * tagged template Neon tidak menerima identifier tabel dinamis, dan cara ini
 * sekaligus menutup celah injeksi lewat parameter `provider`.
 */
function resolveTopupProvider(req: VercelRequest): 'createpulse' | 'nexabot' {
  const raw = String((req.query.provider as string) || req.body?.provider || 'createpulse')
  return raw === 'nexabot' ? 'nexabot' : 'createpulse'
}

async function handleTopupRoutes(req: VercelRequest, res: VercelResponse, segments: string[]) {
  try {
    const sql = getSql()
    const last = segments[segments.length - 1]
    const provider = resolveTopupProvider(req)
    const isNexabot = provider === 'nexabot'

    // GET /api/admin/topup/pending
    if (req.method === 'GET' && last === 'pending') {
      const rows = isNexabot
        ? await sql`SELECT t.*, u.email, u.name as user_name FROM nexabot_topup t JOIN users u ON t.user_id = u.id WHERE t.status = 'pending' ORDER BY t.created_at ASC`
        : await sql`SELECT t.*, u.email, u.name as user_name FROM createpulse_topup t JOIN users u ON t.user_id = u.id WHERE t.status = 'pending' ORDER BY t.created_at ASC`
      return res.status(200).json({ topups: rows, provider })
    }

    // GET /api/admin/topup/all
    if (req.method === 'GET' && last === 'all') {
      const rows = isNexabot
        ? await sql`SELECT t.*, u.email, u.name as user_name FROM nexabot_topup t JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC`
        : await sql`SELECT t.*, u.email, u.name as user_name FROM createpulse_topup t JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC`
      return res.status(200).json({ topups: rows, provider })
    }

    // PATCH /api/admin/topup/approve
    if (req.method === 'PATCH' && last === 'approve') {
      const { id, admin_note } = req.body || {}
      if (!id) return res.status(400).json({ error: 'Topup id required' })

      if (isNexabot) {
        const topup = await sql`SELECT * FROM nexabot_topup WHERE id = ${id} AND status = 'pending'`
        if (topup.length === 0) return res.status(404).json({ error: 'Pending topup not found' })

        // Paket Unlimited: approve = aktifkan masa berlaku, BUKAN menambah saldo.
        // Paket lama yang masih jalan ditumpuk (lihat priorExpiry di bawah).
        if (topup[0].kind === 'unlimited') {
          const days = Number(topup[0].days) || 7
          // Base masa berlaku = expiry TERJAUH yang sudah disetujui untuk user
          // ini (baris yang sedang di-approve masih NULL), supaya beli paket
          // baru saat paket lama jalan menumpuk sisa hari alih-alih
          // menghanguskannya — sama seperti sisi Express.
          const prior = await sql`
            SELECT MAX(expires_at) AS expires_at FROM nexabot_topup
            WHERE user_id = ${topup[0].user_id} AND kind = 'unlimited' AND status = 'approved' AND id <> ${id}
          `
          const priorExpiry = prior[0]?.expires_at || null
          await sql`
            UPDATE nexabot_topup
            SET status = 'approved',
                admin_note = ${admin_note || ''},
                started_at = NOW(),
                expires_at = GREATEST(COALESCE(${priorExpiry}, NOW()), NOW()) + make_interval(days => ${days}),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ${id}
          `
          const activated = await sql`SELECT expires_at FROM nexabot_topup WHERE id = ${id}`
          const bal = await sql`SELECT balance FROM nexabot_balance WHERE user_id = ${topup[0].user_id}`
          const expiresAt = activated[0]?.expires_at || null
          // days_left = sisa hari SETELAH penumpukan (bukan jumlah hari yang
          // baru dibeli), supaya admin melihat masa berlaku yang sebenarnya.
          const remaining = expiresAt
            ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000))
            : 0
          return res.status(200).json({
            message: `Paket Unlimited ${days} hari diaktifkan`,
            balance: bal[0]?.balance || 0,
            unlimited: { active: true, expires_at: expiresAt, days_left: remaining },
          })
        }

        await sql`UPDATE nexabot_topup SET status = 'approved', admin_note = ${admin_note || ''}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
        await sql`INSERT INTO nexabot_balance (user_id, balance) VALUES (${topup[0].user_id}, ${topup[0].amount}) ON CONFLICT (user_id) DO UPDATE SET balance = nexabot_balance.balance + ${topup[0].amount}, updated_at = CURRENT_TIMESTAMP`

        const bal = await sql`SELECT balance FROM nexabot_balance WHERE user_id = ${topup[0].user_id}`
        return res.status(200).json({ message: 'Topup approved', balance: bal[0]?.balance || 0 })
      }

      const topup = await sql`SELECT * FROM createpulse_topup WHERE id = ${id} AND status = 'pending'`
      if (topup.length === 0) return res.status(404).json({ error: 'Pending topup not found' })

      await sql`UPDATE createpulse_topup SET status = 'approved', admin_note = ${admin_note || ''}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
      await sql`INSERT INTO createpulse_balance (user_id, balance) VALUES (${topup[0].user_id}, ${topup[0].amount}) ON CONFLICT (user_id) DO UPDATE SET balance = createpulse_balance.balance + ${topup[0].amount}, updated_at = CURRENT_TIMESTAMP`

      const bal = await sql`SELECT balance FROM createpulse_balance WHERE user_id = ${topup[0].user_id}`
      return res.status(200).json({ message: 'Topup approved', balance: bal[0]?.balance || 0 })
    }

    // PATCH /api/admin/topup/reject
    if (req.method === 'PATCH' && last === 'reject') {
      const { id, admin_note } = req.body || {}
      if (!id) return res.status(400).json({ error: 'Topup id required' })

      if (isNexabot) {
        const topup = await sql`SELECT * FROM nexabot_topup WHERE id = ${id} AND status = 'pending'`
        if (topup.length === 0) return res.status(404).json({ error: 'Pending topup not found' })

        await sql`UPDATE nexabot_topup SET status = 'rejected', admin_note = ${admin_note || ''}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
        return res.status(200).json({ message: 'Topup rejected' })
      }

      const topup = await sql`SELECT * FROM createpulse_topup WHERE id = ${id} AND status = 'pending'`
      if (topup.length === 0) return res.status(404).json({ error: 'Pending topup not found' })

      await sql`UPDATE createpulse_topup SET status = 'rejected', admin_note = ${admin_note || ''}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
      return res.status(200).json({ message: 'Topup rejected' })
    }

    return res.status(404).json({ error: 'Not found' })
  } catch (err: any) {
    console.error('Admin topup error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

// ─── Token Management (merged from api/admin/tokens.ts) ────────────

async function handleTokenRoutes(req: VercelRequest, res: VercelResponse, segments: string[]) {
  try {
    const sql = getSql()
    const last = segments[segments.length - 1]

    // GET /api/admin/tokens or /api/admin/tokens?provider=roboneo
    if (req.method === 'GET' && last === 'tokens') {
      const provider = req.query.provider as string | undefined
      if (provider && ['roboneo', 'framia', 'weavy', 'createpulse', 'riverside'].includes(provider)) {
        const rows = await sql`SELECT * FROM tokens WHERE provider = ${provider} ORDER BY created_at DESC`
        return res.status(200).json({ tokens: rows })
      }
      const rows = await sql`SELECT * FROM tokens ORDER BY created_at DESC`
      return res.status(200).json({ tokens: rows })
    }

    // POST /api/admin/tokens - create single or bulk
    if (req.method === 'POST' && last === 'tokens') {
      const { provider, name, token_value, price, credits, credit_group, tokens: bulkTokens } = req.body || {}

      if (bulkTokens && Array.isArray(bulkTokens)) {
        let created = 0
        for (const t of bulkTokens) {
          try {
            await sql`INSERT INTO tokens (provider, name, token_value, price, credits, credit_group) VALUES (${provider}, ${t.name}, ${t.token_value}, ${price}, ${t.credits ?? null}, ${t.credit_group ?? null})`
            created++
          } catch (e) { console.warn('[admin] Failed to insert bulk token:', e) }
        }
        return res.status(201).json({ message: `${created} tokens uploaded`, count: created })
      }

      if (!provider || !['roboneo', 'framia', 'weavy', 'createpulse', 'riverside'].includes(provider)) {
        return res.status(400).json({ error: 'Invalid provider' })
      }
      if (!name || !token_value) {
        return res.status(400).json({ error: 'Name and token_value are required' })
      }
      if (price === undefined || price < 0) {
        return res.status(400).json({ error: 'Valid price is required' })
      }

      const rows = await sql`INSERT INTO tokens (provider, name, token_value, price, credits, credit_group) VALUES (${provider}, ${name}, ${token_value}, ${price}, ${credits ?? null}, ${credit_group ?? null}) RETURNING *`
      return res.status(201).json({ token: rows[0] })
    }

    // PATCH /api/admin/tokens - update token
    if (req.method === 'PATCH' && last === 'tokens') {
      const { id, name, token_value, price, status, credits, credit_group } = req.body || {}
      if (!id) return res.status(400).json({ error: 'Token id is required' })

      if (status && ['available', 'sold'].includes(status)) {
        await sql`UPDATE tokens SET status = ${status}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
      }
      if (name) {
        await sql`UPDATE tokens SET name = ${name}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
      }
      if (token_value) {
        await sql`UPDATE tokens SET token_value = ${token_value}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
      }
      if (price !== undefined) {
        await sql`UPDATE tokens SET price = ${price}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
      }
      if (credits !== undefined) {
        await sql`UPDATE tokens SET credits = ${credits}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
      }
      if (credit_group !== undefined) {
        await sql`UPDATE tokens SET credit_group = ${credit_group}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
      }

      const rows = await sql`SELECT * FROM tokens WHERE id = ${id}`
      return res.status(200).json({ token: rows[0] })
    }

    // DELETE /api/admin/tokens/:id
    if (req.method === 'DELETE' && segments.includes('tokens')) {
      const idFromUrl = segments[segments.length - 1]
      const idFromBody = req.body?.id || req.query?.id
      const id = idFromBody || (idFromUrl && idFromUrl !== 'tokens' ? idFromUrl : null)
      if (!id) return res.status(400).json({ error: 'Token id is required' })

      await sql`DELETE FROM token_orders WHERE token_id = ${id}`
      await sql`DELETE FROM tokens WHERE id = ${id}`
      return res.status(200).json({ message: 'Token deleted' })
    }

    // POST /api/admin/tokens/bulk-update-price
    if (req.method === 'POST' && segments.includes('bulk-update-price')) {
      const { provider, price, status } = req.body || {}
      if (!provider || price === undefined || price < 0) {
        return res.status(400).json({ error: 'provider and valid price are required' })
      }

      if (status) {
        await sql`UPDATE tokens SET price = ${price}, updated_at = CURRENT_TIMESTAMP WHERE provider = ${provider} AND status = ${status}`
      } else {
        await sql`UPDATE tokens SET price = ${price}, updated_at = CURRENT_TIMESTAMP WHERE provider = ${provider}`
      }

      return res.status(200).json({ message: 'Tokens price updated' })
    }

    // POST /api/admin/tokens/bulk-delete
    if (req.method === 'POST' && segments.includes('bulk-delete')) {
      const { ids, provider, status } = req.body || {}

      let tokens: Record<string, any>[] = []

      if (ids && Array.isArray(ids) && ids.length > 0) {
        tokens = await sql`SELECT id FROM tokens WHERE id = ANY(${ids})`
      } else if (provider) {
        if (status) {
          tokens = await sql`SELECT id FROM tokens WHERE provider = ${provider} AND status = ${status}`
        } else {
          tokens = await sql`SELECT id FROM tokens WHERE provider = ${provider}`
        }
      } else {
        return res.status(400).json({ error: 'Provide ids array or provider (+ optional status)' })
      }

      if (tokens.length === 0) return res.status(404).json({ error: 'No tokens found' })

      const tokenIds = tokens.map(t => t.id)
      await sql`DELETE FROM token_orders WHERE token_id = ANY(${tokenIds})`
      await sql`DELETE FROM tokens WHERE id = ANY(${tokenIds})`

      return res.status(200).json({ message: `${tokens.length} tokens deleted`, count: tokens.length })
    }

    // GET /api/admin/tokens/orders
    if (req.method === 'GET' && segments.includes('orders')) {
      const rows = await sql`
        SELECT o.*, t.provider, t.name as token_name, t.token_value, t.price, u.email as user_email, u.name as user_name
        FROM token_orders o
        JOIN tokens t ON o.token_id = t.id
        JOIN users u ON o.user_id = u.id
        ORDER BY o.created_at DESC
      `

      const bulkMap = new Map<string, any>()
      for (const row of rows) {
        const bid = row.bulk_id || `single_${row.id}`
        if (!bulkMap.has(bid)) {
          bulkMap.set(bid, {
            bulk_id: bid,
            user_name: row.user_name,
            user_email: row.user_email,
            provider: row.provider,
            status: row.status,
            created_at: row.created_at,
            tokens: [],
            total_price: 0,
          })
        }
        const bulk = bulkMap.get(bid)!
        bulk.tokens.push({ id: row.token_id, name: row.token_name, token_value: row.token_value, price: row.price })
        bulk.total_price += row.price
      }

      return res.status(200).json({ orders: Array.from(bulkMap.values()) })
    }

    // PATCH /api/admin/tokens/orders
    if (req.method === 'PATCH' && segments.includes('orders')) {
      const { bulk_id, status } = req.body || {}
      if (!status || !['confirmed', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' })
      }

      const targetBulkId = bulk_id || ''
      if (!targetBulkId) {
        return res.status(400).json({ error: 'bulk_id is required' })
      }

      const orders = await sql`SELECT * FROM token_orders WHERE bulk_id = ${targetBulkId}`
      if (orders.length === 0) return res.status(404).json({ error: 'Orders not found' })

      await sql`UPDATE token_orders SET status = ${status} WHERE bulk_id = ${targetBulkId}`

      if (status === 'confirmed') {
        for (const o of orders) {
          await sql`UPDATE tokens SET status = 'sold', updated_at = CURRENT_TIMESTAMP WHERE id = ${o.token_id}`
        }
      } else if (status === 'rejected') {
        for (const o of orders) {
          await sql`UPDATE tokens SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = ${o.token_id}`
        }
      }

      return res.status(200).json({ message: `Orders ${status}` })
    }

    return res.status(404).json({ error: 'Not found' })
  } catch (err: any) {
    console.error('Admin tokens error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

// ─── Status Check (merged from api/admin/status.ts) ────────────────

interface ProviderStatus {
  name: string
  status: 'online' | 'slow' | 'offline' | 'no_config'
  latency: number | null
  message: string
  lastCheck: string
}

async function checkRoboneo(): Promise<ProviderStatus> {
  const start = Date.now()
  try {
    const res = await fetch('https://ai-engine-gateway-roboneo.meitu.com/roboneo/sync/request/vipshow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://www.roboneo.com',
        'Referer': 'https://www.roboneo.com/',
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10000),
    })
    const latency = Date.now() - start
    const data: any = await res.json()

    if (res.ok || data.error_code) {
      return {
        name: 'Roboneo',
        status: latency > 5000 ? 'slow' : 'online',
        latency,
        message: data.error_code ? `Error code: ${data.error_code}` : 'Server responds OK',
        lastCheck: new Date().toISOString(),
      }
    }

    return {
      name: 'Roboneo',
      status: 'offline',
      latency,
      message: `HTTP ${res.status}`,
      lastCheck: new Date().toISOString(),
    }
  } catch (err: any) {
    return {
      name: 'Roboneo',
      status: 'offline',
      latency: Date.now() - start,
      message: err.message || 'Connection failed',
      lastCheck: new Date().toISOString(),
    }
  }
}

async function checkFramia(): Promise<ProviderStatus> {
  const start = Date.now()
  try {
    const res = await fetch('https://aacreative.vercel.app/framia/video/api/v1/user/credits', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    const latency = Date.now() - start

    if (res.ok || res.status === 401 || res.status === 403 || res.status === 404) {
      return {
        name: 'Framia',
        status: latency > 5000 ? 'slow' : 'online',
        latency,
        message: res.ok ? 'Server responds OK' : `HTTP ${res.status} (server aktif, butuh API key)`,
        lastCheck: new Date().toISOString(),
      }
    }

    return {
      name: 'Framia',
      status: 'offline',
      latency,
      message: `HTTP ${res.status}`,
      lastCheck: new Date().toISOString(),
    }
  } catch (err: any) {
    return {
      name: 'Framia',
      status: 'offline',
      latency: Date.now() - start,
      message: err.message || 'Connection failed',
      lastCheck: new Date().toISOString(),
    }
  }
}

async function checkWeavy(): Promise<ProviderStatus> {
  const start = Date.now()
  try {
    const res = await fetch('https://app.weavy.ai', {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    })
    const latency = Date.now() - start

    if (res.ok || res.status === 403 || res.status === 401) {
      return {
        name: 'Weavy',
        status: latency > 5000 ? 'slow' : 'online',
        latency,
        message: res.ok ? 'Server OK' : `HTTP ${res.status} (server aktif, butuh login)`,
        lastCheck: new Date().toISOString(),
      }
    }

    return {
      name: 'Weavy',
      status: 'offline',
      latency,
      message: `HTTP ${res.status}`,
      lastCheck: new Date().toISOString(),
    }
  } catch (err: any) {
    return {
      name: 'Weavy',
      status: 'offline',
      latency: Date.now() - start,
      message: err.message || 'Connection failed',
      lastCheck: new Date().toISOString(),
    }
  }
}

async function checkCreatePulse(): Promise<ProviderStatus> {
  const start = Date.now()
  try {
    const res = await fetch('https://createpulse.online/api', {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    })
    const latency = Date.now() - start

    if (res.ok || res.status === 401 || res.status === 403 || res.status === 404) {
      return {
        name: 'CreatePulse',
        status: latency > 5000 ? 'slow' : 'online',
        latency,
        message: res.ok ? 'Server OK' : `HTTP ${res.status} (server aktif)`,
        lastCheck: new Date().toISOString(),
      }
    }

    return {
      name: 'CreatePulse',
      status: 'offline',
      latency,
      message: `HTTP ${res.status}`,
      lastCheck: new Date().toISOString(),
    }
  } catch (err: any) {
    return {
      name: 'CreatePulse',
      status: 'offline',
      latency: Date.now() - start,
      message: err.message || 'Connection failed',
      lastCheck: new Date().toISOString(),
    }
  }
}

async function handleStatusRoutes(_req: VercelRequest, res: VercelResponse) {
  try {
    const [roboneo, framia, weavy, createpulse] = await Promise.all([
      checkRoboneo(),
      checkFramia(),
      checkWeavy(),
      checkCreatePulse(),
    ])

    const allStatuses = [roboneo, framia, weavy, createpulse]
    const overallStatus = allStatuses.every(s => s.status === 'online')
      ? 'online'
      : allStatuses.some(s => s.status === 'offline')
        ? 'degraded'
        : 'partial'

    return res.status(200).json({
      overall: overallStatus,
      providers: allStatuses,
      checkedAt: new Date().toISOString(),
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

// ─── Maintenance Routes ────────────────────────────────────────────

async function handleMaintenanceRoutes(req: VercelRequest, res: VercelResponse) {
  try {
    const sql = getSql()

    // Ensure table exists
    await sql`CREATE TABLE IF NOT EXISTS provider_maintenance (
      id SERIAL PRIMARY KEY,
      provider TEXT UNIQUE NOT NULL,
      is_maintenance INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`

    // Seed providers if not exist
    const providers = ['weavy', 'wavespeed', 'magnific', 'roboneo', 'createpulse', 'framia', 'firefly', 'leonardo', 'gemini', 'openai', 'shotstack', 'creatomate', 'riverside', 'nexabot']
    for (const p of providers) {
      await sql`INSERT INTO provider_maintenance (provider, is_maintenance, message) VALUES (${p}, 0, '') ON CONFLICT (provider) DO NOTHING`
    }

    // GET /api/admin/maintenance - Get all maintenance statuses
    if (req.method === 'GET') {
      const rows = await sql`SELECT provider, is_maintenance, message, updated_at FROM provider_maintenance ORDER BY provider`
      return res.status(200).json({
        maintenance: rows.map(r => ({
          provider: r.provider,
          isMaintenance: !!r.is_maintenance,
          message: r.message,
          updatedAt: r.updated_at,
        }))
      })
    }

    // PATCH /api/admin/maintenance - Update maintenance status
    if (req.method === 'PATCH') {
      const { provider, isMaintenance, message } = req.body || {}
      if (!provider) {
        return res.status(400).json({ error: 'Provider is required' })
      }

      await sql`
        UPDATE provider_maintenance
        SET is_maintenance = ${isMaintenance ? 1 : 0},
            message = ${message || ''},
            updated_at = CURRENT_TIMESTAMP
        WHERE provider = ${provider}
      `

      return res.status(200).json({
        message: `Maintenance status updated for ${provider}`,
        provider,
        isMaintenance: !!isMaintenance,
        maintenanceMessage: message || '',
      })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err: any) {
    console.error('Maintenance error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

// ─── Konfigurasi harga NexaBot (per generate & paket Unlimited) ────────
// Harga hidup di `app_settings` dan dibaca oleh fungsi wallet (api/nexabot-wallet.ts)
// pada setiap charge, jadi ubah tarif di sini langsung berlaku tanpa deploy ulang.
// Bentuk, batas, dan validasinya ikut shared/pricing.ts supaya identik dengan
// sisi Express dan endpoint publik /api/public/pricing.

/** Baca harga efektif. Tanpa cache — halaman admin harus selalu lihat nilai asli. */
async function readNexabotPricing(sql: any): Promise<NexabotPricing> {
  const rows = await sql`SELECT key, value FROM app_settings WHERE key = ANY(${NEXABOT_PRICING_SETTING_KEYS})`
  const saved: Record<string, string> = {}
  for (const r of rows || []) saved[String(r.key)] = String(r.value)
  return parseNexabotPricing(saved)
}

async function handleNexabotConfigRoutes(req: VercelRequest, res: VercelResponse) {
  try {
    const sql = getSql()
    try { await sql`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)` } catch { /* table already exists */ }

    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true,
        pricing: await readNexabotPricing(sql),
        defaults: NEXABOT_PRICING_DEFAULTS,
        min_topup: 10000,
      })
    }

    if (req.method === 'PATCH') {
      const body = (req.body || {}) as Record<string, unknown>

      // Bentuk lama: field datar (varian pertama). Tetap didukung supaya tab
      // admin yang belum di-reload tidak ikut rusak.
      const patch: Record<string, number> = {}
      for (const key of Object.keys(NEXABOT_PRICING_DEFAULTS) as NexabotPricingField[]) {
        const raw = body[key]
        if (raw === undefined || raw === null || raw === '') continue
        const n = Number(raw)
        const error = validateNexabotPricing(key, n)
        if (error) return res.status(400).json({ error })
        patch[key] = Math.round(n)
      }

      // Bentuk baru: harga & durasi per varian paket.
      const packagesPatch: NexabotPackagesPatch = {}
      const rawPackages = body.packages
      if (rawPackages && typeof rawPackages === 'object' && !Array.isArray(rawPackages)) {
        for (const [slug, changes] of Object.entries(rawPackages as Record<string, unknown>)) {
          const plan = NEXABOT_PACKAGES.find((p) => p.slug === slug)
          if (!plan) return res.status(400).json({ error: `Paket tidak dikenal: ${slug}` })
          const source = (changes || {}) as Record<string, unknown>
          const entry: { price?: number; days?: number } = {}
          for (const field of ['price', 'days'] as const) {
            const raw = source[field]
            if (raw === undefined || raw === null || raw === '') continue
            const n = Number(raw)
            const error = validateNexabotPackageValue(field, n)
            if (error) return res.status(400).json({ error: `${plan.label}: ${error}` })
            entry[field] = Math.round(n)
          }
          if (Object.keys(entry).length > 0) packagesPatch[slug] = entry
        }
      }

      if (Object.keys(patch).length === 0 && Object.keys(packagesPatch).length === 0) {
        return res.status(400).json({ error: 'Tidak ada harga yang dikirim' })
      }

      for (const key of Object.keys(patch) as NexabotPricingField[]) {
        const value = patch[key]
        await sql`INSERT INTO app_settings (key, value, updated_at) VALUES (${NEXABOT_PRICING_KEYS[key]}, ${String(value)}, CURRENT_TIMESTAMP)
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
      }

      for (const [slug, changes] of Object.entries(packagesPatch)) {
        const plan = NEXABOT_PACKAGES.find((p) => p.slug === slug)!
        for (const field of ['price', 'days'] as const) {
          const value = changes[field]
          if (value === undefined) continue
          const key = field === 'price' ? plan.priceKey : plan.daysKey
          await sql`INSERT INTO app_settings (key, value, updated_at) VALUES (${key}, ${String(value)}, CURRENT_TIMESTAMP)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
        }
      }

      const pricing = await readNexabotPricing(sql)
      return res.status(200).json({
        ok: true,
        message: describeNexabotPricing(pricing),
        pricing,
      })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err: any) {
    console.error('NexaBot pricing error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

// ─── Konfirmasi pembayaran member ──────────────────────────────────────
async function handleMembershipRoutes(req: VercelRequest, res: VercelResponse) {
  const action = String(req.query.membership || '')
  const rawId = Number(req.query.id)

  try {
    // Konfigurasi harga membership
    if (action === 'config') {
      const sql = getSql()
      try { await sql`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)` } catch { /* table already exists */ }
      if (req.method === 'GET') {
        const rows = await sql`SELECT value FROM app_settings WHERE key = 'membership_fee'`
        const fee = Number(rows[0]?.value)
        return res.status(200).json({ ok: true, membershipFee: Number.isFinite(fee) && fee > 0 ? fee : 150000 })
      }
      if (req.method === 'PATCH') {
        const fee = Number(req.body?.membershipFee)
        if (!Number.isFinite(fee) || fee <= 0) {
          return res.status(400).json({ error: 'Nominal harus angka lebih dari 0' })
        }
        await sql`INSERT INTO app_settings (key, value, updated_at) VALUES ('membership_fee', ${String(fee)}, CURRENT_TIMESTAMP)
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
        return res.status(200).json({ ok: true, message: `Harga membership diubah menjadi Rp ${fee.toLocaleString('id-ID')}`, membershipFee: fee })
      }
      return res.status(405).json({ error: 'Method not allowed' })
    }

    if (req.method === 'GET') {
      const sql = getSql()
      const rows = await sql`
        SELECT mp.id, mp.user_id, mp.amount, mp.status, mp.proof_note, mp.admin_note, mp.created_at,
               u.email, u.name, u.approved AS user_approved
        FROM membership_payments mp
        JOIN users u ON u.id = mp.user_id
        ORDER BY CASE mp.status WHEN 'pending' THEN 0 ELSE 1 END, mp.created_at DESC
      `
      return res.status(200).json({
        payments: rows.map((p: any) => ({
          id: p.id, userId: p.user_id, amount: p.amount, status: p.status,
          proofNote: p.proof_note, adminNote: p.admin_note, createdAt: p.created_at,
          email: p.email, name: p.name, userApproved: !!p.user_approved,
        })),
      })
    }

    if (req.method === 'POST' && Number.isFinite(rawId)) {
      const sql = getSql()
      const pays = await sql`
        SELECT mp.id, mp.user_id, mp.status, u.email FROM membership_payments mp
        JOIN users u ON u.id = mp.user_id WHERE mp.id = ${rawId}
      `
      const payment = pays[0]
      if (!payment) return res.status(404).json({ error: 'Pembayaran tidak ditemukan' })

      if (action === 'approve') {
        if (payment.status === 'approved') {
          return res.status(400).json({ error: 'Pembayaran ini sudah disetujui' })
        }
        await sql`UPDATE membership_payments SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ${rawId}`
        await sql`UPDATE users SET approved = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${payment.user_id}`
        return res.status(200).json({ ok: true, message: `Pembayaran ${payment.email} disetujui & akun diaktifkan` })
      }

      if (action === 'reject') {
        const adminNote = String(req.body?.admin_note || '').slice(0, 500)
        await sql`UPDATE membership_payments SET status = 'rejected', admin_note = ${adminNote}, updated_at = CURRENT_TIMESTAMP WHERE id = ${rawId}`
        return res.status(200).json({ ok: true, message: `Pembayaran ${payment.email} ditolak` })
      }
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err: any) {
    console.error('Membership routes error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

// ─── Kirim ulang link verifikasi email ──────────────────────────────────
async function handleResendVerification(res: VercelResponse, id: number) {
  try {
    const sql = getSql()
    const rows = await sql`SELECT id, email, name, role, email_verified FROM users WHERE id = ${id}`
    const user = rows[0]
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.email_verified) return res.status(400).json({ error: 'Email user ini sudah terverifikasi' })

    const token = crypto.randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    await sql`UPDATE users SET email_verify_token = ${token}, email_verify_expires = ${expires} WHERE id = ${id}`

    const link = `${appUrl()}/api/auth/verify-email?token=${token}`
    const { sent } = await sendEmail({
      to: user.email,
      subject: 'Verifikasi Email — ARKXMotion Studio',
      text: `Halo ${user.name},\n\nKlik link berikut untuk memverifikasi email kamu:\n${link}\n\nLink berlaku 24 jam.\n— ARKXMotion Studio`,
      html: `<p>Halo <b>${user.name}</b>,</p><p>Klik tombol di bawah untuk memverifikasi email kamu:</p><p><a href="${link}" style="background:#E5A93B;color:#000;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Verifikasi Email</a></p><p>Atau buka link ini: <a href="${link}">${link}</a></p><p>Link berlaku 24 jam.</p>`,
    })

    return res.status(200).json({ ok: true, message: `Link verifikasi dikirim ke ${user.email}`, devVerifyLink: sent ? null : link })
  } catch (err: any) {
    console.error('Resend verification error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

// ─── Analytics ─────────────────────────────────────────────────────

async function handleAnalytics(_req: VercelRequest, res: VercelResponse) {
  try {
    const sql = getSql()
    const [userCount, logCount, creditSum, completedCount, failedCount, pendingCount] = await Promise.all([
      sql`SELECT COUNT(*) as c FROM users`,
      sql`SELECT COUNT(*) as c FROM generation_logs`,
      sql`SELECT COALESCE(SUM(credits),0) as c FROM generation_logs WHERE status = 'completed'`,
      sql`SELECT COUNT(*) as c FROM generation_logs WHERE status = 'completed'`,
      sql`SELECT COUNT(*) as c FROM generation_logs WHERE status = 'failed'`,
      sql`SELECT COUNT(*) as c FROM generation_logs WHERE status = 'pending'`,
    ])
    const byProvider = await sql`SELECT provider, COUNT(*) as count, COALESCE(SUM(credits),0) as credits, COUNT(CASE WHEN status='completed' THEN 1 END) as completed FROM generation_logs GROUP BY provider ORDER BY count DESC`
    const byModel = await sql`SELECT model, provider, COUNT(*) as count, COALESCE(SUM(credits),0) as credits FROM generation_logs GROUP BY model, provider ORDER BY count DESC LIMIT 20`
    const byDay = await sql`SELECT DATE(created_at) as day, COUNT(*) as count, COALESCE(SUM(credits),0) as credits FROM generation_logs GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 30`
    const topUsers = await sql`SELECT u.name, u.email, COUNT(g.id) as generations, COALESCE(SUM(g.credits),0) as credits FROM generation_logs g JOIN users u ON g.user_id = u.id GROUP BY g.user_id, u.name, u.email ORDER BY credits DESC LIMIT 10`

    return res.status(200).json({
      totalUsers: Number(userCount[0]?.c || 0),
      totalLogs: Number(logCount[0]?.c || 0),
      totalCredits: Number(creditSum[0]?.c || 0),
      completedCount: Number(completedCount[0]?.c || 0),
      failedCount: Number(failedCount[0]?.c || 0),
      pendingCount: Number(pendingCount[0]?.c || 0),
      byProvider, byModel, byDay, topUsers,
    })
  } catch (err: any) {
    console.error('[admin-analytics] error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

// ─── Activity Feed ─────────────────────────────────────────────────

async function handleActivity(req: VercelRequest, res: VercelResponse) {
  try {
    const sql = getSql()
    const limit = Math.min(Number(req.query.limit) || 20, 200)
    const offset = Math.max(0, Number(req.query.offset) || 0)
    const provider = req.query.provider as string | undefined
    const status = req.query.status as string | undefined
    const userId = req.query.user_id as string | undefined

    let logs: any[]
    if (provider && status && userId) {
      logs = await sql`SELECT g.*, u.name as user_name, u.email as user_email FROM generation_logs g LEFT JOIN users u ON g.user_id = u.id WHERE g.provider = ${provider} AND g.status = ${status} AND g.user_id = ${Number(userId)} ORDER BY g.created_at DESC LIMIT ${limit} OFFSET ${offset}`
    } else if (provider && status) {
      logs = await sql`SELECT g.*, u.name as user_name, u.email as user_email FROM generation_logs g LEFT JOIN users u ON g.user_id = u.id WHERE g.provider = ${provider} AND g.status = ${status} ORDER BY g.created_at DESC LIMIT ${limit} OFFSET ${offset}`
    } else if (provider && userId) {
      logs = await sql`SELECT g.*, u.name as user_name, u.email as user_email FROM generation_logs g LEFT JOIN users u ON g.user_id = u.id WHERE g.provider = ${provider} AND g.user_id = ${Number(userId)} ORDER BY g.created_at DESC LIMIT ${limit} OFFSET ${offset}`
    } else if (status && userId) {
      logs = await sql`SELECT g.*, u.name as user_name, u.email as user_email FROM generation_logs g LEFT JOIN users u ON g.user_id = u.id WHERE g.status = ${status} AND g.user_id = ${Number(userId)} ORDER BY g.created_at DESC LIMIT ${limit} OFFSET ${offset}`
    } else if (provider) {
      logs = await sql`SELECT g.*, u.name as user_name, u.email as user_email FROM generation_logs g LEFT JOIN users u ON g.user_id = u.id WHERE g.provider = ${provider} ORDER BY g.created_at DESC LIMIT ${limit} OFFSET ${offset}`
    } else if (status) {
      logs = await sql`SELECT g.*, u.name as user_name, u.email as user_email FROM generation_logs g LEFT JOIN users u ON g.user_id = u.id WHERE g.status = ${status} ORDER BY g.created_at DESC LIMIT ${limit} OFFSET ${offset}`
    } else if (userId) {
      logs = await sql`SELECT g.*, u.name as user_name, u.email as user_email FROM generation_logs g LEFT JOIN users u ON g.user_id = u.id WHERE g.user_id = ${Number(userId)} ORDER BY g.created_at DESC LIMIT ${limit} OFFSET ${offset}`
    } else {
      logs = await sql`SELECT g.*, u.name as user_name, u.email as user_email FROM generation_logs g LEFT JOIN users u ON g.user_id = u.id ORDER BY g.created_at DESC LIMIT ${limit} OFFSET ${offset}`
    }
    return res.status(200).json({ logs, limit, offset })
  } catch (err: any) {
    console.error('[admin-activity] error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

// ─── Credit Management Routes ──────────────────────────────────────

async function handleCreditsRoutes(req: VercelRequest, res: VercelResponse, segments: string[]) {
  try {
    const sql = getSql()

    // GET /api/admin/credits
    if (req.method === 'GET' && segments[segments.length - 1] === 'credits') {
      const tokens = await sql`SELECT id, provider, name, credits, credit_group, status, created_at, updated_at FROM tokens ORDER BY provider, name`
      const summary = await sql`SELECT provider, COUNT(*) as total, SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) as available, COALESCE(SUM(CASE WHEN credits IS NOT NULL THEN credits ELSE 0 END), 0) as total_credits FROM tokens GROUP BY provider ORDER BY provider`
      return res.status(200).json({ tokens, summary })
    }

    // GET /api/admin/credits/export
    if (req.method === 'GET' && segments.includes('export')) {
      const tokens = await sql`SELECT id, provider, name, credits, credit_group, status, created_at FROM tokens ORDER BY provider, name`
      const header = 'ID,Provider,Name,Credits,Credit Group,Status,Created At'
      const rows = tokens.map((t: any) => `${t.id},${t.provider},"${t.name}",${t.credits ?? ''},${t.credit_group || ''},${t.status},${t.created_at}`)
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="credits-${new Date().toISOString().slice(0, 10)}.csv"`)
      return res.status(200).send([header, ...rows].join('\n'))
    }

    // PATCH /api/admin/credits/:id
    if (req.method === 'PATCH' && segments[segments.length - 1] !== 'credits') {
      const tokenId = segments[segments.length - 1]
      const { credits, credit_group } = req.body || {}
      if (credits !== undefined) {
        await sql`UPDATE tokens SET credits = ${credits}, updated_at = CURRENT_TIMESTAMP WHERE id = ${tokenId}`
      }
      if (credit_group !== undefined) {
        await sql`UPDATE tokens SET credit_group = ${credit_group || null}, updated_at = CURRENT_TIMESTAMP WHERE id = ${tokenId}`
      }
      return res.status(200).json({ ok: true, message: 'Token updated' })
    }

    // POST /api/admin/credits/bulk
    if (req.method === 'POST' && segments.includes('bulk')) {
      const { ids, credits } = req.body || {}
      if (!Array.isArray(ids) || ids.length === 0 || credits === undefined) {
        return res.status(400).json({ error: 'Invalid ids or credits' })
      }
      for (const id of ids) {
        await sql`UPDATE tokens SET credits = ${credits}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`
      }
      return res.status(200).json({ ok: true, message: `${ids.length} token(s) credits set to ${credits}` })
    }

    // POST /api/admin/credits/sync
    if (req.method === 'POST' && segments.includes('sync')) {
      const { provider, updates } = req.body || {}
      if (!provider || !Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ error: 'Missing provider or updates' })
      }
      const tokens = await sql`SELECT id FROM tokens WHERE provider = ${provider} ORDER BY id`
      let synced = 0
      for (let i = 0; i < updates.length && i < tokens.length; i++) {
        if (typeof updates[i].credits === 'number') {
          await sql`UPDATE tokens SET credits = ${updates[i].credits}, updated_at = CURRENT_TIMESTAMP WHERE id = ${tokens[i].id}`
          synced++
        }
      }
      return res.status(200).json({ ok: true, synced })
    }

    // POST /api/admin/credits/reset
    if (req.method === 'POST' && segments.includes('reset')) {
      await sql`UPDATE tokens SET credits = 0, updated_at = CURRENT_TIMESTAMP`
      return res.status(200).json({ ok: true, message: 'All credits reset to 0' })
    }

    return res.status(404).json({ error: 'Credits route not found' })
  } catch (err: any) {
    console.error('[admin-credits] error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

// ─── System Settings Routes ────────────────────────────────────────

async function handleSettingsRoutes(req: VercelRequest, res: VercelResponse) {
  try {
    const sql = getSql()

    // Ensure tables exist
    await sql`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    await sql`CREATE TABLE IF NOT EXISTS provider_maintenance (id SERIAL PRIMARY KEY, provider TEXT UNIQUE NOT NULL, is_maintenance INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`

    // Seed providers
    const providers = ['weavy', 'wavespeed', 'magnific', 'roboneo', 'createpulse', 'framia', 'firefly', 'leonardo', 'gemini', 'openai', 'shotstack', 'creatomate', 'riverside', 'nexabot']
    for (const p of providers) {
      await sql`INSERT INTO provider_maintenance (provider, is_maintenance, message) VALUES (${p}, 0, '') ON CONFLICT (provider) DO NOTHING`
    }

    // GET /api/admin/settings
    if (req.method === 'GET') {
      const rows = await sql`SELECT key, value, updated_at FROM app_settings ORDER BY key`
      const settings: Record<string, string> = {}
      rows.forEach((r: any) => { settings[r.key] = r.value })
      const maintenance = await sql`SELECT provider, is_maintenance, message FROM provider_maintenance ORDER BY provider`
      return res.status(200).json({ settings, maintenance })
    }

    // PUT /api/admin/settings
    if (req.method === 'PUT') {
      const { settings, maintenance } = req.body || {}
      if (settings) {
        for (const [key, value] of Object.entries(settings)) {
          await sql`INSERT INTO app_settings (key, value, updated_at) VALUES (${key}, ${String(value)}, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = ${String(value)}, updated_at = CURRENT_TIMESTAMP`
        }
      }
      if (maintenance && Array.isArray(maintenance)) {
        for (const m of maintenance) {
          await sql`UPDATE provider_maintenance SET is_maintenance = ${m.is_maintenance ? 1 : 0}, message = ${m.message || ''} WHERE provider = ${m.provider}`
        }
      }
      return res.status(200).json({ ok: true, message: 'Settings updated' })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err: any) {
    console.error('[admin-settings] error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

// ─── System Health ─────────────────────────────────────────────────

async function handleHealth(_req: VercelRequest, res: VercelResponse) {
  try {
    const sql = getSql()
    const upSec = Math.round(process.uptime())
    const memTotal = (process as any).memoryUsage?.() || { heapTotal: 0, heapUsed: 0, rss: 0 }
    const rss = memTotal.rss || 0

    const [totalUsers, totalTokens, totalLogs, recentLogs, pendingPayments, pendingUsers] = await Promise.all([
      sql`SELECT COUNT(*) as c FROM users`,
      sql`SELECT COUNT(*) as c FROM tokens`,
      sql`SELECT COUNT(*) as c FROM generation_logs`,
      sql`SELECT COUNT(*) as c FROM generation_logs WHERE created_at >= NOW() - INTERVAL '24 hours'`,
      sql`SELECT COUNT(*) as c FROM membership_payments WHERE status = 'pending'`,
      sql`SELECT COUNT(*) as c FROM users WHERE approved = 0 AND role != 'admin'`,
    ])

    let maintenanceProviders: string[] = []
    try {
      const maint = await sql`SELECT provider FROM provider_maintenance WHERE is_maintenance = 1`
      maintenanceProviders = maint.map((m: any) => m.provider)
    } catch (e) { console.warn('[admin] Failed to fetch maintenance providers:', e) }

    return res.status(200).json({
      server: {
        uptime: upSec,
        uptimeFormatted: `${Math.floor(upSec / 86400)}d ${Math.floor((upSec % 86400) / 3600)}h ${Math.floor((upSec % 3600) / 60)}m`,
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      memory: {
        total: rss,
        used: rss,
        free: 0,
        percentUsed: 0,
        totalFormatted: `${Math.round(rss / 1024 / 1024)} MB (RSS)`,
        usedFormatted: `${Math.round(rss / 1024 / 1024)} MB (RSS)`,
      },
      cpu: {
        model: 'Serverless',
        cores: 1,
        loadAvg: [0, 0, 0],
      },
      database: {
        size: 0,
        sizeFormatted: 'Neon Postgres (serverless)',
        totalUsers: Number(totalUsers[0]?.c || 0),
        totalTokens: Number(totalTokens[0]?.c || 0),
        totalLogs: Number(totalLogs[0]?.c || 0),
        recentLogs24h: Number(recentLogs[0]?.c || 0),
      },
      queue: {
        pendingPayments: Number(pendingPayments[0]?.c || 0),
        pendingUsers: Number(pendingUsers[0]?.c || 0),
        maintenanceProviders,
      },
    })
  } catch (err: any) {
    console.error('[admin-health] error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

// ─── Notifications Routes ──────────────────────────────────────────

async function handleNotificationsRoutes(req: VercelRequest, res: VercelResponse, segments: string[]) {
  try {
    const sql = getSql()
    const last = segments[segments.length - 1]

    // Ensure table exists
    await sql`CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      target TEXT NOT NULL DEFAULT 'all',
      user_id INTEGER DEFAULT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`

    // GET /api/admin/notifications/unread
    if (req.method === 'GET' && last === 'unread') {
      const authHeader = req.headers.authorization || ''
      const token = authHeader.replace(/^Bearer\s+/i, '')
      let userId = 0
      let isAdmin = false
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any
        userId = decoded.id
        isAdmin = decoded.role === 'admin'
      } catch (e) { console.warn('[admin] Failed to verify token for unread count:', e) }
      let count: any[]
      if (isAdmin) {
        count = await sql`SELECT COUNT(*) as c FROM notifications WHERE read = 0 AND (target = 'all' OR target = 'admins')`
      } else {
        count = await sql`SELECT COUNT(*) as c FROM notifications WHERE read = 0 AND user_id = ${userId} AND (target = 'all' OR target = 'users')`
      }
      return res.status(200).json({ count: Number(count[0]?.c || 0) })
    }

    // GET /api/admin/notifications/mine
    if (req.method === 'GET' && last === 'mine') {
      const authHeader = req.headers.authorization || ''
      const token = authHeader.replace(/^Bearer\s+/i, '')
      let userId = 0
      let isAdmin = false
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any
        userId = decoded.id
        isAdmin = decoded.role === 'admin'
      } catch (e) { console.warn('[admin] Failed to verify token for mine notifications:', e) }
      const limit = Math.min(Number(req.query.limit) || 20, 100)
      let rows: any[]
      if (isAdmin) {
        rows = await sql`SELECT * FROM notifications WHERE (target = 'all' OR target = 'admins') ORDER BY created_at DESC LIMIT ${limit}`
      } else {
        rows = await sql`SELECT * FROM notifications WHERE user_id = ${userId} AND (target = 'all' OR target = 'users') ORDER BY created_at DESC LIMIT ${limit}`
      }
      const unread = await sql`SELECT COUNT(*) as c FROM notifications WHERE read = 0 AND (target = ${isAdmin ? 'admins' : 'users'} OR target = 'all')`
      return res.status(200).json({ notifications: rows, unread: Number(unread[0]?.c || 0) })
    }

    // POST /api/admin/notifications/clear-all
    if (req.method === 'POST' && last === 'clear-all') {
      await sql`DELETE FROM notifications`
      return res.status(200).json({ ok: true })
    }

    // POST /api/admin/notifications/broadcast
    if (req.method === 'POST' && last === 'broadcast') {
      const { title, message, type = 'announcement' } = req.body || {}
      if (!title || !message) return res.status(400).json({ error: 'Title and message are required' })
      const result = await sql`INSERT INTO notifications (title, message, type, target) VALUES (${title.slice(0, 200)}, ${message.slice(0, 2000)}, ${type}, 'all') RETURNING id`
      return res.status(201).json({ id: result[0]?.id, ok: true })
    }

    // PATCH /api/admin/notifications/:id/read
    if (req.method === 'PATCH' && last === 'read') {
      const notifId = segments[segments.length - 2]
      await sql`UPDATE notifications SET read = 1 WHERE id = ${notifId}`
      return res.status(200).json({ ok: true })
    }

    // DELETE /api/admin/notifications/:id
    if (req.method === 'DELETE' && last !== 'notifications' && last !== 'unread' && last !== 'mine' && last !== 'clear-all' && last !== 'broadcast') {
      await sql`DELETE FROM notifications WHERE id = ${last}`
      return res.status(200).json({ ok: true })
    }

    // GET /api/admin/notifications — list all
    if (req.method === 'GET' && last === 'notifications') {
      const limit = Math.min(Number(req.query.limit) || 50, 200)
      const offset = Number(req.query.offset) || 0
      const rows = await sql`SELECT n.*, u.email as user_email FROM notifications n LEFT JOIN users u ON n.user_id = u.id ORDER BY n.created_at DESC LIMIT ${limit} OFFSET ${offset}`
      const total = await sql`SELECT COUNT(*) as c FROM notifications`
      return res.status(200).json({ notifications: rows, total: Number(total[0]?.c || 0) })
    }

    // POST /api/admin/notifications — send
    if (req.method === 'POST' && last === 'notifications') {
      const { title, message, type = 'info', target = 'all', user_id = null } = req.body || {}
      if (!title || !message) return res.status(400).json({ error: 'Title and message are required' })
      const result = await sql`INSERT INTO notifications (title, message, type, target, user_id) VALUES (${title.slice(0, 200)}, ${message.slice(0, 2000)}, ${type}, ${target}, ${user_id || null}) RETURNING id`
      return res.status(201).json({ id: result[0]?.id, ok: true })
    }

    return res.status(404).json({ error: 'Notification route not found' })
  } catch (err: any) {
    console.error('[admin-notifications] error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
