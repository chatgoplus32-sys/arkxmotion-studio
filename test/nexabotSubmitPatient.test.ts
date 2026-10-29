// ─── Submit NexaBot yang sabar menghadapi antrean ──────────────────────────
// Kesalahan lama: 429 membuat submit menyerah setelah ±5 detik (3 percobaan,
// jeda 2s), padahal penyebabnya adalah beberapa member berbagi satu akun
// NexaBot — keadaannya berlangsung puluhan detik, bukan sesaat. Sekarang
// relay mengantre (fase 1a) dan klien ikut bersabar (fase 1b).
//
// Yang tidak boleh berubah: 5xx/timeout TETAP sekali jalan, karena job bisa
// saja sudah terbentuk di upstream dan mengulang = kredit terpotong dua kali.
import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { submitNexabot, submitNexabotGptImage } from '../src/lib/nexabot.js'

const originalFetch = globalThis.fetch

let langkah: Array<{ status: number; body: unknown; headers?: Record<string, string> }> = []
let calls: { url: string; body: any }[] = []

beforeEach(() => {
  langkah = []
  calls = []
  globalThis.fetch = (async (input: any, init: any) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(init.body) : undefined })
    const next = langkah.shift()
    if (!next) throw new Error(`fetch dipanggil ke-${calls.length} tanpa langkah berikutnya`)
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json', ...next.headers },
    })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

/** Jeda dibuat nyaris nol supaya test tidak menunggu; header Retry-After sengaja tidak ada. */
const cepat = { baseMs: 1, maxMs: 2, random: () => 0.5 }

test('429 dari antrean relay diulang sampai dapat, dan user diberi tahu alasannya', async () => {
  const pesan: string[] = []
  langkah = [
    { status: 429, body: { ok: false, queued: true, retry_after_seconds: 3, error: 'Antrian generate penuh' } },
    { status: 429, body: { ok: false, queued: true, retry_after_seconds: 3, error: 'Antrian generate penuh' } },
    { status: 200, body: { ok: true, job_id: 'job-setelah-mengantre' } },
  ]

  const hasil = await submitNexabot({ mode: 't2v', prompt: 'kucing makan ikan hiu' }, 'nxb_kunci', {
    ...cepat,
    onRetry: ({ message }) => pesan.push(message),
  })

  assert.equal(hasil.ok, true)
  assert.equal(hasil.jobId, 'job-setelah-mengantre')
  assert.equal(calls.length, 3, 'dua percobaan diulang, tiga request ke relay')
  assert.deepEqual(pesan, [
    'antrean generate penuh — member lain sedang jalan',
    'antrean generate penuh — member lain sedang jalan',
  ], 'log memakai bahasa antrean, bukan bahasa rate limit')
})

test('429 biasa (rate limit upstream) tetap diulang dengan pesannya sendiri', async () => {
  const pesan: string[] = []
  langkah = [
    { status: 429, body: { ok: false, error: 'Rate limit' } },
    { status: 200, body: { ok: true, job_id: 'job-kena-rate-limit' } },
  ]

  const hasil = await submitNexabot({ mode: 't2v', prompt: 'satu' }, 'nxb_kunci', {
    ...cepat,
    onRetry: ({ message }) => pesan.push(message),
  })

  assert.equal(hasil.ok, true)
  assert.deepEqual(pesan, ['NexaBot membatasi permintaan (rate limit)'])
})

test('Retry-After dari relay dipakai sebagai lama menunggu', async () => {
  const jedanya: number[] = []
  langkah = [
    { status: 429, body: { ok: false, queued: true }, headers: { 'Retry-After': '2' } },
    { status: 200, body: { ok: true, job_id: 'job-setelah-retry-after' } },
  ]

  const mulai = Date.now()
  const hasil = await submitNexabot({ mode: 't2v', prompt: 'satu' }, 'nxb_kunci', {
    ...cepat,
    onRetry: ({ delayMs }) => jedanya.push(delayMs),
  })

  assert.equal(hasil.ok, true)
  assert.deepEqual(jedanya, [2000], 'jeda mengikuti anjuran server, bukan backoff')
  assert.ok(Date.now() - mulai >= 1900, 'dan klien benar-benar menunggu selama itu')
})

test('429 upstream biasa tetap dibatasi jumlah percobaan', async () => {
  langkah = [1, 2, 3, 4].map(() => ({ status: 429, body: { ok: false, error: 'Rate limit' } }))

  await assert.rejects(
    () => submitNexabot({ mode: 't2v', prompt: 'satu' }, 'nxb_kunci', cepat),
    /NexaBot membatasi permintaan \(rate limit\)/,
  )
  assert.equal(calls.length, 4, 'nol job terbentuk — 429 selalu berarti upstream tidak menerima')
})

test('antrean relay TIDAK dibatasi jumlah percobaan — hanya anggaran waktunya', async () => {
  const pesan: string[] = []
  langkah = [
    ...Array.from({ length: 6 }, () => ({ status: 429, body: { ok: false, queued: true } })),
    { status: 200, body: { ok: true, job_id: 'job-giliran-akhir' } },
  ]

  const hasil = await submitNexabot({ mode: 't2v', prompt: 'satu' }, 'nxb_kunci', {
    ...cepat,
    onRetry: ({ message }) => pesan.push(message),
  })

  assert.equal(hasil.ok, true)
  assert.equal(hasil.jobId, 'job-giliran-akhir')
  assert.equal(calls.length, 7, 'enam kali mengantre lalu dapat — jauh melewati attempts (4)')
  assert.equal(pesan.length, 6)
  assert.ok(pesan.every((m) => m.includes('antrean generate penuh')), 'tetap memakai bahasa antrean')
})

test('anggaran antrean habis → berhenti dengan alasan antrean, bukan menggantung', async () => {
  langkah = [1, 2, 3].map(() => ({ status: 429, body: { ok: false, queued: true } }))

  await assert.rejects(
    () => submitNexabot({ mode: 't2v', prompt: 'satu' }, 'nxb_kunci', { ...cepat, queueBudgetMs: 0 }),
    /antrean generate masih penuh/,
  )
  assert.equal(calls.length, 1, 'sisa anggaran 0 → tidak ada jeda yang dihabiskan')
})

test('5xx tetap sekali jalan: job bisa sudah terbentuk, kredit tidak boleh ganda', async () => {
  langkah = [{ status: 502, body: { ok: false, error: 'gateway bermasalah' } }]

  await assert.rejects(
    () => submitNexabot({ mode: 't2v', prompt: 'satu' }, 'nxb_kunci', cepat),
    /NexaBot HTTP 502/,
  )
  assert.equal(calls.length, 1)
})

test('submit GPT Image ikut sabar menghadapi antrean', async () => {
  const pesan: string[] = []
  langkah = [
    { status: 429, body: { ok: false, queued: true } },
    { status: 200, body: { ok: true, id: 'img-setelah-mengantre' } },
  ]

  const hasil = await submitNexabotGptImage({ prompt: 'poster' }, 'nxb_kunci', {
    ...cepat,
    onRetry: ({ message }) => pesan.push(message),
  })

  assert.equal(hasil.ok, true)
  assert.equal(hasil.id, 'img-setelah-mengantre')
  assert.deepEqual(pesan, ['antrean generate penuh — member lain sedang jalan'])
})
