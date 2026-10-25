import { Router, Request, Response } from 'express'
import fs from 'node:fs'
import path from 'node:path'

const router = Router()
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ''
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || ''
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || ''
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || ''
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || ''

/**
 * Fallback storage: kalau kredensial R2 tidak diisi, file disimpan ke disk
 * VPS dan dilayani lewat this file static route ini. Kredensial R2 yang nanti
 * diisi di .env VPS akan otomatis memicu upload ke R2 lagi.
 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')

function ensureUploadDir(): string {
  fs.mkdirSync(path.join(UPLOAD_DIR, 'videos'), { recursive: true })
  return UPLOAD_DIR
}

/**
 * URL publik untuk file storage disk. Harus lewat path /api/* karena nginx
 * hanya me-proxy path itu ke express — path lain (mis. /uploads/*) di-cache
 * sebagai file frontend statis.
 */
export const DISK_FILE_BASE = '/api/public/r2-file'

/** URL publik untuk file storage disk — bangun dari header request (di belakang nginx). */
function diskPublicUrl(req: Request, key: string): string {
  const proto = String(req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')).split(',')[0].trim()
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'
  return `${proto}://${host}${DISK_FILE_BASE}/${key}`
}

async function getR2Client(): Promise<any> {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) return null
  try {
    // Dynamic import: file ini ESM (package.json "type":"module"), jadi `require`
    // TIDAK ada saat runtime — memakainya melempar ReferenceError dan bikin route
    // ini selalu balas "R2 not configured" walau env R2 sudah diisi.
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    })
    return { client, PutObjectCommand }
  } catch (err: any) {
    console.error('[r2-upload] gagal memuat @aws-sdk/client-s3:', err?.message || err)
    return null
  }
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
    if (start > 0) parts.push(raw.subarray(start, idx))
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

router.all('/', (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  ;(async () => {
    const r2 = await getR2Client()
    if (r2) {
      try {
        const contentTypeHeader = req.headers['content-type'] || ''
        let body: Buffer
        let fileName = ''
        let mimeType = ''
        let useUrlUpload = false
        let srcUrl = ''
        let prefix = 'videos'

        // Direct bytes upload (multipart file) — for blobs that no server can fetch (blob: URLs)
        if (contentTypeHeader.includes('multipart/form-data')) {
          const chunks: Uint8Array[] = []
          for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk as unknown as Uint8Array)
          const parsed = parseMultipartFile(Buffer.concat(chunks), contentTypeHeader)
          if (!parsed) return res.status(400).json({ ok: false, error: 'Could not parse file from multipart body' })
          body = parsed.fileBuffer
          fileName = parsed.fileName
          mimeType = parsed.mimeType
        } else {
          const { url, filename, prefix: urlPrefix } = req.body
          if (!url) return res.status(400).json({ ok: false, error: 'url is required' })
          const videoRes = await fetch(url, { signal: AbortSignal.timeout(120000) })
          if (!videoRes.ok) throw new Error(`Failed to fetch video: ${videoRes.status}`)
          body = Buffer.from(await videoRes.arrayBuffer())
          fileName = filename || 'video.mp4'
          mimeType = filename?.endsWith('.webm') ? 'video/webm' : 'video/mp4'
          useUrlUpload = true
          srcUrl = url
          prefix = urlPrefix || 'videos'
        }

        const key = generateKey(prefix, fileName)
        await r2.client.send(new r2.PutObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: key,
          Body: body,
          ContentType: mimeType,
        }))

        const cdnUrl = R2_PUBLIC_URL
          ? `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`
          : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.dev/${key}`
        return res.status(200).json({ ok: true, url: cdnUrl, key, storage: 'r2' })
      } catch (err: any) {
        console.error('[r2-upload] error:', err.message)
        // Jangan langsung gagal total — lanjut ke bilik disk di bawah.
      }
    }

    // Fallback disk: kredensial R2 belum di-set (atau upload ke R2 gagal).
    try {
      ensureUploadDir()
      const contentTypeHeader = req.headers['content-type'] || ''
      let fileBuffer: Buffer
      let fileName: string

      if (contentTypeHeader.includes('multipart/form-data')) {
        const chunks: Uint8Array[] = []
        for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk as unknown as Uint8Array)
        const rawBody = Buffer.concat(chunks)
        const parsed = parseMultipartFile(rawBody, contentTypeHeader)
        if (!parsed) return res.status(400).json({ ok: false, error: 'Could not parse file from multipart body' })
        fileBuffer = parsed.fileBuffer
        fileName = parsed.fileName
      } else {
        const { url, filename, prefix } = req.body
        if (!url) return res.status(400).json({ ok: false, error: 'url is required' })
        const videoRes = await fetch(url, { signal: AbortSignal.timeout(120000) })
        if (!videoRes.ok) throw new Error(`Failed to fetch video: ${videoRes.status}`)
        fileBuffer = Buffer.from(await videoRes.arrayBuffer())
        fileName = filename || 'video.mp4'
      }

      const key = generateKey('videos', fileName)
      fs.writeFileSync(path.join(UPLOAD_DIR, key), fileBuffer)
      const url = diskPublicUrl(req, key)
      return res.status(200).json({ ok: true, url, key, storage: 'disk' })
    } catch (err: any) {
      console.error('[r2-upload] disk fallback error:', err.message)
      return res.status(500).json({ ok: false, error: err.message })
    }
  })()
})

export default router
