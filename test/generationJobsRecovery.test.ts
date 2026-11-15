import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'node:net'

process.env.ARKXMOTION_DB_PATH = ':memory:'
process.env.JWT_SECRET = 'test-job-recovery'
const { default: db } = await import('../server/db.js')
const { default: routes } = await import('../server/routes/generationJobs.js')
const app = express()
app.use(express.json())
app.use('/jobs', routes)
const server = app.listen(0, '127.0.0.1')
await new Promise<void>(resolve => server.once('listening', resolve))
after(() => { server.close(); db.close() })
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jobs`
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: 1, role: 'user' }, process.env.JWT_SECRET!)}` }
const call = (path: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })

test('grace, atomic claim, interrupted retry, and completed state protection', async () => {
  assert.equal((await call('', 'POST', { provider: 'nexabot', jobId: 'j1' })).status, 200)
  assert.equal((await (await call('')).json()).jobs.length, 0)
  db.prepare('UPDATE generation_job SET updated_at=?').run(Date.now() - 91_000)
  assert.equal((await (await call('')).json()).jobs.length, 1)
  const claims = await Promise.all([call('/claim/nexabot/j1', 'POST'), call('/claim/nexabot/j1', 'POST')])
  const claimed = await Promise.all(claims.map(r => r.json()))
  assert.equal(claimed.filter(r => r.claimed).length, 1)
  assert.equal((await call('/nexabot/j1', 'PATCH', { status: 'pending', error: 'timeout' })).status, 200)
  db.prepare('UPDATE generation_job SET updated_at=?').run(Date.now() - 91_000)
  assert.equal((await (await call('')).json()).jobs.length, 1)
  await call('/claim/nexabot/j1', 'POST')
  assert.equal((await call('/nexabot/j1', 'PATCH', { status: 'done', resultUrl: '/result.mp4' })).status, 200)
  assert.equal((await call('/nexabot/j1', 'PATCH', { status: 'pending' })).status, 404)
  assert.equal((db.prepare('SELECT status FROM generation_job').get() as any).status, 'done')
  assert.equal((await (await call('')).json()).jobs.length, 0)
})
