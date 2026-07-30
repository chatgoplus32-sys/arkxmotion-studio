import type { VercelRequest, VercelResponse } from '@vercel/node'

const CF_WORKER_URL = 'https://upload-catbox.WORKER_SUBDOMAIN.workers.dev'

async function tryUploadCF(body: Buffer, contentType: string): Promise<string> {
  const res = await fetch(CF_WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  })
  const data = await res.json().catch(() => ({})) as any
  if (!res.ok || !data.url) throw new Error(data.error || `CF Worker ${res.status}`)
  return data.url
}

async function tryUploadDirect(provider: string, body: Buffer, contentType: string): Promise<string> {
  const endpoints: Record<string, string> = {
    catbox: 'https://catbox.moe/user/api.php',
    litterbox: 'https://litterbox.catbox.moe/resources/internals/api.php',
    '0x0': 'https://0x0.st',
  }
  const upstream = endpoints[provider]
  if (!upstream) throw new Error(`Unknown: ${provider}`)

  const res = await fetch(upstream, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    body,
  })
  const text = await res.text()
  console.log(`[upload:${provider}] upstream ${res.status}:`, text.slice(0, 300))
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

    try {
      const url = await tryUploadCF(rawBody, contentType)
      return res.status(200).json({ ok: true, url })
    } catch (cfErr: any) {
      console.log(`[upload] CF Worker failed: ${cfErr.message}, trying direct...`)
    }

    const directOrder = ['catbox', 'litterbox', '0x0']
    let lastError = ''
    for (const provider of directOrder) {
      try {
        const url = await tryUploadDirect(provider, rawBody, contentType)
        return res.status(200).json({ ok: true, url })
      } catch (err: any) {
        lastError = err.message
        console.log(`[upload] ${provider} failed: ${err.message}`)
      }
    }

    return res.status(502).json({ ok: false, error: `All failed: ${lastError}` })
  } catch (err: any) {
    console.error('[upload] error:', err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
