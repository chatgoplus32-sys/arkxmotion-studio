import type { VercelRequest, VercelResponse } from '@vercel/node'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { neon } from '@neondatabase/serverless'
import { sendEmail, appUrl } from './mailer.js'

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return neon(url)
}

const JWT_SECRET = process.env.JWT_SECRET || 'arkxmotion-studio-secret-key-2026'

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!verifyAdmin(req)) return res.status(403).json({ error: 'Admin access required' })

  try {
    // Ensure new columns exist
    const sql = getSql()
    try { await sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT NULL` } catch {}
    try { await sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS credit_group TEXT DEFAULT NULL` } catch {}

    const segments = getSegments(req)

    // /api/admin/topup/* routes
    if (segments.includes('topup') || segments.includes('topups')) {
      return handleTopupRoutes(req, res, segments)
    }

    // /api/admin/tokens/* routes
    if (segments.includes('tokens')) {
      return handleTokenRoutes(req, res, segments)
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
    } catch {}
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
    if (!new_password || new_password.length < 4) {
      return res.status(400).json({ error: 'Password minimal 4 karakter' })
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

async function handleTopupRoutes(req: VercelRequest, res: VercelResponse, segments: string[]) {
  try {
    const sql = getSql()
    const last = segments[segments.length - 1]

    // GET /api/admin/topup/pending
    if (req.method === 'GET' && last === 'pending') {
      const rows = await sql`
        SELECT t.*, u.email, u.name as user_name
        FROM createpulse_topup t
        JOIN users u ON t.user_id = u.id
        WHERE t.status = 'pending'
        ORDER BY t.created_at ASC
      `
      return res.status(200).json({ topups: rows })
    }

    // GET /api/admin/topup/all
    if (req.method === 'GET' && last === 'all') {
      const rows = await sql`
        SELECT t.*, u.email, u.name as user_name
        FROM createpulse_topup t
        JOIN users u ON t.user_id = u.id
        ORDER BY t.created_at DESC
      `
      return res.status(200).json({ topups: rows })
    }

    // PATCH /api/admin/topup/approve
    if (req.method === 'PATCH' && last === 'approve') {
      const { id, admin_note } = req.body || {}
      if (!id) return res.status(400).json({ error: 'Topup id required' })

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
      if (provider && ['roboneo', 'framia', 'weavy', 'createpulse'].includes(provider)) {
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
          } catch {}
        }
        return res.status(201).json({ message: `${created} tokens uploaded`, count: created })
      }

      if (!provider || !['roboneo', 'framia', 'weavy', 'createpulse'].includes(provider)) {
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
    const data = await res.json()

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
    const providers = ['weavy', 'wavespeed', 'magnific', 'roboneo', 'createpulse', 'framia', 'firefly', 'leonardo', 'gemini', 'openai', 'shotstack', 'creatomate']
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

// ─── Konfirmasi pembayaran member ──────────────────────────────────────
async function handleMembershipRoutes(req: VercelRequest, res: VercelResponse) {
  const action = String(req.query.membership || '')
  const rawId = Number(req.query.id)

  try {
    // Konfigurasi harga membership
    if (action === 'config') {
      const sql = getSql()
      try { await sql`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)` } catch {}
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
