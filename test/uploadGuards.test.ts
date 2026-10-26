// ─── Guard endpoint upload: anti-SSRF + validasi media + rate limit ──────────
// Endpoint /api/public/r2-upload dulu terbuka tanpa login dan menerima URL
// apa pun: siapa pun bisa menyuruh VPS menjangkau 127.0.0.1/169.254.169.254
// lalu membaca hasilnya lewat URL publik. Test ini mengunci perilaku guard.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  UploadError,
  assertSafeSourceUrl,
  isBlockedAddress,
  resolveMediaType,
  takeUploadSlot,
} from '../server/lib/uploadGuards.js'

test('tolak alamat internal dan loopback', async () => {
  const blocked = [
    'http://localhost/file.mp4',
    'http://foo.localhost/file.mp4',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://127.0.0.1/file.mp4',
    'http://127.8.9.10/file.mp4',
    'http://10.0.0.5/file.mp4',
    'http://172.20.1.1/file.mp4',
    'http://192.168.1.1/file.mp4',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/file.mp4',
    'http://0.0.0.0/file.mp4',
    'http://[::1]/file.mp4',
    'http://[fd00::1]/file.mp4',
    'http://[fe80::1]/file.mp4',
  ]
  for (const url of blocked) {
    await assert.rejects(() => assertSafeSourceUrl(url), UploadError, `harus ditolak: ${url}`)
  }
})

test('tolak protokol non-http dan URL berkredensial', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com/a.mp4', 'gopher://example.com/a']) {
    await assert.rejects(() => assertSafeSourceUrl(url), UploadError)
  }
  await assert.rejects(() => assertSafeSourceUrl('https://user:pass@example.com/a.mp4'), UploadError)
})

test('IP publik literal tetap diizinkan', async () => {
  await assert.doesNotReject(() => assertSafeSourceUrl('https://1.1.1.1/video.mp4'))
  await assert.doesNotReject(() => assertSafeSourceUrl('https://[2606:4700:4700::1111]/video.mp4'))
})

test('isBlockedAddress konsisten untuk IPv4-mapped IPv6', () => {
  assert.equal(isBlockedAddress('::ffff:127.0.0.1'), true)
  assert.equal(isBlockedAddress('::1'), true)
  assert.equal(isBlockedAddress('8.8.8.8'), false)
  assert.equal(isBlockedAddress('bukan-ip'), true)
})

test('hanya MIME media yang diterima', () => {
  assert.deepEqual(resolveMediaType('video/mp4'), { mimeType: 'video/mp4', ext: 'mp4' })
  assert.deepEqual(resolveMediaType('audio/mpeg; charset=binary'), { mimeType: 'audio/mpeg', ext: 'mp3' })
  assert.deepEqual(resolveMediaType('image/png'), { mimeType: 'image/png', ext: 'png' })
  assert.deepEqual(resolveMediaType('application/octet-stream', 'hasil.MP4'), { mimeType: 'video/mp4', ext: 'mp4' })
  assert.throws(() => resolveMediaType('text/html'), UploadError)
  assert.throws(() => resolveMediaType('application/octet-stream', 'malware.exe'), UploadError)
  assert.throws(() => resolveMediaType('application/json'), UploadError)
})

test('rate limit upload per user', () => {
  const userId = 987654321
  let allowed = 0
  for (let i = 0; i < 61; i++) {
    if (takeUploadSlot(userId)) allowed++
  }
  assert.equal(allowed, 60)
  assert.equal(takeUploadSlot(userId), false)
  assert.equal(takeUploadSlot(userId + 1), true)
})
