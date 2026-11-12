/**
 * Unduh file eksternal (video/gambar hasil generate) lewat proxy VPS.
 *
 * Kenapa bukan fetch → blob → objectURL: seluruh file dibuffer di memori
 * browser — untuk video Motion Control yang besar (atau ponsel), proses itu
 * gagal diam-diam dan tombol download seolah tidak menghasilkan. Proxy
 * menjawab dengan `Content-Disposition: attachment`, sehingga browser langsung
 * streaming ke disk dengan nama file yang diminta, tanpa CORS.
 *
 * sanitizeDownloadName/contentDispositionFilename di bawah adalah CERMIN dari
 * shared/downloadName.ts — dijaga tes kontrak silang (test/downloadName.test.ts).
 */

export function sanitizeDownloadName(raw: string, fallback = 'video.mp4'): string {
  const base = String(raw || '').split(/[\\/]/).pop() || ''
  const clean = base
    .replace(/[\r\n"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  // jangan biarkan nama kosong atau sekadar titik-titik
  return clean && !/^\.+$/.test(clean) ? clean : fallback
}

function asciiSafe(name: string): string {
  const s = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return s || 'video.mp4'
}

/** Nilai header Content-Disposition: attachment + nama file (RFC 5987). */
export function contentDispositionFilename(raw: string): string {
  const name = sanitizeDownloadName(raw)
  return `attachment; filename="${asciiSafe(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** URL same-origin ke proxy dengan mode unduhan + nama file. */
export function proxyDownloadHref(url: string, filename: string): string {
  const name = sanitizeDownloadName(filename)
  return `/api/public/video-proxy?url=${encodeURIComponent(url)}&download=1&name=${encodeURIComponent(name)}`
}

/**
 * Preflight HEAD dulu: kalau upstream gagal, jangan mulai unduhan — caller
 * bisa fallback ke cara lain. Mengembalikan true kalau unduhan dimulai.
 */
export async function downloadExternalViaProxy(url: string, filename: string): Promise<boolean> {
  if (typeof document === 'undefined') return false
  const href = proxyDownloadHref(url, filename)
  try {
    const head = await fetch(href, { method: 'HEAD' })
    if (!head.ok) return false
  } catch {
    return false
  }
  const a = document.createElement('a')
  a.href = href
  a.download = sanitizeDownloadName(filename)
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  return true
}
