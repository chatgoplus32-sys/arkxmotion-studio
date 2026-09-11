// ─── Wallet NexaBot (prepaid Rp) ────────────────────────────────────────────
// Pola sama seperti CreatePulse: user top up saldo Rupiah (approval admin),
// lalu tiap generate memotong saldo itu. Bedanya:
//  - saldo terpisah (tabel nexabot_*), jadi ledger CreatePulse tidak tersentuh;
//  - harga FLAT Rp 250/generate apa pun mode/model/panjang videonya;
//  - /deduct mengembalikan `usage_id` sehingga refund saat generate gagal
//    menunjuk catatan pemotongan yang tepat (CreatePulse hanya bisa "model
//    terakhir" yang bisa salah kalau ada dua job jalan bersamaan).
//
// Generate lewat jalur session Unlimited maupun fallback API key sama-sama
// dihitung satu generate.
import { Router, Response } from 'express'
import db from '../db.js'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'

const router = Router()

/** Harga per generate untuk user (admin bebas — lihat halaman generate). */
export const NEXABOT_PRICE_RP = 250
/** Minimal top up, mengikuti CreatePulse supaya seragam. */
export const NEXABOT_MIN_TOPUP = 10000

function ensureBalanceRow(userId: number): number {
  const row = db.prepare('SELECT balance FROM nexabot_balance WHERE user_id = ?').get(userId) as { balance: number } | undefined
  if (row) return row.balance
  db.prepare('INSERT INTO nexabot_balance (user_id, balance) VALUES (?, 0)').run(userId)
  return 0
}

router.get('/balance', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const balance = ensureBalanceRow(userId)
    // `price` & `min_topup` ikut dikirim supaya UI memakai angka otoritatif
    // server, bukan konstanta yang bisa langsung usang di klien.
    res.json({ balance, price: NEXABOT_PRICE_RP, min_topup: NEXABOT_MIN_TOPUP })
  } catch (error) {
    console.error('NexaBot balance error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/topup', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { amount, proof_note } = req.body
    if (!amount || amount < NEXABOT_MIN_TOPUP) {
      return res.status(400).json({ error: `Minimal topup Rp ${NEXABOT_MIN_TOPUP.toLocaleString('id-ID')}` })
    }

    const result = db.prepare(
      'INSERT INTO nexabot_topup (user_id, amount, proof_note, status) VALUES (?, ?, ?, ?)'
    ).run(userId, amount, proof_note || '', 'pending')

    const topup = db.prepare('SELECT * FROM nexabot_topup WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ topup, message: 'Topup request submitted, waiting admin approval' })
  } catch (error) {
    console.error('NexaBot topup error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/topups/mine', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const topups = db.prepare('SELECT * FROM nexabot_topup WHERE user_id = ? ORDER BY created_at DESC').all(userId)
    res.json({ topups })
  } catch (error) {
    console.error('NexaBot list topups error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/deduct', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { model, batch_id } = req.body
    const cost = NEXABOT_PRICE_RP
    const balance = ensureBalanceRow(userId)

    if (balance < cost) {
      return res.status(400).json({
        error: `Saldo NexaBot tidak cukup (Rp ${balance.toLocaleString('id-ID')}). Butuh Rp ${cost.toLocaleString('id-ID')} — top up dulu.`,
        balance,
        required: cost,
      })
    }

    db.prepare('UPDATE nexabot_balance SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(cost, userId)
    const insert = db.prepare('INSERT INTO nexabot_usage (user_id, model, cost, batch_id, status) VALUES (?, ?, ?, ?, ?)')
      .run(userId, model || '', cost, batch_id || '', 'used')

    const updated = db.prepare('SELECT balance FROM nexabot_balance WHERE user_id = ?').get(userId) as { balance: number }
    res.json({ balance: updated.balance, deducted: cost, usage_id: Number(insert.lastInsertRowid) })
  } catch (error) {
    console.error('NexaBot deduct error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/refund', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    // `usage_id` adalah cara presisi (dikembalikan /deduct). batch_id disimpan
    // sebagai cadangan untuk pemanggil lama.
    const { usage_id, batch_id } = req.body

    let usage
    if (usage_id) {
      usage = db.prepare("SELECT * FROM nexabot_usage WHERE user_id = ? AND id = ? AND status = 'used'").get(userId, usage_id) as { id: number; cost: number } | undefined
    } else if (batch_id) {
      usage = db.prepare("SELECT * FROM nexabot_usage WHERE user_id = ? AND batch_id = ? AND status = 'used'").get(userId, batch_id) as { id: number; cost: number } | undefined
    }

    if (!usage) return res.status(404).json({ error: 'Usage not found' })

    db.prepare('UPDATE nexabot_usage SET status = ? WHERE id = ?').run('refunded', usage.id)
    db.prepare('UPDATE nexabot_balance SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(usage.cost, userId)

    const updated = db.prepare('SELECT balance FROM nexabot_balance WHERE user_id = ?').get(userId) as { balance: number }
    res.json({ balance: updated.balance, refunded: usage.cost })
  } catch (error) {
    console.error('NexaBot refund error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
