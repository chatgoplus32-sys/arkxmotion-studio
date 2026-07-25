const ROBONEO_BASE = '/roboneo'

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 3) | 8).toString(16)
  })
}

function randomHex(len = 16) {
  return Array.from({ length: len }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
}

function generateGnum() {
  const a = randomHex(16)
  return `${a}-${randomHex(12)}-${randomHex(8)}-${randomHex(7)}-${randomHex(17)}`
}

function generateClientId() {
  return String(Math.floor(1000000000 + Math.random() * 9000000000))
}

function generateRoomId() {
  const e = Math.floor(Math.random() * 1e10).toString()
  return `${btoa(e).replace(/=/g, '')}-${Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}-${Date.now()}`
}

function extractUid(token: string): string {
  try {
    let t = token.replace(/^_v\d+/, '')
    t += '='.repeat((4 - (t.length % 4)) % 4)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = (typeof atob === 'function' ? atob(t) : (globalThis as any).Buffer?.from(t, 'base64').toString('binary') ?? atob(t)).split('#')[2]
    if (payload && /^\d+$/.test(payload)) return payload
  } catch {}
  return '0'
}

export async function uploadToCatbox(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file, file.name || 'upload.bin')

  const res = await fetch('/api/public/upload-catbox', {
    method: 'POST',
    body: formData,
  })

  const json = await res.json().catch(() => null)
  const data = json?.data ?? json

  if (!res.ok || !data?.url) {
    throw new Error(data?.error || `Upload gagal (${res.status})`)
  }

  return data.url
}

function buildTrackingParams(accessToken: string, pathScene: string, roomId: string) {
  return {
    token: '45C30555F10E49629098A75F95828DA6',
    gid: generateGnum(),
    uid: extractUid(accessToken),
    trace_id: uuid(),
    client_id: '1189857684',
    app_scene: 'roboneo',
    area_code: 'ID',
    lang: 'en',
    time_zone: 'Asia/Jakarta',
    tt_ttclid: '',
    tt_ttp: '',
    first_url: 'https://www.roboneo.com/home',
    page_url: 'https://www.roboneo.com/ai_flow',
    referrer: 'https://www.roboneo.com/home',
    pixel_ready: 1,
    extra: { big_data_patch: { position_type: '/ai_flow' } },
    path_scene: pathScene,
    room_id: roomId,
    _access_token: accessToken,
  }
}

async function roboneoApiCall(
  accessToken: string,
  path: string,
  parameter: Record<string, any>
): Promise<any> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const body = JSON.stringify({ path, parameter })
      console.log(`[roboneo] POST /api/public/roboneo → path=${path} (attempt ${attempt})`)

      const res = await fetch('/api/public/roboneo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Roboneo-Token': accessToken,
        },
        body,
      })

      const proxyResp = await res.json().catch(() => null)
      console.log(`[roboneo] proxy response:`, JSON.stringify(proxyResp).slice(0, 500))

      if (!proxyResp || proxyResp.ok === false) {
        const errMsg = proxyResp?.error || `Proxy error`
        if (attempt < 5) {
          await new Promise((r) => setTimeout(r, 1500 * attempt))
          continue
        }
        throw new Error(`Roboneo ${path}: ${errMsg}`)
      }

      const data = proxyResp.data
      if (!data) {
        if (attempt < 5) {
          await new Promise((r) => setTimeout(r, 1500 * attempt))
          continue
        }
        throw new Error(`Roboneo ${path}: empty response`)
      }

      if (data.error_code && data.error_code !== 0) {
        throw new Error(`Roboneo ${path}: ${data.error_msg || 'error_code=' + data.error_code}`)
      }

      return data
    } catch (err: any) {
      lastError = err
      if (/network|fetch|Failed to fetch/i.test(err.message) && attempt < 5) {
        await new Promise((r) => setTimeout(r, 1500 * attempt))
        continue
      }
      throw err
    }
  }

  throw lastError || new Error(`Roboneo ${path}: max retries`)
}

export async function checkRoboneoBalance(accessToken: string): Promise<{ ok: boolean; balance?: number | null; error?: string }> {
  try {
    const tracking = buildTrackingParams(accessToken, 'vipshow', generateRoomId())
    const { _access_token, ...paramWithoutToken } = tracking

    const body = JSON.stringify({
      path: 'vipshow',
      parameter: {
        ...paramWithoutToken,
        features: '',
        later_face: 0,
      },
    })

    const res = await fetch('/api/public/roboneo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Roboneo-Token': accessToken },
      body,
    })

    const proxyResp = await res.json().catch(() => null)
    const data = proxyResp?.data
    if (!data || data.error_code !== 0) {
      return { ok: false, error: data?.error_msg || `error_code=${data?.error_code}` }
    }

    const param = data.parameter || data
    const balanceKeys = ['credit', 'balance', 'remain', 'quota', 'point', 'coin', 'energy']
    let balance: number | null = null

    function findBalance(obj: any, depth = 0): number | null {
      if (depth > 5 || !obj || typeof obj !== 'object') return null
      for (const [k, v] of Object.entries(obj)) {
        const kl = k.toLowerCase()
        if (typeof v === 'number' && balanceKeys.some((bk) => kl.includes(bk))) return v
        if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) && balanceKeys.some((bk) => kl.includes(bk))) return Number(v)
        if (typeof v === 'object' && v !== null) {
          const found = findBalance(v, depth + 1)
          if (found !== null) return found
        }
      }
      return null
    }

    balance = findBalance(param)
    return { ok: true, balance }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function submitMotionControl(params: {
  accessToken: string
  imageUrl: string
  videoUrl: string
  prompt?: string
  quality?: string
}): Promise<{ taskId: string; roomId: string }> {
  const { accessToken, imageUrl, videoUrl, prompt = '', quality = 'std' } = params

  const roomId = generateRoomId()
  const nodeId = uuid()

  const node = {
    tool_abstract_name: { cn: 'Motion Control', en: 'Motion Control' },
    node_id: nodeId,
    name: 'video_bonbon_motioncontrol_v26',
    parameters: {
      quality,
      image_url: imageUrl,
      video_url: videoUrl,
      prompt: prompt || '',
      random: `${Date.now()}-${Math.floor(1e7 + Math.random() * 89999999)}`,
    },
  }

  const tracking = buildTrackingParams(accessToken, 'nodeexecute', roomId)
  const { _access_token, ...paramWithoutToken } = tracking

  const parameter = {
    ...paramWithoutToken,
    room_id: roomId,
    node_id: nodeId,
    need_node_name: true,
    workflow_version: 'v2',
    node_list_array: [[node]],
  }

  const result = await roboneoApiCall(accessToken, 'nodeexecute', parameter)

  // Vercel x() returns data.parameter, so unwrap if nested
  const payload = result?.parameter ?? result

  const taskIds: string[] = payload?.task_ids?.length
    ? payload.task_ids
    : Array.isArray(payload?.tasks)
    ? payload.tasks.map((t: any) => t.task_id).filter(Boolean)
    : Object.keys(payload?.tasks || {})

  if (!taskIds.length) {
    throw new Error('Roboneo: submit sukses tapi task_id tidak ditemukan. Response: ' + JSON.stringify(payload).slice(0, 300))
  }

  return { taskId: taskIds[0], roomId }
}

function extractVideoUrl(data: any): string | null {
  if (!data || typeof data !== 'object') return null

  function findUrls(obj: any, depth = 0): string[] {
    if (depth > 8 || !obj || typeof obj !== 'object') return []
    const urls: string[] = []

    if (Array.isArray(obj)) {
      for (const item of obj) urls.push(...findUrls(item, depth + 1))
      return urls
    }

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
        urls.push(value)
      }
      if (typeof value === 'object' && value !== null) {
        urls.push(...findUrls(value, depth + 1))
      }
    }
    return urls
  }

  const allUrls = findUrls(data)
  const videoExt = /\.(mp4|mov|webm|m4v|avi)(\?|#|$)/i
  return allUrls.find((u) => videoExt.test(u)) || allUrls[0] || null
}

function extractProgress(data: any, depth = 0): number | null {
  if (depth > 6 || !data || typeof data !== 'object') return null

  const progressKeys = ['progress', 'percent', 'rate', 'schedule', 'process']

  for (const [key, value] of Object.entries(data)) {
    const k = key.toLowerCase()
    if (progressKeys.some((pk) => k.includes(pk))) {
      const num = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN
      if (Number.isFinite(num)) {
        const pct = num <= 1 ? num * 100 : num
        if (pct >= 0 && pct <= 100) return pct
      }
    }
  }

  for (const value of Object.values(data)) {
    const pct = extractProgress(value, depth + 1)
    if (pct !== null) return pct
  }

  return null
}

export async function pollMotionControl(
  accessToken: string,
  taskId: string,
  roomId: string,
  onProgress?: (status: string, pct: number) => void,
  timeoutMs = 1800000
): Promise<string> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, 4000))

    let result: any
    try {
      const tracking = buildTrackingParams(accessToken, 'nodeexecutequery', roomId)
      const { _access_token, ...paramWithoutToken } = tracking

      result = await roboneoApiCall(accessToken, 'nodeexecutequery', {
        ...paramWithoutToken,
        task_ids: [taskId],
        room_id: roomId,
      })
    } catch (err: any) {
      if (/HTTP (502|503|504|429)|upstream|network/i.test(err.message)) {
        continue
      }
      throw err
    }

    const payload = result?.parameter ?? result
    console.log(`[roboneo] poll FULL response:`, JSON.stringify(result).slice(0, 3000))
    console.log(`[roboneo] poll payload keys:`, Object.keys(payload || {}))

    const tasks = payload?.tasks
    let task: any = null
    let foundTaskId = ''

    if (tasks && typeof tasks === 'object') {
      if (Array.isArray(tasks)) {
        task = tasks.find((t: any) => t.task_id === taskId || t.id === taskId) || tasks[0]
        foundTaskId = task?.task_id || task?.id || ''
      } else {
        task = tasks[taskId] || Object.values(tasks)[0]
        foundTaskId = taskId
      }
    }
    console.log(`[roboneo] poll task (${foundTaskId}):`, JSON.stringify(task).slice(0, 2000))

    const steps = Array.isArray(task?.steps) ? task.steps : []
    const succeededStep = steps.find((s: any) =>
      /success|succeeded|completed|done|finished/i.test(String(s.status || s.state || ''))
    ) || steps[0]

    const status = String(task?.status || task?.state || succeededStep?.status || succeededStep?.state || '').toLowerCase()
    const realPct = extractProgress(task) ?? extractProgress(payload)
    const elapsed = (Date.now() - startTime) / (8 * 60000)
    const fallbackPct = Math.min(94, 1 - 1 / (1 + elapsed * 1.6))
    const pct = realPct === null ? Math.round(5 + fallbackPct * 89) : Math.round(realPct)

    onProgress?.(status || 'processing', pct)

    const mediaInfo = task?.media_info_list?.[0] || payload?.media_info_list?.[0]
    const isDone = ['success', 'succeeded', 'completed', 'done', 'finished'].includes(status)

    if (isDone) {
      const videoUrl =
        extractVideoUrl(task?.last_image_url) ||
        extractVideoUrl(task?.last_image_urls) ||
        extractVideoUrl(task?.output?.video_url) ||
        extractVideoUrl(task?.output?.url) ||
        extractVideoUrl(task?.initial_transferred_urls) ||
        extractVideoUrl(task?.media_meta) ||
        extractVideoUrl(task?.result) ||
        extractVideoUrl(mediaInfo?.url) ||
        extractVideoUrl(mediaInfo?.media_url) ||
        extractVideoUrl(steps.map((s: any) => s.output)) ||
        extractVideoUrl(steps.map((s: any) => s.result)) ||
        extractVideoUrl(payload?.output) ||
        extractVideoUrl(payload?.result) ||
        extractVideoUrl(payload)

      console.log(`[roboneo] done extraction result: ${videoUrl}`)

      if (videoUrl) return videoUrl

      console.log(`[roboneo] task full:`, JSON.stringify(task))
      console.log(`[roboneo] payload full:`, JSON.stringify(payload).slice(0, 3000))
      throw new Error('Roboneo: task selesai tapi URL output tidak ditemukan')
    }

    if (['fail', 'failed', 'error', 'cancelled', 'canceled'].includes(status)) {
      const errMsg =
        task.error_message ||
        task.error_msg ||
        succeededStep?.error_message ||
        succeededStep?.error_msg ||
        'unknown'
      throw new Error(`Roboneo failed: ${errMsg}`)
    }
  }

  throw new Error('Roboneo timeout')
}

export function isRoboneoTokenError(msg: string): boolean {
  return /token|auth|log\s*in|login|expired|unauth|401|403/i.test(msg)
}

export function parseAccessToken(raw: string): string {
  return raw.trim()
}
