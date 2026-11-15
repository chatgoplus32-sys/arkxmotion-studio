import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function harness() {
  let token: string | null = 'test'
  let tick: (() => Promise<void>) | undefined
  let visible = false
  let failure: Error | null = null
  const patches: any[] = []
  let polls = 0
  let results = 0
  let lists = 0
  let refunds = 0
  const job = { provider: 'nexabot', job_id: 'test-job', page: 'video-edit' }
  const exports: any = {}
  const modules: Record<string, any> = {
    '@/stores/authStore': { useAuthStore: { getState: () => ({ token, refresh: async () => false }) } },
    '@/lib/providerServerKey': { SERVER_KEY: 'server-managed' },
    '@/lib/backgroundTasks': {
      GENERATION_PAGE_PATH: { 'video-edit': '/video-edit' },
      startGenerationTask: () => 'task', removeActiveTask: () => {},
      addResumeFailure: () => {}, dismissResumeFailure: () => {}, addResult: () => { results++ },
    },
    '@/lib/pendingCharges': {
      pairPendingCharge: () => {}, hasResumeCharge: () => false,
      takeResumeCharge: () => ({ provider: 'nexabot', usageId: 77, at: Date.now() }),
      clearResumeCharge: () => {},
    },
    '@/lib/nexabot': {
      pollNexabotJob: async () => { polls++; if (failure) throw failure },
      saveNexabotResult: async () => ({ ok: true, url: '/test.mp4' }),
    },
  }
  const source = readFileSync(new URL('../src/lib/jobTracking.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(compiled, {
    exports, require: (id: string) => { assert.ok(modules[id], id); return modules[id] },
    localStorage: { getItem: () => token },
    window: { setInterval: (fn: any) => { tick = fn; return 1 }, clearInterval: () => {}, location: { pathname: '/video-edit' } },
    fetch: async (url: string, options: any) => {
      if (options?.method === 'PATCH') { patches.push(JSON.parse(options.body)); return Response.json({ ok: true }) }
      if (url.includes('/claim/')) return Response.json({ claimed: true })
      if (url.includes('/refund')) { refunds++; return Response.json({ ok: true }) }
      lists++
      return Response.json({ jobs: visible ? [job] : [] })
    },
  })
  return { api: exports, patches, get polls() { return polls }, get results() { return results }, get lists() { return lists }, get refunds() { return refunds },
    setVisible: () => { visible = true }, setToken: (value: string | null) => { token = value },
    setFailure: (error: Error | null) => { failure = error },
    tick: async () => { tick?.(); await new Promise(resolve => setImmediate(resolve)) },
  }
}

test('periodic recovery discovers jobs after grace and after login', async () => {
  const h = harness()
  h.setToken(null)
  const stop = h.api.startGenerationJobRecovery()
  await h.tick()
  assert.equal(h.lists, 0)
  h.setToken('test')
  await h.tick()
  assert.equal(h.polls, 0)
  h.setVisible()
  await h.tick()
  assert.equal(h.results, 1)
  stop()
})

test('network interruption releases job as pending and can resume successfully', async () => {
  const h = harness()
  h.setVisible()
  h.setFailure(new Error('Network timeout'))
  await h.api.resumePendingGenerationJobs()
  assert.equal(h.patches[0].status, 'pending')
  assert.equal(h.refunds, 0, 'interruption bukan kegagalan terminal — saldo tidak boleh direfund')
  h.setFailure(null)
  await h.api.resumePendingGenerationJobs()
  assert.equal(h.results, 1)
})

test('only confirmed provider failure is terminal', async () => {
  const h = harness()
  h.setVisible()
  h.setFailure(Object.assign(new Error('rejected by provider'), { name: 'NexabotJobFailed' }))
  await h.api.resumePendingGenerationJobs()
  assert.equal(h.patches[0].status, 'failed')
  assert.equal(h.refunds, 1, 'kegagalan terminal harus mengembalikan saldo potongan job itu')
})
