// ─── Kebijakan & pemanggil upstream proxy CreatePulse ───────────────────────
// Dua hal yang dikunci di sini, keduanya berasal dari satu kejadian nyata:
// submit Veo Omni dijawab 502 dalam ~2 detik dan UI hanya bisa bilang
// "Submit failed: HTTP 502 — unknown".
//
//   1. Body upstream non-JSON TIDAK boleh hilang. Halaman error gateway
//      createpulse.online itulah satu-satunya jejak yang menjelaskan 502; proxy
//      yang dulu memakai json().catch(() => ({})) membuangnya.
//   2. Aksi non-idempoten (generate) TIDAK boleh diulang: kalau upstream
//      sebenarnya sudah menerima job lalu gateway-nya gagal, percobaan kedua
//      berarti dua job dan dua kali potong kredit pengguna.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CREATEPULSE_PROXY_POLICY,
  CREATEPULSE_PROXY_RETRY,
  createpulseAttempts,
  createpulseProxyDelayMs,
  isCreatepulseNonIdempotentAction,
  isCreatepulseProxyTransientStatus,
  parseCreatepulseRetryAfterMs,
  parseUpstreamBody,
  upstreamBodySnippet,
} from '../shared/createpulseProxy.js'
import { callCreatepulseUpstream } from '../shared/createpulseUpstream.js'

const HALAMAN_502 =
  '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center>' +
  '<hr><center>nginx</center></body></html>'

function htmlResponse(body: string, status: number, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { 'content-type': 'text/html', ...headers } })
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

/** fetch palsu: tiap pemanggilan memakai entri berikutnya, jejaknya dicatat. */
function fakeFetch(steps: Array<() => Response>) {
  const jejak: Array<{ url: string; timeoutMs?: number }> = []
  const fetchWithTimeout = async (url: string | URL, init?: RequestInit & { timeoutMs?: number }) => {
    jejak.push({ url: String(url), timeoutMs: init?.timeoutMs })
    const next = steps.shift()
    if (!next) throw new Error('fetch palsu kehabisan langkah')
    return next()
  }
  return { jejak, fetchWithTimeout }
}

// ── kebijakan (murni) ───────────────────────────────────────────────────────

test('generate tidak pernah diulang; cek status boleh', () => {
  assert.equal(isCreatepulseNonIdempotentAction('generate'), true)
  assert.equal(createpulseAttempts('generate'), 1)
  assert.ok(CREATEPULSE_PROXY_POLICY.status.attempts > 1)
  assert.equal(createpulseAttempts('status'), CREATEPULSE_PROXY_POLICY.status.attempts)
})

test('status transien: rate limit, timeout upstream, dan 5xx gateway', () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(isCreatepulseProxyTransientStatus(status), true, `status ${status} harus transien`)
  }
  for (const status of [200, 201, 400, 401, 403, 404, 422]) {
    assert.equal(isCreatepulseProxyTransientStatus(status), false, `status ${status} tidak transien`)
  }
})

test('body JSON upstream diteruskan apa adanya', () => {
  assert.deepEqual(parseUpstreamBody('{"ok":true,"batchId":"abc"}', 200, 'application/json'), { ok: true, batchId: 'abc' })
})

test('body non-JSON (halaman 502 gateway) jadi pesan error, bukan "unknown"', () => {
  const body = parseUpstreamBody(HALAMAN_502, 502, 'text/html')
  assert.equal(body.ok, false)
  assert.match(body.error, /createpulse\.online HTTP 502/)
  assert.match(body.error, /502 Bad Gateway/)
  assert.match(body.error, /text\/html/)
  assert.ok(!body.error.includes('<'), `tag HTML masih ikut terbawa: ${body.error}`)
})

test('body kosong dan JSON tanpa pesan tetap menyebut status + isinya', () => {
  assert.match(parseUpstreamBody('', 502, null).error, /HTTP 502.*body kosong/)
  const tanpaPesan = parseUpstreamBody('{"message":"upstream down"}', 502, 'application/json')
  assert.equal(tanpaPesan.ok, false)
  assert.match(tanpaPesan.error, /HTTP 502/)
  assert.match(tanpaPesan.error, /upstream down/)
})

test('potongan body dirapikan dan dipotong', () => {
  const potong = upstreamBodySnippet(`<html>${'x'.repeat(500)}</html>`, 50)
  assert.ok(potong.length <= 51, `kepanjangan: ${potong.length}`)
  assert.ok(!potong.includes('<'))
  assert.equal(upstreamBodySnippet('   '), '(body kosong)')
  assert.equal(upstreamBodySnippet('<p>a &amp; b</p>'), 'a & b')
})

test('Retry-After dihormati tapi dibatasi; backoff naik', () => {
  assert.equal(parseCreatepulseRetryAfterMs('2'), 2000)
  assert.equal(parseCreatepulseRetryAfterMs(null), null)
  assert.equal(parseCreatepulseRetryAfterMs('bukan-angka'), null)

  assert.equal(createpulseProxyDelayMs({ attempt: 2, random: () => 0.5 }), CREATEPULSE_PROXY_RETRY.baseMs * 2)
  assert.equal(
    createpulseProxyDelayMs({ attempt: 1, retryAfterHeader: '3600', random: () => 0.5 }),
    CREATEPULSE_PROXY_RETRY.maxRetryAfterMs,
  )
  const atas = createpulseProxyDelayMs({ attempt: 1, random: () => 1 })
  const bawah = createpulseProxyDelayMs({ attempt: 1, random: () => 0 })
  assert.ok(atas > CREATEPULSE_PROXY_RETRY.baseMs && bawah < CREATEPULSE_PROXY_RETRY.baseMs)
  assert.ok(bawah >= 0)
})

// ── pemanggil upstream (I/O, fetch disuntik) ────────────────────────────────

test('submit 502: body gateway dilaporkan dan upstream hanya dipanggil sekali', async () => {
  const { jejak, fetchWithTimeout } = fakeFetch([() => htmlResponse(HALAMAN_502, 502)])
  const dicatat: string[] = []
  const hasil = await callCreatepulseUpstream({
    action: 'generate',
    url: 'https://createpulse.online/api/generate',
    init: { method: 'POST' },
    fetchWithTimeout,
    sleep: async () => assert.fail('submit tidak boleh menunggu percobaan ulang'),
    log: (p) => dicatat.push(p),
  })

  assert.equal(hasil.status, 502)
  assert.match(hasil.body.error, /502 Bad Gateway/)
  assert.equal(jejak.length, 1, 'submit tidak boleh dikirim dua kali — bisa jadi dua job')
  assert.equal(jejak[0].timeoutMs, CREATEPULSE_PROXY_POLICY.generate.timeoutMs)
  assert.match(dicatat.join('\n'), /submit → HTTP 502 dalam \d+ms/)
})

test('cek status 502 lalu 200: diulang sekali, hasil akhir dari percobaan kedua', async () => {
  const { jejak, fetchWithTimeout } = fakeFetch([
    () => htmlResponse(HALAMAN_502, 502, { 'retry-after': '1' }),
    () => jsonResponse({ ok: true, status: 'processing' }),
  ])
  const jeda: number[] = []
  const hasil = await callCreatepulseUpstream({
    action: 'status',
    url: 'https://createpulse.online/api/status?batchId=abc',
    fetchWithTimeout,
    sleep: async (ms) => { jeda.push(ms) },
    log: () => {}, warn: () => {},
  })

  assert.equal(jejak.length, 2)
  assert.equal(jejak[0].timeoutMs, CREATEPULSE_PROXY_POLICY.status.timeoutMs)
  assert.deepEqual(hasil.body, { ok: true, status: 'processing' })
  assert.equal(hasil.status, 200)
  assert.equal(jeda.length, 1)
  assert.ok(jeda[0] >= 1000 && jeda[0] <= CREATEPULSE_PROXY_RETRY.maxRetryAfterMs, `jeda aneh: ${jeda[0]}`)
})

test('upstream tidak bisa dihubungi: 502 dengan pesan aslinya, bukan "unknown"', async () => {
  const { fetchWithTimeout } = fakeFetch([() => { throw new TypeError('fetch failed') }])
  const galat: string[] = []
  const hasil = await callCreatepulseUpstream({
    action: 'generate',
    url: 'https://createpulse.online/api/generate',
    fetchWithTimeout,
    error: (p) => galat.push(p),
  })

  assert.equal(hasil.status, 502)
  assert.match(hasil.body.error, /tidak bisa dihubungi/)
  assert.match(hasil.body.error, /fetch failed/)
  assert.match(galat.join('\n'), /gagal sebelum jawaban/)
})

test('status 4xx (bukan gangguan upstream) tidak diulang', async () => {
  const { jejak, fetchWithTimeout } = fakeFetch([() => jsonResponse({ error: 'Invalid API key' }, 401)])
  const hasil = await callCreatepulseUpstream({
    action: 'status',
    url: 'https://createpulse.online/api/status?batchId=abc',
    fetchWithTimeout,
    sleep: async () => assert.fail('4xx bukan gangguan sesaat — tidak perlu diulang'),
    log: () => {},
  })

  assert.equal(jejak.length, 1)
  assert.equal(hasil.status, 401)
  assert.equal(hasil.body.error, 'Invalid API key')
})
