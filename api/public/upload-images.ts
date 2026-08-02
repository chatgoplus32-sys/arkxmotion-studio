import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  try {
    // Accept multipart/form-data
    const contentType = req.headers['content-type'] || ''

    if (contentType.includes('multipart/form-data')) {
      // Parse multipart - files come as individual parts
      const busboy = (await import('busboy')).default
      const bb = busboy({ headers: req.headers, limits: { fileSize: 5 * 1024 * 1024, files: 10 } })

      const files: Array<{ filename: string; mimeType: string; buffer: Buffer }> = []

      await new Promise<void>((resolve, reject) => {
        bb.on('file', (name: string, stream: any, info: { filename: string; mimeType: string }) => {
          const chunks: Buffer[] = []
          stream.on('data', (chunk: Buffer) => chunks.push(chunk))
          stream.on('end', () => {
            files.push({ filename: info.filename || name, mimeType: info.mimeType || 'image/jpeg', buffer: Buffer.concat(chunks) })
          })
        })
        bb.on('error', reject)
        bb.on('finish', resolve)
        req.pipe(bb)
      })

      if (files.length === 0) return res.status(400).json({ ok: false, error: 'No files received' })

      const urls = await uploadFilesToCatbox(files)
      return res.status(200).json({ ok: true, urls })
    }

    return res.status(400).json({ ok: false, error: 'Expected multipart/form-data' })
  } catch (err: any) {
    console.error('[upload-images] error:', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}

async function uploadFilesToCatbox(files: Array<{ filename: string; mimeType: string; buffer: Buffer }>): Promise<string[]> {
  return Promise.all(
    files.map(async (file) => {
      const blob = new Blob([file.buffer], { type: file.mimeType })
      const fd = new FormData()
      fd.append('reqtype', 'fileupload')
      fd.append('fileToUpload', blob, file.filename)

      const r = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: fd,
        signal: AbortSignal.timeout(30000),
      })
      const text = (await r.text()).trim()
      if (!r.ok || !/^https?:\/\//i.test(text)) {
        throw new Error(`Catbox upload failed: ${text || r.status}`)
      }
      return text
    })
  )
}
