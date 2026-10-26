import dns from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024
const FETCH_TIMEOUT_MS = 120_000
const MAX_REDIRECTS = 3
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT = 60

export class UploadError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const blockedAddresses = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(address, prefix, 'ipv4')
}
for (const [address, prefix] of [
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['64:ff9b::', 96],
  ['2001::', 32],
  ['2002::', 16],
] as const) {
  blockedAddresses.addSubnet(address, prefix, 'ipv6')
}
blockedAddresses.addAddress('::', 'ipv6')
blockedAddresses.addAddress('::1', 'ipv6')

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata', 'metadata.google.internal', 'instance-data'])

const MIME_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/x-m4v': 'm4v',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const EXT_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  m4v: 'video/x-m4v',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return blockedAddresses.check(address, 'ipv4')
  if (family === 6) {
    if (/^::ffff:/i.test(address)) return true
    return blockedAddresses.check(address, 'ipv6')
  }
  return true
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return (
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  )
}

/** Tolak URL yang bisa dipakai menjangkau jaringan internal (SSRF). */
export async function assertSafeSourceUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UploadError(400, 'URL tidak valid')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UploadError(400, 'Hanya URL http/https yang diizinkan')
  }
  if (url.username || url.password) {
    throw new UploadError(400, 'URL tidak boleh memuat kredensial')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!host) throw new UploadError(400, 'URL tanpa host tidak diizinkan')
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new UploadError(400, 'Alamat tujuan tidak diizinkan')
    return url
  }
  if (isBlockedHostname(host)) throw new UploadError(400, 'Alamat tujuan tidak diizinkan')

  let records: { address: string }[]
  try {
    records = await dns.lookup(host, { all: true, verbatim: true })
  } catch {
    throw new UploadError(400, 'Domain sumber tidak dapat di-resolve')
  }
  if (records.length === 0) throw new UploadError(400, 'Domain sumber tidak dapat di-resolve')
  for (const record of records) {
    if (isBlockedAddress(record.address)) throw new UploadError(400, 'Alamat tujuan tidak diizinkan')
  }
  return url
}

/** Tentukan MIME + ekstensi yang aman; hanya media yang dikenal. */
export function resolveMediaType(contentType: string, fileName = ''): { mimeType: string; ext: string } {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (MIME_EXT[mime]) return { mimeType: mime, ext: MIME_EXT[mime] }

  if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') {
    const base = String(fileName || '').split(/[\\/]/).pop() || ''
    const match = base.match(/\.([a-z0-9]{1,8})$/i)
    const guessed = match ? EXT_MIME[match[1].toLowerCase()] : undefined
    if (guessed && match) return { mimeType: guessed, ext: match[1].toLowerCase() }
  }
  throw new UploadError(400, 'Tipe file tidak didukung (hanya video/audio/gambar)')
}

async function fetchOnce(url: URL): Promise<Response> {
  try {
    return await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: 'video/*,audio/*,image/*',
        'User-Agent': 'ARKXMotion-Studio/1.0',
      },
    })
  } catch {
    throw new UploadError(502, 'Gagal mengambil file dari sumber')
  }
}

/** Ambil media dari URL publik dengan validasi tiap hop redirect + batas ukuran. */
export async function fetchExternalMedia(rawUrl: string): Promise<{ buffer: Buffer; mimeType: string; ext: string }> {
  let current = await assertSafeSourceUrl(rawUrl)

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const res = await fetchOnce(current)

    if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
      const location = res.headers.get('location')
      if (!location) throw new UploadError(502, 'Sumber mengembalikan redirect tanpa tujuan')
      if (redirect === MAX_REDIRECTS) throw new UploadError(400, 'Terlalu banyak redirect')
      current = await assertSafeSourceUrl(new URL(location, current).toString())
      continue
    }
    if (!res.ok) throw new UploadError(502, `Sumber menolak permintaan (${res.status})`)

    const { mimeType, ext } = resolveMediaType(res.headers.get('content-type') || '')
    const declared = Number(res.headers.get('content-length') || '0')
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
      throw new UploadError(413, 'File sumber terlalu besar (maks 200 MB)')
    }
    if (!res.body) throw new UploadError(502, 'Sumber tidak mengirim data')

    const reader = res.body.getReader()
    const chunks: Buffer[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_UPLOAD_BYTES) {
        await reader.cancel().catch(() => {})
        throw new UploadError(413, 'File sumber terlalu besar (maks 200 MB)')
      }
      chunks.push(Buffer.from(value))
    }
    if (total === 0) throw new UploadError(400, 'File sumber kosong')
    return { buffer: Buffer.concat(chunks), mimeType, ext }
  }
  throw new UploadError(400, 'Terlalu banyak redirect')
}

const uploadCounters = new Map<number, number[]>()

/** Batasi jumlah upload per user agar tidak jadi tempat penimbunan file. */
export function takeUploadSlot(userId: number): boolean {
  const now = Date.now()
  const recent = (uploadCounters.get(userId) || []).filter((time) => now - time < RATE_WINDOW_MS)
  if (recent.length >= RATE_LIMIT) {
    uploadCounters.set(userId, recent)
    return false
  }
  recent.push(now)
  uploadCounters.set(userId, recent)
  return true
}
