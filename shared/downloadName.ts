/**
 * Nama file untuk unduhan hasil generate (dipakai server & dicerminkan klien).
 *
 * Video Motion Control bisa besar; unduhan lewat proxy harus membawa header
 * Content-Disposition: attachment dengan nama yang aman — CR/LF/kutip must go,
 * ASCII fallback untuk `filename=`, versi UTF-8 di `filename*` (RFC 5987).
 */
export function sanitizeDownloadName(raw: string, fallback = 'video.mp4'): string {
  const base = String(raw || '').split(/[\\/]/).pop() || ''
  const clean = base
    .replace(/[\r\n"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return clean && !/^\.+$/.test(clean) ? clean : fallback
}

/** Hanya karakter ASCII aman untuk header filename="...". */
export function asciiSafeFilename(name: string): string {
  const s = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return s || 'video.mp4'
}

/** Nilai header Content-Disposition: attachment + nama file (RFC 5987). */
export function contentDispositionFilename(raw: string): string {
  const name = sanitizeDownloadName(raw)
  return `attachment; filename="${asciiSafeFilename(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`
}
