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

export async function compressVideo(file: File, maxMB = 20): Promise<File> {
  if (file.size <= maxMB * 1024 * 1024) return file
  if (typeof MediaRecorder === 'undefined') return file

  console.log(`[upload] video ${(file.size / 1024 / 1024).toFixed(1)}MB > ${maxMB}MB, compressing...`)

  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'metadata'
    video.src = URL.createObjectURL(file)

    let recorder: MediaRecorder | null = null

    video.onloadedmetadata = () => {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')!

      const stream = canvas.captureStream(24)
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm'
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000 })
      const chunks: Blob[] = []

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType })
        const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '.webm'), { type: mimeType })
        console.log(`[upload] compressed ${(file.size / 1024 / 1024).toFixed(1)}MB → ${(compressed.size / 1024 / 1024).toFixed(1)}MB`)
        URL.revokeObjectURL(video.src)
        resolve(compressed.size < file.size ? compressed : file)
      }

      recorder.start()
      video.play()

      const drawFrame = () => {
        if (video.ended || video.paused || !recorder || recorder.state !== 'recording') return
        ctx.drawImage(video, 0, 0)
        requestAnimationFrame(drawFrame)
      }
      drawFrame()
    }

    video.onerror = () => {
      URL.revokeObjectURL(video.src)
      resolve(file)
    }

    setTimeout(() => {
      if (recorder && recorder.state === 'recording') recorder.stop()
    }, (video.duration || 30) * 1000)
  })
}

async function uploadToCatboxDirect(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('reqtype', 'fileupload')
  formData.append('fileToUpload', file, file.name || 'upload.bin')

  const res = await fetch('/api/public/upload-catbox', { method: 'POST', body: formData })
  const json = await res.json().catch(() => null)
  const data = json?.data ?? json
  if (!res.ok || !data?.url) throw new Error(data?.error || `Catbox: ${json?.error || res.status}`)
  return data.url
}

async function uploadTo0x0(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file, file.name || 'upload.bin')

  const res = await fetch('/api/public/upload-0x0', { method: 'POST', body: formData })
  const json = await res.json().catch(() => null)
  const data = json?.data ?? json
  if (!res.ok || !data?.url) throw new Error(data?.error || `0x0: ${json?.error || res.status}`)
  return data.url
}

async function uploadToTmpfiles(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file, file.name || 'upload.bin')

  const res = await fetch('/api/public/upload-tmpfiles', { method: 'POST', body: formData })
  const json = await res.json().catch(() => null)
  const data = json?.data ?? json
  if (!res.ok || !data?.url) throw new Error(data?.error || `tmpfiles: ${json?.error || res.status}`)
  return data.url
}

export async function uploadToCatbox(file: File): Promise<string> {
  const services = [
    { name: 'catbox', fn: uploadToCatboxDirect },
    { name: '0x0.st', fn: uploadTo0x0 },
    { name: 'tmpfiles', fn: uploadToTmpfiles },
  ]
  let lastError = ''
  for (const svc of services) {
    try {
      const url = await svc.fn(file)
      console.log(`[upload] success via ${svc.name}`)
      return url
    } catch (e: any) {
      console.log(`[upload] ${svc.name} failed:`, e.message)
      lastError = e.message
    }
  }
  throw new Error(`All upload services failed. Last: ${lastError}`)
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
      console.log(`[roboneo] POST /api/public/roboneo → path=${path} (attempt ${attempt}/5)`)
      console.log(`[roboneo] → body keys:`, Object.keys(parameter))

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

export async function submitGoogleOmni(params: {
  accessToken: string
  imageUrl: string
  prompt?: string
  ratio?: string
  videoDuration?: number
}): Promise<{ taskId: string; roomId: string }> {
  const { accessToken, imageUrl, prompt = '', ratio = '9:16', videoDuration = 10 } = params

  const roomId = generateRoomId()
  const nodeId = uuid()

  const node = {
    tool_abstract_name: { cn: 'Google Omni', en: 'Google Omni' },
    node_id: nodeId,
    name: 'video_barley_i2v_omni_flash',
    parameters: {
      image_url: imageUrl,
      prompt: prompt || '',
      ratio,
      video_duration: videoDuration,
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

  const payload = result?.parameter ?? result

  const taskIds: string[] = payload?.task_ids?.length
    ? payload.task_ids
    : Array.isArray(payload?.tasks)
    ? payload.tasks.map((t: any) => t.task_id).filter(Boolean)
    : Object.keys(payload?.tasks || {})

  if (!taskIds.length) {
    throw new Error('Roboneo Google Omni: task_id tidak ditemukan. Response: ' + JSON.stringify(payload).slice(0, 300))
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
  let pollCount = 0

  while (Date.now() - startTime < timeoutMs) {
    pollCount++
    const elapsed = Math.round((Date.now() - startTime) / 1000)
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
    console.log(`[roboneo] poll #${pollCount} (${elapsed}s elapsed) — state: ${payload?.tasks?.[taskId]?.state || 'unknown'}`)

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
    const elapsedMin = (Date.now() - startTime) / (8 * 60000)
    const fallbackPct = Math.min(94, 1 - 1 / (1 + elapsedMin * 1.6))
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

      const debugInfo = JSON.stringify({
        state: task?.state,
        total_duration_ms: task?.total_duration_ms,
        steps_count: steps?.length || 0,
        node_name: task?.node_name,
        last_image_url: task?.last_image_url,
        error_message: task?.error_message,
      })
      console.error(`[roboneo] task marked done but no output URL found:`, debugInfo)
      throw new Error(`Roboneo: task selesai (${task?.state || 'unknown'}) tapi output kosong. Detail: ${debugInfo}`)
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
