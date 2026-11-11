import { Router, Request, Response } from 'express'
import { describeFetchError, fetchWithProviderRetry } from '../lib/fetchTimeout.js'

const router = Router()
// Bisa diarahkan ke host lain untuk tes/staging; tanpa env perilakunya sama.
const POSBOT_UPSTREAM = (process.env.POSBOT_BASE || 'https://api.posbot.web.id/api/v1').replace(/\/+$/, '')

// Hanya POST /generate yang memotong Saldo Generate. Rute baca boleh diulang
// saat jaringan gagal; request yang membuat job hanya diulang kalau belum ada
// byte yang terkirim (lihat fetchWithProviderRetry).
function isConsumingRequest(method: string, subpath: string): boolean {
  return method.toUpperCase() === 'POST' && subpath.replace(/^\/+|\/+$/g, '') === 'generate'
}

router.all('/', async (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // PosBot menerima dua bentuk kredensial; relay menyeragamkannya jadi
  // Authorization Bearer supaya klien hanya perlu satu jalur.
  const auth = req.headers.authorization || ''
  const headerKey = String(req.headers['x-api-key'] || '').trim()
  const clientKey = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : (headerKey || auth.trim())
  if (!clientKey) {
    return res.status(401).json({ success: false, error: 'API key PosBot belum diisi' })
  }

  const subpath = String(req.query.path || '').replace(/^\/+/, '')
  if (!subpath) return res.status(400).json({ success: false, error: 'Missing path parameter' })

  const consuming = isConsumingRequest(req.method, subpath)

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${clientKey}`,
      Accept: 'application/json',
    }
    if (req.method === 'POST') headers['Content-Type'] = 'application/json'
    const fetchOpts: RequestInit = { method: req.method, headers }
    if (req.method === 'POST' && req.body) fetchOpts.body = JSON.stringify(req.body)

    const r = await fetchWithProviderRetry(`${POSBOT_UPSTREAM}/${subpath}`, fetchOpts, {
      consuming,
      label: 'posbot-proxy',
    })
    const text = await r.text()

    if (r.status === 401 || r.status === 403) {
      return res.status(r.status).json({
        success: false,
        error: 'API key PosBot ditolak (401/403) — buat kunci baru di bot Telegram → Developer API.',
      })
    }

    let data: any
    try { data = JSON.parse(text) } catch { data = text }
    return res.status(r.status).json(data)
  } catch (err: any) {
    console.error(`[posbot-proxy] error:`, describeFetchError(err))
    return res.status(502).json({ success: false, error: describeFetchError(err) })
  }
})

export default router
