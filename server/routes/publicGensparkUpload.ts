import { Router, Request, Response } from 'express'

const router = Router()
const GENSPARK_BASE = 'https://www.genspark.ai'

router.all('/', (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  ;(async () => {
    try {
      const chunks: Uint8Array[] = []
      for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk as unknown as Uint8Array)
      const rawBody = Buffer.concat(chunks)
      const contentType = req.headers['content-type'] || ''
      const apiKey = req.headers['x-api-key'] as string
      if (!apiKey) return res.status(401).json({ ok: false, error: 'Missing X-Api-Key' })

      const boundary = contentType.split('boundary=')[1]
      if (!boundary) return res.status(400).json({ ok: false, error: 'No boundary in content-type' })
      const parts = rawBody.toString('binary').split('--' + boundary)
      let fileBuffer: Buffer | null = null
      let fileName = 'upload.bin'
      let fileType = 'application/octet-stream'
      for (const part of parts) {
        const headerEnd = part.indexOf('\r\n\r\n')
        if (headerEnd === -1) continue
        const header = part.substring(0, headerEnd)
        const body = part.substring(headerEnd + 4)
        if (header.includes('filename=')) {
          const fnMatch = header.match(/filename="([^"]+)"/)
          if (fnMatch) fileName = fnMatch[1]
          const ctMatch = header.match(/Content-Type:\s*(.+)/i)
          if (ctMatch) fileType = ctMatch[1].trim()
          const endMarker = body.lastIndexOf('\r\n')
          fileBuffer = Buffer.from(body.substring(0, endMarker), 'binary')
          break
        }
      }
      if (!fileBuffer) return res.status(400).json({ ok: false, error: 'No file in request' })

      const metaRes = await fetch(`${GENSPARK_BASE}/api/tool_cli/file/upload_url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey, 'X-GSK-CLI-Caps': 'video_generation', 'X-GSK-CLI-Version': '1.7.1' },
        body: JSON.stringify({ content_type: fileType, name: fileName }),
        signal: AbortSignal.timeout(30000),
      })
      if (!metaRes.ok) return res.status(metaRes.status).json({ ok: false, error: `Genspark API error: ${metaRes.status}` })
      const meta: any = await metaRes.json()
      const data = meta?.data || meta
      const uploadUrl = data?.upload_url
      const fileWrapperUrl = data?.file_wrapper_url
      if (!uploadUrl) return res.status(500).json({ ok: false, error: 'No upload URL from Genspark', data })

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': fileType, 'x-ms-blob-type': 'BlockBlob' },
        body: new Uint8Array(fileBuffer),
        signal: AbortSignal.timeout(60000),
      })
      if (!putRes.ok) return res.status(502).json({ ok: false, error: `Azure upload failed: ${putRes.status}` })
      return res.status(200).json({ ok: true, file_url: fileWrapperUrl || uploadUrl })
    } catch (err: any) {
      console.error(`[genspark-upload] error:`, err.message)
      return res.status(502).json({ ok: false, error: err.message })
    }
  })()
})

export default router
