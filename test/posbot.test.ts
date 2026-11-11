// Tes lib PosBot — murni dengan fetch stub (tanpa jaringan).
// Kontrak dari dokumen resmi v1: POST /generate → {success, job_code},
// GET /status/<job_code> → {status, progress, result_url}; saldo Rupiah.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPosbotPayload,
  fetchPosbotBalance,
  formatPosbotRupiah,
  getPosbotSpec,
  isValidPosbotKey,
  listPosbotModelIds,
  normalizePosbotKey,
  pollPosbotStatus,
  posbotModelsByCategory,
  submitPosbotGeneration,
} from '../src/lib/posbot.js'

type StubRes = { status: number; body: unknown }

function withFetchStub<T>(impl: (url: string, init?: RequestInit) => StubRes | Promise<StubRes>, fn: () => Promise<T>): Promise<T> {
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

// ── Katalog ────────────────────────────────────────────────────────────────

test('katalog: 61 model aktif terbagi per kategori, id unik', () => {
  assert.equal(listPosbotModelIds().length, 61)
  assert.equal(listPosbotModelIds().length, new Set(listPosbotModelIds()).size)
  assert.equal(posbotModelsByCategory('image').length, 12)
  assert.equal(posbotModelsByCategory('image_edit').length, 2)
  assert.equal(posbotModelsByCategory('video').length, 22)
  assert.equal(posbotModelsByCategory('lipsync').length, 2)
  assert.equal(posbotModelsByCategory('motion').length, 8)
  assert.equal(posbotModelsByCategory('upscale').length, 1)
  assert.equal(posbotModelsByCategory('r2v').length, 5)
  assert.equal(posbotModelsByCategory('tts', 'music').length, 9)
})

test('katalog: tarif Rupiah kunci sesuai dokumen developer', () => {
  assert.equal(getPosbotSpec('gpt_image_25')?.price, 350)
  assert.equal(getPosbotSpec('gpt_image_25')?.promptMax, 20000)
  assert.equal(getPosbotSpec('seedream_5_pro_2k')?.promptMax, 3000)
  assert.equal(getPosbotSpec('omni_flash_11_720p')?.price, 1000)
  assert.equal(getPosbotSpec('kling_30_pro')?.price, 3000)
  assert.equal(getPosbotSpec('seedance_25_30s_r2v')?.price, 6500)
  assert.equal(getPosbotSpec('google_tts')?.price, 500)
  assert.equal(getPosbotSpec('nano_banana_2_4k')?.promptMax, 2000)
  assert.equal(getPosbotSpec('model_ngawur'), undefined)
  assert.equal(formatPosbotRupiah(6500), `Rp ${(6500).toLocaleString('id-ID')}`)
})

// ── buildPosbotPayload: video ──────────────────────────────────────────────

test('payload i2v: gambar + prompt, aspek di luar daftar diabaikan', () => {
  const spec = getPosbotSpec('omni_flash_i2v')!
  const body = buildPosbotPayload(spec, { imageUrl: 'https://x/a.jpg', prompt: 'kamera maju', aspectRatio: '1:1' })
  assert.deepEqual(body, {
    model: 'omni_flash_i2v',
    notify_telegram: false,
    prompt: 'kamera maju',
    image_url: 'https://x/a.jpg',
    aspect_ratio: '1:1',
  })
  assert.equal(buildPosbotPayload(spec, { imageUrl: 'a', prompt: 'x', aspectRatio: '4:3' }).aspect_ratio, undefined)
  assert.throws(() => buildPosbotPayload(spec, { prompt: 'x' }), /tepat 1 gambar/)
})

test('payload t2v: gambar ditolak; prompt tetap wajib', () => {
  const spec = getPosbotSpec('omni_flash_t2v')!
  assert.throws(
    () => buildPosbotPayload(spec, { imageUrl: 'a', prompt: 'x' }),
    /tidak menerima gambar/,
  )
  assert.throws(() => buildPosbotPayload(spec, { prompt: '  ' }), /Prompt wajib/)
})

test('payload mode Omni Flash 1.1: sfv butuh 1 gambar, r2v butuh video, t2v bebas gambar', () => {
  const spec = getPosbotSpec('omni_flash_11_720p')!
  assert.throws(() => buildPosbotPayload(spec, { prompt: 'x', mode: 'sfv' }), /tepat 1 gambar/)
  assert.throws(() => buildPosbotPayload(spec, { prompt: 'x', mode: 'r2v', imageUrl: 'a' }), /video referensi/)
  assert.throws(() => buildPosbotPayload(spec, { prompt: 'x', mode: 'nope' }), /Mode nope/)
  const t2v = buildPosbotPayload(spec, { prompt: 'x', mode: 't2v' })
  assert.equal(t2v.mode, 't2v')
  assert.equal(t2v.image_url, undefined)
  assert.equal(t2v.aspect_ratio, undefined)
})

test('payload tanpa aspect_ratio: Wan 3.0 HD mengabaikan rasio', () => {
  const spec = getPosbotSpec('wan_30_hd')!
  const body = buildPosbotPayload(spec, { imageUrl: 'a', prompt: 'ombak', aspectRatio: '9:16' })
  assert.equal(body.aspect_ratio, undefined)
})

test('payload prompt dibatasi per model; Seedance T2V minimal 3 karakter', () => {
  const seedream = getPosbotSpec('seedream_45')!
  assert.throws(() => buildPosbotPayload(seedream, { prompt: 'x'.repeat(2001) }), /maksimal 2000/)
  const gpt = getPosbotSpec('gpt_image_25')!
  const long = buildPosbotPayload(gpt, { prompt: 'x'.repeat(5000) })
  assert.equal(String(long.prompt).length, 5000)
  const seedance = getPosbotSpec('s2_seedance_25_30s')!
  assert.throws(() => buildPosbotPayload(seedance, { prompt: 'ab', mode: 't2v' }), /minimal 3/)
})

// ── buildPosbotPayload: motion & lipsync ───────────────────────────────────

test('motion: butuh gambar + video, prompt opsional, negative prompt diteruskan', () => {
  const spec = getPosbotSpec('motion_control_std')!
  const body = buildPosbotPayload(spec, {
    imageUrl: 'img.jpg',
    videoUrl: 'moves.mp4',
    prompt: 'ikuti gerakan',
    negativePrompt: 'blur',
    aspectRatio: '9:16',
  })
  assert.deepEqual(body, {
    model: 'motion_control_std',
    notify_telegram: false,
    prompt: 'ikuti gerakan',
    image_url: 'img.jpg',
    video_url: 'moves.mp4',
    negative_prompt: 'blur',
  })
  assert.throws(() => buildPosbotPayload(spec, { imageUrl: 'img', prompt: '' }), /video referensi/)
  assert.throws(() => buildPosbotPayload(spec, { videoUrl: 'v' }), /tepat 1 gambar/)
  assert.equal('prompt' in buildPosbotPayload(spec, { imageUrl: 'i', videoUrl: 'v' }), false)
})

test('motion Kling 3.0: duration hanya dikirim bila termasuk pilihan', () => {
  const spec = getPosbotSpec('kling_30_std')!
  assert.equal(buildPosbotPayload(spec, { imageUrl: 'i', videoUrl: 'v', duration: 30 }).duration, 30)
  assert.equal(buildPosbotPayload(spec, { imageUrl: 'i', videoUrl: 'v', duration: 25 }).duration, undefined)
  const beta = getPosbotSpec('betamotion_hd')!
  assert.equal(buildPosbotPayload(beta, { imageUrl: 'i', videoUrl: 'v', duration: 30 }).duration, undefined)
})

test('lipsync: audio wajib; video tidak diterima', () => {
  const spec = getPosbotSpec('minimax_lipsync')!
  assert.throws(() => buildPosbotPayload(spec, { imageUrl: 'face.jpg' }), /file audio/)
  const body = buildPosbotPayload(spec, { imageUrl: 'face.jpg', audioUrl: 'voice.mp3' })
  assert.deepEqual(body, { model: 'minimax_lipsync', notify_telegram: false, image_url: 'face.jpg', audio_url: 'voice.mp3' })
  assert.throws(
    () => buildPosbotPayload(spec, { imageUrl: 'f', audioUrl: 'a', videoUrl: 'v' }),
    /tidak menerima video/,
  )
})

// ── buildPosbotPayload: image edit, music, tts ─────────────────────────────

test('face_swap: wajib gambar target + gambar wajah sumber', () => {
  const spec = getPosbotSpec('face_swap')!
  assert.throws(() => buildPosbotPayload(spec, { imageUrl: 'target.jpg' }), /gambar wajah sumber/)
  const body = buildPosbotPayload(spec, { imageUrl: 'target.jpg', swapImage: 'face.jpg' })
  assert.equal(body.image_url, 'target.jpg')
  assert.equal(body.swap_image, 'face.jpg')
  assert.throws(() => buildPosbotPayload(getPosbotSpec('upscale_4k')!, { imageUrl: 'i', swapImage: 's' }), /tidak menerima parameter swap/)
})

test('music: prompt + lirik + instrumental; gambar tidak diterima', () => {
  const spec = getPosbotSpec('suno_v6')!
  const body = buildPosbotPayload(spec, {
    prompt: 'pop akustik hangat',
    lyrics: '[Verse 1]\nhalo',
    instrumental: false,
  })
  assert.deepEqual(body, {
    model: 'suno_v6',
    notify_telegram: false,
    prompt: 'pop akustik hangat',
    lyrics: '[Verse 1]\nhalo',
    instrumental: false,
  })
  assert.throws(() => buildPosbotPayload(spec, { prompt: 'x', imageUrl: 'i' }), /tidak menerima gambar/)
  assert.throws(() => buildPosbotPayload(spec, { prompt: '' }), /Prompt wajib/)
})

test('tts: voice diteruskan; model musik tanpa lirik tidak mengirim lyrics', () => {
  const tts = buildPosbotPayload(getPosbotSpec('google_tts')!, { prompt: 'selamat pagi', voice: 'id-ID-Wavenet-B' })
  assert.equal(tts.voice, 'id-ID-Wavenet-B')
  const lyria = buildPosbotPayload(getPosbotSpec('lyria_35')!, { prompt: 'ambient', lyrics: 'abaikan', instrumental: true })
  assert.equal(lyria.lyrics, undefined)
  assert.equal(lyria.instrumental, undefined)
})

// ── submit ─────────────────────────────────────────────────────────────────

test('submit: job_code diekstrak dari respons datar & bersarang', async () => {
  await withFetchStub(
    (url, init) => {
      assert.match(url, /\/api\/public\/posbot\?path=generate$/)
      assert.equal(init?.method, 'POST')
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer pb_live_test1234')
      return { status: 200, body: { success: true, job_code: 'job_abc123' } }
    },
    async () => {
      const id = await submitPosbotGeneration('pb_live_test1234', { model: 'gpt_image_25', prompt: 'x' })
      assert.equal(id, 'job_abc123')
    },
  )
  await withFetchStub(
    () => ({ status: 200, body: { success: true, data: { job_code: 'job_nested' } } }),
    async () => {
      assert.equal(await submitPosbotGeneration('pb_live_test1234', { model: 'x' }), 'job_nested')
    },
  )
})

test('submit: success:false dan respons tanpa job_code ditolak', async () => {
  await withFetchStub(
    () => ({ status: 400, body: { success: false, error: { code: 'prompt_too_long', message: 'Prompt terlalu panjang' } } }),
    async () => {
      await assert.rejects(
        submitPosbotGeneration('pb_live_test1234', { model: 'x' }),
        /prompt_too_long.*Prompt terlalu panjang/,
      )
    },
  )
  await withFetchStub(
    () => ({ status: 200, body: { success: true } }),
    async () => {
      await assert.rejects(submitPosbotGeneration('pb_live_test1234', { model: 'x' }), /tanpa job_code/)
    },
  )
})

// ── poll & balance ─────────────────────────────────────────────────────────

test('poll: completed di tick pertama → result_url', async () => {
  await withFetchStub(
    (url) => {
      assert.match(url, /path=status\/job_abc123$/)
      return { status: 200, body: { success: true, status: 'completed', progress: 100, result_url: 'https://cdn.posbot/x.mp4' } }
    },
    async () => {
      const out = await pollPosbotStatus('pb_live_test1234', 'job_abc123')
      assert.equal(out.url, 'https://cdn.posbot/x.mp4')
    },
  )
})

test('poll: failed → pesan refund otomatis', async () => {
  await withFetchStub(
    () => ({ status: 200, body: { success: true, status: 'failed', error: 'engine error' } }),
    async () => {
      await assert.rejects(pollPosbotStatus('pb_live_test1234', 'job_x'), /direfund otomatis: engine error/)
    },
  )
})

test('balance: saldo_generate dibaca sebagai angka Rupiah', async () => {
  await withFetchStub(
    (url) => {
      assert.match(url, /path=balance$/)
      return { status: 200, body: { success: true, user_id: 7, saldo_generate: 12500, currency: 'IDR' } }
    },
    async () => {
      const out = await fetchPosbotBalance('pb_live_test1234')
      assert.equal(out.ok, true)
      assert.equal(out.balance, 12500)
      assert.equal(out.currency, 'IDR')
    },
  )
  await withFetchStub(
    () => ({ status: 401, body: { success: false, error: 'Invalid API key' } }),
    async () => {
      const out = await fetchPosbotBalance('pb_bad')
      assert.equal(out.ok, false)
      assert.match(String(out.error), /Invalid API key/)
    },
  )
})

// ── kunci ──────────────────────────────────────────────────────────────────

test('kunci: prefix Bearer dibuang; format pb_ divalidasi', () => {
  assert.equal(normalizePosbotKey('  Bearer pb_live_abc12345 '), 'pb_live_abc12345')
  assert.equal(isValidPosbotKey('pb_live_abc12345'), true)
  assert.equal(isValidPosbotKey('Bearer pb_live_abc12345'), true)
  assert.equal(isValidPosbotKey('pb_short'), false)
  assert.equal(isValidPosbotKey('sk-other'), false)
})
