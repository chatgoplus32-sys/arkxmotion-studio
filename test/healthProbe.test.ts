// ─── Test probe health upstream ──────────────────────────────────────────────
// Akar masalah: /api/health selalu "degraded" karena probe menganggap SEMUA
// respons non-2xx sebagai gangguan. Padahal createpulse membalas 401 (butuh
// kredensial) dan framia 404 (endpoint probe-nya memang tidak ada) — dua-duanya
// bukti service HIDUP dan menjawab. Probe yang benar membedakan:
//   • server menjawab, hanya menolak probe  → ok (dengan catatan)
//   • server menjawab dengan 5xx            → degraded
//   • tidak ada jawaban sama sekali         → error (keseluruhan degraded)
//
// Upstream di-stub lewat globalThis.fetch; DB diarahkan ke file sementara lewat
// ARKXMOTION_DB_PATH supaya data dev tidak tersentuh.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DB_PATH = path.join(os.tmpdir(), `arkxmotion-health-test-${process.pid}.db`)
process.env.ARKXMOTION_DB_PATH = DB_PATH

import { checkHealth, classifyProbe } from '../server/lib/alerts.js'

const originalFetch = globalThis.fetch

// Host upstream → kunci yang dipakai test untuk menentukan respons.
const HOSTS: Record<string, string> = {
  'createpulse.online': 'createpulse',
  'api.framia.pro': 'framia',
  'runninghub.ai': 'runninghub',
}

let statuses: Record<string, number> = {}
let deadHost: string | null = null

globalThis.fetch = (async (input: any) => {
  const url = typeof input === 'string' ? input : input.url ?? String(input)
  const host = Object.keys(HOSTS).find((h) => url.includes(h))
  const key = host ? HOSTS[host] : 'unknown'
  if (deadHost === key) throw new Error('ECONNRESET')
  // Tanpa stub eksplisit → 200; status yang di-stub HARUS benar-benar terpakai
  // (test pertama dulu lolos palsu karena kunci host vs nama pendek keliru).
  return new Response(null, { status: statuses[key] ?? 200 })
}) as typeof fetch

after(() => {
  globalThis.fetch = originalFetch
  for (const suffix of ['', '-wal', '-shm']) {
    // Di Windows file DB masih dipegang better-sqlite3; gagal hapus tidak
    // boleh menggagalkan test (file sementara, nama unik per proses).
    try { fs.rmSync(DB_PATH + suffix, { force: true }) } catch { /* biarkan */ }
  }
})

test('classifyProbe: 2xx = ok tanpa catatan', () => {
  for (const code of [200, 201, 204]) {
    assert.deepEqual(classifyProbe(code), { status: 'ok' }, `HTTP ${code}`)
  }
})

test('classifyProbe: 401/403/404/405/429 = server menjawab (ok + catatan)', () => {
  for (const code of [401, 403, 404, 405, 429]) {
    const verdict = classifyProbe(code)
    assert.equal(verdict.status, 'ok', `HTTP ${code} harus dianggap terjangkau`)
    assert.match(verdict.note ?? '', new RegExp(`HTTP ${code}`), 'catatan harus menyebut kode HTTP-nya')
  }
})

test('classifyProbe: 4xx lain & 5xx tetap degraded', () => {
  for (const code of [400, 418, 500, 502, 503, 504]) {
    assert.equal(classifyProbe(code).status, 'degraded', `HTTP ${code}`)
  }
})

test('checkHealth: 401 createpulse + 404 framia tidak lagi membuat status degraded', async () => {
  statuses = { createpulse: 401, framia: 404, runninghub: 200 }
  deadHost = null

  const health = await checkHealth()

  assert.equal(health.checks.database.status, 'ok')
  assert.equal(health.checks.createpulse.status, 'ok', '401 = service hidup')
  assert.equal(health.checks.framia.status, 'ok', '404 = endpoint probe tidak ada, service hidup')
  assert.equal(health.checks.runninghub.status, 'ok')
  assert.equal(health.status, 'ok', 'keseluruhan harus ok, bukan degraded')
  assert.match(health.checks.createpulse.note ?? '', /401/)
})

test('checkHealth: upstream yang benar-benar rusak (5xx) tetap menandai degraded', async () => {
  statuses = { createpulse: 401, framia: 404, runninghub: 503 }
  deadHost = null

  const health = await checkHealth()

  assert.equal(health.checks.runninghub.status, 'degraded')
  assert.match(health.checks.runninghub.note ?? '', /503/)
  assert.equal(health.status, 'degraded')
})

test('checkHealth: upstream yang tidak menjawab sama sekali = error + degraded', async () => {
  statuses = { createpulse: 401, framia: 404, runninghub: 200 }
  deadHost = 'runninghub'

  const health = await checkHealth()

  assert.equal(health.checks.runninghub.status, 'error')
  assert.match(health.checks.runninghub.error ?? '', /ECONNRESET/)
  assert.equal(health.status, 'degraded')
})
