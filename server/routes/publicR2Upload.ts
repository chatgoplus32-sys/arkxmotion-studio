import { Router, Request, Response } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import {
  MAX_UPLOAD_BYTES,
  UploadError,
  fetchExternalMedia,
  resolveMediaType,
  takeUploadSlot,
} from '../lib/uploadGuards.js'

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

/** Key selalu di bawah videos/ dan ekstensinya berasal dari MIME yang sudah divalidasi. */
function generateKey(ext: string): string {
  const random = Math.random().toString(36).substring(2, 8)
  return `videos/${Date.now()}-${random}.${ext}`
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

async function readPayload(req: Request): Promise<{ buffer: Buffer; mimeType: string; ext: string }> {
  const contentTypeHeader = String(req.headers['content-type'] || '')

  if (contentTypeHeader.includes('multipart/form-data')) {
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of req) {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array)
      total += buf.length
      if (total > MAX_UPLOAD_BYTES) throw new UploadError(413, 'File terlalu besar (maks 200 MB)')
      chunks.push(buf)
    }
    const parsed = parseMultipartFile(Buffer.concat(chunks), contentTypeHeader)
    if (!parsed) throw new UploadError(400, 'Could not parse file from multipart body')
    if (parsed.fileBuffer.length === 0) throw new UploadError(400, 'File kosong')
    const { mimeType, ext } = resolveMediaType(parsed.mimeType, parsed.fileName)
    return { buffer: parsed.fileBuffer, mimeType, ext }
  }

  const { url } = req.body || {}
  if (!url || typeof url !== 'string') throw new UploadError(400, 'url is required')
  return fetchExternalMedia(url)
}

// Preflight tidak membawa Authorization — biarkan middleware CORS global yang menjawab.
router.options('/', (_req: Request, res: Response) => {
  res.sendStatus(204)
})

router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id
  if (!userId) return res.status(401).json({ ok: false, error: 'Access token required' })

  if (!takeUploadSlot(userId)) {
    return res.status(429).json({ ok: false, error: 'Terlalu banyak upload — coba lagi beberapa menit lagi' })
  }

  let payload: { buffer: Buffer; mimeType: string; ext: string }
  try {
    payload = await readPayload(req)
  } catch (err) {
    if (err instanceof UploadError) return res.status(err.status).json({ ok: false, error: err.message })
    console.error('[r2-upload] payload error:', err)
    return res.status(500).json({ ok: false, error: 'Upload gagal' })
  }

  const key = generateKey(payload.ext)

  const r2 = await getR2Client()
  if (r2) {
    try {
      await r2.client.send(new r2.PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: payload.buffer,
        ContentType: payload.mimeType,
      }))

      const cdnUrl = R2_PUBLIC_URL
        ? `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`
        : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.dev/${key}`
      return res.status(200).json({ ok: true, url: cdnUrl, key, storage: 'r2' })
    } catch (err: any) {
      console.error('[r2-upload] error:', err?.message || err)
      // Jangan langsung gagal total — lanjut ke bilik disk di bawah.
    }
  }

  // Fallback disk: kredensial R2 belum di-set (atau upload ke R2 gagal).
  try {
    ensureUploadDir()
    fs.writeFileSync(path.join(UPLOAD_DIR, key), payload.buffer)
    return res.status(200).json({ ok: true, url: diskPublicUrl(req, key), key, storage: 'disk' })
  } catch (err: any) {
    console.error('[r2-upload] disk fallback error:', err?.message || err)
    return res.status(500).json({ ok: false, error: 'Upload gagal' })
  }
})

export default router
