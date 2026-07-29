const CREATEPULSE_BASE = 'https://createpulse.online'

interface GenerateOpts {
  apiKey: string
  prompt: string
  model?: string
  aspect?: string
  duration?: number
  initImageUrl?: string
  endFrameUrl?: string
  imageReferenceUrls?: string[]
  onLog?: (msg: string, level?: string) => void
  onStatus?: (text: string, pct: number) => void
}

interface GenerateResponse {
  ok: boolean
  batchId?: string
  cost?: number
  status?: string
  error?: string
}

interface StatusResponse {
  ok: boolean
  status: 'processing' | 'done' | 'failed'
  url?: string
  error?: string
  refunded?: boolean
  amount?: number
}

function httpError(status: number, body: any): Error {
  const msg = body?.error || ''
  switch (status) {
    case 400: return new Error(`Bad request: ${msg || 'missing prompt/batchId or invalid kind'}`)
    case 401: return new Error('Invalid or missing API key')
    case 402: return new Error('Insufficient balance')
    case 403: return new Error('Account disabled')
    case 404: return new Error('Batch not found')
    case 500: return new Error('Server error (try again)')
    case 502: return new Error('Server error (try again)')
    default: return new Error(msg || `HTTP ${status}`)
  }
}

function isTokenError(status: number): boolean {
  return status === 401
}

export { isTokenError }

export async function createpulseGenerate(opts: GenerateOpts): Promise<GenerateResponse> {
  const {
    apiKey,
    prompt,
    model = 'dreamina-seedance-2.0',
    aspect = '9:16',
    duration = 10,
    initImageUrl,
    endFrameUrl,
    imageReferenceUrls,
    onLog,
  } = opts

  if (!apiKey) throw new Error('No CreatePulse API key')

  const body: Record<string, any> = {
    kind: 'video',
    model,
    prompt,
    aspect,
    duration,
  }
  if (initImageUrl) body.init_image_url = initImageUrl
  if (endFrameUrl) body.end_frame_url = endFrameUrl
  if (imageReferenceUrls?.length) body.image_reference_urls = imageReferenceUrls

  onLog?.(`[createpulse] POST /api/generate model=${model} aspect=${aspect} duration=${duration}s`)

  const res = await fetch(`${CREATEPULSE_BASE}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = { error: text } }

  onLog?.(`[createpulse] response ${res.status}: ${JSON.stringify(data).slice(0, 300)}`)

  if (!res.ok) {
    throw httpError(res.status, data)
  }

  if (data.error) {
    throw new Error(data.error)
  }

  if (!data.batchId) {
    throw new Error('No batchId returned from CreatePulse')
  }

  return {
    ok: data.ok !== false,
    batchId: data.batchId,
    cost: data.cost,
    status: data.status,
  } as GenerateResponse
}

export async function createpulsePoll(
  apiKey: string,
  batchId: string,
  onLog?: (msg: string, level?: string) => void,
  onStatus?: (text: string, pct: number) => void
): Promise<string> {
  const maxPolls = 120
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 5000))

    const pct = Math.min(90, 10 + (i / maxPolls) * 80)
    onStatus?.(`Polling CreatePulse... (${i + 1}/${maxPolls})`, pct)

    const res = await fetch(`${CREATEPULSE_BASE}/api/status?batchId=${batchId}`, {
      headers: { 'X-API-Key': apiKey },
    })

    const text = await res.text()
    let data: StatusResponse
    try { data = JSON.parse(text) } catch { continue }

    onLog?.(`[createpulse] poll #${i + 1}: status=${data.status}`)

    if (data.status === 'done' && data.url) {
      onStatus?.('Done!', 100)
      return data.url
    }

    if (data.status === 'failed') {
      const msg = data.refunded
        ? `Failed (refunded $${data.amount}): ${data.error}`
        : `Failed: ${data.error}`
      throw new Error(msg)
    }
  }
  throw new Error('Timeout: CreatePulse generation took too long')
}

export async function generateWithCreatePulse(opts: GenerateOpts): Promise<string> {
  const { apiKey, prompt, model, aspect, duration, initImageUrl, endFrameUrl, imageReferenceUrls, onLog, onStatus } = opts

  onLog?.(`Submitting to CreatePulse... model=${model || 'dreamina-seedance-2.0'}`)
  onStatus?.('Submitting to CreatePulse...', 10)

  const result = await createpulseGenerate({
    apiKey,
    prompt,
    model,
    aspect,
    duration,
    initImageUrl,
    endFrameUrl,
    imageReferenceUrls,
    onLog,
    onStatus,
  })

  if (!result.batchId) throw new Error('No batchId returned from CreatePulse')
  onLog?.(`Batch created ✓ id=${result.batchId} cost=$${result.cost}`)
  onStatus?.(`Processing... (batch: ${result.batchId.slice(0, 8)}...)`, 20)

  const videoUrl = await createpulsePoll(apiKey, result.batchId, onLog, onStatus)
  onStatus?.('Done!', 100)
  return videoUrl
}
