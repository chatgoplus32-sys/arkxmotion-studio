import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  try {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const rawBody = Buffer.concat(chunks)

    const contentType = req.headers['content-type'] || 'multipart/form-data'

    const upstreamRes = await fetch('https://0x0.st', {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: rawBody,
    })

    const text = await upstreamRes.text()
    console.log(`[upload-0x0] ${upstreamRes.status}:`, text.slice(0, 300))

    const url = text.trim()
    if (!url.startsWith('http')) {
      return res.status(502).json({ ok: false, error: `0x0.st: ${text.slice(0, 200)}` })
    }

    return res.status(200).json({ ok: true, url })
  } catch (err: any) {
    console.error(`[upload-0x0] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
