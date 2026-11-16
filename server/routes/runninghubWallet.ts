import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import {
  RUNNINGHUB_MIN_TOPUP,
  RUNNINGHUB_TOPUP_MAX,
  RUNNINGHUB_TOPUP_PRESETS,
} from '../../shared/pricing.js'
import { providerUnitCharge } from '../lib/providerPricing.js'
import { isAdminUser, keyEligibility } from '../lib/providerMasterKey.js'
import { nextUniqueCode } from '../lib/qrisPayment.js'
import { createBasunipayPayment } from '../lib/basunipay.js'

const router = Router()

// Saldo RunningHub dalam RUPIAH (sama seperti PosBot). Member top up → relay
// memasang token master dari pool operator dan memotong saldo per generate.
// Tarif flat Rp 1.500/generate untuk semua fitur (shared/pricing.ts).
router.get('/balance', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    let row = db.prepare('SELECT balance FROM runninghub_balance WHERE user_id = ?').get(userId) as { balance: number } | undefined
    if (!row) {
      db.prepare('INSERT INTO runninghub_balance (user_id, balance) VALUES (?, 0)').run(userId)
      row = { balance: 0 }
    }
    const kunciServer = keyEligibility('runninghub', userId)
    res.json({
      balance: row.balance,
      presets: RUNNINGHUB_TOPUP_PRESETS,
      min_topup: RUNNINGHUB_MIN_TOPUP,
      max_topup: RUNNINGHUB_TOPUP_MAX,
      charge: providerUnitCharge('runninghub'),
      server_key: { available: kunciServer.ok, reason: kunciServer.reason },
    })
  } catch (error) {
    console.error('Get runninghub balance error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/topup', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { amount, proof_note } = req.body
    const topupAmount = Math.round(Number(amount))
    if (!Number.isInteger(topupAmount) || topupAmount < RUNNINGHUB_MIN_TOPUP) {
      return res.status(400).json({ error: `Minimal topup Rp ${RUNNINGHUB_MIN_TOPUP.toLocaleString('id-ID')}` })
    }
    if (topupAmount > RUNNINGHUB_TOPUP_MAX) {
      return res.status(400).json({ error: `Maksimal topup Rp ${RUNNINGHUB_TOPUP_MAX.toLocaleString('id-ID')}` })
    }

    const { unique_code, amount_total } = nextUniqueCode(topupAmount)
    const result = db.prepare(
      'INSERT INTO runninghub_topup (user_id, amount, unique_code, amount_total, proof_note, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, topupAmount, unique_code, amount_total, proof_note || '', 'pending')
    const refId = Number(result.lastInsertRowid)

    const basunipay = await createBasunipayPayment({
      refTable: 'runninghub_topup',
      refId,
      userId,
      baseAmount: topupAmount,
      description: `Top up RunningHub — user #${userId}`,
    })

    const topup = db.prepare('SELECT * FROM runninghub_topup WHERE id = ?').get(refId)
    res.status(201).json({ topup, basunipay, message: 'Topup request submitted, waiting payment verification' })
  } catch (error) {
    console.error('Runninghub topup error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/topups/mine', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const topups = db.prepare('SELECT * FROM runninghub_topup WHERE user_id = ? ORDER BY created_at DESC').all(userId)
    res.json({ topups })
  } catch (error) {
    console.error('List my runninghub topups error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/deduct', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { model, quantity, batch_id } = req.body
    const units = Math.max(1, Math.min(50, Number(quantity) || 1))

    // Admin pemilik pool: tidak dipotong (relay juga melewati tiket untuk admin).
    // Usage tetap dicatat dengan cost 0 supaya jejak generate konsisten.
    const admin = isAdminUser(userId)
    const cost = admin ? 0 : providerUnitCharge('runninghub') * units

    let row = db.prepare('SELECT balance FROM runninghub_balance WHERE user_id = ?').get(userId) as { balance: number } | undefined
    if (!row) {
      db.prepare('INSERT INTO runninghub_balance (user_id, balance) VALUES (?, 0)').run(userId)
      row = { balance: 0 }
    }

    if (!admin && row.balance < cost) {
      return res.status(400).json({ error: 'Saldo RunningHub tidak cukup', balance: row.balance, required: cost })
    }

    if (cost > 0) {
      db.prepare('UPDATE runninghub_balance SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(cost, userId)
    }
    const insert = db.prepare('INSERT INTO runninghub_usage (user_id, model, cost, units, batch_id, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, model || '', cost, units, batch_id || '', 'used')

    const updated = db.prepare('SELECT balance FROM runninghub_balance WHERE user_id = ?').get(userId) as { balance: number }
    res.json({ balance: updated.balance, deducted: cost, usage_id: Number(insert.lastInsertRowid) })
  } catch (error) {
    console.error('Runninghub deduct error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/refund', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { batch_id, model, usage_id } = req.body

    let usage
    if (usage_id) {
      usage = db.prepare("SELECT * FROM runninghub_usage WHERE id = ? AND user_id = ? AND status = 'used'")
        .get(Number(usage_id), userId) as { id: number; cost: number } | undefined
    } else if (batch_id) {
      usage = db.prepare("SELECT * FROM runninghub_usage WHERE user_id = ? AND batch_id = ? AND status = 'used'")
        .get(userId, batch_id) as { id: number; cost: number } | undefined
    } else if (model) {
      usage = db.prepare("SELECT * FROM runninghub_usage WHERE user_id = ? AND model = ? AND status = 'used' ORDER BY id DESC LIMIT 1")
        .get(userId, model) as { id: number; cost: number } | undefined
    }

    if (!usage) return res.status(404).json({ error: 'Usage not found' })

    db.prepare('UPDATE runninghub_usage SET status = ? WHERE id = ?').run('refunded', usage.id)
    if (usage.cost > 0) {
      db.prepare('UPDATE runninghub_balance SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(usage.cost, userId)
    }

    const updated = db.prepare('SELECT balance FROM runninghub_balance WHERE user_id = ?').get(userId) as { balance: number }
    res.json({ balance: updated.balance, refunded: usage.cost })
  } catch (error) {
    console.error('Runninghub refund error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router