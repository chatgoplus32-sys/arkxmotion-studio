import type { VercelRequest, VercelResponse } from '@vercel/node'

export const config = { maxDuration: 30 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const { url, kind } = req.body || {}
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ ok: false, error: 'Missing or invalid url' })
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const upstream = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const contentType = upstream.headers.get('content-type') || ''

    if (!upstream.ok) {
      return res.status(upstream.status).json({ ok: false, error: `HTTP ${upstream.status}`, contentType })
    }

    if (kind === 'image' && !contentType.includes('image') && !contentType.includes('octet-stream') && !contentType.includes('binary')) {
      return res.status(400).json({ ok: false, error: `Expected image, got ${contentType}`, contentType })
    }
    if (kind === 'video' && !contentType.includes('video') && !contentType.includes('octet-stream') && !contentType.includes('binary')) {
      return res.status(400).json({ ok: false, error: `Expected video, got ${contentType}`, contentType })
    }

    return res.status(200).json({ ok: true, contentType })
  } catch (err: any) {
    const msg = err?.name === 'AbortError' ? 'Timeout validating media' : err.message
    return res.status(502).json({ ok: false, error: msg })
  }
}
