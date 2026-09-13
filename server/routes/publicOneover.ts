import { Router, Request, Response } from 'express'

const router = Router()
const ONEOVER_SUPABASE_URL = 'https://mjuwtqkfhtpgavwjrual.supabase.co'
const ONEOVER_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdXd0cWtmaHRwZ2F2d2pydWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyMzcxODgsImV4cCI6MjA4MjgxMzE4OH0.h7PCq_fZJ7JfsQtxMuqLyhSvL4JMgOvBumsw2rBwJOc'

router.all('/', (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  ;(async () => {
    try {
      const action = (req.query.action || req.body?.action || '') as string
      const accessToken = (req.body?.accessToken || req.headers.authorization?.replace(/^Bearer\s+/i, '') || '') as string
      if (!accessToken) return res.status(401).json({ ok: false, error: 'Missing access token' })

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        apikey: ONEOVER_SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      }

      if (action === 'generate') {
        const { accessToken: _, action: __, ...submitBody } = req.body || {}
        const r = await fetch(`${ONEOVER_SUPABASE_URL}/functions/v1/video-generate`, { method: 'POST', headers, body: JSON.stringify(submitBody), signal: AbortSignal.timeout(60000) })
        const text = await r.text()
        let data: any; try { data = JSON.parse(text) } catch { data = { error: text } }
        return res.status(r.status).json(data)
      }

      if (action === 'poll') {
        const { accessToken: _, action: __, pollBody, ...rest } = req.body || {}
        const body = pollBody || rest
        const r = await fetch(`${ONEOVER_SUPABASE_URL}/functions/v1/video-poll`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) })
        const text = await r.text()
        let data: any; try { data = JSON.parse(text) } catch { data = { error: text } }
        return res.status(r.status).json(data)
      }

      if (action === 'balance') {
        const userId = (req.query.user_id || '') as string
        const url = userId
          ? `${ONEOVER_SUPABASE_URL}/functions/v1/get-credit-balance?user_id=${encodeURIComponent(userId)}`
          : `${ONEOVER_SUPABASE_URL}/functions/v1/get-credit-balance`
        const r = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(15000) })
        const text = await r.text()
        let data: any; try { data = JSON.parse(text) } catch { data = { error: text } }
        return res.status(r.status).json(data)
      }

      return res.status(400).json({ ok: false, error: 'Invalid action' })
    } catch (err: any) {
      console.error('[oneover-proxy] error:', err.message)
      return res.status(502).json({ ok: false, error: err.message })
    }
  })()
})

export default router
