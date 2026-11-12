// Kontrak silang: shared/downloadName.ts (server) dan
// src/lib/downloadExternal.ts (klien) harus menghasilkan nilai yang SAMA.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  sanitizeDownloadName as serverSanitize,
  contentDispositionFilename as serverDisposition,
  asciiSafeFilename as serverAscii,
} from '../shared/downloadName.js'
import {
  sanitizeDownloadName as clientSanitize,
  contentDispositionFilename as clientDisposition,
  proxyDownloadHref,
} from '../src/lib/downloadExternal.js'

const KASUS: Array<[string, string]> = [
  ['video.mp4', 'video.mp4'],
  ['  Keluaran Sesi  File  .webm  ', 'Keluaran Sesi File .webm'],
  ['../../etc/passwd', 'passwd'],
  ['..\\..\\hasil jadi.mp4', 'hasil jadi.mp4'],
  ['"injeksi"\r\nHeader: ya.mp4', 'injeksi Header: ya.mp4'],
  ['.....', 'video.mp4'],
  ['', 'video.mp4'],
  ['mengandung.unicode-\u6f22\u5b57.mp4', 'mengandung.unicode-\u6f22\u5b57.mp4'],
  ['a'.repeat(500) + '.mp4', 'a'.repeat(120)],
]

test('kontrak: sanitize klien === server', () => {
  for (const [input, expected] of KASUS) {
    assert.equal(clientSanitize(input), expected, `sanitize(${JSON.stringify(input)})`)
    assert.equal(serverSanitize(input), expected, `server sanitize(${JSON.stringify(input)})`)
  }
})

test('kontrak: disposition klien === server', () => {
  for (const [input] of KASUS) {
    assert.equal(clientDisposition(input), serverDisposition(input), `disposition(${JSON.stringify(input)})`)
  }
})

test('disposition: attachment + filename ASCII + filename* UTF-8', () => {
  const d = serverDisposition('Keluaran \u6f22\u5b57.mp4')
  assert.match(d, /^attachment; /)
  assert.match(d, /filename="[\x20-\x7E]*"/)
  assert.match(d, /filename\*=UTF-8''/)
  assert.match(d, /filename\*=UTF-8''[\x20-\x7E]+$/) // percent-encoded semuanya ASCII
})

test('ascii fallback tidak memuat karakter non-ASCII / kutip / backslash', () => {
  assert.equal(serverAscii('Keluaran \u6f22\u5b57.mp4'), 'Keluaran __.mp4')
  assert.equal(serverAscii('kutip"back\\slash.mp4'), 'kutip_back_slash.mp4')
})

test('proxyDownloadHref: encode url & nama file', () => {
  const href = proxyDownloadHref('https://cdn.example.com/a b.mp4?x=1&y=2', 'hasil akhir.mp4')
  assert.match(href, /^\/api\/public\/video-proxy\?url=/)
  assert.match(href, /&download=1&name=/)
  assert.ok(href.includes(encodeURIComponent('https://cdn.example.com/a b.mp4?x=1&y=2')))
  assert.ok(href.includes(encodeURIComponent('hasil akhir.mp4')))
})
