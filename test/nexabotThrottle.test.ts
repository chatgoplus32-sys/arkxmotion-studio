// ─── Test retry sadar-throttle NexaBot (503 "dibatasi upstream") ─────────────
// 503 throttle dari nexabot.id membawa hitungan mundur di body ("Coba lagi
// dalam ~141s"). Dulu submit langsung gagal dan user menekan Generate lagi —
// yang justru memperbesar window throttle. Sekarang: tunggu sesuai anjuran
// (dipendekkan 3s, min. 5s) lalu submit ulang otomatis.
import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  NexabotThrottleError,
  parseNexabotThrottleSeconds,
  runWithNexabotThrottleRetry,
} from '../src/lib/nexabot.js'

afterEach(() => {
})

test('parseNexabotThrottleSeconds membaca hitungan dari body 503', () => {
  const body = '{"ok":false,"error":"Server gambar sedang dibatasi upstream. Coba lagi dalam ~141s."}'
  assert.equal(parseNexabotThrottleSeconds(body), 141)
  assert.equal(parseNexabotThrottleSeconds('Coba lagi dalam 60s.'), 60)
  assert.equal(parseNexabotThrottleSeconds('error lain'), null)
  assert.equal(parseNexabotThrottleSeconds(''), null)
})

test('runWithNexabotThrottleRetry: throttle → tunggu → sukses (fake sleep)', async () => {
  const waits: number[] = []
  let calls = 0
  const result = await runWithNexabotThrottleRetry(
    async () => {
      calls++
      if (calls === 1) throw new NexabotThrottleError(30)
      if (calls === 2) throw new NexabotThrottleError(10)
      return 'video-url'
    },
    {
      onThrottle: (s) => waits.push(s),
      sleep: async (ms) => { waits.push(-ms) }, // negatif = durasi sleep
    },
  )
  assert.equal(result, 'video-url')
  assert.equal(calls, 3)
  // onThrottle dipanggil dengan anjuran upstream
  assert.deepEqual(waits.filter((w) => w > 0), [30, 10])
  // sleep = max(5, s-3) detik
  const sleeps = waits.filter((w) => w < 0).map((w) => -w)
  assert.deepEqual(sleeps, [27000, 7000])
})

test('runWithNexabotThrottleRetry: error lain langsung diteruskan', async () => {
  let calls = 0
  await assert.rejects(
    () =>
      runWithNexabotThrottleRetry(
        async () => {
          calls++
          throw new Error('API key tidak valid')
        },
        { sleep: async () => {} },
      ),
    /API key tidak valid/,
  )
  assert.equal(calls, 1)
})

test('runWithNexabotThrottleRetry: menyerah bila total menunggu melebihi batas', async () => {
  let calls = 0
  await assert.rejects(
    () =>
      runWithNexabotThrottleRetry(
        async () => {
          calls++
          throw new NexabotThrottleError(600)
        },
        { maxTotalMs: 60_000, sleep: async () => {} },
      ),
    /masih dibatasi upstream/,
  )
  assert.equal(calls, 1)
})
