import { getGensparkApiKey } from './genspark'

const GENSPARK_BASE = '/api/public/genspark'

// ─── Image Generation ──────────────────────────────────
export interface GensparkImageGenParams {
  query: string
  model?: string
  aspectRatio?: string
  imageSize?: string
  imageUrls?: string[]
}

export interface GensparkImageGenResult {
  status: 'ok' | 'error' | string
  data?: {
    image_urls?: string[]
    images?: Array<{ url: string }>
    url?: string
  }
  message?: string
}

export async function generateImage(params: GensparkImageGenParams): Promise<GensparkImageGenResult> {
  const apiKey = getGensparkApiKey()
  if (!apiKey) throw new Error('No Genspark API key')

  const args: Record<string, any> = { query: params.query }
  if (params.model) args.model = params.model
  if (params.aspectRatio) args.aspect_ratio = params.aspectRatio
  if (params.imageSize) args.image_size = params.imageSize
  if (params.imageUrls?.length) args.image_urls = params.imageUrls

  console.log('[genspark-tools] POST image_generation', JSON.stringify(args).slice(0, 300))

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120000) // 2 min

  try {
    const res = await fetch(`${GENSPARK_BASE}/api/tool_cli/image_generation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify(args),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Genspark image gen error: HTTP ${res.status} ${errText.slice(0, 100)}`)
    }

    const text = await res.text()
    console.log(`[genspark-tools] Image gen response: ${text.length} chars`)

    const lines = text.trim().split('\n')
    let finalResult: GensparkImageGenResult | null = null
    for (const line of lines) {
      if (!line || !line.startsWith('{')) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed.status || parsed.version === undefined) finalResult = parsed
      } catch {}
    }
    if (!finalResult) throw new Error('No valid result from Genspark image generation')
    return finalResult
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') throw new Error('Genspark image gen timeout (2 min)')
    throw err
  }
}

export function extractGensparkImageUrl(result: GensparkImageGenResult): string | null {
  const d = result.data as any
  if (!d) return null

  // Format 1: generated_images array (actual Genspark response)
  if (d.generated_images?.length) {
    const img = d.generated_images[0]
    // Prefer no-watermark version
    if (img.image_urls_nowatermark?.length) return img.image_urls_nowatermark[0]
    if (img.image_urls?.length) return img.image_urls[0]
    if (img.url) return img.url
  }

  // Format 2: direct image_urls array
  if (d.image_urls?.length) return d.image_urls[0]
  
  // Format 3: images array
  if (d.images?.length) return d.images[0].url
  
  // Format 4: direct url
  if (d.url) return d.url

  // Format 5: nested output/result
  if (d.output?.image_url) return d.output.image_url
  if (d.result?.image_url) return d.result.image_url

  console.log('[genspark-tools] extractGensparkImageUrl: no URL found in data keys:', Object.keys(d))
  return null
}

// ─── Second Brain ──────────────────────────────────────
export interface SecondBrainSource {
  name: string
  type: string
  repo_id?: string
  last_sync?: string
}

export interface SecondBrainNote {
  path: string
  content?: string
  source?: string
  updated_at?: string
}

export async function secondBrainAction(
  action: 'list-repos' | 'ls' | 'read' | 'grep' | 'log',
  params: {
    source?: string
    query?: string
    path?: string
    repo_id?: string
    limit?: number
  } = {}
): Promise<any> {
  const apiKey = getGensparkApiKey()
  if (!apiKey) throw new Error('No Genspark API key')

  const args: Record<string, any> = { action, ...params }

  console.log('[genspark-tools] POST sb-brain', JSON.stringify(args).slice(0, 300))

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000) // 1 min

  try {
    const res = await fetch(`${GENSPARK_BASE}/api/tool_cli/sb-brain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify(args),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Genspark Second Brain error: HTTP ${res.status} ${errText.slice(0, 100)}`)
    }

    const text = await res.text()
    console.log(`[genspark-tools] Second Brain response: ${text.length} chars`)

    const lines = text.trim().split('\n')
    let finalResult: any = null
    for (const line of lines) {
      if (!line || !line.startsWith('{')) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed.status || parsed.version === undefined) finalResult = parsed
      } catch {}
    }
    if (!finalResult) throw new Error('No valid result from Genspark Second Brain')
    return finalResult
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') throw new Error('Genspark Second Brain timeout (1 min)')
    throw err
  }
}

// ─── AI Drive ──────────────────────────────────────────
export interface AidriveFile {
  name: string
  path: string
  type: string
  size?: number
  url?: string
  modified_at?: string
}

export async function aidriveAction(
  action: 'list' | 'search' | 'upload' | 'download',
  params: {
    path?: string
    query?: string
    file_url?: string
    file_name?: string
    file_content?: string
    upload_path?: string
    limit?: number
  } = {}
): Promise<any> {
  const apiKey = getGensparkApiKey()
  if (!apiKey) throw new Error('No Genspark API key')

  const args: Record<string, any> = { action, ...params }

  console.log('[genspark-tools] POST aidrive', JSON.stringify(args).slice(0, 300))

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000) // 1 min

  try {
    const res = await fetch(`${GENSPARK_BASE}/api/tool_cli/aidrive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify(args),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Genspark AI Drive error: HTTP ${res.status} ${errText.slice(0, 100)}`)
    }

    const text = await res.text()
    console.log(`[genspark-tools] AI Drive response: ${text.length} chars`)

    const lines = text.trim().split('\n')
    let finalResult: any = null
    for (const line of lines) {
      if (!line || !line.startsWith('{')) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed.status || parsed.version === undefined) finalResult = parsed
      } catch {}
    }
    if (!finalResult) throw new Error('No valid result from Genspark AI Drive')
    return finalResult
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') throw new Error('Genspark AI Drive timeout (1 min)')
    throw err
  }
}

// ─── Analyze Media ─────────────────────────────────────
export interface AnalyzeMediaParams {
  mediaUrls: string[]
  requirements?: string
  analyzeType?: string
  analysisModel?: string
}

export async function analyzeMedia(params: AnalyzeMediaParams): Promise<any> {
  const apiKey = getGensparkApiKey()
  if (!apiKey) throw new Error('No Genspark API key')

  const args: Record<string, any> = { media_urls: params.mediaUrls }
  if (params.requirements) args.requirements = params.requirements
  if (params.analyzeType) args.analyze_type = params.analyzeType
  if (params.analysisModel) args.analysis_model = params.analysisModel

  console.log('[genspark-tools] POST analyze_media', JSON.stringify(args).slice(0, 300))

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120000) // 2 min

  try {
    const res = await fetch(`${GENSPARK_BASE}/api/tool_cli/analyze_media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify(args),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Genspark analyze media error: HTTP ${res.status} ${errText.slice(0, 100)}`)
    }

    const text = await res.text()
    console.log(`[genspark-tools] Analyze media response: ${text.length} chars`)

    const lines = text.trim().split('\n')
    let finalResult: any = null
    for (const line of lines) {
      if (!line || !line.startsWith('{')) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed.status || parsed.version === undefined) finalResult = parsed
      } catch {}
    }
    if (!finalResult) throw new Error('No valid result from Genspark analyze media')
    return finalResult
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') throw new Error('Genspark analyze media timeout (2 min)')
    throw err
  }
}

// ─── Create Task ───────────────────────────────────────
export interface CreateTaskParams {
  taskType: string
  taskName?: string
  query: string
  instructions?: string
  wait?: boolean
}

export async function createTask(params: CreateTaskParams): Promise<any> {
  const apiKey = getGensparkApiKey()
  if (!apiKey) throw new Error('No Genspark API key')

  const args: Record<string, any> = {
    task_type: params.taskType,
    query: params.query,
  }
  if (params.taskName) args.task_name = params.taskName
  if (params.instructions) args.instructions = params.instructions
  if (params.wait !== undefined) args.wait = params.wait

  console.log('[genspark-tools] POST create_task', JSON.stringify(args).slice(0, 300))

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 300000) // 5 min

  try {
    const res = await fetch(`${GENSPARK_BASE}/api/tool_cli/create_task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify(args),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Genspark create task error: HTTP ${res.status} ${errText.slice(0, 100)}`)
    }

    const text = await res.text()
    console.log(`[genspark-tools] Create task response: ${text.length} chars`)

    const lines = text.trim().split('\n')
    let finalResult: any = null
    for (const line of lines) {
      if (!line || !line.startsWith('{')) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed.status || parsed.version === undefined) finalResult = parsed
      } catch {}
    }
    if (!finalResult) throw new Error('No valid result from Genspark create task')
    return finalResult
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') throw new Error('Genspark create task timeout (5 min)')
    throw err
  }
}

// ─── Task Status ───────────────────────────────────────
export async function taskStatus(projectId: string): Promise<any> {
  const apiKey = getGensparkApiKey()
  if (!apiKey) throw new Error('No Genspark API key')

  console.log('[genspark-tools] POST task_status', projectId)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000) // 30 sec

  try {
    const res = await fetch(`${GENSPARK_BASE}/api/tool_cli/task_status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ project_id: projectId }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Genspark task status error: HTTP ${res.status} ${errText.slice(0, 100)}`)
    }

    const text = await res.text()
    const lines = text.trim().split('\n')
    let finalResult: any = null
    for (const line of lines) {
      if (!line || !line.startsWith('{')) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed.status || parsed.version === undefined) finalResult = parsed
      } catch {}
    }
    if (!finalResult) throw new Error('No valid result from Genspark task status')
    return finalResult
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') throw new Error('Genspark task status timeout')
    throw err
  }
}

// ─── Get Model Info ────────────────────────────────────
export async function getModelInfo(modelNames: string[]): Promise<any> {
  const apiKey = getGensparkApiKey()
  if (!apiKey) throw new Error('No Genspark API key')

  console.log('[genspark-tools] POST get_model_info', modelNames)

  const res = await fetch(`${GENSPARK_BASE}/api/tool_cli/get_model_info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({ model_names: modelNames }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Genspark model info error: HTTP ${res.status} ${errText.slice(0, 100)}`)
  }

  const text = await res.text()
  const lines = text.trim().split('\n')
  let finalResult: any = null
  for (const line of lines) {
    if (!line || !line.startsWith('{')) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed.status || parsed.version === undefined) finalResult = parsed
    } catch {}
  }
  return finalResult
}
