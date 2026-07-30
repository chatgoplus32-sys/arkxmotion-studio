import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  try {
    const chunks: Uint8Array[] = []
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }
    const rawBody = Buffer.concat(chunks)
    const contentType = req.headers['content-type'] || 'multipart/form-data'

    // 1. Try tmpfiles.org (works from Vercel)
    try {
      const res = await fetch('https://tmpfiles.org/api/v1/upload', {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: rawBody,
      })
      const data = await res.json().catch(() => ({})) as any
      if (data?.data?.url) {
        const directUrl = data.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/')
        return res.status(200).json({ ok: true, url: directUrl })
      }
    } catch (e: any) {
      console.log('[upload] tmpfiles failed:', e.message)
    }

    // 2. Try catbox
    try {
      const res = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        body: rawBody,
      })
      const text = await res.text()
      if (text.trim().startsWith('http')) {
        return res.status(200).json({ ok: true, url: text.trim() })
      }
    } catch (e: any) {
      console.log('[upload] catbox failed:', e.message)
    }

    // 3. Try litterbox
    try {
      const res = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        body: rawBody,
      })
      const text = await res.text()
      if (text.trim().startsWith('http')) {
        return res.status(200).json({ ok: true, url: text.trim() })
      }
    } catch (e: any) {
      console.log('[upload] litterbox failed:', e.message)
    }

    return res.status(502).json({ ok: false, error: 'All upload providers failed' })
  } catch (err: any) {
    console.error('[upload] error:', err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
