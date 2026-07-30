import type { VercelRequest, VercelResponse } from '@vercel/node'

const LEONARDO_API = 'https://api.leonardo.ai'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Leonardo-Token')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const token = req.headers['x-leonardo-token'] as string
  if (!token) return res.status(400).json({ ok: false, error: 'Missing X-Leonardo-Token' })

  try {
    const { b64, ext, mime } = req.body || {}
    if (!b64) return res.status(400).json({ ok: false, error: 'Missing b64 data' })

    const extension = ext || 'png'
    const mimeType = mime || `image/${extension === 'jpg' ? 'jpeg' : extension}`

    const binaryStr = atob(b64)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }
    const blob = new Blob([bytes], { type: mimeType })

    const initRes = await fetch(`${LEONARDO_API}/api/rest/v1/init-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ extension }),
    })
    const initData = await initRes.json()
    const initImage = initData?.uploadInitImage || initData?.upload_init_image || initData

    if (!initImage?.url || !initImage?.id) {
      return res.status(200).json({ ok: false, error: 'No presigned URL from Leonardo', data: initData })
    }

    const presignedUrl: string = initImage.url
    const fields = initImage.fields
    let uploadOk = false

    if (fields && typeof fields === 'object') {
      const fd = new FormData()
      for (const [k, v] of Object.entries(fields)) {
        fd.append(k, String(v))
      }
      fd.append('file', blob, `image.${extension}`)
      try {
        const postRes = await fetch(presignedUrl, { method: 'POST', body: fd })
        uploadOk = postRes.ok
      } catch { /* fallback to PUT */ }
    }

    if (!uploadOk) {
      const putRes = await fetch(presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: blob,
      })
      uploadOk = putRes.ok
    }

    if (!uploadOk) {
      return res.status(200).json({ ok: false, error: 'S3 upload failed both methods' })
    }

    return res.json({ ok: true, id: initImage.id })
  } catch (err: any) {
    console.error('[leonardo-upload] error:', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
