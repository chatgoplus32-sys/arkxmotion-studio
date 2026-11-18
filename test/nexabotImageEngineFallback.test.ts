// ─── Fallback mesin /api/v1/image mati → jalur job /api/v1/gpt-image ────────
// Kejadian nyata 16 Nov 2026: nexabot.id menjawab HTTP 502
// {"error":"image engine initialization failed (401).","refunded":true} untuk
// model non-GPT (nano_banana_2 dkk.) di endpoint sinkron /api/v1/image, sementara
// mesin job /api/v1/gpt-image (dipakai halaman webnya) tetap hidup dan menerima
// semua model lewat field `model`.
//
// Yang dijaga:
//  - error NON-mesin (throttle, sesi app, auth) TIDAK memicu fallback;
//  - fallback memakai model & rasio yang sama (rasio dipetakan ke enum angka);
//  - model yang ditolak mesin job diulang tanpa `model` (default GPT Image 2.5).
import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { generateNexabotImageResilient, isNexabotImageEngineError } from '../src/lib/nexabot.js'

const originalFetch = globalThis.fetch
const originalObjectURL = (URL as any).createObjectURL

let langkah: Array<{ status?: number; body?: unknown; contentType?: string }> = []
let calls: { url: string; body: any }[] = []

beforeEach(() => {
  langkah = []
  calls = []
  // Node tidak punya URL.createObjectURL — cukup untuk pengujian.
  ;(URL as any).createObjectURL = (blob: Blob) => `blob:uji-${(blob as any).size}`
  globalThis.fetch = (async (input: any, init: any) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(init.body) : undefined })
    const next = langkah.shift()
    if (!next) throw new Error(`fetch dipanggil ke-${calls.length} tanpa langkah berikutnya`)
    const payload = next.body == null ? undefined : (typeof next.body === 'string' ? next.body : JSON.stringify(next.body))
    const headers: Record<string, string> = {}
    if (next.contentType) headers['Content-Type'] = next.contentType
    return new Response(payload, { status: next.status ?? 200, headers })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  ;(URL as any).createObjectURL = originalObjectURL
})

const pollCepat = { baseMs: 1, maxMs: 2, random: () => 0.5, maxTotalMs: 5_000 }

test('mesin sinkron mati (502 engine init) → otomatis beralih ke jalur job gpt-image', async () => {
  const log: string[] = []
  langkah = [
    // 1) POST /image: mesin sinkron gagal init (kejadian nyata).
    { status: 502, body: { ok: false, error: 'image engine initialization failed (401).', refunded: true } },
    // 2) POST /gpt-image: submit job dengan model yang sama.
    { status: 200, body: { ok: true, id: 'gptjob-1', cost: 0.1, credit_balance: 9.9 } },
    // 3) Poll: langsung selesai.
    { status: 200, body: { ok: true, job: { status: 'completed', images: [{ url: '/api/v1/gpt-image/gptjob-1/download?index=0' }] } } },
    // 4) Download: byte gambar.
    { status: 200, body: 'PNGPNG', contentType: 'image/png' },
  ]

  const hasil = await generateNexabotImageResilient({
    prompt: 'kucing oren petugas pajak',
    model: 'nano_banana_2',
    aspect: '9:16',
    resolution: '1K',
  }, 'nxb_kunci', { onLog: (m) => log.push(m), poll: pollCepat })

  assert.equal(hasil.ok, true)
  assert.equal(hasil.viaJobFallback, true, 'hasil ditandai berasal dari fallback')
  assert.equal(hasil.model, 'nano_banana_2')
  assert.equal(hasil.creditCost, 0.1)
  assert.equal(hasil.creditBalance, 9.9)
  assert.match(hasil.url, /^blob:/, 'hasil diunduh sebagai blob (URL butuh kredensial)')

  // Submit fallback: model dipertahankan, rasio 9:16 → enum 5, resolution dihilangkan
  // (mesin job tidak menerima field itu).
  assert.match(calls[1].url, /\/gpt-image$/)
  assert.equal(calls[1].body.model, 'nano_banana_2')
  assert.equal(calls[1].body.aspect, 5)
  assert.equal(calls[1].body.resolution, undefined)
  assert.match(calls[3].url, /\/gpt-image\/gptjob-1\/download/)

  assert.ok(log.some((m) => m.includes('Mesin /api/v1/image mati')), 'fallback diumumkan di log')
})

test('model ditolak mesin job → diulang tanpa model (default GPT Image 2.5)', async () => {
  langkah = [
    { status: 502, body: { ok: false, error: 'image engine initialization failed (401).', refunded: true } },
    { status: 400, body: { ok: false, error: 'model tidak dikenal' } },
    { status: 200, body: { ok: true, id: 'gptjob-2', cost: 0.1 } },
    { status: 200, body: { ok: true, job: { status: 'completed', images: [{ url: '/api/v1/gpt-image/gptjob-2/download?index=0' }] } } },
    { status: 200, body: 'PNGPNG', contentType: 'image/png' },
  ]

  const hasil = await generateNexabotImageResilient({
    prompt: 'x',
    model: 'nano_banana_2_lite',
    aspect: '1:1',
  }, 'nxb_kunci', { poll: pollCepat })

  assert.equal(hasil.ok, true)
  assert.equal(calls[1].body.model, 'nano_banana_2_lite', 'percobaan pertama memakai model diminta')
  assert.equal(calls[2].body.model, undefined, 'percobaan kedua tanpa model = default upstream')
  assert.equal(calls[2].body.aspect, 1, 'rasio 1:1 tetap dipetakan ke enum 1')
})

test('error non-mesin tidak memicu fallback (throttle & auth diteruskan)', async () => {
  // Throttle antrean relay → NexabotThrottleError, tanpa request tambahan.
  langkah = [{ status: 429, body: { ok: false, queued: true, retry_after_seconds: 30, error: 'Antrian penuh' } }]
  await assert.rejects(
    generateNexabotImageResilient({ prompt: 'x', model: 'nano_banana_2' }, 'nxb_kunci', { poll: pollCepat }),
    (err: any) => err?.name === 'NexabotThrottleError',
  )
  assert.equal(calls.length, 1, 'tidak ada request fallback')

  // Mesin mati, tapi submit fallback kena 401 → error auth diteruskan apa adanya.
  langkah = [
    { status: 502, body: { ok: false, error: 'image engine initialization failed (401).', refunded: true } },
    { status: 401, body: { ok: false, error: 'unauthorized' } },
  ]
  await assert.rejects(
    generateNexabotImageResilient({ prompt: 'x', model: 'nano_banana_2' }, 'nxb_kunci', { poll: pollCepat }),
    /API key tidak valid/,
  )
})

test('error 5xx tanpa ciri mesin tetap diteruskan tanpa fallback', async () => {
  langkah = [{ status: 500, body: { ok: false, error: 'internal error lain' } }]
  await assert.rejects(
    generateNexabotImageResilient({ prompt: 'x', model: 'nano_banana_2' }, 'nxb_kunci', { poll: pollCepat }),
    /NexaBot HTTP 500/,
  )
  assert.equal(calls.length, 1)
})

test('isNexabotImageEngineError mengenali variasi pesan mesin', () => {
  assert.equal(isNexabotImageEngineError('NexaBot HTTP 502: {"error":"image engine initialization failed (401)."}'), true)
  assert.equal(isNexabotImageEngineError('NexaBot HTTP 503: image engine is starting'), true)
  assert.equal(isNexabotImageEngineError('NexaBot: Kredit tidak cukup (perlu 0.1)'), false)
  assert.equal(isNexabotImageEngineError(''), false)
  assert.equal(isNexabotImageEngineError(undefined), false)
})
