// ─── Auto-klaim hadiah harian RunningHub ───────────────────────────────────
// Token RunningHub milik pengguna hanya hidup di browser. Saat pengguna
// menyalakan klaim otomatis, token JWT dikirim ke sini SEKALI, lalu scheduler
// server yang mengklaim tiap hari — app tidak perlu terbuka.
//
// Endpoint di bawah WAJIB beridentitas (authenticateToken). Token tidak pernah
// dikembalikan: GET hanya memberi id akun yang dipotong + status klaim.
import { Router, Response } from 'express'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import {
  clearAutoClaimTokens,
  getAutoClaimStatus,
  isAutoClaimRunning,
  normalizeClaimTokens,
  replaceAutoClaimTokens,
  runAutoClaimForUser,
} from '../lib/runninghubDailyClaim.js'

const router = Router()
router.use(authenticateToken)

router.get('/', (req: AuthRequest, res: Response) => {
  const userId = req.user?.id
  if (!userId) return res.status(401).json({ error: 'Access token required' })
  try {
    res.json({ ok: true, ...getAutoClaimStatus(userId) })
  } catch (err: any) {
    console.error('[rh-claim] status gagal:', err?.message || err)
    res.status(500).json({ error: 'Gagal membaca status klaim otomatis' })
  }
})

/**
 * PUT { enabled, tokens }
 * enabled=false → hapus semua token pengguna (credential tidak disimpan lagi).
 * enabled=true  → ganti daftar token dengan `tokens` (JWT saja).
 */
router.put('/', (req: AuthRequest, res: Response) => {
  const userId = req.user?.id
  if (!userId) return res.status(401).json({ error: 'Access token required' })
  try {
    const enabled = req.body?.enabled !== false
    if (!enabled) {
      clearAutoClaimTokens(userId)
      return res.json({ ok: true, ...getAutoClaimStatus(userId) })
    }

    const tokens = normalizeClaimTokens(req.body?.tokens)
    replaceAutoClaimTokens(userId, tokens)
    res.json({
      ok: true,
      saved: tokens.length,
      ...getAutoClaimStatus(userId),
    })
  } catch (err: any) {
    console.error('[rh-claim] simpan token gagal:', err?.message || err)
    res.status(500).json({ error: 'Gagal menyimpan token klaim otomatis' })
  }
})

/** POST /run — tombol "Klaim sekarang". Berjalan di background; UI poll GET. */
router.post('/run', (req: AuthRequest, res: Response) => {
  const userId = req.user?.id
  if (!userId) return res.status(401).json({ error: 'Access token required' })
  try {
    const started = !isAutoClaimRunning(userId)
    if (started) {
      void runAutoClaimForUser(userId, { force: true }).catch((err) => {
        console.error('[rh-claim] run manual gagal:', err?.message || err)
      })
    }
    res.status(202).json({ ok: true, started, ...getAutoClaimStatus(userId) })
  } catch (err: any) {
    console.error('[rh-claim] run gagal:', err?.message || err)
    res.status(500).json({ error: 'Gagal memulai klaim otomatis' })
  }
})

export default router
