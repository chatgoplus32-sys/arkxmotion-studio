const WEAVY_API = 'https://api.weavy.ai/api'
const FIREBASE_KEY = 'AIzaSyC-qLy3TFyXMogJPfMkZJ9H_q46hEu1sxI'
const WEAVY_PROXY = '/api/public/weavy'

// ── Token Management (synced with providerManager store) ──

interface ProviderManagerStore {
  keys: Record<string, Array<{ id: string; key: string; name?: string; status: string; balance?: number | null; email?: string; lastChecked?: number }>>
  routing?: Record<string, string>
}

const LS_PROVIDERS = 'arkxmotion.providers'
const LS_ROUTING = 'arkxmotion.routing'
const LS_ACTIVE_PROVIDER = 'arkxmotion.activeProvider'

function loadProviderStore(): ProviderManagerStore {
  if (typeof window === 'undefined') return { keys: {} }
  try {
    const raw = localStorage.getItem(LS_PROVIDERS)
    if (!raw) return { keys: {} }
    const parsed = JSON.parse(raw)
    // Direct format from providerManager: { weavy: [...], wavespeed: [...], ... }
    if (Array.isArray(parsed?.weavy)) return { keys: parsed }
    // Zustand persist wrap: { state: { weavy: [...] } }
    if (Array.isArray(parsed?.state?.weavy)) return { keys: parsed.state }
    return { keys: {} }
  } catch { return { keys: {} } }
}

function saveProviderStore(store: ProviderManagerStore) {
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem(LS_PROVIDERS)
    if (raw) {
      const data = JSON.parse(raw)
      // Zustand persist wrap: { state: { keys: {...} } }
      if (data?.state?.keys) { data.state.keys = store.keys; localStorage.setItem(LS_PROVIDERS, JSON.stringify(data)); return }
    }
    // Direct format: just write { weavy: [...], wavespeed: [...] }
    localStorage.setItem(LS_PROVIDERS, JSON.stringify(store.keys))
  } catch {}
}

function getWeavyKeys(): Array<{ id: string; key: string; name?: string; status: string; balance?: number | null; email?: string }> {
  const store = loadProviderStore()
  return store.keys?.weavy || []
}

function updateWeavyKey(update: { id: string } & Partial<{ key: string; status: string; balance: number | null; email: string; lastChecked: number }>) {
  const store = loadProviderStore()
  const keys = store.keys?.weavy || []
  const idx = keys.findIndex(k => k.id === update.id)
  if (idx >= 0) { Object.assign(keys[idx], update) }
  else { keys.push(update as any) }
  store.keys.weavy = keys
  saveProviderStore(store)
}

function removeWeavyKey(id: string) {
  const store = loadProviderStore()
  if (store.keys?.weavy) {
    store.keys.weavy = store.keys.weavy.filter(k => k.id !== id)
    saveProviderStore(store)
  }
}

function getActiveWeavyId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const routing = localStorage.getItem(LS_ROUTING)
    if (routing) {
      const data = JSON.parse(routing)
      const active = data?.motion || data?.['image-to-video']
      if (active === 'weavy') return null // Don't use routing-based active ID for weavy token selection
    }
  } catch {}
  return null
}

async function refreshWeavyAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; uid?: string } | null> {
  try {
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) return null
    const data = await r.json().catch(() => ({}))
    if (!data.id_token) return null
    return {
      accessToken: data.id_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: Number(data.expires_in) || 3600,
      uid: data.user_id,
    }
  } catch { return null }
}

function isRefreshToken(token: string): boolean {
  return !/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) && token.length > 40
}

function isTokenValid(key: { status?: string }): boolean {
  return key.status !== 'invalid' && key.status !== 'expired' && key.status !== 'empty'
}

async function resolveWeavyAccessToken(refreshToken: string): Promise<string> {
  const isJwt = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(refreshToken)
  if (isJwt) return refreshToken
  const refreshed = await refreshWeavyAccessToken(refreshToken)
  if (refreshed) return refreshed.accessToken
  throw Error('Token Weavy expired. Silakan update token di Providers.')
}

export async function getActiveWeavyAccessToken(): Promise<{ id: string; accessToken: string } | null> {
  if (typeof window === 'undefined') return null
  const keys = getWeavyKeys()
  if (keys.length === 0) return null

  // Sort: valid tokens first, then by balance descending
  const sorted = [...keys].filter(isTokenValid).sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))

  for (const entry of sorted) {
    try {
      const accessToken = await resolveWeavyAccessToken(entry.key)
      return { id: entry.id, accessToken }
    } catch { continue }
  }
  return null
}

export async function selectWeavyTokenForCredits(minCredits: number, skipIds = new Set<string>()): Promise<{ token: { id: string; key: string; balance?: number | null }; accessToken: string } | null> {
  if (typeof window === 'undefined') return null
  const keys = getWeavyKeys()
  const sorted = [...keys].filter(k => isTokenValid(k) && !skipIds.has(k.id)).sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))

  for (const entry of sorted) {
    try {
      const accessToken = await resolveWeavyAccessToken(entry.key)
      // Check balance
      const credits = await fetchWeavyCreditsClient(accessToken)
      updateWeavyKey({ id: entry.id, balance: credits, email: extractEmailFromJwt(accessToken) || undefined, lastChecked: Date.now(), status: credits !== null && credits <= 0 ? 'empty' : 'active' })
      if (credits === null) continue
      if (credits < minCredits) continue
      return { token: entry, accessToken }
    } catch { continue }
  }
  return null
}

export async function rotateWeavyToken(currentId: string): Promise<{ id: string; accessToken: string } | null> {
  updateWeavyKey({ id: currentId, status: 'empty', balance: 0 })

  const keys = getWeavyKeys().filter(k => k.id !== currentId && isTokenValid(k))
  for (const entry of keys) {
    try {
      const accessToken = await resolveWeavyAccessToken(entry.key)
      const credits = await fetchWeavyCreditsClient(accessToken)
      updateWeavyKey({ id: entry.id, balance: credits, status: credits !== null && credits <= 0 ? 'empty' : 'active' })
      if (credits !== null && credits <= 0) continue
      return { id: entry.id, accessToken }
    } catch { continue }
  }
  return null
}

function extractEmailFromJwt(token: string): string | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1]))
    return payload.email || payload.user_id || null
  } catch { return null }
}

function extractSubscriptionType(token: string): string | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1]))
    return payload.subscription_type || null
  } catch { return null }
}

// Backward-compatible token resolver (for old-style callers)
async function getWeavyAccessToken(token: string): Promise<string> {
  return resolveWeavyAccessToken(token)
}

// ── Upload (matching production) ──

export function compressImageForWeavy(file: File, maxDim = 1280, quality = 0.8): Promise<File> {
  return new Promise(resolve => {
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
          blob => resolve(blob ? new File([blob], file.name, { type: 'image/jpeg' }) : file),
          'image/jpeg', quality
        )
      }
      img.onerror = () => resolve(file)
      img.src = String(reader.result || '')
    }
    reader.readAsDataURL(file)
  })
}

export async function uploadWeavyAsset(file: File, filename: string, accessToken: string): Promise<any> {
  const formData = new FormData()
  formData.append('file', file, filename)
  if (file.type) formData.append('type', file.type)
  const res = await fetch(`${WEAVY_API}/v1/assets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw Error(`Weavy upload failed (${res.status})`)
  return await res.json()
}

export async function uploadWeavyAssetWithRetry(file: File, filename: string, accessToken: string, maxRetries = 2): Promise<any> {
  let currentFile = file
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await uploadWeavyAsset(currentFile, filename, accessToken)
    } catch (err: any) {
      if (attempt >= maxRetries) throw err
      if (err.message?.includes('413') && currentFile.type.startsWith('image/')) {
        currentFile = await compressImageForWeavy(currentFile, 800, 0.5)
      }
      await new Promise(r => setTimeout(r, 1500))
    }
  }
  throw Error('Upload retries exhausted')
}

export function resolveWeavyAssetUrl(asset: any, type: 'image' | 'video' = 'image'): string {
  if (typeof asset === 'string') return asset
  if (asset?.url) return asset.url
  if (asset?.download) return asset.download
  if (asset?.id) return `https://media.weavy.ai/${type}/upload/uploads/${asset.id}.${type === 'video' ? 'mp4' : 'jpg'}`
  if (asset?.raw?.url) return asset.raw.url
  throw Error('Weavy: cannot resolve asset URL')
}

export async function fetchWeavyCreditsClient(accessToken: string): Promise<number | null> {
  // Try multiple endpoints like reference site (arkxmotionv2)
  const endpoints = [
    `${WEAVY_API}/v1/credits`,
    `${WEAVY_API}/v1/user/credits`,
    `${WEAVY_API}/v1/user/balance`,
    `${WEAVY_API}/v1/user`,
    `${WEAVY_API}/v1/account`,
    `${WEAVY_API}/v1/subscription`,
  ]
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!r.ok) continue
      const d = await r.json().catch(() => null)
      const c = d?.credits ?? d?.balance ?? d?.totalCredits ?? d?.creditsRemaining ?? d?.quota ?? d?.usage?.credits ?? d?.plan?.credits ?? d?.data?.credits ?? d?.user?.credits ?? null
      if (c !== null && typeof c === 'number') return c
    } catch { continue }
  }

  // Primary: workspaces endpoint (reference site uses d.credits top-level)
  try {
    const r = await fetch(`${WEAVY_API}/v1/workspaces`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (r.ok) {
      const d = await r.json().catch(() => null)
      console.log('[weavy] workspaces response:', JSON.stringify(d).slice(0, 500))
      // Top-level credits (reference site: const c = d.credits)
      if (d?.credits != null && typeof d.credits === 'number') return d.credits
      // Nested workspace credits
      const ws = d?.workspaces?.[0] || d?.[0] || d
      if (ws?.credits != null && typeof ws.credits === 'number') return ws.credits
      if (ws?.balance != null && typeof ws.balance === 'number') return ws.balance
    } else {
      console.log('[weavy] workspaces error:', r.status, await r.text().catch(() => ''))
    }
  } catch (e: any) {
    console.log('[weavy] workspaces catch:', e.message)
  }

  return null
}

async function resolveAndFetchCredits(token: string): Promise<{ ok: boolean; credits: number | null; email?: string; subscriptionType?: string }> {
  console.log('[weavy] resolveAndFetchCredits called, token starts:', token.slice(0, 20) + '...')

  // Step 1: Refresh token → get access token (exactly like reference site)
  let accessToken = token
  if (isRefreshToken(token)) {
    console.log('[weavy] refreshing token via securetoken.googleapis.com...')
    const refreshed = await refreshWeavyAccessToken(token)
    if (refreshed?.accessToken) {
      accessToken = refreshed.accessToken
      console.log('[weavy] token refreshed OK, accessToken starts:', accessToken.slice(0, 30) + '...')
    } else {
      console.log('[weavy] token refresh FAILED')
    }
  } else {
    console.log('[weavy] token is JWT, using directly')
  }

  // Step 2: Extract email & subscription from JWT (like reference site)
  const email = extractEmailFromJwt(accessToken) || undefined
  const subscriptionType = extractSubscriptionType(accessToken) || undefined
  console.log('[weavy] email:', email, 'subscription:', subscriptionType)

  // Step3: Call Weavy API directly from browser (exactly like reference site)
  const credits = await fetchWeavyCreditsClient(accessToken)
  console.log('[weavy] final credits:', credits)

  return { ok: true, credits, email, subscriptionType }
}

export interface WeavyGenerateParams {
  token: string
  model: string
  prompt: string
  imageUrl?: string
  videoUrl?: string
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

export async function checkWeavyBalance(token: string): Promise<{ ok: boolean; balance?: number | null; email?: string; subscriptionType?: string; error?: string }> {
  try {
    const result = await resolveAndFetchCredits(token)
    return { ok: result.ok, balance: result.credits, email: result.email, subscriptionType: result.subscriptionType }
  } catch (err: any) {
    return { ok: false, balance: null, error: err.message }
  }
}

export async function checkWeavyBalanceDirect(token: string): Promise<{ ok: boolean; balance?: number | null; email?: string; subscriptionType?: string; error?: string }> {
  try {
    const result = await resolveAndFetchCredits(token)
    return { ok: result.ok, balance: result.credits, email: result.email, subscriptionType: result.subscriptionType }
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
    'sora-2': 'fal-ai/sora-2/image-to-video/pro',
    'grok-video': 'xai/grok-imagine-video/image-to-video',
    'gemini-omni': 'google/gemini-omni-flash',
    'seedance-mini': 'bytedance/seedance-2.0/mini/image-to-video',
  }
  return map[modelKey] || modelKey
}

function resolveImageModel(modelKey: string): { model: string; service: string } {
  const map: Record<string, { model: string; service: string }> = {}
  return map[modelKey] || { model: modelKey, service: 'fal_imported' }
}

function buildImageNode(modelKey: string, prompt: string, quality: string, ratio: string, imageUrl?: string, maskUrl?: string, imageUrls?: string[]): any {
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

    // Handle multiple images or single image
    const allImageUrls = imageUrls?.length ? imageUrls : (imageUrl ? [imageUrl] : [])
    if (allImageUrls.length > 0) {
      params.image_urls = allImageUrls
      
      allImageUrls.forEach((url, idx) => {
        const imgNodeId = 'n_' + now + '_img' + (idx > 0 ? idx : '')
        handles.input[idx === 0 ? 'image' : `image${idx + 1}`] = { id: `input-image${idx > 0 ? idx : ''}`, type: 'image', label: `image${idx > 0 ? idx : ''}`, format: 'text', required: false }

        const imgNode = {
          id: imgNodeId, type: 'import', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
          data: {
            handles: { output: { file: { type: 'any', label: 'File', order: 0, format: 'uri' } } },
            name: 'File', color: 'Yambo_Blue',
            files: [{ type: 'image', url, publicId: 'uploads/' + randId(), id: imgNodeId + '_file', name: `input${idx}.jpg`, insertionOrder: idx }],
            result: { type: 'image', url, publicId: 'uploads/' + randId(), id: imgNodeId + '_result', name: `input${idx}.jpg`, insertionOrder: idx },
            output: { file: { type: 'image', url, publicId: 'uploads/' + randId(), id: imgNodeId + '_output', name: `input${idx}.jpg`, insertionOrder: idx } },
            version: 3,
          },
          position: { x: 80, y: 200 + idx * 150 }, width: 460, height: 400,
        }
        extraNodes.push(imgNode)
        extraEdges.push({
          id: 'e-' + randId(), source: imgNodeId, target: nodeId,
          sourceHandle: `${imgNodeId}-output-file`, targetHandle: `${nodeId}-input-image${idx > 0 ? idx : ''}`,
          type: 'custom', data: { sourceColor: 'Yambo_Blue', targetColor: 'Red', sourceHandleType: 'any', targetHandleType: 'image' },
        })
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
  const { token, model, prompt, imageUrl, videoUrl, aspectRatio = '9:16', duration = 5, negativePrompt, quality } = params
  const payload = { model: resolveModel(model), prompt: prompt.trim(), imageUrl: imageUrl || null, videoUrl: videoUrl || null, aspectRatio: resolveAspectRatio(aspectRatio), duration, negativePrompt: negativePrompt?.trim() || null, quality: quality || null }
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

// ── Sora 2 Pro (recipe-based workflow) ──

export async function uploadToWeavy(token: string, file: File): Promise<string> {
  const WEAVY_API = 'https://api.weavy.ai/api'
  const fd = new FormData()
  fd.append('file', file, file.name)
  if (file.type) fd.append('type', file.type)

  // Try direct browser upload first (bypasses Cloudflare proxy issues)
  try {
    const directRes = await fetch(`${WEAVY_API}/v1/assets/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
      signal: AbortSignal.timeout(60000),
    })
    const directText = await directRes.text()
    let directData: any; try { directData = JSON.parse(directText) } catch { directData = null }
    console.log(`[weavy] direct upload → ${directRes.status}`, directText.slice(0, 300))
    if (directRes.ok && directData) {
      const r = directData.result || directData
      if (r?.download) return r.download
      if (r?.url) return r.url
      if (r?.id) return `https://media.weavy.ai/image/upload/uploads/${r.id}.jpg`
    }
  } catch (e: any) {
    console.log(`[weavy] direct upload failed, trying proxy:`, e.message)
  }

  // Fallback: proxy upload
  const res = await fetch(`${WEAVY_PROXY}?action=upload`, {
    method: 'POST',
    headers: { 'X-Weavy-Token': token },
    body: fd,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.error || `Upload failed HTTP ${res.status}`)
  const result = data?.data?.result || data?.data
  if (typeof result === 'string') return result
  if (result?.url) return result.url
  if (result?.download) return result.download
  if (result?.id) return `https://media.weavy.ai/image/upload/uploads/${result.id}.jpg`
  throw new Error('No upload URL returned')
}

export interface WeavySoraParams {
  token: string
  imageUrl: string
  imageFile?: File
  prompt?: string
  duration?: number
  resolution?: string
  aspectRatio?: string
}

export interface WeavySoraResult {
  ok: boolean
  recipeId?: string
  batchId?: string
  error?: string
  raw?: any
}

export async function submitWeavySora(params: WeavySoraParams): Promise<WeavySoraResult> {
  const { token: refreshToken, imageUrl: fallbackUrl, imageFile, prompt, duration = 16, resolution = '720p', aspectRatio = '16:9' } = params
  const model = 'fal-ai/sora-2/image-to-video/pro'
  const mkId = () => Math.random().toString(36).substring(2, 8)
  const n1 = 'n_' + Date.now() + '_img'
  const n2 = 'n_' + Date.now() + '_model'

  // Refresh token to get access token
  const refreshed = await refreshWeavyAccessToken(refreshToken)
  const at = refreshed?.accessToken || refreshToken

  // Try uploading directly to Weavy from browser (like reference site)
  let imageUrl = fallbackUrl
  if (imageFile && at) {
    try {
      // Compress if needed (like reference site)
      let uploadFile = imageFile
      if (imageFile.size > 8 * 1024 * 1024) {
        uploadFile = await compressImageForWeavy(imageFile, 1280, 0.7)
        console.log(`[sora] compressed image (>8MB)`)
      } else if (imageFile.size > 4 * 1024 * 1024) {
        uploadFile = await compressImageForWeavy(imageFile, 1280, 0.85)
        console.log(`[sora] compressed image (>4MB)`)
      }
      const fd = new FormData()
      fd.append('file', uploadFile, uploadFile.name || 'image.jpg')
      if (uploadFile.type) fd.append('type', uploadFile.type)
      const uploadRes = await fetch(`${WEAVY_API}/v1/assets/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${at}` },
        body: fd,
      })
      const uploadText = await uploadRes.text()
      let uploadData: any; try { uploadData = JSON.parse(uploadText) } catch { uploadData = null }
      console.log(`[sora] direct upload → ${uploadRes.status}`, uploadText.slice(0, 300))
      if (uploadRes.ok && uploadData) {
        // Extract URL from Weavy upload response
        const result = uploadData.result || uploadData
        if (typeof result === 'string') imageUrl = result
        else if (result.url) imageUrl = result.url
        else if (result.download) imageUrl = result.download
        else if (result.id) imageUrl = `https://media.weavy.ai/image/upload/uploads/${result.id}.jpg`
        console.log(`[sora] Weavy upload URL:`, imageUrl)
      } else {
        console.warn(`[sora] Weavy upload failed (${uploadRes.status}), using fallback URL`)
      }
    } catch (e: any) {
      console.warn(`[sora] Weavy upload error:`, e.message, 'using fallback URL')
    }
  }

  const imgNode = {
    id: n1, type: 'import', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
    data: {
      handles: { output: { file: { type: 'any', label: 'File', order: 0, format: 'uri' } } },
      name: 'File', color: 'Yambo_Blue', dark_color: 'Yambo_Blue_Dark', border_color: 'Yambo_Blue_Stroke',
      files: [{ type: 'image', url: imageUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'image.jpg', insertionOrder: 0 }],
      result: { type: 'image', url: imageUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'image.jpg', insertionOrder: 0 },
      output: { file: { type: 'image', url: imageUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'image.jpg', insertionOrder: 0 } },
      version: 3
    },
    position: { x: 80, y: 200 }, width: 460, height: 400
  }

  const params_: any = { duration: parseInt(String(duration)) || 16, resolution: resolution || '720p', aspect_ratio: aspectRatio || '16:9', delete_video: false }
  if (prompt) params_.prompt = prompt

  const modelNode = {
    id: n2, type: 'custommodelV2', dragHandle: '.node-header', owner: null, visibility: 'private', isModel: true,
    data: {
      handles: {
        input: { image_url: { id: 'input-image_url', type: 'image', label: 'image', format: 'text', required: true } },
        output: { result: { id: 'output-result', type: 'video', label: 'result', order: 0, format: 'uri' } }
      },
      name: 'Sora 2 Pro',
      color: 'Red', menu: { icon: 'EmojiObjectsIcon', isModel: true, displayName: 'Sora 2 Pro' },
      model: { name: model, service: 'fal_imported', version: model },
      params: params_,
      version: 3,
      kind: {
        type: 'wildcard',
        model: { type: 'predefined', name: model, version: model, service: 'fal_imported' },
        inputs: [
          [{ id: 'image_url', title: 'image', validTypes: ['image'], required: true }, { nodeId: n1, outputId: 'file' }]
        ],
        parameters: [],
        outputs: [{ id: 'result', title: 'result', dataType: 'video' }]
      },
      generations: [], selectedIndex: 0, cameraLocked: false, result: [], output: {}, selectedOutput: 0
    },
    position: { x: 600, y: 300 }, width: 460, height: 500
  }

  const nodes = [imgNode, modelNode]
  const edges = [{
    id: 'e-' + mkId(), source: n1, target: n2,
    sourceHandle: `${n1}-output-file`, targetHandle: `${n2}-input-image_url`,
    type: 'custom', data: { sourceColor: 'Yambo_Blue', targetColor: 'Red' }
  }]
  const recipeData = { nodes, edges, model }

  const hdrs = { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' } as any

  const retryFetch = async (url: string, opts: any, retries = 3): Promise<Response> => {
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await fetch(url, opts)
        if (r.ok || r.status < 500) return r
        if (i < retries) await new Promise(r => setTimeout(r, 2000 * (i + 1)))
      } catch (e: any) {
        if (i >= retries) throw e
        await new Promise(r => setTimeout(r, 2000 * (i + 1)))
      }
    }
    throw new Error('retry exhausted')
  }

  try {
    const cr = await retryFetch(`${WEAVY_API}/v1/recipes/create`, {
      method: 'POST', headers: hdrs, body: JSON.stringify({ scope: 'PERSONAL' })
    })
    const crText = await cr.text()
    let crData: any; try { crData = JSON.parse(crText) } catch { crData = null }
    console.log(`[sora] create recipe → ${cr.status}`, crText.slice(0, 300))
    if (!cr.ok || !crData) throw new Error(`Create recipe failed (${cr.status}): ${crText.slice(0, 200)}`)
    const rid = crData.id || crData.recipeId

    const sr = await retryFetch(`${WEAVY_API}/v1/recipes/${rid}/save`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ ...recipeData, v3: crData.v3 || '', lastUpdatedAt: new Date().toISOString() })
    })
    const srText = await sr.text()
    console.log(`[sora] save recipe → ${sr.status}`, srText.slice(0, 200))
    if (!sr.ok) throw new Error(`Save recipe failed (${sr.status}): ${srText.slice(0, 200)}`)

    try {
      await fetch(`${WEAVY_API}/v1/workspaces/models/approve`, {
        method: 'POST', headers: hdrs, body: JSON.stringify({ modelIds: [model] })
      })
    } catch {}

    const er = await retryFetch(`${WEAVY_API}/v1/batches/recipes/${rid}/execute`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ numberOfRuns: 1, ...recipeData })
    })
    const et = await er.text()
    let erData: any; try { erData = JSON.parse(et) } catch { erData = null }
    console.log(`[sora] execute → ${er.status}`, et.slice(0, 500))
    if (!er.ok || !erData) throw new Error(`Execute failed (${er.status}): ${et.slice(0, 300)}`)
    const bid = erData.batchId || erData.id
    if (!bid) throw new Error('No batchId: ' + et.slice(0, 200))

    return { ok: true, recipeId: rid, batchId: bid, raw: erData }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

function extractSoraVideoUrl(data: any, inputImageUrl?: string): string | null {
  // Check recipeRuns[0].nodeRuns for video URL
  if (data?.recipeRuns?.[0]?.nodeRuns) {
    const nodeRuns = data.recipeRuns[0].nodeRuns
    for (let i = nodeRuns.length - 1; i >= 0; i--) {
      const nr = nodeRuns[i]
      let ro = nr.result
      if (Array.isArray(ro) && ro.length > 0) ro = ro[0]
      const urls = [
        ro?.url, ro?.video_url,
        nr.output?.file?.url, nr.output?.video_url, nr.output?.url,
        ...(nr.generations || []).map((g: any) => g.url || g.video_url)
      ].filter((u: any) => u && typeof u === 'string' && u.includes('.mp4') && u !== inputImageUrl)
      if (urls.length > 0) return urls[0]
    }
  }
  // Fallback
  return data?.output?.video_url || data?.output?.url || data?.video_url || data?.url || null
}

export async function pollWeavySoraStatus(
  token: string,
  recipeId: string,
  batchId: string,
  onProgress?: (status: string, pct: number) => void,
  timeoutMs = 3600000,
  inputImageUrl?: string,
): Promise<string> {
  const startTime = Date.now()
  let lastLog = ''
  let pollCount = 0

  // Refresh token to get access token
  const refreshed = await refreshWeavyAccessToken(token)
  let at = refreshed?.accessToken || token

  while (Date.now() - startTime < timeoutMs) {
    const delay = pollCount < 30 ? 8000 : pollCount < 60 ? 10000 : 15000
    await new Promise((r) => setTimeout(r, delay))
    pollCount++

    try {
      if (pollCount > 0 && pollCount % 10 === 0) {
        try {
          const r2 = await refreshWeavyAccessToken(token)
          if (r2?.accessToken) at = r2.accessToken
        } catch {}
      }

      const res = await fetch(`${WEAVY_API}/v1/batches/recipes/${recipeId}/batches/${batchId}/status`, {
        headers: { Authorization: `Bearer ${at}` },
      })
      if (!res.ok) continue
      const d = await res.json().catch(() => null)
      if (!d) continue

      const st = (d.recipeRuns?.[0]?.status || d.status || d.state || '').toLowerCase()
      const elapsedSec = Math.round((Date.now() - startTime) / 1000)
      const pct = Math.min(95, Math.round((pollCount / 120) * 95))
      onProgress?.(st || 'processing', pct)

      const logEntry = `poll #${pollCount} (${elapsedSec}s) status=${st} pct=${pct}`
      if (logEntry !== lastLog) { lastLog = logEntry; console.log(`[weavy-sora] ${logEntry}`) }

      if (st === 'completed' || st === 'COMPLETED' || st === 'done' || st === 'success') {
        const videoUrl = extractSoraVideoUrl(d, inputImageUrl)
        if (videoUrl) return videoUrl
        console.log(`[weavy-sora] task done but no url:`, JSON.stringify(d, null, 2).slice(0, 2000))
        throw new Error('Sora: task completed but no video URL found')
      }

      if (st === 'failed' || st === 'FAILED' || st === 'error') {
        const fullResp = JSON.stringify(d).slice(0, 1200)
        console.log(`[weavy-sora] FULL FAILED RESPONSE:`, fullResp)
        const ne = d.recipeRuns?.[0]?.nodeRuns?.map((nr: any) => `${nr.status || '?'}:${JSON.stringify(nr.error || nr.output || nr.result || {}).slice(0, 300)}`).join(' | ') || ''
        throw new Error((d.error || d.message || 'Generation failed') + (ne ? ' | ' + ne : ''))
      }
    } catch (err: any) {
      if (/timeout|fetch|network/i.test(err.message)) { console.log(`[weavy-sora] network error, retrying:`, err.message); continue }
      if (/failed|insufficient|error/i.test(err.message)) throw err
      if (pollCount > 10) throw err
    }
  }
  throw new Error('Sora timeout')
}

export interface WeavyGrokVideoParams {
  token: string
  imageUrl: string
  imageFile?: File
  prompt?: string
  duration?: number
  resolution?: string
  aspectRatio?: string
}

export interface WeavyGrokVideoResult {
  ok: boolean
  recipeId?: string
  batchId?: string
  error?: string
  raw?: any
}

export async function submitWeavyGrokVideo(params: WeavyGrokVideoParams): Promise<WeavyGrokVideoResult> {
  const { token: refreshToken, imageUrl: fallbackUrl, imageFile, prompt, duration = 10, resolution = '720p', aspectRatio = '16:9' } = params
  const model = 'xai/grok-imagine-video/image-to-video'
  const mkId = () => Math.random().toString(36).substring(2, 8)
  const n1 = 'n_' + Date.now() + '_img'
  const n2 = 'n_' + Date.now() + '_model'

  const refreshed = await refreshWeavyAccessToken(refreshToken)
  const at = refreshed?.accessToken || refreshToken

  let imageUrl = fallbackUrl
  if (imageFile && at) {
    try {
      let uploadFile = imageFile
      if (imageFile.size > 8 * 1024 * 1024) {
        uploadFile = await compressImageForWeavy(imageFile, 1280, 0.7)
      } else if (imageFile.size > 4 * 1024 * 1024) {
        uploadFile = await compressImageForWeavy(imageFile, 1280, 0.85)
      }
      const fd = new FormData()
      fd.append('file', uploadFile, uploadFile.name || 'image.jpg')
      if (uploadFile.type) fd.append('type', uploadFile.type)
      const uploadRes = await fetch(`${WEAVY_API}/v1/assets/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${at}` },
        body: fd,
      })
      const uploadText = await uploadRes.text()
      let uploadData: any; try { uploadData = JSON.parse(uploadText) } catch { uploadData = null }
      console.log(`[grokvid] direct upload → ${uploadRes.status}`, uploadText.slice(0, 300))
      if (uploadRes.ok && uploadData) {
        const result = uploadData.result || uploadData
        if (typeof result === 'string') imageUrl = result
        else if (result.url) imageUrl = result.url
        else if (result.download) imageUrl = result.download
        else if (result.id) imageUrl = `https://media.weavy.ai/image/upload/uploads/${result.id}.jpg`
        console.log(`[grokvid] Weavy upload URL:`, imageUrl)
      }
    } catch (e: any) {
      console.warn(`[grokvid] Weavy upload error:`, e.message)
    }
  }

  const imgNode = {
    id: n1, type: 'import', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
    data: {
      handles: { output: { file: { type: 'any', label: 'File', order: 0, format: 'uri' } } },
      name: 'File', color: 'Yambo_Blue', dark_color: 'Yambo_Blue_Dark', border_color: 'Yambo_Blue_Stroke',
      files: [{ type: 'image', url: imageUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'image.jpg', insertionOrder: 0 }],
      result: { type: 'image', url: imageUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'image.jpg', insertionOrder: 0 },
      output: { file: { type: 'image', url: imageUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'image.jpg', insertionOrder: 0 } },
      version: 3
    },
    position: { x: 80, y: 200 }, width: 460, height: 400
  }

  const params_: any = { duration: parseInt(String(duration)) || 10, resolution: resolution || '720p', aspect_ratio: aspectRatio || '16:9' }
  if (prompt) params_.prompt = prompt

  const modelNode = {
    id: n2, type: 'custommodelV2', dragHandle: '.node-header', owner: null, visibility: 'private', isModel: true,
    data: {
      handles: {
        input: {
          image_url: { id: 'input-image_url', type: 'image', label: 'image', format: 'text', required: true },
          prompt: { id: 'input-prompt', type: 'text', label: 'prompt', format: 'text', required: true }
        },
        output: { result: { id: 'output-result', type: 'video', label: 'result', order: 0, format: 'uri' } }
      },
      name: 'Grok Imagine Video v1.5 I2V',
      color: 'Red', menu: { icon: 'EmojiObjectsIcon', isModel: true, displayName: 'Grok Imagine Video v1.5 I2V' },
      model: { name: model, service: 'fal_imported', version: model },
      params: params_,
      version: 3,
      kind: {
        type: 'wildcard',
        model: { type: 'predefined', name: model, version: model, service: 'fal_imported' },
        inputs: [
          [{ id: 'image_url', title: 'image', validTypes: ['image'], required: true }, { nodeId: n1, outputId: 'file' }],
          [{ id: 'prompt', title: 'prompt', validTypes: ['text'], required: true }, null]
        ],
        parameters: [],
        outputs: [{ id: 'result', title: 'result', dataType: 'video' }]
      },
      generations: [], selectedIndex: 0, cameraLocked: false, result: [], output: {}, selectedOutput: 0
    },
    position: { x: 600, y: 300 }, width: 460, height: 500
  }

  const nodes = [imgNode, modelNode]
  const edges = [{
    id: 'e-' + mkId(), source: n1, target: n2,
    sourceHandle: `${n1}-output-file`, targetHandle: `${n2}-input-image_url`,
    type: 'custom', data: { sourceColor: 'Yambo_Blue', targetColor: 'Red' }
  }]
  const recipeData = { nodes, edges, model }

  const hdrs = { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' } as any

  const retryFetch = async (url: string, opts: any, retries = 3): Promise<Response> => {
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await fetch(url, opts)
        if (r.ok || r.status < 500) return r
        if (i < retries) await new Promise(r => setTimeout(r, 2000 * (i + 1)))
      } catch (e: any) {
        if (i >= retries) throw e
        await new Promise(r => setTimeout(r, 2000 * (i + 1)))
      }
    }
    throw new Error('retry exhausted')
  }

  try {
    const cr = await retryFetch(`${WEAVY_API}/v1/recipes/create`, {
      method: 'POST', headers: hdrs, body: JSON.stringify({ scope: 'PERSONAL' })
    })
    const crText = await cr.text()
    let crData: any; try { crData = JSON.parse(crText) } catch { crData = null }
    console.log(`[grokvid] create recipe → ${cr.status}`, crText.slice(0, 300))
    if (!cr.ok || !crData) throw new Error(`Create recipe failed (${cr.status}): ${crText.slice(0, 200)}`)
    const rid = crData.id || crData.recipeId

    const sr = await retryFetch(`${WEAVY_API}/v1/recipes/${rid}/save`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ ...recipeData, v3: crData.v3 || '', lastUpdatedAt: new Date().toISOString() })
    })
    const srText = await sr.text()
    console.log(`[grokvid] save recipe → ${sr.status}`, srText.slice(0, 200))
    if (!sr.ok) throw new Error(`Save recipe failed (${sr.status}): ${srText.slice(0, 200)}`)

    try {
      await fetch(`${WEAVY_API}/v1/workspaces/models/approve`, {
        method: 'POST', headers: hdrs, body: JSON.stringify({ modelIds: [model] })
      })
    } catch {}

    const er = await retryFetch(`${WEAVY_API}/v1/batches/recipes/${rid}/execute`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ numberOfRuns: 1, ...recipeData })
    })
    const et = await er.text()
    let erData: any; try { erData = JSON.parse(et) } catch { erData = null }
    console.log(`[grokvid] execute → ${er.status}`, et.slice(0, 500))
    if (!er.ok || !erData) throw new Error(`Execute failed (${er.status}): ${et.slice(0, 300)}`)
    const bid = erData.batchId || erData.id
    if (!bid) throw new Error('No batchId: ' + et.slice(0, 200))

    return { ok: true, recipeId: rid, batchId: bid, raw: erData }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function pollWeavyGrokVideoStatus(
  token: string,
  recipeId: string,
  batchId: string,
  onProgress?: (status: string, pct: number) => void,
  timeoutMs = 3600000,
  inputImageUrl?: string,
): Promise<string> {
  const startTime = Date.now()
  let lastLog = ''
  let pollCount = 0

  const refreshed = await refreshWeavyAccessToken(token)
  let at = refreshed?.accessToken || token

  while (Date.now() - startTime < timeoutMs) {
    const delay = pollCount < 30 ? 8000 : pollCount < 60 ? 10000 : 15000
    await new Promise((r) => setTimeout(r, delay))
    pollCount++

    try {
      if (pollCount > 0 && pollCount % 10 === 0) {
        try {
          const r2 = await refreshWeavyAccessToken(token)
          if (r2?.accessToken) at = r2.accessToken
        } catch {}
      }

      const res = await fetch(`${WEAVY_API}/v1/batches/recipes/${recipeId}/batches/${batchId}/status`, {
        headers: { Authorization: `Bearer ${at}` },
      })
      if (!res.ok) continue
      const d = await res.json().catch(() => null)
      if (!d) continue

      const st = (d.recipeRuns?.[0]?.status || d.status || d.state || '').toLowerCase()
      const elapsedSec = Math.round((Date.now() - startTime) / 1000)
      const pct = Math.min(95, Math.round((pollCount / 120) * 95))
      onProgress?.(st || 'processing', pct)

      const logEntry = `poll #${pollCount} (${elapsedSec}s) status=${st} pct=${pct}`
      if (logEntry !== lastLog) { lastLog = logEntry; console.log(`[weavy-grokvid] ${logEntry}`) }

      if (st === 'completed' || st === 'COMPLETED' || st === 'done' || st === 'success') {
        const videoUrl = extractSoraVideoUrl(d, inputImageUrl)
        if (videoUrl) return videoUrl
        console.log(`[weavy-grokvid] task done but no url:`, JSON.stringify(d, null, 2).slice(0, 2000))
        throw new Error('GrokVideo: task completed but no video URL found')
      }

      if (st === 'failed' || st === 'FAILED' || st === 'error') {
        const fullResp = JSON.stringify(d).slice(0, 1200)
        console.log(`[weavy-grokvid] FULL FAILED RESPONSE:`, fullResp)
        const ne = d.recipeRuns?.[0]?.nodeRuns?.map((nr: any) => `${nr.status || '?'}:${JSON.stringify(nr.error || nr.output || nr.result || {}).slice(0, 300)}`).join(' | ') || ''
        throw new Error((d.error || d.message || 'Generation failed') + (ne ? ' | ' + ne : ''))
      }
    } catch (err: any) {
      if (/timeout|fetch|network/i.test(err.message)) { console.log(`[weavy-grokvid] network error, retrying:`, err.message); continue }
      if (/failed|insufficient|error/i.test(err.message)) throw err
      if (pollCount > 10) throw err
    }
  }
  throw new Error('GrokVideo timeout')
}

export interface WeavyOmniParams {
  token: string
  imageUrl?: string
  imageFile?: File
  prompt: string
  duration?: number
  aspectRatio?: string
}

export interface WeavyOmniResult {
  ok: boolean
  recipeId?: string
  batchId?: string
  error?: string
  raw?: any
}

export async function submitWeavyOmni(params: WeavyOmniParams): Promise<WeavyOmniResult> {
  const { token: refreshToken, imageUrl: fallbackUrl, imageFile, prompt, duration = 8, aspectRatio = '16:9' } = params
  const model = 'google/gemini-omni-flash'
  const mkId = () => Math.random().toString(36).substring(2, 8)
  const n1 = 'n_' + Date.now() + '_prompt'
  const n2 = 'n_' + Date.now() + '_model'
  const n3 = 'n_' + Date.now() + '_img'

  const refreshed = await refreshWeavyAccessToken(refreshToken)
  const at = refreshed?.accessToken || refreshToken

  let imageUrl = fallbackUrl || ''
  if (imageFile && at) {
    try {
      let uploadFile = imageFile
      if (imageFile.size > 8 * 1024 * 1024) {
        uploadFile = await compressImageForWeavy(imageFile, 1280, 0.7)
      } else if (imageFile.size > 4 * 1024 * 1024) {
        uploadFile = await compressImageForWeavy(imageFile, 1280, 0.85)
      }
      const fd = new FormData()
      fd.append('file', uploadFile, uploadFile.name || 'image.jpg')
      if (uploadFile.type) fd.append('type', uploadFile.type)
      const uploadRes = await fetch(`${WEAVY_API}/v1/assets/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${at}` },
        body: fd,
      })
      const uploadText = await uploadRes.text()
      let uploadData: any; try { uploadData = JSON.parse(uploadText) } catch { uploadData = null }
      console.log(`[omni] direct upload → ${uploadRes.status}`, uploadText.slice(0, 300))
      if (uploadRes.ok && uploadData) {
        const result = uploadData.result || uploadData
        if (typeof result === 'string') imageUrl = result
        else if (result.url) imageUrl = result.url
        else if (result.download) imageUrl = result.download
        else if (result.id) imageUrl = `https://media.weavy.ai/image/upload/uploads/${result.id}.jpg`
        console.log(`[omni] Weavy upload URL:`, imageUrl)
      }
    } catch (e: any) {
      console.warn(`[omni] Weavy upload error:`, e.message)
    }
  }

  // Prompt node
  const promptNode = {
    id: n1, type: 'promptV3', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
    data: {
      handles: { input: [], output: { prompt: { type: 'text', order: 0, format: 'text', description: 'Text prompt' } } },
      name: 'Prompt', color: 'Yambo_Green', dark_color: 'Yambo_Green_Dark', border_color: 'Yambo_Green_Stroke',
      params: null, schema: null, version: 3,
      prompt: prompt, result: { prompt },
      displayMode: 'source-value', output: { type: 'text', prompt },
      inputNodes: [], height: 263
    },
    position: { x: 80, y: 200 }, width: 460, height: 263
  }

  // Model node
  const params_: any = { prompt: '', duration: parseInt(String(duration)) || 8, aspect_ratio: aspectRatio || '16:9' }

  const modelNode: any = {
    id: n2, type: 'custommodelV2', dragHandle: '.node-header', owner: null, visibility: 'private', isModel: true,
    data: {
      handles: {
        input: {
          prompt: { id: 'prompt', type: 'text', label: 'prompt', order: 0, format: 'text', required: true },
          image_url: { id: 'image_url', type: 'image', label: 'image', order: 1, format: 'uri', required: false }
        },
        output: { result: { id: 'result', type: 'video', label: 'result', order: 0, format: 'uri' } }
      },
      name: 'Gemini Omni Flash',
      color: 'Red', menu: { icon: 'EmojiObjectsIcon', isModel: true, displayName: 'Gemini Omni Flash' },
      model: { name: model, service: 'fal_imported', version: model },
      params: params_,
      version: 3,
      kind: {
        type: 'wildcard',
        model: { type: 'predefined', name: model, version: model, service: 'fal_imported' },
        inputs: [
          [{ id: 'prompt', title: 'prompt', validTypes: ['text'], required: true }, { nodeId: n1, outputId: 'prompt', string: '' }],
          [{ id: 'image_url', title: 'image', validTypes: ['image'], required: false }, imageUrl ? { nodeId: n3, outputId: 'file' } : null]
        ],
        parameters: [],
        outputs: [{ id: 'result', title: 'result', dataType: 'video' }]
      },
      generations: [], selectedIndex: 0, cameraLocked: false, result: [], output: {}, selectedOutput: 0
    },
    position: { x: 600, y: 100 }, width: 460, height: 560
  }

  const nodes: any[] = [promptNode, modelNode]
  const edges: any[] = [{
    id: 'e-' + mkId(), source: n1, target: n2,
    sourceHandle: `${n1}-output-prompt`, targetHandle: `${n2}-input-prompt`,
    type: 'custom', data: { sourceColor: 'Yambo_Green', targetColor: null, sourceHandleType: 'text', targetHandleType: 'text' }
  }]

  // Image node (optional)
  if (imageUrl) {
    const imgNode = {
      id: n3, type: 'import', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
      data: {
        handles: { output: { file: { type: 'any', label: 'File', order: 0, format: 'uri', description: 'The uploaded file' } } },
        name: 'File', color: 'Yambo_Blue', dark_color: 'Yambo_Blue_Dark', border_color: 'Yambo_Blue_Stroke',
        files: [{ type: 'image', url: imageUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'image.jpg', insertionOrder: 0 }],
        result: { type: 'image', url: imageUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'image.jpg', insertionOrder: 0 },
        output: { file: { type: 'image', url: imageUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'image.jpg', insertionOrder: 0 } },
        version: 3, cameraLocked: false, width: 1024, height: 1024, selectedIndex: 0
      },
      position: { x: 80, y: 500 }, width: 460, height: 556
    }
    nodes.push(imgNode)
    edges.push({
      id: 'e-' + mkId(), source: n3, target: n2,
      sourceHandle: `${n3}-output-file`, targetHandle: `${n2}-input-image_url`,
      type: 'custom', data: { sourceColor: 'Yambo_Blue', targetColor: null, sourceHandleType: 'any', targetHandleType: 'image' }
    })
  }

  const recipeData = { nodes, edges, model }

  const hdrs = { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' } as any

  const retryFetch = async (url: string, opts: any, retries = 3): Promise<Response> => {
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await fetch(url, opts)
        if (r.ok || r.status < 500) return r
        if (i < retries) await new Promise(r => setTimeout(r, 2000 * (i + 1)))
      } catch (e: any) {
        if (i >= retries) throw e
        await new Promise(r => setTimeout(r, 2000 * (i + 1)))
      }
    }
    throw new Error('retry exhausted')
  }

  try {
    const cr = await retryFetch(`${WEAVY_API}/v1/recipes/create`, {
      method: 'POST', headers: hdrs, body: JSON.stringify({ scope: 'PERSONAL' })
    })
    const crText = await cr.text()
    let crData: any; try { crData = JSON.parse(crText) } catch { crData = null }
    console.log(`[omni] create recipe → ${cr.status}`, crText.slice(0, 300))
    if (!cr.ok || !crData) throw new Error(`Create recipe failed (${cr.status}): ${crText.slice(0, 200)}`)
    const rid = crData.id || crData.recipeId

    const sr = await retryFetch(`${WEAVY_API}/v1/recipes/${rid}/save`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ ...recipeData, v3: crData.v3 || '', lastUpdatedAt: new Date().toISOString() })
    })
    const srText = await sr.text()
    console.log(`[omni] save recipe → ${sr.status}`, srText.slice(0, 200))
    if (!sr.ok) throw new Error(`Save recipe failed (${sr.status}): ${srText.slice(0, 200)}`)

    try {
      await fetch(`${WEAVY_API}/v1/workspaces/models/approve`, {
        method: 'POST', headers: hdrs, body: JSON.stringify({ modelIds: [model] })
      })
    } catch {}

    const er = await retryFetch(`${WEAVY_API}/v1/batches/recipes/${rid}/execute`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ numberOfRuns: 1, ...recipeData })
    })
    const et = await er.text()
    let erData: any; try { erData = JSON.parse(et) } catch { erData = null }
    console.log(`[omni] execute → ${er.status}`, et.slice(0, 500))
    if (!er.ok || !erData) throw new Error(`Execute failed (${er.status}): ${et.slice(0, 300)}`)
    const bid = erData.batchId || erData.id
    if (!bid) throw new Error('No batchId: ' + et.slice(0, 200))

    return { ok: true, recipeId: rid, batchId: bid, raw: erData }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function pollWeavyOmniStatus(
  token: string,
  recipeId: string,
  batchId: string,
  onProgress?: (status: string, pct: number) => void,
  timeoutMs = 3600000,
  inputImageUrl?: string,
): Promise<string> {
  const startTime = Date.now()
  let lastLog = ''
  let pollCount = 0

  const refreshed = await refreshWeavyAccessToken(token)
  let at = refreshed?.accessToken || token

  while (Date.now() - startTime < timeoutMs) {
    const delay = pollCount < 30 ? 8000 : pollCount < 60 ? 10000 : 15000
    await new Promise((r) => setTimeout(r, delay))
    pollCount++

    try {
      if (pollCount > 0 && pollCount % 10 === 0) {
        try {
          const r2 = await refreshWeavyAccessToken(token)
          if (r2?.accessToken) at = r2.accessToken
        } catch {}
      }

      const res = await fetch(`${WEAVY_API}/v1/batches/recipes/${recipeId}/batches/${batchId}/status`, {
        headers: { Authorization: `Bearer ${at}` },
      })
      if (!res.ok) continue
      const d = await res.json().catch(() => null)
      if (!d) continue

      const st = (d.recipeRuns?.[0]?.status || d.status || d.state || '').toLowerCase()
      const elapsedSec = Math.round((Date.now() - startTime) / 1000)
      const pct = Math.min(95, Math.round((pollCount / 120) * 95))
      onProgress?.(st || 'processing', pct)

      const logEntry = `poll #${pollCount} (${elapsedSec}s) status=${st} pct=${pct}`
      if (logEntry !== lastLog) { lastLog = logEntry; console.log(`[weavy-omni] ${logEntry}`) }

      if (st === 'completed' || st === 'COMPLETED' || st === 'done' || st === 'success') {
        const videoUrl = extractSoraVideoUrl(d, inputImageUrl)
        if (videoUrl) return videoUrl
        console.log(`[weavy-omni] task done but no url:`, JSON.stringify(d, null, 2).slice(0, 2000))
        throw new Error('Omni: task completed but no video URL found')
      }

      if (st === 'failed' || st === 'FAILED' || st === 'error') {
        const fullResp = JSON.stringify(d).slice(0, 1200)
        console.log(`[weavy-omni] FULL FAILED RESPONSE:`, fullResp)
        const ne = d.recipeRuns?.[0]?.nodeRuns?.map((nr: any) => `${nr.status || '?'}:${JSON.stringify(nr.error || nr.output || nr.result || {}).slice(0, 300)}`).join(' | ') || ''
        throw new Error((d.error || d.message || 'Generation failed') + (ne ? ' | ' + ne : ''))
      }
    } catch (err: any) {
      if (/timeout|fetch|network/i.test(err.message)) { console.log(`[weavy-omni] network error, retrying:`, err.message); continue }
      if (/failed|insufficient|error/i.test(err.message)) throw err
      if (pollCount > 10) throw err
    }
  }
  throw new Error('Omni timeout')
}

export interface WeavySeedanceMiniParams {
  token: string
  imageUrl?: string
  endImageUrl?: string
  imageFile?: File
  endImageFile?: File
  refImageUrls?: string[]
  prompt: string
  duration?: number
  resolution?: string
  aspectRatio?: string
  generateAudio?: boolean
}

export interface WeavySeedanceMiniResult {
  ok: boolean
  recipeId?: string
  batchId?: string
  error?: string
  raw?: any
}

export async function submitWeavySeedanceMini(params: WeavySeedanceMiniParams): Promise<WeavySeedanceMiniResult> {
  const { token: refreshToken, imageUrl: fallbackUrl, endImageUrl, imageFile, endImageFile, refImageUrls, prompt, duration = 10, resolution = '720p', aspectRatio = 'auto', generateAudio = true } = params
  const model = 'bytedance/seedance-2.0/mini/image-to-video'
  const mkId = () => Math.random().toString(36).substring(2, 8)
  const n1 = 'n_' + Date.now() + '_prompt'
  const n2 = 'n_' + Date.now() + '_model'
  const n3 = 'n_' + Date.now() + '_img'
  const n4 = 'n_' + Date.now() + '_endimg'
  const n5 = 'n_' + Date.now() + '_refimg'

  const refreshed = await refreshWeavyAccessToken(refreshToken)
  const at = refreshed?.accessToken || refreshToken

  let imageUrl = fallbackUrl || ''
  if (imageFile && at) {
    try {
      let uploadFile = imageFile
      if (imageFile.size > 8 * 1024 * 1024) {
        uploadFile = await compressImageForWeavy(imageFile, 1280, 0.7)
      } else if (imageFile.size > 4 * 1024 * 1024) {
        uploadFile = await compressImageForWeavy(imageFile, 1280, 0.85)
      }
      const fd = new FormData()
      fd.append('file', uploadFile, uploadFile.name || 'image.jpg')
      if (uploadFile.type) fd.append('type', uploadFile.type)
      const uploadRes = await fetch(`${WEAVY_API}/v1/assets/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${at}` },
        body: fd,
      })
      const uploadText = await uploadRes.text()
      let uploadData: any; try { uploadData = JSON.parse(uploadText) } catch { uploadData = null }
      console.log(`[seedance] direct upload → ${uploadRes.status}`, uploadText.slice(0, 300))
      if (uploadRes.ok && uploadData) {
        const result = uploadData.result || uploadData
        if (typeof result === 'string') imageUrl = result
        else if (result.url) imageUrl = result.url
        else if (result.download) imageUrl = result.download
        else if (result.id) imageUrl = `https://media.weavy.ai/image/upload/uploads/${result.id}.jpg`
        console.log(`[seedance] Weavy upload URL:`, imageUrl)
      }
    } catch (e: any) {
      console.warn(`[seedance] Weavy upload error:`, e.message)
    }
  }

  // End image upload
  let finalEndImageUrl = endImageUrl || ''
  if (endImageFile && at) {
    try {
      let uploadFile = endImageFile
      if (endImageFile.size > 8 * 1024 * 1024) {
        uploadFile = await compressImageForWeavy(endImageFile, 1280, 0.7)
      } else if (endImageFile.size > 4 * 1024 * 1024) {
        uploadFile = await compressImageForWeavy(endImageFile, 1280, 0.85)
      }
      const fd = new FormData()
      fd.append('file', uploadFile, uploadFile.name || 'image.jpg')
      if (uploadFile.type) fd.append('type', uploadFile.type)
      const uploadRes = await fetch(`${WEAVY_API}/v1/assets/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${at}` },
        body: fd,
      })
      const uploadText = await uploadRes.text()
      let uploadData: any; try { uploadData = JSON.parse(uploadText) } catch { uploadData = null }
      console.log(`[seedance] end image upload → ${uploadRes.status}`, uploadText.slice(0, 300))
      if (uploadRes.ok && uploadData) {
        const result = uploadData.result || uploadData
        if (typeof result === 'string') finalEndImageUrl = result
        else if (result.url) finalEndImageUrl = result.url
        else if (result.download) finalEndImageUrl = result.download
        else if (result.id) finalEndImageUrl = `https://media.weavy.ai/image/upload/uploads/${result.id}.jpg`
        console.log(`[seedance] Weavy end image URL:`, finalEndImageUrl)
      }
    } catch (e: any) {
      console.warn(`[seedance] Weavy end image upload error:`, e.message)
    }
  }

  // Prompt node
  const promptNode = {
    id: n1, type: 'promptV3', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
    data: {
      handles: { input: [], output: { prompt: { type: 'text', order: 0, format: 'text', description: 'Text prompt' } } },
      name: 'Prompt', color: 'Yambo_Green', dark_color: 'Yambo_Green_Dark', border_color: 'Yambo_Green_Stroke',
      params: null, schema: null, version: 3,
      prompt: prompt, result: { prompt },
      displayMode: 'source-value', output: { type: 'text', prompt },
      inputNodes: []
    },
    position: { x: 80, y: 200 }, width: 460, height: 407
  }

  // Model node
  const params_: any = {
    prompt: '', duration: parseInt(String(duration)) || 10,
    resolution: resolution || '720p', aspect_ratio: aspectRatio || 'auto',
    generate_audio: generateAudio
  }

  const modelNode: any = {
    id: n2, type: 'custommodelV2', dragHandle: '.node-header', owner: null, visibility: 'private', isModel: true,
    data: {
      handles: {
        input: {
          prompt: { id: 'prompt', type: 'text', label: 'Prompt', order: 0, format: 'text', required: true },
          image_url: { id: 'image_url', type: 'image', label: 'Image', order: 1, format: 'uri', required: false },
          end_image_url: { id: 'end_image_url', type: 'image', label: 'End Image', order: 2, format: 'uri', required: false },
          reference_image_url: { id: 'reference_image_url', type: 'image', label: 'Reference Image', order: 3, format: 'uri', required: false }
        },
        output: { result: { id: 'result', type: 'video', label: 'result', order: 0, format: 'uri' } }
      },
      name: 'Seedance 2.0 Mini',
      color: 'Red', menu: { icon: 'EmojiObjectsIcon', isModel: true, displayName: 'Seedance 2.0 Mini' },
      model: { name: model, service: 'fal_imported', version: model },
      params: params_,
      version: 3,
      kind: {
        type: 'wildcard',
        model: { type: 'predefined', name: model, version: model, service: 'fal_imported' },
        inputs: [
          [{ id: 'prompt', title: 'Prompt', validTypes: ['text'], required: true }, { nodeId: n1, outputId: 'prompt', string: '' }],
          [{ id: 'image_url', title: 'Image', validTypes: ['image'], required: false }, imageUrl ? { nodeId: n3, outputId: 'file' } : null],
          [{ id: 'end_image_url', title: 'End Image', validTypes: ['image'], required: false }, finalEndImageUrl ? { nodeId: n4, outputId: 'file' } : null],
          [{ id: 'reference_image_url', title: 'Reference Image', validTypes: ['image'], required: false }, null]
        ],
        parameters: [],
        outputs: [{ id: 'result', title: 'result', dataType: 'video' }]
      },
      generations: [], selectedIndex: 0, cameraLocked: false, result: [], output: {}, selectedOutput: 0
    },
    position: { x: 600, y: 100 }, width: 460, height: 560
  }

  const nodes: any[] = [promptNode, modelNode]
  const edges: any[] = [{
    id: 'e-' + mkId(), source: n1, target: n2,
    sourceHandle: `${n1}-output-prompt`, targetHandle: `${n2}-input-prompt`,
    type: 'custom', data: { sourceColor: 'Yambo_Green', targetColor: 'Bytedance_Black', sourceHandleType: 'text', targetHandleType: 'text' }
  }]

  // Start image node (optional)
  if (imageUrl) {
    const imgNode = {
      id: n3, type: 'import', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
      data: {
        handles: { output: { file: { type: 'any', label: 'File', order: 0, format: 'uri', description: 'The uploaded file' } } },
        name: 'File', color: 'Yambo_Blue', dark_color: 'Yambo_Blue_Dark', border_color: 'Yambo_Blue_Stroke',
        files: [{ type: 'image', url: imageUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'image.jpg', insertionOrder: 0 }],
        result: { type: 'image', url: imageUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'image.jpg', insertionOrder: 0 },
        output: { file: { type: 'image', url: imageUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'image.jpg', insertionOrder: 0 } },
        version: 3, cameraLocked: false, width: 1024, height: 1024, selectedIndex: 0
      },
      position: { x: 80, y: 500 }, width: 460, height: 556
    }
    nodes.push(imgNode)
    edges.push({
      id: 'e-' + mkId(), source: n3, target: n2,
      sourceHandle: `${n3}-output-file`, targetHandle: `${n2}-input-image_url`,
      type: 'custom', data: { sourceColor: 'Yambo_Blue', targetColor: 'Bytedance_Black', sourceHandleType: 'any', targetHandleType: 'image' }
    })
  }

  // End image node (optional)
  if (finalEndImageUrl) {
    const endImgNode = {
      id: n4, type: 'import', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
      data: {
        handles: { output: { file: { type: 'any', label: 'File', order: 0, format: 'uri', description: 'The uploaded file' } } },
        name: 'File', color: 'Yambo_Blue', dark_color: 'Yambo_Blue_Dark', border_color: 'Yambo_Blue_Stroke',
        files: [{ type: 'image', url: finalEndImageUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'end_image.jpg', insertionOrder: 0 }],
        result: { type: 'image', url: finalEndImageUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'end_image.jpg', insertionOrder: 0 },
        output: { file: { type: 'image', url: finalEndImageUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'end_image.jpg', insertionOrder: 0 } },
        version: 3, cameraLocked: false, width: 1024, height: 1024, selectedIndex: 0
      },
      position: { x: 80, y: 1100 }, width: 460, height: 556
    }
    nodes.push(endImgNode)
    edges.push({
      id: 'e-' + mkId(), source: n4, target: n2,
      sourceHandle: `${n4}-output-file`, targetHandle: `${n2}-input-end_image_url`,
      type: 'custom', data: { sourceColor: 'Yambo_Blue', targetColor: 'Bytedance_Black', sourceHandleType: 'any', targetHandleType: 'image' }
    })
  }

  // Reference image nodes (optional)
  const refUrls = refImageUrls || []
  for (let i = 0; i < refUrls.length; i++) {
    const refUrl = refUrls[i]
    if (!refUrl) continue
    const refNodeId = n5 + '_' + i
    const refImgNode = {
      id: refNodeId, type: 'import', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
      data: {
        handles: { output: { file: { type: 'any', label: 'File', order: 0, format: 'uri', description: 'The uploaded file' } } },
        name: 'File', color: 'Yambo_Blue', dark_color: 'Yambo_Blue_Dark', border_color: 'Yambo_Blue_Stroke',
        files: [{ type: 'image', url: refUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'ref_image.jpg', insertionOrder: 0 }],
        result: { type: 'image', url: refUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'ref_image.jpg', insertionOrder: 0 },
        output: { file: { type: 'image', url: refUrl, publicId: 'uploads/' + mkId(), id: mkId(), name: 'ref_image.jpg', insertionOrder: 0 } },
        version: 3, cameraLocked: false, width: 1024, height: 1024, selectedIndex: 0
      },
      position: { x: 80, y: 1700 + (i * 600) }, width: 460, height: 556
    }
    nodes.push(refImgNode)
    // Update the first reference_image_url input to connect to this node
    const refInput = modelNode.data.kind.inputs[3]
    if (refInput && Array.isArray(refInput) && !refInput[1]) {
      refInput[1] = { nodeId: refNodeId, outputId: 'file' }
    }
    // For additional refs, connect to model as well
    edges.push({
      id: 'e-' + mkId(), source: refNodeId, target: n2,
      sourceHandle: `${refNodeId}-output-file`, targetHandle: `${n2}-input-reference_image_url`,
      type: 'custom', data: { sourceColor: 'Yambo_Blue', targetColor: 'Bytedance_Black', sourceHandleType: 'any', targetHandleType: 'image' }
    })
  }

  const recipeData = { nodes, edges, model }

  const hdrs = { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' } as any

  const retryFetch = async (url: string, opts: any, retries = 3): Promise<Response> => {
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await fetch(url, opts)
        if (r.ok || r.status < 500) return r
        if (i < retries) await new Promise(r => setTimeout(r, 2000 * (i + 1)))
      } catch (e: any) {
        if (i >= retries) throw e
        await new Promise(r => setTimeout(r, 2000 * (i + 1)))
      }
    }
    throw new Error('retry exhausted')
  }

  try {
    const cr = await retryFetch(`${WEAVY_API}/v1/recipes/create`, {
      method: 'POST', headers: hdrs, body: JSON.stringify({ scope: 'PERSONAL' })
    })
    const crText = await cr.text()
    let crData: any; try { crData = JSON.parse(crText) } catch { crData = null }
    console.log(`[seedance] create recipe → ${cr.status}`, crText.slice(0, 300))
    if (!cr.ok || !crData) throw new Error(`Create recipe failed (${cr.status}): ${crText.slice(0, 200)}`)
    const rid = crData.id || crData.recipeId

    const sr = await retryFetch(`${WEAVY_API}/v1/recipes/${rid}/save`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ ...recipeData, v3: crData.v3 || '', lastUpdatedAt: new Date().toISOString() })
    })
    const srText = await sr.text()
    console.log(`[seedance] save recipe → ${sr.status}`, srText.slice(0, 200))
    if (!sr.ok) throw new Error(`Save recipe failed (${sr.status}): ${srText.slice(0, 200)}`)

    try {
      await fetch(`${WEAVY_API}/v1/workspaces/models/approve`, {
        method: 'POST', headers: hdrs, body: JSON.stringify({ modelIds: [model] })
      })
    } catch {}

    const er = await retryFetch(`${WEAVY_API}/v1/batches/recipes/${rid}/execute`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ numberOfRuns: 1, ...recipeData })
    })
    const et = await er.text()
    let erData: any; try { erData = JSON.parse(et) } catch { erData = null }
    console.log(`[seedance] execute → ${er.status}`, et.slice(0, 500))
    if (!er.ok || !erData) throw new Error(`Execute failed (${er.status}): ${et.slice(0, 300)}`)
    const bid = erData.batchId || erData.id
    if (!bid) throw new Error('No batchId: ' + et.slice(0, 200))

    return { ok: true, recipeId: rid, batchId: bid, raw: erData }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function pollWeavySeedanceMiniStatus(
  token: string,
  recipeId: string,
  batchId: string,
  onProgress?: (status: string, pct: number) => void,
  timeoutMs = 3600000,
  inputImageUrl?: string,
): Promise<string> {
  const startTime = Date.now()
  let lastLog = ''
  let pollCount = 0

  const refreshed = await refreshWeavyAccessToken(token)
  let at = refreshed?.accessToken || token

  while (Date.now() - startTime < timeoutMs) {
    const delay = pollCount < 30 ? 8000 : pollCount < 60 ? 10000 : 15000
    await new Promise((r) => setTimeout(r, delay))
    pollCount++

    try {
      if (pollCount > 0 && pollCount % 10 === 0) {
        try {
          const r2 = await refreshWeavyAccessToken(token)
          if (r2?.accessToken) at = r2.accessToken
        } catch {}
      }

      const res = await fetch(`${WEAVY_API}/v1/batches/recipes/${recipeId}/batches/${batchId}/status`, {
        headers: { Authorization: `Bearer ${at}` },
      })
      if (!res.ok) continue
      const d = await res.json().catch(() => null)
      if (!d) continue

      const st = (d.recipeRuns?.[0]?.status || d.status || d.state || '').toLowerCase()
      const elapsedSec = Math.round((Date.now() - startTime) / 1000)
      const pct = Math.min(95, Math.round((pollCount / 120) * 95))
      onProgress?.(st || 'processing', pct)

      const logEntry = `poll #${pollCount} (${elapsedSec}s) status=${st} pct=${pct}`
      if (logEntry !== lastLog) { lastLog = logEntry; console.log(`[weavy-seedance] ${logEntry}`) }

      if (st === 'completed' || st === 'COMPLETED' || st === 'done' || st === 'success') {
        const videoUrl = extractSoraVideoUrl(d, inputImageUrl)
        if (videoUrl) return videoUrl
        console.log(`[weavy-seedance] task done but no url:`, JSON.stringify(d, null, 2).slice(0, 2000))
        throw new Error('SeedanceMini: task completed but no video URL found')
      }

      if (st === 'failed' || st === 'FAILED' || st === 'error') {
        const fullResp = JSON.stringify(d).slice(0, 1200)
        console.log(`[weavy-seedance] FULL FAILED RESPONSE:`, fullResp)
        const ne = d.recipeRuns?.[0]?.nodeRuns?.map((nr: any) => `${nr.status || '?'}:${JSON.stringify(nr.error || nr.output || nr.result || {}).slice(0, 300)}`).join(' | ') || ''
        throw new Error((d.error || d.message || 'Generation failed') + (ne ? ' | ' + ne : ''))
      }
    } catch (err: any) {
      if (/timeout|fetch|network/i.test(err.message)) { console.log(`[weavy-seedance] network error, retrying:`, err.message); continue }
      if (/failed|insufficient|error/i.test(err.message)) throw err
      if (pollCount > 10) throw err
    }
  }
  throw new Error('SeedanceMini timeout')
}

export interface WeavyImageGenerateParams { token: string; model: string; prompt: string; aspectRatio?: string; negativePrompt?: string; quality?: string; imageUrl?: string; imageUrls?: string[]; maskUrl?: string }
export interface WeavyImageGenerateResult { ok: boolean; taskId?: string; error?: string; raw?: any; charUrl?: string; outfitUrl?: string }

export async function submitWeavyImage(params: WeavyImageGenerateParams): Promise<WeavyImageGenerateResult> {
  const { token, model, prompt, aspectRatio = '1:1', quality, imageUrl, imageUrls, maskUrl } = params
  try {
    // Step 1: Create recipe via proxy
    const createRes = await fetch(WEAVY_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Weavy-Token': token }, body: JSON.stringify({ action: 'image-create-recipe' }) })
    const createData = await createRes.json().catch(() => null)
    if (!createRes.ok || !createData?.ok) return { ok: false, error: createData?.error || `Create recipe failed (${createRes.status})`, raw: createData }
    const recipeId = createData?.data?.recipeId
    const v3 = createData?.data?.v3
    if (!recipeId) return { ok: false, error: 'No recipeId returned', raw: createData }

    // Step 2: Build nodes + edges
    const nodes = buildImageNode(model, prompt.trim(), quality || 'high', aspectRatio || '1:1', imageUrl, maskUrl, imageUrls)
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

export async function runWeavyImage(opts: { model: string; prompt: string; aspectRatio?: string; quality?: string; negativePrompt?: string; imageUrl?: string; imageUrls?: string[]; maskUrl?: string; onProgress?: (text: string, pct?: number) => void; onRotate?: (index: number, total: number, reason: string) => void }): Promise<string> {
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
    const submitResult = await submitWeavyImage({ token: apiKey, model: modelKey, prompt: opts.prompt, aspectRatio: opts.aspectRatio, negativePrompt: opts.negativePrompt, quality: opts.quality, imageUrl: opts.imageUrl, imageUrls: opts.imageUrls, maskUrl: opts.maskUrl })
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

export interface WeavyMotionControlParams {
  modelKey: string
  imageUrl: string
  videoUrl: string
  orientation?: 'video' | 'image'
  keepSound?: boolean
  prompt?: string
  accessToken?: string
  onProgress?: (status: string, pct?: number) => void
}

export interface WeavyMotionControlResult {
  ok: boolean
  videoUrl?: string
  error?: string
}

function buildWeavyMotionNodes(params: {
  imageUrl: string
  videoUrl: string
  orientation: string
  keepSound: boolean
  modelKey: string
  prompt?: string
}): { nodes: any[]; edges: any[]; modelId: string } {
  const isPro = /\/pro\//i.test(params.modelKey)
  const isV3 = /v3/i.test(params.modelKey)
  const model = isPro ? 'Pro' : 'Standard'
  const version = isV3 ? 'V3' : 'V2.6'
  const modelId = 'fal-ai/kling-Video/v2.6/standard/motion-control'

  const now = Date.now()
  const uid = () => Math.random().toString(36).substring(2, 8)
  const imgNodeId = `n_${now}_img`
  const vidNodeId = `n_${now}_vid`
  const modelNodeId = `n_${now}_mdl`

  const imgNode = {
    id: imgNodeId, type: 'import', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
    data: {
      handles: { output: { file: { type: 'any', label: 'File', order: 0, format: 'uri', description: 'The uploaded file' } } },
      name: 'File', description: null, color: 'Yambo_Blue', dark_color: 'Yambo_Blue_Dark', border_color: 'Yambo_Blue_Stroke',
      files: [{ type: 'image', url: params.imageUrl, publicId: 'uploads/' + uid(), id: uid(), name: 'image.jpg', insertionOrder: 0 }],
      cameraLocked: false, selectedIndex: 0,
      result: { type: 'image', url: params.imageUrl, publicId: 'uploads/' + uid(), id: uid(), name: 'image.jpg', insertionOrder: 0 },
      output: { file: { type: 'image', url: params.imageUrl, publicId: 'uploads/' + uid(), id: uid(), name: 'image.jpg', insertionOrder: 0 } },
      version: 3,
    },
    position: { x: 80, y: 200 }, width: 460, height: 400,
  }

  const vidNode = {
    id: vidNodeId, type: 'import', dragHandle: '.node-header', owner: null, visibility: null, isModel: false,
    data: {
      handles: { output: { file: { type: 'any', label: 'File', order: 0, format: 'uri', description: 'The uploaded file' } } },
      name: 'File', description: null, color: 'Yambo_Blue', dark_color: 'Yambo_Blue_Dark', border_color: 'Yambo_Blue_Stroke',
      files: [{ type: 'video', url: params.videoUrl, publicId: 'uploads/' + uid(), id: uid(), name: 'video.mp4', insertionOrder: 0 }],
      cameraLocked: false, selectedIndex: 0,
      result: { type: 'video', url: params.videoUrl, publicId: 'uploads/' + uid(), id: uid(), name: 'video.mp4', insertionOrder: 0 },
      output: { file: { type: 'video', url: params.videoUrl, publicId: 'uploads/' + uid(), id: uid(), name: 'video.mp4', insertionOrder: 0 } },
      version: 3,
    },
    position: { x: 80, y: 650 }, width: 460, height: 400,
  }

  const modelParams: any = { model, version, keep_original_sound: params.keepSound, character_orientation: params.orientation }
  if (params.prompt) modelParams.prompt = params.prompt

  const modelNode = {
    id: modelNodeId, type: 'custommodelV2', dragHandle: '.node-header', owner: null, visibility: 'private', isModel: true,
    data: {
      handles: {
        input: {
          prompt: { id: 'input-prompt', type: 'text', label: 'prompt', format: 'text', required: false },
          image_url: { id: 'input-image_url', type: 'image', label: 'image', format: 'text', required: true },
          video_url: { id: 'input-video_url', type: 'any', label: 'video', format: 'text', required: true },
        },
        output: { result: { id: 'output-result', type: 'video', label: 'result', order: 0, format: 'uri' } },
      },
      name: 'Kling Motion Control', description: 'Transfer movements from a reference video to any character image.',
      color: 'Red',
      menu: { icon: 'EmojiObjectsIcon', isModel: true, displayName: 'Kling Motion Control' },
      model: { name: modelId, service: 'fal_imported', version: modelId },
      params: modelParams,
      schema: {
        model: { type: 'enum', order: 0, title: 'Model', default: 'Pro', options: ['Pro', 'Standard'] },
        prompt: { type: 'string', title: 'Prompt', required: false },
        version: { type: 'enum', order: -1, title: 'Version', default: 'V2.6', options: ['V2.6', 'V3'] },
        keep_original_sound: { type: 'boolean', title: 'Keep Original Sound', default: true, required: false },
        character_orientation: { type: 'enum', title: 'Character Orientation', options: ['image', 'video'], required: true },
      },
      version: 3,
      kind: {
        type: 'wildcard',
        model: { type: 'predefined', name: modelId, version: modelId, service: 'fal_imported', description: 'Transfer movements from a reference video to any character image.' },
        inputs: [
          [{ id: 'prompt', title: 'Prompt', validTypes: ['text'], required: false }, null],
          [{ id: 'image_url', title: 'image', validTypes: ['image'], required: true }, { nodeId: imgNodeId, outputId: 'file' }],
          [{ id: 'video_url', title: 'video', validTypes: ['image', 'video', 'audio', '3D', 'text', 'number', 'boolean', 'seed', 'array', 'lora', 'kling-element', 'runway-aleph2-keyframe'], required: true }, { nodeId: vidNodeId, outputId: 'file' }],
        ],
        parameters: [
          [{ id: 'version', title: 'Version', description: 'Kling Motion Control version', constraint: { type: 'enum', options: ['V2.6', 'V3'] }, defaultValue: { type: 'string', value: 'V2.6' } }, { type: 'value', data: { type: 'string', value: version } }],
          [{ id: 'model', title: 'Model', description: 'Kling Motion Control type', constraint: { type: 'enum', options: ['Pro', 'Standard'] }, defaultValue: { type: 'string', value: 'Pro' } }, { type: 'value', data: { type: 'string', value: model } }],
          [{ id: 'keep_original_sound', title: 'Keep Original Sound', description: 'Whether to keep the original sound from the reference video.', constraint: { type: 'boolean' }, defaultValue: { type: 'boolean', value: true } }, { type: 'value', data: { type: 'boolean', value: params.keepSound } }],
          [{ id: 'character_orientation', title: 'Character Orientation', description: "Controls whether the output character's orientation matches the reference image or video.", constraint: { type: 'enum', options: ['image', 'video'] }, defaultValue: { type: 'string', value: 'image' } }, { type: 'value', data: { type: 'string', value: params.orientation } }],
        ],
        outputs: [{ id: 'result', title: 'result', description: 'Result video' }],
      },
      generations: [], selectedIndex: 0, cameraLocked: false, result: [], output: {}, selectedOutput: 0,
    },
    position: { x: 600, y: 400 }, width: 460, height: 560,
  }

  const edges = [
    {
      id: 'e-' + uid(), source: imgNodeId, target: modelNodeId,
      sourceHandle: `${imgNodeId}-output-file`, targetHandle: `${modelNodeId}-input-image_url`,
      type: 'custom', data: { sourceColor: 'Yambo_Blue', targetColor: 'Red', sourceHandleType: 'any', targetHandleType: 'image' },
    },
    {
      id: 'e-' + uid(), source: vidNodeId, target: modelNodeId,
      sourceHandle: `${vidNodeId}-output-file`, targetHandle: `${modelNodeId}-input-video_url`,
      type: 'custom', data: { sourceColor: 'Yambo_Blue', targetColor: 'Red', sourceHandleType: 'any', targetHandleType: 'video' },
    },
  ]

  return { nodes: [imgNode, vidNode, modelNode], edges, modelId }
}

async function createWeavyRecipe(accessToken: string): Promise<{ id: string; v3?: string }> {
  const res = await fetch(`${WEAVY_API}/v1/recipes/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ scope: 'PERSONAL' }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw Error(`Create recipe failed (${res.status})`)
  const data = await res.json()
  return { id: data?.id || data?.recipeId, v3: data?.v3 }
}

async function saveWeavyRecipe(recipeId: string, nodes: any[], edges: any[], v3: string, accessToken: string): Promise<void> {
  const res = await fetch(`${WEAVY_API}/v1/recipes/${recipeId}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ nodes, edges, v3: v3 || '', lastUpdatedAt: new Date().toISOString() }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw Error(`Save recipe failed (${res.status}): ${text.substring(0, 200)}`)
  }
}

async function approveWeavyModel(modelId: string, accessToken: string): Promise<void> {
  try {
    await fetch(`${WEAVY_API}/v1/workspaces/models/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ modelIds: [modelId] }),
      signal: AbortSignal.timeout(10000),
    })
  } catch {}
}

async function executeWeavyBatch(recipeId: string, nodes: any[], edges: any[], accessToken: string, model?: string): Promise<{ batchId: string }> {
  const body: any = { numberOfRuns: 1, nodes, edges }
  if (model) body.model = model
  const res = await fetch(`${WEAVY_API}/v1/batches/recipes/${recipeId}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  if (!res.ok) throw Error(`Execute failed (${res.status}): ${text.substring(0, 200)}`)
  const data = JSON.parse(text)
  const batchId = data?.batchId || data?.id
  if (!batchId) throw Error('No batchId returned')
  return { batchId }
}

async function pollWeavyBatchVideo(recipeId: string, batchId: string, accessToken: string, opts?: {
  inputVideoUrl?: string
  onProgress?: (info: { attempt: number; status: string }) => void
  maxAttempts?: number
}): Promise<string | null> {
  const maxAttempts = opts?.maxAttempts ?? 180
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const waitMs = attempt < 30 ? 8000 : attempt < 60 ? 10000 : 15000
    await new Promise(r => setTimeout(r, waitMs))
    try {
      const res = await fetch(`${WEAVY_API}/v1/batches/recipes/${recipeId}/batches/${batchId}/status`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) continue
      const data = await res.json().catch(() => ({}))
      const recipeRun = data?.recipeRuns?.[0]
      const status = String(recipeRun?.status || data?.status || data?.state || 'unknown')

      opts?.onProgress?.({ attempt: attempt + 1, status })

      if (['completed', 'COMPLETED', 'done', 'success'].includes(status)) {
        // Extract from nodeRuns (matching production exactly)
        if (recipeRun?.nodeRuns) {
          for (let i = recipeRun.nodeRuns.length - 1; i >= 0; i--) {
            const nodeRun = recipeRun.nodeRuns[i]
            const result = nodeRun.result
            const results = Array.isArray(result) ? result : [result]
            const urls = results
              .map((r: any) => [r?.url, r?.video_url, nodeRun.output?.file?.url, nodeRun.output?.video_url, nodeRun.output?.url, ...(nodeRun.generations || []).map((g: any) => g.url || g.video_url)].filter(Boolean))
              .flat()
              .filter((u: string) => typeof u === 'string' && u.includes('.mp4') && !u.includes('/video/upload/v1781970233/') && u !== opts?.inputVideoUrl)
            if (urls.length > 0) return urls[0]
          }
        }
        // Fallback to direct output
        return data?.output?.video_url || data?.output?.url || data?.video_url || data?.url || null
      }

      if (['failed', 'FAILED', 'error', 'ERROR'].includes(status)) {
        const nodeErrors = (recipeRun?.nodeRuns || []).map((nr: any) => nr.error || nr.errorMessage).filter(Boolean).join(' | ')
        throw Error((data?.error || data?.message || 'Weavy generation failed') + (nodeErrors ? ` | ${nodeErrors}` : ''))
      }
    } catch (err: any) {
      if (err.message?.includes('Weavy generation failed') || err.message?.includes('failed |') || attempt > 10) throw err
    }
  }
  throw Error('Weavy timeout: generation took too long')
}

export async function submitWeavyMotionControl(params: WeavyMotionControlParams): Promise<WeavyMotionControlResult> {
  const { modelKey, imageUrl, videoUrl, orientation = 'video', keepSound = true, prompt, accessToken: providedToken, onProgress } = params

  // Use provided token or resolve from providerManager store
  let currentAccessToken = providedToken || ''
  let currentTokenId = ''
  if (!providedToken) {
    const tokenInfo = await selectWeavyTokenForCredits(0)
    if (!tokenInfo) throw Error('Tidak ada Weavy token aktif. Tambahkan token di Providers.')
    currentAccessToken = tokenInfo.accessToken
    currentTokenId = tokenInfo.token.id
  }

  const MAX_ATTEMPTS = 8
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      onProgress?.(`Building recipe (attempt ${attempt})...`)

      const { nodes, edges, modelId } = buildWeavyMotionNodes({ imageUrl, videoUrl, orientation, keepSound, modelKey, prompt })

      // Step 1: Create recipe
      const recipe = await createWeavyRecipe(currentAccessToken)
      onProgress?.(`Recipe created: ${recipe.id}`)

      // Step 2: Save recipe
      await saveWeavyRecipe(recipe.id, nodes, edges, recipe.v3 || '', currentAccessToken)

      // Step 3: Approve model
      await approveWeavyModel(modelId, currentAccessToken)

      // Step 4: Execute batch
      const { batchId } = await executeWeavyBatch(recipe.id, nodes, edges, currentAccessToken)
      onProgress?.(`Batch started: ${batchId}`)

      // Step 5: Poll for result
      const resultUrl = await pollWeavyBatchVideo(recipe.id, batchId, currentAccessToken, {
        inputVideoUrl: videoUrl,
        onProgress: (info) => onProgress?.(`Poll #${info.attempt}: ${info.status}`),
      })

      if (!resultUrl) throw Error('Weavy: no output URL after polling')
      return { ok: true, videoUrl: resultUrl }
    } catch (err: any) {
      const msg = err.message || String(err)
      if (/credit|balance|402|403|unauth/i.test(msg)) {
        const rotated = await rotateWeavyToken(currentTokenId)
        if (rotated) {
          currentAccessToken = rotated.accessToken
          currentTokenId = rotated.id
          continue
        }
      }
      if (attempt >= MAX_ATTEMPTS) return { ok: false, error: msg }
      await new Promise(r => setTimeout(r, 2000 * attempt))
    }
  }
  return { ok: false, error: 'Weavy: max attempts exhausted' }
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
  const accessToken = await getWeavyAccessToken(token)
  try {
    const { id: recipeId, v3 } = await createWeavyRecipe(accessToken)
    const { nodes, edges, model } = buildTopazUpscaleNodes(imageUrl, settings)
    await saveWeavyRecipe(recipeId, nodes, edges, v3 || '', accessToken)
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
  const accessToken = await getWeavyAccessToken(token)

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