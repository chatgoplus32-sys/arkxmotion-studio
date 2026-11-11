import { Router, Request, Response } from 'express'
import { describeFetchError, fetchWithProviderRetry } from '../lib/fetchTimeout.js'
import { decideCredential, isConsumingRequest, settleTicket } from '../lib/providerRelay.js'
import { providerLabel } from '../lib/providerMasterKey.js'

const router = Router()
// Bisa diarahkan ke host lain untuk tes/staging; tanpa env perilakunya sama.
const POSBOT_UPSTREAM = (process.env.POSBOT_BASE || 'https://api.posbot.web.id/api/v1').replace(/\/+$/, '')

router.all('/', async (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-App-Token, X-Provider-Charge')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // PosBot menerima dua bentuk kredensial member; relay menyeragamkannya.
  // Kalau member tidak menempel kunci sendiri, relay mencoba jalur kunci server
  // (login + tiket bayar) — persis seperti relay Seavi.
  const auth = req.headers.authorization || ''
  const headerKey = String(req.headers['x-api-key'] || '').trim()
  const clientKey = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : (headerKey || auth.trim())

  const subpath = String(req.query.path || '').replace(/^\/+/, '')
  if (!subpath) return res.status(400).json({ success: false, error: 'Missing path parameter' })

  const consuming = isConsumingRequest('posbot', req.method, subpath)
  const keputusan = decideCredential('posbot', req, !!clientKey, consuming)
  if (keputusan.kind === 'reject') {
    return res.status(keputusan.status).json({ success: false, error: keputusan.error })
  }

  const kredensial = keputusan.kind === 'client'
    ? (headerKey && !auth.toLowerCase().startsWith('bearer ') ? headerKey : (clientKey || headerKey))
    : keputusan.secret
  const kunciServer = keputusan.kind === 'server'

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${kredensial}`,
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
    if (keputusan.kind === 'server') settleTicket('posbot', keputusan.usageId, r.status, text)

    if (r.status === 401 || r.status === 403) {
      if (kunciServer) {
        console.error(`[posbot-proxy] kunci server ${providerLabel('posbot')} ditolak upstream (HTTP ${r.status}) — periksa panel admin`)
        return res.status(r.status).json({
          success: false,
          error:
            'Akses PosBot milik server ditolak penyedia (bukan kredensial Anda). ' +
            (consuming
              ? 'Saldo yang terpotong dikembalikan otomatis — hubungi admin.'
              : 'Coba lagi nanti; bila berulang, hubungi admin.'),
        })
      }
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
