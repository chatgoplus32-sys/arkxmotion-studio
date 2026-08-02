const WEAVY_API = 'https://api.weavy.ai/api'
const FIREBASE_KEY = 'AIzaSyC-qLy3TFyXMogJPfMkZJ9H_q46hEu1sxI'
const WEAVY_PROXY = '/api/public/weavy'

async function refreshWeavyAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      signal: AbortSignal.timeout(10000),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok || !data.id_token) return null
    return data.id_token
  } catch { return null }
}

async function getWeavyAccessToken(token: string): Promise<string> {
  const isJwt = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  if (isJwt) return token
  const refreshed = await refreshWeavyAccessToken(token)
  if (refreshed) {
    return refreshed
  }
  throw Error('Token Weavy expired. Silakan update token di Providers.')
}

async function refreshWeavyToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
  try {
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    })
    if (!r.ok) return null
    const data = await r.json()
    if (!data.id_token) return null
    return {
      accessToken: data.id_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: Number(data.expires_in) || 3600,
    }
  } catch {
    return null
  }
}

function extractEmailFromJwt(token: string): string | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1]))
    return payload.email || payload.user_id || null
  } catch {
    return null
  }
}

function isRefreshToken(token: string): boolean {
  return !/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) && token.length > 40
}

export async function fetchWeavyCreditsClient(accessToken: string): Promise<number | null> {
  const timeout = AbortSignal.timeout(10000)

  // Try workspaces first (most reliable endpoint)
  try {
    const r = await fetch(`${WEAVY_API}/v1/workspaces`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: timeout,
    })
    if (r.ok) {
      const data = await r.json().catch(() => null)
      const ws = Array.isArray(data?.workspaces) ? data.workspaces[0] : data
      if (typeof ws?.credits === 'number') return ws.credits
      if (typeof ws?.balance === 'number') return ws.balance
    }
    if (r.status === 401 || r.status === 403) return null
  } catch {}

  // Fallback: try common credit endpoints (stop at first 404 — API doesn't have them)
  const endpoints = [
    `${WEAVY_API}/v1/credits`,
    `${WEAVY_API}/v1/user/credits`,
    `${WEAVY_API}/v1/user/balance`,
  ]
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: timeout,
      })
      if (r.status === 401 || r.status === 403) return null
      if (r.status === 404) break // All similar endpoints will 404 too
      if (!r.ok) continue
      const data = await r.json().catch(() => null)
      const credits = data?.credits ?? data?.balance ?? data?.totalCredits ?? data?.creditsRemaining ?? data?.quota ?? data?.usage?.credits ?? data?.plan?.credits ?? data?.data?.credits ?? data?.user?.credits ?? null
      if (typeof credits === 'number') return credits
    } catch { continue }
  }
  return null
}

async function resolveAndFetchCredits(token: string): Promise<{ ok: boolean; credits: number | null; email?: string }> {
  if (isRefreshToken(token)) {
    const refreshed = await refreshWeavyToken(token)
    if (refreshed?.accessToken) {
      return { ok: true, credits: await fetchWeavyCreditsClient(refreshed.accessToken), email: extractEmailFromJwt(refreshed.accessToken) || undefined }
    }
  }
  return { ok: true, credits: await fetchWeavyCreditsClient(token), email: extractEmailFromJwt(token) || undefined }
}

export interface WeavyGenerateParams {
  token: string
  model: string
  prompt: string
  imageUrl?: string
  aspectRatio?: string
  duration?: number
  negativePrompt?: string
  quality?: string
}

export interface WeavyGenerateResult {
  ok: boolean
  taskId?: string
  error?: string
  raw?: any
}

export interface WeavyStatusResult {
  ok: boolean
  status?: string
  videoUrl?: string
  progress?: number
  error?: string
  raw?: any
}

export async function checkWeavyBalance(token: string): Promise<{ ok: boolean; balance?: number | null; email?: string; error?: string }> {
  try {
    const result = await resolveAndFetchCredits(token)
    return { ok: result.ok, balance: result.credits, email: result.email }
  } catch (err: any) {
    return { ok: false, balance: null, error: err.message }
  }
}

export async function checkWeavyBalanceDirect(token: string): Promise<{ ok: boolean; balance?: number | null; email?: string; error?: string }> {
  try {
    const result = await resolveAndFetchCredits(token)
    return { ok: result.ok, balance: result.credits, email: result.email }
  } catch (err: any) {
    return { ok: false, balance: null, error: err.message }
  }
}

function resolveAspectRatio(ratio: string): string {
  const map: Record<string, string> = { '9:16': '9:16', '16:9': '16:9', '1:1': '1:1', '4:3': '4:3', '3:4': '3:4' }
  return map[ratio] || '9:16'
}

function resolveModel(modelKey: string): string {
  const map: Record<string, string> = {
    'kling-2.1': 'kling-2.1', 'kling-1.6-standard': 'kling-1.6-standard', 'kling-1.6-pro': 'kling-1.6-pro',
    'kling-3-pro': 'kling-3-pro', 'sora-2': 'sora-2', 'veo-3': 'veo-3', 'veo-3.1': 'veo-3.1',
    'seedance': 'seedance', 'seedance-2': 'seedance-2', 'wan-i2v': 'wan-i2v', 'wan-t2v': 'wan-t2v',
    'hailuo-02-pro': 'hailuo-02-pro',
  }
  return map[modelKey] || modelKey
}

function resolveImageModel(modelKey: string): { model: string; service: string } {
  const map: Record<string, { model: string; service: string }> = {
    'nanobanana2': { model: 'fal-ai/nano-banana-2/edit', service: 'fal_imported' },
    'gptimage2': { model: 'openai/gpt-image-2', service: 'fal_imported' },
    'seedream-v50-pro': { model: 'seedream-v50-pro', service: 'fal_imported' },
    'seedream-5.0-pro': { model: 'seedream-v50-pro', service: 'fal_imported' },
    'seedream5': { model: 'seedream-v50-pro', service: 'fal_imported' },
    'gpt-image-2': { model: 'openai/gpt-image-2', service: 'fal_imported' },
    'gemini-nano-banana-2': { model: 'fal-ai/nano-banana-2/edit', service: 'fal_imported' },
  }
  return map[modelKey] || { model: modelKey, service: 'fal_imported' }
}

function buildImageNode(modelKey: string, prompt: string, quality: string, ratio: string, imageUrl?: string, maskUrl?: string): any {
  const { model: modelName, service } = resolveImageModel(modelKey)
  const nodeId = 'n_' + Date.now() + '_model'
  const now = Date.now()

  if (modelKey === 'gptimage2' || modelKey === 'gpt-image-2') {
    const sizeMap: Record<string, { width: number; height: number }> = {
      'low@1024x1024': { width: 1024, height: 1024 }, 'medium@1024x1024': { width: 1024, height: 1024 },
      'high@1024x1024': { width: 1024, height: 1024 }, 'medium@1536x1024': { width: 1536, height: 1024 },
      'high@1536x1024': { width: 1536, height: 1024 }, 'medium@1024x1536': { width: 1024, height: 1536 },
      'high@1024x1536': { width: 1024, height: 1536 }, 'medium@2048x2048': { width: 2048, height: 2048 },
      'high@2048x2048': { width: 2048, height: 2048 }, 'high@2048x1152': { width: 2048, height: 1152 },
      'high@3840x2160': { width: 3840, height: 2160 }, 'high@2160x3840': { width: 2160, height: 3840 },
      'high@auto': { width: 1024, height: 1024 },
    }
    const parsed = quality.includes('@') ? quality : 'high@1024x1024'
    const size = sizeMap[parsed] || { width: 1024, height: 1024 }
    const q = parsed.split('@')[0] || 'high'

    const params: any = { prompt, image_size: size, quality: q, num_images: 1, output_format: 'png' }
    const handles: any = { input: { prompt: { id: 'input-prompt', type: 'text', label: 'prompt', format: 'text', required: true } }, output: { result: { id: 'output-result', type: 'image', label: 'result', order: 0, format: 'uri' } } }
    let extraNodes: any[] = []
    let extraEdges: any[] = []

    if (imageUrl) {
      const imgNodeId = 'n_' + now + '_img'
      params.image_urls = [imageUrl]
      handles.input.image = { id: 'input-image', type: 'image', label: 'image', format: 'text', required: false }

      const imgNode = {
        id: imgNodeId, type: 'import', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
        data: {
          handles: { output: { file: { type: 'any', label: 'File', order: 0, format: 'uri' } } },
          name: 'File', color: 'Yambo_Blue',
          files: [{ type: 'image', url: imageUrl, publicId: 'uploads/' + randId(), id: imgNodeId + '_file', name: 'input.jpg', insertionOrder: 0 }],
          result: { type: 'image', url: imageUrl, publicId: 'uploads/' + randId(), id: imgNodeId + '_result', name: 'input.jpg', insertionOrder: 0 },
          output: { file: { type: 'image', url: imageUrl, publicId: 'uploads/' + randId(), id: imgNodeId + '_output', name: 'input.jpg', insertionOrder: 0 } },
          version: 3,
        },
        position: { x: 80, y: 200 }, width: 460, height: 400,
      }
      extraNodes.push(imgNode)
      extraEdges.push({
        id: 'e-' + randId(), source: imgNodeId, target: nodeId,
        sourceHandle: `${imgNodeId}-output-file`, targetHandle: `${nodeId}-input-image`,
        type: 'custom', data: { sourceColor: 'Yambo_Blue', targetColor: 'Red', sourceHandleType: 'any', targetHandleType: 'image' },
      })

      if (maskUrl) {
        const maskNodeId = 'n_' + now + '_mask'
        params.mask_url = maskUrl
        handles.input.mask = { id: 'input-mask', type: 'image', label: 'mask', format: 'text', required: false }
        const maskNode = {
          id: maskNodeId, type: 'import', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
          data: {
            handles: { output: { file: { type: 'any', label: 'File', order: 0, format: 'uri' } } },
            name: 'File', color: 'Yambo_Blue',
            files: [{ type: 'image', url: maskUrl, publicId: 'uploads/' + randId(), id: maskNodeId + '_file', name: 'mask.png', insertionOrder: 0 }],
            result: { type: 'image', url: maskUrl, publicId: 'uploads/' + randId(), id: maskNodeId + '_result', name: 'mask.png', insertionOrder: 0 },
            output: { file: { type: 'image', url: maskUrl, publicId: 'uploads/' + randId(), id: maskNodeId + '_output', name: 'mask.png', insertionOrder: 0 } },
            version: 3,
          },
          position: { x: 80, y: 350 }, width: 460, height: 400,
        }
        extraNodes.push(maskNode)
        extraEdges.push({
          id: 'e-' + randId(), source: maskNodeId, target: nodeId,
          sourceHandle: `${maskNodeId}-output-file`, targetHandle: `${nodeId}-input-mask`,
          type: 'custom', data: { sourceColor: 'Yambo_Blue', targetColor: 'Red', sourceHandleType: 'any', targetHandleType: 'image' },
        })
      }
    }

    const mainNode = {
      id: nodeId, type: 'custommodelV2', dragHandle: '.node-header', owner: null, visibility: 'private', isModel: true,
      data: {
        handles, name: 'ChatGPT Images 2.0', color: 'Red',
        model: { name: modelName, service }, params,
        version: 3, kind: { type: 'wildcard', model: { type: 'predefined', name: modelName, version: modelName, service }, inputs: handles.input ? Object.values(handles.input).map((h: any) => h.id) : [], parameters: [], outputs: handles.output ? Object.values(handles.output).map((h: any) => h.id) : [] },
        outputs: [{ id: 'result', title: 'result', dataType: 'image' }],
        generations: [], selectedIndex: 0, cameraLocked: false, result: [], output: {}, selectedOutput: 0,
      },
      position: { x: 600, y: 300 }, width: 460, height: 500,
    }

    if (extraNodes.length > 0) {
      return { id: nodeId, type: 'custommodelV2', data: mainNode.data, _dummyNode: extraNodes[0], _extraNodes: extraNodes, _edge: extraEdges[0], _extraEdges: extraEdges }
    }
    return mainNode
  }

  if (modelKey === 'nanobanana2' || modelKey === 'gemini-nano-banana-2') {
    const resolutionMap: Record<string, string> = { '0.5K': '512', '1K': '1024', '2K': '2048', '4K': '4096' }
    const resolution = resolutionMap[quality] || '1024'
    const aspectRatio = ratio || '1:1'
    const dummyNode = {
      id: 'n_' + now + '_img', type: 'import', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
      data: {
        handles: { output: { file: { type: 'any', label: 'File', order: 0, format: 'uri' } } },
        name: 'File', color: 'Yambo_Blue',
        files: [{ type: 'image', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', publicId: 'uploads/' + Math.random().toString(36).substring(2, 8), id: 'n_' + now + '_file', name: 'dummy.png', insertionOrder: 0 }],
        result: { type: 'image', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', publicId: 'uploads/' + Math.random().toString(36).substring(2, 8), id: 'n_' + now + '_result', name: 'dummy.png', insertionOrder: 0 },
        output: { file: { type: 'image', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', publicId: 'uploads/' + Math.random().toString(36).substring(2, 8), id: 'n_' + now + '_output', name: 'dummy.png', insertionOrder: 0 } },
        version: 3,
      },
      position: { x: 80, y: 200 }, width: 460, height: 400,
    }
    const mainNode = {
      id: nodeId, type: 'custommodelV2', dragHandle: '.node-header', owner: null, visibility: 'private', isModel: true,
      data: {
        handles: { input: { prompt: { id: 'input-prompt', type: 'text', label: 'prompt', format: 'text', required: true }, image: { id: 'input-image', type: 'image', label: 'image', format: 'text', required: true } }, output: { result: { id: 'output-result', type: 'image', label: 'result', order: 0, format: 'uri' } } },
        name: 'Gemini 3.1 Flash (Nano Banana 2)', color: 'Yellow',
        model: { name: modelName, service },
        params: { image_urls: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='], prompt, aspect_ratio: aspectRatio, resolution, num_images: 1, output_format: 'png', safety_tolerance: '4', limit_generations: false, enable_web_search: false },
        version: 3, kind: { type: 'wildcard', model: { type: 'predefined', name: modelName, version: modelName, service } },
        outputs: [{ id: 'result', title: 'result', dataType: 'image' }],
        generations: [], selectedIndex: 0, cameraLocked: false, result: [], output: {}, selectedOutput: 0,
      },
      position: { x: 600, y: 300 }, width: 460, height: 500,
    }
    const edgeId = 'e-' + Math.random().toString(36).substring(2, 8)
    const edge = { id: edgeId, source: dummyNode.id, target: nodeId, sourceHandle: `${dummyNode.id}-output-file`, targetHandle: `${nodeId}-input-image`, type: 'custom', data: { sourceColor: 'Yambo_Blue', targetColor: 'Yellow', sourceHandleType: 'any', targetHandleType: 'image' } }
    return { id: nodeId, type: 'custommodelV2', data: mainNode.data, _dummyNode: dummyNode, _edge: edge }
  }

  return {
    id: nodeId, type: 'custommodelV2',
    data: {
      handles: { input: { prompt: { id: 'input-prompt', type: 'text', label: 'prompt', format: 'text', required: true } }, output: { result: { id: 'output-result', type: 'image', label: 'result', order: 0, format: 'uri' } } },
      name: modelName, color: 'Red', model: { name: modelName, service },
      params: { prompt, num_images: 1, output_format: 'png' },
      version: 3, kind: { type: 'wildcard', model: { type: 'predefined', name: modelName, version: modelName, service } },
      outputs: [{ id: 'result', title: 'result', dataType: 'image' }],
      generations: [], selectedIndex: 0, cameraLocked: false, result: [], output: {}, selectedOutput: 0,
    },
    position: { x: 600, y: 300 }, width: 460, height: 500,
  }
}

export async function submitWeavyVideo(params: WeavyGenerateParams): Promise<WeavyGenerateResult> {
  const { token, model, prompt, imageUrl, aspectRatio = '9:16', duration = 5, negativePrompt, quality } = params
  const payload = { model: resolveModel(model), prompt: prompt.trim(), imageUrl: imageUrl || null, aspectRatio: resolveAspectRatio(aspectRatio), duration, negativePrompt: negativePrompt?.trim() || null, quality: quality || null }
  try {
    const res = await fetch(WEAVY_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Weavy-Token': token }, body: JSON.stringify({ action: 'generate', payload }) })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.ok) { const errMsg = data?.data?.message || data?.data?.error || data?.error || `HTTP ${res.status}`; return { ok: false, error: errMsg, raw: data } }
    const batchId = data?.data?.batchId || data?.data?.id
    if (!batchId) return { ok: false, error: 'No batchId in response', raw: data }
    return { ok: true, taskId: batchId, raw: data }
  } catch (err: any) { return { ok: false, error: err.message } }
}

export async function pollWeavyStatus(token: string, batchId: string, onProgress?: (status: string, pct: number) => void, timeoutMs = 3600000): Promise<string> {
  const startTime = Date.now(); let lastLog = ''
  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5000))
    try {
      const res = await fetch(WEAVY_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Weavy-Token': token }, body: JSON.stringify({ action: 'status', batchId }) })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) { console.log(`[weavy] poll error:`, data?.error || `HTTP ${res.status}`); continue }
      const result = data?.data; const status = (result?.status || result?.state || '').toLowerCase()
      const elapsedMin = (Date.now() - startTime) / (8 * 60000); const fallbackPct = Math.min(0.94, 1 - 1 / (1 + elapsedMin * 1.6)); const pct = Math.round(5 + fallbackPct * 89)
      onProgress?.(status || 'processing', pct)
      const logEntry = `poll #${Math.round((Date.now() - startTime) / 1000)}s status=${status} pct=${pct}`
      if (logEntry !== lastLog) { lastLog = logEntry; console.log(`[weavy] ${logEntry}`) }
      if (['completed', 'success', 'done', 'finished'].includes(status)) {
        const videoUrl = result?.output?.video_url || result?.output?.url || result?.video_url || result?.url || result?.recipeRuns?.[0]?.nodeRuns?.[0]?.result?.[0]?.url || result?.recipeRuns?.[0]?.nodeRuns?.[0]?.result?.[0]?.video_url
        if (videoUrl) return videoUrl
        console.log(`[weavy] task done but no url:`, JSON.stringify(result, null, 2).slice(0, 2000))
        throw new Error('Weavy: task completed but no video URL found')
      }
      if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) { const errMsg = result?.error || result?.message || result?.recipeRuns?.[0]?.nodeRuns?.[0]?.error || 'Generation failed'; throw new Error(`Weavy failed: ${errMsg}`) }
    } catch (err: any) { if (/timeout|fetch|network/i.test(err.message)) { console.log(`[weavy] network error, retrying:`, err.message); continue }; throw err }
  }
  throw new Error('Weavy timeout')
}

export function isWeavyTokenError(msg: string): boolean {
  return /token|auth|log\s*in|login|expired|unauth|401|403|invalid.*token|token.*invalid|insufficient|balance|credit|quota|no output URL|output tidak ditemukan/i.test(msg)
}

export interface WeavyImageGenerateParams { token: string; model: string; prompt: string; aspectRatio?: string; negativePrompt?: string; quality?: string; imageUrl?: string; maskUrl?: string }
export interface WeavyImageGenerateResult { ok: boolean; taskId?: string; error?: string; raw?: any }

export async function submitWeavyImage(params: WeavyImageGenerateParams): Promise<WeavyImageGenerateResult> {
  const { token, model, prompt, aspectRatio = '1:1', quality, imageUrl, maskUrl } = params
  try {
    // Step 1: Create recipe via proxy
    const createRes = await fetch(WEAVY_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Weavy-Token': token }, body: JSON.stringify({ action: 'image-create-recipe' }) })
    const createData = await createRes.json().catch(() => null)
    if (!createRes.ok || !createData?.ok) return { ok: false, error: createData?.error || `Create recipe failed (${createRes.status})`, raw: createData }
    const recipeId = createData?.data?.recipeId
    const v3 = createData?.data?.v3
    if (!recipeId) return { ok: false, error: 'No recipeId returned', raw: createData }

    // Step 2: Build nodes + edges
    const nodes = buildImageNode(model, prompt.trim(), quality || 'high', aspectRatio || '1:1', imageUrl, maskUrl)
    const extraNodes = nodes._extraNodes || []
    const extraEdges = nodes._extraEdges || []
    const edges = nodes._edge ? [nodes._edge, ...extraEdges] : extraEdges
    const modelNode = { id: nodes.id, type: nodes.type, data: nodes.data, position: { x: 600, y: 300 }, width: 460, height: 500 }
    const allNodes = nodes._dummyNode
      ? [nodes._dummyNode, ...extraNodes, modelNode]
      : [nodes]

    // Step 3: Save recipe via proxy
    const saveRes = await fetch(WEAVY_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Weavy-Token': token }, body: JSON.stringify({ action: 'image-save-recipe', recipeId, nodes: allNodes, edges, v3 }) })
    const saveData = await saveRes.json().catch(() => null)
    if (!saveRes.ok || !saveData?.ok) return { ok: false, error: saveData?.error || `Save recipe failed (${saveRes.status})`, raw: saveData }

    // Step 4: Approve model via proxy
    const modelName = nodes.data?.model?.name || model
    await fetch(WEAVY_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Weavy-Token': token }, body: JSON.stringify({ action: 'image-approve-model', modelId: modelName }) })

    // Step 5: Execute via proxy
    const execRes = await fetch(WEAVY_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Weavy-Token': token }, body: JSON.stringify({ action: 'image-execute', recipeId, nodes: allNodes, edges, numberOfRuns: 1 }) })
    const execData = await execRes.json().catch(() => null)
    if (!execRes.ok || !execData?.ok) return { ok: false, error: execData?.error || `Execute failed (${execRes.status})`, raw: execData }
    const batchId = execData?.data?.batchId || execData?.data?.id
    if (!batchId) return { ok: false, error: 'No batchId in response', raw: execData }
    return { ok: true, taskId: `${recipeId}:${batchId}`, raw: execData }
  } catch (err: any) { return { ok: false, error: err.message } }
}

export async function pollWeavyImageStatus(token: string, taskId: string, onProgress?: (status: string, pct: number) => void, timeoutMs = 600000): Promise<string> {
  const startTime = Date.now(); let lastLog = ''
  const batchId = taskId.includes(':') ? taskId.split(':')[1] : taskId
  let attempt = 0
  const maxAttempts = Math.ceil(timeoutMs / 5000)

  while (Date.now() - startTime < timeoutMs && attempt < maxAttempts) {
    attempt++
    const pollInterval = attempt < 30 ? 8000 : attempt < 60 ? 10000 : 15000
    await new Promise((r) => setTimeout(r, pollInterval))
    try {
      const res = await fetch(WEAVY_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Weavy-Token': token }, body: JSON.stringify({ action: 'status', batchId }) })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) { console.log(`[weavy-image] poll error:`, data?.error || `HTTP ${res.status}`); continue }
      const result = data?.data
      const status = (result?.status || result?.state || '').toLowerCase()
      const elapsedMin = (Date.now() - startTime) / (6 * 60000); const fallbackPct = Math.min(0.94, 1 - 1 / (1 + elapsedMin * 1.6)); const pct = Math.round(5 + fallbackPct * 89)
      onProgress?.(status || 'processing', pct)
      const logEntry = `poll #${Math.round((Date.now() - startTime) / 1000)}s status=${status} pct=${pct}`
      if (logEntry !== lastLog) { lastLog = logEntry; console.log(`[weavy-image] ${logEntry}`) }
      if (['completed', 'success', 'done', 'finished'].includes(status)) {
        const imageUrl = result?.output?.image_url || result?.output?.url || result?.image_url || result?.url || result?.recipeRuns?.[0]?.nodeRuns?.[0]?.result?.[0]?.url || result?.recipeRuns?.[0]?.nodeRuns?.[0]?.result?.[0]?.image_url
        if (imageUrl) return imageUrl
        console.log(`[weavy-image] task done but no url:`, JSON.stringify(result, null, 2).slice(0, 2000))
        throw new Error('Weavy: task completed but no image URL found')
      }
      if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) { const errMsg = result?.error || result?.message || result?.recipeRuns?.[0]?.nodeRuns?.[0]?.error || 'Generation failed'; throw new Error(`Weavy failed: ${errMsg}`) }
    } catch (err: any) { if (/timeout|fetch|network/i.test(err.message)) { console.log(`[weavy-image] network error, retrying:`, err.message); continue }; throw err }
  }
  throw new Error('Weavy image: timeout')
}

export async function runWeavyImage(opts: { model: string; prompt: string; aspectRatio?: string; quality?: string; negativePrompt?: string; imageUrl?: string; maskUrl?: string; onProgress?: (text: string, pct?: number) => void; onRotate?: (index: number, total: number, reason: string) => void }): Promise<string> {
  const modelKey = opts.model
  const quality = opts.quality || 'high@1024x1024'

  function getRequiredCredits(modelKey: string, quality: string): number {
    if (modelKey.startsWith('seedream-') || modelKey === 'seedream-v50-pro') return 12
    if (modelKey === 'nanobanana2' || modelKey === 'gemini-nano-banana-2') {
      const map: Record<string, number> = { '0.5K': 4.5, '1K': 6, '2K': 9, '4K': 12 }
      return map[quality] ?? 12
    }
    const gptPrice: Record<string, number> = {
      'low@1024x1024': 5, 'medium@1024x1024': 11, 'high@1024x1024': 20,
      'medium@1536x1024': 13, 'high@1536x1024': 24,
      'medium@1024x1536': 13, 'high@1024x1536': 24,
      'medium@2048x2048': 17, 'high@2048x2048': 30,
      'high@2048x1152': 24, 'high@3840x2160': 37, 'high@2160x3840': 37,
      'high@auto': 20,
    }
    return gptPrice[quality] ?? 20
  }

  const requiredCredits = getRequiredCredits(modelKey, quality)

  const { withTokenRotation } = await import('@/lib/tokenRotation')
  const rotation = await withTokenRotation<string>('weavy', async (apiKey) => {
    opts.onProgress?.(`Weavy: submit ${modelKey}… (butuh ${requiredCredits} cr)`, 10)
    const submitResult = await submitWeavyImage({ token: apiKey, model: modelKey, prompt: opts.prompt, aspectRatio: opts.aspectRatio, negativePrompt: opts.negativePrompt, quality: opts.quality, imageUrl: opts.imageUrl, maskUrl: opts.maskUrl })
    if (!submitResult.ok || !submitResult.taskId) throw Error(submitResult.error || 'Submit failed')
    opts.onProgress?.(`Weavy: batch ${submitResult.taskId.slice(0, 8)}… polling`, 20)
    const imageUrl = await pollWeavyImageStatus(apiKey, submitResult.taskId, opts.onProgress)
    opts.onProgress?.(`Weavy: selesai`, 100)
    return imageUrl
  }, {
    requiredCredits,
    onKeySwitch: (from, to, attempt) => { opts.onRotate?.(attempt, 0, `Switching key: ${from.name} → ${to.name} (butuh ${requiredCredits} cr)`) }
  })
  if (rotation.ok && rotation.result) return rotation.result
  throw Error(rotation.error || 'Weavy: semua token gagal')
}

export interface WeavyBulkOneParams {
  modelKey: string
  prompt: string
  quality: string
  ratio: string
  charFile: File
  outfitFile: File
}

function buildBulkFashionNodes(modelKey: string, prompt: string, quality: string, ratio: string, charUrl: string, outfitUrl: string): any {
  const { model: modelName, service } = resolveImageModel(modelKey)
  const nodeId = 'n_' + Date.now() + '_model'
  const now = Date.now()

  if (modelKey === 'gptimage2' || modelKey === 'gpt-image-2') {
    const sizeMap: Record<string, { width: number; height: number }> = {
      'low@1K': { width: 1024, height: 1024 }, 'medium@1K': { width: 1024, height: 1024 },
      'high@1K': { width: 1024, height: 1024 }, 'low@2K': { width: 2048, height: 2048 },
      'medium@2K': { width: 2048, height: 2048 }, 'high@2K': { width: 2048, height: 2048 },
      'low@4K': { width: 4096, height: 4096 }, 'medium@4K': { width: 4096, height: 4096 },
      'high@4K': { width: 4096, height: 4096 },
    }
    const parsed = quality.includes('@') ? quality : 'medium@1K'
    const size = sizeMap[parsed] || { width: 1024, height: 1024 }
    const q = parsed.split('@')[0] || 'medium'

    const charNodeId = 'n_' + now + '_char'
    const outfitNodeId = 'n_' + now + '_outfit'

    const params: any = { prompt, image_urls: [charUrl, outfitUrl], image_size: size, quality: q, num_images: 1, output_format: 'png' }
    const handles: any = {
      input: {
        prompt: { id: 'input-prompt', type: 'text', label: 'prompt', format: 'text', required: true },
        image: { id: 'input-image', type: 'image', label: 'image', format: 'text', required: false },
        image2: { id: 'input-image2', type: 'image', label: 'image2', format: 'text', required: false },
      },
      output: { result: { id: 'output-result', type: 'image', label: 'result', order: 0, format: 'uri' } },
    }

    const charNode = {
      id: charNodeId, type: 'import', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
      data: {
        handles: { output: { file: { type: 'any', label: 'File', order: 0, format: 'uri' } } },
        name: 'File', color: 'Yambo_Blue',
        files: [{ type: 'image', url: charUrl, publicId: 'uploads/' + randId(), id: charNodeId + '_file', name: 'char.jpg', insertionOrder: 0 }],
        result: { type: 'image', url: charUrl, publicId: 'uploads/' + randId(), id: charNodeId + '_result', name: 'char.jpg', insertionOrder: 0 },
        output: { file: { type: 'image', url: charUrl, publicId: 'uploads/' + randId(), id: charNodeId + '_output', name: 'char.jpg', insertionOrder: 0 } },
        version: 3,
      },
      position: { x: 80, y: 200 }, width: 460, height: 400,
    }
    const outfitNode = {
      id: outfitNodeId, type: 'import', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
      data: {
        handles: { output: { file: { type: 'any', label: 'File', order: 0, format: 'uri' } } },
        name: 'File', color: 'Yambo_Blue',
        files: [{ type: 'image', url: outfitUrl, publicId: 'uploads/' + randId(), id: outfitNodeId + '_file', name: 'outfit.jpg', insertionOrder: 0 }],
        result: { type: 'image', url: outfitUrl, publicId: 'uploads/' + randId(), id: outfitNodeId + '_result', name: 'outfit.jpg', insertionOrder: 0 },
        output: { file: { type: 'image', url: outfitUrl, publicId: 'uploads/' + randId(), id: outfitNodeId + '_output', name: 'outfit.jpg', insertionOrder: 0 } },
        version: 3,
      },
      position: { x: 80, y: 400 }, width: 460, height: 400,
    }

    const charEdge = {
      id: 'e-' + randId(), source: charNodeId, target: nodeId,
      sourceHandle: `${charNodeId}-output-file`, targetHandle: `${nodeId}-input-image`,
      type: 'custom', data: { sourceColor: 'Yambo_Blue', targetColor: 'Red', sourceHandleType: 'any', targetHandleType: 'image' },
    }
    const outfitEdge = {
      id: 'e-' + randId(), source: outfitNodeId, target: nodeId,
      sourceHandle: `${outfitNodeId}-output-file`, targetHandle: `${nodeId}-input-image2`,
      type: 'custom', data: { sourceColor: 'Yambo_Blue', targetColor: 'Red', sourceHandleType: 'any', targetHandleType: 'image' },
    }

    const mainNode = {
      id: nodeId, type: 'custommodelV2', dragHandle: '.node-header', owner: null, visibility: 'private', isModel: true,
      data: {
        handles, name: 'ChatGPT Images 2.0', color: 'Red',
        model: { name: modelName, service }, params,
        version: 3, kind: { type: 'wildcard', model: { type: 'predefined', name: modelName, version: modelName, service }, inputs: handles.input ? Object.values(handles.input).map((h: any) => h.id) : [], parameters: [], outputs: handles.output ? Object.values(handles.output).map((h: any) => h.id) : [] },
        outputs: [{ id: 'result', title: 'result', dataType: 'image' }],
        generations: [], selectedIndex: 0, cameraLocked: false, result: [], output: {}, selectedOutput: 0,
      },
      position: { x: 600, y: 300 }, width: 460, height: 500,
    }

    return { id: nodeId, type: 'custommodelV2', data: mainNode.data, _extraNodes: [charNode, outfitNode], _extraEdges: [charEdge, outfitEdge] }
  }

  // nanobanana2 / seedream / default — 2 image inputs
  const resolutionMap: Record<string, string> = { '0.5K': '512', '1K': '1024', '2K': '2048', '4K': '4096' }
  const resolution = resolutionMap[quality] || '1024'
  const aspectRatio = ratio || '9:16'

  const charNodeId = 'n_' + now + '_char'
  const outfitNodeId = 'n_' + now + '_outfit'

  const charNode = {
    id: charNodeId, type: 'import', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
    data: {
      handles: { output: { file: { type: 'any', label: 'File', order: 0, format: 'uri' } } },
      name: 'File', color: 'Yambo_Blue',
      files: [{ type: 'image', url: charUrl, publicId: 'uploads/' + randId(), id: charNodeId + '_file', name: 'char.jpg', insertionOrder: 0 }],
      result: { type: 'image', url: charUrl, publicId: 'uploads/' + randId(), id: charNodeId + '_result', name: 'char.jpg', insertionOrder: 0 },
      output: { file: { type: 'image', url: charUrl, publicId: 'uploads/' + randId(), id: charNodeId + '_output', name: 'char.jpg', insertionOrder: 0 } },
      version: 3,
    },
    position: { x: 80, y: 200 }, width: 460, height: 400,
  }
  const outfitNode = {
    id: outfitNodeId, type: 'import', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
    data: {
      handles: { output: { file: { type: 'any', label: 'File', order: 0, format: 'uri' } } },
      name: 'File', color: 'Yambo_Blue',
      files: [{ type: 'image', url: outfitUrl, publicId: 'uploads/' + randId(), id: outfitNodeId + '_file', name: 'outfit.jpg', insertionOrder: 0 }],
      result: { type: 'image', url: outfitUrl, publicId: 'uploads/' + randId(), id: outfitNodeId + '_result', name: 'outfit.jpg', insertionOrder: 0 },
      output: { file: { type: 'image', url: outfitUrl, publicId: 'uploads/' + randId(), id: outfitNodeId + '_output', name: 'outfit.jpg', insertionOrder: 0 } },
      version: 3,
    },
    position: { x: 80, y: 400 }, width: 460, height: 400,
  }

  const mainNode = {
    id: nodeId, type: 'custommodelV2', dragHandle: '.node-header', owner: null, visibility: 'private', isModel: true,
    data: {
      handles: {
        input: {
          prompt: { id: 'input-prompt', type: 'text', label: 'prompt', format: 'text', required: true },
          image: { id: 'input-image', type: 'image', label: 'image', format: 'text', required: true },
          image2: { id: 'input-image2', type: 'image', label: 'image2', format: 'text', required: true },
        },
        output: { result: { id: 'output-result', type: 'image', label: 'result', order: 0, format: 'uri' } },
      },
      name: 'Gemini 3.1 Flash (Nano Banana 2)', color: 'Yellow',
      model: { name: modelName, service },
      params: { image_urls: [charUrl, outfitUrl], prompt, aspect_ratio: aspectRatio, resolution, num_images: 1, output_format: 'png', safety_tolerance: '4', limit_generations: false, enable_web_search: false },
      version: 3, kind: { type: 'wildcard', model: { type: 'predefined', name: modelName, version: modelName, service } },
      outputs: [{ id: 'result', title: 'result', dataType: 'image' }],
      generations: [], selectedIndex: 0, cameraLocked: false, result: [], output: {}, selectedOutput: 0,
    },
    position: { x: 600, y: 300 }, width: 460, height: 500,
  }

  const charEdge = {
    id: 'e-' + randId(), source: charNodeId, target: nodeId,
    sourceHandle: `${charNodeId}-output-file`, targetHandle: `${nodeId}-input-image`,
    type: 'custom', data: { sourceColor: 'Yambo_Blue', targetColor: 'Yellow', sourceHandleType: 'any', targetHandleType: 'image' },
  }
  const outfitEdge = {
    id: 'e-' + randId(), source: outfitNodeId, target: nodeId,
    sourceHandle: `${outfitNodeId}-output-file`, targetHandle: `${nodeId}-input-image2`,
    type: 'custom', data: { sourceColor: 'Yambo_Blue', targetColor: 'Yellow', sourceHandleType: 'any', targetHandleType: 'image' },
  }

  return { id: nodeId, type: 'custommodelV2', data: mainNode.data, _extraNodes: [charNode, outfitNode], _extraEdges: [charEdge, outfitEdge] }
}

async function submitWeavyBulkOne(token: string, params: WeavyBulkOneParams): Promise<WeavyImageGenerateResult> {
  try {
    // Step 0: Get valid access token (refresh if needed) — client-side
    const accessToken = await getWeavyAccessToken(token)

    // Step 1: Upload character image to Weavy directly
    const charFormData = new FormData()
    charFormData.append('file', params.charFile, `char_${Date.now()}.jpg`)
    const charUploadRes = await fetch(`${WEAVY_API}/v1/assets/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: charFormData,
      signal: AbortSignal.timeout(30000),
    })
    if (!charUploadRes.ok) {
      const errText = await charUploadRes.text().catch(() => '')
      throw Error(`Upload char failed (${charUploadRes.status}): ${errText.slice(0, 200)}`)
    }
    const charAsset = await charUploadRes.json()
    const charUrl = charAsset?.url || charAsset?.download || `https://media.weavy.ai/image/upload/uploads/${charAsset?.publicId || charAsset?.id}.jpg`

    // Step 2: Upload outfit image to Weavy directly
    const outfitFormData = new FormData()
    outfitFormData.append('file', params.outfitFile, `outfit_${Date.now()}.jpg`)
    const outfitUploadRes = await fetch(`${WEAVY_API}/v1/assets/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: outfitFormData,
      signal: AbortSignal.timeout(30000),
    })
    if (!outfitUploadRes.ok) {
      const errText = await outfitUploadRes.text().catch(() => '')
      throw Error(`Upload outfit failed (${outfitUploadRes.status}): ${errText.slice(0, 200)}`)
    }
    const outfitAsset = await outfitUploadRes.json()
    const outfitUrl = outfitAsset?.url || outfitAsset?.download || `https://media.weavy.ai/image/upload/uploads/${outfitAsset?.publicId || outfitAsset?.id}.jpg`

    // Step 3: Build node graph
    const nodes = buildBulkFashionNodes(params.modelKey, params.prompt, params.quality, params.ratio, charUrl, outfitUrl)
    const extraNodes = nodes._extraNodes || []
    const extraEdges = nodes._extraEdges || []
    const edges = [...extraEdges]
    const modelNode = { id: nodes.id, type: nodes.type, data: nodes.data, position: { x: 600, y: 300 }, width: 460, height: 500 }
    const allNodes = [...extraNodes, modelNode]

    // Step 4: Create recipe
    const createRes = await fetch(`${WEAVY_API}/v1/recipes/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ scope: 'PERSONAL' }),
      signal: AbortSignal.timeout(15000),
    })
    if (!createRes.ok) {
      const errText = await createRes.text().catch(() => '')
      throw Error(`Create recipe failed (${createRes.status}): ${errText.slice(0, 200)}`)
    }
    const createData = await createRes.json()
    const recipeId = createData?.id || createData?.recipeId
    const v3 = createData?.v3
    if (!recipeId) throw Error('No recipeId returned')

    // Step 5: Save recipe
    const saveRes = await fetch(`${WEAVY_API}/v1/recipes/${recipeId}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ nodes: allNodes, edges, v3: v3 || '', lastUpdatedAt: new Date().toISOString() }),
      signal: AbortSignal.timeout(15000),
    })
    if (!saveRes.ok) {
      const errText = await saveRes.text().catch(() => '')
      throw Error(`Save recipe failed (${saveRes.status}): ${errText.slice(0, 200)}`)
    }
    // Step 6: Approve model
    const modelName = nodes.data?.model?.name || params.modelKey
    try {
      await fetch(`${WEAVY_API}/v1/workspaces/models/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ modelIds: [modelName] }),
        signal: AbortSignal.timeout(10000),
      })
    } catch {}
    // Step 7: Execute batch
    const execRes = await fetch(`${WEAVY_API}/v1/batches/recipes/${recipeId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ nodes: allNodes, edges, numberOfRuns: 1 }),
      signal: AbortSignal.timeout(30000),
    })
    const execText = await execRes.text()
    let execData: any; try { execData = JSON.parse(execText) } catch { execData = null }
    if (!execRes.ok || !execData) throw Error(execData?.error || `Execute failed (${execRes.status}): ${execText.slice(0, 200)}`)
    const batchId = execData?.batchId || execData?.id
    if (!batchId) throw Error('No batchId returned')

    return { ok: true, taskId: `${recipeId}:${batchId}`, raw: execData, charUrl, outfitUrl }
  } catch (err: any) { return { ok: false, error: err.message } }
}

export async function generateWeavyBulkOne(params: WeavyBulkOneParams): Promise<string> {
  const { withTokenRotation } = await import('@/lib/tokenRotation')
  const rotation = await withTokenRotation<string>('weavy', async (apiKey) => {
    // Get access token (refresh if needed)
    const accessToken = await getWeavyAccessToken(apiKey)

    const submitResult = await submitWeavyBulkOne(apiKey, params)
    if (!submitResult.ok || !submitResult.taskId) throw Error(submitResult.error || 'Submit failed')

    const [recipeId, batchId] = submitResult.taskId.split(':')
    const inputUrls = [submitResult.charUrl, submitResult.outfitUrl]

    // Poll with access token directly
    const startTime = Date.now()
    const timeoutMs = 600000
    let attempt = 0
    while (Date.now() - startTime < timeoutMs) {
      attempt++
      const interval = attempt < 20 ? 5000 : attempt < 40 ? 8000 : 12000
      await new Promise((r) => setTimeout(r, interval))

      try {
        const res = await fetch(`${WEAVY_API}/v1/batches/recipes/${recipeId}/batches/${batchId}/status`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10000),
        })
        if (!res.ok) continue
        const data = await res.json().catch(() => null)
        const recipeRun = data?.recipeRuns?.[0]
        const batchStatus = (recipeRun?.status || '').toLowerCase()
          const nodeRuns = recipeRun?.nodeRuns || []
          if (batchStatus === 'completed' || batchStatus === 'done' || batchStatus === 'success') {
            // Extract image URL from node runs
            for (let i = nodeRuns.length - 1; i >= 0; i--) {
              const nodeResult = nodeRuns[i]?.result
              const urls = Array.isArray(nodeResult)
                ? nodeResult.map((r: any) => r?.url || r?.image_url).filter(Boolean)
                : []
              if (urls.length > 0) {
                // Filter out input URLs (char + outfit)
                const inputIds = inputUrls.map((u: string) => u.split('/').pop()).filter(Boolean)
                const resultUrl = urls.find((u: string) => !inputIds.some((id: string) => u.includes(id)))
                if (resultUrl) {
                  return resultUrl
                }
                // If all URLs are inputs, return the last one (likely the result)
                return urls[urls.length - 1]
              }
            }
            // Check direct output
            const directUrl = data?.output?.image_url || data?.output?.url || data?.image_url || data?.url
            if (directUrl) {
              return directUrl
            }
            throw Error('Task completed but no image URL found')
          }

        if (batchStatus === 'failed' || batchStatus === 'error' || batchStatus === 'cancelled') {
          throw Error(`Weavy failed: ${recipeRun?.error || 'Generation failed'}`)
        }

        if (['completed', 'success', 'done', 'finished'].includes(status)) {
          const nodeRuns = data?.recipeRuns?.[0]?.nodeRuns || []
          for (let i = nodeRuns.length - 1; i >= 0; i--) {
            const nodeResult = nodeRuns[i]?.result
            const urls = Array.isArray(nodeResult) ? nodeResult.map((r: any) => r?.url || r?.image_url).filter(Boolean) : []
            if (urls.length > 0) {
              return urls[0]
            }
          }
          const directUrl = data?.output?.image_url || data?.output?.url || data?.image_url || data?.url
          if (directUrl) {
            return directUrl
          }
          throw Error('Task completed but no image URL found')
        }
        if (['failed', 'error', 'cancelled'].includes(status)) {
          throw Error(`Weavy failed: ${data?.error || data?.message || 'Generation failed'}`)
        }
      } catch (err: any) {
        if (/timeout|fetch|network/i.test(err.message)) continue
        throw err
      }
    }
    throw Error('Weavy timeout')
  }, {
    requiredCredits: 6,
    onKeySwitch: (from, to, attempt) => {},
  })
  if (rotation.ok && rotation.result) return rotation.result
  throw Error(rotation.error || 'Weavy bulk: semua token gagal')
}

function randId(): string {
  return Math.random().toString(36).substring(2, 10)
}

async function compressImageIfNeeded(file: File, maxDim = 2048, quality = 0.9): Promise<File> {
  if (file.size <= 8 * 1024 * 1024) return file
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let w = img.width, h = img.height
        if (w > maxDim) { h = h * maxDim / w; w = maxDim }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        canvas.toBlob(
          (blob) => resolve(blob ? new File([blob], file.name, { type: 'image/jpeg' }) : file),
          'image/jpeg', quality
        )
      }
      img.onerror = () => resolve(file)
      img.src = String(reader.result || '')
    }
    reader.readAsDataURL(file)
  })
}

async function uploadWeavyAsset(file: File, accessToken: string, onLog?: (msg: string) => void): Promise<any> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('type', file.type || 'image/jpeg')
  onLog?.(`Upload ke Weavy...`)
  const res = await fetch(`${WEAVY_API}/v1/assets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw Error(`Weavy upload failed (${res.status})`)
  return res.json()
}

function resolveWeavyAssetUrl(asset: any, type: 'image' | 'video' = 'image'): string {
  if (!asset) throw Error('Weavy upload: no asset returned')
  if (typeof asset === 'string') return asset
  if (asset.url) return asset.url
  if (asset.download) return asset.download
  if (asset.id) {
    return `https://media.weavy.ai/${type}/upload/uploads/${asset.publicId || asset.id}.${type === 'video' ? 'mp4' : 'jpg'}`
  }
  throw Error('Weavy: cannot resolve asset URL')
}

async function uploadWeavyAssetWithRetry(file: File, accessToken: string, onLog?: (msg: string) => void, maxRetries = 2): Promise<any> {
  let currentFile = file
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await uploadWeavyAsset(currentFile, accessToken, onLog)
    } catch (err: any) {
      onLog?.(`Upload error (attempt ${attempt + 1}): ${err.message}`)
      if (attempt >= maxRetries) throw err
      const msg = err.message
      if (msg.includes('413') && currentFile.type.startsWith('image/')) {
        currentFile = await compressImageIfNeeded(currentFile, 800, 0.5)
        onLog?.(`Retry with compressed image...`)
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  throw Error('Upload retries exhausted')
}

function buildTopazUpscaleNodes(imageUrl: string, settings: TopazUpscaleSettings): { model: string; nodes: any[]; edges: any[] } {
  const TOPAZ_MODEL = 'fal-ai/topaz/upscale/image'
  const fileNodeId = `n_${Date.now()}_img`
  const modelNodeId = `n_${Date.now()}_mdl`

  const fileNode = {
    id: fileNodeId,
    type: 'import',
    dragHandle: '.node-header',
    owner: null,
    visibility: null,
    isModel: false,
    data: {
      handles: {
        output: {
          file: { type: 'any', label: 'File', order: 0, format: 'uri' }
        }
      },
      name: 'File',
      color: 'Yambo_Blue',
      files: [{
        type: 'image',
        url: imageUrl,
        publicId: `uploads/${randId()}`,
        id: randId(),
        name: 'image.jpg',
        insertionOrder: 0,
      }],
      result: {
        type: 'image',
        url: imageUrl,
        publicId: `uploads/${randId()}`,
        id: randId(),
        name: 'image.jpg',
        insertionOrder: 0,
      },
      output: {
        file: {
          type: 'image',
          url: imageUrl,
          publicId: `uploads/${randId()}`,
          id: randId(),
          name: 'image.jpg',
          insertionOrder: 0,
        }
      },
      version: 3,
    },
    position: { x: 80, y: 200 },
    width: 460,
    height: 400,
  }

  const modelNode = {
    id: modelNodeId,
    type: 'custommodelV2',
    dragHandle: '.node-header',
    owner: null,
    visibility: 'private',
    isModel: true,
    data: {
      handles: {
        input: {
          image_url: {
            id: 'input-image_url',
            type: 'image',
            label: 'image',
            format: 'text',
            required: true,
          },
        },
        output: {
          result: {
            id: 'output-result',
            type: 'image',
            label: 'result',
            order: 0,
            format: 'uri',
          },
        },
      },
      name: 'Topaz Upscale',
      color: 'Red',
      menu: {
        icon: 'EmojiObjectsIcon',
        isModel: true,
        displayName: 'Topaz Upscale',
      },
      model: {
        name: TOPAZ_MODEL,
        service: 'fal_imported',
        version: TOPAZ_MODEL,
      },
      params: {
        model: settings.model,
        upscale_factor: settings.upscale_factor,
        output_format: settings.output_format,
        crop_to_fill: !!settings.crop_to_fill,
      },
      version: 3,
      kind: {
        type: 'wildcard',
        model: {
          type: 'predefined',
          name: TOPAZ_MODEL,
          version: TOPAZ_MODEL,
          service: 'fal_imported',
        },
        inputs: [
          [
            { id: 'image_url', title: 'image', validTypes: ['image'], required: true },
            { nodeId: fileNodeId, outputId: 'file' },
          ],
        ],
        parameters: [
          [
            { id: 'model', title: 'model', constraint: { type: 'enum' }, defaultValue: { type: 'string', value: 'Standard V2' } },
            { type: 'value', data: { type: 'string', value: settings.model } },
          ],
          [
            { id: 'upscale_factor', title: 'upscale_factor', constraint: { type: 'number' }, defaultValue: { type: 'number', value: 2 } },
            { type: 'value', data: { type: 'number', value: settings.upscale_factor } },
          ],
          [
            { id: 'output_format', title: 'output_format', constraint: { type: 'enum' }, defaultValue: { type: 'string', value: 'jpeg' } },
            { type: 'value', data: { type: 'string', value: settings.output_format } },
          ],
          [
            { id: 'crop_to_fill', title: 'crop_to_fill', constraint: { type: 'boolean' }, defaultValue: { type: 'boolean', value: false } },
            { type: 'value', data: { type: 'boolean', value: !!settings.crop_to_fill } },
          ],
        ],
        outputs: [{ id: 'result', title: 'result', dataType: 'image' }],
      },
      generations: [],
      selectedIndex: 0,
      cameraLocked: false,
      result: [],
      output: {},
      selectedOutput: 0,
    },
    position: { x: 600, y: 300 },
    width: 460,
    height: 500,
  }

  const edge = {
    id: `e-${randId()}`,
    source: fileNodeId,
    target: modelNodeId,
    sourceHandle: `${fileNodeId}-output-file`,
    targetHandle: `${modelNodeId}-input-image_url`,
    type: 'custom',
    data: {
      sourceColor: 'Yambo_Blue',
      targetColor: 'Red',
      sourceHandleType: 'any',
      targetHandleType: 'image',
    },
  }

  return { model: TOPAZ_MODEL, nodes: [fileNode, modelNode], edges: [edge] }
}

export interface TopazUpscaleSettings {
  model: string
  upscale_factor: number
  output_format: 'jpeg' | 'png'
  crop_to_fill: boolean
}

export interface WeavyUpscaleResult {
  ok: boolean
  taskId?: string
  error?: string
  raw?: any
}

export async function submitWeavyUpscale(params: { token: string; settings: TopazUpscaleSettings; imageUrl: string }): Promise<WeavyUpscaleResult> {
  const { token, settings, imageUrl } = params
  let accessToken = token
  if (isRefreshToken(token)) {
    const refreshed = await refreshWeavyToken(token)
    if (refreshed?.accessToken) accessToken = refreshed.accessToken
  }
  try {
    const { id: recipeId, v3 } = await createWeavyRecipe(accessToken)
    const { nodes, edges, model } = buildTopazUpscaleNodes(imageUrl, settings)
    await saveWeavyRecipe(recipeId, { nodes, edges, v3 }, accessToken)
    await approveWeavyModel(model, accessToken)
    const execRes = await fetch(`${WEAVY_API}/v1/batches/recipes/${recipeId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ nodes, edges, numberOfRuns: 1 }),
      signal: AbortSignal.timeout(30000),
    })
    const text = await execRes.text()
    let data: any
    try { data = JSON.parse(text) } catch { data = null }
    if (!execRes.ok || !data) return { ok: false, error: data?.error || data?.message || text.slice(0, 200) || `HTTP ${execRes.status}`, raw: data }
    const batchId = data?.batchId || data?.id
    if (!batchId) return { ok: false, error: 'No batchId in response', raw: data }
    return { ok: true, taskId: `${recipeId}:${batchId}`, raw: data }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function pollWeavyUpscaleStatus(
  token: string,
  taskId: string,
  onProgress?: (status: string, pct: number) => void,
  inputImageUrl?: string,
  timeoutMs = 600000,
): Promise<string> {
  const startTime = Date.now()
  let lastLog = ''
  const [recipeId, batchId] = taskId.split(':')
  let accessToken = token
  if (isRefreshToken(token)) {
    const refreshed = await refreshWeavyToken(token)
    if (refreshed?.accessToken) accessToken = refreshed.accessToken
  }

  const maxAttempts = Math.ceil(timeoutMs / 5000)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const waitMs = attempt < 20 ? 5000 : attempt < 40 ? 8000 : 12000
    await new Promise((r) => setTimeout(r, waitMs))
    try {
      let result: any = null
      if (recipeId && batchId) {
        const res = await fetch(`${WEAVY_API}/v1/batches/recipes/${recipeId}/batches/${batchId}/status`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10000),
        })
        if (res.ok) result = await res.json().catch(() => null)
      }
      if (!result) {
        const res = await fetch(`${WEAVY_API}/v1/batches/${batchId}/status`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10000),
        })
        if (res.ok) result = await res.json().catch(() => null)
      }
      if (!result) continue

      const status = String(result?.status || result?.state || result?.recipeRuns?.[0]?.status || 'unknown')
      const upperStatus = status.toUpperCase()
      const elapsedMin = (Date.now() - startTime) / (2 * 60000)
      const fallbackPct = Math.min(0.94, 1 - 1 / (1 + elapsedMin * 1.6))
      const pct = Math.round(5 + fallbackPct * 89)
      onProgress?.(status || 'processing', pct)

      const logEntry = `poll #${Math.round((Date.now() - startTime) / 1000)}s status=${status} pct=${pct}`
      if (logEntry !== lastLog) {
        lastLog = logEntry
        console.log(`[weavy-upscale] ${logEntry}`)
      }

      if (['completed', 'COMPLETED', 'done', 'success', 'finished', 'SUCCESS'].includes(upperStatus)) {
        const nodeRuns = result?.recipeRuns?.[0]?.nodeRuns || []
        for (let i = nodeRuns.length - 1; i >= 0; i--) {
          const nodeRun = nodeRuns[i]
          let nodeResult = nodeRun.result
          if (Array.isArray(nodeResult)) nodeResult = nodeResult[0]

          const urls = [
            nodeResult?.url,
            nodeResult?.image_url,
            nodeRun.output?.file?.url,
            nodeRun.output?.image_url,
            nodeRun.output?.url,
            ...(nodeRun.generations || []).map((g: any) => g.url || g.image_url),
          ]
            .filter((url: any) => !!url && typeof url === 'string' && /\.(png|jpe?g|webp)(\?|$)/i.test(url))
            .filter((url: string) => url !== inputImageUrl)

          if (urls.length > 0) return urls[0]
        }

        const directUrl = result?.output?.image_url || result?.output?.url || result?.image_url || result?.url
        if (directUrl) return directUrl

        console.log(`[weavy-upscale] task done but no url:`, JSON.stringify(result, null, 2).slice(0, 2000))
        throw new Error('Weavy: task completed but no image URL found')
      }

      if (['failed', 'FAILED', 'error', 'ERROR', 'canceled', 'CANCELED'].includes(upperStatus)) {
        const errMsg = (result?.error || result?.message || '').toString()
        const nodeErrMsg = (result?.recipeRuns?.[0]?.nodeRuns || [])
          .map((n: any) => n.error || n.errorMessage)
          .filter(Boolean)
          .join(' | ')
        throw new Error(`Weavy upscale failed: ${errMsg || nodeErrMsg || 'unknown error'}`)
      }
    } catch (err: any) {
      if (attempt > 8) throw err
      if (!/timeout|fetch|network/i.test(err.message)) throw err
    }
  }
  throw new Error('Weavy upscale: timeout')
}

export async function runTopazUpscale(
  file: File,
  settings: TopazUpscaleSettings,
  onProgress?: (msg: string, pct?: number) => void,
): Promise<string> {
  const { withTokenRotation, detectTokenError } = await import('@/lib/tokenRotation')

  const rotation = await withTokenRotation<string>('weavy', async (apiKey) => {
    // Refresh token client-side first
    const accessToken = await getWeavyAccessToken(apiKey)

    onProgress?.(`Compress + upload ke Weavy...`, 5)
    const compressed = file.size > 8 * 1024 * 1024 ? await compressImageIfNeeded(file, 2048, 0.9) : file

    // Upload with access token
    const formData = new FormData()
    formData.append('file', compressed, `upscale_${Date.now()}.jpg`)
    const uploadRes = await fetch(`${WEAVY_API}/v1/assets/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
      signal: AbortSignal.timeout(30000),
    })
    if (!uploadRes.ok) throw Error(`Weavy upload failed (${uploadRes.status})`)
    const uploadData = await uploadRes.json()
    const imageUrl = uploadData?.url || uploadData?.download || `https://media.weavy.ai/image/upload/uploads/${uploadData?.publicId || uploadData?.id}.jpg`
    onProgress?.(`Upload OK`, 15)

    onProgress?.(`Create recipe Topaz...`, 20)
    const submitResult = await submitWeavyUpscale({ token: accessToken, settings, imageUrl })
    if (!submitResult.ok || !submitResult.taskId) {
      throw Error(submitResult.error || 'Weavy upscale submit failed')
    }
    onProgress?.(`Menunggu hasil...`, 25)
    const resultUrl = await pollWeavyUpscaleStatus(apiKey, submitResult.taskId, (status, pct) => {
      onProgress?.(`poll: ${status}`, 30 + Math.floor(pct / 100 * 65))
    }, imageUrl)
    onProgress?.(`Topaz upscale selesai`, 100)
    return resultUrl
  }, {
    onKeySwitch: (from, to, attempt) => {
      onProgress?.(`↻ rotate token Weavy #${attempt}: ${from.name} → ${to.name} (credit habis)`, 25)
    },
    onError: (err, key) => {
      if (detectTokenError('weavy', err)) {
        console.log(`[weavy-upscale] token error on "${key.name}": ${err.message}`)
      }
    },
  })

  if (rotation.ok && rotation.result) return rotation.result
  throw Error(rotation.error || 'Topaz: semua Weavy token gagal')
}