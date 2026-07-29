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

function generateRoomId() {
  const e = Math.floor(Math.random() * 1e10).toString()
  return `${btoa(e).replace(/=/g, '')}-${Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}-${Date.now()}`
}

function extractUid(token: string): string {
  try {
    let t = token.replace(/^_v\d+/, '')
    t = t.replace(/[^A-Za-z0-9+/=]/g, '')
    t += '='.repeat((4 - (t.length % 4)) % 4)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decoded = (typeof atob === 'function' ? atob(t) : (globalThis as any).Buffer?.from(t, 'base64').toString('binary') ?? (() => { throw new Error('atob and Buffer both unavailable') })())
    const payload = decoded.split('#')[2]
    if (payload && /^\d+$/.test(payload)) return payload
  } catch (e: any) {
    console.warn('[extractUid] fallback:', e.message)
  }
  return '0'
}

function compressImage(file: File, maxDim: number, quality: number): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image()
    const cleanCanvas = () => {
      const canvas = document.createElement('canvas')
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            cleanCanvas()
            resolve(file)
            return
          }
          const compressed = new File([blob], file.name, { type: file.type || 'image/jpeg' })
          cleanCanvas()
          URL.revokeObjectURL(img.src)
          resolve(compressed.size < file.size ? compressed : file)
        },
        file.type || 'image/jpeg',
        quality
      )
    }

    img.onload = () => {
      cleanCanvas()
    }

    img.onerror = () => {
      cleanCanvas()
      URL.revokeObjectURL(img.src)
      resolve(file)
    }

    img.src = URL.createObjectURL(file)
  })
}

export async function normalizeImage(file: File): Promise<File> {
  if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
    try { return await compressImage(file, 1600, 0.85) } catch {}
  }
  if (file.type.startsWith('image/')) {
    if (file.size > 8 * 1024 * 1024) return await compressImage(file, 1280, 0.75)
    if (file.size > 4 * 1024 * 1024) return await compressImage(file, 1600, 0.85)
  }
  return file
}

export async function compressVideo(file: File, maxMb = 4): Promise<File> {
  if (file.size <= maxMb * 1024 * 1024) {
    console.log(`[upload] video ${(file.size / 1024 / 1024).toFixed(1)}MB <= ${maxMb}MB, using original`)
    return file
  }
  console.log(`[upload] video ${(file.size / 1024 / 1024).toFixed(1)}MB > ${maxMb}MB, re-encoding to mp4`)
  return new Promise<File>((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'metadata'
    video.onerror = () => {
      URL.revokeObjectURL(video.src)
      console.warn('[upload] video element error, using original file')
      resolve(file)
    }
    video.onloadedmetadata = () => {
      const duration = Math.min(video.duration || 30, 60)
      const canvas = document.createElement('canvas')
      canvas.width = Math.min(video.videoWidth, 1280)
      canvas.height = Math.min(video.videoHeight, 720)
      const ctx = canvas.getContext('2d')!
      const stream = canvas.captureStream(24)
      const mimeType = 'video/webm;codecs=vp9'
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_500_000 })
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType })
        const out = new File([blob], file.name.replace(/\.[^.]+$/, '.mp4'), { type: 'video/mp4' })
        URL.revokeObjectURL(video.src)
        console.log(`[upload] re-encoded ${(file.size / 1024 / 1024).toFixed(1)}MB → ${(out.size / 1024 / 1024).toFixed(1)}MB`)
        resolve(out.size < file.size ? out : file)
      }
      recorder.onerror = () => { URL.revokeObjectURL(video.src); resolve(file) }
      recorder.start()
      video.play()
      const draw = () => {
        if (video.ended || video.paused || recorder.state !== 'recording') return
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        requestAnimationFrame(draw)
      }
      draw()
      setTimeout(() => { if (recorder.state === 'recording') recorder.stop() }, duration * 1000)
    }
    video.src = URL.createObjectURL(file)
  })
}

async function uploadToService(file: File, name: string, uploader: (f: File) => Promise<string>): Promise<string> {
  console.log(`[upload] trying ${name} (${(file.size / 1024 / 1024).toFixed(1)}MB)...`)
  const url = await uploader(file)
  console.log(`[upload] success via ${name}`)
  return url
}

export async function uploadToCatbox(file: File): Promise<string> {
  const uploaders: Array<[string, (f: File) => Promise<string>]> = [
    ['Server', async (f) => {
      const formData = new FormData()
      formData.append('file', new File([f], f.name || 'upload.bin', { type: f.type || 'application/octet-stream' }))
      formData.append('prefer', 'roboneo')
      const res = await fetch('https://roboneo-proxy.chatgoplus32.workers.dev/api/public/upload-catbox', { method: 'POST', body: formData })
      const text = await res.text().catch(() => '')
      let data: any = {}
      try { data = JSON.parse(text) } catch { throw Error(`Proxy returned non-JSON (${res.status}): ${text.slice(0, 200)}`) }
      if (!res.ok || !data.url) throw Error(data.error || `HTTP ${res.status}`)
      return data.url
    }],
    ['AA Creative', async (f) => {
      const formData = new FormData()
      formData.append('file', new File([f], f.name || 'upload.bin', { type: f.type || 'application/octet-stream' }))
      formData.append('prefer', 'roboneo')
      const res = await fetch('https://aacreative.vercel.app/api/public/upload-catbox', { method: 'POST', body: formData })
      const text = await res.text().catch(() => '')
      let data: any = {}
      try { data = JSON.parse(text) } catch { throw Error(`AA Creative returned non-JSON (${res.status}): ${text.slice(0, 200)}`) }
      if (!res.ok || !data.url) throw Error(data.error || `HTTP ${res.status}`)
      return data.url
    }],
    ['Uguu', async (f) => {
      const fd = new FormData()
      fd.append('files[]', f, f.name || 'upload.bin')
      const res = await fetch('https://uguu.se/upload.php', { method: 'POST', body: fd })
      const data = await res.json().catch(() => null)
      const url = data?.files?.[0]?.url
      if (!res.ok || !url || !/^https?:\/\//i.test(url)) throw Error(data?.error || `Uguu HTTP ${res.status}`)
      return url
    }],
    ['Catbox', async (f) => {
      const fd = new FormData()
      fd.append('reqtype', 'fileupload')
      fd.append('fileToUpload', f, f.name || 'upload.bin')
      const res = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: fd })
      const text = (await res.text()).trim()
      if (!res.ok || !/^https?:\/\//i.test(text)) throw Error(text || `Catbox HTTP ${res.status}`)
      return text
    }],
    ['Tmpfiles', async (f) => {
      const fd = new FormData()
      fd.append('file', f, f.name || 'upload.bin')
      const res = await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: fd })
      const data = await res.json().catch(() => null)
      let url = data?.data?.url
      if (!res.ok || !url) throw Error(data?.error || `Tmpfiles HTTP ${res.status}`)
      url = url.replace(/^(https?:\/\/tmpfiles\.org)\/(?!dl\/)/i, '$1/dl/')
      return url
    }],
    ['Pixeldrain', async (f) => {
      const fd = new FormData()
      fd.append('file', f, f.name || 'upload.bin')
      const res = await fetch('https://pixeldrain.com/api/file', { method: 'POST', body: fd })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.id) throw Error(data?.message || `Pixeldrain HTTP ${res.status}`)
      return `https://pixeldrain.com/api/file/${data.id}`
    }],
    ['0x0', async (f) => {
      const fd = new FormData()
      fd.append('file', f, f.name || 'upload.bin')
      const res = await fetch('https://0x0.st', { method: 'POST', body: fd })
      const text = (await res.text()).trim()
      if (!res.ok || !/^https?:\/\//i.test(text)) throw Error(text || `0x0 HTTP ${res.status}`)
      return text
    }],
  ]

  const errors: string[] = []
  for (const [name, uploader] of uploaders) {
    try {
      return await uploadToService(file, name, uploader)
    } catch (e: any) {
      errors.push(`${name}: ${e.message}`)
      console.warn(`[upload] ${name} failed: ${e.message}`)
    }
  }
  throw new Error(`Upload gagal: ${errors.join(' | ')}`)
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
  // Primary: roboneo-proxy, fallback: aacreative
  const PROXY_URLS = [
    'https://roboneo-proxy.chatgoplus32.workers.dev',
    'https://aacreative.vercel.app',
  ]

  let lastError: string = ''
  let lastStatus = 0

  for (const proxyUrl of PROXY_URLS) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      let res: Response | null = null
      try {
        console.log(`[roboneo] path=${path} via ${proxyUrl} attempt=${attempt}`)

        res = await fetch(`${proxyUrl}/api/public/roboneo`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Roboneo-Token': accessToken,
          },
          body: JSON.stringify({ path, parameter }),
        })
      } catch (err: any) {
        lastError = `network: ${err.message}`
        lastStatus = 0
        if (attempt < 5) {
          await new Promise(r => setTimeout(r, 1500 * attempt))
          continue
        }
        break
      }

      const data = await res.json().catch(() => null)
      const status = data?.status ?? res.status
      const innerData = data?.data ?? {}
      lastStatus = status

      console.log(`[roboneo] response:`, JSON.stringify(data).slice(0, 300))

      // Retry on HTTP 502/503/504/429
      if (!data?.ok && (status === 502 || status === 503 || status === 504 || status === 429 || status === 0) && attempt < 5) {
        lastError = `HTTP ${status}`
        await new Promise(r => setTimeout(r, 1500 * attempt))
        continue
      }

      // Token error (error_code 98) → try next proxy
      if (innerData.error_code === 98 || data?.error_code === 98) {
        lastError = `token error`
        break
      }

      // Other errors
      if (!data?.ok || (innerData.error_code && innerData.error_code !== 0)) {
        const errMsg = innerData.error_msg || `HTTP ${status}`
        throw new Error(`Roboneo ${path}: ${errMsg}${innerData.error_code ? ` (error_code=${innerData.error_code})` : ''}`)
      }

      return innerData.parameter
    }
  }

  throw new Error(`Roboneo ${path}: ${lastError || `HTTP ${lastStatus}`} gagal setelah semua proxy`)
}

export async function checkRoboneoBalance(accessToken: string): Promise<{ ok: boolean; balance?: number | null; isValidUser?: boolean; error?: string }> {
  try {
    const PROXY_URLS = [
      'https://roboneo-proxy.chatgoplus32.workers.dev',
      'https://aacreative.vercel.app',
    ]

    let lastError = ''

    for (const proxyUrl of PROXY_URLS) {
      try {
        const res = await fetch(`${proxyUrl}/api/public/roboneo-membership`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Roboneo-Token': accessToken,
          },
        })

        const data = await res.json().catch(() => null)

        if (!data?.ok) {
          lastError = data?.message || `HTTP ${data?.status ?? res.status}`
          continue
        }

        const membershipData = data?.data ?? {}
        const errorCode = membershipData.error_code ?? membershipData.code
        if (errorCode && errorCode !== 0) {
          lastError = membershipData.error_msg || membershipData.message || `error_code=${errorCode}`
          continue
        }

        const resultData = membershipData.data ?? membershipData.result ?? membershipData

        // Extract balance from nested structures
        function findInDetailList(data: any, pattern: RegExp): number | null {
          if (!data || typeof data !== 'object') return null
          const detailList = data.detail_list
          if (Array.isArray(detailList)) {
            for (const item of detailList) {
              if (!item || typeof item !== 'object') continue
              const title = String(item.title ?? '')
              if (!pattern.test(title)) continue
              const balanceList = item.meiye_balance_list
              if (Array.isArray(balanceList)) {
                for (const bal of balanceList) {
                  if (!bal || typeof bal !== 'object') continue
                  const leftInfo = bal.left_info
                  if (typeof leftInfo === 'number') return leftInfo
                  if (typeof leftInfo === 'string') {
                    const cleaned = leftInfo.replace(/,/g, '').trim()
                    if (/^-?\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned)
                  }
                }
              }
            }
          }
          return null
        }

        function findValueByKey(obj: any, keys: string[]): number | null {
          if (!obj || typeof obj !== 'object') return null
          for (const [k, v] of Object.entries(obj)) {
            const kl = k.toLowerCase()
            if (keys.some((target) => kl === target || kl.includes(target))) {
              if (typeof v === 'number') return v
              if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v)
            }
          }
          for (const v of Object.values(obj)) {
            if (v && typeof v === 'object') {
              const found = findValueByKey(v, keys)
              if (found !== null) return found
            }
          }
          return null
        }

        const cyberBalance = findInDetailList(resultData, /cyber|carrot/i)
        const dailyBalance = findInDetailList(resultData, /daily|free/i)
        const freeCredit = findValueByKey(resultData, ['free_credit', 'free_amount', 'daily_free', 'free']) ?? dailyBalance
        const vipCredit = findValueByKey(resultData, ['vip_credit', 'vip_amount', 'vip'])
        const totalCredit = findValueByKey(resultData, ['total_amount', 'total_credit', 'credit_balance', 'balance', 'credit', 'remain', 'point', 'coin', 'energy', 'quota']) ?? cyberBalance ?? ((freeCredit ?? 0) + (vipCredit ?? 0) || null)

        console.log(`[checkBalance] membership OK: balance=${totalCredit}, free=${freeCredit}, vip=${vipCredit}`)

        return { ok: true, balance: totalCredit, isValidUser: true }
      } catch (err: any) {
        lastError = `network: ${err.message}`
        continue
      }
    }

    // Fallback: try vipshow endpoint
    try {
      const tracking = buildTrackingParams(accessToken, 'vipshow', generateRoomId())
      const { _access_token, ...paramWithoutToken } = tracking

      const param = await roboneoApiCall(accessToken, 'vipshow', {
        ...paramWithoutToken,
        features: '',
        later_face: 0,
      })

      const isValidUser = param?.is_valid_user !== false
      console.log(`[checkBalance] vipshow fallback: is_valid_user=${param?.is_valid_user}, uid=${param?.uid}`)

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
      console.log('[checkBalance] vipshow balance:', balance)

      if (!isValidUser) {
        return { ok: false, balance, isValidUser: false, error: `Token tidak valid (is_valid_user=false, uid=${param?.uid})` }
      }

      return { ok: true, balance, isValidUser: true }
    } catch (err: any) {
      console.error('[checkBalance] all methods failed:', lastError, err.message)
      return { ok: false, error: lastError || err.message }
    }
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

  const payload = result

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

const ROBONEO_I2V_MODELS: Record<string, { apiName: string; recipeCode?: string; toolLabel: string; family: string }> = {
  'rn:seedance-1.0': { apiName: 'api_v1_outsourcing_img_to_video', recipeCode: 'd56CL0CD7eVX', toolLabel: 'Seedance 1.0', family: 'seedance' },
  'rn:seedance-pro': { apiName: 'api_v1_outsourcing_img_to_video', recipeCode: 'd56CL0CD7eVX', toolLabel: 'Seedance Pro', family: 'seedance' },
  'rn:seedance-2.0': { apiName: 'video_toffee_i2v_v20', toolLabel: 'Seedance 2.0', family: 'seedance' },
  'rn:seedance-2.0-mini': { apiName: 'video_toffee_i2v_v20_mini', toolLabel: 'Seedance 2.0 Mini', family: 'seedance' },
  'rn:seedance-2.0-fast': { apiName: 'video_toffee_i2v_v20_fast', toolLabel: 'Seedance 2.0 Fast', family: 'seedance' },
  'rn:happyhorse-1.1': { apiName: 'images2video_edit_hydra', toolLabel: 'Happy Horse 1.1', family: 'happyhorse' },
  'rn:happyhorse-1.0': { apiName: 'video_happyhorse_i2v', toolLabel: 'Happy Horse 1.0', family: 'happyhorse' },
  'rn:kling-v3': { apiName: 'video_bonbon_img2vid_v30', toolLabel: 'Kling 3.0', family: 'kling3' },
  'rn:kling-v3-turbo': { apiName: 'video_bonbon_i2v_v3turbo', toolLabel: 'Kling 3.0 Turbo', family: 'kling3' },
  'rn:google-omni': { apiName: 'video_barley_i2v_omni_flash', recipeCode: '2mXIxsFvbfXw', toolLabel: 'Google Omni', family: 'omni' },
  'rn:kling-v26:std': { apiName: 'video_bonbon_img2vid_v26', recipeCode: 'xd_pUp8JDcE0', toolLabel: 'Kling 2.6', family: 'kling26' },
  'rn:kling-v26': { apiName: 'video_bonbon_img2vid_v26', recipeCode: 'xd_pUp8JDcE0', toolLabel: 'Kling 2.6', family: 'kling26' },
  'rn:kling-v21': { apiName: 'video_bonbon_kling_v21', toolLabel: 'Kling 2.1', family: 'legacy21' },
  'rn:kling-v21:std': { apiName: 'video_bonbon_kling_v21', toolLabel: 'Kling 2.1', family: 'legacy21' },
}

export async function submitRoboneoI2V(params: {
  accessToken: string
  imageUrl: string
  prompt?: string
  modelKey: string
  ratio?: string
  duration?: number
  resolution?: string
  sound?: string
  quality?: string
}): Promise<{ taskId: string; roomId: string; nodeId: string }> {
  const { accessToken, imageUrl, prompt = '', modelKey, ratio = '9:16', duration = 5, resolution, sound, quality } = params

  const modelLower = modelKey.toLowerCase()
  const modelConfig = ROBONEO_I2V_MODELS[modelLower] || {
    apiName: 'video_bonbon_img2vid_v26',
    recipeCode: 'xd_pUp8JDcE0',
    toolLabel: 'Kling 2.6',
    family: 'kling26',
  }

  const roomId = generateRoomId()
  const nodeId = uuid()

  const parameters: Record<string, any> = {
    image_url: imageUrl,
    prompt: prompt || '',
    random: `${Date.now()}-${Math.floor(1e7 + Math.random() * 89999999)}`,
  }

  switch (modelConfig.family) {
    case 'seedance':
      parameters.ratio = ratio
      parameters.resolution = resolution || '720p'
      parameters.video_duration = duration
      parameters.sound = sound || 'off'
      break
    case 'happyhorse':
      parameters.ratio = ratio
      parameters.resolution = resolution || '720p'
      parameters.video_duration = duration
      break
    case 'kling3':
      parameters.ratio = ratio
      parameters.video_duration = duration
      parameters.sound = sound || 'off'
      break
    case 'omni':
      parameters.ratio = ratio
      parameters.video_duration = duration
      break
    case 'kling26':
      parameters.sound = sound || 'off'
      parameters.video_duration = duration
      break
    default:
      parameters.ratio = ratio
      parameters.video_duration = duration
      parameters.quality = quality || 'std'
      break
  }

  if (modelConfig.recipeCode) {
    parameters.recipe_code = modelConfig.recipeCode
  }

  const node = {
    tool_abstract_name: { cn: modelConfig.toolLabel, en: modelConfig.toolLabel },
    node_id: nodeId,
    name: modelConfig.apiName,
    parameters,
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

  const payload = result

  const taskIds: string[] = payload?.task_ids?.length
    ? payload.task_ids
    : Array.isArray(payload?.tasks)
    ? payload.tasks.map((t: any) => t.task_id).filter(Boolean)
    : Object.keys(payload?.tasks || {})

  if (!taskIds.length) {
    throw new Error(`Roboneo ${modelConfig.toolLabel}: task_id tidak ditemukan. Response: ` + JSON.stringify(payload).slice(0, 300))
  }

  return { taskId: taskIds[0], roomId, nodeId }
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
      mcpCategoriesId: '18',
      image_url: imageUrl,
      prompt: prompt || '',
      ratio,
      video_duration: videoDuration,
      recipe_code: '2mXIxsFvbfXw',
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

  const payload = result

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

export async function pollMotionControl(
  accessToken: string,
  taskId: string,
  roomId: string,
  onProgress?: (status: string, pct: number) => void,
  timeoutMs = 3600000,
  signal?: AbortSignal,
  nodeId?: string
): Promise<string> {
  const startTime = Date.now()
  let networkRetries = 0
  const roomIdMap = new Map<string, { roomId: string; nodeId?: string }>()
  roomIdMap.set(taskId, { roomId, nodeId })

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
      console.log(`[roboneo] findVideoUrl: found ${all.length} URLs:`, all.map(u => u.slice(0, 120)))
    }
    // Priority 1: Direct video file URLs
    const directVideo = all.find((u) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u))
    if (directVideo) return directVideo

    // Priority 2: Known video CDN paths (must have video-like path segments)
    const cdnVideo = all.find((u) => {
      if (/\.(png|jpg|jpeg|gif|webp)(\?|#|$)/i.test(u)) return false
      if (/\/backend\/api\/video\//i.test(u)) return true
      if (/tos\/.*\/video/i.test(u)) return true
      if (/vod\/.*\.mp4/i.test(u)) return true
      if (/roboneo\.com\/.*video/i.test(u)) return true
      if (/multi-agent-release\.meitudata\.com\/.*\.(mp4|mov|webm|m4v)/i.test(u)) return true
      return false
    })
    if (cdnVideo) return cdnVideo

    // Priority 3: Any URL with video-related domain/path (excluding image-only URLs)
    const anyVideo = all.find((u) => {
      if (/\.(png|jpg|jpeg|gif|webp)(\?|#|$)/i.test(u)) return false
      return /video|mp4|mov|webm|m4v|vod|tos|myqcloud|aliyun|oss|roboneo/i.test(u)
    })
    if (anyVideo) return anyVideo

    // Priority 4: Image URLs (might be frame thumbnails)
    const imageUrl = all.find((u) => /\.(png|jpg|jpeg|gif|webp)(\?|#|$)/i.test(u))
    if (imageUrl) return imageUrl

    // Fallback: first URL (might be wrong, but log it)
    if (all.length > 0) {
      console.log(`[roboneo] findVideoUrl: no video pattern match, using first URL: ${all[0]}`)
    }
    return all[0] || null
  }

  function searchAllUrls(obj: any): string[] {
    if (!obj || typeof obj !== 'object') return []
    const urls: string[] = []
    function walk(o: any, depth = 0) {
      if (depth > 10 || !o || typeof o !== 'object') return
      if (typeof o === 'string') {
        if (/^https?:\/\//i.test(o)) urls.push(o)
        else {
          const found = o.match(/(?:https?:)?\/\/[^\s"'<>\\]+/gi) || []
          for (const u of found) urls.push((u.startsWith('//') ? `https:${u}` : u).replace(/[),.;\]]+$/g, ''))
        }
        return
      }
      if (Array.isArray(o)) { for (const v of o) walk(v, depth + 1); return }
      for (const v of Object.values(o)) walk(v, depth + 1)
    }
    walk(obj)
    return [...new Set(urls)]
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
  const MAX_SUCCESS_NO_OUTPUT = 5

  while (Date.now() - startTime < timeoutMs) {
    if (signal?.aborted) throw new Error('Generation cancelled')
    await new Promise((r) => setTimeout(r, 4000))

    let result: any
    try {
      const stored = roomIdMap.get(taskId) || { roomId }
      const tracking = buildTrackingParams(accessToken, 'nodeexecutequery', stored.roomId)
      const { _access_token, ...paramWithoutToken } = tracking

      result = await roboneoApiCall(accessToken, 'nodeexecutequery', {
        ...paramWithoutToken,
        task_ids: [taskId],
        room_id: stored.roomId,
        ...(stored.nodeId ? { node_id: stored.nodeId, workflow_version: 'v2' } : {}),
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

    const payload = result
    const task = payload?.tasks?.[taskId] || (typeof payload?.tasks === 'object' ? Object.values(payload?.tasks)?.[0] : null)
    const steps = Array.isArray(task?.steps) ? task.steps : []
    const taskState = String(task?.state || task?.status || '').toLowerCase()
    const status = taskState || 'processing'
    const realPct = extractProgressLocal(task) ?? extractProgressLocal(payload)
    const elapsedMin = (Date.now() - startTime) / (8 * 60000)
    const fallbackPct = Math.min(0.94, 1 - 1 / (1 + elapsedMin * 1.6))
    const pct = realPct === null ? Math.round(5 + fallbackPct * 89) : Math.round(realPct)

    onProgress?.(status || 'processing', pct)

    const logEntry = `poll #${Math.round((Date.now() - startTime) / 1000)}s state=${status} pct=${pct}`
    if (logEntry !== lastLog) {
      lastLog = logEntry
      console.log(`[roboneo] ${logEntry}`)
      // Debug: log task details setiap 30 detik
      if (Math.round((Date.now() - startTime) / 1000) % 30 === 0) {
        console.log(`[roboneo] task keys:`, Object.keys(task || {}))
        console.log(`[roboneo] task FULL:`, JSON.stringify(task, null, 2).slice(0, 3000))
        console.log(`[roboneo] payload keys:`, Object.keys(payload || {}))
        console.log(`[roboneo] steps count:`, steps.length)
        if (steps.length > 0) {
          console.log(`[roboneo] steps detail:`, JSON.stringify(steps, null, 2).slice(0, 2000))
        }
      }
    }

    const isSuccess = ['success', 'succeeded', 'completed', 'done', 'finished'].includes(status)
    const isFailed = ['fail', 'failed', 'error', 'cancelled', 'canceled'].includes(status)
    const mediaInfo = task?.media_info_list?.[0] || payload?.media_info_list?.[0]

    if (isSuccess) {
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

      const allUrls = searchAllUrls({ task, payload, response: result })
      const fromAll = allUrls.find((u) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u)) ||
        allUrls.find((u) => /video|mp4|mov|webm|m4v|vod|tos|myqcloud|aliyun|oss|roboneo/i.test(u) && !/\.(png|jpg|jpeg|gif|webp)(\?|#|$)/i.test(u)) ||
        allUrls.find((u) => /\.(png|jpg|jpeg|gif|webp)(\?|#|$)/i.test(u)) ||
        allUrls[0] || null

      if (fromAll) return fromAll

      console.log(`[roboneo] task done but no url found. task keys:`, Object.keys(task || {}))
      console.log(`[roboneo] task:`, JSON.stringify(task, null, 2).slice(0, 2000))
      console.log(`[roboneo] payload keys:`, Object.keys(payload || {}))
      if (mediaInfo) console.log(`[roboneo] mediaInfo:`, JSON.stringify(mediaInfo))

      successNoOutputCount++
      if (successNoOutputCount >= MAX_SUCCESS_NO_OUTPUT) {
        throw new Error(`Roboneo credit/quota habis: task selesai (${status}) tapi output kosong setelah ${MAX_SUCCESS_NO_OUTPUT}x percobaan`)
      }

      onProgress?.(`finalizing`, Math.max(pct, 96))
      await new Promise(r => setTimeout(r, 4000))
      continue
    }

    if (isFailed) {
      const failedStep = steps.find((s: any) => /fail|error/i.test(String(s.status || s.state || '')))
      const errMsg = task?.error_message || task?.error_msg || failedStep?.error_message || failedStep?.error_msg || 'unknown'
      throw new Error(`Roboneo failed: ${errMsg}`)
    }
  }

  throw new Error('Roboneo timeout')
}

export function isRoboneoTokenError(msg: string): boolean {
  return /token|auth|log\s*in|login|expired|unauth|401|403|insufficient|balance|credit|quota|charge|CHARGE_FAILED|余额|URL output tidak ditemukan|output tidak ditemukan|no output URL/i.test(msg)
}

export function parseAccessToken(raw: string): string {
  return raw.trim()
}
