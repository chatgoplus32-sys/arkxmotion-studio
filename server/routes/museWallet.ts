import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import { MUSE_MIN_TOPUP } from '../../shared/pricing.js'
import { providerUnitCharge } from '../lib/providerPricing.js'
import { nextUniqueCode } from '../lib/qrisPayment.js'
import { createVelianpayPayment } from '../lib/velianpay.js'
import { walletUserIdFor } from '../lib/effectiveWallet.js'

const router = Router()

router.get('/balance', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const walletUserId = walletUserIdFor(userId)
    let row = db.prepare('SELECT balance FROM muse_balance WHERE user_id = ?').get(walletUserId) as { balance: number } | undefined
    if (!row) {
      db.prepare('INSERT INTO muse_balance (user_id, balance) VALUES (?, 0)').run(walletUserId)
      row = { balance: 0 }
    }
    res.json({ balance: row.balance })
  } catch (error) {
    console.error('Muse balance error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/topup', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const { amount, proof_note } = req.body
    if (!amount || amount < MUSE_MIN_TOPUP) {
      return res.status(400).json({ error: `Minimal topup Rp ${MUSE_MIN_TOPUP.toLocaleString('id-ID')}` })
    }
    const { unique_code, amount_total } = nextUniqueCode(amount)
    const result = db.prepare(
      'INSERT INTO muse_topup (user_id, amount, unique_code, amount_total, proof_note, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, amount, unique_code, amount_total, proof_note || '', 'pending')
    const refId = Number(result.lastInsertRowid)
    const velianpay = await createVelianpayPayment({
      refTable: 'muse_topup',
      refId,
      userId,
      baseAmount: amount,
      description: `Top up MuseAI — user #${userId}`,
    })
    const topup = db.prepare('SELECT * FROM muse_topup WHERE id = ?').get(refId)
    res.status(201).json({ topup, velianpay, message: 'Topup diajukan — bayar QRIS VelianPay, saldo otomatis masuk' })
  } catch (error) {
    console.error('Muse topup error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/topups/mine', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    res.json({ topups: db.prepare('SELECT * FROM muse_topup WHERE user_id = ? ORDER BY created_at DESC').all(userId) })
  } catch (error) {
    console.error('Muse topups error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/deduct', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const walletUserId = walletUserIdFor(userId)
    const { model, kind, batch_id } = req.body
    const cost = providerUnitCharge('muse', model)

    let row = db.prepare('SELECT balance FROM muse_balance WHERE user_id = ?').get(walletUserId) as { balance: number } | undefined
    if (!row) {
      db.prepare('INSERT INTO muse_balance (user_id, balance) VALUES (?, 0)').run(walletUserId)
      row = { balance: 0 }
    }
    if (row.balance < cost) {
      return res.status(400).json({ error: 'Saldo MuseAI tidak cukup', balance: row.balance, required: cost })
    }

    db.prepare('UPDATE muse_balance SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(cost, walletUserId)
    const insert = db.prepare('INSERT INTO muse_usage (user_id, model, kind, cost, batch_id, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run(walletUserId, model || '', kind || 'video', cost, batch_id || '', 'used')

    const updated = db.prepare('SELECT balance FROM muse_balance WHERE user_id = ?').get(walletUserId) as { balance: number }
    res.json({ balance: updated.balance, deducted: cost, usage_id: Number(insert.lastInsertRowid) })
  } catch (error) {
    console.error('Muse deduct error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/refund', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const walletUserId = walletUserIdFor(userId)
    const { batch_id, usage_id, model } = req.body

    let usage
    if (usage_id != null) {
      const id = Number(usage_id)
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'usage_id tidak valid' })
      usage = db.prepare("SELECT * FROM muse_usage WHERE id = ? AND user_id = ? AND status = 'used'").get(id, walletUserId) as { id: number; cost: number } | undefined
    } else if (batch_id) {
      usage = db.prepare("SELECT * FROM muse_usage WHERE user_id = ? AND batch_id = ? AND status = 'used'").get(walletUserId, batch_id) as { id: number; cost: number } | undefined
    } else if (model) {
      usage = db.prepare("SELECT * FROM muse_usage WHERE user_id = ? AND model = ? AND status = 'used' ORDER BY id DESC LIMIT 1").get(walletUserId, model) as { id: number; cost: number } | undefined
    }
    if (!usage) return res.status(404).json({ error: 'Usage not found' })

    db.prepare('UPDATE muse_usage SET status = ? WHERE id = ?').run('refunded', usage.id)
    db.prepare('UPDATE muse_balance SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(usage.cost, walletUserId)
    const updated = db.prepare('SELECT balance FROM muse_balance WHERE user_id = ?').get(walletUserId) as { balance: number }
    res.json({ balance: updated.balance, refunded: usage.cost })
  } catch (error) {
    console.error('Muse refund error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
