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
 * Umur maksimal file hasil generate di disk (hari). 0 = retention mati.
 * Tanpa R2, uploads/ adalah satu-satunya tempat hasil video disimpan, jadi
 * tanpa pemangkasan disk VPS penuh dalam hitungan hari — dan saat disk penuh
 * nginx tidak bisa men-buffer body, sehingga browser menerima halaman HTML
 * ("Unexpected token '<'") alih-alih JSON.
 */
export const UPLOAD_RETENTION_DAYS = (() => {
  const raw = (process.env.UPLOAD_RETENTION_DAYS ?? '').trim()
  if (!raw) return 3
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 3
})()

/** Sisa ruang minimum sebelum menolak menulis hasil baru (byte). */
const MIN_FREE_BYTES = 200 * 1024 * 1024

/**
 * Ke mana hasil generate disimpan sekarang — dicatat saat boot supaya tidak
 * perlu menebak dari log unggahan pertama. "Terkonfigurasi" di sini hanya
 * berarti kuncinya lengkap; bukti round-trip tetap `scripts/verify-r2.mjs`.
 */
export function mediaStorageMode(): { backend: 'r2' | 'disk'; detail: string } {
  const lengkap = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME)
  if (!lengkap) {
    return {
      backend: 'disk',
      detail: `${UPLOAD_DIR} · dipangkas otomatis setelah ${UPLOAD_RETENTION_DAYS} hari`,
    }
  }
  return {
    backend: 'r2',
    detail:
      `bucket "${R2_BUCKET_NAME}"` +
      (R2_PUBLIC_URL ? ` · publik ${R2_PUBLIC_URL}` : ' · R2_PUBLIC_URL kosong (URL publik pakai r2.dev)'),
  }
}

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

/** Ruang bebas disk untuk folder penyimpanan (null kalau tidak terbaca). */
export function freeDiskBytes(dir = UPLOAD_DIR): number | null {
  try {
    const st: any = (fs as any).statfsSync?.(dir)
    if (!st) return null
    return Number(st.bavail) * Number(st.bsize)
  } catch {
    return null
  }
}

/**
 * Hapus file hasil generate yang lebih tua dari `maxAgeDays`.
 * Hanya file biasa di dalam UPLOAD_DIR — symlink dan subfolder aneh dilewati.
 */
export function pruneOldUploads(maxAgeDays = UPLOAD_RETENTION_DAYS): {
  deleted: number
  bytes: number
  failed: number
  skipped: boolean
} {
  const hasil = { deleted: 0, bytes: 0, failed: 0, skipped: false }
  if (!(maxAgeDays > 0)) {
    hasil.skipped = true
    return hasil
  }
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000

  const jelajah = (dir: string) => {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) { jelajah(target); continue }
      if (!entry.isFile()) continue
      try {
        const st = fs.statSync(target)
        if (st.mtimeMs >= cutoff) continue
        const size = st.size
        fs.unlinkSync(target)
        hasil.deleted += 1
        hasil.bytes += size
      } catch {
        hasil.failed += 1
      }
    }
  }

  try { jelajah(UPLOAD_DIR) } catch (err: any) {
    console.error('[media-storage] prune gagal:', err?.message || err)
  }
  return hasil
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
  const sisa = freeDiskBytes()
  if (sisa !== null && sisa < MIN_FREE_BYTES) {
    throw new Error(
      `Penyimpanan VPS penuh (sisa ${Math.round(sisa / 1048576)}MB). ` +
      'Hasil tidak bisa disimpan — retention uploads akan membebaskan ruang, atau isi kredensial R2.',
    )
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, buffer)
  return { key, storage: 'disk', cdnUrl: null }
}
