// ─── Test wrapper fetch relay (murni, fetch di-stub tanpa jaringan) ─────────
// Yang dijaga di sini bukan "retry jalan", tapi BIDANG retry: mengulang request
// yang sudah sempat terkirim bisa membuat job berbayar di upstream terbentuk
// dua kali sementara saldo member terpotong sekali. Salah klasifikasi = uang
// operator hilang atau gangguan sesaat malah jadi 502.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  describeFetchError,
  fetchWithProviderRetry,
  fetchWithRetry,
  fetchWithTimeout,
  FetchTimeoutError,
  isRetryableFetchError,
} from '../server/lib/fetchTimeout.js'

/** Error gaya undici: `fetch failed` dengan alasan asli di `cause`. */
function netError(code: string, message = 'fetch failed'): any {
  const err: any = new TypeError(message)
  err.cause = Object.assign(new Error(`${code}`), { code })
  return err
}

function abortError(): any {
  const err: any = new Error('This operation was aborted')
  err.name = 'AbortError'
  return err
}

function stubFetch(handler: (url: string, init: RequestInit | undefined, attempt: number) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input)
    calls.push({ url, init })
    return handler(url, init, calls.length)
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = real } }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * Seperti fetch asli saat connection-nya macet: promise-nya tidak pernah
 * selesai sendiri, hanya batal ketika signal aborted.
 */
const menggantung = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(abortError()))
  })

// ── Klasifikasi error ────────────────────────────────────────────────────────

test('gagal tahap koneksi: boleh diulang walau metodenya POST berbayar', () => {
  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT']) {
    assert.ok(isRetryableFetchError(netError(code), 'POST'), `${code} harus layak diulang`)
  }
})

test('gagal setelah request terkirim: HANYA metode baca yang boleh diulang', () => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ERR_HTTP2_GOAWAY_SESSION']) {
    assert.equal(isRetryableFetchError(netError(code), 'POST'), false, `${code} tidak boleh diulang pada POST`)
    assert.ok(isRetryableFetchError(netError(code), 'GET'), `${code} layak diulang pada GET`)
  }
})

test('kode cause bersarang terbaca, bukan cuma level pertama', () => {
  const dalam: any = new Error('socket closed')
  dalam.code = 'UND_ERR_SOCKET'
  const tengah: any = new Error('fetch failed')
  tengah.cause = dalam
  const luar: any = new TypeError('fetch failed')
  luar.cause = tengah
  assert.equal(isRetryableFetchError(luar, 'POST'), false)
  assert.ok(isRetryableFetchError(luar, 'GET'))
})

test('pesan tanpa kode cause tetap terklasifikasi dari teksnya', () => {
  assert.ok(isRetryableFetchError(new Error('connect ECONNREFUSED 10.0.0.1:443'), 'POST'))
  assert.equal(isRetryableFetchError(new Error('socket hang up'), 'POST'), false)
  assert.ok(isRetryableFetchError(new Error('socket hang up'), 'GET'))
  // "fetch failed" saja, tanpa petunjuk: jangan menebak — anggap sudah terkirim.
  assert.equal(isRetryableFetchError(new TypeError('fetch failed'), 'POST'), false)
  assert.equal(isRetryableFetchError(new TypeError('fetch failed'), 'GET'), false)
})

test('batal dan timeout tidak pernah dianggap gangguan yang aman diulang untuk POST', () => {
  assert.equal(isRetryableFetchError(abortError(), 'GET'), false)
  assert.equal(isRetryableFetchError(new FetchTimeoutError(30_000), 'POST'), false)
  assert.ok(isRetryableFetchError(new FetchTimeoutError(30_000), 'GET'))
})

// ── Perilaku fetchWithRetry ─────────────────────────────────────────────────

test('POST dengan gagal koneksi: diulang, dan percobaan kedua dipakai', async () => {
  const s = stubFetch((_url, _init, attempt) => {
    if (attempt === 1) throw netError('ENOTFOUND')
    return json({ ok: true })
  })
  try {
    const res = await fetchWithRetry('https://upstream.test/generate', { method: 'POST', body: '{}' }, { backoffMs: 0 })
    assert.equal(res.status, 200)
    assert.equal(s.calls.length, 2)
  } finally {
    s.restore()
  }
})

test('POST dengan socket reset: satu percobaan saja — job mungkin sudah terbentuk', async () => {
  const s = stubFetch(() => {
    throw netError('ECONNRESET')
  })
  try {
    await assert.rejects(
      fetchWithRetry('https://upstream.test/generate', { method: 'POST', body: '{}' }, { backoffMs: 0 }),
      /ECONNRESET|fetch failed/,
    )
    assert.equal(s.calls.length, 1)
  } finally {
    s.restore()
  }
})

test('GET dengan socket reset: diulang sampai berhasil', async () => {
  const s = stubFetch((_url, _init, attempt) => {
    if (attempt < 3) throw netError('ECONNRESET')
    return json({ status: 'completed' })
  })
  try {
    const res = await fetchWithRetry('https://upstream.test/status', { method: 'GET' }, { backoffMs: 0 })
    assert.equal(res.status, 200)
    assert.equal(s.calls.length, 3)
  } finally {
    s.restore()
  }
})

test('body stream tidak diulang walau kegagalannya pra-kirim', async () => {
  const s = stubFetch(() => {
    throw netError('ECONNREFUSED')
  })
  try {
    await assert.rejects(
      fetchWithRetry(
        'https://upstream.test/upload',
        { method: 'POST', body: new ReadableStream({ start() {} }) as any },
        { backoffMs: 0 },
      ),
      /ECONNREFUSED|fetch failed/,
    )
    assert.equal(s.calls.length, 1, 'body yang sudah dikonsumsi tidak bisa dikirim ulang')
  } finally {
    s.restore()
  }
})

test('status gateway: diulang untuk GET, apa adanya untuk POST', async () => {
  const baca = stubFetch((_url, _init, attempt) => (attempt === 1 ? json({ e: 'Bad Gateway' }, 502) : json({ ok: true })))
  try {
    const res = await fetchWithRetry('https://upstream.test/status', { method: 'GET' }, { backoffMs: 0 })
    assert.equal(res.status, 200)
    assert.equal(baca.calls.length, 2)
  } finally {
    baca.restore()
  }

  const tulis = stubFetch(() => json({ e: 'Bad Gateway' }, 502))
  try {
    const res = await fetchWithRetry('https://upstream.test/generate', { method: 'POST', body: '{}' }, { backoffMs: 0 })
    assert.equal(res.status, 502)
    assert.equal(tulis.calls.length, 1, '502 di atas POST diteruskan apa adanya: job bisa saja sudah diterima')
  } finally {
    tulis.restore()
  }
})

test('Retry-After upstream dipakai kalau lebih besar dari backoff kami', async () => {
  let delay = 0
  const s = stubFetch((_url, _init, attempt) =>
    attempt === 1 ? new Response('tunggu', { status: 503, headers: { 'Retry-After': '1' } }) : json({ ok: true }),
  )
  try {
    const res = await fetchWithRetry(
      'https://upstream.test/status',
      { method: 'GET' },
      { backoffMs: 0, onRetry: ({ delayMs }) => { delay = delayMs } },
    )
    assert.equal(res.status, 200)
    assert.equal(delay, 1000)
  } finally {
    s.restore()
  }
})

test('sinyal pemanggil yang sudah batal: tidak ada request sama sekali', async () => {
  const s = stubFetch(() => json({ ok: true }))
  try {
    const ac = new AbortController()
    ac.abort()
    await assert.rejects(fetchWithTimeout('https://upstream.test/x', { signal: ac.signal }))
    assert.equal(s.calls.length, 0)
  } finally {
    s.restore()
  }
})

test('batal di tengah jalan diteruskan dan tidak diulang', async () => {
  const s = stubFetch(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(abortError()))
      }),
  )
  try {
    const ac = new AbortController()
    const p = fetchWithRetry('https://upstream.test/status', { method: 'GET', signal: ac.signal }, { attempts: 3, backoffMs: 0 })
    setTimeout(() => ac.abort(), 10)
    await assert.rejects(p, /abort/i)
    assert.equal(s.calls.length, 1, 'batal klien bukan gangguan jaringan: jangan dicoba ulang')
  } finally {
    s.restore()
  }
})

test('timeout sendiri: FetchTimeoutError, diulang untuk GET tapi tidak untuk POST', async () => {
  const baca = stubFetch((url, init, attempt) => (attempt === 1 ? menggantung(url, init) : json({ ok: true })))
  try {
    const res = await fetchWithRetry('https://upstream.test/status', { method: 'GET', timeoutMs: 20 }, { backoffMs: 0 })
    assert.equal(res.status, 200)
    assert.equal(baca.calls.length, 2)
  } finally {
    baca.restore()
  }

  const tulis = stubFetch(menggantung)
  try {
    await assert.rejects(
      fetchWithRetry('https://upstream.test/generate', { method: 'POST', body: '{}', timeoutMs: 20 }, { attempts: 3, backoffMs: 0 }),
      (err: any) => err instanceof FetchTimeoutError && err.timeoutMs === 20,
    )
    assert.equal(tulis.calls.length, 1, 'POST yang timeout bisa saja sudah membuat job di upstream')
  } finally {
    tulis.restore()
  }
})

// ── Kebijakan relay + log ────────────────────────────────────────────────────

test('relay rute baca dipotong lebih ketat daripada rute yang membuat job', async () => {
  const baca = stubFetch(menggantung)
  try {
    await assert.rejects(
      fetchWithProviderRetry('https://upstream.test/status', { method: 'GET', timeoutMs: 20 }, { consuming: false, label: 'x-proxy' }),
      FetchTimeoutError,
    )
    assert.equal(baca.calls.length, 2, 'rute baca: timeout masih layak dicoba sekali lagi')
  } finally {
    baca.restore()
  }

  const job = stubFetch(menggantung)
  try {
    await assert.rejects(
      fetchWithProviderRetry(
        'https://upstream.test/generate',
        { method: 'POST', body: '{}', timeoutMs: 20 },
        { consuming: true, label: 'x-proxy' },
      ),
      FetchTimeoutError,
    )
    assert.equal(job.calls.length, 1, 'POST yang timeout bisa saja sudah membuat job di upstream')
  } finally {
    job.restore()
  }
})

test('describeFetchError menampakkan kode cause supaya 502 bisa ditelusuri', () => {
  assert.match(describeFetchError(netError('ENOTFOUND')), /fetch failed \(cause: ENOTFOUND\)/)
  const dalam: any = new Error('socket read error')
  dalam.code = 'UND_ERR_SOCKET'
  const luar: any = new TypeError('fetch failed')
  luar.code = 'ECONNRESET'
  luar.cause = dalam
  assert.equal(describeFetchError(luar), 'fetch failed (cause: ECONNRESET <- UND_ERR_SOCKET)')
  assert.equal(describeFetchError(new Error('polos')), 'polos')
  // DOMException punya `code` angka legacy (AbortError = 20) — bukan kode undici,
  // dan menampilkannya cuma bikin log sulit dibaca.
  const dom: any = new Error('This operation was aborted')
  dom.name = 'AbortError'
  dom.code = 20
  assert.equal(describeFetchError(dom), 'This operation was aborted')
})
