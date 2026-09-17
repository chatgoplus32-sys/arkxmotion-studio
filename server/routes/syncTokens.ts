import { Router, Response } from 'express'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import db from '../db.js'

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

interface QueueRow {
  token: string
  kind: string
  source: string | null
  created_at: number
}

/**
 * Antrean credential dari extension, dipisah PER PENGGUNA dan disimpan di DB.
 *
 * Dua hal yang pernah salah di sini, keduanya sudah diperbaiki:
 *
 * 1. Antreannya dulu satu Map berkunci nama provider saja, dan seluruh route-nya
 *    terbuka tanpa identitas. Akibatnya `GET /api/sync-tokens/nexabot?full=1`
 *    mengembalikan cookie sesi nexabot.id milik pengguna yang barusan sync ke
 *    siapa pun yang memanggil — cukup satu kunjungan ke situs yang bisa memanggil
 *    endpoint itu — dan `POST`-nya juga terbuka, sehingga credential apa pun bisa
 *    disuntikkan ke antrean yang dipakai semua orang. Versi Vercel
 *    (api/sync-tokens.ts) sudah per user_id sejak awal; router ini disamakan
 *    dengannya supaya dev dan produksi berperilaku sama.
 *
 * 2. Antreannya dulu hanya hidup di memori proses. Setiap deploy me-restart
 *    server, dan cookie yang baru dikirim extension tapi belum sempat diambil
 *    poller app (interval 30 detik) ikut hilang — extension melaporkan sukses,
 *    pengguna tetap tidak bisa login, dan tidak ada yang melihat sebabnya.
 *    Sekarang antrean ditulis ke `sync_token_queue`, jadi ia melewati restart.
 *    Semua query di bawah WAJIB ter-scope `user_id`.
 */
const TOKEN_TTL_MS = 60 * 60 * 1000
const COOKIE_TTL_MS = 24 * 60 * 60 * 1000

/** Batas jumlah provider berbeda per pengguna — pengaman, bukan fitur. */
const MAX_PROVIDERS_PER_USER = 50
/** Token terbaru yang disimpan per provider; sisanya dipangkas dari yang terlama. */
const MAX_TOKENS_PER_PROVIDER = 10

/** Nama provider wajar; sisanya ditolak supaya kunci antrean tidak bisa diacak. */
const PROVIDER_PATTERN = /^[a-z0-9_-]{1,32}$/i

// Urutan token: terbaru dulu (created_at DESC, lalu id DESC sebagai pemecah seri
// untuk token yang dikirim pada milidetik yang sama).
const stmtPurge = db.prepare(
  `DELETE FROM sync_token_queue
   WHERE (kind = 'cookie' AND created_at < ?)
      OR (kind <> 'cookie' AND created_at < ?)`,
)
const stmtProvidersOfUser = db.prepare(
  'SELECT COUNT(DISTINCT provider) AS n FROM sync_token_queue WHERE user_id = ?',
)
const stmtTokensOfProvider = db.prepare(
  `SELECT token, kind, source, created_at FROM sync_token_queue
   WHERE user_id = ? AND provider = ? ORDER BY created_at DESC, id DESC`,
)
const stmtInsert = db.prepare(
  `INSERT OR IGNORE INTO sync_token_queue (user_id, provider, token, kind, source, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
)
const stmtTrim = db.prepare(
  `DELETE FROM sync_token_queue
   WHERE user_id = ? AND provider = ?
     AND id NOT IN (
       SELECT id FROM sync_token_queue
       WHERE user_id = ? AND provider = ?
       ORDER BY created_at DESC, id DESC LIMIT ?
     )`,
)
const stmtAllOfUser = db.prepare(
  `SELECT provider, token, kind, source, created_at FROM sync_token_queue
   WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
)
const stmtDeleteToken = db.prepare(
  'DELETE FROM sync_token_queue WHERE user_id = ? AND provider = ? AND token = ?',
)

/** Buang credential yang sudah kedaluwarsa (JWT 1 jam, cookie sesi 24 jam). */
function purgeExpiredTokens() {
  const now = Date.now()
  stmtPurge.run(now - COOKIE_TTL_MS, now - TOKEN_TTL_MS)
}

function providersOfUser(userId: number): number {
  return (stmtProvidersOfUser.get(userId) as { n: number }).n
}

function tokensOfProvider(userId: number, provider: string): QueueRow[] {
  return stmtTokensOfProvider.all(userId, provider) as QueueRow[]
}

// Purge berkala, terutama untuk baris yang tidak pernah dibaca lagi.
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

    // Provider baru hanya boleh menambah kalau kuota provider pengguna belum penuh.
    const sudahAda = tokensOfProvider(userId, provider).length > 0
    if (!sudahAda && providersOfUser(userId) >= MAX_PROVIDERS_PER_USER) {
      res.status(400).json({ error: `Terlalu banyak provider (maks ${MAX_PROVIDERS_PER_USER})` })
      return
    }

    // INSERT OR IGNORE: credential yang sama tidak digandakan (batasan unik
    // user_id+provider+token yang menjaga `exists` di bawah akurat).
    const hasil = stmtInsert.run(userId, provider, token, safeKind, source, Date.now())
    const exists = hasil.changes === 0

    if (!exists) {
      stmtTrim.run(userId, provider, userId, provider, MAX_TOKENS_PER_PROVIDER)
      console.log(`[Sync] New ${safeKind} for ${provider} → user ${userId} from ${source}`)
    }

    const jumlah = tokensOfProvider(userId, provider).length

    res.json({
      ok: true,
      provider,
      tokenCount: jumlah,
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

    const semua = stmtAllOfUser.all(userId) as (QueueRow & { provider: string })[]
    const allTokens: Record<string, unknown[]> = {}
    for (const row of semua) {
      if (!allTokens[row.provider]) allTokens[row.provider] = []
      allTokens[row.provider].push({
        token: row.token.slice(0, 20) + '...',
        kind: row.kind || 'token',
        timestamp: row.created_at,
        source: row.source,
      })
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

    const tokens = tokensOfProvider(userId, provider)

    res.json({
      ok: true,
      provider,
      tokens: tokens.map(t => ({
        token: full ? t.token : t.token.slice(0, 20) + '...',
        kind: t.kind || 'token',
        timestamp: t.created_at,
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

    const hasil = stmtDeleteToken.run(userId, provider, token)
    const remaining = tokensOfProvider(userId, provider).length

    console.log(`[Sync] Consumed token for ${provider} → user ${userId} (${hasil.changes} removed)`)
    res.json({ ok: true, removed: hasil.changes, remaining })
  } catch (error) {
    console.error('Consume sync token error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
