import type { VercelRequest, VercelResponse } from '@vercel/node'

const LEONARDO_API = 'https://api.leonardo.ai'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Leonardo-Token')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || (req.headers['x-leonardo-token'] as string) || ''
    if (!token) return res.status(400).json({ ok: false, error: 'Missing token' })

    const { base, path, method, body } = req.body || {}
    if (!path) return res.status(400).json({ ok: false, error: 'Missing path' })

    const baseUrl = base === 'cloud' ? 'https://cloud.leonardo.ai' : LEONARDO_API
    const url = `${baseUrl}${path}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    }

    const fetchOpts: RequestInit = {
      method: method || 'GET',
      headers,
    }

    if (body && method !== 'GET') {
      fetchOpts.body = JSON.stringify(body)
    }

    const apiRes = await fetch(url, fetchOpts)
    const data = await apiRes.json().catch(() => null)

    if (!apiRes.ok) {
      return res.status(200).json({
        ok: false,
        status: apiRes.status,
        error: data?.error || data?.message || data?.detail || JSON.stringify(data).slice(0, 300),
        data,
      })
    }

    return res.json({ ok: true, data })
  } catch (err: any) {
    console.error(`[leonardo-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
