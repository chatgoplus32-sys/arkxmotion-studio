// Tes lib Seavi — murni dengan fetch stub (tanpa jaringan).
// Kontrak upstream terverifikasi via probe nyata: POST /generate → 202 {id,...},
// GET /generate/{id}/status → {status, progress, result:{url,format}}.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildSeaviPayload,
  generateSeaviImage,
  getSeaviSpec,
  pollSeaviStatus,
  SEAVI_IMAGE_MODELS,
  SEAVI_MODELS,
  SEAVI_VIDEO_UPSCALER,
  submitSeaviGeneration,
} from '../src/lib/seavi.js'

type SeaviStubRes = { status: number; body: unknown }

function withFetchStub<T>(impl: (url: string, init?: RequestInit) => SeaviStubRes | Promise<SeaviStubRes>, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input)
    const { status, body } = await impl(url, init)
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return fn().finally(() => {
    globalThis.fetch = real
  })
}

// ── Spesifikasi model ────────────────────────────────────────────────────────

test('SEAVI_MODELS: 11 model aktif terdaftar dan spec kunci tersedia', () => {
  assert.equal(Object.keys(SEAVI_MODELS).length, 11)
  assert.ok(getSeaviSpec('seedance2_multi_s15'))
  assert.ok(getSeaviSpec('motion_control_v3_server16'))
  assert.equal(getSeaviSpec('model_ngawur'), undefined)
})

// ── buildSeaviPayload: image modes ──────────────────────────────────────────

test('payload i2v: 1 gambar → image_url + params lengkap', () => {
  const spec = getSeaviSpec('veo31_s9')!
  const p = buildSeaviPayload(spec, {
    imageUrls: ['https://x/cat.png'],
    prompt: 'zoom lambat',
    aspectRatio: '9:16',
    duration: 8,
  })
  assert.deepEqual(p, {
    model: 'veo31_s9',
    input: { image_url: 'https://x/cat.png' },
    params: { prompt: 'zoom lambat', aspect_ratio: '9:16', duration: 8 },
  })
})

test('payload i2v: gambar 0 atau 2 ditolak', () => {
  const spec = getSeaviSpec('kling3_server10')!
  assert.throws(() => buildSeaviPayload(spec, { imageUrls: [], prompt: 'x' }), /tepat 1 gambar/)
  assert.throws(
    () => buildSeaviPayload(spec, { imageUrls: ['a', 'b'], prompt: 'x' }),
    /tepat 1 gambar/,
  )
})

test('payload multi: seedance2_multi_s15 menerima 1-3 gambar → image_urls', () => {
  const spec = getSeaviSpec('seedance2_multi_s15')!
  const p = buildSeaviPayload(spec, { imageUrls: ['a', 'b', 'c'], prompt: 'x' })
  assert.deepEqual(p.input, { image_urls: ['a', 'b', 'c'] })
  assert.throws(() => buildSeaviPayload(spec, { imageUrls: [], prompt: 'x' }), /menerima|butuh/)
  assert.throws(() => buildSeaviPayload(spec, { imageUrls: ['1', '2', '3', '4'], prompt: 'x' }), /menerima 1-3 gambar/)
})

test('payload multimodal: seedance25_server19 boleh tanpa media, video ≤3', () => {
  const spec = getSeaviSpec('seedance25_server19')!
  const p = buildSeaviPayload(spec, { prompt: 'hanya prompt' })
  assert.deepEqual(p.input, {})
  const withVids = buildSeaviPayload(spec, { videoUrls: ['v1', 'v2'], prompt: 'x' })
  assert.deepEqual(withVids.input, { video_url: 'v1' }) // API Seavi: video_url tunggal
  assert.throws(
    () => buildSeaviPayload(spec, { videoUrls: ['1', '2', '3', '4'], prompt: 'x' }),
    /maksimal 3 video/,
  )
})

// ── buildSeaviPayload: motion control ───────────────────────────────────────

test('payload MC: butuh gambar + video, prompt opsional, tanpa aspect/durasi', () => {
  const spec = getSeaviSpec('motion_control_v3_server16')!
  const p = buildSeaviPayload(spec, {
    imageUrls: ['img'],
    videoUrls: ['vid'],
    prompt: 'follow moves',
    aspectRatio: '9:16', // harus diabaikan (MC tanpa aspect_ratio)
    duration: 10, // harus diabaikan
  })
  assert.deepEqual(p.input, { image_url: 'img', video_url: 'vid' })
  assert.deepEqual(p.params, { prompt: 'follow moves' })
  assert.throws(
    () => buildSeaviPayload(spec, { imageUrls: ['img'], prompt: '' }),
    /tepat 1 video referensi/,
  )
  assert.throws(
    () => buildSeaviPayload(spec, { videoUrls: ['vid'], prompt: '' }),
    /tepat 1 gambar/,
  )
})

// ── buildSeaviPayload: prompt & audio ───────────────────────────────────────

test('prompt wajib ditolak bila kosong; panjang dibatasi', () => {
  const spec = getSeaviSpec('veo31_s9')!
  assert.throws(() => buildSeaviPayload(spec, { imageUrls: ['i'], prompt: '   ' }), /Prompt wajib/)
  assert.throws(
    () => buildSeaviPayload(spec, { imageUrls: ['i'], prompt: 'x'.repeat(2001) }),
    /maksimal 2000/,
  )
})

test('audio ditolak di model tanpa audio; diterima di model ber-audio', () => {
  assert.throws(
    () => buildSeaviPayload(getSeaviSpec('veo31_s9')!, { imageUrls: ['i'], prompt: 'x', audioUrl: 'a.mp3' }),
    /tidak menerima audio/,
  )
  const ok = buildSeaviPayload(getSeaviSpec('wan30_server19')!, {
    imageUrls: ['i'],
    prompt: 'x',
    audioUrl: 'a.mp3',
    duration: 15,
  })
  assert.equal(ok.input.audio_url, 'a.mp3')
  assert.equal(ok.params.duration, 15)
})

test('MC tanpa prompt: prompt kosong tidak error (promptRequired=false)', () => {
  const spec = getSeaviSpec('motion_control_v3_server10_30dtk')!
  const p = buildSeaviPayload(spec, { imageUrls: ['i'], videoUrls: ['v'] })
  assert.deepEqual(p.params, {})
})

// ── submitSeaviGeneration ───────────────────────────────────────────────────

test('submit: 202 → id diekstrak; 401 → error kode UNAUTHORIZED', async () => {
  await withFetchStub(
    () => ({ status: 202, body: { id: 'req_abc123', status: 'queued', token_cost: 1 } }),
    async () => {
      const id = await submitSeaviGeneration('sea-key', {
        model: 'veo31_s9',
        input: { image_url: 'x' },
        params: { prompt: 'p' },
      })
      assert.equal(id, 'req_abc123')
    },
  )
  await withFetchStub(
    () => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'The API key is missing or invalid.' } } }),
    async () => {
      await assert.rejects(
        submitSeaviGeneration('sea-bad', { model: 'veo31_s9', input: {}, params: {} }),
        /UNAUTHORIZED/,
      )
    },
  )
})

// ── pollSeaviStatus ─────────────────────────────────────────────────────────

test('poll: processing → completed mengembalikan URL hasil', async () => {
  let n = 0
  const out = await withFetchStub(
    () => {
      n++
      if (n < 3) return { status: 200, body: { id: 'r1', status: 'processing', progress: 40 } }
      return {
        status: 200,
        body: {
          id: 'r1',
          status: 'completed',
          progress: 100,
          result: { url: 'https://cdn.seavilabs.site/x.mp4', format: 'mp4' },
        },
      }
    },
    () =>
      pollSeaviStatus('sea-key', 'r1', {
        onStatus: () => {}, // sleep dipanggil via await — stub membuat loop cepat karena status jadi completed
      }),
  )
  assert.equal(out.url, 'https://cdn.seavilabs.site/x.mp4')
  assert.equal(out.format, 'mp4')
})

test('poll: failed → error dengan kode + info refund', async () => {
  await withFetchStub(
    () => ({
      status: 200,
      body: { id: 'r2', status: 'failed', error: { code: 'CONTENT_SAFETY_REJECTED', message: 'ganti media' } },
    }),
    async () => {
      await assert.rejects(
        pollSeaviStatus('sea-key', 'r2'),
        /content safety|direfund/i,
      )
    },
  )
})

test('poll: HTTP 5xx sementara dilompati, bukan gagal permanen', async () => {
  let n = 0
  const out = await withFetchStub(
    () => {
      n++
      if (n < 2) return { status: 502, body: { ok: false, error: 'boom' } }
      return {
        status: 200,
        body: { id: 'r3', status: 'completed', result: { url: 'https://cdn/x.mp4', format: 'mp4' } },
      }
    },
    () => pollSeaviStatus('sea-key', 'r3'),
  )
  assert.equal(out.url, 'https://cdn/x.mp4')
})


// ── Image models & upscaler ─────────────────────────────────────────────────

test('SEAVI_IMAGE_MODELS: 4 model image terdaftar; payload tanpa referensi sah', () => {
  assert.equal(Object.keys(SEAVI_IMAGE_MODELS).length, 4)
  const spec = SEAVI_IMAGE_MODELS['gpt_image2_s9']
  const p = buildSeaviPayload(spec, { prompt: 'sunset indah', aspectRatio: '16:9' })
  assert.deepEqual(p.input, {})
  assert.equal(p.params.aspect_ratio, '16:9')
})

test('image model: aspek di luar opsi diabaikan; prompt wajib', () => {
  const spec = SEAVI_IMAGE_MODELS['nano_banana_2_server9']
  const p = buildSeaviPayload(spec, { prompt: 'x', aspectRatio: '21:9' })
  assert.equal(p.params.aspect_ratio, undefined)
  assert.throws(() => buildSeaviPayload(spec, { prompt: '' }), /Prompt wajib/)
})

test('upscaler: video wajib, gambar ditolak', () => {
  assert.throws(() => buildSeaviPayload(SEAVI_VIDEO_UPSCALER, {}), /tepat 1 video referensi/)
  assert.throws(
    () => buildSeaviPayload(SEAVI_VIDEO_UPSCALER, { videoUrls: ['v'], imageUrls: ['i'] }),
    /tidak menerima gambar/,
  )
  const ok = buildSeaviPayload(SEAVI_VIDEO_UPSCALER, { videoUrls: ['v'] })
  assert.deepEqual(ok.input, { video_url: 'v' })
})

test('generateSeaviImage: poll image completed → URL string', async () => {
  let n = 0
  const real = globalThis.fetch
  globalThis.fetch = (async () => {
    n++
    if (n === 1) {
      return new Response(JSON.stringify({ id: 'img1', status: 'queued' }), { status: 202 })
    }
    return new Response(JSON.stringify({
      id: 'img1', status: 'completed', progress: 100,
      result: { url: 'https://cdn.seavilabs.site/img.png', format: 'png' },
    }), { status: 200 })
  }) as typeof fetch
  try {
    const url = await generateSeaviImage('sea-key', { model: 'gpt_image2_s9', input: {}, params: { prompt: 'x' } })
    assert.equal(url, 'https://cdn.seavilabs.site/img.png')
  } finally {
    globalThis.fetch = real
  }
})
