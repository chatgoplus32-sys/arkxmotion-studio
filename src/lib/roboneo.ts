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

  const res = await fetch('/api/public/uploads?provider=catbox', { method: 'POST', body: formData })
  const json = await res.json().catch(() => null)
  const data = json?.data ?? json
  if (!res.ok || !data?.url) throw new Error(data?.error || `Catbox: ${json?.error || res.status}`)
  return data.url
}

async function uploadTo0x0(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file, file.name || 'upload.bin')

  const res = await fetch('/api/public/uploads?provider=0x0', { method: 'POST', body: formData })
  const json = await res.json().catch(() => null)
  const data = json?.data ?? json
  if (!res.ok || !data?.url) throw new Error(data?.error || `0x0: ${json?.error || res.status}`)
  return data.url
}

async function uploadToLitterbox(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('reqtype', 'fileupload')
  formData.append('time', '72h')
  formData.append('fileToUpload', file, file.name || 'upload.bin')

  const res = await fetch('/api/public/uploads?provider=litterbox', { method: 'POST', body: formData })
  const json = await res.json().catch(() => null)
  const data = json?.data ?? json
  if (!res.ok || !data?.url) throw new Error(data?.error || `litterbox: ${json?.error || res.status}`)
  return data.url
}

export async function uploadToCatbox(file: File): Promise<string> {
  const services = [
    { name: 'litterbox', fn: uploadToLitterbox },
    { name: 'catbox', fn: uploadToCatboxDirect },
    { name: '0x0.st', fn: uploadTo0x0 },
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
    client_id: '1189857647',
    app_scene: 'roboneo',
    area_code: 'ID',
    lang: 'en',
    time_zone: 'Asia/Jakarta',
    tt_ttclid: '',
    tt_ttp: '01KY074F3A1BE6C8DAB25DJG3P_.tt.1',
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

  // Proxy URLs: local proxy dulu, lalu fallback
  const PROXY_URLS = [
    'http://localhost:3002',  // Local proxy (dari komputer user)
    '/api/public/roboneo',    // Vercel proxy
  ]

  for (const proxyUrl of PROXY_URLS) {
    try {
      console.log(`[roboneo] path=${path} via ${proxyUrl}`)

      const res = await fetch(`${proxyUrl}/api/public/roboneo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Roboneo-Token': accessToken,
        },
        body: JSON.stringify({ path, parameter }),
      })

      const data = await res.json().catch(() => null)
      console.log(`[roboneo] response:`, JSON.stringify(data).slice(0, 300))

      if (data?.error_code === 98) {
        lastError = new Error(`Roboneo ${path}: token error`)
        continue
      }

      if (data?.ok === false && data?.error) {
        throw new Error(`Roboneo ${path}: ${data.error}`)
      }

      const result = data?.data || data
      if (result?.error_code && result.error_code !== 0) {
        throw new Error(`Roboneo ${path}: ${result.error_msg || 'error_code=' + result.error_code}`)
      }

      return result
    } catch (err: any) {
      if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(err.message)) {
        console.log(`[roboneo] ${proxyUrl} unavailable, trying next...`)
        lastError = err
        continue
      }
      throw err
    }
  }

  throw lastError || new Error(`Roboneo: semua proxy gagal. Jalankan proxy-server.js terlebih dahulu!`)
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

    console.log('[checkBalance] proxyResp:', JSON.stringify(proxyResp).slice(0, 500))
    console.log('[checkBalance] data:', JSON.stringify(data).slice(0, 500))

    if (proxyResp?.ok === false && proxyResp?.error) {
      return { ok: false, error: proxyResp.error }
    }

    if (!data || data.error_code !== 0) {
      const errMsg = data?.error_msg || data?.message || (data?.error_code !== undefined ? `error_code=${data?.error_code}` : 'Empty response')
      return { ok: false, error: errMsg }
    }

    const param = data.parameter || data
    const balanceKeys = ['credit', 'balance', 'remain', 'quota', 'point', 'coin', 'energy', 'total_amount', 'amount']
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
    console.log('[checkBalance] balance:', balance)
    return { ok: true, balance }
  } catch (err: any) {
    console.error('[checkBalance] catch error:', err.message)
    return { ok: false, error: err.message }
  }
}

export async function submitMotionControl(params: {
  accessToken: string
  imageUrl: string
  videoUrl: string
  prompt?: string
  quality?: string
  orientation?: string
}): Promise<{ taskId: string; roomId: string }> {
  const { accessToken, imageUrl, videoUrl, prompt = '', quality = 'std', orientation = 'video' } = params

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
      character_orientation: orientation,
      orientation,
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
    name: 'video_bonbon_i2v_omni_flash',
    parameters: {
      mcpCategoriesId: '18',
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

export async function submitSeedancePro(params: {
  accessToken: string
  imageUrl: string
  prompt?: string
  videoDuration?: number
  resolution?: string
}): Promise<{ taskId: string; roomId: string }> {
  const { accessToken, imageUrl, prompt = '', videoDuration = 12, resolution = '720p' } = params

  const roomId = generateRoomId()
  const nodeId = uuid()

  const node = {
    tool_abstract_name: { cn: 'Seedance Pro', en: 'Seedance Pro' },
    node_id: nodeId,
    name: 'video_bonbon_seedance_pro',
    parameters: {
      mcpCategoriesId: '18',
      image_url: imageUrl,
      prompt: prompt || '',
      video_duration: videoDuration,
      ratio: 'adaptive',
      resolution,
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
    throw new Error('Roboneo Seedance Pro: task_id tidak ditemukan. Response: ' + JSON.stringify(payload).slice(0, 300))
  }

  return { taskId: taskIds[0], roomId }
}

export async function submitKling26(params: {
  accessToken: string
  imageUrl: string
  prompt?: string
  videoDuration?: number
  sound?: 'on' | 'off'
}): Promise<{ taskId: string; roomId: string }> {
  const { accessToken, imageUrl, prompt = '', videoDuration = 10, sound = 'off' } = params

  const roomId = generateRoomId()
  const nodeId = uuid()

  const node = {
    tool_abstract_name: { cn: 'Kling 2.6', en: 'Kling 2.6' },
    node_id: nodeId,
    name: 'video_bonbon_img2vid_v26',
    parameters: {
      mcpCategoriesId: '18',
      image_url: imageUrl,
      prompt: prompt || '',
      video_duration: videoDuration,
      sound,
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
    throw new Error('Roboneo Kling 2.6: task_id tidak ditemukan. Response: ' + JSON.stringify(payload).slice(0, 300))
  }

  return { taskId: taskIds[0], roomId }
}

export async function submitKling30(params: {
  accessToken: string
  imageUrl: string
  prompt?: string
  videoDuration?: number
  sound?: 'on' | 'off'
  mode?: 'pro' | 'std'
}): Promise<{ taskId: string; roomId: string }> {
  const { accessToken, imageUrl, prompt = '', videoDuration = 10, sound = 'off', mode = 'pro' } = params

  const roomId = generateRoomId()
  const nodeId = uuid()

  const node = {
    tool_abstract_name: { cn: `Kling 3.0 ${mode === 'pro' ? 'Pro' : 'Standard'}`, en: `Kling 3.0 ${mode === 'pro' ? 'Pro' : 'Standard'}` },
    node_id: nodeId,
    name: mode === 'pro' ? 'video_bonbon_img2vid_v30_pro' : 'video_bonbon_img2vid_v30_std',
    parameters: {
      mcpCategoriesId: '18',
      image_url: imageUrl,
      prompt: prompt || '',
      video_duration: videoDuration,
      sound,
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
    throw new Error('Roboneo Kling 3.0: task_id tidak ditemukan. Response: ' + JSON.stringify(payload).slice(0, 300))
  }

  return { taskId: taskIds[0], roomId }
}

export async function submitKling25(params: {
  accessToken: string
  imageUrl: string
  prompt?: string
  videoDuration?: number
}): Promise<{ taskId: string; roomId: string }> {
  const { accessToken, imageUrl, prompt = '', videoDuration = 10 } = params

  const roomId = generateRoomId()
  const nodeId = uuid()

  const node = {
    tool_abstract_name: { cn: 'Kling 2.5', en: 'Kling 2.5' },
    node_id: nodeId,
    name: 'video_bonbon_img2vid_v25',
    parameters: {
      mcpCategoriesId: '18',
      image_url: imageUrl,
      prompt: prompt || '',
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
    throw new Error('Roboneo Kling 2.5: task_id tidak ditemukan. Response: ' + JSON.stringify(payload).slice(0, 300))
  }

  return { taskId: taskIds[0], roomId }
}



export async function pollMotionControl(
  accessToken: string,
  taskId: string,
  roomId: string,
  onProgress?: (status: string, pct: number) => void,
  timeoutMs = 1800000,
  signal?: AbortSignal
): Promise<string> {
  const startTime = Date.now()
  let networkRetries = 0
  const roomIdMap = new Map<string, string>()
  roomIdMap.set(taskId, roomId)

  function resolveUrls(obj: any, depth = 0): string[] {
    if (depth > 8 || !obj || typeof obj !== 'object') return []
    if (typeof obj === 'string') {
      let urls: string[] = []
      if (/^https?:\/\//i.test(obj)) {
        urls = [obj]
      } else {
        urls = (obj.match(/(?:https?:)?\/\/[^\s"'<>\\]+/gi) || []).map((u: string) =>
          (u.startsWith('//') ? `https:${u}` : u).replace(/[),.;\]]+$/g, '')
        )
      }
      return urls.map((u) => {
        if (/^https?:\/\/localhost:\d+\/backend\/api\/video\//i.test(u)) {
          const path = u.replace(/^https?:\/\/localhost:\d+/, '')
          return `https://createpulse.online${path}`
        }
        return u
      })
    }
    const urls: string[] = []
    const urlKeys = 'url,uri,src,href,last_image_url,lastImageUrl,media_url,mediaUrl,image_url,imageUrl,video_url,videoUrl,file_url,fileUrl,asset_url,assetUrl,origin_url,originUrl,original_url,originalUrl,preview_url,previewUrl,source_url,sourceUrl,output_url,outputUrl,download_url,downloadUrl,signed_url,signedUrl,play_url,playUrl,cover_url,coverUrl,data_url,dataUrl,result_url,resultUrl,video,media,output,output_url,output,path,link,href,src'
    for (const key of urlKeys.split(',')) {
      const val = obj[key]
      if (typeof val === 'string' && /^https?:\/\//i.test(val)) urls.push(val)
    }
    for (const val of Object.values(obj)) {
      urls.push(...resolveUrls(val, depth + 1))
    }
    return [...new Set(urls)]
  }

  function findVideoUrl(...sources: any[]): string | null {
    const all = [...new Set(sources.flatMap((s) => resolveUrls(s)))]
    if (all.length > 0) {
      console.log(`[roboneo] findVideoUrl: found ${all.length} URLs:`, all.map(u => u.slice(0, 80)))
    }
    return all.find((u) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u)) ||
      all.find((u) => /video|mp4|mov|webm|m4v|vod|tos|myqcloud|aliyun|oss|meitu|roboneo/i.test(u)) ||
      all.find((u) => /\.(png|jpg|jpeg|gif|webp)(\?|#|$)/i.test(u)) ||
      all[0] || null
  }

  function extractProgressLocal(obj: any, depth = 0): number | null {
    if (depth > 6 || !obj || typeof obj !== 'object') return null
    const keys = ['progress', 'percent', 'rate', 'schedule', 'process']
    for (const [k, v] of Object.entries(obj)) {
      const kl = k.toLowerCase()
      if (keys.some((pk) => kl.includes(pk))) {
        const num = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN
        if (Number.isFinite(num)) {
          const pct = num <= 1 ? num * 100 : num
          if (pct >= 0 && pct <= 100) return pct
        }
      }
    }
    for (const val of Object.values(obj)) {
      const p = extractProgressLocal(val, depth + 1)
      if (p !== null) return p
    }
    return null
  }

  let lastLog = ''
  let successNoOutputCount = 0
  const MAX_SUCCESS_NO_OUTPUT = 15

  while (Date.now() - startTime < timeoutMs) {
    if (signal?.aborted) throw new Error('Generation cancelled')
    await new Promise((r) => setTimeout(r, 4000))

    let result: any
    try {
      const storedRoomId = roomIdMap.get(taskId) || roomId
      const tracking = buildTrackingParams(accessToken, 'nodeexecutequery', storedRoomId)
      const { _access_token, ...paramWithoutToken } = tracking

      result = await roboneoApiCall(accessToken, 'nodeexecutequery', {
        ...paramWithoutToken,
        task_ids: [taskId],
        room_id: storedRoomId,
      })
      networkRetries = 0
    } catch (err: any) {
      if (/HTTP (502|503|504|429)|upstream|connection|network/i.test(err.message)) {
        networkRetries++
        if (networkRetries >= 8) throw err
        onProgress?.(`retrying (${networkRetries})`, 0)
        continue
      }
      throw err
    }

    const payload = result?.parameter ?? result
    const task = payload?.tasks?.[taskId] || (typeof payload?.tasks === 'object' ? Object.values(payload?.tasks)?.[0] : null)
    const steps = Array.isArray(task?.steps) ? task.steps : []
    const taskState = String(task?.state || task?.status || '').toLowerCase()
    const allStepsDone = steps.length > 0 && steps.every((s: any) => /success|succeeded|completed|done|finished/i.test(String(s.status || s.state || '')))
    const status = allStepsDone ? 'completed' : taskState || 'processing'
    const realPct = extractProgressLocal(task) ?? extractProgressLocal(payload)
    const elapsedMin = (Date.now() - startTime) / (8 * 60000)
    const fallbackPct = Math.min(0.94, 1 - 1 / (1 + elapsedMin * 1.6))
    const pct = realPct === null ? Math.round(5 + fallbackPct * 89) : Math.round(realPct)

    onProgress?.(status || 'processing', pct)

    const logEntry = `poll #${Math.round((Date.now() - startTime) / 1000)}s state=${status} pct=${pct}`
    if (logEntry !== lastLog) {
      lastLog = logEntry
      console.log(`[roboneo] ${logEntry}`)
    }

    const isDone = ['success', 'succeeded', 'completed', 'done', 'finished'].includes(status) && (allStepsDone || pct >= 90)
    const mediaInfo = task?.media_info_list?.[0] || payload?.media_info_list?.[0]

    if (isDone) {
      const videoUrl = findVideoUrl(
        task?.last_image_url, task?.last_image_urls,
        task?.initial_transferred_urls, task?.media_meta, task?.media_metas,
        task?.media_info_list, mediaInfo?.url, mediaInfo?.media_url,
        ...steps.map((s: any) => s.output),
        ...steps.map((s: any) => s.result),
        ...steps.map((s: any) => s.data),
        payload?.output, payload?.result, payload,
        payload?.data, task?.data, task?.output_url, task?.download_url,
        task?.result_url, task?.video, task?.video_url, task?.media,
        payload?.video, payload?.video_url, payload?.media,
        task?.url, task?.src, task?.link, task?.href, task?.path
      )

      if (videoUrl) return videoUrl

      console.log(`[roboneo] task done but no url found. task keys:`, Object.keys(task || {}))
      console.log(`[roboneo] task:`, JSON.stringify(task, null, 2).slice(0, 2000))
      console.log(`[roboneo] payload keys:`, Object.keys(payload || {}))
      if (mediaInfo) console.log(`[roboneo] mediaInfo:`, JSON.stringify(mediaInfo))

      successNoOutputCount++
      if (successNoOutputCount >= MAX_SUCCESS_NO_OUTPUT) {
        throw new Error(`Roboneo: task selesai (${status}) tapi output kosong setelah ${MAX_SUCCESS_NO_OUTPUT}x percobaan`)
      }

      // Smart wait: progress rendah = output masih diproses, tunggu lebih lama
      const waitMs = pct < 20 ? 8000 : pct < 50 ? 6000 : 4000
      onProgress?.(`waiting for output (${successNoOutputCount}/${MAX_SUCCESS_NO_OUTPUT})`, pct)
      await new Promise(r => setTimeout(r, waitMs))
      continue
    }

    if (['fail', 'failed', 'error', 'cancelled', 'canceled'].includes(status)) {
      const failedStep = steps.find((s: any) => /fail|error/i.test(String(s.status || s.state || '')))
      const errMsg = task?.error_message || task?.error_msg || failedStep?.error_message || failedStep?.error_msg || 'unknown'
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
