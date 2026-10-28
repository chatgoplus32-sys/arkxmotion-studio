import { fetchWithTimeout } from '../lib/fetchTimeout.js'
import { Router, Request, Response } from 'express'
import { decideCredential, isConsumingRequest, settleTicket } from '../lib/providerRelay.js'
import { providerLabel } from '../lib/providerMasterKey.js'

const router = Router()
// Bisa diarahkan ke host lain untuk tes/staging; tanpa env perilakunya sama.
const ALRIZ_UPSTREAM = (process.env.ALRIZ_BASE || 'https://alrizmotion.my.id/api').replace(/\/+$/, '')

router.all('/', async (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-App-Token, X-Provider-Charge')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // Klien mengirim `Authorization: Bearer <key>` (konvensi relay app ini);
  // upstream Alriz memakai header `X-API-Key`.
  const auth = req.headers.authorization || ''
  const clientKey = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : auth.trim()

  const subpath = String(req.query.path || '').replace(/^\/+/, '')
  if (!subpath) return res.status(400).json({ ok: false, error: 'Missing path parameter' })

  const consuming = isConsumingRequest('alriz', req.method, subpath)
  const keputusan = decideCredential('alriz', req, !!clientKey, consuming)
  if (keputusan.kind === 'reject') {
    return res.status(keputusan.status).json({ ok: false, error: keputusan.error })
  }

  const kredensial = keputusan.kind === 'client' ? clientKey : keputusan.secret
  const kunciServer = keputusan.kind === 'server'

  try {
    const headers: Record<string, string> = { 'X-API-Key': kredensial, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', Accept: 'application/json' }
    if (req.method === 'POST') headers['Content-Type'] = 'application/json'
    const fetchOpts: RequestInit = { method: req.method, headers }
    if (req.method === 'POST' && req.body) fetchOpts.body = JSON.stringify(req.body)

    const r = await fetchWithTimeout(`${ALRIZ_UPSTREAM}/${subpath}`, fetchOpts)
    const text = await r.text()
    // Tiket hanya dipegang jalur kunci server; jalur kunci member tidak memakai
    // uang operator dan tidak perlu bukti bayar.
    if (keputusan.kind === 'server') settleTicket('alriz', keputusan.usageId, r.status, text)

    // Kunci server yang ditolak upstream bukan salah member. Pesan upstream
    // ("API key tidak valid") akan membuat mereka mengira kuncinya sendiri salah.
    if (kunciServer && (r.status === 401 || r.status === 403)) {
      console.error(`[alriz-proxy] kunci server ${providerLabel('alriz')} ditolak upstream (HTTP ${r.status}) — periksa panel admin`)
      return res.status(r.status).json({
        ok: false,
        error:
          'Akses Alriz milik server ditolak penyedia (bukan kredensial Anda). ' +
          (consuming
            ? 'Saldo yang terpotong dikembalikan otomatis — hubungi admin.'
            : 'Coba lagi nanti; bila berulang, hubungi admin.'),
      })
    }

    let data: any
    try { data = JSON.parse(text) } catch { data = text }
    return res.status(r.status).json(data)
  } catch (err: any) {
    console.error(`[alriz-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
})

export default router
