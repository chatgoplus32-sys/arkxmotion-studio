// ─── Custom AI App Runner (OpenAPI v2) ──────────────────────────────────────
// Bug yang dijaga: aksi `submit-custom-ai-app` memakai kontrak resmi
// /openapi/v2/run/ai-app/{appId} — body { nodeInfoList, instanceType,
// usePersonalQueue, webhookUrl?, retainSeconds? }. Tanpa relay yang benar,
// "AI App manapun bisa dipanggil" tidak benar-benar jalan di produksi.
import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import runninghubRoutes from '../server/routes/publicRunninghub.js'
import { RUNNINGHUB_MODEL_PRICES } from '../shared/pricing.js'

const originalFetch = globalThis.fetch
const savedAccessTokenEnv = process.env.RUNNINGHUB_ACCESS_TOKEN

let upstream: (url?: string, init?: any) => Response = () => new Response('{}', { status: 200 })
let bodiesSeen: any[] = []
let urlsSeen: string[] = []

const app = express()
app.use(express.json({ limit: '50mb' }))
app.use('/api/public/runninghub', runninghubRoutes)

let server: ReturnType<typeof app.listen>
let base = ''

const MEMBER_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90' // API key 32 hex palsu (jalur klasik, bukan JWT)

before(async () => {
  process.env.RUNNINGHUB_ACCESS_TOKEN = ''
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  globalThis.fetch = (async (_url: any, init?: any) => {
    urlsSeen.push(String(_url))
    try { bodiesSeen.push(init?.body ? JSON.parse(init.body) : null) } catch { bodiesSeen.push(init?.body) }
    return upstream(String(_url), init)
  }) as any
})

beforeEach(() => {
  bodiesSeen = []
  urlsSeen = []
  upstream = () => new Response(JSON.stringify({ code: 0, data: { taskId: 'rh-task-1', taskStatus: 'QUEUED' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})

after(() => {
  if (savedAccessTokenEnv === undefined) delete process.env.RUNNINGHUB_ACCESS_TOKEN
  else process.env.RUNNINGHUB_ACCESS_TOKEN = savedAccessTokenEnv
  globalThis.fetch = originalFetch
  server?.close()
})

async function runAction(payload: Record<string, unknown>) {
  const res = await originalFetch(`${base}/api/public/runninghub`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'submit-custom-ai-app', apiKey: MEMBER_KEY, ...payload }),
  })
  return res.json()
}

function runBody(res: any) {
  return { res, nCalls: urlsSeen.length, upstreamUrl: urlsSeen[0] || null, upstreamBody: bodiesSeen[0] || null }
}

test('submit-custom-ai-app: forward ke /openapi/v2/run/ai-app/{appId} persis dokumen', async () => {
  const out = runBody(await runAction({
    appId: '2116538467715293186',
    nodeInfoList: [
      { nodeId: '209', fieldName: 'image', fieldValue: 'https://contoh/x.png' },
      { nodeId: '214', fieldName: 'value', fieldValue: 'The character faces the camera', description: 'prompt utama' },
    ],
  }))

  assert.equal(out.res.ok, true, JSON.stringify(out.res))
  assert.equal(out.res.data.taskId, 'rh-task-1')
  assert.equal(out.res.data.workflowId, '2116538467715293186')
  assert.equal(out.nCalls, 1, 'hanya satu request ke upstream')
  assert.equal(out.upstreamUrl, 'https://www.runninghub.ai/openapi/v2/run/ai-app/2116538467715293186')
  assert.equal(out.upstreamBody.instanceType, 'default')
  assert.equal(out.upstreamBody.usePersonalQueue, 'false')
  assert.deepEqual(out.upstreamBody.nodeInfoList, [
    { nodeId: '209', fieldName: 'image', fieldValue: 'https://contoh/x.png', description: null },
    { nodeId: '214', fieldName: 'value', fieldValue: 'The character faces the camera', description: 'prompt utama' },
  ])
  assert.equal(out.upstreamBody.webhookUrl, undefined, 'webhookUrl tidak dikirim kalau tidak diminta')
  assert.equal(out.upstreamBody.retainSeconds, undefined, 'retainSeconds tidak dikirim kalau tidak diminta')
})

test('submit-custom-ai-app: instanceType/usePersonalQueue/webhookUrl/retainSeconds diteruskan sesuai dokumen', async () => {
  const out = runBody(await runAction({
    appId: '2116538467715293186',
    nodeInfoList: [{ nodeId: '209', fieldName: 'image', fieldValue: 'data:image/png;base64,AAAA' }],
    instanceType: 'ultra',
    usePersonalQueue: true,
    webhookUrl: 'https://hooks.example.com/done',
    retainSeconds: 60,
  }))

  assert.equal(out.res.ok, true, JSON.stringify(out.res))
  assert.equal(out.upstreamBody.instanceType, 'ultra')
  assert.equal(out.upstreamBody.usePersonalQueue, 'true')
  assert.equal(out.upstreamBody.webhookUrl, 'https://hooks.example.com/done')
  assert.equal(out.upstreamBody.retainSeconds, 60)
})

test('submit-custom-ai-app: validasi — input rusak ditolak SEBELUM menyentuh upstream', async () => {
  const cases: Record<string, any>[] = [
    { appId: 'bukan-angka', nodeInfoList: [{ nodeId: '1', fieldName: 'image', fieldValue: 'x' }] },
    { appId: '12345', nodeInfoList: [] },
    { appId: '12345', nodeInfoList: [{ nodeId: '', fieldName: 'image', fieldValue: 'x' }] },
    { appId: '12345', nodeInfoList: [{ nodeId: '1', fieldName: '', fieldValue: 'x' }] },
    { appId: '12345', nodeInfoList: [{ nodeId: '1', fieldName: 'image', fieldValue: '   ' }] },
    { appId: '12345', nodeInfoList: [{ nodeId: '1', fieldName: 'image', fieldValue: 'x' }], webhookUrl: 'http://tidak-https.example.com/' },
    { appId: '12345', nodeInfoList: [{ nodeId: '1', fieldName: 'image', fieldValue: 'x' }], retainSeconds: 5 },
    { appId: '12345', nodeInfoList: [{ nodeId: '1', fieldName: 'image', fieldValue: 'x' }], retainSeconds: 999 },
  ]
  for (const [i, payload] of cases.entries()) {
    const res = await runAction(payload)
    assert.equal(res.ok, false, `kasus #${i + 1} harus ditolak: ${JSON.stringify(res)}`)
    assert.equal(urlsSeen.length, 0, `kasus #${i + 1} tidak boleh menyentuh upstream`)
  }
})

test('escape hatch: fieldValue data URI diloloskan apa adanya (docs: data URI base64 diterima)', async () => {
  const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const out = runBody(await runAction({
    appId: '2116538467715293186',
    nodeInfoList: [{ nodeId: '209', fieldName: 'image', fieldValue: dataUri }],
  }))
  assert.equal(out.res.ok, true)
  assert.equal(out.upstreamBody.nodeInfoList[0].fieldValue, dataUri)
})

test('query COMPLETED: results[] mentah diteruskan (teks LLM tidak hilang di relay)', async () => {
  upstream = () => new Response(JSON.stringify({
    code: 0,
    data: {
      taskId: 'rh-task-1',
      status: 'SUCCESS',
      results: [
        { url: 'https://cdn.example/out.mp4', nodeId: '2', outputType: 'mp4', text: null },
        { url: null, nodeId: '7', outputType: 'text', text: 'Deskripsi karakter: pria 30 tahun, latar ruang tamu.' },
      ],
      usage: { consumeCoins: '30', taskCostTime: '42' },
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  const res = await originalFetch(`${base}/api/public/runninghub`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'query', apiKey: MEMBER_KEY, taskId: 'rh-task-1' }),
  })
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.data.status, 'COMPLETED')
  assert.ok(Array.isArray(body.data.results), 'results mentah harus diteruskan')
  assert.equal(body.data.results.length, 2)
  assert.equal(body.data.results[1].text, 'Deskripsi karakter: pria 30 tahun, latar ruang tamu.')
})

test('harga: submit-custom-ai-app terdaftar di RUNNINGHUB_MODEL_PRICES (admin bisa override)', () => {
  assert.equal(RUNNINGHUB_MODEL_PRICES['submit-custom-ai-app'], 2500)
})
