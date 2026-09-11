import type { VercelRequest, VercelResponse } from '@vercel/node'
import jwt from 'jsonwebtoken'
import { neon } from '@neondatabase/serverless'

// ─── Sync credential dari extension (produksi) ───────────────────────────────
// Extension (NexaBot/Riverside/dll) mengirim credential terbaru ke sini, app
// polling lalu mengambilnya dan menyimpannya ke localStorage.
//
// BEDA dari versi lokal (`server/routes/syncTokens.ts`, queue in-memory):
//  - function Vercel stateless & bisa berganti instance → simpan di Postgres.
//  - endpoint ini publik → WAJIB JWT user, dan credential disimpan per user_id
//    supaya tidak ada orang lain yang bisa menarik cookie/API key orang lain.
//  - ekstensi mengambil JWT itu otomatis dari tab app yang sedang login (izin
//    user sendiri), jadi user tidak perlu paste apa pun.

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return neon(url)
}

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('JWT_SECRET env var is required')

/** Credential basi dibuang — sesi/JWT provider biasanya berumur jauh lebih pendek. */
const CREDENTIAL_TTL_HOURS = 24

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function verifyUser(req: VercelRequest): { id: number; email: string; role: string } | null {
  const authHeader = req.headers['authorization']
  const token = Array.isArray(authHeader) ? authHeader[0] : authHeader
  const bearer = token && token.split(' ')[1]
  if (!bearer) return null
  try {
    const payload = jwt.verify(bearer, JWT_SECRET as string)
    return payload as unknown as { id: number; email: string; role: string }
  } catch {
    return null
  }
}

let tableReady = false

async function ensureTable(sql: ReturnType<typeof getSql>) {
  if (tableReady) return
  await sql`CREATE TABLE IF NOT EXISTS sync_credentials (
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    token TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'token',
    source TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, provider)
  )`
  tableReady = true
}

function mask(token: string) {
  return token.length > 24 ? token.slice(0, 20) + '...' : token
}

function tsOf(value: any): number {
  const t = value ? new Date(value).getTime() : Date.now()
  return Number.isFinite(t) ? t : Date.now()
}

/**
 * Sub-path bisa datang dalam dua bentuk: `req.url` masih memuat path asli
 * (rewrite gaya `/api/tokens/*`), atau Vercel meneruskan lewat `?path=`.
 */
export function subPath(req: VercelRequest): string[] {
  // `?path=nexabot/consume` sudah berupa sub-path, jadi tidak perlu dicari lagi.
  const fromQuery = typeof req.query.path === 'string' ? req.query.path : ''
  if (fromQuery) return fromQuery.split('/').filter(Boolean)

  const segments = (req.url?.split('?')[0] || '').split('/').filter(Boolean)
  const idx = segments.lastIndexOf('sync-tokens')
  return idx >= 0 ? segments.slice(idx + 1) : []
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = verifyUser(req)
  if (!user) {
    return res.status(401).json({
      ok: false,
      error: 'Butuh login app (Authorization: Bearer). Extension mengambil izin ini otomatis dari tab app yang terbuka.',
    })
  }

  try {
    const sql = getSql()
    await ensureTable(sql)

    const sub = subPath(req)
    const providerFromQuery = typeof req.query.provider === 'string' ? req.query.provider : ''
    const full = req.query.full === '1'

    // ── POST /api/sync-tokens — extension mengirim credential ──
    if (req.method === 'POST' && sub.length === 0) {
      const body = req.body || {}
      const provider = String(body.provider || providerFromQuery || '').trim()
      const token = typeof body.token === 'string' ? body.token : ''
      const kind = body.kind === 'cookie' ? 'cookie' : 'token'
      const source = String(body.source || 'extension').slice(0, 80)

      if (!provider || !token) {
        return res.status(400).json({ ok: false, error: 'Missing provider or token' })
      }

      // Satu baris per (user, provider): credential terbaru selalu menang.
      await sql`INSERT INTO sync_credentials (user_id, provider, token, kind, source, updated_at)
        VALUES (${user.id}, ${provider}, ${token}, ${kind}, ${source}, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, provider) DO UPDATE SET
          token = ${token}, kind = ${kind}, source = ${source}, updated_at = CURRENT_TIMESTAMP`

      await sql`DELETE FROM sync_credentials WHERE updated_at < NOW() - (${CREDENTIAL_TTL_HOURS} * INTERVAL '1 hour')`

      console.log(`[sync-tokens] ${kind} for ${provider} → user ${user.id} (${source})`)
      return res.status(200).json({
        ok: true,
        provider,
        kind,
        message: 'Credential diterima — app mengambilnya maksimal 10 detik lagi',
      })
    }

    // ── GET /api/sync-tokens/all — ringkasan (token di-mask) ──
    if (req.method === 'GET' && sub[0] === 'all') {
      const rows: Record<string, any>[] = await sql`SELECT provider, token, kind, source, updated_at FROM sync_credentials WHERE user_id = ${user.id}`
      const tokens: Record<string, any[]> = {}
      for (const r of rows) {
        if (!tokens[r.provider]) tokens[r.provider] = []
        tokens[r.provider].push({
          token: mask(r.token),
          kind: r.kind || 'token',
          timestamp: tsOf(r.updated_at),
          source: r.source || '',
        })
      }
      return res.status(200).json({ ok: true, tokens, totalProviders: Object.keys(tokens).length })
    }

    // ── POST /api/sync-tokens/:provider/consume — app sudah menyimpannya ──
    if (req.method === 'POST' && sub.length === 2 && sub[1] === 'consume') {
      const provider = sub[0]
      const token = typeof req.body?.token === 'string' ? req.body.token : ''
      const removed: Record<string, any>[] = token
        ? await sql`DELETE FROM sync_credentials WHERE user_id = ${user.id} AND provider = ${provider} AND token = ${token} RETURNING provider`
        : await sql`DELETE FROM sync_credentials WHERE user_id = ${user.id} AND provider = ${provider} RETURNING provider`
      return res.status(200).json({ ok: true, removed: removed.length })
    }

    // ── GET /api/sync-tokens/:provider?full=1 — app polling ──
    const provider = sub[0] || providerFromQuery
    if (req.method === 'GET' && provider && provider !== 'all') {
      const rows: Record<string, any>[] = await sql`SELECT token, kind, source, updated_at FROM sync_credentials WHERE user_id = ${user.id} AND provider = ${provider}`
      return res.status(200).json({
        ok: true,
        provider,
        tokens: rows.map((r) => ({
          token: full ? r.token : mask(r.token),
          kind: r.kind || 'token',
          timestamp: tsOf(r.updated_at),
          source: r.source || '',
        })),
        count: rows.length,
      })
    }

    return res.status(404).json({ ok: false, error: 'Not found' })
  } catch (err: any) {
    console.error('[sync-tokens] error:', err?.message || err)
    return res.status(500).json({ ok: false, error: err?.message || 'Internal server error' })
  }
}
