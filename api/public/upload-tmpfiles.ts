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

    const upstreamRes = await fetch('https://tmpfiles.org/api/v1/upload', {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: rawBody,
    })

    const json = await upstreamRes.json().catch(() => null)
    console.log(`[upload-tmpfiles] ${upstreamRes.status}:`, JSON.stringify(json).slice(0, 300))

    if (!json?.data?.url) {
      return res.status(502).json({ ok: false, error: `tmpfiles: ${JSON.stringify(json).slice(0, 200)}` })
    }

    // tmpfiles returns https://tmpfiles.org/123/file.jpg — convert to direct link
    const pageUrl: string = json.data.url
    const directUrl = pageUrl.replace('tmpfiles.org/', 'tmpfiles.org/dl/')

    return res.status(200).json({ ok: true, url: directUrl })
  } catch (err: any) {
    console.error(`[upload-tmpfiles] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
