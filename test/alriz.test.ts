// Tes lib Alriz — murni dengan fetch stub (tanpa jaringan).
// Kontrak upstream terverifikasi via probe nyata: GET /models (tanpa auth),
// GET /account (X-API-Key) → {email, balance, concurrent}, POST /jobs → 202
// {job_id, status}, GET /jobs/{id} → {status, result_url,...}.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ALRIZ_MODELS,
  alrizErrorMessage,
  fetchAlrizAccount,
  fetchAlrizJob,
  fetchAlrizResult,
  generateWithAlriz,
  getAlrizModel,
  getAlrizPrice,
  pollAlrizJob,
  submitAlrizJob,
} from '../src/lib/alriz.js'

type AlrizStubRes = { status: number; body: unknown }

function withFetchStub<T>(impl: (url: string, init?: RequestInit) => AlrizStubRes | Promise<AlrizStubRes>, fn: () => Promise<T>): Promise<T> {
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

// ── Katalog model ────────────────────────────────────────────────────────────

test('ALRIZ_MODELS: 4 model Kling Motion Control dengan harga Rp', () => {
  assert.equal(ALRIZ_MODELS.length, 4)
  assert.deepEqual(
    ALRIZ_MODELS.map((m) => [m.id, m.resolution, m.price]),
    [
      ['mc-kling-2.6-std', '720p', 750],
      ['mc-kling-2.6-pro', '1080p', 1500],
      ['mc-kling-3.0-std', '720p', 1000],
      ['mc-kling-3.0-pro', '1080p', 1750],
    ],
  )
  assert.ok(getAlrizModel('mc-kling-3.0-pro'))
  assert.equal(getAlrizModel('model_ngawur'), undefined)
})

test('getAlrizPrice: harga per model, default termurah', () => {
  assert.equal(getAlrizPrice('mc-kling-2.6-std'), 750)
  assert.equal(getAlrizPrice('mc-kling-3.0-pro'), 1750)
  assert.equal(getAlrizPrice('model_ngawur'), 750)
  assert.equal(getAlrizPrice(), 750)
  assert.equal(getAlrizPrice(''), 750)
})

// ── Kode error → Bahasa Indonesia ────────────────────────────────────────────

test('alrizErrorMessage: kode dikenal diterjemahkan, asing pakai fallback', () => {
  assert.match(alrizErrorMessage('AUTH_001', 'x'), /tidak valid/)
  assert.match(alrizErrorMessage('STK_001', 'x'), /dikembalikan penuh/)
  assert.match(alrizErrorMessage('GEN_001', 'x'), /dikembalikan penuh/)
  assert.match(alrizErrorMessage('SYS_001', 'x'), /bersamaan/)
  assert.equal(alrizErrorMessage('XXX_999', 'fallback asli'), 'fallback asli')
})

// ── Account ──────────────────────────────────────────────────────────────────

test('fetchAlrizAccount: 200 → email + saldo + konkurensi', async () => {
  await withFetchStub((url) => {
    assert.match(url, /path=account/)
    return { status: 200, body: { email: 'u@x.com', balance: 15000, concurrent: { limit: 20, running: 2, available: 18 } } }
  }, async () => {
    const r = await fetchAlrizAccount('alz_test')
    assert.equal(r.ok, true)
    assert.equal(r.account?.email, 'u@x.com')
    assert.equal(r.account?.balance, 15000)
    assert.equal(r.account?.available, 18)
  })
})

test('fetchAlrizAccount: 401 → kunci tidak valid', async () => {
  await withFetchStub(() => ({ status: 401, body: { error: { code: 'AUTH_001', message: 'nope' } } }), async () => {
    const r = await fetchAlrizAccount('alz_salah')
    assert.equal(r.ok, false)
    assert.match(r.error || '', /tidak valid/)
  })
})

// ── Submit + poll ────────────────────────────────────────────────────────────

test('submitAlrizJob: 202 → job_id diekstrak', async () => {
  await withFetchStub((url, init) => {
    assert.match(url, /path=jobs$/)
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, 'mc-kling-2.6-pro')
    assert.equal(body.image_url, 'https://img/a.jpg')
    return { status: 202, body: { job_id: 'ALRIZ_abc123', status: 'QUEUED' } }
  }, async () => {
    const id = await submitAlrizJob('alz_test', { model: 'mc-kling-2.6-pro', imageUrl: 'https://img/a.jpg', videoUrl: 'https://vid/b.mp4', prompt: 'gerak' })
    assert.equal(id, 'ALRIZ_abc123')
  })
})

test('submitAlrizJob: saldo kurang (REQ_001) → error jelas', async () => {
  await withFetchStub(() => ({ status: 400, body: { error: { code: 'REQ_001', message: 'low' } } }), async () => {
    await assert.rejects(
      () => submitAlrizJob('alz_test', { model: 'mc-kling-2.6-std', imageUrl: 'a', videoUrl: 'b' }),
      /tidak cukup/,
    )
  })
})

test('pollAlrizJob: QUEUED → PROCESSING → DONE mengembalikan URL', async () => {
  const calls: string[] = []
  await withFetchStub((url) => {
    calls.push(url)
    if (calls.length < 3) return { status: 200, body: { status: calls.length === 1 ? 'QUEUED' : 'PROCESSING', progress: 10 } }
    return { status: 200, body: { status: 'DONE', result_url: 'https://cdn.alrizmotion.my.id/r/vid.mp4' } }
  }, async () => {
    const url = await pollAlrizJob('alz_test', 'ALRIZ_x')
    assert.equal(url, 'https://cdn.alrizmotion.my.id/r/vid.mp4')
  })
})

test('pollAlrizJob: NO_STOCK → error kapasitas + refund', async () => {
  await withFetchStub(() => ({ status: 200, body: { status: 'NO_STOCK', error_code: 'STK_001' } }), async () => {
    await assert.rejects(() => pollAlrizJob('alz_test', 'ALRIZ_x'), /dikembalikan penuh/)
  })
})

test('pollAlrizJob: FAILED → error gagal', async () => {
  await withFetchStub(() => ({ status: 200, body: { status: 'FAILED', error: { code: 'GEN_001', message: 'blur' } } }), async () => {
    await assert.rejects(() => pollAlrizJob('alz_test', 'ALRIZ_x'), /tidak dapat diproses/)
  })
})

test('fetchAlrizJob + fetchAlrizResult membaca kontrak status/result', async () => {
  await withFetchStub((url) => {
    if (url.includes('/result')) return { status: 200, body: { job_id: 'J', status: 'DONE', result_url: 'https://cdn/x.mp4' } }
    return { status: 200, body: { status: 'PROCESSING', progress: 42, cost: 1500 } }
  }, async () => {
    const s = await fetchAlrizJob('alz_test', 'J')
    assert.equal(s.status, 'PROCESSING')
    assert.equal(s.cost, 1500)
    assert.equal(await fetchAlrizResult('alz_test', 'J'), 'https://cdn/x.mp4')
  })
})

test('generateWithAlriz: submit → poll → URL (end-to-end stub)', async () => {
  let n = 0
  await withFetchStub((url) => {
    if (url.includes('/result')) return { status: 200, body: { result_url: 'https://cdn/final.mp4' } }
    if (url.endsWith('path=jobs')) return { status: 202, body: { job_id: 'J1', status: 'QUEUED' } }
    n++
    if (n === 1) return { status: 200, body: { status: 'PROCESSING' } }
    return { status: 200, body: { status: 'DONE', result_url: 'https://cdn/final.mp4' } }
  }, async () => {
    const url = await generateWithAlriz({ apiKey: 'alz_test', model: 'mc-kling-2.6-std', imageUrl: 'a', videoUrl: 'b' })
    assert.equal(url, 'https://cdn/final.mp4')
  })
})
