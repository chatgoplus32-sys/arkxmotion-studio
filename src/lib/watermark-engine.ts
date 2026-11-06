/**
 * Jembatan ke mesin watermark video resmi (paket @pilio/gemini-watermark-remover).
 *
 * Situs referensi geminiwatermarkremover.io/video menjalankan mesinnya sebagai
 * halaman browser sendiri (dist/video-app.js): deteksi multi-kandidat, alpha
 * profile per ukuran frame, denoise AI FDnCNN ONNX, dan stabilisasi temporal.
 * Logika itu hanya ada di dalam bundel itu — tidak diekspor sebagai modul — jadi
 * cara paling jujur untuk "implementasi total" adalah menjalankan bundel aslinya
 * di iframe same-origin, sama seperti SDK resmi mereka menjalankan halaman itu
 * di Playwright (src/sdk/video.js). Kita yang mengumpan file, membaca progress,
 * dan mengambil blob hasilnya.
 *
 * Yang ditiru dari SDK resmi: knob di-set lewat window.__gwrVideo* sebelum klik
 * proses, selesai ditandai #status[data-tone]=success|error, macet diukur dari
 * "tidak ada perubahan" (bukan total durasi, karena video panjang memang lama),
 * dan hasil diambil dari href blob #downloadBtn dengan fetch dari dalam iframe.
 */

const ENGINE_PAGE = '/api/public/watermark-engine/video-preview.html'
const DEFAULT_INACTIVE_TIMEOUT_MS = 6 * 60 * 1000
const DEFAULT_HARD_TIMEOUT_MS = 30 * 60 * 1000
const POLL_INTERVAL_MS = 500
const DENOISE_BACKEND = 'allenk-fdncnn-browser-spike'

/**
 * Mesin menolak ekspor kalau deteksi tidak yakin ("...置信度偏低..."). Kami
 * mengenali penolakan ini lewat teksnya supaya bisa membedakan "posisi watermark
 * belum yakin" (pengguna boleh memaksa) dari "video ditolak decoder" (paksa
 * tidak akan membantu).
 */
const LOW_CONFIDENCE_MARKERS = ['置信度', '低置信']

export interface EngineProgress {
  /** 0..1, atau null selama engine belum melaporkan angka apa pun. */
  pct: number | null
  phase: string | null
  processedFrames: number | null
  frameEstimate: number | null
  aiDenoiseFrames: number | null
}

/** 'strict' = yakin; 'low-confidence' = diekspor lewat gerbang longgar. */
export type EngineConfidence = 'strict' | 'low-confidence'

export interface EngineVideoResult {
  blob: Blob
  frames: number | null
  confidence: EngineConfidence
}

export interface EngineVideoOptions {
  onProgress?: (progress: EngineProgress) => void
  signal?: AbortSignal
  timeoutMs?: number
  /**
   * Ekspor walau deteksi kurang yakin. Situs referensi menyimpan ini sebagai
   * kotak centang manual, dan hasil ukur kita menunjukkan outputnya bisa lebih
   * buruk daripada video asal — jadi hanya dipakai kalau pengguna meminta.
   */
  allowLowConfidence?: boolean
}

/**
 * Teks status engine berbahasa Mandarin dan tidak cocok untuk pengguna kita, jadi
 * yang dipakai hanya nada (tone), angka mentah, dan penanda gerbang kepercayaan.
 */
interface Snapshot {
  tone: string
  text: string
  pct: number | null
  phase: string | null
  processedFrames: number | null
  frameEstimate: number | null
  aiDenoiseFrames: number | null
}

let framePromise: Promise<HTMLIFrameElement> | null = null
let runQueue: Promise<unknown> = Promise.resolve()

/** Mesin menolak ekspor karena posisi watermark belum yakin (gerbang ketat). */
export class EngineLowConfidenceError extends Error {
  readonly isLowConfidenceRejection = true

  constructor(message: string) {
    super(message)
    this.name = 'EngineLowConfidenceError'
  }
}

export function isLowConfidenceRejection(error: unknown): boolean {
  return (error as any)?.isLowConfidenceRejection === true
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createFrame(): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.title = 'Watermark engine'
  // Sengaja bukan display:none/visibility:hidden: halaman engine membaca frame
  // lewat <video> + WebCodecs, dan elemen yang tidak ikut di-render bisa tidak
  // menghasilkan frame sama sekali. Offscreen tapi berdimensi nyata tetap aman.
  frame.style.cssText =
    'position:fixed;left:-10000px;top:0;width:960px;height:540px;border:0;pointer-events:none;'
  frame.src = ENGINE_PAGE
  document.body.appendChild(frame)
  return frame
}

function getFrame(): Promise<HTMLIFrameElement> {
  if (!framePromise) {
    framePromise = (async () => {
      const frame = createFrame()
      await new Promise<void>((resolve, reject) => {
        frame.addEventListener('load', () => resolve(), { once: true })
        frame.addEventListener('error', () => reject(Error('Gagal memuat halaman mesin watermark')), { once: true })
      })
      const doc = frame.contentDocument
      if (!doc?.getElementById('fileInput') || !doc.getElementById('processBtn')) {
        frame.remove()
        throw Error('Mesin watermark tidak tersedia di server (halaman engine tidak dapat dimuat)')
      }
      return frame
    })().catch((err) => {
      framePromise = null
      throw err
    })
  }
  return framePromise
}

function snapshot(frame: HTMLIFrameElement): Snapshot {
  const doc = frame.contentDocument!
  const status = doc.getElementById('status')
  const bar = doc.getElementById('progressBar')
  const runtime = (frame.contentWindow as any)?.__gwrVideoCliProgress
  const rawBar = Number.parseFloat(bar?.style?.width || '')
  const pct = Number.isFinite(runtime?.progress)
    ? Math.max(0, Math.min(1, runtime.progress))
    : Number.isFinite(rawBar)
      ? Math.max(0, Math.min(1, rawBar / 100))
      : null
  return {
    tone: status?.dataset?.tone || '',
    text: (status?.textContent || '').slice(0, 200),
    pct,
    phase: runtime?.phase || null,
    processedFrames: Number.isFinite(runtime?.processedFrames) ? runtime.processedFrames : null,
    frameEstimate: Number.isFinite(runtime?.frameEstimate) ? runtime.frameEstimate : null,
    aiDenoiseFrames: Number.isFinite(runtime?.aiDenoiseFrames) ? runtime.aiDenoiseFrames : null,
  }
}

function downloadHref(frame: HTMLIFrameElement): string | null {
  const link = frame.contentDocument?.getElementById('downloadBtn') as HTMLAnchorElement | null
  if (!link?.href || link.getAttribute('aria-disabled') === 'true') return null
  return link.href
}

/** Mesinnya satu halaman tunggal: dua proses bersamaan akan saling menimpa. */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = runQueue.then(task)
  runQueue = run.catch(() => undefined)
  return run
}

function setLowConfidence(view: Window & typeof globalThis, doc: Document, enabled: boolean): void {
  // Preset otomatis engine bisa menimpa checkbox ini seusai deteksi, jadi
  // override window (dibaca ulang tiap job) dipasang bersama checkbox-nya.
  ;(view as any).__gwrVideoOverrideAllowLowConfidence = enabled
  const box = doc.getElementById('allowLowConfidence') as HTMLInputElement | null
  if (box && box.checked !== enabled) {
    box.checked = enabled
    box.dispatchEvent(new view.Event('change', { bubbles: true }))
  }
}

/** Satu kali klik "proses" sampai engine memberi status akhir. */
async function runPass(
  frame: HTMLIFrameElement,
  doc: Document,
  options: EngineVideoOptions,
): Promise<Snapshot> {
  const { onProgress, signal, timeoutMs = DEFAULT_INACTIVE_TIMEOUT_MS } = options
  const processBtn = doc.getElementById('processBtn') as HTMLButtonElement | null
  if (!processBtn) throw Error('Halaman mesin watermark tidak lengkap')

  const abort = () => doc.getElementById('cancelBtn')?.click()
  signal?.addEventListener('abort', abort, { once: true })

  const startedAt = Date.now()
  let lastActivityAt = startedAt
  let lastSnapshotKey = ''
  try {
    processBtn.click()
    for (;;) {
      await sleep(POLL_INTERVAL_MS)
      const snap = snapshot(frame)
      const key = JSON.stringify(snap)
      if (key !== lastSnapshotKey) {
        lastSnapshotKey = key
        lastActivityAt = Date.now()
        onProgress?.({
          pct: snap.pct,
          phase: snap.phase,
          processedFrames: snap.processedFrames,
          frameEstimate: snap.frameEstimate,
          aiDenoiseFrames: snap.aiDenoiseFrames,
        })
      }
      if (signal?.aborted) throw Error('Dibatalkan')
      if (snap.tone === 'success' || snap.tone === 'error') return snap
      if (Date.now() - lastActivityAt >= timeoutMs) {
        throw Error(`Mesin berhenti memberi kemajuan setelah ${Math.round(timeoutMs / 1000)} detik`)
      }
      if (Date.now() - startedAt >= DEFAULT_HARD_TIMEOUT_MS) {
        throw Error('Mesin bekerja terlalu lama (batas 30 menit)')
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

async function runEngineVideo(file: File, options: EngineVideoOptions): Promise<EngineVideoResult> {
  const frame = await getFrame()
  const view = frame.contentWindow as Window & typeof globalThis
  const doc = frame.contentDocument!

  const input = doc.getElementById('fileInput') as HTMLInputElement | null
  if (!input) throw Error('Halaman mesin watermark tidak lengkap')

  // Hasil sebelumnya harus hilang supaya status dan tautan unduhan yang dibaca
  // benar-benar milik file ini.
  doc.getElementById('resetBtn')?.click()
  await sleep(150)

  // Engine membungkus file dengan reader yang menguji `x instanceof Blob`
  // memakai Blob milik realm halaman engine sendiri. File dari realm kita
  // (iframe = realm berbeda) lolos DOM tapi ditolak reader itu dengan
  // "blob must be a Blob", jadi File + DataTransfer-nya dibuat di realm iframe.
  const transfer = new (view as any).DataTransfer()
  transfer.items.add(new (view as any).File([file], file.name, { type: file.type }))
  input.files = transfer.files
  input.dispatchEvent(new view.Event('change', { bubbles: true }))

  // Biarkan engine menyelesaikan deteksi awalnya sendiri — persis seperti
  // pengguna situs referensi: pilih file, mesin mendeteksi, lalu ekspor.
  await sleep(400)

  const backend = doc.getElementById('denoiseBackend') as HTMLSelectElement | null
  if (backend && backend.value !== DENOISE_BACKEND) {
    ;(view as any).__gwrVideoOverrideDenoiseBackend = DENOISE_BACKEND
    backend.value = DENOISE_BACKEND
    backend.dispatchEvent(new view.Event('change', { bubbles: true }))
  }

  setLowConfidence(view, doc, options.allowLowConfidence === true)
  const snap = await runPass(frame, doc, options)

  if (snap.tone === 'error') {
    if (LOW_CONFIDENCE_MARKERS.some((marker) => snap.text.includes(marker))) {
      throw new EngineLowConfidenceError(
        'Mesin AI tidak yakin dengan posisi watermark di video ini — hasilnya bisa lebih buruk, jadi tidak dipakai otomatis.',
      )
    }
    // Teks errornya berbahasa Mandarin — yang berguna hanya bahwa engine menolak.
    throw Error('Mesin watermark menolak video ini (format tidak didukung atau decoder gagal)')
  }

  const href = downloadHref(frame)
  if (!href) throw Error('Mesin watermark tidak menghasilkan file hasil')
  const blob: Blob = await (view as any).fetch(href).then((res: Response) => res.blob())
  if (!blob || blob.size === 0) throw Error('Hasil mesin watermark kosong')

  return {
    blob,
    frames: snap.processedFrames,
    confidence: options.allowLowConfidence === true ? 'low-confidence' : 'strict',
  }
}

/**
 * Hapus watermark video memakai mesin resmi. Panggilan bersamaan diurutkan
 * karena mesinnya satu halaman shared.
 */
export function removeVideoWatermarkWithEngine(
  file: File,
  options: EngineVideoOptions = {},
): Promise<EngineVideoResult> {
  return serialize(() => runEngineVideo(file, options))
}
