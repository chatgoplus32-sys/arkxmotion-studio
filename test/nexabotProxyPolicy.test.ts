// ─── Test kebijakan timeout & retry proxy NexaBot (murni) ───────────────────
// Dipakai bersama oleh server/routes/nexabot.ts (lokal) dan
// api/public/nexabot.ts (Vercel). Yang dikunci di sini: request READ-ONLY boleh
// diulang, submit/generate TIDAK, dan Retry-After dari upstream dihormati tapi
// tetap dibatasi supaya proxy tidak ikut menggantung.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NEXABOT_PROXY_POLICY,
  NEXABOT_PROXY_RETRY,
  NexabotUpstreamError,
  fetchNexabotUpstream,
  isNexabotNonIdempotentAction,
  isNexabotProxyTransientStatus,
  nexabotErrorAdvice,
  nexabotErrorCause,
  nexabotProxyDelayMs,
  nexabotProxyRetryConfig,
  nexabotRelayHeaders,
  parseNexabotRetryAfterMs,
} from '../shared/nexabotProxy.js'

function timeoutError() {
  const err: any = new Error('The operation was aborted due to timeout')
  err.name = 'TimeoutError'
  return err
}

/** Kegagalan jaringan seperti yang dilempar undici: TypeError + `cause` asli. */
function fetchFailedError(code = 'ECONNRESET', message = 'socket hang up') {
  const cause: any = new Error(message)
  cause.code = code
  const err: any = new TypeError('fetch failed')
  err.cause = cause
  return err
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

/** Respons dengan `cancel` yang bisa dipantau (harus dipanggil untuk respons dibuang). */
function cancellableResponse(status: number, onCancel: () => void, headers: Record<string, string> = {}) {
  const res = jsonResponse({ ok: false }, status, headers)
  Object.defineProperty(res, 'body', { value: { cancel: onCancel }, configurable: true })
  return res
}

/** Susun fetch palsu: tiap pemanggilan memakai entri berikutnya. */
function fakeFetch(steps: Array<() => Response>) {
  const calls: number[] = []
  const fetchImpl = (async () => {
    const step = steps.shift()
    if (!step) throw new Error(`fetch dipanggil ke-${calls.length + 1} tanpa langkah berikutnya`)
    calls.push(calls.length + 1)
    return step()
  }) as unknown as typeof fetch
  return { fetchImpl, calls, remaining: () => steps.length }
}

test('policy: read-only boleh diulang, submit/generate tidak', () => {
  for (const action of ['credit', 'session', 'job', 'modes'] as const) {
    assert.ok(NEXABOT_PROXY_POLICY[action].attempts > 1, `${action} harus retryable`)
  }
  for (const action of ['submit', 'generate', 'download', 'generic'] as const) {
    assert.equal(NEXABOT_PROXY_POLICY[action].attempts, 1, `${action} tidak boleh diulang`)
  }
  // Timeout dibedakan per jenis request: poll status jauh lebih pendek daripada submit.
  assert.ok(NEXABOT_PROXY_POLICY.job.timeoutMs < NEXABOT_PROXY_POLICY.submit.timeoutMs)
  assert.equal(NEXABOT_PROXY_POLICY.session.timeoutMs, NEXABOT_PROXY_POLICY.credit.timeoutMs)

  // Anggaran SATU probe saldo/sesi (semua percobaan + jeda retry terburuk)
  // wajib muat di dalam kesabaran klien. Halaman Providers & pemantau sesi
  // memakai NEXABOT_CHECK_TIMEOUT_MS = 55s (src/lib/nexabot.ts). Dulu 30s × 3
  // (~92s) membuat 504 datang setelah klien menyerah di 8–15s — jawaban upstream
  // yang sebenarnya ada (log: sukses di percobaan 2–3) tidak pernah terpakai.
  const worstRetryDelayMs = NEXABOT_PROXY_RETRY.maxRetryAfterMs
  for (const action of ['credit', 'session'] as const) {
    const budgetMs = NEXABOT_PROXY_POLICY[action].timeoutMs * NEXABOT_PROXY_POLICY[action].attempts
      + worstRetryDelayMs * Math.max(0, NEXABOT_PROXY_POLICY[action].attempts - 1)
    assert.ok(budgetMs < 55_000, `anggaran ${action} ${budgetMs}ms harus < timeout klien 55s`)
    assert.ok(budgetMs > NEXABOT_PROXY_POLICY[action].timeoutMs, `${action} harus punya ruang untuk satu retry`)
  }
  for (const policy of Object.values(NEXABOT_PROXY_POLICY)) {
    assert.ok(policy.timeoutMs > 0 && policy.attempts >= 1 && policy.label.length > 0)
  }
})

test('status transient: rate limit & 5xx saja (4xx lain fatal)', () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert.ok(isNexabotProxyTransientStatus(status), `${status} harus transient`)
  }
  for (const status of [200, 301, 400, 401, 402, 403, 404]) {
    assert.equal(isNexabotProxyTransientStatus(status), false, `${status} tidak transient`)
  }
})

test('sukses percobaan pertama: satu panggilan, tanpa menunggu', async () => {
  const { fetchImpl, calls } = fakeFetch([() => jsonResponse({ ok: true, credit: 5 })])
  const sleeps: number[] = []

  const { response, attempts } = await fetchNexabotUpstream('https://nexabot.id/x', {}, {
    action: 'credit',
    fetchImpl,
    sleep: async (ms) => { sleeps.push(ms) },
    random: () => 0.5,
  })

  assert.equal(response.status, 200)
  assert.equal(attempts, 1)
  assert.equal(calls.length, 1)
  assert.deepEqual(sleeps, [])
})

test('timeout sekali lalu sukses: diulang, bukan langsung 504', async () => {
  const { fetchImpl, calls } = fakeFetch([
    () => { throw timeoutError() },
    () => jsonResponse({ ok: true, credit: 5 }),
  ])
  const sleeps: number[] = []

  const { response, attempts } = await fetchNexabotUpstream('https://nexabot.id/x', {}, {
    action: 'credit',
    fetchImpl,
    sleep: async (ms) => { sleeps.push(ms) },
    random: () => 0.5,
  })

  assert.equal(response.status, 200)
  assert.equal(attempts, 2)
  assert.equal(calls.length, 2)
  assert.deepEqual(sleeps, [NEXABOT_PROXY_RETRY.baseMs], 'jeda backoff dasar sebelum percobaan kedua')
})

test('429 diulang dan Retry-After upstream dihormati (dibatasi maxRetryAfterMs)', async () => {
  const { fetchImpl, calls } = fakeFetch([
    () => jsonResponse({ ok: false }, 429, { 'Retry-After': '2' }),
    () => jsonResponse({ ok: true, job: { status: 'queued' } }),
  ])
  const sleeps: number[] = []
  const retries: (number | null)[] = []

  const { attempts } = await fetchNexabotUpstream('https://nexabot.id/job', {}, {
    action: 'job',
    fetchImpl,
    sleep: async (ms) => { sleeps.push(ms) },
    onRetry: (info) => retries.push(info.status),
  })

  assert.equal(attempts, 2)
  assert.equal(calls.length, 2)
  assert.deepEqual(sleeps, [2000], 'lock: menunggu sesuai Retry-After')
  assert.deepEqual(retries, [429])

  // Retry-After ekstrem tidak boleh menahan proxy lebih dari batas.
  const long = fakeFetch([
    () => jsonResponse({ ok: false }, 429, { 'Retry-After': '600' }),
    () => jsonResponse({ ok: true }),
  ])
  const longSleeps: number[] = []
  await fetchNexabotUpstream('https://nexabot.id/job', {}, {
    action: 'job',
    fetchImpl: long.fetchImpl,
    sleep: async (ms) => { longSleeps.push(ms) },
  })
  assert.deepEqual(longSleeps, [NEXABOT_PROXY_RETRY.maxRetryAfterMs])
})

test('5xx beruntun: diulang sampai percobaan habis lalu respons terakhir diteruskan', async () => {
  const { fetchImpl, calls, remaining } = fakeFetch(
    Array.from({ length: NEXABOT_PROXY_POLICY.session.attempts }, () => () => jsonResponse({ ok: false }, 503)),
  )
  const sleeps: number[] = []

  const { response, attempts } = await fetchNexabotUpstream('https://nexabot.id/x', {}, {
    action: 'session',
    fetchImpl,
    sleep: async (ms) => { sleeps.push(ms) },
    random: () => 0.5,
  })

  assert.equal(response.status, 503, 'status upstream diteruskan apa adanya ke klien')
  assert.equal(attempts, NEXABOT_PROXY_POLICY.session.attempts)
  assert.equal(calls.length, NEXABOT_PROXY_POLICY.session.attempts)
  assert.equal(remaining(), 0)
  assert.equal(sleeps.length, NEXABOT_PROXY_POLICY.session.attempts - 1)
})

test('4xx non-transient tidak diulang (sesi mati / key salah)', async () => {
  const { fetchImpl, calls } = fakeFetch([() => jsonResponse({ ok: false, error: 'unauthorized' }, 401)])
  const sleeps: number[] = []

  const { response, attempts } = await fetchNexabotUpstream('https://nexabot.id/x', {}, {
    action: 'credit',
    fetchImpl,
    sleep: async (ms) => { sleeps.push(ms) },
  })

  assert.equal(response.status, 401)
  assert.equal(attempts, 1)
  assert.equal(calls.length, 1)
  assert.deepEqual(sleeps, [])
})

test('submit tanpa retry: satu panggilan walau timeout', async () => {
  const { fetchImpl, calls } = fakeFetch([() => { throw timeoutError() }])

  await assert.rejects(
    () => fetchNexabotUpstream('https://nexabot.id/api', {}, { action: 'submit', fetchImpl, sleep: async () => {} }),
    (err: any) => {
      assert.ok(err instanceof NexabotUpstreamError)
      assert.equal(err.attempts, 1)
      assert.equal(err.timeout, true)
      assert.match(err.message, /submit ke NexaBot/)
      return true
    },
  )
  assert.equal(calls.length, 1, 'job/kredit tidak boleh ganda karena retry')
})

test('semua percobaan gagal (bukan HTTP): error menyebut jumlah percobaan & timeout', async () => {
  const policy = NEXABOT_PROXY_POLICY.credit
  const { fetchImpl, calls } = fakeFetch(
    Array.from({ length: policy.attempts + 2 }, () => () => { throw timeoutError() }),
  )

  await assert.rejects(
    () => fetchNexabotUpstream('https://nexabot.id/x', {}, { action: 'credit', fetchImpl, sleep: async () => {} }),
    (err: any) => {
      assert.equal(err.name, 'NexabotUpstreamError')
      assert.equal(err.attempts, policy.attempts)
      assert.match(err.message, /cek saldo/)
      assert.match(err.message, new RegExp(`${policy.attempts}×${Math.round(policy.timeoutMs / 1000)}s`))
      return true
    },
  )
  assert.equal(calls.length, policy.attempts)
})

test('respons yang dibuang koneksinya ditutup (tidak menggantung)', async () => {
  let cancelled = 0
  const { fetchImpl } = fakeFetch([
    () => cancellableResponse(504, () => { cancelled++ }),
    () => jsonResponse({ ok: true }),
  ])

  await fetchNexabotUpstream('https://nexabot.id/x', {}, {
    action: 'credit',
    fetchImpl,
    sleep: async () => {},
  })

  assert.equal(cancelled, 1)
})

test('Retry-After diteruskan ke klien hanya kalau ada', () => {
  assert.deepEqual(nexabotRelayHeaders(jsonResponse({ ok: false }, 429, { 'Retry-After': '12' })), { 'Retry-After': '12' })
  assert.deepEqual(nexabotRelayHeaders(jsonResponse({ ok: true })), {})
})

test('parse Retry-After & config retry dari env', () => {
  const now = Date.parse('2026-02-01T00:00:00Z')
  assert.equal(parseNexabotRetryAfterMs('5', now), 5000)
  assert.equal(parseNexabotRetryAfterMs(new Date(now + 3000).toUTCString(), now), 3000)
  assert.equal(parseNexabotRetryAfterMs('ngawur', now), null)

  assert.deepEqual(nexabotProxyRetryConfig({} as NodeJS.ProcessEnv), {
    baseMs: NEXABOT_PROXY_RETRY.baseMs,
    maxMs: NEXABOT_PROXY_RETRY.maxMs,
    jitter: NEXABOT_PROXY_RETRY.jitter,
    maxRetryAfterMs: NEXABOT_PROXY_RETRY.maxRetryAfterMs,
  })
  const overridden = nexabotProxyRetryConfig({
    NEXABOT_PROXY_RETRY_BASE_MS: '5',
    NEXABOT_PROXY_RETRY_MAX_MS: '25',
    NEXABOT_PROXY_RETRY_MAX_RETRY_AFTER_MS: '50',
  } as NodeJS.ProcessEnv)
  assert.equal(overridden.baseMs, 5)
  assert.equal(overridden.maxMs, 25)
  assert.equal(overridden.maxRetryAfterMs, 50)
  // Nilai ngawur jatuh ke default, bukan NaN.
  const broken = nexabotProxyRetryConfig({ NEXABOT_PROXY_RETRY_BASE_MS: 'abc' } as NodeJS.ProcessEnv)
  assert.equal(broken.baseMs, NEXABOT_PROXY_RETRY.baseMs)
})

test('backoff berlipat dan dibatasi maxMs', () => {
  const config = { baseMs: 500, maxMs: 4000, jitter: 0, maxRetryAfterMs: 10_000 }
  assert.equal(nexabotProxyDelayMs({ attempt: 1, config }), 500)
  assert.equal(nexabotProxyDelayMs({ attempt: 2, config }), 1000)
  assert.equal(nexabotProxyDelayMs({ attempt: 3, config }), 2000)
  assert.equal(nexabotProxyDelayMs({ attempt: 9, config }), 4000)
})

// ─── Diagnosa kegagalan jaringan ────────────────────────────────────────────
// Insiden nyata: submit menggantung ~61s lalu undici melempar "fetch failed".
// Pesan itu saja tidak memberi tahu APA yang putus, jadi penyebab asli dari
// `err.cause` harus ikut terbawa ke log & ke klien.

test('kegagalan jaringan: penyebab asli (cause) ikut terbaca', () => {
  assert.equal(nexabotErrorCause(fetchFailedError()), 'ECONNRESET: socket hang up')
  assert.equal(nexabotErrorCause(fetchFailedError('UND_ERR_SOCKET', 'other side closed')), 'UND_ERR_SOCKET: other side closed')
  // Tanpa cause (mis. abort) jangan menambah noise.
  assert.equal(nexabotErrorCause(new TypeError('fetch failed')), '')
  assert.equal(nexabotErrorCause(undefined), '')
})

test('error upstream menyertakan cause di pesan (bukan cuma "fetch failed")', async () => {
  const { fetchImpl } = fakeFetch([() => { throw fetchFailedError() }])

  await assert.rejects(
    () => fetchNexabotUpstream('https://nexabot.id/x', {}, {
      action: 'credit', fetchImpl, sleep: async () => {}, policy: { attempts: 1 },
    }),
    (err: any) => {
      assert.match(err.message, /cek saldo/)
      assert.match(err.message, /fetch failed/)
      assert.match(err.message, /ECONNRESET/)
      return true
    },
  )
})

test('saran error berbeda untuk aksi yang bisa membuat job', () => {
  for (const action of ['submit', 'generate'] as const) {
    assert.equal(isNexabotNonIdempotentAction(action), true, `${action} membuat job/kredit`)
    assert.match(nexabotErrorAdvice(action), /MUNGKIN sudah terbentuk/)
    assert.doesNotMatch(nexabotErrorAdvice(action), /^coba lagi$/)
  }
  for (const action of ['credit', 'session', 'job', 'download', 'modes', 'generic'] as const) {
    assert.equal(isNexabotNonIdempotentAction(action), false)
    assert.equal(nexabotErrorAdvice(action), 'coba lagi')
  }
})
