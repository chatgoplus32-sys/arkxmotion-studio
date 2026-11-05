// Motion Control Seavi (server23 / 15 dtk) menjawab dengan mp4 tanpa stream audio.
// Pemulihannya: deteksi track audio dari log `ffmpeg -i`, lalu mux audio video
// referensi ke hasil. Kedua bagian itu pure — diuji tanpa ffmpeg & tanpa jaringan.

import test from 'node:test'
import assert from 'node:assert/strict'

import { hasAudioStream, muxAudioArgs, parseDurationSeconds } from '../src/lib/ffmpeg-compress.ts'

const VIDEO_ONLY = [
  'Input #0, mov,mp4,m4a,3gp,3g2,mj2, from "motion_result.mp4":',
  '  Duration: 00:00:15.04, start: 0.000000, bitrate: 1832 kb/s',
  '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x637661), yuv420p(progressive), 1080x1920, 1800 kb/s, 24 fps',
  '    handler_name    : VideoHandler',
]

const WITH_AUDIO = [
  ...VIDEO_ONLY,
  '  Stream #0:1(und): Audio: aac (LC) (mp4a / 0x61346D70), 44100 Hz, stereo, fltp, 128 kb/s (default)',
  '    handler_name    : SoundHandler',
]

test('hasAudioStream: true hanya bila ada stream Audio, bukan teks lain', () => {
  assert.equal(hasAudioStream(WITH_AUDIO), true)
  assert.equal(hasAudioStream(VIDEO_ONLY), false)
  assert.equal(hasAudioStream([]), false)
  // Baris metadata/encoder bukan stream — jangan dianggap suara.
  assert.equal(hasAudioStream(['    handler_name    : SoundHandler', '    vendor_id     : [0][0][0][0]']), false)
  // Format tanpa kurung codec juga harus dikenali.
  assert.equal(hasAudioStream(['  Stream #0:1: Audio: aac, 44100 Hz, stereo, 128 kb/s']), true)
})

test('parseDurationSeconds: ambil durasi dari baris Duration log ffmpeg', () => {
  assert.equal(parseDurationSeconds(VIDEO_ONLY), 15.04)
  assert.equal(parseDurationSeconds(['  Duration: 00:01:05.50, start: 0.000000, bitrate: 1832 kb/s']), 65.5)
  assert.equal(parseDurationSeconds(['tidak ada baris duration']), null)
  // 00:00:00.00 bukan durasi yang berguna → jangan dipakai jadi batas -t
  assert.equal(parseDurationSeconds(['  Duration: 00:00:00.00, start: 0.0']), null)
})

test('muxAudioArgs: audio dipotong sepanjang video hasil, bukan -shortest', () => {
  const args = muxAudioArgs('v.mp4', 'a.mp4', 'out.mp4', 15.04)
  assert.deepEqual(args, [
    '-i', 'v.mp4',
    '-i', 'a.mp4',
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-t', '15.040',
    '-movflags', '+faststart',
    'out.mp4',
  ])
  // -shortest akan memotong VIDEO bila audio referensi lebih pendek — jangan ada.
  assert.equal(args.includes('-shortest'), false)
  assert.equal(args[args.length - 1], 'out.mp4')
})

test('muxAudioArgs: tanpa durasi hasil tetap valid (tanpa -t)', () => {
  const args = muxAudioArgs('v.mp4', 'a.mp4', 'out.mp4', null)
  assert.equal(args.includes('-t'), false)
  assert.equal(args.includes('-shortest'), false)
  assert.deepEqual(args.slice(0, 6), ['-i', 'v.mp4', '-i', 'a.mp4', '-map', '0:v:0'])
})
