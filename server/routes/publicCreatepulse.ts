import { fetchWithTimeout } from '../lib/fetchTimeout'
import { Router, Request, Response } from 'express'
import { callCreatepulseUpstream } from '../../shared/createpulseUpstream.js'

// ─── Proxy CreatePulse (jalur Express) ──────────────────────────────────────
// Semua kebijakan dan pencatatan ada di shared/createpulseUpstream.ts, dipakai
// bersama versi Vercel (api/public/createpulse.ts). Di sini hanya pemetaan
// aksi → endpoint upstream.
const router = Router()
const CP_API = 'https://createpulse.online/api'
const ADMIN_CP_KEY = process.env.CREATEPULSE_API_KEY || ''

router.all('/{*path}', (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const apiKey = req.headers['x-api-key'] || ADMIN_CP_KEY
  const action = (req.query.action as string) || req.body?.action || 'generate'

  ;(async () => {
    try {
      if (action === 'generate' && req.method === 'POST') {
        const { action: _, ...body } = req.body || {}
        const r = await callCreatepulseUpstream({
          action: 'generate',
          url: `${CP_API}/generate`,
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': String(apiKey) },
            body: JSON.stringify(body),
          },
          fetchWithTimeout,
        })
        return res.status(r.status).json(r.body)
      }

      if (action === 'status') {
        const batchId = req.query.batchId || req.body?.batchId
        const r = await callCreatepulseUpstream({
          action: 'status',
          url: `${CP_API}/status?batchId=${batchId}`,
          init: { headers: { 'X-API-Key': String(apiKey) } },
          fetchWithTimeout,
        })
        return res.status(r.status).json(r.body)
      }

      if (action === 'download') {
        const videoUrl = req.query.url || req.body?.url
        if (!videoUrl || typeof videoUrl !== 'string') {
          return res.status(400).json({ error: 'Missing url parameter' })
        }
        let fullUrl = videoUrl.startsWith('http') ? videoUrl : `https://createpulse.online${videoUrl}`
        const r = await fetchWithTimeout(fullUrl, { redirect: 'follow' })
        if (!r.ok) return res.status(r.status).json({ error: `Upstream returned ${r.status}` })
        const contentType = r.headers.get('content-type') || 'video/mp4'
        const contentLength = r.headers.get('content-length')
        const headers: Record<string, string> = { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*', 'Content-Disposition': 'attachment' }
        if (contentLength) headers['Content-Length'] = contentLength
        res.writeHead(200, headers)
        if (r.body) {
          const reader = r.body.getReader()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            res.write(value)
          }
        }
        return res.end()
      }

      return res.status(400).json({ error: 'Unknown action' })
    } catch (err: any) {
      console.error('[createpulse] gagal memproses:', err?.message || err)
      return res.status(502).json({ error: err.message })
    }
  })()
})

export default router
