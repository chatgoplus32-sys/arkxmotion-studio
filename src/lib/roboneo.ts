export function getVideoDurationFromFile(file: File): Promise<number> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.preload = 'metadata'
      const cleanup = () => { try { URL.revokeObjectURL(url) } catch {} }
      const timeout = setTimeout(() => { cleanup(); resolve(10) }, 5000)
      video.onloadedmetadata = () => {
        clearTimeout(timeout)
        const dur = Number.isFinite(video.duration) ? video.duration : 10
        cleanup()
        resolve(Math.round(dur))
      }
      video.onerror = () => { clearTimeout(timeout); cleanup(); resolve(10) }
      video.src = url
    } catch { resolve(10) }
  })
}

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

function loadImage(file: File): Promise<{ width: number; height: number; draw: CanvasImageSource; cleanup: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, draw: img, cleanup: () => URL.revokeObjectURL(url) })
    img.onerror = () => { URL.revokeObjectURL(url); reject(Error('Gagal membaca gambar')) }
    img.src = url
  })
}

function encodeCanvas(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(Error('Gagal encode gambar')), type, quality))
}

async function compressImageMultiPass(file: File, maxBytes: number, onProgress?: (msg: string, pct?: number) => void): Promise<File> {
  if (file.size <= maxBytes) return file
  const { width, height, draw, cleanup } = await loadImage(file)
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    let scale = Math.min(1, 2560 / Math.max(width, height))
    for (let pass = 0; pass < 8; pass++) {
      const w = Math.max(320, Math.round(width * scale))
      const h = Math.max(320, Math.round(height * scale))
      canvas.width = w
      canvas.height = h
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(draw, 0, 0, w, h)
      for (const q of [0.9, 0.8, 0.7, 0.6]) {
        onProgress?.(`Kompres gambar ${w}×${h} q=${q}`)
        const blob = await encodeCanvas(canvas, 'image/jpeg', q)
        if (blob.size <= maxBytes) {
          const ext = file.name.replace(/.*\./, '') || 'jpg'
          return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.' + ext, { type: 'image/jpeg' })
        }
      }
      scale *= 0.75
    }
    throw Error('Gambar tetap di atas batas setelah kompresi maksimum')
  } finally {
    cleanup()
  }
}

export async function normalizeImage(file: File, onProgress?: (msg: string, pct?: number) => void): Promise<File> {
  console.log(`[normalize] input: ${file.name} type=${file.type} size=${(file.size / 1024).toFixed(1)}KB`)

  if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
    onProgress?.('Mengkonversi HEIC ke JPEG...')
    try {
      const result = await compressImageMultiPass(file, 4 * 1024 * 1024, onProgress)
      console.log(`[normalize] HEIC→JPEG: ${result.name} type=${result.type} size=${(result.size / 1024).toFixed(1)}KB`)
      return result
    } catch (e: any) {
      console.warn(`[normalize] HEIC conversion failed: ${e.message}, trying canvas fallback`)
    }
  }

  const needsConversion = file.type.startsWith('image/') && file.type !== 'image/jpeg' && file.type !== 'image/jpg'
  if (needsConversion) {
    onProgress?.('Mengkonversi ke JPEG...')
    try {
      const { width, height, draw, cleanup } = await loadImage(file)
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')!
        canvas.width = width
        canvas.height = height
        ctx.drawImage(draw, 0, 0, width, height)
        const blob = await encodeCanvas(canvas, 'image/jpeg', 0.92)
        const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg'
        const result = new File([blob], newName, { type: 'image/jpeg' })
        console.log(`[normalize] canvas→JPEG: ${width}×${height} → ${result.name} size=${(result.size / 1024).toFixed(1)}KB`)
        return result
      } finally { cleanup() }
    } catch (e: any) {
      console.warn(`[normalize] Canvas conversion failed: ${e.message}, trying compressImageMultiPass fallback`)
      try {
        const result = await compressImageMultiPass(file, 4 * 1024 * 1024, onProgress)
        console.log(`[normalize] fallback compress: ${result.name} type=${result.type} size=${(result.size / 1024).toFixed(1)}KB`)
        return result
      } catch (e2: any) {
        console.warn(`[normalize] Fallback compression also failed: ${e2.message}, using original`)
      }
    }
  }

  if (file.type.startsWith('image/')) {
    if (file.size > 8 * 1024 * 1024) {
      onProgress?.('Kompres gambar agresif (>8MB)...')
      const result = await compressImageMultiPass(file, 2 * 1024 * 1024, onProgress)
      console.log(`[normalize] compressed >8MB: ${result.name} size=${(result.size / 1024).toFixed(1)}KB`)
      return result
    }
    if (file.size > 4 * 1024 * 1024) {
      onProgress?.('Mengompres gambar (>4MB)...')
      const result = await compressImageMultiPass(file, 3 * 1024 * 1024, onProgress)
      console.log(`[normalize] compressed >4MB: ${result.name} size=${(result.size / 1024).toFixed(1)}KB`)
      return result
    }
  }

  console.log(`[normalize] output: ${file.name} type=${file.type} (unchanged)`)
  return file
}

export async function compressVideo(file: File, maxMb = 4, onProgress?: (msg: string, pct?: number) => void): Promise<File> {
  if (file.size <= maxMb * 1024 * 1024) {
    console.log(`[upload] video ${(file.size / 1024 / 1024).toFixed(1)}MB <= ${maxMb}MB, using original`)
    return file
  }
  console.log(`[upload] video ${(file.size / 1024 / 1024).toFixed(1)}MB > ${maxMb}MB, compressing with FFmpeg...`)
  try {
    const { compressVideoFFmpeg } = await import('./ffmpeg-compress')
    const result = await compressVideoFFmpeg(file, maxMb * 1024 * 1024, onProgress)
    console.log(`[upload] compressed ${(file.size / 1024 / 1024).toFixed(1)}MB → ${(result.size / 1024 / 1024).toFixed(1)}MB`)
    return result.size < file.size ? result : file
  } catch (err: any) {
    console.warn(`[upload] FFmpeg compression failed: ${err.message}, using MediaRecorder fallback`)
    return compressVideoFallback(file, maxMb)
  }
}

function compressVideoFallback(file: File, maxMb: number): Promise<File> {
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
        console.log(`[upload] fallback re-encoded ${(file.size / 1024 / 1024).toFixed(1)}MB → ${(out.size / 1024 / 1024).toFixed(1)}MB`)
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

export async function validateMedia(url: string, kind: string): Promise<string> {
  const res = await fetch('/api/public/validate-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, kind }),
  })
  const data = await res.json().catch(() => ({})) as any
  if (!res.ok || !data.ok) {
    const parts = [data.error, data.contentType ? `content-type=${data.contentType}` : null, data.finalUrl ? `final=${data.finalUrl}` : null].filter(Boolean).join(' · ')
    throw Error(`${kind}: ${parts || `validasi media gagal (${res.status})`}`)
  }
  return url
}

export async function uploadToCatbox(file: File, kind?: string, onProgress?: (msg: string, pct?: number) => void): Promise<string> {
  const sizeStr = file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)}MB` : file.size >= 1024 ? `${(file.size / 1024).toFixed(1)}KB` : `${file.size}B`
  const MAX_SERVER_PROXY = 4 * 1024 * 1024

  function xhrUpload(name: string, url: string, formData: FormData, extractUrl: (res: string, status: number) => string): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      let lastProgress = 0
      let stallTimer: ReturnType<typeof setTimeout> | null = null

      const clearStall = () => {
        if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
      }

      const startStallTimer = () => {
        clearStall()
        stallTimer = setTimeout(() => {
          xhr.abort()
          reject(Error(`${name}: upload tidak bergerak > 45 detik`))
        }, 45000)
      }

      xhr.open('POST', url)
      xhr.timeout = 480000

      xhr.upload.onloadstart = () => startStallTimer()

      xhr.upload.onprogress = (e) => {
        startStallTimer()
        if (e.lengthComputable && e.total > 0) {
          const pct = Math.max(0, Math.min(99, Math.round((e.loaded / e.total) * 100)))
          if (pct !== lastProgress) {
            lastProgress = pct
            onProgress?.(`${name} ${pct}%`, pct)
          }
        } else {
          const loaded = e.loaded >= 1024 * 1024 ? `${(e.loaded / 1024 / 1024).toFixed(1)}MB` : `${(e.loaded / 1024).toFixed(1)}KB`
          onProgress?.(`${name} ${loaded}`)
        }
      }

      xhr.upload.onload = () => {
        clearStall()
        onProgress?.(`${name} selesai, menunggu URL...`)
      }

      xhr.onload = () => {
        clearStall()
        try {
          const text = typeof xhr.responseText === 'string' ? xhr.responseText.trim() : ''
          resolve(extractUrl(text, xhr.status))
        } catch (e: any) {
          reject(e)
        }
      }

      xhr.onerror = () => { clearStall(); reject(Error(`${name}: network/CORS gagal`)) }
      xhr.ontimeout = () => { clearStall(); reject(Error(`${name}: timeout upload`)) }
      xhr.onabort = () => { clearStall(); reject(Error(`${name}: upload dibatalkan`)) }

      startStallTimer()
      xhr.send(formData)
    })
  }

  const uploaders: Array<[string, (f: File) => Promise<string>]> = [
    ['Server', async (f) => {
      const fd = new FormData()
      fd.append('file', new File([f], f.name || 'upload.bin', { type: f.type || 'application/octet-stream' }))
      fd.append('prefer', 'roboneo')
      return xhrUpload('Server', '/api/public/upload-catbox', fd, (text, status) => {
        const data = JSON.parse(text || 'null')
        if (status >= 200 && status < 300 && data?.url) return data.url
        throw Error(data?.error || `Server HTTP ${status}`)
      })
    }],
    ['Uguu', async (f) => {
      const fd = new FormData()
      fd.append('files[]', f, f.name || 'upload.bin')
      return xhrUpload('Uguu', 'https://uguu.se/upload.php', fd, (text, status) => {
        const data = JSON.parse(text || 'null')
        const url = data?.files?.[0]?.url
        if (status >= 200 && status < 300 && url && /^https?:\/\//i.test(url)) return url.replace(/\\\//g, '/')
        throw Error(data?.error || `Uguu HTTP ${status}`)
      })
    }],
    ['Catbox', async (f) => {
      const fd = new FormData()
      fd.append('reqtype', 'fileupload')
      fd.append('fileToUpload', f, f.name || 'upload.bin')
      return xhrUpload('Catbox', 'https://catbox.moe/user/api.php', fd, (text, status) => {
        if (status >= 200 && status < 300 && /^https?:\/\//i.test(text)) return text
        throw Error(text || `Catbox HTTP ${status}`)
      })
    }],
    ['Pixeldrain', async (f) => {
      const fd = new FormData()
      fd.append('file', f, f.name || 'upload.bin')
      return xhrUpload('Pixeldrain', 'https://pixeldrain.com/api/file', fd, (text, status) => {
        const data = JSON.parse(text || 'null')
        if (status >= 200 && status < 300 && data?.id) return `https://pixeldrain.com/api/file/${data.id}`
        throw Error(data?.message || `Pixeldrain HTTP ${status}`)
      })
    }],
    ['0x0', async (f) => {
      const fd = new FormData()
      fd.append('file', f, f.name || 'upload.bin')
      return xhrUpload('0x0', 'https://0x0.st', fd, (text, status) => {
        if (status >= 200 && status < 300 && /^https?:\/\//i.test(text)) return text
        throw Error(text || `0x0 HTTP ${status}`)
      })
    }],
    ['Tmpfiles', async (f) => {
      const fd = new FormData()
      fd.append('file', f, f.name || 'upload.bin')
      return xhrUpload('Tmpfiles', 'https://tmpfiles.org/api/v1/upload', fd, (text, status) => {
        const data = JSON.parse(text || 'null')
        const url = data?.data?.url
        if (status >= 200 && status < 300 && url) return url.replace(/^(https?:\/\/tmpfiles\.org)\/(?!dl\/)/i, '$1/dl/')
        throw Error(data?.error || `Tmpfiles HTTP ${status}`)
      })
    }],
  ]

  const isSmall = file.size <= MAX_SERVER_PROXY
  const ordered = isSmall ? uploaders : uploaders.filter(([n]) => n !== 'Server')

  const errors: string[] = []
  for (const [name, uploader] of ordered) {
    try {
      console.log(`[upload] trying ${name} (${sizeStr}, kind=${kind || 'unknown'})...`)
      onProgress?.(`Upload via ${name} (${sizeStr})...`)
      const url = await uploader(file)
      console.log(`[upload] success via ${name}`)
      onProgress?.(`Upload selesai via ${name}`)
      if (kind) {
        try { await validateMedia(url, kind) } catch (ve: any) {
          console.warn(`[upload] ${name} validation failed: ${ve.message}, using anyway`)
        }
      }
      return url
    } catch (e: any) {
      errors.push(`${name}: ${e.message}`)
      console.warn(`[upload] ${name} failed: ${e.message}`)
      onProgress?.(`${name} gagal: ${e.message}`)
    }
  }
  if (!isSmall) errors.unshift(`skip server proxy (${sizeStr} > ${MAX_SERVER_PROXY / 1024 / 1024}MB)`)
  throw new Error(`Upload gagal: ${errors.join(' | ')}`)
}

const taskMetaMap = new Map<string, { roomId: string; nodeId: string }>()

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
  let lastError = ''
  let lastStatus = 0
  let rawResponse = ''

  for (let attempt = 1; attempt <= 5; attempt++) {
    let res: Response | null = null
    try {
      console.log(`[roboneo] path=${path} attempt=${attempt}`)

      res = await fetch(`/api/public/roboneo`, {
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
    rawResponse = data?.raw || ''

    console.log(`[roboneo] response ok=${data?.ok} path=${path} keys=`, Object.keys(innerData || {}).join(','))

    // If response has useful data, treat as success
    if (innerData.task_id || innerData.room_id) {
      return innerData.parameter ?? innerData
    }

    // If proxy failed to parse but raw contains task_id, parse it manually
    if (rawResponse && rawResponse.includes('task_id')) {
      try {
        const manuallyParsed = JSON.parse(rawResponse.replace(/^data:\s*/, ''))
        if (manuallyParsed.task_id || manuallyParsed.room_id) {
          return manuallyParsed
        }
      } catch {}
    }

    // Retry on HTTP 502/503/504/429
    if (!data?.ok && (status === 502 || status === 503 || status === 504 || status === 429 || status === 0) && attempt < 5) {
      lastError = `HTTP ${status}`
      await new Promise(r => setTimeout(r, 1500 * attempt))
      continue
    }

    // Other errors
    if (!data?.ok && !(innerData.task_id || innerData.room_id)) {
      const errMsg = innerData.error_msg || data?.error || `HTTP ${status}`
      const rawHint = rawResponse ? ` — raw: ${rawResponse.slice(0, 200)}` : ''
      throw new Error(`Roboneo ${path}: ${errMsg}${rawHint}`)
    }

    return innerData.parameter ?? innerData
  }

  const rawHint = rawResponse ? ` — ${rawResponse.slice(0, 200)}` : ''
  throw new Error(`Roboneo ${path}: ${lastError || `HTTP ${lastStatus}`} setelah 5 percobaan${rawHint}`)
}

export async function checkRoboneoBalance(accessToken: string): Promise<{ ok: boolean; balance?: number | null; isValidUser?: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/public/roboneo-membership`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Roboneo-Token': accessToken,
      },
    })

    const data = await res.json().catch(() => null)

    console.log(`[checkBalance] raw response:`, JSON.stringify(data).slice(0, 600))

    if (!data?.ok) {
      const errMsg = data?.message || data?.error || `HTTP ${data?.status ?? res.status}`
      const rawHint = data?.raw ? ` — ${data.raw.slice(0, 200)}` : ''
      return { ok: false, balance: null, error: `${errMsg}${rawHint}` }
    }

    // data.data contains the full gateway response
    const gatewayData = data?.data
    const innerData = gatewayData?.data ?? gatewayData?.result ?? gatewayData

    // Check error_code from gateway
    const errorCode = gatewayData?.error_code ?? innerData?.error_code ?? innerData?.code
    if (errorCode && errorCode !== 0) {
      const errMsg = gatewayData?.error_msg || innerData?.error_msg || innerData?.message || `error_code=${errorCode}`
      return { ok: false, balance: null, error: errMsg }
    }

    // Check is_valid_user
    const isValidUser = innerData?.is_valid_user !== false
    if (!isValidUser) {
      console.log(`[checkBalance] is_valid_user=false`)
      return { ok: false, balance: null, isValidUser: false, error: 'Token tidak valid (is_valid_user=false)' }
    }

    // Parse balance from nested structures
    function findInDetailList(obj: any, pattern: RegExp): number | null {
      if (!obj || typeof obj !== 'object') return null
      const detailList = obj.detail_list
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

    const resultData = innerData
    const cyberBalance = findInDetailList(resultData, /cyber|carrot/i)
    const dailyBalance = findInDetailList(resultData, /daily|free/i)
    const freeCredit = findValueByKey(resultData, ['free_credit', 'free_amount', 'daily_free', 'free']) ?? dailyBalance
    const vipCredit = findValueByKey(resultData, ['vip_credit', 'vip_amount', 'vip'])

    // Prioritize balance_carrots (actual carrots) over credit_balance (cents, needs /100)
    const balanceCarrots = findValueByKey(resultData, ['balance_carrots', 'balanceCarrots'])
    const creditBalanceRaw = findValueByKey(resultData, ['credit_balance', 'creditBalance', 'total_amount', 'total_credit', 'balance', 'credit', 'remain', 'point', 'coin', 'energy', 'quota'])
    // If credit_balance looks like cents (>1000), divide by 100
    const creditBalance = creditBalanceRaw !== null && creditBalanceRaw > 1000 ? Math.round(creditBalanceRaw / 100) : creditBalanceRaw
    const totalCredit = balanceCarrots ?? creditBalance ?? cyberBalance ?? ((freeCredit ?? 0) + (vipCredit ?? 0) || null)

    console.log(`[checkBalance] OK: balance_carrots=${balanceCarrots}, credit_balance_raw=${creditBalanceRaw}, creditBalance=${creditBalance}, cyber=${cyberBalance}, free=${freeCredit}, vip=${vipCredit}, total=${totalCredit}, isValidUser=${isValidUser}`)

    return { ok: true, balance: totalCredit, isValidUser: true }
  } catch (err: any) {
    console.error('[checkBalance] catch error:', err.message)
    return { ok: false, balance: null, error: err.message }
  }
}

export async function checkRoboneoTokensBatch(tokens: string[]): Promise<
  Array<{ token: string; balance: number | null; isValidUser: boolean; error?: string; ok: boolean }>
> {
  const results = await Promise.all(
    tokens.map(async (token) => {
      try {
        const res = await fetch(`/api/public/roboneo-membership`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Roboneo-Token': token,
          },
        })

        const data = await res.json().catch(() => null)

        if (!data?.ok) {
          const errMsg = data?.message || data?.error || `HTTP ${data?.status ?? res.status}`
          const rawHint = data?.raw ? ` — ${data.raw.slice(0, 200)}` : ''
          return { token, ok: false, balance: null, isValidUser: false, error: `${errMsg}${rawHint}` }
        }

        const gatewayData = data?.data
        const innerData = gatewayData?.data ?? gatewayData?.result ?? gatewayData

        const errorCode = gatewayData?.error_code ?? innerData?.error_code ?? innerData?.code
        if (errorCode && errorCode !== 0) {
          const errMsg = gatewayData?.error_msg || innerData?.error_msg || innerData?.message || `error_code=${errorCode}`
          return { token, ok: false, balance: null, isValidUser: false, error: errMsg }
        }

        const isValidUser = innerData?.is_valid_user !== false
        if (!isValidUser) {
          return { token, ok: false, balance: null, isValidUser: false, error: 'Token tidak valid (is_valid_user=false)' }
        }

        function findInDetailList(obj: any, pattern: RegExp): number | null {
          if (!obj || typeof obj !== 'object') return null
          const detailList = obj.detail_list
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

        const resultData = innerData
        const cyberBalance = findInDetailList(resultData, /cyber|carrot/i)
        const dailyBalance = findInDetailList(resultData, /daily|free/i)
        const freeCredit = findValueByKey(resultData, ['free_credit', 'free_amount', 'daily_free', 'free']) ?? dailyBalance
        const vipCredit = findValueByKey(resultData, ['vip_credit', 'vip_amount', 'vip'])
        const totalCredit = findValueByKey(resultData, ['total_amount', 'total_credit', 'credit_balance', 'balance', 'credit', 'remain', 'point', 'coin', 'energy', 'quota']) ?? cyberBalance ?? ((freeCredit ?? 0) + (vipCredit ?? 0) || null)

        return { token, ok: true, balance: totalCredit, isValidUser: true }
      } catch (err: any) {
        return { token, ok: false, balance: null, isValidUser: false, error: err.message }
      }
    })
  )

  return results
}

export async function createRoboneoRoom(accessToken: string): Promise<{ roomId: string }> {
  const tracking = buildTrackingParams(accessToken, 'createroom', '')
  const { _access_token, ...paramWithoutToken } = tracking

  const parameter = {
    ...paramWithoutToken,
    room_type: 1,
  }

  const result = await roboneoApiCall(accessToken, 'createroom', parameter)
  const roomId = result?.room_id
  if (!roomId) {
    throw new Error('Roboneo createroom: room_id tidak ditemukan. Response: ' + JSON.stringify(result).slice(0, 300))
  }
  return { roomId }
}

export async function submitMotionControl(params: {
  accessToken: string
  imageUrl: string
  videoUrl: string
  prompt?: string
  negativePrompt?: string
  orientation?: string
  keepSound?: boolean
  modelKey?: string
}): Promise<{ taskId: string; roomId: string; nodeId: string }> {
  const { accessToken, imageUrl, videoUrl, prompt = '', negativePrompt, orientation = 'video', keepSound = true, modelKey } = params

  const roomId = generateRoomId()
  const nodeId = uuid()

  const motionPrompt = prompt || `Refer to the movements and facial expressions in the video to animate photos without changing the original background.`
  const fullPrompt = negativePrompt
    ? `${motionPrompt}\n\nNegative: ${negativePrompt}`
    : motionPrompt

  const motionNodeMap: Record<string, { name: string; label: string }> = {
    'rn:video_bonbon_motioncontrol_v30:std': { name: 'video_bonbon_motioncontrol_v30', label: 'Kling 3.0 Standard' },
    'rn:video_bonbon_motioncontrol_v30:pro': { name: 'video_bonbon_motioncontrol_v30', label: 'Kling 3.0 Pro' },
    'rn:video_wan_motioncontrol_v26': { name: 'video_wan_motioncontrol_v26', label: 'Wan 2.6 Motion Control' },
  }

  const motionConfig = motionNodeMap[modelKey || ''] || { name: 'video_bonbon_motioncontrol_v30', label: 'Kling 3.0' }

  const parameters: Record<string, any> = {
    image_url: imageUrl,
    video_url: videoUrl,
    prompt: fullPrompt,
    character_orientation: orientation || 'video',
    cfg_scale: 0.5,
    random: `${Date.now()}-${Math.floor(1e7 + Math.random() * 89999999)}`,
  }

  const node = {
    tool_abstract_name: { cn: motionConfig.label, en: motionConfig.label },
    node_id: nodeId,
    name: motionConfig.name,
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
    : payload?.task_id
    ? [payload.task_id]
    : Object.keys(payload?.tasks || {})

  if (!taskIds.length) {
    throw new Error('Roboneo Motion Control: task_id tidak ditemukan. Response: ' + JSON.stringify(payload).slice(0, 300))
  }

  taskMetaMap.set(taskIds[0], { roomId, nodeId })
  return { taskId: taskIds[0], roomId, nodeId }
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
  'rn:wan-26': { apiName: 'video_wan_i2v_v26', toolLabel: 'Wan 2.6', family: 'wan' },
  'rn:wan-26-std': { apiName: 'video_wan_i2v_v26', toolLabel: 'Wan 2.6 Standard', family: 'wan' },
  'rn:sora-2': { apiName: 'video_sora_i2v_v2', toolLabel: 'Sora 2', family: 'sora' },
  'rn:veo-3': { apiName: 'video_veo_i2v_v3', toolLabel: 'VEO 3.0', family: 'veo' },
  'rn:veo-3-fast': { apiName: 'video_veo_i2v_v3_fast', toolLabel: 'VEO 3.0 Fast', family: 'veo' },
}

export async function submitRoboneoI2V(params: {
  accessToken: string
  imageUrl: string
  prompt?: string
  modelKey: string
  modelVersion?: string
  ratio?: string
  duration?: number
  resolution?: string
  sound?: string
  quality?: string
}): Promise<{ taskId: string; roomId: string; nodeId: string }> {
  const { accessToken, imageUrl, prompt = '', modelKey, modelVersion, ratio = '9:16', duration = 5, resolution, sound, quality } = params

  const modelLower = modelKey.toLowerCase()
  const defaultByVersion = modelVersion === 'v21'
    ? { apiName: 'video_bonbon_kling_v21', toolLabel: 'Kling 2.1', family: 'legacy21' }
    : { apiName: 'video_bonbon_img2vid_v26', recipeCode: 'xd_pUp8JDcE0', toolLabel: 'Kling 2.6', family: 'kling26' }
  const modelConfig = ROBONEO_I2V_MODELS[modelLower] || defaultByVersion

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
    case 'wan':
      parameters.ratio = ratio
      parameters.video_duration = duration
      parameters.resolution = resolution || '720p'
      parameters.sound = sound || 'off'
      break
    case 'sora':
      parameters.ratio = ratio
      parameters.video_duration = duration
      parameters.resolution = resolution || '720p'
      break
    case 'veo':
      parameters.ratio = ratio
      parameters.video_duration = duration
      parameters.resolution = resolution || '720p'
      break
    default:
      parameters.ratio = ratio
      parameters.duration = duration
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
    : payload?.task_id
    ? [payload.task_id]
    : Object.keys(payload?.tasks || {})

  if (!taskIds.length) {
    throw new Error(`Roboneo ${modelConfig.toolLabel}: task_id tidak ditemukan. Response: ` + JSON.stringify(payload).slice(0, 300))
  }

  taskMetaMap.set(taskIds[0], { roomId, nodeId })
  return { taskId: taskIds[0], roomId, nodeId }
}

export async function submitGoogleOmni(params: {
  accessToken: string
  imageUrl: string
  prompt?: string
  ratio?: string
  videoDuration?: number
}): Promise<{ taskId: string; roomId: string; nodeId: string }> {
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
    : payload?.task_id
    ? [payload.task_id]
    : Object.keys(payload?.tasks || {})

  if (!taskIds.length) {
    throw new Error('Roboneo Google Omni: task_id tidak ditemukan. Response: ' + JSON.stringify(payload).slice(0, 300))
  }

  taskMetaMap.set(taskIds[0], { roomId, nodeId })
  return { taskId: taskIds[0], roomId, nodeId }
}

export async function submitRoboneoImage(params: {
  accessToken: string
  prompt: string
  modelKey: string
  aspectRatio?: string
  negativePrompt?: string
  width?: number
  height?: number
}): Promise<{ taskId: string; roomId: string; nodeId: string }> {
  const { accessToken, prompt, modelKey, aspectRatio = '1:1', negativePrompt, width = 1024, height = 1024 } = params

  const modelLower = modelKey.toLowerCase()
  const modelConfig: Record<string, { apiName: string; toolLabel: string; family: string }> = {
    'rn:nano-banana-2': { apiName: 'gemini-nano-banana-2', toolLabel: 'Gemini Nano Banana 2', family: 'nano-banana' },
    'rn:gemini-3.1': { apiName: 'gemini-3-1-image', toolLabel: 'Gemini 3.1', family: 'gemini' },
    'rn:flux-kontext': { apiName: 'flux-kontext-image', toolLabel: 'Flux Kontext', family: 'flux' },
    'rn:gpt-image-2': { apiName: 'gpt-image-2', toolLabel: 'GPT Image 2', family: 'gpt' },
  }
  const config = modelConfig[modelLower] || modelConfig['rn:nano-banana-2']

  const roomId = generateRoomId()
  const nodeId = uuid()

  const parameters: Record<string, any> = {
    prompt: prompt || '',
    negative_prompt: negativePrompt || '',
    width,
    height,
    aspect_ratio: aspectRatio,
    random: `${Date.now()}-${Math.floor(1e7 + Math.random() * 89999999)}`,
  }

  const node = {
    tool_abstract_name: { cn: config.toolLabel, en: config.toolLabel },
    node_id: nodeId,
    name: config.apiName,
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
    : payload?.task_id
    ? [payload.task_id]
    : Object.keys(payload?.tasks || {})

  if (!taskIds.length) {
    throw new Error(`Roboneo ${config.toolLabel}: task_id tidak ditemukan. Response: ` + JSON.stringify(payload).slice(0, 300))
  }

  taskMetaMap.set(taskIds[0], { roomId, nodeId })
  return { taskId: taskIds[0], roomId, nodeId }
}

export async function submitRoboneoT2V(params: {
  accessToken: string
  prompt: string
  modelKey: string
  ratio?: string
  duration?: number
  resolution?: string
  sound?: string
}): Promise<{ taskId: string; roomId: string; nodeId: string }> {
  const { accessToken, prompt, modelKey, ratio = '9:16', duration = 5, resolution, sound } = params

  const modelLower = modelKey.toLowerCase()
  const modelConfig = ROBONEO_I2V_MODELS[modelLower] || { apiName: 'video_toffee_i2v_v20', toolLabel: 'Seedance 2.0', family: 'seedance' }

  const roomId = generateRoomId()
  const nodeId = uuid()

  const parameters: Record<string, any> = {
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
    case 'wan':
      parameters.ratio = ratio
      parameters.video_duration = duration
      parameters.resolution = resolution || '720p'
      parameters.sound = sound || 'off'
      break
    case 'sora':
      parameters.ratio = ratio
      parameters.video_duration = duration
      parameters.resolution = resolution || '720p'
      break
    case 'veo':
      parameters.ratio = ratio
      parameters.video_duration = duration
      parameters.resolution = resolution || '720p'
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
    case 'kling26':
      parameters.sound = sound || 'off'
      parameters.video_duration = duration
      break
    case 'legacy21':
      parameters.ratio = ratio
      parameters.video_duration = duration
      parameters.sound = sound || 'off'
      break
    case 'omni':
      parameters.ratio = ratio
      parameters.video_duration = duration
      break
    default:
      parameters.ratio = ratio
      parameters.duration = duration
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
    : payload?.task_id
    ? [payload.task_id]
    : Object.keys(payload?.tasks || {})

  if (!taskIds.length) {
    throw new Error(`Roboneo ${modelConfig.toolLabel}: task_id tidak ditemukan. Response: ` + JSON.stringify(payload).slice(0, 300))
  }

  taskMetaMap.set(taskIds[0], { roomId, nodeId })
  return { taskId: taskIds[0], roomId, nodeId }
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
  const meta = taskMetaMap.get(taskId)
  const resolvedRoomId = roomId || meta?.roomId || ''
  const resolvedNodeId = nodeId || meta?.nodeId || ''
  const startTime = Date.now()
  let networkRetries = 0
  let busyRetries = 0
  let successNoOutputCount = 0
  const MAX_SUCCESS_NO_OUTPUT = 5
  const MAX_BUSY_RETRIES = 15

  function tryParseJson(str: any): any {
    if (typeof str !== 'string') return str
    const t = str.trim()
    if (!t || (!t.startsWith('{') && !t.startsWith('[') && !t.startsWith('"'))) return str
    try {
      const parsed = JSON.parse(t)
      return typeof parsed === 'string' && parsed !== str ? tryParseJson(parsed) : parsed
    } catch { return str }
  }

  function cleanUrl(u: string): string {
    return u.replace(/\\\//g, '/').replace(/\\u002F/gi, '/').replace(/&amp;/g, '&')
  }

  function extractUrlsFromString(str: string): string[] {
    const cleaned = cleanUrl(str)
    const matches = cleaned.match(/(?:https?:)?\/\/[^\s"'<>\\]+/gi) || []
    return matches.map((u) => (u.startsWith('//') ? `https:${u}` : u).replace(/[),.;\]]+$/g, ''))
  }

  function resolveUrls(obj: any, depth = 0): string[] {
    if (depth > 8 || !obj || typeof obj !== 'object') return []
    obj = tryParseJson(obj)
    if (typeof obj === 'string') {
      let urls: string[] = []
      if (/^https?:\/\//i.test(obj)) {
        urls = [obj]
      } else {
        urls = extractUrlsFromString(obj)
      }
      return urls
    }
    const urls: string[] = []
    const urlKeys = 'url,uri,src,href,last_image_url,lastImageUrl,media_url,mediaUrl,image_url,imageUrl,video_url,videoUrl,file_url,fileUrl,asset_url,assetUrl,origin_url,originUrl,original_url,originalUrl,preview_url,previewUrl,source_url,sourceUrl,output_url,outputUrl,download_url,downloadUrl,signed_url,signedUrl,play_url,playUrl,cover_url,coverUrl'
    for (const key of urlKeys.split(',')) {
      const val = obj[key]
      if (typeof val === 'string' && /^https?:\/\//i.test(val)) urls.push(val)
      else if (typeof val === 'string' && /^\/\//.test(val)) urls.push(`https:${val}`)
      else if (typeof val === 'string') urls.push(...extractUrlsFromString(val))
    }
    for (const val of Object.values(obj)) {
      urls.push(...resolveUrls(val, depth + 1))
    }
    return [...new Set(urls)]
  }

  function findVideoUrl(...sources: any[]): string | null {
    const all = [...new Set(sources.flatMap((s) => resolveUrls(s)))]
    return all.find((u) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u)) ||
      all.find((u) => /video|mp4|mov|webm|m4v|vod|tos|myqcloud|aliyun|oss|roboneo/i.test(u)) ||
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

  function findDeepError(obj: any, depth = 0): string | null {
    if (depth > 8 || !obj || typeof obj !== 'object') return null
    if (typeof obj === 'string') return null
    for (const key of ['task_status_msg', 'error_message', 'error_msg', 'message', 'msg', 'reason', 'fail_reason', 'fail_msg', 'tips', 'fail_code']) {
      const val = obj[key]
      if (typeof val === 'string' && val.trim()) return val.trim()
    }
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findDeepError(item, depth + 1)
        if (found) return found
      }
      return null
    }
    for (const val of Object.values(obj)) {
      const found = findDeepError(val, depth + 1)
      if (found) return found
    }
    return null
  }

  let lastLog = ''

  while (Date.now() - startTime < timeoutMs) {
    if (signal?.aborted) throw new Error('Generation cancelled')
    await new Promise((r) => setTimeout(r, 4000))

    let result: any
    try {
      const tracking = buildTrackingParams(accessToken, 'historydetail', resolvedRoomId)
      const { _access_token, ...paramWithoutToken } = tracking

      result = await roboneoApiCall(accessToken, 'historydetail/historydetail', {
        ...paramWithoutToken,
        room_id: resolvedRoomId,
        body: '',
        features: '',
        later_face: 0,
      })
      networkRetries = 0
    } catch (err: any) {
      if (/HTTP (502|503|504|429)|upstream|connection|network|timeout|TIMEOUT|parse|Failed to/i.test(err.message)) {
        networkRetries++
        if (networkRetries >= 15) throw err
        console.log(`[roboneo] poll retry ${networkRetries}: ${err.message.slice(0, 100)}`)
        onProgress?.(`retrying (${networkRetries})`, Math.round(5 + (Date.now() - startTime) / 6000))
        continue
      }
      throw err
    }

    const payload = result
    const isComplete = payload?.is_complete === true
    const nextAction = payload?.next_action
    const action = String(nextAction?.action || 'poll').toLowerCase()
    const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : []
    const items = Array.isArray(payload?.items) ? payload.items : []

    const elapsedMin = (Date.now() - startTime) / (8 * 60000)
    const fallbackPct = Math.min(0.94, 1 - 1 / (1 + elapsedMin * 1.6))
    let pct = Math.round(5 + fallbackPct * 89)

    for (const item of items) {
      const p = extractProgressLocal(item)
      if (p !== null) { pct = p; break }
    }

    onProgress?.(action === 'poll' ? 'processing' : action, pct)

    const logEntry = `poll #${Math.round((Date.now() - startTime) / 1000)}s action=${action} complete=${isComplete} artifacts=${artifacts.length} items=${items.length}`
    if (logEntry !== lastLog) {
      lastLog = logEntry
      console.log(`[roboneo] ${logEntry}`)
    }

    if (action === 'done' || action === 'completed') {
      for (const art of artifacts) {
        const videoUrl = findVideoUrl(art)
        if (videoUrl) {
          taskMetaMap.delete(taskId)
          return videoUrl
        }
      }
      for (const item of items) {
        const videoUrl = findVideoUrl(item)
        if (videoUrl) {
          taskMetaMap.delete(taskId)
          return videoUrl
        }
      }
      const videoUrl = findVideoUrl(payload)
      if (videoUrl) {
        taskMetaMap.delete(taskId)
        return videoUrl
      }

      successNoOutputCount++
      if (successNoOutputCount >= MAX_SUCCESS_NO_OUTPUT) {
        throw new Error(`Roboneo: task selesai tapi URL output tidak ditemukan`)
      }
      onProgress?.('finalizing', Math.max(pct, 96))
      await new Promise(r => setTimeout(r, 4000))
      continue
    }

    if (action === 'recharge') {
      const rechargeContent = nextAction?.extra?.recharge?.content || 'Saldo tidak cukup'
      taskMetaMap.delete(taskId)
      throw new Error(`Roboneo: ${rechargeContent}`)
    }

    if (action === 'fail' || action === 'error') {
      const errMsg = findDeepError(payload) || findDeepError(nextAction) || 'unknown error'
      taskMetaMap.delete(taskId)
      throw new Error(`Roboneo failed: ${errMsg}`)
    }

    busyRetries = 0
  }

  throw new Error('Roboneo timeout')
}

export async function pollRoboneoI2V(
  accessToken: string,
  taskId: string,
  roomId: string,
  onProgress?: (status: string, pct: number) => void,
  timeoutMs = 3600000,
  signal?: AbortSignal,
  nodeId?: string
): Promise<string> {
  const meta = taskMetaMap.get(taskId)
  const resolvedRoomId = roomId || meta?.roomId || ''
  const resolvedNodeId = nodeId || meta?.nodeId || ''
  const startTime = Date.now()
  let networkRetries = 0
  let busyRetries = 0
  let successNoOutputCount = 0
  const MAX_SUCCESS_NO_OUTPUT = 5
  const MAX_BUSY_RETRIES = 15

  function tryParseJson(str: any): any {
    if (typeof str !== 'string') return str
    const t = str.trim()
    if (!t || (!t.startsWith('{') && !t.startsWith('[') && !t.startsWith('"'))) return str
    try {
      const parsed = JSON.parse(t)
      return typeof parsed === 'string' && parsed !== str ? tryParseJson(parsed) : parsed
    } catch { return str }
  }

  function cleanUrl(u: string): string {
    return u.replace(/\\\//g, '/').replace(/\\u002F/gi, '/').replace(/&amp;/g, '&')
  }

  function extractUrlsFromString(str: string): string[] {
    const cleaned = cleanUrl(str)
    const matches = cleaned.match(/(?:https?:)?\/\/[^\s"'<>\\]+/gi) || []
    return matches.map((u) => (u.startsWith('//') ? `https:${u}` : u).replace(/[),.;\]]+$/g, ''))
  }

  function resolveUrls(obj: any, depth = 0): string[] {
    if (depth > 8 || !obj || typeof obj !== 'object') return []
    obj = tryParseJson(obj)
    if (typeof obj === 'string') {
      let urls: string[] = []
      if (/^https?:\/\//i.test(obj)) {
        urls = [obj]
      } else {
        urls = extractUrlsFromString(obj)
      }
      return urls
    }
    const urls: string[] = []
    const urlKeys = 'url,uri,src,href,last_image_url,lastImageUrl,media_url,mediaUrl,image_url,imageUrl,video_url,videoUrl,file_url,fileUrl,asset_url,assetUrl,origin_url,originUrl,original_url,originalUrl,preview_url,previewUrl,source_url,sourceUrl,output_url,outputUrl,download_url,downloadUrl,signed_url,signedUrl,play_url,playUrl,cover_url,coverUrl'
    for (const key of urlKeys.split(',')) {
      const val = obj[key]
      if (typeof val === 'string' && /^https?:\/\//i.test(val)) urls.push(val)
      else if (typeof val === 'string' && /^\/\//.test(val)) urls.push(`https:${val}`)
      else if (typeof val === 'string') urls.push(...extractUrlsFromString(val))
    }
    for (const val of Object.values(obj)) {
      urls.push(...resolveUrls(val, depth + 1))
    }
    return [...new Set(urls)]
  }

  function findVideoUrl(...sources: any[]): string | null {
    const all = [...new Set(sources.flatMap((s) => resolveUrls(s)))]
    return all.find((u) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(u)) ||
      all.find((u) => /video|mp4|mov|webm|m4v|vod|tos|myqcloud|aliyun|oss|roboneo/i.test(u)) ||
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

  function findDeepError(obj: any, depth = 0): string | null {
    if (depth > 8 || !obj || typeof obj !== 'object') return null
    if (typeof obj === 'string') return null
    for (const key of ['task_status_msg', 'error_message', 'error_msg', 'message', 'msg', 'reason', 'fail_reason', 'fail_msg', 'tips', 'fail_code']) {
      const val = obj[key]
      if (typeof val === 'string' && val.trim()) return val.trim()
    }
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findDeepError(item, depth + 1)
        if (found) return found
      }
      return null
    }
    for (const val of Object.values(obj)) {
      const found = findDeepError(val, depth + 1)
      if (found) return found
    }
    return null
  }

  let lastLog = ''

  while (Date.now() - startTime < timeoutMs) {
    if (signal?.aborted) throw new Error('Generation cancelled')
    await new Promise((r) => setTimeout(r, 4000))

    let result: any
    try {
      const tracking = buildTrackingParams(accessToken, 'nodeexecutequery', resolvedRoomId)
      const { _access_token, ...paramWithoutToken } = tracking

      result = await roboneoApiCall(accessToken, 'nodeexecutequery', {
        ...paramWithoutToken,
        task_ids: [taskId],
        ...(resolvedRoomId ? { room_id: resolvedRoomId } : {}),
        ...(resolvedNodeId ? { node_id: resolvedNodeId, workflow_version: 'v2' } : {}),
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
    const successfulStep = steps.find((s: any) => /success|succeeded|completed|done|finished/i.test(String(s.status || s.state || ''))) || steps[0]
    const stepOutputs = steps.map((s: any) => tryParseJson(s.output))
    const successfulOutput = tryParseJson(successfulStep?.output)
    const taskState = String(task?.state || task?.status || successfulStep?.status || successfulStep?.state || '').toLowerCase()
    const status = taskState || 'processing'
    const realPct = extractProgressLocal(task) ?? extractProgressLocal(successfulOutput) ?? extractProgressLocal(payload)
    const elapsedMin = (Date.now() - startTime) / (8 * 60000)
    const fallbackPct = Math.min(0.94, 1 - 1 / (1 + elapsedMin * 1.6))
    const pct = realPct === null ? Math.round(5 + fallbackPct * 89) : Math.round(realPct)

    onProgress?.(status || 'processing', pct)

    const logEntry = `poll-i2v #${Math.round((Date.now() - startTime) / 1000)}s state=${status} pct=${pct}`
    if (logEntry !== lastLog) {
      lastLog = logEntry
      console.log(`[roboneo] ${logEntry}`)
    }

    const isSuccess = ['success', 'succeeded', 'completed', 'done', 'finished'].includes(status)
    const isFailed = ['fail', 'failed', 'error', 'cancelled', 'canceled'].includes(status)

    if (isSuccess) {
      const mediaInfo = task?.media_info_list?.[0] || payload?.media_info_list?.[0]
      const videoUrl = findVideoUrl(
        task?.last_image_url, task?.last_image_urls,
        task?.initial_transferred_urls, task?.media_meta, task?.media_metas,
        mediaInfo?.url, mediaInfo?.media_url,
        ...stepOutputs, successfulOutput,
        payload?.output, payload?.result, payload,
        payload?.data, task?.data, task?.output_url, task?.download_url,
        task?.result_url, task?.video, task?.video_url, task?.media,
        task?.url, task?.src, task?.link, task?.href, task?.path
      )

      if (videoUrl) {
        if (/meitudata\.com/i.test(videoUrl)) {
          try {
            onProgress?.('Re-uploading to permanent storage...', 98)
            const proxyUrl = `/api/public/video-proxy?url=${encodeURIComponent(videoUrl)}`
            const videoRes = await fetch(proxyUrl)
            if (videoRes.ok) {
              const blob = await videoRes.blob()
              const fd = new FormData()
              fd.append('file', new File([blob], 'video.mp4', { type: 'video/mp4' }))
              const uploadRes = await fetch('/api/public/upload-catbox', { method: 'POST', body: fd })
              const uploadData = await uploadRes.json().catch(() => ({})) as any
              if (uploadData?.url) {
                console.log(`[roboneo] re-uploaded to permanent: ${uploadData.url}`)
                taskMetaMap.delete(taskId)
                return uploadData.url
              }
            }
          } catch (reErr: any) {
            console.log(`[roboneo] re-upload failed: ${reErr.message}, using original URL`)
          }
        }
        taskMetaMap.delete(taskId)
        return videoUrl
      }

      const stepError = steps.find((s: any) => /fail|error/i.test(String(s.status || s.state || '')))
      if (stepError) {
        const stepErr = stepError.error_message || stepError.error_msg || stepError.fail_code || 'step error'
        taskMetaMap.delete(taskId)
        throw new Error(`Roboneo failed (quota/step): ${stepErr}`)
      }

      successNoOutputCount++
      if (successNoOutputCount >= MAX_SUCCESS_NO_OUTPUT) {
        const detail = JSON.stringify({ taskKeys: Object.keys(task || {}), stepKeys: steps.map((s: any) => Object.keys(s)), responseKeys: Object.keys(payload || {}), urlCount: resolveUrls({ task, output: stepOutputs, response: payload }).length }).slice(0, 400)
        throw new Error(`Roboneo credit/quota habis: task selesai (${status}) tapi URL output tidak ditemukan (${detail})`)
      }

      onProgress?.(`finalizing`, Math.max(pct, 96))
      await new Promise(r => setTimeout(r, 4000))
      continue
    }

    if (isFailed) {
      const failedStep = steps.find((s: any) => /fail|error/i.test(String(s.status || s.state || '')))
      const stepOutput = failedStep?.output
      const errMsg = task?.error_message || task?.error_msg || failedStep?.error_message || failedStep?.error_msg ||
        (typeof stepOutput?.error_message === 'string' ? stepOutput.error_message : undefined) ||
        (typeof stepOutput?.error_msg === 'string' ? stepOutput.error_msg : undefined) ||
        findDeepError(task) || findDeepError(payload) || findDeepError(stepOutput) ||
        failedStep?.fail_code || 'unknown'
      const taskErrorCode = task?.error_code ?? failedStep?.fail_code ?? stepOutput?.error_code ?? stepOutput?.code
      const detail = JSON.stringify({ status, taskErrorCode, failCode: failedStep?.fail_code, stepStatus: failedStep?.status || failedStep?.state, output: stepOutput }).slice(0, 500)

      const isBusy = taskErrorCode === 6 || /busy|sibuk|try again|later|overload|capacity|queue|结果接口获取失败/i.test(errMsg)
      const isChargeFailed = /CHARGE_FAILED|charge.?failed|余额不足|余额不够|积分不足|账户余额|欠费/i.test(errMsg) || taskErrorCode === 'CHARGE_FAILED'
      const isFormatError = isRoboneoFormatError(errMsg)
      if (isBusy && busyRetries < MAX_BUSY_RETRIES) {
        busyRetries++
        const waitSec = Math.min(5 + busyRetries * 2, 20)
        console.log(`[roboneo] busy (code=${taskErrorCode}), retry ${busyRetries}/${MAX_BUSY_RETRIES}, waiting ${waitSec}s...`)
        onProgress?.(`server sibuk, retry ${busyRetries}/${MAX_BUSY_RETRIES}`, pct)
        await new Promise(r => setTimeout(r, waitSec * 1000))
        continue
      }

      if (isChargeFailed) {
        taskMetaMap.delete(taskId)
        throw new Error(`Roboneo: saldo tidak cukup untuk biaya ini (CHARGE_FAILED). Detail: ${detail}`)
      }

      if (isFormatError) {
        taskMetaMap.delete(taskId)
        throw new Error(`Roboneo format error: Gambar tidak dapat dibaca oleh server. Coba upload ulang gambar atau format berbeda. Detail: ${errMsg} ${detail}`)
      }

      taskMetaMap.delete(taskId)
      throw new Error(`Roboneo failed: ${errMsg}${detail ? ` · detail=${detail}` : ''}`)
    }

    busyRetries = 0
  }

  throw new Error('Roboneo timeout')
}

export async function pollRoboneoImage(
  accessToken: string,
  taskId: string,
  roomId: string,
  onProgress?: (status: string, pct: number) => void,
  timeoutMs = 3600000,
  signal?: AbortSignal,
  nodeId?: string
): Promise<string> {
  const meta = taskMetaMap.get(taskId)
  const resolvedRoomId = roomId || meta?.roomId || ''
  const resolvedNodeId = nodeId || meta?.nodeId || ''
  const startTime = Date.now()
  let networkRetries = 0
  let busyRetries = 0
  let successNoOutputCount = 0
  const MAX_SUCCESS_NO_OUTPUT = 5
  const MAX_BUSY_RETRIES = 15

  function tryParseJson(str: any): any {
    if (typeof str !== 'string') return str
    const t = str.trim()
    if (!t || (!t.startsWith('{') && !t.startsWith('[') && !t.startsWith('"'))) return str
    try {
      const parsed = JSON.parse(t)
      return typeof parsed === 'string' && parsed !== str ? tryParseJson(parsed) : parsed
    } catch { return str }
  }

  function cleanUrl(u: string): string {
    return u.replace(/\\\//g, '/').replace(/\\u002F/gi, '/').replace(/&amp;/g, '&')
  }

  function extractUrlsFromString(str: string): string[] {
    const cleaned = cleanUrl(str)
    const matches = cleaned.match(/(?:https?:)?\/\/[^\s"'<>\\]+/gi) || []
    return matches.map((u) => (u.startsWith('//') ? `https:${u}` : u).replace(/[),.;\]]+$/g, ''))
  }

  function resolveUrls(obj: any, depth = 0): string[] {
    if (depth > 8 || !obj || typeof obj !== 'object') return []
    obj = tryParseJson(obj)
    if (typeof obj === 'string') {
      let urls: string[] = []
      if (/^https?:\/\//i.test(obj)) {
        urls = [obj]
      } else {
        urls = extractUrlsFromString(obj)
      }
      return urls
    }
    const urls: string[] = []
    const urlKeys = 'url,uri,src,href,last_image_url,lastImageUrl,media_url,mediaUrl,image_url,imageUrl,video_url,videoUrl,file_url,fileUrl,asset_url,assetUrl,origin_url,originUrl,original_url,originalUrl,preview_url,previewUrl,source_url,sourceUrl,output_url,outputUrl,download_url,downloadUrl,signed_url,signedUrl,play_url,playUrl,cover_url,coverUrl'
    for (const key of urlKeys.split(',')) {
      const val = obj[key]
      if (typeof val === 'string' && /^https?:\/\//i.test(val)) urls.push(val)
      else if (typeof val === 'string' && /^\/\//.test(val)) urls.push(`https:${val}`)
      else if (typeof val === 'string') urls.push(...extractUrlsFromString(val))
    }
    for (const val of Object.values(obj)) {
      urls.push(...resolveUrls(val, depth + 1))
    }
    return [...new Set(urls)]
  }

  function findImageUrl(...sources: any[]): string | null {
    const all = [...new Set(sources.flatMap((s) => resolveUrls(s)))]
    return all.find((u) => /\.(jpg|jpeg|png|webp|gif)(\?|#|$)/i.test(u)) ||
      all.find((u) => /image|img|photo|picture|generation|output/i.test(u)) ||
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

  function findDeepError(obj: any, depth = 0): string | null {
    if (depth > 8 || !obj || typeof obj !== 'object') return null
    if (typeof obj === 'string') return null
    for (const key of ['task_status_msg', 'error_message', 'error_msg', 'message', 'msg', 'reason', 'fail_reason', 'fail_msg', 'tips', 'fail_code']) {
      const val = obj[key]
      if (typeof val === 'string' && val.trim()) return val.trim()
    }
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findDeepError(item, depth + 1)
        if (found) return found
      }
      return null
    }
    for (const val of Object.values(obj)) {
      const found = findDeepError(val, depth + 1)
      if (found) return found
    }
    return null
  }

  let lastLog = ''

  while (Date.now() - startTime < timeoutMs) {
    if (signal?.aborted) throw new Error('Generation cancelled')
    await new Promise((r) => setTimeout(r, 4000))

    let result: any
    try {
      const tracking = buildTrackingParams(accessToken, 'nodeexecutequery', resolvedRoomId)
      const { _access_token, ...paramWithoutToken } = tracking

      result = await roboneoApiCall(accessToken, 'nodeexecutequery', {
        ...paramWithoutToken,
        task_ids: [taskId],
        ...(resolvedRoomId ? { room_id: resolvedRoomId } : {}),
        ...(resolvedNodeId ? { node_id: resolvedNodeId, workflow_version: 'v2' } : {}),
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
    const successfulStep = steps.find((s: any) => /success|succeeded|completed|done|finished/i.test(String(s.status || s.state || ''))) || steps[0]
    const stepOutputs = steps.map((s: any) => tryParseJson(s.output))
    const successfulOutput = tryParseJson(successfulStep?.output)
    const taskState = String(task?.state || task?.status || successfulStep?.status || successfulStep?.state || '').toLowerCase()
    const status = taskState || 'processing'
    const realPct = extractProgressLocal(task) ?? extractProgressLocal(successfulOutput) ?? extractProgressLocal(payload)
    const elapsedMin = (Date.now() - startTime) / (8 * 60000)
    const fallbackPct = Math.min(0.94, 1 - 1 / (1 + elapsedMin * 1.6))
    const pct = realPct === null ? Math.round(5 + fallbackPct * 89) : Math.round(realPct)

    onProgress?.(status || 'processing', pct)

    const logEntry = `poll-image #${Math.round((Date.now() - startTime) / 1000)}s state=${status} pct=${pct}`
    if (logEntry !== lastLog) {
      lastLog = logEntry
      console.log(`[roboneo] ${logEntry}`)
    }

    const isSuccess = ['success', 'succeeded', 'completed', 'done', 'finished'].includes(status)
    const isFailed = ['fail', 'failed', 'error', 'cancelled', 'canceled'].includes(status)

    if (isSuccess) {
      const mediaInfo = task?.media_info_list?.[0] || payload?.media_info_list?.[0]
      const imageUrl = findImageUrl(
        task?.last_image_url, task?.last_image_urls,
        task?.initial_transferred_urls, task?.media_meta, task?.media_metas,
        mediaInfo?.url, mediaInfo?.media_url,
        ...stepOutputs, successfulOutput,
        payload?.output, payload?.result, payload,
        payload?.data, task?.data, task?.output_url, task?.download_url,
        task?.result_url, task?.image, task?.image_url, task?.media,
        task?.url, task?.src, task?.link, task?.href, task?.path
      )

      if (imageUrl) {
        taskMetaMap.delete(taskId)
        return imageUrl
      }

      successNoOutputCount++
      if (successNoOutputCount >= MAX_SUCCESS_NO_OUTPUT) {
        throw new Error(`Roboneo credit/quota habis: task selesai (${status}) tapi URL output tidak ditemukan`)
      }

      onProgress?.(`finalizing`, Math.max(pct, 96))
      await new Promise(r => setTimeout(r, 4000))
      continue
    }

    if (isFailed) {
      const failedStep = steps.find((s: any) => /fail|error/i.test(String(s.status || s.state || '')))
      const stepOutput = failedStep?.output
      const errMsg = task?.error_message || task?.error_msg || failedStep?.error_message || failedStep?.error_msg ||
        (typeof stepOutput?.error_message === 'string' ? stepOutput.error_message : undefined) ||
        (typeof stepOutput?.error_msg === 'string' ? stepOutput.error_msg : undefined) ||
        findDeepError(task) || findDeepError(payload) || findDeepError(stepOutput) ||
        failedStep?.fail_code || 'unknown'
      const taskErrorCode = task?.error_code ?? failedStep?.fail_code ?? stepOutput?.error_code ?? stepOutput?.code

      const isBusy = taskErrorCode === 6 || /busy|sibuk|try again|later|overload|capacity|queue|结果接口获取失败/i.test(errMsg)
      const isChargeFailed = /CHARGE_FAILED|charge.?failed|余额不足|余额不够|积分不足|账户余额|欠费/i.test(errMsg) || taskErrorCode === 'CHARGE_FAILED'
      if (isBusy && busyRetries < MAX_BUSY_RETRIES) {
        busyRetries++
        const waitSec = Math.min(5 + busyRetries * 2, 20)
        console.log(`[roboneo] image busy (code=${taskErrorCode}), retry ${busyRetries}/${MAX_BUSY_RETRIES}, waiting ${waitSec}s...`)
        onProgress?.(`server sibuk, retry ${busyRetries}/${MAX_BUSY_RETRIES}`, pct)
        await new Promise(r => setTimeout(r, waitSec * 1000))
        continue
      }

      if (isChargeFailed) {
        taskMetaMap.delete(taskId)
        throw new Error(`Roboneo: saldo tidak cukup untuk biaya ini (CHARGE_FAILED). Detail: ${errMsg}`)
      }

      taskMetaMap.delete(taskId)
      throw new Error(`Roboneo failed: ${errMsg}`)
    }

    busyRetries = 0
  }

  throw new Error('Roboneo timeout')
}

export async function pollRoboneoT2V(
  accessToken: string,
  taskId: string,
  roomId: string,
  onProgress?: (status: string, pct: number) => void,
  timeoutMs = 3600000,
  signal?: AbortSignal,
  nodeId?: string
): Promise<string> {
  return pollRoboneoI2V(accessToken, taskId, roomId, onProgress, timeoutMs, signal, nodeId)
}

export function isRoboneoSafetyError(msg: string): boolean {
  return /safety review|risk control|risk con|content review|moderation|原图审核不过|审核不通过|审核不过|code["'=:\s]+10025|error_code["'=:\s]+10025/i.test(msg)
}

export function isRoboneoCredentialError(msg: string): boolean {
  return !isRoboneoSafetyError(msg) && /token error|invalid token|access-token.*(?:expired|invalid)|auth(?:entication)? failed|please log in|not logged in|unauth(?:orized)?|\b401\b|\b403\b/i.test(msg)
}

export function isRoboneoBalanceError(msg: string): boolean {
  return !isRoboneoSafetyError(msg) && /insufficient|credit\/quota habis|credit.*(?:empty|exhausted|habis)|balance.*(?:low|empty|insufficient|habis)|CHARGE_FAILED|charge.?failed|payment.?required|余额不足|余额不够|积分不足|账户余额|欠费/i.test(msg)
}

export function isRoboneoTokenError(msg: string): boolean {
  return isRoboneoCredentialError(msg) || isRoboneoBalanceError(msg)
}

export function isRoboneoRotatableError(msg: string): boolean {
  return isRoboneoCredentialError(msg) || isRoboneoBalanceError(msg)
}

const ROBONEO_MOTION_MIN_CREDITS_KEY = 'arkxmotion.roboneo.motionMinCredits'
const DEFAULT_MOTION_MIN_CREDITS = 151

export function getRoboneoMotionMinCredits(): number {
  if (typeof window === 'undefined') return DEFAULT_MOTION_MIN_CREDITS
  try {
    const stored = localStorage.getItem(ROBONEO_MOTION_MIN_CREDITS_KEY)
    const value = stored ? Number(stored) : NaN
    if (Number.isFinite(value) && value > 0) {
      return Math.max(value, DEFAULT_MOTION_MIN_CREDITS)
    }
  } catch {}
  return DEFAULT_MOTION_MIN_CREDITS
}

export function noteRoboneoMotionChargeFailure(creditBalance: number | null): number {
  const currentMin = getRoboneoMotionMinCredits()
  if (creditBalance === null || !Number.isFinite(creditBalance)) {
    return currentMin
  }
  const newMin = Math.max(currentMin, Math.floor(creditBalance) + 1)
  if (newMin !== currentMin && typeof window !== 'undefined') {
    try {
      localStorage.setItem(ROBONEO_MOTION_MIN_CREDITS_KEY, String(newMin))
      console.log(`[roboneo] Motion min credits updated: ${currentMin} → ${newMin}`)
    } catch {}
  }
  return newMin
}

export function isRoboneoFormatError(msg: string): boolean {
  return /FormatUnsupported|Unsupported media format|format.*unsupported|unsupported.*format|invalid.*parameter.*format|参数错误.*format|tos:.*request error|get image info/i.test(msg)
}

export function isRoboneoImageError(msg: string): boolean {
  return isRoboneoFormatError(msg) || /image.*error|image.*fail|image.*invalid|gambar.*gagal|image_url.*error/i.test(msg)
}

export async function uploadImageForRoboneo(file: File, onProgress?: (msg: string, pct?: number) => void): Promise<string> {
  onProgress?.('Normalisasi gambar...')
  const normalizedFile = await normalizeImage(file, onProgress)
  onProgress?.('Upload gambar...')
  const imageUrl = await uploadToCatbox(normalizedFile, 'image', onProgress)
  console.log(`[uploadImageForRoboneo] URL: ${imageUrl}`)
  return imageUrl
}

export function parseAccessToken(raw: string): string {
  return raw.trim()
}

const ROBONEO_SYNC_STORAGE_KEY = 'arkxmotion.roboneo.keys'

export function syncRoboneoTokensToStorage(tokens: Array<{ key: string; name?: string; balance?: number | null; status?: string }>) {
  if (typeof window === 'undefined') return
  try {
    const serialized = JSON.stringify(tokens)
    localStorage.setItem(ROBONEO_SYNC_STORAGE_KEY, serialized)
    window.dispatchEvent(new CustomEvent('aatools:tokens-synced', {
      detail: { provider: 'roboneo', action: 'updated' }
    }))
    window.dispatchEvent(new Event('storage'))
    console.log(`[roboneo] Synced ${tokens.length} tokens to storage`)
  } catch (err) {
    console.error('[roboneo] Failed to sync tokens:', err)
  }
}

export function removeRoboneoKeyFromManager(accessToken: string, reason?: string): { removed: boolean; remaining: number } {
  if (typeof window === 'undefined') return { removed: false, remaining: 0 }
  try {
    const stored = localStorage.getItem(ROBONEO_SYNC_STORAGE_KEY)
    const allKeys = stored ? JSON.parse(stored) : []
    const filtered = allKeys.filter((t: any) => t?.key !== accessToken)
    
    if (filtered.length === allKeys.length) {
      return { removed: false, remaining: filtered.length }
    }
    
    const serialized = JSON.stringify(filtered)
    localStorage.setItem(ROBONEO_SYNC_STORAGE_KEY, serialized)
    
    window.dispatchEvent(new CustomEvent('aatools:tokens-synced', {
      detail: { provider: 'roboneo', action: 'removed', reason: reason || 'invalid' }
    }))
    window.dispatchEvent(new Event('storage'))
    
    console.log(`[roboneo] Removed invalid token (reason: ${reason || 'invalid'}), remaining: ${filtered.length}`)
    return { removed: true, remaining: filtered.length }
  } catch (err) {
    console.warn('[roboneo] Failed to remove token:', err)
    return { removed: false, remaining: 0 }
  }
}

export function updateRoboneoKeyBalance(accessToken: string, balance: number | null) {
  if (typeof window === 'undefined') return
  try {
    const stored = localStorage.getItem(ROBONEO_SYNC_STORAGE_KEY)
    const allKeys = stored ? JSON.parse(stored) : []
    const updated = allKeys.map((t: any) =>
      t?.key === accessToken
        ? { ...t, balance, status: balance !== null && balance > 0 ? 'active' : 'empty' }
        : t
    )
    
    const serialized = JSON.stringify(updated)
    localStorage.setItem(ROBONEO_SYNC_STORAGE_KEY, serialized)
    
    window.dispatchEvent(new CustomEvent('aatools:tokens-synced', {
      detail: { provider: 'roboneo', action: 'balance' }
    }))
    
    console.log(`[roboneo] Updated token balance: ${balance}`)
  } catch (err) {
    console.warn('[roboneo] Failed to update balance:', err)
  }
}
