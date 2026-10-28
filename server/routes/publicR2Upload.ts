import { Router, Request, Response } from 'express'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import {
  MAX_UPLOAD_BYTES,
  UploadError,
  fetchExternalMedia,
  resolveMediaType,
  takeUploadSlot,
} from '../lib/uploadGuards.js'
import { diskPublicUrl, storeMedia } from '../lib/mediaStorage.js'

const router = Router()

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

  try {
    const stored = await storeMedia(payload.buffer, {
      ext: payload.ext,
      mimeType: payload.mimeType,
      prefix: 'videos',
    })
    return res.status(200).json({
      ok: true,
      url: stored.cdnUrl || diskPublicUrl(req, stored.key),
      key: stored.key,
      storage: stored.storage,
    })
  } catch (err: any) {
    console.error('[r2-upload] simpan gagal:', err?.message || err)
    return res.status(500).json({ ok: false, error: 'Upload gagal' })
  }
})

export default router
