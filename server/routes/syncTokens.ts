import { Router, Response } from 'express'

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

// Store pending tokens from extensions (in-memory, resets on server restart)
const pendingTokens: Map<string, PendingToken[]> = new Map()

// TTL: tokens expire after 1 hour (JWT) / 24 hours (cookie)
const TOKEN_TTL_MS = 60 * 60 * 1000
const COOKIE_TTL_MS = 24 * 60 * 60 * 1000

function purgeExpiredTokens() {
  const now = Date.now()
  for (const [provider, tokens] of pendingTokens.entries()) {
    const fresh = tokens.filter(t => {
      const ttl = t.kind === 'cookie' ? COOKIE_TTL_MS : TOKEN_TTL_MS
      return now - t.timestamp < ttl
    })
    if (fresh.length === 0) {
      pendingTokens.delete(provider)
    } else if (fresh.length !== tokens.length) {
      pendingTokens.set(provider, fresh)
    }
  }
}

// Purge every 5 minutes
setInterval(purgeExpiredTokens, 5 * 60 * 1000).unref()

/**
 * POST /api/sync-tokens
 * Receive token from browser extension
 */
router.post('/', (req, res: Response) => {
  try {
    const { provider, token, source = 'extension', kind = 'token' }: SyncTokenRequest = req.body

    if (!provider || !token) {
      res.status(400).json({ error: 'Missing provider or token' })
      return
    }
    const safeKind: 'token' | 'cookie' = kind === 'cookie' ? 'cookie' : 'token'

    // Store in memory
    if (!pendingTokens.has(provider)) {
      pendingTokens.set(provider, [])
    }

    const tokens = pendingTokens.get(provider)!

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

      console.log(`[Sync] New ${safeKind} for ${provider} from ${source}`)
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
 * Get all pending tokens.
 * HARUS didaftarkan sebelum `/:provider`, kalau tidak Express mencocokkan
 * "/all" sebagai nama provider dan endpoint ini selalu balas kosong.
 */
router.get('/all', (_req, res: Response) => {
  try {
    const allTokens: Record<string, any[]> = {}

    for (const [provider, tokens] of pendingTokens.entries()) {
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
      totalProviders: pendingTokens.size,
    })
  } catch (error) {
    console.error('Get all sync tokens error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /api/sync-tokens/:provider?full=1
 * Get pending tokens for a provider.
 * Tokens are masked by default; pass full=1 to receive full values
 * (needed by the app's auto-sync poller to save the fresh JWT).
 */
router.get('/:provider', (req, res: Response) => {
  try {
    const { provider } = req.params
    const full = req.query.full === '1'
    purgeExpiredTokens()
    const tokens = pendingTokens.get(provider) || []

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
 * Remove a specific token from the queue after the app has saved it
 */
router.post('/:provider/consume', (req, res: Response) => {
  try {
    const { provider } = req.params
    const { token } = req.body
    if (!token) {
      res.status(400).json({ error: 'Missing token' })
      return
    }

    const tokens = pendingTokens.get(provider)
    if (!tokens) {
      res.json({ ok: true, removed: 0 })
      return
    }

    const before = tokens.length
    const remaining = tokens.filter(t => t.token !== token)
    if (remaining.length === 0) {
      pendingTokens.delete(provider)
    } else {
      pendingTokens.set(provider, remaining)
    }

    console.log(`[Sync] Consumed token for ${provider} (${before - remaining.length} removed)`)
    res.json({ ok: true, removed: before - remaining.length, remaining: remaining.length })
  } catch (error) {
    console.error('Consume sync token error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
