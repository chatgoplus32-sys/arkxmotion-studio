import { Router, Request, Response } from 'express'

const router = Router()
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ''
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || ''
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || ''
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || ''
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || ''

function getR2Client(): any {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) return null
  try {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    })
    return { client, PutObjectCommand }
  } catch { return null }
}

function generateKey(prefix: string, filename: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  const ext = filename.split('.').pop() || 'mp4'
  return `${prefix}/${timestamp}-${random}.${ext}`
}

router.all('/', (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const r2 = getR2Client()
  if (!r2) return res.status(500).json({ ok: false, error: 'R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME env vars.' })

  ;(async () => {
    try {
      const { url, filename, prefix } = req.body
      if (!url) return res.status(400).json({ ok: false, error: 'url is required' })

      const key = generateKey(prefix || 'videos', filename || 'video.mp4')
      const videoRes = await fetch(url, { signal: AbortSignal.timeout(120000) })
      if (!videoRes.ok) throw new Error(`Failed to fetch video: ${videoRes.status}`)
      const buffer = Buffer.from(await videoRes.arrayBuffer())
      const contentType = filename?.endsWith('.webm') ? 'video/webm' : 'video/mp4'

      await r2.client.send(new r2.PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }))

      const cdnUrl = R2_PUBLIC_URL
        ? `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`
        : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.dev/${key}`

      return res.status(200).json({ ok: true, url: cdnUrl, key })
    } catch (err: any) {
      console.error('[r2-upload] error:', err.message)
      return res.status(500).json({ ok: false, error: err.message })
    }
  })()
})

export default router
