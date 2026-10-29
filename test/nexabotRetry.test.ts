// ─── Test kebijakan retry NexaBot (murni, tanpa fetch/DOM) ──────────────────
// Dipakai src/lib/nexabot.ts untuk memutuskan kapan sebuah respons upstream
// diulang dan berapa lama menunggu. Salah di sini = job yang masih jalan
// dibuang (fatal padahal transient) atau upstream dibombardir makin kencang.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NEXABOT_SUBMIT_RETRY,
  NEXABOT_TRANSIENT_STATUSES,
  describeNexabotStatus,
  isNexabotTransientStatus,
  nexabotBackoffMs,
  nexabotHttpVerdict,
  nexabotRetryDelayMs,
  nexabotSubmit429Decision,
  parseRetryAfterMs,
} from '../src/lib/nexabotRetry.js'

test('status transient: rate limit, gateway, dan timeout proxy layak diulang', () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504, 522, 524]) {
    assert.ok(isNexabotTransientStatus(status), `${status} harus transient`)
  }
  for (const status of [200, 201, 301, 400, 401, 402, 403, 404, 418]) {
    assert.equal(isNexabotTransientStatus(status), false, `${status} tidak boleh transient`)
  }
  assert.equal(new Set(NEXABOT_TRANSIENT_STATUSES).size, NEXABOT_TRANSIENT_STATUSES.length)
})

test('verdict HTTP: ok / retry / fatal', () => {
  assert.equal(nexabotHttpVerdict(200), 'ok')
  assert.equal(nexabotHttpVerdict(204), 'ok')
  assert.equal(nexabotHttpVerdict(429), 'retry')
  assert.equal(nexabotHttpVerdict(504), 'retry')
  assert.equal(nexabotHttpVerdict(500), 'retry')
  // 4xx lain = permintaan kita yang salah / job hilang / sesi mati → jangan ulang.
  assert.equal(nexabotHttpVerdict(401), 'fatal')
  assert.equal(nexabotHttpVerdict(404), 'fatal')
  assert.equal(nexabotHttpVerdict(400), 'fatal')
})

test('pesan status membedakan rate limit, timeout, dan sesi mati', () => {
  assert.match(describeNexabotStatus(429), /rate limit/i)
  assert.match(describeNexabotStatus(504), /timeout/i)
  assert.match(describeNexabotStatus(503), /bermasalah/i)
  assert.match(describeNexabotStatus(401), /ditolak/i)
  assert.match(describeNexabotStatus(402), /kredit/i)
  assert.match(describeNexabotStatus(404), /tidak ditemukan/i)
  assert.equal(describeNexabotStatus(418), 'NexaBot HTTP 418')
})

test('parseRetryAfterMs: detik, tanggal HTTP, dan nilai ngawur', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')

  assert.equal(parseRetryAfterMs('30', now), 30_000)
  assert.equal(parseRetryAfterMs(' 0 ', now), 0)
  assert.equal(parseRetryAfterMs(new Date(now + 5_000).toUTCString(), now), 5_000)
  // Tanggal yang sudah lewat → 0, bukan negatif.
  assert.equal(parseRetryAfterMs(new Date(now - 60_000).toUTCString(), now), 0)
  assert.equal(parseRetryAfterMs('nanti saja', now), null)
  assert.equal(parseRetryAfterMs('', now), null)
  assert.equal(parseRetryAfterMs(null, now), null)
  assert.equal(parseRetryAfterMs(undefined, now), null)
})

test('backoff tumbuh, dibatasi maxMs, dan tidak pernah negatif', () => {
  const opts = { baseMs: 3000, maxMs: 15000, jitter: 0 }

  assert.equal(nexabotBackoffMs(1, opts), 3000)
  assert.equal(nexabotBackoffMs(2, opts), 4500)
  assert.equal(nexabotBackoffMs(3, opts), 6750)
  assert.equal(nexabotBackoffMs(10, opts), 15000, 'dibatasi maxMs')
  assert.equal(nexabotBackoffMs(0, opts), 3000, 'attempt < 1 tetap jeda dasar')
})

test('jitter menjaga jeda dalam rentang wajar (tidak pernah > maxMs / < 0)', () => {
  const opts = { baseMs: 8000, maxMs: 15000, jitter: 0.5 }
  const lowest = nexabotBackoffMs(1, { ...opts, random: () => 0 })
  const highest = nexabotBackoffMs(1, { ...opts, random: () => 1 })
  const mid = nexabotBackoffMs(1, { ...opts, random: () => 0.5 })

  assert.equal(lowest, 4000)
  assert.equal(mid, 8000)
  assert.equal(highest, 12000)
  assert.ok(lowest >= 0 && highest <= opts.maxMs)
})

test('Retry-After dari upstream diprioritaskan, tapi tetap dibatasi', () => {
  // 7 detik dari upstream → dituruti.
  assert.equal(nexabotRetryDelayMs({ attempt: 1, retryAfterHeader: '7', opts: { baseMs: 3000, maxMs: 15000 } }), 7000)
  // Tanpa header → backoff.
  assert.equal(nexabotRetryDelayMs({ attempt: 2, retryAfterHeader: null, opts: { baseMs: 3000, maxMs: 15000, jitter: 0 } }), 4500)
  // Header ngawur → backoff.
  assert.equal(nexabotRetryDelayMs({ attempt: 1, retryAfterHeader: 'sebentar', opts: { baseMs: 3000, maxMs: 15000, jitter: 0 } }), 3000)
  // Retry-After ekstrem (1 jam) tidak boleh menahan job selama itu.
  assert.equal(nexabotRetryDelayMs({ attempt: 1, retryAfterHeader: '3600', opts: { baseMs: 3000, maxMs: 15000 } }), 30_000)
  assert.equal(
    nexabotRetryDelayMs({ attempt: 1, retryAfterHeader: '3600', opts: { baseMs: 3000, maxMs: 15000, maxRetryAfterMs: 5000 } }),
    5000,
  )
})

// ─── Keputusan submit saat 429 (antrean berbagi akun) ───────────────────────
// Dua member generate bersamaan dulu membuat keduanya mati dengan "rate limit"
// setelah ±5 detik. Sekarang submit sabar: antriannya dipegang relay, dan klien
// hanya perlu menunggu sesuai Retry-After sampai batas anggaran habis.

test('submit 429: menunggu sesuai Retry-After dan mengulang selama percobaan tersisa', () => {
  const d = nexabotSubmit429Decision({
    attempt: 1,
    attempts: NEXABOT_SUBMIT_RETRY.attempts,
    retryAfterHeader: '7',
    sisaBudgetMs: 60_000,
  })
  assert.equal(d.ulang, true)
  assert.equal(d.delayMs, 7000)
  assert.equal(d.akhir, undefined)
})

test('submit 429 dari antrean relay pakai bahasa antrean, bukan bahasa rate limit', () => {
  const antrian = nexabotSubmit429Decision({ attempt: 1, attempts: 4, antrianSendiri: true, sisaBudgetMs: 60_000 })
  const upstream = nexabotSubmit429Decision({ attempt: 1, attempts: 4, antrianSendiri: false, sisaBudgetMs: 60_000 })

  assert.match(antrian.message, /antrean generate penuh/)
  assert.equal(upstream.message, describeNexabotStatus(429))
  assert.notEqual(antrian.message, upstream.message, 'user harus tahu ini giliran member lain, bukan akun yang dibatasi')
})

test('submit 429: percobaan terakhir menyerah dengan pesan yang menjelaskan', () => {
  const d = nexabotSubmit429Decision({
    attempt: 4,
    attempts: 4,
    retryAfterHeader: '10',
    sisaBudgetMs: 60_000,
    sudahMenungguMs: 95_000,
  })
  assert.equal(d.ulang, false)
  assert.match(d.akhir || '', /sudah menunggu ±95s/)
  assert.match(d.akhir || '', /coba lagi dalam 10 detik/)
})

test('submit 429: anggaran habis menghentikan retry walaupun percobaan masih ada', () => {
  const d = nexabotSubmit429Decision({
    attempt: 1,
    attempts: NEXABOT_SUBMIT_RETRY.attempts,
    retryAfterHeader: '30',
    sisaBudgetMs: 5_000,
    sudahMenungguMs: 175_000,
  })
  assert.equal(d.ulang, false, 'menunggu 30s dari sisa 5s = spinner palsu')
  assert.match(d.akhir || '', /sudah menunggu ±175s/)
})

test('anggaran submit jauh lebih sabar daripada yang lama (3×2s)', () => {
  assert.equal(NEXABOT_SUBMIT_RETRY.attempts, 4)
  assert.ok(NEXABOT_SUBMIT_RETRY.budgetMs >= 120_000, 'antrian relay saja bisa menahan 45 detik')
  assert.ok(NEXABOT_SUBMIT_RETRY.maxMs >= 15_000)
})
