import fs from 'node:fs'
import path from 'node:path'
import type { Request } from 'express'

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ''
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || ''
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || ''
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || ''
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || ''

/** Folder fallback saat kredensial R2 belum diisi. */
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')

/**
 * URL publik file disk. Wajib lewat /api/* karena nginx hanya mem-proxy path itu
 * ke express; path lain dijawab sebagai file frontend statis.
 */
export const DISK_FILE_BASE = '/api/public/r2-file'

export interface StoredMedia {
  key: string
  storage: 'r2' | 'disk'
  /** Null untuk penyimpanan disk — pemanggil membangun URL-nya dari request. */
  cdnUrl: string | null
}

export function makeStorageKey(prefix: string, ext: string): string {
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}/${Date.now()}-${random}.${ext}`
}

/** URL publik file disk — dibangun dari header request (di belakang nginx). */
export function diskPublicUrl(req: Pick<Request, 'headers' | 'secure'>, key: string): string {
  const proto = String(req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')).split(',')[0].trim()
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'
  return `${proto}://${host}${DISK_FILE_BASE}/${key}`
}

async function getR2Client(): Promise<any> {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) return null
  try {
    // Dynamic import: file ini ESM (package.json "type":"module"), jadi `require`
    // TIDAK ada saat runtime.
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    })
    return { client, PutObjectCommand }
  } catch (err: any) {
    console.error('[media-storage] gagal memuat @aws-sdk/client-s3:', err?.message || err)
    return null
  }
}

/**
 * Simpan media ke R2 bila dikonfigurasi, kalau tidak (atau R2 menolak) ke disk
 * VPS. Kredensial R2 yang nanti diisi di .env otomatis memakai jalur R2 lagi.
 */
export async function storeMedia(
  buffer: Buffer,
  opts: { ext: string; mimeType: string; prefix?: string },
): Promise<StoredMedia> {
  const prefix = opts.prefix || 'videos'
  const key = makeStorageKey(prefix, opts.ext)

  const r2 = await getR2Client()
  if (r2) {
    try {
      await r2.client.send(new r2.PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: opts.mimeType,
      }))
      const cdnUrl = R2_PUBLIC_URL
        ? `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`
        : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.dev/${key}`
      return { key, storage: 'r2', cdnUrl }
    } catch (err: any) {
      console.error('[media-storage] R2 error:', err?.message || err)
    }
  }

  const target = path.join(UPLOAD_DIR, key)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, buffer)
  return { key, storage: 'disk', cdnUrl: null }
}
