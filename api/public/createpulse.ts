import type { VercelRequest, VercelResponse } from '@vercel/node'
import { callCreatepulseUpstream } from '../../shared/createpulseUpstream.js'

// ─── Proxy CreatePulse (versi Vercel) ───────────────────────────────────────
// Cermin dari server/routes/publicCreatepulse.ts; kebijakan dan pencatatannya
// sama-sama dari shared/createpulseUpstream.ts supaya dev dan produksi tidak
// bisa berbeda perilaku (dulu keduanya membaca body dengan json().catch(() =>
// ({})), sehingga 502 gateway createpulse.online selalu jadi "unknown").
const CP_API = 'https://createpulse.online/api'
const ADMIN_CP_KEY = process.env.CREATEPULSE_API_KEY || ''

const FETCH_TIMEOUT_MS = 30000
async function fetchWithTimeout(url: string | URL, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? FETCH_TIMEOUT_MS
  const ac = new AbortController()
  const tid = setTimeout(() => ac.abort(), timeoutMs)
  try { return await fetch(url, { ...init, signal: ac.signal }) } finally { clearTimeout(tid) }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const apiKey = req.headers['x-api-key'] || ADMIN_CP_KEY
  const action = (req.query.action || req.body?.action || 'generate') as string

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
      if (/^https?:\/\/localhost:\d+\/backend\/api\/video\//i.test(fullUrl)) {
        fullUrl = fullUrl.replace(/^https?:\/\/localhost:\d+/, 'https://createpulse.online')
      }
      const r = await fetchWithTimeout(fullUrl, { redirect: 'follow' })
      if (!r.ok) {
        return res.status(r.status).json({ error: `Upstream returned ${r.status}` })
      }
      const contentType = r.headers.get('content-type') || 'video/mp4'
      const contentLength = r.headers.get('content-length')
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Content-Disposition': 'attachment',
      }
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
    return res.status(502).json({ error: err.message })
  }
}
