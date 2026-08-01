const LEONARDO_PROXY = '/api/public/leonardo'
const LEONARDO_UPLOAD_PROXY = '/api/public/leonardo-upload'

function getStoredKeys(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem('arkxmotion.leonardo.keys')
    if (!raw) return []
    const parsed = JSON.parse(raw)
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.keys) ? parsed.keys : []
    return arr.map((k: any) => k?.key).filter((k: any) => !!k)
  } catch {
    return []
  }
}

function decodeJwt(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4)
    if (typeof atob === 'function') {
      return JSON.parse(atob(padded))
    }
    const bytes = Uint8Array.from(padded, (c) => c.charCodeAt(0))
    const decoded = new TextDecoder().decode(bytes)
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

function isTokenExpired(token: string): boolean {
  const payload = decodeJwt(token)
  if (!payload?.exp) return false
  return Date.now() > payload.exp * 1000
}

function isLeonardoJwtFormat(token: string): boolean {
  return /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token.trim())
}

function isLeonardoRetryableError(message: string): boolean {
  const lower = (message || '').toLowerCase()
  return /credit|insufficient|not enough|out of|balance|quota|exhaust|limit|too many|rate.?limit|402|401|403|unauthor|forbidden|expired|invalid.*token|token.*invalid|500|502|503|504|server error|network|fetch|timeout/.test(lower)
}

export interface LeonardoApiOptions {
  token: string
  base?: 'api' | 'cloud'
  path: string
  method?: string
  body?: any
}

export async function leonardoApi<T = any>(opts: LeonardoApiOptions): Promise<T> {
  const res = await fetch(LEONARDO_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${opts.token}` },
    body: JSON.stringify({ base: opts.base || 'api', path: opts.path, method: opts.method || 'GET', body: opts.body }),
  })
  const json = await res.json().catch(() => null)
  if (!json?.ok) {
    const errMsg = json?.error || json?.message || json?.detail || json?.errors?.[0]?.message || `HTTP ${res.status}`
    throw new Error(`Leonardo ${opts.method || 'GET'} ${opts.path}: ${errMsg}`)
  }
  return json.data
}

export async function withLeonardoTokens<T>(
  fn: (token: string) => Promise<T>,
  opts?: { skipExpired?: boolean; onRotate?: (index: number, total: number, reason: string) => void }
): Promise<T> {
  const keys = getStoredKeys()
  if (keys.length === 0) throw Error('Belum ada token Leonardo. Buka Manage → Tokens → Leonardo dan tambahkan Bearer JWT.')

  let lastError: Error | null = null
  for (let i = 0; i < keys.length; i++) {
    const token = keys[i]
    if (opts?.skipExpired && isTokenExpired(token)) {
      lastError = Error(`Token #${i + 1} expired`)
      opts?.onRotate?.(i + 1, keys.length, 'token expired')
      continue
    }
    try {
      return await fn(token)
    } catch (err) {
      const e = err instanceof Error ? err : Error(String(err))
      lastError = e
      if (!isLeonardoRetryableError(e.message) || i === keys.length - 1) throw e
      opts?.onRotate?.(i + 1, keys.length, e.message)
    }
  }
  throw lastError ?? Error('Leonardo: semua token gagal / expired')
}

export async function fetchLeonardoUserDetails(token: string) {
  const payload = decodeJwt(token)
  const sub = payload?.sub
  if (sub) {
    try {
      const res = await leonardoApi({
        token,
        base: 'api',
        path: '/v1/graphql',
        method: 'POST',
        body: {
          query: `query GetUserTokensFromSub($sub: String) {
            user_details(where: {cognitoId: {_eq: $sub}}) {
              id plan auth0Email tokenRenewalDate
              streamTokens paidTokens subscriptionTokens rolloverTokens
              subscriptionGptTokens subscriptionModelTokens apiCredit
              apiSubscriptionTokens apiPaidTokens
            }
          }`,
          operationName: 'GetUserTokensFromSub',
          variables: { sub },
        },
      })
      return res?.data?.user_details?.[0] ?? null
    } catch { /* fallback below */ }
  }
  const res = await leonardoApi({
    token,
    base: 'api',
    path: '/v1/graphql',
    method: 'POST',
    body: {
      query: `query GetUserDetails {
        user_details {
          id plan auth0Email tokenRenewalDate
          streamTokens paidTokens subscriptionTokens rolloverTokens
          subscriptionGptTokens subscriptionModelTokens apiCredit
          apiSubscriptionTokens apiPaidTokens
        }
      }`,
      operationName: 'GetUserDetails',
    },
  })
  return res?.data?.user_details?.[0] ?? null
}

export async function fetchLeonardoBalance(token: string) {
  const details = await fetchLeonardoUserDetails(token)
  if (!details) return { ok: false as const, balance: null as number | null, message: 'user_details kosong' }

  const fast = typeof details.subscriptionTokens === 'number' ? details.subscriptionTokens : null
  const rollover = typeof details.rolloverTokens === 'number' ? details.rolloverTokens : null
  const gpt = typeof details.subscriptionGptTokens === 'number' ? details.subscriptionGptTokens : null
  const model = typeof details.subscriptionModelTokens === 'number' ? details.subscriptionModelTokens : null
  const paid = typeof details.paidTokens === 'number' ? details.paidTokens : null
  const apiCredit = typeof details.apiCredit === 'number' ? details.apiCredit : null

  const parts = [fast, rollover].filter((v) => typeof v === 'number') as number[]
  const totalBalance = parts.length ? parts.reduce((a, b) => a + b, 0) : null

  return {
    ok: true as const,
    balance: totalBalance,
    fastTokens: fast,
    rolloverTokens: rollover,
    gptTokens: gpt,
    modelTokens: model,
    paidTokens: paid,
    apiCredit,
    renewalDate: details.tokenRenewalDate,
    email: details.auth0Email || details.email,
  }
}

export async function validateLeonardoToken(token: string) {
  if (!isLeonardoJwtFormat(token)) return { ok: false as const, message: 'Format token salah (harus JWT eyJ...eyJ...)' }
  const payload = decodeJwt(token)
  if (!payload?.exp) return { ok: false as const, message: 'JWT tidak berisi exp' }
  const expMs = payload.exp * 1000
  if (Date.now() > expMs) return { ok: false as const, message: `Token expired ${new Date(expMs).toLocaleString()}` }
  return { ok: true as const, expiresAt: expMs, email: payload.email || payload['cognito:username'] }
}

export async function leonardoUploadImage(token: string, file: File | Blob, ext?: string): Promise<string> {
  const extension = ext || (file instanceof File ? (file.name.split('.').pop() || 'png') : 'png')
  const arrBuf = await file.arrayBuffer()
  const bytes = new Uint8Array(arrBuf)
  let binary = ''
  const chunk = 32768
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  const b64 = btoa(binary)

  const res = await fetch(LEONARDO_UPLOAD_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Leonardo-Token': token },
    body: JSON.stringify({ b64, ext: extension, mime: file.type || undefined }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.ok || !json?.id) throw Error(`Leonardo upload gagal: ${json?.error || res.status}`)
  return json.id
}

export async function fetchImageAsBlob(url: string): Promise<{ blob: Blob; ext: string }> {
  let res: Response
  try {
    res = await fetch(url)
    if (!res.ok) throw Error(`${res.status}`)
  } catch {
    res = await fetch(`/api/public/proxy-image?url=${encodeURIComponent(url)}`)
    if (!res.ok) throw Error(`proxy-image ${res.status}`)
  }
  const blob = await res.blob()
  const mime = (blob.type || '').toLowerCase()
  const ext = mime.includes('webp') ? 'webp' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png'
  return { blob, ext }
}

const GENERATE_MUTATION = `mutation Generate($request: CreateGenerationRequest!) {
  generate(request: $request) { apiCreditCost generationId __typename }
}`

function extractGenerationId(data: any): string | null {
  if (!data || typeof data !== 'object') return null
  const candidates = [
    data.generate?.generationId,
    data.generate?.generation_id,
    data.sdGenerationJob?.generationId,
    data.sdGenerationJob?.generation_id,
    data.generationId,
    data.generation_id,
    data.id,
    data.jobId,
    data.data?.generationId,
    data.data?.generation_id,
    data.data?.id,
    data.data?.generate?.generationId,
    data.data?.generate?.generation_id,
    data.data?.sdGenerationJob?.generationId,
    data.data?.sdGenerationJob?.generation_id,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c
  }
  return null
}

export async function leonardoGenerateVideo(token: string, opts: {
  slug: string
  prompt: string
  width: number
  height: number
  duration: number
  quantity?: number
  imageUrl?: string
  imageFile?: File
  imagePromptId?: string
}): Promise<{ generationId: string }> {
  const imagePromptIds: string[] = []
  if (opts.imagePromptId) {
    imagePromptIds.push(opts.imagePromptId)
  } else if (opts.imageUrl) {
    const { blob, ext } = await fetchImageAsBlob(opts.imageUrl)
    imagePromptIds.push(await leonardoUploadImage(token, blob, ext))
  } else if (opts.imageFile) {
    const ext = opts.imageFile.name?.toLowerCase().endsWith('.webp') ? 'webp'
      : opts.imageFile.name?.toLowerCase().endsWith('.png') ? 'png' : 'jpg'
    imagePromptIds.push(await leonardoUploadImage(token, opts.imageFile, ext))
  }

  const quantity = Math.max(1, Math.min(4, opts.quantity ?? 1))
  const parameters: any = {
    prompt: opts.prompt,
    width: opts.width,
    height: opts.height,
    duration: opts.duration,
    quantity,
  }

  if (imagePromptIds.length > 0) {
    parameters.guidances = {
      image_reference: imagePromptIds.slice(0, 4).map((id) => ({
        image: { id, type: 'UPLOADED' },
        strength: 'MID',
      })),
    }
  }

  const requestBody = {
    operationName: 'Generate',
    variables: { request: { model: opts.slug, public: true, parameters } },
    query: GENERATE_MUTATION,
  }

  console.log(`[leonardo-video] imagePromptIds:`, imagePromptIds.map(id => id?.slice(0, 8)))
  console.log(`[leonardo-video] requestBody:`, JSON.stringify(requestBody).slice(0, 500))

  const data = await leonardoApi({
    token,
    base: 'api',
    path: '/v1/graphql',
    method: 'POST',
    body: requestBody,
  })

  const generationId = extractGenerationId(data)
  if (!generationId) throw Error(`Leonardo video: tidak ada generationId. ${JSON.stringify(data).slice(0, 800)}`)
  return { generationId }
}

export async function leonardoPollStatus(token: string, generationId: string): Promise<any> {
  const data = await leonardoApi({
    token,
    base: 'api',
    path: `/api/rest/v1/generations/${encodeURIComponent(generationId)}`,
    method: 'GET',
  })
  return data?.generations_by_pk ?? null
}

export function extractVideoUrl(gen: any): string | null {
  if (!gen || typeof gen !== 'object') return null
  if (typeof gen.motionMP4URL === 'string' && gen.motionMP4URL.trim()) return gen.motionMP4URL
  for (const img of gen.generated_images ?? []) {
    if (typeof img.motionMP4URL === 'string' && img.motionMP4URL.trim()) return img.motionMP4URL
    if (typeof img.videoUrl === 'string' && img.videoUrl.trim()) return img.videoUrl
    if (typeof img.url === 'string' && /\.(mp4|webm|mov)(\?|$)/i.test(img.url)) return img.url
  }
  const firstUrl = gen.generated_images?.[0]?.url
  return typeof firstUrl === 'string' && firstUrl.trim() ? firstUrl : null
}

export interface LeonardoVideoRunOptions {
  token?: string
  modelKey: string
  prompt: string
  aspectRatio?: string
  sizeTier?: string
  resolution?: string
  duration?: number
  quantity?: number
  imageUrl?: string
  imageFile?: File
  timeoutMs?: number
  pollIntervalMs?: number
  onProgress?: (text: string, pct?: number) => void
  onRotate?: (index: number, total: number, reason: string) => void
}

export async function runLeonardoVideo(opts: LeonardoVideoRunOptions): Promise<string> {
  const execute = async (token: string) => {
    const { getLeonardoVideoModel, resolveLeonardoSize } = await import('./leonardo-video')
    const model = getLeonardoVideoModel(opts.modelKey)
    if (!model) throw Error(`Leonardo video: model tidak dikenal (${opts.modelKey})`)

    let duration = opts.duration ?? model.durations[0]
    if (model.durationMode === 'buttons') {
      if (!model.durations.includes(duration)) duration = model.durations[0]
    } else {
      const [min, max] = [model.durations[0], model.durations[model.durations.length - 1]]
      duration = Math.max(min, Math.min(max, Math.round(duration)))
    }

    const ar = model.aspectRatios.includes(opts.aspectRatio || '') ? opts.aspectRatio! : model.aspectRatios[0]
    const tier = resolveLeonardoSize(model, opts.sizeTier || opts.resolution)
    const { width, height } = resolveDimensions(ar, tier)

    const timeout = opts.timeoutMs ?? 480_000
    const pollInterval = opts.pollIntervalMs ?? 5_000

    opts.onProgress?.(`Leonardo: submit ${model.label} (${tier.label} · ${duration}s · ${ar})…`, 15)

    const { generationId } = await leonardoGenerateVideo(token, {
      slug: model.slug,
      prompt: opts.prompt,
      width,
      height,
      duration,
      quantity: opts.quantity ?? 1,
      imageUrl: opts.imageUrl,
      imageFile: opts.imageFile,
    })

    opts.onProgress?.(`Leonardo: generation ${generationId.slice(0, 8)}… rendering`, 30)

    const start = Date.now()
    let lastStatus = ''
    while (Date.now() - start < timeout) {
      await new Promise((r) => setTimeout(r, pollInterval))
      const gen = await leonardoPollStatus(token, generationId)
      if (!gen) continue

      if (gen.status !== lastStatus) {
        lastStatus = gen.status
        opts.onProgress?.(`Leonardo: ${gen.status}`, gen.status === 'COMPLETE' ? 95 : 50)
      }

      if (gen.status === 'COMPLETE') {
        const url = extractVideoUrl(gen)
        if (!url) throw Error(`Leonardo video: status COMPLETE tapi URL tidak ditemukan. ${JSON.stringify(gen).slice(0, 400)}`)
        opts.onProgress?.(`Leonardo: selesai`, 100)
        return url
      }

      if (gen.status === 'FAILED') throw Error('Leonardo video: generation FAILED')

      const elapsed = Math.round((Date.now() - start) / 1000)
      opts.onProgress?.(`Leonardo: rendering… (${elapsed}s)`, Math.min(90, 30 + elapsed))
    }
    throw Error('Leonardo video: timeout')
  }

  if (opts.token) return execute(opts.token)
  return withLeonardoTokens(execute, { skipExpired: true, onRotate: opts.onRotate })
}

function resolveDimensions(aspectRatio: string, tier: { short: number; long: number }): { width: number; height: number } {
  const { short: s, long: l } = tier
  switch (aspectRatio) {
    case '9:16': return { width: s, height: l }
    case '16:9': return { width: l, height: s }
    case '1:1': return { width: s, height: s }
    case '3:4': return { width: s, height: Math.round(s * 4 / 3) }
    case '4:3': return { width: Math.round(s * 4 / 3), height: s }
    default: return { width: s, height: l }
  }
}

const GENERATE_IMAGE_MUTATION = `mutation CreateGeneration($input: CreateGenerationInput!) {
  createGeneration(input: $input) {
    sdGenerationJob {
      generationId
      generatedImages { id url }
      __typename
    }
    __typename
  }
}`

const GENERATE_IMAGE_REST = '/api/rest/v1/generations'

export async function leonardoGenerateImage(token: string, opts: {
  modelId: string
  prompt: string
  width: number
  height: number
  negativePrompt?: string
  numImages?: number
  quality?: string
  promptEnhance?: string
  guidanceScale?: number
  seed?: number
  imageUrl?: string
}): Promise<{ generationId: string }> {
  const restBody: any = {
    prompt: opts.prompt,
    modelId: opts.modelId,
    width: opts.width,
    height: opts.height,
    num_images: opts.numImages ?? 1,
    ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
    ...(opts.guidanceScale != null ? { guidance_scale: opts.guidanceScale } : {}),
    ...(opts.seed != null ? { seed: opts.seed } : {}),
    ...(opts.quality ? { quality: opts.quality.toLowerCase() } : {}),
    ...(opts.promptEnhance === 'AUTO' ? { enhance_prompt: true } : {}),
    ...(opts.imageUrl ? { init_image: opts.imageUrl } : {}),
    public: true,
  }

  let data: any
  try {
    data = await leonardoApi({
      token,
      base: 'api',
      path: GENERATE_IMAGE_REST,
      method: 'POST',
      body: restBody,
    })
  } catch (restErr) {
    const restErrMsg = restErr instanceof Error ? restErr.message : String(restErr)
    const requestBody = {
      operationName: 'CreateGeneration',
      variables: {
        input: restBody,
      },
      query: GENERATE_IMAGE_MUTATION,
    }
    try {
      data = await leonardoApi({
        token,
        base: 'api',
        path: '/v1/graphql',
        method: 'POST',
        body: requestBody,
      })
    } catch (gqlErr) {
      const gqlErrMsg = gqlErr instanceof Error ? gqlErr.message : String(gqlErr)
      const combinedErr = `Leonardo ${restErrMsg} | GraphQL: ${gqlErrMsg}`
      if (/does not support|cannot read|model.*not.*found|photo/i.test(combinedErr)) {
        throw Error(`Leonardo: model (UUID ${opts.modelId}) tidak didukung untuk generasi gambar. ` +
          `Model mungkin sudah tidak tersedia. Coba pilih model lain atau refresh halaman. ` +
          `Detail: ${gqlErrMsg}`)
      }
      throw Error(`Leonardo image generate gagal: ${restErrMsg}; GraphQL: ${gqlErrMsg}`)
    }
  }

  const generationId = extractGenerationId(data)
  if (!generationId) throw Error(`Leonardo image: tidak ada generationId. ${JSON.stringify(data).slice(0, 800)}`)
  return { generationId }
}

export function extractImageUrl(gen: any): string | null {
  if (!gen || typeof gen !== 'object') return null
  if (typeof gen.url === 'string' && gen.url.trim() && !/\.(mp4|webm|mov)(\?|$)/i.test(gen.url)) return gen.url
  for (const img of gen.generated_images ?? []) {
    if (typeof img.url === 'string' && img.url.trim() && !/\.(mp4|webm|mov)(\?|$)/i.test(img.url)) return img.url
    if (typeof img.image === 'string' && img.image.trim()) return img.image
  }
  return null
}

export async function runLeonardoImage(opts: {
  token?: string
  modelId: string
  prompt: string
  aspectRatio?: string
  sizeId?: string
  sizeShort?: number
  negativePrompt?: string
  quality?: string
  promptEnhance?: string
  numImages?: number
  imageUrl?: string
  timeoutMs?: number
  pollIntervalMs?: number
  onProgress?: (text: string, pct?: number) => void
  onRotate?: (index: number, total: number, reason: string) => void
}): Promise<string> {
  const execute = async (token: string) => {
    const ar = opts.aspectRatio || '1:1'
    let w: number, h: number

    if (opts.sizeShort) {
      // Use sizeShort (aacreative style: base dimension + ratio calculation)
      const ratio = (() => {
        switch (ar) {
          case '1:1': return 1
          case '16:9': return 16 / 9
          case '9:16': return 9 / 16
          case '4:3': return 4 / 3
          case '3:4': return 3 / 4
          case '2:3': return 2 / 3
          case '3:2': return 3 / 2
          default: return 1
        }
      })()
      const short = opts.sizeShort
      if (ratio >= 1) {
        w = Math.ceil(short * ratio / 16) * 16
        h = Math.ceil(short / 16) * 16
      } else {
        w = Math.ceil(short / 16) * 16
        h = Math.ceil(short / ratio / 16) * 16
      }
    } else {
      const sizeMap: Record<string, { w: number; h: number }> = {
        '1024': { w: 1024, h: 1024 },
        '1536': { w: 1536, h: 1024 },
        '2048': { w: 2048, h: 2048 },
        'small': { w: 1024, h: 1024 },
        'medium': { w: 1536, h: 1536 },
        'large': { w: 2048, h: 2048 },
      }
      let dims = sizeMap[opts.sizeId || '1024'] || sizeMap['1024']
      w = dims.w
      h = dims.h
      if (ar === '16:9') { w = Math.round(w * 16 / 9); h = Math.round(h * 9 / 16) }
      else if (ar === '9:16') { w = Math.round(w * 9 / 16); h = Math.round(h * 16 / 9) }
      else if (ar === '4:3') { w = Math.round(w * 4 / 3) }
      else if (ar === '3:4') { h = Math.round(h * 4 / 3) }
    }

    opts.onProgress?.(`Leonardo: submit image (${w}×${h})…`, 15)

    const { generationId } = await leonardoGenerateImage(token, {
      modelId: opts.modelId,
      prompt: opts.prompt,
      width: w,
      height: h,
      negativePrompt: opts.negativePrompt,
      numImages: opts.numImages,
      quality: opts.quality,
      promptEnhance: opts.promptEnhance,
      imageUrl: opts.imageUrl,
    })

    opts.onProgress?.(`Leonardo: generation ${generationId.slice(0, 8)}…`, 30)

    const timeout = opts.timeoutMs ?? 180_000
    const pollInterval = opts.pollIntervalMs ?? 4_000
    const start = Date.now()
    let lastStatus = ''

    while (Date.now() - start < timeout) {
      await new Promise((r) => setTimeout(r, pollInterval))
      const gen = await leonardoPollStatus(token, generationId)
      if (!gen) continue

      if (gen.status !== lastStatus) {
        lastStatus = gen.status
        opts.onProgress?.(`Leonardo: ${gen.status}`, gen.status === 'COMPLETE' ? 95 : 50)
      }

      if (gen.status === 'COMPLETE') {
        const url = extractImageUrl(gen)
        if (!url) throw Error(`Leonardo image: COMPLETE tapi URL tidak ditemukan. ${JSON.stringify(gen).slice(0, 400)}`)
        opts.onProgress?.(`Leonardo: selesai`, 100)
        return url
      }

      if (gen.status === 'FAILED') throw Error('Leonardo image: generation FAILED')

      const elapsed = Math.round((Date.now() - start) / 1000)
      opts.onProgress?.(`Leonardo: rendering… (${elapsed}s)`, Math.min(90, 30 + elapsed))
    }
    throw Error('Leonardo image: timeout')
  }

  if (opts.token) return execute(opts.token)
  return withLeonardoTokens(execute, { skipExpired: true, onRotate: opts.onRotate })
}

export { isTokenExpired, isLeonardoJwtFormat, decodeJwt, isLeonardoRetryableError }
