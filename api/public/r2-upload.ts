import type { VercelRequest, VercelResponse } from '@vercel/node'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ''
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || ''
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || ''
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || ''
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || ''

function getR2Client(): S3Client | null {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    return null
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  })
}

function generateKey(prefix: string, filename: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  const ext = filename.split('.').pop() || 'mp4'
  return `${prefix}/${timestamp}-${random}.${ext}`
}

function parseMultipartFile(raw: Buffer, contentType: string): { fileBuffer: Buffer; fileName: string; mimeType: string } | null {
  const boundaryMatch = contentType.match(/boundary=(.+)/)
  if (!boundaryMatch) return null
  const boundary = boundaryMatch[1].trim()
  const boundaryBuf = Buffer.from(`--${boundary}`)
  const parts: Buffer[] = []

  let start = 0
  while (true) {
    const idx = raw.indexOf(boundaryBuf, start)
    if (idx === -1) break
    if (start > 0) {
      parts.push(raw.subarray(start, idx))
    }
    start = idx + boundaryBuf.length + 2
  }

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd === -1) continue
    const headers = part.subarray(0, headerEnd).toString()
    const body = part.subarray(headerEnd + 4)
    const trailing = body.lastIndexOf('\r\n')
    const fileData = trailing > 0 ? body.subarray(0, trailing) : body

    if (headers.includes('filename=')) {
      const fileMatch = headers.match(/filename="([^"]+)"/)
      const typeMatch = headers.match(/Content-Type:\s*(.+)/i)
      return {
        fileBuffer: fileData,
        fileName: fileMatch?.[1] || 'upload.bin',
        mimeType: typeMatch?.[1]?.trim() || 'application/octet-stream',
      }
    }
  }
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const client = getR2Client()
  if (!client) {
    return res.status(500).json({
      ok: false,
      error: 'R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME env vars.',
    })
  }

  try {
    const contentTypeHeader = req.headers['content-type'] || ''

    // Direct bytes upload (multipart file) — for blobs that no server can fetch (blob: URLs)
    if (contentTypeHeader.includes('multipart/form-data')) {
      const chunks: Uint8Array[] = []
      for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      const rawBody = Buffer.concat(chunks)
      const parsed = parseMultipartFile(rawBody, contentTypeHeader)
      if (!parsed) return res.status(400).json({ ok: false, error: 'Could not parse file from multipart body' })

      const key = generateKey('videos', parsed.fileName)
      await client.send(new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: parsed.fileBuffer,
        ContentType: parsed.mimeType,
      }))

      const cdnUrl = R2_PUBLIC_URL
        ? `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`
        : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.dev/${key}`
      return res.status(200).json({ ok: true, url: cdnUrl, key })
    }

    const { url, filename, prefix } = req.body
    if (!url) return res.status(400).json({ ok: false, error: 'url is required' })

    const key = generateKey(prefix || 'videos', filename || 'video.mp4')

    const videoRes = await fetch(url)
    if (!videoRes.ok) throw new Error(`Failed to fetch video: ${videoRes.status}`)
    const buffer = Buffer.from(await videoRes.arrayBuffer())

    const contentType = filename?.endsWith('.webm') ? 'video/webm' : 'video/mp4'

    await client.send(new PutObjectCommand({
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
}
