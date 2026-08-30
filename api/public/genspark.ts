import type { VercelRequest, VercelResponse } from '@vercel/node'

const GENSPARK_BASE = 'https://www.genspark.ai'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key, Authorization, Cookie')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const rawBody = Buffer.concat(chunks)
    const contentType = req.headers['content-type'] || ''
    const subpath = (req.url || '/').replace(/^\/api\/public\/genspark/, '') || '/'
    const upstreamUrl = `${GENSPARK_BASE}${subpath}`

    console.log(`[genspark-proxy] ${req.method} ${req.url} → ${upstreamUrl}`)

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://www.genspark.ai',
      'Referer': 'https://www.genspark.ai/',
    }
    
    if (contentType) headers['Content-Type'] = contentType
    if (req.headers['x-api-key']) headers['X-Api-Key'] = req.headers['x-api-key'] as string
    if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'] as string
    if (req.headers['cookie']) headers['Cookie'] = req.headers['cookie'] as string
    
    if (subpath.includes('/api/tool_cli/') || subpath.includes('/api/llm_proxy/')) {
      headers['X-GSK-CLI-Caps'] = 'video_generation'
      headers['X-GSK-CLI-Version'] = '1.7.1'
    }

    const proxyRes = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? rawBody : undefined,
    })

    const text = await proxyRes.text()
    console.log(`[genspark-proxy] ${proxyRes.status}: ${text.slice(0, 300)}`)

    res.writeHead(proxyRes.status, {
      'Content-Type': proxyRes.headers.get('content-type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(text)
  } catch (err: any) {
    console.error(`[genspark-proxy] error:`, err.message)
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: err.message }))
  }
}
