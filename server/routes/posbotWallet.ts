import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import { POSBOT_MIN_TOPUP, POSBOT_TOPUP_MAX, POSBOT_TOPUP_PRESETS, getPosbotCharge } from '../../shared/pricing.js'
import { keyEligibility } from '../lib/providerMasterKey.js'

const router = Router()

// Sistem saldo PosBot sama dengan Seavi (saldo di server, dipotong per generate,
// relay memasang kunci server dengan tiket pembayaran). Bedanya satuan: PosBot
// dihitung dalam RUPIAH, bukan token, mengikuti tarif developer upstream.
router.get('/balance', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    let row = db.prepare('SELECT balance FROM posbot_balance WHERE user_id = ?').get(userId) as { balance: number } | undefined
    if (!row) {
      db.prepare('INSERT INTO posbot_balance (user_id, balance) VALUES (?, 0)').run(userId)
      row = { balance: 0 }
    }
    // Relay boleh memakai kunci server untuk member ini? UI memakai jawaban
    // server apa adanya, bukan menebak dari saldo di browser.
    const kunciServer = keyEligibility('posbot', userId)
    res.json({
      balance: row.balance,
      presets: POSBOT_TOPUP_PRESETS,
      min_topup: POSBOT_MIN_TOPUP,
      max_topup: POSBOT_TOPUP_MAX,
      server_key: { available: kunciServer.ok, reason: kunciServer.reason },
    })
  } catch (error) {
    console.error('Get posbot balance error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/topup', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { amount, proof_note } = req.body
    const topupAmount = Math.round(Number(amount))
    if (!Number.isInteger(topupAmount) || topupAmount < POSBOT_MIN_TOPUP) {
      return res.status(400).json({ error: `Minimal topup Rp ${POSBOT_MIN_TOPUP.toLocaleString('id-ID')}` })
    }
    if (topupAmount > POSBOT_TOPUP_MAX) {
      return res.status(400).json({ error: `Maksimal topup Rp ${POSBOT_TOPUP_MAX.toLocaleString('id-ID')}` })
    }

    const result = db.prepare(
      'INSERT INTO posbot_topup (user_id, amount, proof_note, status) VALUES (?, ?, ?, ?)'
    ).run(userId, topupAmount, proof_note || '', 'pending')

    const topup = db.prepare('SELECT * FROM posbot_topup WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ topup, message: 'Topup request submitted, waiting admin approval' })
  } catch (error) {
    console.error('Posbot topup error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/topups/mine', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const topups = db.prepare(
      'SELECT * FROM posbot_topup WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId)
    res.json({ topups })
  } catch (error) {
    console.error('List my posbot topups error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/deduct', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { model, quantity, batch_id } = req.body
    // Tarif per model (Rp) ada di shared/pricing.ts — sama dengan yang dipakai
    // katalog UI, jadi angka yang ditampilkan tidak bisa berbeda dari yang dipotong.
    const units = Math.max(1, Math.min(50, Number(quantity) || 1))
    const cost = getPosbotCharge(model) * units

    let row = db.prepare('SELECT balance FROM posbot_balance WHERE user_id = ?').get(userId) as { balance: number } | undefined
    if (!row) {
      db.prepare('INSERT INTO posbot_balance (user_id, balance) VALUES (?, 0)').run(userId)
      row = { balance: 0 }
    }

    if (row.balance < cost) {
      return res.status(400).json({ error: 'Saldo PosBot tidak cukup', balance: row.balance, required: cost })
    }

    db.prepare('UPDATE posbot_balance SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(cost, userId)
    // `units` = jumlah job yang dibayar. Tiket relay memakai angka ini sebagai
    // batas, jadi satu potongan multi-slot tidak bisa dipakai lebih dari bayar.
    const insert = db.prepare('INSERT INTO posbot_usage (user_id, model, cost, units, batch_id, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, model || '', cost, units, batch_id || '', 'used')

    const updated = db.prepare('SELECT balance FROM posbot_balance WHERE user_id = ?').get(userId) as { balance: number }
    res.json({ balance: updated.balance, deducted: cost, usage_id: Number(insert.lastInsertRowid) })
  } catch (error) {
    console.error('Posbot deduct error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/refund', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { batch_id, model } = req.body

    let usage
    if (batch_id) {
      usage = db.prepare(
        "SELECT * FROM posbot_usage WHERE user_id = ? AND batch_id = ? AND status = 'used'"
      ).get(userId, batch_id) as { id: number; cost: number } | undefined
    } else if (model) {
      usage = db.prepare(
        "SELECT * FROM posbot_usage WHERE user_id = ? AND model = ? AND status = 'used' ORDER BY id DESC LIMIT 1"
      ).get(userId, model) as { id: number; cost: number } | undefined
    }

    if (!usage) return res.status(404).json({ error: 'Usage not found' })

    db.prepare('UPDATE posbot_usage SET status = ? WHERE id = ?').run('refunded', usage.id)
    db.prepare('UPDATE posbot_balance SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(usage.cost, userId)

    const updated = db.prepare('SELECT balance FROM posbot_balance WHERE user_id = ?').get(userId) as { balance: number }
    res.json({ balance: updated.balance, refunded: usage.cost })
  } catch (error) {
    console.error('Posbot refund error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
