import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const url = process.env.DATABASE_URL
    if (!url) {
      return res.status(200).json({ maintenance: {} })
    }
    const sql = neon(url)

    await sql`CREATE TABLE IF NOT EXISTS provider_maintenance (
      id SERIAL PRIMARY KEY,
      provider TEXT UNIQUE NOT NULL,
      is_maintenance INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`

    const rows = await sql`SELECT provider, is_maintenance, message FROM provider_maintenance WHERE is_maintenance = 1`
    const result: Record<string, { isMaintenance: boolean; message: string }> = {}
    for (const row of rows) {
      result[row.provider] = {
        isMaintenance: true,
        message: row.message,
      }
    }
    return res.status(200).json({ maintenance: result })
  } catch {
    return res.status(200).json({ maintenance: {} })
  }
}
