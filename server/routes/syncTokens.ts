import { Router, Response } from 'express'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'

const router = Router()

interface SyncTokenRequest {
  provider: string
  token: string
  source?: string // 'extension' | 'bookmarklet' | 'manual'
  /**
   * 'token' (default) = JWT / API key untuk field `key`.
   * 'cookie' = header Cookie session (NexaBot) → disimpan ke field `cookies`
   * key oleh auto-sync poller, bukan menimpa `key`.
   */
  kind?: 'token' | 'cookie'
}

interface PendingToken {
  token: string
  kind: 'token' | 'cookie'
  timestamp: number
  source: string
}

/**
 * Antrean credential dari extension, dipisah PER PENGGUNA.
 *
 * Sebelumnya satu Map berkunci nama provider saja, dan seluruh route-nya terbuka
 * tanpa identitas. Akibatnya `GET /api/sync-tokens/nexabot?full=1` mengembalikan
 * cookie sesi nexabot.id milik pengguna yang barusan sync ke siapa pun yang
 * memanggil — cukup satu kunjungan ke situs yang bisa memanggil endpoint itu —
 * dan `POST`-nya juga terbuka, sehingga credential apa pun bisa disuntikkan ke
 * antrean yang dipakai semua orang.
 *
 * Versi Vercel (api/sync-tokens.ts) sudah per user_id sejak awal; router ini
 * disamakan dengannya supaya dev dan produksi berperilaku sama. Bedanya hanya
 * tempat penyimpanan: di sini in-memory (hilang saat server restart), di sana
 * Postgres.
 */
const pendingTokens: Map<string, PendingToken[]> = new Map()

/** Kunci antrean: pengguna + provider, supaya tidak ada yang bisa saling lihat. */
function queueKey(userId: number, provider: string): string {
  return `${userId}\u0000${provider}`
}

// TTL: tokens expire after 1 hour (JWT) / 24 hours (cookie)
const TOKEN_TTL_MS = 60 * 60 * 1000
const COOKIE_TTL_MS = 24 * 60 * 60 * 1000

/** Batas jumlah provider berbeda per pengguna — pengaman memori, bukan fitur. */
const MAX_PROVIDERS_PER_USER = 50

/** Nama provider wajar; sisanya ditolak supaya kunci antrean tidak bisa diacak. */
const PROVIDER_PATTERN = /^[a-z0-9_-]{1,32}$/i

function purgeExpiredTokens() {
  const now = Date.now()
  for (const [key, tokens] of pendingTokens.entries()) {
    const fresh = tokens.filter(t => {
      const ttl = t.kind === 'cookie' ? COOKIE_TTL_MS : TOKEN_TTL_MS
      return now - t.timestamp < ttl
    })
    if (fresh.length === 0) {
      pendingTokens.delete(key)
    } else if (fresh.length !== tokens.length) {
      pendingTokens.set(key, fresh)
    }
  }
}

/** Jumlah provider berbeda yang dimiliki seorang pengguna. */
function providersOfUser(userId: number): number {
  const prefix = `${userId}\u0000`
  let count = 0
  for (const key of pendingTokens.keys()) {
    if (key.startsWith(prefix)) count += 1
  }
  return count
}

// Purge every 5 minutes
setInterval(purgeExpiredTokens, 5 * 60 * 1000).unref()

// ── Identitas wajib untuk SEMUA route di bawah ini ───────────────────────────
// Dipasang sekali di sini, bukan per route, supaya rute baru tidak bisa lahir
// tanpa identitas: `test/syncTokensAuth.test.ts` mengunci urutannya.
router.use(authenticateToken)

/**
 * POST /api/sync-tokens
 * Receive credential from browser extension (atas nama pengguna yang login).
 */
router.post('/', (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      res.status(401).json({ error: 'Access token required' })
      return
    }

    const { provider: rawProvider, token, source = 'extension', kind = 'token' }: SyncTokenRequest = req.body
    const provider = String(rawProvider || '').trim()

    if (!provider || !token) {
      res.status(400).json({ error: 'Missing provider or token' })
      return
    }
    if (!PROVIDER_PATTERN.test(provider)) {
      res.status(400).json({ error: 'Invalid provider name' })
      return
    }
    const safeKind: 'token' | 'cookie' = kind === 'cookie' ? 'cookie' : 'token'

    const key = queueKey(userId, provider)
    const isNewProvider = !pendingTokens.has(key)
    if (isNewProvider && providersOfUser(userId) >= MAX_PROVIDERS_PER_USER) {
      res.status(400).json({ error: `Terlalu banyak provider (maks ${MAX_PROVIDERS_PER_USER})` })
      return
    }

    if (isNewProvider) {
      pendingTokens.set(key, [])
    }

    const tokens = pendingTokens.get(key)!

    // Check if token already exists
    const exists = tokens.some(t => t.token === token)
    if (!exists) {
      tokens.unshift({
        token,
        kind: safeKind,
        timestamp: Date.now(),
        source,
      })

      // Keep only last 10 tokens per provider
      if (tokens.length > 10) {
        tokens.pop()
      }

      console.log(`[Sync] New ${safeKind} for ${provider} → user ${userId} from ${source}`)
    }

    res.json({
      ok: true,
      provider,
      tokenCount: tokens.length,
      message: exists ? 'Token already synced' : 'Token synced successfully',
    })
  } catch (error) {
    console.error('Sync token error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /api/sync-tokens/all
 * Ringkasan antrean MILIK PEMANGGIL (token di-mask).
 * HARUS didaftarkan sebelum `/:provider`, kalau tidak Express mencocokkan
 * "/all" sebagai nama provider dan endpoint ini selalu balas kosong.
 */
router.get('/all', (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      res.status(401).json({ error: 'Access token required' })
      return
    }

    purgeExpiredTokens()

    const allTokens: Record<string, any[]> = {}
    const prefix = `${userId}\u0000`

    for (const [key, tokens] of pendingTokens.entries()) {
      if (!key.startsWith(prefix)) continue
      const provider = key.slice(prefix.length)
      allTokens[provider] = tokens.map(t => ({
        token: t.token.slice(0, 20) + '...',
        kind: t.kind || 'token',
        timestamp: t.timestamp,
        source: t.source,
      }))
    }

    res.json({
      ok: true,
      tokens: allTokens,
      totalProviders: Object.keys(allTokens).length,
    })
  } catch (error) {
    console.error('Get all sync tokens error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /api/sync-tokens/:provider?full=1
 * Antrean milik pemanggil untuk satu provider.
 * Tokens are masked by default; pass full=1 to receive full values
 * (needed by the app's auto-sync poller to save the fresh JWT).
 */
router.get('/:provider', (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      res.status(401).json({ error: 'Access token required' })
      return
    }

    const provider = String(req.params.provider)
    const full = req.query.full === '1'
    purgeExpiredTokens()
    const tokens = pendingTokens.get(queueKey(userId, provider)) || []

    res.json({
      ok: true,
      provider,
      tokens: tokens.map(t => ({
        token: full ? t.token : t.token.slice(0, 20) + '...',
        kind: t.kind || 'token',
        timestamp: t.timestamp,
        source: t.source,
      })),
      count: tokens.length,
    })
  } catch (error) {
    console.error('Get sync tokens error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /api/sync-tokens/:provider/consume
 * Remove a specific token from the caller's queue after the app has saved it
 */
router.post('/:provider/consume', (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      res.status(401).json({ error: 'Access token required' })
      return
    }

    const provider = String(req.params.provider)
    const { token } = req.body
    if (!token) {
      res.status(400).json({ error: 'Missing token' })
      return
    }

    const key = queueKey(userId, provider)
    const tokens = pendingTokens.get(key)
    if (!tokens) {
      res.json({ ok: true, removed: 0 })
      return
    }

    const before = tokens.length
    const remaining = tokens.filter(t => t.token !== token)
    if (remaining.length === 0) {
      pendingTokens.delete(key)
    } else {
      pendingTokens.set(key, remaining)
    }

    console.log(`[Sync] Consumed token for ${provider} → user ${userId} (${before - remaining.length} removed)`)
    res.json({ ok: true, removed: before - remaining.length, remaining: remaining.length })
  } catch (error) {
    console.error('Consume sync token error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
