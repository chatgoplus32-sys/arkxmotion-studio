import type { VercelRequest, VercelResponse } from '@vercel/node'
import formidable from 'formidable'
import type { IncomingMessage } from 'http'
import fs from 'fs'

export const config = { api: { bodyParser: false } }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  try {
    const files = await parseMultipart(req)
    if (files.length === 0) return res.status(400).json({ ok: false, error: 'No files received' })

    const urls = await uploadFilesToCatbox(files)
    return res.status(200).json({ ok: true, urls })
  } catch (err: any) {
    console.error('[upload-images] error:', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}

function parseMultipart(req: IncomingMessage): Promise<Array<{ filename: string; mimeType: string; buffer: Buffer }>> {
  return new Promise((resolve, reject) => {
    const form = formidable({ maxFileSize: 5 * 1024 * 1024, maxFiles: 10, keepExtensions: true })
    const result: Array<{ filename: string; mimeType: string; buffer: Buffer }> = []

    form.parse(req, (err, _fields, files) => {
      if (err) return reject(err)
      const fileEntries = Object.values(files).flat()
      for (const f of fileEntries) {
        if (!f?.filepath) continue
        const buffer = fs.readFileSync(f.filepath)
        result.push({
          filename: f.originalFilename || f.newFilename || 'upload',
          mimeType: f.mimetype || 'image/jpeg',
          buffer,
        })
        fs.unlink(f.filepath, () => {})
      }
      resolve(result)
    })
  })
}

async function uploadFilesToCatbox(files: Array<{ filename: string; mimeType: string; buffer: Buffer }>): Promise<string[]> {
  return Promise.all(
    files.map(async (file) => {
      const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimeType })
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
