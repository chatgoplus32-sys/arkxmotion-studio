import { Router, Request, Response } from 'express'
import db from '../db.js'

const router = Router()

interface MaintenanceRow {
  provider: string
  is_maintenance: number
  message: string
}

router.get('/', (_req: Request, res: Response) => {
  try {
    const rows = db.prepare('SELECT provider, is_maintenance, message FROM provider_maintenance WHERE is_maintenance = 1').all() as MaintenanceRow[]
    const result: Record<string, { isMaintenance: boolean; message: string }> = {}
    for (const row of rows) {
      result[row.provider] = {
        isMaintenance: true,
        message: row.message,
      }
    }
    res.json({ maintenance: result })
  } catch (error) {
    console.error('Public maintenance error:', error)
    res.json({ maintenance: {} })
  }
})

export default router
