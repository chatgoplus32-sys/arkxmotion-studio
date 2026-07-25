import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  try {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const rawBody = Buffer.concat(chunks)
    const contentType = req.headers['content-type'] || 'multipart/form-data'

    const upstreamRes = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: rawBody,
    })

    const text = await upstreamRes.text()
    console.log(`[upload-litterbox] ${upstreamRes.status}:`, text.slice(0, 300))

    if (!upstreamRes.ok || !text.startsWith('http')) {
      return res.status(502).json({ ok: false, error: `litterbox: ${text.slice(0, 200)}` })
    }

    return res.status(200).json({ ok: true, url: text.trim() })
  } catch (err: any) {
    console.error(`[upload-litterbox] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
