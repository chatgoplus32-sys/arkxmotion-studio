/**
 * Perceptual similarity sederhana untuk memfilter hasil generator yang
 * mengembalikan foto input hampir tanpa perubahan (mis. workflow Travel Photo
 * berbasis Qwen-Image yang kadang "echo" foto asli sebagai output).
 */

const HASH_SIZE = 16

async function toBitmap(source: Blob | string): Promise<ImageBitmap> {
  if (typeof source === 'string') {
    const res = await fetch(source, { mode: 'cors' })
    if (!res.ok) throw new Error(`Fetch image gagal: HTTP ${res.status}`)
    return createImageBitmap(await res.blob())
  }
  return createImageBitmap(source)
}

/** Average hash 16x16 grayscale → 256 bit sebagai hex string. */
export async function computeImageHash(source: Blob | string): Promise<string> {
  const bmp = await toBitmap(source)
  const canvas = document.createElement('canvas')
  canvas.width = HASH_SIZE
  canvas.height = HASH_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D context tidak tersedia')
  ctx.drawImage(bmp, 0, 0, HASH_SIZE, HASH_SIZE)
  bmp.close?.()
  const { data } = ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE)
  const grays: number[] = []
  for (let i = 0; i < data.length; i += 4) {
    grays.push((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000)
  }
  const avg = grays.reduce((a, b) => a + b, 0) / grays.length
  let bits = ''
  for (const g of grays) bits += g >= avg ? '1' : '0'
  let hex = ''
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

/** Jarak Hamming antara dua hash hex (0 = identik). */
export function hammingDistance(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let d = 0
  for (let i = 0; i < n; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) { d += x & 1; x >>= 1 }
  }
  return d + Math.abs(a.length - b.length) * 4
}

export interface FilterDuplicationResult {
  kept: string[]
  /** URL yang dibuang beserta alasannya. */
  dropped: Array<{ url: string; reason: 'input-duplicate' | 'duplicate-result' }>
}

/**
 * Buang hasil yang (1) mirip foto input, (2) duplikat hasil lain.
 * threshold dalam satuan bit beda dari 256.
 */
export async function filterDuplicateImages(
  input: Blob,
  urls: string[],
  threshold = 48,
): Promise<FilterDuplicationResult> {
  const kept: string[] = []
  const keptHashes: string[] = []
  const dropped: FilterDuplicationResult['dropped'] = []
  const inputHash = await computeImageHash(input)
  for (const url of urls) {
    let hash: string
    try {
      hash = await computeImageHash(url)
    } catch {
      kept.push(url)
      keptHashes.push('')
      continue
    }
    if (hammingDistance(hash, inputHash) < threshold) {
      dropped.push({ url, reason: 'input-duplicate' })
      continue
    }
    if (keptHashes.some(kh => kh && hammingDistance(hash, kh) < 20)) {
      dropped.push({ url, reason: 'duplicate-result' })
      continue
    }
    kept.push(url)
    keptHashes.push(hash)
  }
  return { kept, dropped }
}
