import type { VercelRequest, VercelResponse } from '@vercel/node'

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

const PROVIDERS: Record<string, string> = {
  catbox: 'https://catbox.moe/user/api.php',
  '0x0': 'https://0x0.st',
  litterbox: 'https://litterbox.catbox.moe/resources/internals/api.php',
  tmpfiles: 'https://tmpfiles.org/api/v1/upload',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const provider = (req.query.provider || '') as string
  const upstream = PROVIDERS[provider]
  if (!upstream) return res.status(400).json({ ok: false, error: `Unknown provider: ${provider}` })

  try {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const rawBody = Buffer.concat(chunks)
    const contentType = req.headers['content-type'] || 'multipart/form-data'

    const upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: rawBody,
    })

    if (provider === 'tmpfiles') {
      const json = await upstreamRes.json().catch(() => null)
      console.log(`[uploads:${provider}] ${upstreamRes.status}:`, JSON.stringify(json).slice(0, 300))
      if (!json?.data?.url) {
        return res.status(502).json({ ok: false, error: `tmpfiles: ${JSON.stringify(json).slice(0, 200)}` })
      }
      const directUrl: string = json.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/')
      return res.status(200).json({ ok: true, url: directUrl })
    }

    const text = await upstreamRes.text()
    console.log(`[uploads:${provider}] ${upstreamRes.status}:`, text.slice(0, 300))

    const url = text.trim()
    if (!url.startsWith('http')) {
      return res.status(502).json({ ok: false, error: `${provider}: ${text.slice(0, 200)}` })
    }

    return res.status(200).json({ ok: true, url })
  } catch (err: any) {
    console.error(`[uploads:${provider}] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
