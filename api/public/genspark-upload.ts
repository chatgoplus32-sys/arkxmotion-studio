import type { VercelRequest, VercelResponse } from '@vercel/node'

const GENSPARK_BASE = 'https://www.genspark.ai'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  try {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const rawBody = Buffer.concat(chunks)
    const contentType = req.headers['content-type'] || ''
    const apiKey = req.headers['x-api-key'] as string
    if (!apiKey) {
      return res.status(401).json({ ok: false, error: 'Missing X-Api-Key' })
    }

    // Parse multipart to get file
    const boundary = contentType.split('boundary=')[1]
    if (!boundary) {
      return res.status(400).json({ ok: false, error: 'No boundary in content-type' })
    }
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
    if (!fileBuffer) {
      return res.status(400).json({ ok: false, error: 'No file in request' })
    }
    console.log(`[genspark-upload] Got file: ${fileName} (${fileBuffer.length} bytes, ${fileType})`)

    // Step 2: Get presigned upload URL from Genspark
    const metaRes = await fetch(`${GENSPARK_BASE}/api/tool_cli/file/upload_url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        'X-GSK-CLI-Caps': 'video_generation',
        'X-GSK-CLI-Version': '1.7.1',
      },
      body: JSON.stringify({ content_type: fileType, name: fileName }),
    })
    if (!metaRes.ok) {
      const errText = await metaRes.text().catch(() => '')
      console.error(`[genspark-upload] Genspark API error: ${metaRes.status}: ${errText.slice(0, 200)}`)
      return res.status(metaRes.status).json({ ok: false, error: `Genspark API error: ${metaRes.status}` })
    }
    const meta: any = await metaRes.json()
    const data = meta?.data || meta
    const uploadUrl = data?.upload_url
    const fileWrapperUrl = data?.file_wrapper_url
    if (!uploadUrl) {
      return res.status(500).json({ ok: false, error: 'No upload URL from Genspark', data })
    }
    console.log(`[genspark-upload] Got upload URL: ${uploadUrl.substring(0, 80)}...`)

    // Step 3: Upload file to Azure Blob Storage
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': fileType, 'x-ms-blob-type': 'BlockBlob' },
      body: new Uint8Array(fileBuffer),
    })
    if (!putRes.ok) {
      const errText = await putRes.text().catch(() => '')
      console.error(`[genspark-upload] Azure upload error: ${putRes.status}: ${errText.slice(0, 200)}`)
      return res.status(502).json({ ok: false, error: `Azure upload failed: ${putRes.status}` })
    }
    console.log(`[genspark-upload] Upload success → ${fileWrapperUrl || uploadUrl}`)
    return res.status(200).json({ ok: true, file_url: fileWrapperUrl || uploadUrl })
  } catch (err: any) {
    console.error(`[genspark-upload] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
