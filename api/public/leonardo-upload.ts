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

    let parsedFieldsForLog: Record<string, string> | null = null
    if (initImage?.fields) {
      try {
        parsedFieldsForLog = typeof initImage.fields === 'string' ? JSON.parse(initImage.fields) : initImage.fields
      } catch { /* ignore */ }
    }
    console.log(`[leonardo-upload] init-image: id=${initImage?.id}, hasUrl=${!!initImage?.url}, fieldsType=${typeof initImage?.fields}, parsedFieldKeys=${parsedFieldsForLog ? Object.keys(parsedFieldsForLog).join(',') : 'none'}, initResStatus=${initRes.status}`)

    if (!initImage?.url || !initImage?.id) {
      return res.status(200).json({ ok: false, error: 'No presigned URL from Leonardo', data: initData })
    }

    const presignedUrl: string = initImage.url
    const fields = initImage.fields
    let uploadOk = false

    let parsedFields: Record<string, string> | null = null
    if (fields) {
      if (typeof fields === 'string') {
        try { parsedFields = JSON.parse(fields) } catch { /* will fallback */ }
      } else if (typeof fields === 'object') {
        parsedFields = fields as Record<string, string>
      }
    }

    if (parsedFields) {
      const fd = new FormData()
      for (const [k, v] of Object.entries(parsedFields)) {
        fd.append(k, String(v))
      }
      fd.append('file', blob, `image.${extension}`)
      console.log(`[leonardo-upload] POST+FormData to S3 (${Object.keys(parsedFields).length} fields: ${Object.keys(parsedFields).join(',')})...`)
      try {
        const postRes = await fetch(presignedUrl, { method: 'POST', body: fd })
        const postBody = await postRes.text().catch(() => '')
        console.log(`[leonardo-upload] POST+FormData: status=${postRes.status}, body=${postBody.slice(0, 200)}`)
        uploadOk = postRes.ok
      } catch (e: any) {
        console.error(`[leonardo-upload] S3 POST exception: ${e.message}`)
      }
    } else {
      console.log(`[leonardo-upload] No parsed fields, trying PUT...`)
    }

    if (!uploadOk) {
      console.log(`[leonardo-upload] Trying PUT fallback with Content-Type: ${mimeType}, blobSize=${blob.size}...`)
      const putRes = await fetch(presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: blob,
      })
      const putBody = await putRes.text().catch(() => '')
      console.log(`[leonardo-upload] PUT: status=${putRes.status}, body=${putBody.slice(0, 200)}`)
      uploadOk = putRes.ok
    }

    if (!uploadOk) {
      console.error(`[leonardo-upload] Both POST and PUT failed`)
      return res.status(200).json({ ok: false, error: 'S3 upload failed both methods' })
    }

    console.log(`[leonardo-upload] OK, imageId=${initImage.id}`)
    return res.json({ ok: true, id: initImage.id })
  } catch (err: any) {
    console.error('[leonardo-upload] error:', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
}
