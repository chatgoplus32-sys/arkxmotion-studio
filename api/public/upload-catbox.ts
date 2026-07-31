import type { VercelRequest, VercelResponse } from '@vercel/node'

export const config = { api: { bodyParser: false } }

function parseMultipartField(raw: Buffer, contentType: string): { fileBuffer: Buffer; fileName: string; mimeType: string } | null {
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
      const nameMatch = headers.match(/name="([^"]+)"/)
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

async function uploadToCatbox(fileBuffer: Buffer, fileName: string, mimeType: string): Promise<string | null> {
  try {
    const fd = new FormData()
    fd.append('reqtype', 'fileupload')
    fd.append('fileToUpload', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), fileName)
    const res = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: fd })
    const text = (await res.text()).trim()
    if (res.ok && text.startsWith('http')) return text
    console.log('[upload] catbox failed:', res.status, text.slice(0, 200))
  } catch (e: any) { console.log('[upload] catbox error:', e.message) }
  return null
}

async function uploadToLitterbox(fileBuffer: Buffer, fileName: string, mimeType: string): Promise<string | null> {
  try {
    const fd = new FormData()
    fd.append('reqtype', 'fileupload')
    fd.append('time', '72h')
    fd.append('fileToUpload', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), fileName)
    const res = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', { method: 'POST', body: fd })
    const text = (await res.text()).trim()
    if (res.ok && text.startsWith('http')) return text
    console.log('[upload] litterbox failed:', res.status, text.slice(0, 200))
  } catch (e: any) { console.log('[upload] litterbox error:', e.message) }
  return null
}

async function uploadToPixeldrain(fileBuffer: Buffer, fileName: string, mimeType: string): Promise<string | null> {
  try {
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), fileName)
    const res = await fetch('https://pixeldrain.com/api/file', { method: 'POST', body: fd })
    const data = await res.json().catch(() => null) as any
    if (res.ok && data?.id) return `https://pixeldrain.com/api/file/${data.id}`
    console.log('[upload] pixeldrain failed:', res.status, JSON.stringify(data).slice(0, 200))
  } catch (e: any) { console.log('[upload] pixeldrain error:', e.message) }
  return null
}

async function uploadTo0x0(fileBuffer: Buffer, fileName: string, mimeType: string): Promise<string | null> {
  try {
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), fileName)
    const res = await fetch('https://0x0.st', { method: 'POST', body: fd })
    const text = (await res.text()).trim()
    if (res.ok && text.startsWith('http')) return text
    console.log('[upload] 0x0 failed:', res.status, text.slice(0, 200))
  } catch (e: any) { console.log('[upload] 0x0 error:', e.message) }
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  try {
    const chunks: Uint8Array[] = []
    for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    const rawBody = Buffer.concat(chunks)
    const contentType = req.headers['content-type'] || ''

    const parsed = parseMultipartField(rawBody, contentType)
    if (!parsed) return res.status(400).json({ ok: false, error: 'Could not parse file from multipart body' })

    const { fileBuffer, fileName, mimeType } = parsed
    console.log(`[upload] file: ${fileName} (${(fileBuffer.length / 1024).toFixed(1)}KB, ${mimeType})`)

    const catboxUrl = await uploadToCatbox(fileBuffer, fileName, mimeType)
    if (catboxUrl) return res.status(200).json({ ok: true, url: catboxUrl })

    const litterUrl = await uploadToLitterbox(fileBuffer, fileName, mimeType)
    if (litterUrl) return res.status(200).json({ ok: true, url: litterUrl })

    const pdUrl = await uploadToPixeldrain(fileBuffer, fileName, mimeType)
    if (pdUrl) return res.status(200).json({ ok: true, url: pdUrl })

    const zeroUrl = await uploadTo0x0(fileBuffer, fileName, mimeType)
    if (zeroUrl) return res.status(200).json({ ok: true, url: zeroUrl })

    return res.status(502).json({ ok: false, error: 'All upload providers failed' })
  } catch (err: any) {
    console.error('[upload] error:', err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
