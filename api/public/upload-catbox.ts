import type { VercelRequest, VercelResponse } from '@vercel/node'

const PROVIDERS: Record<string, string> = {
  catbox: 'https://catbox.moe/user/api.php',
  litterbox: 'https://litterbox.catbox.moe/resources/internals/api.php',
  '0x0': 'https://0x0.st',
}

async function tryUpload(provider: string, body: Buffer, contentType: string): Promise<string> {
  const upstream = PROVIDERS[provider]
  if (!upstream) throw new Error(`Unknown provider: ${provider}`)

  const res = await fetch(upstream, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    body,
  })

  const text = await res.text()
  console.log(`[upload-catbox:${provider}] upstream ${res.status}:`, text.slice(0, 300))

  const url = text.trim()
  if (!url.startsWith('http')) throw new Error(`${provider}: ${text.slice(0, 200)}`)
  return url
}

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

    const order = ['catbox', 'litterbox', '0x0']
    let lastError: string = ''

    for (const provider of order) {
      try {
        const url = await tryUpload(provider, rawBody, contentType)
        return res.status(200).json({ ok: true, url })
      } catch (err: any) {
        lastError = err.message
        console.log(`[upload-catbox] ${provider} failed: ${err.message}, trying next...`)
      }
    }

    return res.status(502).json({ ok: false, error: `All providers failed: ${lastError}` })
  } catch (err: any) {
    console.error('[upload-catbox] error:', err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
