import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import { CREATEPULSE_MIN_TOPUP } from '../../shared/pricing.js'
import { providerUnitCharge } from '../lib/providerPricing.js'
import { nextUniqueCode } from '../lib/qrisPayment.js'
import { createBasunipayPayment } from '../lib/basunipay.js'
import { walletUserIdFor } from '../lib/effectiveWallet.js'

const router = Router()

router.get('/balance', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    // Akun add-on dengan mode 'parent' memakai saldo akun utama.
    const walletUserId = walletUserIdFor(userId)

    let row = db.prepare('SELECT balance FROM createpulse_balance WHERE user_id = ?').get(walletUserId) as { balance: number } | undefined
    if (!row) {
      db.prepare('INSERT INTO createpulse_balance (user_id, balance) VALUES (?, 0)').run(walletUserId)
      row = { balance: 0 }
    }
    res.json({ balance: row.balance })
  } catch (error) {
    console.error('Get balance error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/topup', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { amount, proof_note } = req.body
    if (!amount || amount < CREATEPULSE_MIN_TOPUP) {
      return res.status(400).json({ error: `Minimal topup Rp ${CREATEPULSE_MIN_TOPUP.toLocaleString('id-ID')}` })
    }

    // Kode unik 3 digit → nominal bayar tepat (amount_total) untuk pencocokan
    // otomatis email notifikasi. Lihat server/lib/qrisPayment.ts.
    const { unique_code, amount_total } = nextUniqueCode(amount)

    const result = db.prepare(
      'INSERT INTO createpulse_topup (user_id, amount, unique_code, amount_total, proof_note, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, amount, unique_code, amount_total, proof_note || '', 'pending')
    const refId = Number(result.lastInsertRowid)

    const basunipay = await createBasunipayPayment({
      refTable: 'createpulse_topup',
      refId,
      userId,
      baseAmount: amount,
      description: `Top up CreatePulse — user #${userId}`,
    })

    const topup = db.prepare('SELECT * FROM createpulse_topup WHERE id = ?').get(refId)
    res.status(201).json({ topup, basunipay, message: 'Topup request submitted, waiting admin approval' })
  } catch (error) {
    console.error('Topup error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/topups/mine', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const topups = db.prepare(
      'SELECT * FROM createpulse_topup WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId)
    res.json({ topups })
  } catch (error) {
    console.error('List my topups error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/deduct', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const walletUserId = walletUserIdFor(userId)

    const { model, batch_id } = req.body
    // Tarif per model ada di shared/pricing.ts — sama dengan yang dipakai
    // endpoint publik /api/public/pricing, jadi angka yang ditampilkan ke user
    // tidak bisa berbeda dari yang benar-benar dipotong di sini.
    const cost = providerUnitCharge('createpulse', model)

    let row = db.prepare('SELECT balance FROM createpulse_balance WHERE user_id = ?').get(walletUserId) as { balance: number } | undefined
    if (!row) {
      db.prepare('INSERT INTO createpulse_balance (user_id, balance) VALUES (?, 0)').run(walletUserId)
      row = { balance: 0 }
    }

    if (row.balance < cost) {
      return res.status(400).json({ error: 'Saldo tidak cukup', balance: row.balance, required: cost })
    }

    db.prepare('UPDATE createpulse_balance SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(cost, walletUserId)
    const insert = db.prepare('INSERT INTO createpulse_usage (user_id, model, cost, batch_id, status) VALUES (?, ?, ?, ?, ?)').run(walletUserId, model, cost, batch_id || '', 'used')

    const updated = db.prepare('SELECT balance FROM createpulse_balance WHERE user_id = ?').get(walletUserId) as { balance: number }
    res.json({ balance: updated.balance, deducted: cost, usage_id: Number(insert.lastInsertRowid) })
  } catch (error) {
    console.error('Deduct error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/refund', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const walletUserId = walletUserIdFor(userId)

    const { batch_id, model, usage_id } = req.body

    let usage
    if (usage_id != null) {
      const id = Number(usage_id)
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'usage_id tidak valid' })
      usage = db.prepare(
        "SELECT * FROM createpulse_usage WHERE id = ? AND user_id = ? AND status = 'used'"
      ).get(id, walletUserId) as { id: number; cost: number } | undefined
    } else if (batch_id) {
      usage = db.prepare(
        "SELECT * FROM createpulse_usage WHERE user_id = ? AND batch_id = ? AND status = 'used'"
      ).get(walletUserId, batch_id) as { id: number; cost: number } | undefined
    } else if (model) {
      usage = db.prepare(
        "SELECT * FROM createpulse_usage WHERE user_id = ? AND model = ? AND status = 'used' ORDER BY id DESC LIMIT 1"
      ).get(walletUserId, model) as { id: number; cost: number } | undefined
    }

    if (!usage) return res.status(404).json({ error: 'Usage not found' })

    db.prepare('UPDATE createpulse_usage SET status = ? WHERE id = ?').run('refunded', usage.id)
    db.prepare('UPDATE createpulse_balance SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(usage.cost, walletUserId)

    const updated = db.prepare('SELECT balance FROM createpulse_balance WHERE user_id = ?').get(walletUserId) as { balance: number }
    res.json({ balance: updated.balance, refunded: usage.cost })
  } catch (error) {
    console.error('Refund error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
