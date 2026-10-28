import { fetchWithTimeout } from '../lib/fetchTimeout.js'
import { Router, Request, Response } from 'express'
import { decideCredential, isConsumingRequest, settleTicket } from '../lib/providerRelay.js'
import { providerLabel } from '../lib/providerMasterKey.js'

const router = Router()
// Bisa diarahkan ke host lain untuk tes/staging; tanpa env perilakunya sama.
const SEAVI_UPSTREAM = (process.env.SEAVI_BASE || 'https://api.seavilabs.site/v1').replace(/\/+$/, '')

router.all('/', async (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-App-Token, X-Provider-Charge')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const auth = req.headers.authorization || ''
  const clientKey = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : auth.trim()

  const subpath = String(req.query.path || '').replace(/^\/+/, '')
  if (!subpath) return res.status(400).json({ ok: false, error: 'Missing path parameter' })

  const consuming = isConsumingRequest('seavi', req.method, subpath)
  const keputusan = decideCredential('seavi', req, !!clientKey, consuming)
  if (keputusan.kind === 'reject') {
    return res.status(keputusan.status).json({ ok: false, error: keputusan.error })
  }

  const kredensial = keputusan.kind === 'client' ? auth : `Bearer ${keputusan.secret}`
  const kunciServer = keputusan.kind === 'server'

  try {
    const headers: Record<string, string> = { Authorization: kredensial, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', Accept: 'application/json' }
    if (req.method === 'POST') headers['Content-Type'] = 'application/json'
    const fetchOpts: RequestInit = { method: req.method, headers }
    if (req.method === 'POST' && req.body) fetchOpts.body = JSON.stringify(req.body)

    const r = await fetchWithTimeout(`${SEAVI_UPSTREAM}/${subpath}`, fetchOpts)
    const text = await r.text()
    if (keputusan.kind === 'server') settleTicket('seavi', keputusan.usageId, r.status, text)

    if (kunciServer && (r.status === 401 || r.status === 403)) {
      console.error(`[seavi-proxy] kunci server ${providerLabel('seavi')} ditolak upstream (HTTP ${r.status}) — periksa panel admin`)
      return res.status(r.status).json({
        ok: false,
        error:
          'Akses Seavi milik server ditolak penyedia (bukan kredensial Anda). ' +
          (consuming
            ? 'Token yang terpotong dikembalikan otomatis — hubungi admin.'
            : 'Coba lagi nanti; bila berulang, hubungi admin.'),
      })
    }

    let data: any
    try { data = JSON.parse(text) } catch { data = text }
    return res.status(r.status).json(data)
  } catch (err: any) {
    console.error(`[seavi-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
})

export default router
