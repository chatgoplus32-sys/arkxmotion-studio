// Freebeat AI image client — api.freebeatfit.com via relay /api/public/freebeat
// Kontrak terverifikasi dari paket resmi npm `freebeat-mcp` v0.1.4 (MIT) +
// probe katalog live freebeat.ai 11 Nov 2026 (POST
// freebeat.ai/api/proxy/v1/aiModelConfig/getAiRuleConfig — businessType 9 =
// generate, 11 = edit; per-model rule via getModelRuleConfig).
//
// Auth: header `Authorization: <API_KEY>` MENTAH (tanpa "Bearer") — persis
// seperti yang dilakukan paket freebeat-mcp. API key dibuat dari profil akun
// freebeat (app freebeat.ai → sidebar → API). Kredit freebeat dipotong
// langsung di akun upstream (500 gratis saat daftar; paket berbayar mulai
// Basic $4.99/minggu) — app ini TIDAK menagih saldo lokal untuk freebeat.
//
// Envelope upstream: { code: 0, msg, data } — code != 0 berarti gagal.
//
// Alur generate (satu item per batch):
//   POST /v1/ai/cli/createImageBatch → { batchId, items:[{serialNo, needCredits}] }
//   POST /v1/ai/cli/queryBatch       → items[{status, usedCredits, imageUrl}]
// status item: success/succeeded/completed = selesai; failed/failure/rejected = gagal.

const FREEBEAT_PROXY = '/api/public/freebeat'

export const FREEBEAT_ASPECTS = ['16:9', '1:1', '9:16', '4:3', '3:4'] as const

export interface FreebeatImageModel {
  /** modelId upstream (angka, dikirim sebagai string di body). */
  id: string
  label: string
  /** Kredit freebeat per generate. null = tarif bervariasi (lihat creditsNote). */
  credits: number | null
  /** Penjelasan tarif bila bervariasi (resolusi/quality/rasio). */
  creditsNote?: string
  /** Rasio yang diterima via parameter `size` (kosong = kirim tanpa size). */
  aspects: string[]
  /** true = hanya edit gambar (butuh gambar input), tidak bisa text-to-image. */
  editOnly?: boolean
}

// ── Katalog live 11 Nov 2026 (31 model generate + 1 edit-only) ──────────────
// Kredit dari getModelRuleConfig per model (fixed / branch_rule / combo_map).
export const FREEBEAT_IMAGE_MODELS: FreebeatImageModel[] = [
  { id: '80', label: 'Nano Banana 2', credits: 23, aspects: FREEBEAT_ASPECTS as unknown as string[] },
  { id: '122', label: 'Nano Banana 2 Lite', credits: 10, aspects: FREEBEAT_ASPECTS as unknown as string[] },
  { id: '202', label: 'Nano Banana 2.1', credits: null, creditsNote: '1K 18 · 2K 27 · 4K 59', aspects: [] },
  { id: '64', label: 'Nano Banana Pro', credits: 46, aspects: FREEBEAT_ASPECTS as unknown as string[] },
  { id: '53', label: 'Nano Banana', credits: 10, aspects: FREEBEAT_ASPECTS as unknown as string[] },
  { id: '92', label: 'Kling Image V3', credits: 19, aspects: [] },
  { id: '91', label: 'Qwen Image 2.0 Pro', credits: 40, aspects: [] },
  { id: '161', label: 'Qwen Image 3', credits: 40, aspects: [] },
  { id: '183', label: 'Qwen Image 3 Pro', credits: 15, creditsNote: '15 (rasio standar) · 28 (resolusi custom tinggi)', aspects: [] },
  { id: '76', label: 'Qwen Image Edit (edit-only)', credits: null, creditsNote: '≈16 kredit per MP gambar (edit)', aspects: [], editOnly: true },
  { id: '68', label: 'Z-Image Turbo', credits: 3, creditsNote: '3 · resolusi custom = ceil(MP)×3', aspects: FREEBEAT_ASPECTS as unknown as string[] },
  { id: '87', label: 'Wan V2.6', credits: 16, aspects: FREEBEAT_ASPECTS as unknown as string[] },
  { id: '99', label: 'Wan V2.7', credits: 16, aspects: FREEBEAT_ASPECTS as unknown as string[] },
  { id: '100', label: 'Wan V2.7 Pro', credits: 40, aspects: FREEBEAT_ASPECTS as unknown as string[] },
  { id: '88', label: 'Seedream 5.0 Lite', credits: 19, aspects: [] },
  { id: '209', label: 'Seedream 5.0 Flash', credits: 15, aspects: [] },
  { id: '89', label: 'Seedream V4.5', credits: 21, aspects: [] },
  { id: '125', label: 'Seedream 5.0 Pro', credits: 71, aspects: [] },
  { id: '67', label: 'Flux 2 Pro', credits: 16, creditsNote: '16 · resolusi custom +8/MP', aspects: FREEBEAT_ASPECTS as unknown as string[] },
  { id: '204', label: 'Flux 3 Image', credits: 25, aspects: FREEBEAT_ASPECTS as unknown as string[] },
  { id: '239', label: 'GPT-Image 2.6 Flare', credits: null, aspects: [] },
  { id: '240', label: 'GPT-Image 2.6 Sunburst', credits: null, aspects: [] },
  { id: '70', label: 'GPT-Image 1.5', credits: null, creditsNote: 'low 5 · medium 18 · high 70+ (per resolusi)', aspects: [] },
  { id: '108', label: 'GPT-Image 2', credits: null, creditsNote: 'tergantung quality + resolusi (low 1024x1024 = 5)', aspects: [] },
  { id: '189', label: 'GPT-Image 2.5 Flare', credits: null, aspects: [] },
  { id: '190', label: 'GPT-Image 2.5 Sunburst', credits: null, aspects: [] },
  { id: '20', label: 'Recraft v3', credits: 21, aspects: FREEBEAT_ASPECTS as unknown as string[] },
  { id: '118', label: 'Recraft v4.1', credits: 21, aspects: [] },
  { id: '124', label: 'Recraft v4.1 Utility', credits: 21, aspects: [] },
  { id: '208', label: 'Recraft v4.1 Flash', credits: 4, aspects: [] },
  { id: '176', label: 'Grok Image 2', credits: null, creditsNote: 'low 1K 21 · medium 1K 32 · 2K 42', aspects: [] },
  { id: '214', label: 'MOSS Image', credits: null, creditsNote: '16:9/9:16 16 · 3:4/4:3 21 · 1:1 28', aspects: [] },
]

/** Cari spec model berdasarkan id upstream (string angka). */
export function getFreebeatModel(id?: string | null): FreebeatImageModel | undefined {
  if (!id) return undefined
  return FREEBEAT_IMAGE_MODELS.find((m) => m.id === id)
}

// ── Tipe batch upstream ─────────────────────────────────────────────────────

export interface FreebeatBatchItem {
  businessType: 9 | 11
  modelId: string
  generationType: 6 | 8
  prompt: string
  /** URL gambar input (wajib untuk edit; dari catbox/R2 — publik). */
  images?: string[]
  /** Rasio "16:9" dst — hanya untuk model yang menerima (see aspects). */
  size?: string
  count?: number
}

export interface FreebeatBatchCreateResult {
  batchId: string
  acceptedCount: number
  failedCount: number
  acceptedCredits: number
  serialNo: string | null
  needCredits: number
  itemMessage: string | null
}

export interface FreebeatBatchQueryItem {
  serialNo: string
  status: string
  usedCredits: number
  errorCode: number | string | null
  errorMessage: string | null
  imageUrl: string | null
}

export interface FreebeatBatchQuery {
  batchId: string
  status: 'completed' | 'failed' | 'partial_failed' | 'running' | 'unknown'
  items: FreebeatBatchQueryItem[]
}

const DONE_STATUSES = ['success', 'succeeded', 'completed']
const FAIL_STATUSES = ['failed', 'failure', 'rejected']

function freebeatHeaders(key: string): Record<string, string> {
  return {
    Authorization: key.trim(),
    'Content-Type': 'application/json',
  }
}

/** Buka envelope {code,msg,data}; lempar Error dengan pesan upstream. */
async function unwrapEnvelope(res: Response, action: string): Promise<any> {
  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) } catch {
    throw new Error(`${action}: HTTP ${res.status} — respons bukan JSON (${text.slice(0, 120)})`)
  }
  if (!res.ok) {
    const msg = json?.msg || json?.error || `HTTP ${res.status}`
    throw new Error(`${action}: ${msg}`)
  }
  if (json?.code !== 0) {
    throw new Error(`${action}: ${json?.msg || `code ${json?.code}`}`)
  }
  return json.data
}

/**
 * Bangun satu item batch gambar. generate = businessType 9 / generationType 6;
 * edit = businessType 11 / generationType 8 + `imageUrl` (URL publik, mis. catbox).
 */
export function buildFreebeatImageItem(
  model: FreebeatImageModel,
  opts: { prompt: string; imageUrl?: string; aspect?: string; count?: number },
): FreebeatBatchItem {
  const edit = !!opts.imageUrl
  if (edit && model.editOnly === false && model.label.includes('edit-only')) {
    throw new Error(`${model.label} tidak mendukung edit — pilih model lain`)
  }
  const item: FreebeatBatchItem = {
    businessType: edit ? 11 : 9,
    modelId: model.id,
    generationType: edit ? 8 : 6,
    prompt: opts.prompt,
    count: opts.count && opts.count > 0 ? opts.count : 1,
  }
  if (edit) {
    item.images = [opts.imageUrl!]
  } else if (opts.aspect && model.aspects.includes(opts.aspect)) {
    item.size = opts.aspect
  }
  return item
}

/** Submit batch gambar ke freebeat (via relay). Satu item per panggilan. */
export async function createFreebeatImageBatch(
  key: string,
  item: FreebeatBatchItem,
): Promise<FreebeatBatchCreateResult> {
  const res = await fetch(`${FREEBEAT_PROXY}/v1/ai/cli/createImageBatch`, {
    method: 'POST',
    headers: freebeatHeaders(key),
    body: JSON.stringify({ items: [item] }),
  })
  const data = await unwrapEnvelope(res, 'Create image batch')
  const batch = data ?? {}
  const items = Array.isArray(batch.items) ? batch.items : []
  const first = items[0] || {}
  if (batch.acceptedCount === 0 || first.accepted === false) {
    throw new Error(first.message || `Batch ditolak upstream (status ${first.status || '?'})`)
  }
  return {
    batchId: String(batch.batchId || ''),
    acceptedCount: batch.acceptedCount ?? items.length,
    failedCount: batch.failedCount ?? 0,
    acceptedCredits: batch.acceptedCredits ?? first.needCredits ?? 0,
    serialNo: first.serialNo ?? null,
    needCredits: first.needCredits ?? 0,
    itemMessage: first.message ?? null,
  }
}

/** Poll status batch (sekali panggil — loop ada di pemanggil). */
export async function queryFreebeatBatch(key: string, batchId: string, serialNo?: string | null): Promise<FreebeatBatchQuery> {
  const res = await fetch(`${FREEBEAT_PROXY}/v1/ai/cli/queryBatch`, {
    method: 'POST',
    headers: freebeatHeaders(key),
    body: JSON.stringify(serialNo ? { batchId, serialNo } : { batchId }),
  })
  const data = await unwrapEnvelope(res, 'Query batch')
  const items = (Array.isArray(data?.items) ? data.items : []).map((raw: any) => ({
    serialNo: String(raw?.serialNo ?? ''),
    status: String(raw?.status ?? '').toLowerCase(),
    usedCredits: raw?.usedCredits ?? 0,
    errorCode: raw?.errorCode ?? null,
    errorMessage: raw?.errorMessage ?? null,
    imageUrl: raw?.imageUrl ?? (Array.isArray(raw?.editImages) ? raw.editImages[0] : null) ?? null,
  })) as FreebeatBatchQueryItem[]
  let status: FreebeatBatchQuery['status'] = 'unknown'
  if (items.length === 0) status = 'unknown'
  else if (items.every((i) => DONE_STATUSES.includes(i.status))) status = 'completed'
  else if (items.every((i) => FAIL_STATUSES.includes(i.status))) status = 'failed'
  else if (items.some((i) => FAIL_STATUSES.includes(i.status))) status = 'partial_failed'
  else status = 'running'
  return { batchId: String(data?.batchId ?? batchId), status, items }
}

/**
 * Polling sampai selesai/gagal. Interval default 5 detik, maksimum 8 menit
 * (gambar biasanya selesai < 60 detik, tapi model berat bisa lama).
 */
export async function pollFreebeatBatch(
  key: string,
  batchId: string,
  opts: { serialNo?: string | null; onLog?: (msg: string) => void; intervalMs?: number; maxMs?: number } = {},
): Promise<FreebeatBatchQuery> {
  const interval = opts.intervalMs ?? 5000
  const maxMs = opts.maxMs ?? 8 * 60 * 1000
  const started = Date.now()
  let attempt = 0
  for (;;) {
    attempt++
    let q: FreebeatBatchQuery
    try {
      q = await queryFreebeatBatch(key, batchId, opts.serialNo)
    } catch (err: any) {
      // Error polling jangan langsung membatalkan — upstream kadang 5xx
      // sementara. Ulangi sampai batas waktu.
      if (Date.now() - started > maxMs) throw err
      opts.onLog?.(`⚠️ Polling gagal (${err.message}) — dicoba ulang...`)
      await sleep(interval)
      continue
    }
    if (q.status === 'completed' || q.status === 'failed' || q.status === 'partial_failed') return q
    if (Date.now() - started > maxMs) {
      throw new Error(`Timeout menunggu batch ${batchId} (${Math.round(maxMs / 60000)} menit)`)
    }
    if (attempt % 3 === 0) opts.onLog?.(`⏳ Masih diproses (${Math.round((Date.now() - started) / 1000)}s)...`)
    await sleep(interval)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Saldo kredit akun freebeat (best-effort): endpoint web
 * /v1/user/credits/findCredits belum dijamin menerima API key CLI — hanya
 * web session/cookie yang didukung upstream. Kalau ditolak (401/403) atau
 * format tak dikenal, panggilan ini gagal lembut dan UI hanya menyembunyikan
 * saldo (generate tetap jalan dengan kunci yang valid).
 *
 * Dicoba beberapa bentuk body karena dokumentasi resmi untuk endpoint ini
 * belum tersedia. Saldo dicari secara rekursif di seluruh data respons.
 */
export async function fetchFreebeatCredits(key: string): Promise<{ ok: boolean; credits?: number; error?: string }> {
  const endpoints = [
    '/v1/user/credits/findCredits',
    '/v1/user/credits/getCreditsUsageRecords',
  ]
  const bodies: any[] = [{}, { uid: '' }, { userId: '' }]
  let lastStatus = 0
  let lastMsg = ''
  for (const ep of endpoints) {
    for (const body of bodies) {
      try {
        const res = await fetch(`${FREEBEAT_PROXY}${ep}`, {
          method: 'POST',
          headers: freebeatHeaders(key),
          body: JSON.stringify(body),
        })
        lastStatus = res.status
        const text = await res.text()
        let json: any
        try { json = JSON.parse(text) } catch {
          lastMsg = text.slice(0, 120)
          continue
        }
        if (res.status === 401 || res.status === 403 || json?.code === 401 || json?.code === 403) {
          return { ok: false, error: json?.msg || `API key tidak valid (HTTP ${res.status})` }
        }
        if (json?.code != null && json.code !== 0) {
          lastMsg = json?.msg || `code ${json?.code}`
          continue
        }
        const d = json?.data ?? json
        const credits = pickCreditNumber(d)
        if (credits != null) return { ok: true, credits }
        // kode 0 tapi format belum dikenal — coba body/endpoint berikutnya
      } catch {
        continue
      }
    }
  }
  // Semua upaya gagal menemukan saldo yang dikenali. Kunci tetap valid
  // (generate tidak bergantung pada endpoint saldo ini) — beri tahu UI
  // agar tidak menampilkan "Invalid".
  if (lastStatus > 0) {
    return { ok: true, error: lastMsg || 'saldo tidak dapat dicek via API key (gunakan dashboard freebeat)' }
  }
  return { ok: false, error: 'gagal memuat saldo' }
}

function pickCreditNumber(data: any, depth = 0): number | null {
  if (depth > 6) return null
  if (data == null) return null
  if (typeof data === 'number') return data
  if (typeof data === 'string') {
    const n = Number(data.trim())
    if (!isNaN(n) && n >= 0) return n
    return null
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = pickCreditNumber(item, depth + 1)
      if (found != null) return found
    }
    return null
  }
  if (typeof data === 'object') {
    const creditKeys = [
      'credits', 'credit', 'balance', 'remaining', 'total', 'remainCredits',
      'availableCredits', 'creditBalance', 'availableBalance', 'totalCredits',
      'creditsTotal', 'userCredits', 'accountCredits', 'point', 'points',
      'freeCredit', 'paidCredit', 'currentCredits', 'creditAmount',
    ]
    for (const k of creditKeys) {
      if (k in data) {
        const v = data[k]
        const found = pickCreditNumber(v, depth + 1)
        if (found != null) return found
      }
    }
    // Jika objek tidak punya kunci di atas, telusuri semua properti secara rekursif.
    for (const k of Object.keys(data)) {
      if (creditKeys.includes(k)) continue
      const found = pickCreditNumber(data[k], depth + 1)
      if (found != null) return found
    }
  }
  return null
}

/** Pesan error freebeat yang menunjuk API key (dipakai rotasi token). */
export function isFreebeatAuthError(message: string): boolean {
  return /401|403|unauthorized|forbidden|api.?key|invalid.*key|key.*invalid|token/i.test(message)
}

/** Pesan error freebeat yang menunjuk kredit habis. */
export function isFreebeatCreditError(message: string): boolean {
  return /credit|insufficient|balance|not enough|quota/i.test(message)
}
