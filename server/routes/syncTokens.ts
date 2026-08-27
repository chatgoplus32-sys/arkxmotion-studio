import { Router, Response } from 'express'

const router = Router()

interface SyncTokenRequest {
  provider: string
  token: string
  source?: string // 'extension' | 'bookmarklet' | 'manual'
}

// Store pending tokens from extensions (in-memory, resets on server restart)
const pendingTokens: Map<string, { token: string; timestamp: number; source: string }[]> = new Map()

/**
 * POST /api/sync-tokens
 * Receive token from browser extension
 */
router.post('/', (req, res: Response) => {
  try {
    const { provider, token, source = 'extension' }: SyncTokenRequest = req.body

    if (!provider || !token) {
      res.status(400).json({ error: 'Missing provider or token' })
      return
    }

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
        timestamp: Date.now(),
        source,
      })

      // Keep only last 10 tokens per provider
      if (tokens.length > 10) {
        tokens.pop()
      }

      console.log(`[Sync] New token for ${provider} from ${source}`)
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
 * GET /api/sync-tokens/:provider
 * Get pending tokens for a provider
 */
router.get('/:provider', (req, res: Response) => {
  try {
    const { provider } = req.params
    const tokens = pendingTokens.get(provider) || []

    res.json({
      ok: true,
      provider,
      tokens: tokens.map(t => ({
        token: t.token.slice(0, 20) + '...', // Mask token for security
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
 * GET /api/sync-tokens/all
 * Get all pending tokens
 */
router.get('/all', (_req, res: Response) => {
  try {
    const allTokens: Record<string, any[]> = {}

    for (const [provider, tokens] of pendingTokens.entries()) {
      allTokens[provider] = tokens.map(t => ({
        token: t.token.slice(0, 20) + '...',
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

export default router
