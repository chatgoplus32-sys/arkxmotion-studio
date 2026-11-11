// Tes lib Freebeat — murni dengan fetch stub (tanpa jaringan).
// Kontrak upstream terverifikasi dari paket resmi npm `freebeat-mcp` v0.1.4 +
// probe katalog live freebeat.ai 11 Nov 2026 (getAiRuleConfig / getModelRuleConfig):
//   POST /v1/ai/cli/createImageBatch → { code:0, data:{ batchId, items:[{accepted,serialNo,needCredits}] } }
//   POST /v1/ai/cli/queryBatch       → { code:0, data:{ items:[{status,usedCredits,imageUrl,editImages}] } }
// Auth: header `Authorization: <KEY>` mentah (tanpa "Bearer").

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FREEBEAT_IMAGE_MODELS,
  getFreebeatModel,
  buildFreebeatImageItem,
  createFreebeatImageBatch,
  queryFreebeatBatch,
  fetchFreebeatCredits,
  isFreebeatAuthError,
  isFreebeatCreditError,
} from '../src/lib/freebeat.js'

type FbStubRes = { status: number; body: unknown; contentType?: string }

function withFetchStub<T>(impl: (url: string, init?: RequestInit) => FbStubRes | Promise<FbStubRes>, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input)
    const { status, body, contentType } = await impl(url, init)
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': contentType || 'application/json' },
    })
  }) as typeof fetch
  return fn().finally(() => {
    globalThis.fetch = real
  })
}

// ── Katalog ──────────────────────────────────────────────────────────────────

test('katalog: 32 entri (31 generate + 1 edit-only) dengan id unik', () => {
  assert.equal(FREEBEAT_IMAGE_MODELS.length, 32)
  const ids = FREEBEAT_IMAGE_MODELS.map((m) => m.id)
  assert.equal(new Set(ids).size, 32)
  // Edit-only tunggal: Qwen Image Edit (76).
  assert.equal(FREEBEAT_IMAGE_MODELS.filter((m) => m.editOnly).length, 1)
  assert.equal(getFreebeatModel('76')?.label, 'Qwen Image Edit (edit-only)')
})

test('snapshot kredit live 11 Nov 2026', () => {
  const credits = (id: string) => getFreebeatModel(id)?.credits ?? null
  // Termurah & termahal.
  assert.equal(credits('68'), 3)   // Z-Image Turbo
  assert.equal(credits('125'), 71) // Seedream 5.0 Pro
  // Nano Banana.
  assert.equal(credits('80'), 23)  // Nano Banana 2
  assert.equal(credits('122'), 10) // Nano Banana 2 Lite
  assert.equal(credits('64'), 46)  // Nano Banana Pro
  assert.equal(credits('53'), 10)  // Nano Banana
  assert.equal(credits('92'), 19)  // Kling Image V3
  assert.equal(credits('91'), 40)  // Qwen 2.0 Pro
  assert.equal(credits('161'), 40) // Qwen Image 3
  assert.equal(credits('183'), 15) // Qwen Image 3 Pro
  assert.equal(credits('87'), 16)  // Wan V2.6
  assert.equal(credits('99'), 16)  // Wan V2.7
  assert.equal(credits('100'), 40) // Wan V2.7 Pro
  // Bervariasi → null.
  assert.equal(credits('202'), null) // NB 2.1 (1K18/2K27/4K59)
  assert.equal(credits('70'), null)  // GPT-Image 1.5 (quality map)
  assert.equal(credits('176'), null) // Grok Image 2 (combo map)
  assert.equal(credits('76'), null)  // Qwen Edit (formula per MP)
})

test('aspek `size` hanya untuk model yang menerimanya', () => {
  // Model dengan aspek (persetujuan UI): 53/64/80/67/68/20/87/99/100 + 204,122
  for (const id of ['53', '64', '80', '67', '68', '20', '87', '99', '100']) {
    const m = getFreebeatModel(id)
    assert.ok(m?.aspects.length, `model ${id} harus punya aspek`)
    assert.deepEqual(new Set(m!.aspects), new Set(['16:9', '1:1', '9:16', '4:3', '3:4']))
  }
  // Model tanpa aspek.
  for (const id of ['92', '91', '161', '88', '89', '209', '118', '176', '214']) {
    assert.equal(getFreebeatModel(id)?.aspects.length, 0, `model ${id} tanpa aspek`)
  }
})

// ── Item builder ─────────────────────────────────────────────────────────────

test('buildFreebeatImageItem: generate = businessType 9 / generationType 6', () => {
  const m = getFreebeatModel('68')!
  const item = buildFreebeatImageItem(m, { prompt: 'kucing di bulan' })
  assert.equal(item.businessType, 9)
  assert.equal(item.generationType, 6)
  assert.equal(item.modelId, '68')
  assert.equal(item.prompt, 'kucing di bulan')
  assert.equal(item.count, 1)
  assert.equal(item.images, undefined)
  assert.equal(item.size, undefined)
})

test('buildFreebeatImageItem: rasio ikut hanya bila model menerimanya', () => {
  const withAspect = getFreebeatModel('68')!
  assert.equal(buildFreebeatImageItem(withAspect, { prompt: 'p', aspect: '9:16' }).size, '9:16')
  assert.equal(buildFreebeatImageItem(withAspect, { prompt: 'p', aspect: '21:9' }).size, undefined)
  const noAspect = getFreebeatModel('92')!
  assert.equal(buildFreebeatImageItem(noAspect, { prompt: 'p', aspect: '9:16' }).size, undefined)
})

test('buildFreebeatImageItem: edit = businessType 11 / generationType 8 + images', () => {
  const m = getFreebeatModel('80')!
  const item = buildFreebeatImageItem(m, { prompt: 'ubah jadi kartun', imageUrl: 'https://files.catbox.moe/x.jpg' })
  assert.equal(item.businessType, 11)
  assert.equal(item.generationType, 8)
  assert.deepEqual(item.images, ['https://files.catbox.moe/x.jpg'])
  // Rasio tidak dikirim di mode edit (diambil dari gambar input).
  assert.equal(item.size, undefined)
})

test('buildFreebeatImageItem: count dioper', () => {
  const m = getFreebeatModel('68')!
  assert.equal(buildFreebeatImageItem(m, { prompt: 'p', count: 3 }).count, 3)
  assert.equal(buildFreebeatImageItem(m, { prompt: 'p', count: 0 }).count, 1)
})

// ── Batch create ─────────────────────────────────────────────────────────────

test('createFreebeatImageBatch: header auth mentah + envelope {code:0} di-unwrap', async () => {
  let capturedInit: RequestInit | undefined
  const result = await withFetchStub(async (url, init) => {
    capturedInit = init
    assert.ok(String(url).includes('/api/public/freebeat/v1/ai/cli/createImageBatch'))
    return {
      status: 200,
      body: {
        code: 0,
        msg: '',
        data: {
          batchId: 'OB_20261111_abc123',
          acceptedCount: 1,
          failedCount: 0,
          items: [{ accepted: true, serialNo: 'SN-1', needCredits: 23 }],
        },
      },
    }
  }, () => createFreebeatImageBatch('fb-key-raw', buildFreebeatImageItem(getFreebeatModel('80')!, { prompt: 'p' })))

  const auth = (capturedInit?.headers as Record<string, string>)?.Authorization
  assert.equal(auth, 'fb-key-raw')
  assert.equal(result.batchId, 'OB_20261111_abc123')
  assert.equal(result.serialNo, 'SN-1')
  assert.equal(result.needCredits, 23)
})

test('createFreebeatImageBatch: code != 0 → Error berisi msg upstream', async () => {
  await assert.rejects(
    () => withFetchStub(
      async () => ({ status: 200, body: { code: 401, msg: 'invalid api key' } }),
      () => createFreebeatImageBatch('salah', buildFreebeatImageItem(getFreebeatModel('68')!, { prompt: 'p' })),
    ),
    /invalid api key/,
  )
})

test('createFreebeatImageBatch: item ditolak upstream → Error', async () => {
  await assert.rejects(
    () => withFetchStub(
      async () => ({
        status: 200,
        body: { code: 0, data: { batchId: 'x', acceptedCount: 0, failedCount: 1, items: [{ accepted: false, message: 'model unavailable' }] } },
      }),
      () => createFreebeatImageBatch('k', buildFreebeatImageItem(getFreebeatModel('68')!, { prompt: 'p' })),
    ),
    /model unavailable/,
  )
})

// ── Query / polling ──────────────────────────────────────────────────────────

test('queryFreebeatBatch: status selesai + imageUrl (dan editImages fallback)', async () => {
  const q = await withFetchStub(
    async (url, init) => {
      assert.ok(String(url).includes('/v1/ai/cli/queryBatch'))
      const body = JSON.parse(String(init?.body))
      assert.equal(body.batchId, 'OB_1')
      return {
        status: 200,
        body: {
          code: 0,
          data: {
            batchId: 'OB_1',
            items: [{ serialNo: 'SN-1', status: 'Succeeded', usedCredits: 23, imageUrl: 'https://cdn.freebeatfit.com/img.png' }],
          },
        },
      }
    },
    () => queryFreebeatBatch('k', 'OB_1', 'SN-1'),
  )
  assert.equal(q.status, 'completed')
  assert.equal(q.items[0].imageUrl, 'https://cdn.freebeatfit.com/img.png')
  assert.equal(q.items[0].usedCredits, 23)

  const q2 = await withFetchStub(
    async () => ({
      status: 200,
      body: { code: 0, data: { batchId: 'OB_2', items: [{ serialNo: 'a', status: 'success', editImages: ['https://cdn/edit.png'] }] } },
    }),
    () => queryFreebeatBatch('k', 'OB_2'),
  )
  assert.equal(q2.items[0].imageUrl, 'https://cdn/edit.png')
})

test('queryFreebeatBatch: running / failed / partial_failed', async () => {
  const mk = (statuses: string[]) => ({
    status: 200,
    body: { code: 0, data: { batchId: 'b', items: statuses.map((s, i) => ({ serialNo: String(i), status: s })) } },
  })
  const run = await withFetchStub(async () => mk(['running']), () => queryFreebeatBatch('k', 'b'))
  assert.equal(run.status, 'running')
  const fail = await withFetchStub(async () => mk(['failed']), () => queryFreebeatBatch('k', 'b'))
  assert.equal(fail.status, 'failed')
  const part = await withFetchStub(async () => mk(['success', 'failed']), () => queryFreebeatBatch('k', 'b'))
  assert.equal(part.status, 'partial_failed')
  const unknown = await withFetchStub(async () => mk([]), () => queryFreebeatBatch('k', 'b'))
  assert.equal(unknown.status, 'unknown')
})

// ── Kredit / error helpers ───────────────────────────────────────────────────

test('fetchFreebeatCredits: angka dari beberapa bentuk data', async () => {
  const ok = await withFetchStub(
    async () => ({ status: 200, body: { code: 0, data: { credits: 512 } } }),
    () => fetchFreebeatCredits('k'),
  )
  assert.equal(ok.ok, true)
  assert.equal(ok.credits, 512)

  const nested = await withFetchStub(
    async () => ({ status: 200, body: { code: 0, data: { balance: 12 } } }),
    () => fetchFreebeatCredits('k'),
  )
  assert.equal(nested.credits, 12)

  const authFail = await withFetchStub(
    async () => ({ status: 200, body: { code: 401, msg: 'unauthorized' } }),
    () => fetchFreebeatCredits('k'),
  )
  assert.equal(authFail.ok, false)
})

test('isFreebeatAuthError / isFreebeatCreditError', () => {
  assert.ok(isFreebeatAuthError('HTTP 401 — invalid api key'))
  assert.ok(isFreebeatAuthError('unauthorized'))
  assert.ok(!isFreebeatAuthError('insufficient credits'))
  assert.ok(isFreebeatCreditError('not enough credits'))
  assert.ok(isFreebeatCreditError('insufficient balance'))
  assert.ok(!isFreebeatCreditError('timeout'))
})
