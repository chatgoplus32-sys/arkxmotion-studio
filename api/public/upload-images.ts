import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  try {
    const formData = req.body
    if (!formData?.files || !Array.isArray(formData.files) || formData.files.length === 0) {
      return res.status(400).json({ ok: false, error: 'Missing files array' })
    }

    const files: Array<{ name: string; type: string; data: string }> = formData.files
    if (files.length > 10) return res.status(400).json({ ok: false, error: 'Max 10 files' })

    const results = await Promise.all(
      files.map(async (file) => {
        const buffer = Buffer.from(file.data, 'base64')
        const blob = new Blob([buffer], { type: file.type || 'image/jpeg' })
        const fd = new FormData()
        fd.append('reqtype', 'fileupload')
        fd.append('fileToUpload', blob, file.name || 'upload.jpg')

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

    return res.status(200).json({ ok: true, urls: results })
  } catch (err: any) {
    console.error('[upload-images] error:', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
