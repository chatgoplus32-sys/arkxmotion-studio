import { Router, Response } from 'express'
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.js'
import {
  AffiliateError,
  getAffiliateOverview,
  requestWithdrawal,
  listAdminWithdrawals,
  processWithdrawal,
} from '../lib/affiliate.js'

const router = Router()

/** Ringkasan afiliasi milik member yang login. */
router.get('/me', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    res.json(getAffiliateOverview(req.user!.id))
  } catch (error) {
    console.error('Affiliate me error:', error)
    res.status(500).json({ error: 'Gagal memuat data afiliasi' })
  }
})

/** Ajukan pencairan saldo afiliasi (diproses manual oleh admin). */
router.post('/withdraw', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const amount = Number(req.body?.amount)
    const id = requestWithdrawal(
      req.user!.id,
      amount,
      String(req.body?.destination ?? ''),
      String(req.body?.note ?? ''),
    )
    res.status(201).json({ ok: true, id })
  } catch (error) {
    if (error instanceof AffiliateError) return res.status(400).json({ error: error.message })
    console.error('Affiliate withdraw error:', error)
    res.status(500).json({ error: 'Gagal mengajukan pencairan' })
  }
})

/** Daftar pengajuan pencairan — admin. */
router.get('/admin/withdrawals', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    res.json({ items: listAdminWithdrawals(String(req.query.status ?? '')) })
  } catch (error) {
    console.error('Affiliate admin list error:', error)
    res.status(500).json({ error: 'Gagal memuat pengajuan' })
  }
})

/** Tandai pencairan lunas / tolak (saldo dikembalikan) — admin. */
router.post('/admin/withdrawals/:id/:action', authenticateToken, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const action = String(req.params.action)
    if (action !== 'paid' && action !== 'rejected') {
      return res.status(400).json({ error: 'Aksi tidak dikenal' })
    }
    const userId = processWithdrawal(Number(req.params.id), action, String(req.body?.admin_note ?? ''))
    res.json({ ok: true, userId })
  } catch (error) {
    if (error instanceof AffiliateError) return res.status(400).json({ error: error.message })
    console.error('Affiliate admin process error:', error)
    res.status(500).json({ error: 'Gagal memproses pengajuan' })
  }
})

export default router
