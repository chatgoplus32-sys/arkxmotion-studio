// ─── Test tangga keputusan bridge mesin watermark ───────────────────────────
// Bridge (src/lib/watermark-engine.ts) mengemudikan halaman engine resmi lewat
// iframe. Yang dikunci di sini adalah KEPUTUSAN-nya, bukan render browser:
//   1. hasil ketat → dipakai, confidence 'strict';
//   2. engine menolak karena kepercayaan rendah → EngineLowConfidenceError,
//      BUKAN ekspor diam-diam (output mode longgar terukur bisa lebih buruk
//      daripada video aslinya, jadi keputusannya ada di pengguna);
//   3. mode paksa hanya aktif kalau pemanggil memintanya eksplisit;
//   4. penolakan lain (format/decoder) → error biasa, tanpa klaim low-confidence;
//   5. knob backend AI + checkbox allowLowConfidence benar-benar diset ke
//      halaman engine (kontrak DOM-nya bisa berubah kapan saja);
//   6. hasil run sebelumnya dibuang sebelum file baru masuk;
//   7. file diumpan sebagai File realm halaman engine (mesinnya mengecek
//      `instanceof Blob` dengan Blob miliknya sendiri);
//   8. batal lewat AbortSignal menekan stop engine.

import test, { before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  removeVideoWatermarkWithEngine,
  isLowConfidenceRejection,
  type EngineVideoResult,
} from '../src/lib/watermark-engine.js'

const LOW_CONF_TEXT = '视频水印检测置信度偏低，已停止导出。可打开低置信导出后重试。'
const BACKEND = 'allenk-fdncnn-browser-spike'

interface Plan {
  tone: 'success' | 'error' | 'info'
  text: string
  frames: number | null
  href?: string
}

class FakeEvent {
  type: string
  init: any
  constructor(type: string, init: any = {}) { this.type = type; this.init = init }
}

const file = new File(['video'], 'a.mp4', { type: 'video/mp4' })

// Mesinnya satu halaman shared: bridge menyimpan iframe-nya sekali seumur
// proses, jadi fakenya juga satu instance dengan antrean rencana per run.
const plans: Plan[] = []
const elements: Record<string, any> = {}
// Engine punya realm sendiri: File yang dibuat lewat konstruktor realmlah yang
// bisa dibaca reader internalnya (`x instanceof Blob`), jadi file yang diumpan
// bridge ke #fileInput harus lahir dari File milik halaman engine.
const engineFiles: any[] = []
const runtime: any = { progress: 0, phase: null, processedFrames: null, frameEstimate: null, aiDenoiseFrames: null }
const contentWindow: any = {
  Event: FakeEvent,
  __gwrVideoCliProgress: runtime,
  fetch: async () => ({ blob: async () => new Blob(['hasil-mesin'], { type: 'video/mp4' }) }),
  File: class EngineFile {
    name: string
    type: string
    size: number
    parts: unknown[]
    constructor(parts: unknown[], name: string, init: any = {}) {
      this.parts = parts
      this.name = name
      this.type = init.type
      this.size = parts.reduce<number>((n, p) => n + ((p as any)?.size ?? 0), 0)
      engineFiles.push(this)
    }
  },
  DataTransfer: class EngineTransfer {
    files: unknown[] = []
    items = { add: (f: any) => { this.files.push(f) } }
  },
}
const contentDocument: any = {
  getElementById: (id: string) => elements[id] || null,
  defaultView: contentWindow,
}
const frame: any = {
  contentWindow, contentDocument, src: '', style: {}, attrs: {},
  setAttribute(name: string, value: string) { this.attrs[name] = value },
  addEventListener(type: string, cb: () => void) { if (type === 'load') setTimeout(cb, 0) },
  remove() { this.removed = true },
  removed: false,
}

function mk(id: string, extra: Record<string, unknown> = {}) {
  const el: any = {
    id,
    dataset: {},
    style: {},
    dispatchEvent: () => true,
    setAttribute(name: string, value: string) { el[name] = value },
    getAttribute(name: string) { return el[name] },
    ...extra,
  }
  elements[id] = el
  return el
}

const status = mk('status', { textContent: '', dataset: { tone: 'info' } })
mk('progressBar', { style: { width: '0%' } })
mk('fileInput', { files: null })
mk('denoiseBackend', { value: 'canvas-footprint-polish' })
mk('allowLowConfidence', { checked: false })
mk('cancelBtn', { clicks: 0, click() { this.clicks++ } })
mk('downloadBtn', {
  href: '',
  getAttribute(name: string) { return (this as any)[name] },
  setAttribute(name: string, value: string) { (this as any)[name] = value },
})
mk('resetBtn', {
  clicks: 0,
  click() {
    this.clicks++
    status.dataset.tone = 'info'
    status.textContent = ''
    const link = elements.downloadBtn
    link.href = ''
    link.setAttribute('aria-disabled', 'true')
  },
})
mk('processBtn', {
  clicks: 0,
  click() {
    this.clicks++
    const plan = plans.shift()
    if (!plan) throw new Error('antrean rencana habis — bridge klik proses terlalu banyak')
    status.dataset.tone = plan.tone
    status.textContent = plan.text
    runtime.phase = plan.tone === 'success' ? 'export' : 'detect'
    runtime.processedFrames = plan.frames
    runtime.frameEstimate = plan.frames
    if (plan.href) {
      elements.downloadBtn.href = plan.href
      elements.downloadBtn.setAttribute('aria-disabled', 'false')
    }
  },
})

before(() => {
  const doc: any = {
    createElement: () => frame,
    body: { appendChild: () => undefined },
    getElementById: (id: string) => elements[id] || null,
  }
  ;(globalThis as any).document = doc
  ;(globalThis as any).Event = FakeEvent
})

beforeEach(() => {
  // Halaman fakenya persisten (sama seperti halaman engine sungguhan), jadi
  // setiap tes mulai dari antrean + knob yang bersih.
  plans.length = 0
  engineFiles.length = 0
  status.dataset.tone = 'info'
  status.textContent = ''
  elements.allowLowConfidence.checked = false
  elements.denoiseBackend.value = 'canvas-footprint-polish'
  delete contentWindow.__gwrVideoOverrideDenoiseBackend
  delete contentWindow.__gwrVideoOverrideAllowLowConfidence
  elements.downloadBtn.href = ''
  elements.downloadBtn.setAttribute('aria-disabled', 'true')
})

const run = (options = {}) => removeVideoWatermarkWithEngine(file, options)

test('hasil ketat dipakai, backend AI situs referensi dipaksa, gerbang longgar mati', async () => {
  plans.push({ tone: 'success', text: 'AI 去水印已完成，已处理 120 帧。', frames: 120, href: 'blob:engine/out.mp4' })
  const result: EngineVideoResult = await run()
  assert.equal(result.confidence, 'strict')
  assert.equal(result.frames, 120)
  assert.ok(result.blob.size > 0)
  assert.equal(elements.denoiseBackend.value, BACKEND)
  assert.equal(contentWindow.__gwrVideoOverrideDenoiseBackend, BACKEND)
  assert.equal(elements.allowLowConfidence.checked, false)
  assert.equal(contentWindow.__gwrVideoOverrideAllowLowConfidence, false)
})

test('penolakan kepercayaan rendah TIDAK otomatis diekspor paksa', async () => {
  plans.push({ tone: 'error', text: LOW_CONF_TEXT, frames: null })
  plans.push({ tone: 'success', text: 'done', frames: 5, href: 'blob:engine/lowconf.mp4' })
  const clicksBefore = elements.processBtn.clicks
  await assert.rejects(
    () => run(),
    (err: any) => isLowConfidenceRejection(err) && /tidak yakin/.test(err.message),
  )
  assert.equal(elements.processBtn.clicks - clicksBefore, 1, 'mode longgar hanya jalan kalau pemanggil yang minta')
  assert.equal(elements.allowLowConfidence.checked, false)
  assert.equal(plans.length, 1, 'rencana kedua tidak boleh dikonsumsi diam-diam')
})

test('mode paksa diekspor lewat gerbang longgar', async () => {
  plans.push({ tone: 'success', text: 'done', frames: 88, href: 'blob:engine/lowconf.mp4' })
  const result = await run({ allowLowConfidence: true })
  assert.equal(result.confidence, 'low-confidence')
  assert.equal(result.frames, 88)
  assert.equal(contentWindow.__gwrVideoOverrideAllowLowConfidence, true)
  assert.equal(elements.allowLowConfidence.checked, true)
})

test('penolakan format bukan dilaporkan sebagai kepercayaan rendah', async () => {
  plans.push({ tone: 'error', text: '无法解码该视频格式。', frames: null })
  await assert.rejects(
    () => run(),
    (err: any) => !isLowConfidenceRejection(err) && /format tidak didukung/.test(err.message),
  )
})

test('sukses tanpa tautan unduhan dianggap kegagalan, bukan hasil kosong', async () => {
  plans.push({ tone: 'success', text: 'done', frames: 3 })
  await assert.rejects(() => run(), /tidak menghasilkan file hasil/)
})

test('hasil run sebelumnya dibuang sebelum file baru masuk', async () => {
  plans.push({ tone: 'success', text: 'done', frames: 1, href: 'blob:engine/new.mp4' })
  elements.downloadBtn.href = 'blob:engine/stale.mp4'
  elements.downloadBtn.setAttribute('aria-disabled', 'false')
  const resetsBefore = elements.resetBtn.clicks
  await run()
  assert.equal(elements.resetBtn.clicks - resetsBefore, 1)
  assert.equal(elements.downloadBtn.href, 'blob:engine/new.mp4')
})

test('file diumpan lewat realm halaman engine, bukan realm kita', async () => {
  // Regresi nyata: File realm kita lolos ke <input> tapi ditolak reader engine
  // dengan "blob must be a Blob" (halaman engine mengecek `instanceof Blob`
  // memakai Blob miliknya sendiri).
  plans.push({ tone: 'success', text: 'done', frames: 2, href: 'blob:engine/out.mp4' })
  await run()
  assert.equal(engineFiles.length, 1, 'File harus dibuat dengan konstruktor realm engine')
  assert.equal(engineFiles[0].name, 'a.mp4')
  assert.equal(engineFiles[0].parts[0], file, 'byte video aslinya yang diumpan, bukan salinan')
  assert.equal(elements.fileInput.files[0], engineFiles[0])
})

test('AbortSignal menekan tombol stop engine dan membatalkan tanpa hasil', async () => {
  // 'info' = engine masih bekerja; runPass terus mempoll sampai dibatalkan.
  plans.push({ tone: 'info', text: '处理中…', frames: null })
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 800)
  const clicksBefore = elements.cancelBtn.clicks
  await assert.rejects(() => run({ signal: controller.signal }), /Dibatalkan/)
  assert.ok(elements.cancelBtn.clicks > clicksBefore, 'engine harus disuruh berhenti')
})
