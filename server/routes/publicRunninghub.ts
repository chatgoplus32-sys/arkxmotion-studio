import { Router, Request, Response } from 'express'

const router = Router()

const RUNNINGHUB_BASE = 'https://www.runninghub.ai'
const RUNNINGHUB_DEFAULT_WORKFLOW_ID = '2092795737699856386'
const RUNNINGHUB_SEEDANCE25_WORKFLOW_ID = '2085913383404068865'

function rhAuthHeaders(_apiKey: string) {
  return { 'Content-Type': 'application/json', 'User-Agent': 'ArkxMotion/1.0' }
}

router.all('/', async (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Runninghub-Key')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const body = req.body || {}
  const { action, apiKey, ...params } = body

  if (!action) return res.status(200).json({ ok: false, error: 'Missing action' })
  if (!apiKey) return res.status(200).json({ ok: false, error: 'Missing apiKey' })

  console.log(`[runninghub] action=${action} apiKeyLen=${String(apiKey).length}`)

  try {
    if (action === 'motion-control') {
      return await handleMotionControl(apiKey, params, res)
    }
    if (action === 'seedance25-multimodal') {
      return await handleSeedance25Multimodal(apiKey, params, res)
    }
    if (action === 'motion-control-v2.6-std') {
      return await handleMotionControlV26Std(apiKey, params, res)
    }
    if (action === 'motion-control-v2.6-pro') {
      return await handleMotionControlV26Pro(apiKey, params, res)
    }
    if (action === 'motion-control-v3') {
      return await handleMotionControlV3(apiKey, params, res)
    }
    if (action === 'query') {
      return await handleQuery(apiKey, params.taskId, res)
    }
    if (action === 'check-balance') {
      return await handleCheckBalance(apiKey, res)
    }
    return res.status(200).json({ ok: false, error: `Unknown action: ${action}` })
  } catch (err: any) {
    console.error(`[runninghub] error:`, err.message)
    return res.status(200).json({ ok: false, error: err.message })
  }
})

async function rhUpload(apiKey: string, fileBase64: string, fileName: string, mimeType: string): Promise<{ fileName: string; downloadUrl: string }> {
  const base64Data = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64
  const binaryData = Buffer.from(base64Data, 'base64')

  const formData = new FormData()
  const blob = new Blob([binaryData], { type: mimeType || 'application/octet-stream' })
  formData.append('file', blob, fileName || 'upload.bin')

  const apiRes = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/media/upload/binary`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  })

  const rawText = await apiRes.text()
  console.log(`[runninghub] upload ${apiRes.status}:`, rawText.slice(0, 500))

  let data: any
  try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

  if (!apiRes.ok) {
    throw new Error(data.message || data.msg || `Upload failed: HTTP ${apiRes.status}`)
  }

  const uploadedFileName = data.data?.fileName || data.fileName
  const downloadUrl = data.data?.download_url || data.download_url
  if (!uploadedFileName) {
    throw new Error('No fileName in upload response: ' + rawText.slice(0, 300))
  }

  // download_url might be relative (just filename) — construct full URL
  let fullDownloadUrl = downloadUrl || ''
  if (fullDownloadUrl && !fullDownloadUrl.startsWith('http')) {
    fullDownloadUrl = `https://rh-hk-images-switch.xiaoyaoyou.com/input/${uploadedFileName}`
  }

  return { fileName: uploadedFileName, downloadUrl: fullDownloadUrl }
}

async function handleMotionControlV26Std(apiKey: string, params: any, res: Response) {
  const {
    imageUrl,
    videoUrl,
    characterOrientation = 'video',
    prompt = '',
    keepOriginalSound = 'yes',
  } = params

  if (!imageUrl) return res.status(200).json({ ok: false, error: 'Missing imageUrl' })
  if (!videoUrl) return res.status(200).json({ ok: false, error: 'Missing videoUrl' })

  const body = {
    imageUrl,
    videoUrl,
    characterOrientation,
    prompt,
    keepOriginalSound,
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/kling-v2.6-std/motion-control`
  console.log(`[runninghub] POST ${endpoint}`)
  console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

  const apiRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  const rawText = await apiRes.text()
  console.log(`[runninghub] motion-control-v2.6-std ${apiRes.status}:`, rawText)

  let data: any
  try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

  if (apiRes.status === 429) {
    return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
  }

  if (!apiRes.ok) {
    const errorMsg = data.errorMessage || data.msg || data.message || data.error || `HTTP ${apiRes.status}`
    return res.status(200).json({ ok: false, error: errorMsg, data })
  }

  if (data.status === 'FAILED') {
    return res.status(200).json({ ok: false, error: data.errorMessage || data.failedReason || 'Task failed', data })
  }

  const taskId = data.taskId || data.data?.taskId || data.id || data.task_id
  if (!taskId) {
    console.error(`[runninghub] No taskId found in response:`, JSON.stringify(data))
    return res.status(200).json({ ok: false, error: 'No taskId returned', raw: rawText, fullData: data })
  }

  return res.status(200).json({
    ok: true,
    data: {
      id: taskId,
      taskId,
      status: data.status || data.data?.status || 'QUEUED',
      provider: 'markasflow-v2',
    },
  })
}

async function handleMotionControlV26Pro(apiKey: string, params: any, res: Response) {
  const {
    imageUrl,
    videoUrl,
    characterOrientation = 'video',
    prompt = '',
    keepOriginalSound = 'yes',
  } = params

  if (!imageUrl) return res.status(200).json({ ok: false, error: 'Missing imageUrl' })
  if (!videoUrl) return res.status(200).json({ ok: false, error: 'Missing videoUrl' })

  const body = {
    imageUrl,
    videoUrl,
    characterOrientation,
    prompt,
    keepOriginalSound,
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/kling-v2.6-pro/motion-control`
  console.log(`[runninghub] POST ${endpoint}`)
  console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

  const apiRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  const rawText = await apiRes.text()
  console.log(`[runninghub] motion-control-v2.6-pro ${apiRes.status}:`, rawText)

  let data: any
  try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

  if (apiRes.status === 429) {
    return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
  }

  if (!apiRes.ok) {
    const errorMsg = data.errorMessage || data.msg || data.message || data.error || `HTTP ${apiRes.status}`
    return res.status(200).json({ ok: false, error: errorMsg, data })
  }

  if (data.status === 'FAILED') {
    return res.status(200).json({ ok: false, error: data.errorMessage || data.failedReason || 'Task failed', data })
  }

  const taskId = data.taskId || data.data?.taskId || data.id || data.task_id
  if (!taskId) {
    console.error(`[runninghub] No taskId found in V2.6 Pro response:`, JSON.stringify(data))
    return res.status(200).json({ ok: false, error: 'No taskId returned', raw: rawText, fullData: data })
  }

  return res.status(200).json({
    ok: true,
    data: {
      id: taskId,
      taskId,
      status: data.status || data.data?.status || 'QUEUED',
      provider: 'markasflow-v2',
    },
  })
}

async function handleMotionControlV3(apiKey: string, params: any, res: Response) {
  const {
    imageUrl,
    videoUrl,
    characterOrientation = 'video',
    prompt = '',
    negativePrompt = '',
    keepOriginalSound = true,
  } = params

  if (!imageUrl) return res.status(200).json({ ok: false, error: 'Missing imageUrl' })
  if (!videoUrl) return res.status(200).json({ ok: false, error: 'Missing videoUrl' })

  const body: any = {
    imageUrl,
    videoUrl,
    characterOrientation,
    prompt,
    keepOriginalSound,
  }
  if (negativePrompt) body.negativePrompt = negativePrompt

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/kling-v3.0-pro/motion-control`
  console.log(`[runninghub] POST ${endpoint}`)
  console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

  const apiRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  const rawText = await apiRes.text()
  console.log(`[runninghub] motion-control-v3 ${apiRes.status}:`, rawText)

  let data: any
  try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

  if (apiRes.status === 429) {
    return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
  }

  if (!apiRes.ok) {
    const errorMsg = data.errorMessage || data.msg || data.message || data.error || `HTTP ${apiRes.status}`
    return res.status(200).json({ ok: false, error: errorMsg, data })
  }

  if (data.status === 'FAILED') {
    return res.status(200).json({ ok: false, error: data.errorMessage || data.failedReason || 'Task failed', data })
  }

  const taskId = data.taskId || data.data?.taskId || data.id || data.task_id
  if (!taskId) {
    console.error(`[runninghub] No taskId found in V3 response:`, JSON.stringify(data))
    return res.status(200).json({ ok: false, error: 'No taskId returned', raw: rawText, fullData: data })
  }

  return res.status(200).json({
    ok: true,
    data: {
      id: taskId,
      taskId,
      status: data.status || data.data?.status || 'QUEUED',
      provider: 'runninghub',
    },
  })
}

async function handleMotionControl(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    imageBase64,
    videoBase64,
    imageFileName = 'image.jpg',
    videoFileName = 'video.mp4',
    imageMimeType = 'image/jpeg',
    videoMimeType = 'video/mp4',
    prompt = '',
    negative_prompt = '',
    keep_original_sound = false,
  } = params

  if (!imageBase64) return res.status(200).json({ ok: false, error: 'Missing imageBase64' })
  if (!videoBase64) return res.status(200).json({ ok: false, error: 'Missing videoBase64' })

  const effectiveWorkflowId = RUNNINGHUB_DEFAULT_WORKFLOW_ID

  console.log(`[runninghub] Uploading image...`)
  const imageUpload = await rhUpload(apiKey, imageBase64, imageFileName, imageMimeType)
  console.log(`[runninghub] Image uploaded: ${imageUpload.fileName}`)

  console.log(`[runninghub] Uploading video...`)
  const videoUpload = await rhUpload(apiKey, videoBase64, videoFileName, videoMimeType)
  console.log(`[runninghub] Video uploaded: ${videoUpload.fileName}`)

  // Workflow API: nodeInfoList uses node IDs from the workflow
  const nodeInfoList: any[] = [
    {
      nodeId: '47',
      fieldName: 'image',
      fieldValue: imageUpload.fileName,
    },
    {
      nodeId: '46',
      fieldName: 'video',
      fieldValue: videoUpload.fileName,
    },
  ]

  const body = {
    nodeInfoList,
    instanceType: 'default',
    usePersonalQueue: 'false',
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`

  // Retry up to 3 times for error 421 (queue limit)
  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 10000
  let lastRawText = ''
  let lastData: any = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[runninghub] POST ${endpoint} (attempt ${attempt}/${MAX_RETRIES})`)
    console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

    const apiRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    lastRawText = await apiRes.text()
    console.log(`[runninghub] motion-control ${apiRes.status}:`, lastRawText.slice(0, 1000))

    let data: any
    try { data = JSON.parse(lastRawText) } catch { data = { raw: lastRawText } }
    lastData = data

    const rhCode = data.code ?? data.errorCode
    const rhMsg = data.msg || data.errorMessage || data.message

    if (apiRes.status === 429 || rhCode === 429) {
      return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
    }

    if (rhCode === 421 || rhCode === '421') {
      console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s... (${attempt}/${MAX_RETRIES})`)
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }
      return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data, retryable: true })
    }

    if (rhCode !== undefined && rhCode !== 0 && rhCode !== '0' && rhCode !== '') {
      const errorMsg = translateRhError(String(rhCode), rhMsg) || rhMsg || `Error code: ${rhCode}`
      return res.status(200).json({ ok: false, error: errorMsg, code: rhCode, data })
    }

    const taskId = data.data?.taskId || data.taskId || data.id || data.task_id
    if (!taskId) {
      console.error(`[runninghub] No taskId found:`, JSON.stringify(data).slice(0, 500))
      return res.status(200).json({ ok: false, error: 'No taskId returned', raw: lastRawText.slice(0, 500) })
    }

    const netWssUrl = data.data?.netWssUrl
    return res.status(200).json({
      ok: true,
      data: {
        id: taskId,
        taskId,
        status: data.data?.status || data.status || 'QUEUED',
        netWssUrl,
        provider: 'runninghub',
      },
    })
  }

  return res.status(200).json({ ok: false, error: 'Max retries exceeded', raw: lastRawText.slice(0, 500) })
}

async function handleSeedance25Multimodal(apiKey: string, params: any, res: Response) {
  const {
    imageBase64s = [],
    videoBase64,
    audioBase64,
    prompt = '',
    resolution = '720p',
    duration = '5',
    ratio = '16:9',
    generateAudio = false,
  } = params

  if (!videoBase64 && imageBase64s.length === 0) {
    return res.status(200).json({ ok: false, error: 'Minimal perlu 1 image atau 1 video' })
  }

  console.log(`[runninghub] Seedance 2.5 Multimodal: uploading ${imageBase64s.length} images, video=${!!videoBase64}, audio=${!!audioBase64}`)

  // Upload images
  const imageUploads: { nodeId: string; fileName: string }[] = []
  const imageNodeIds = ['2', '3', '4', '5', '6']
  for (let i = 0; i < Math.min(imageBase64s.length, 5); i++) {
    const img = imageBase64s[i]
    if (!img) continue
    const upload = await rhUpload(apiKey, img.base64, img.fileName || `image${i + 1}.jpg`, img.mimeType || 'image/jpeg')
    imageUploads.push({ nodeId: imageNodeIds[i], fileName: upload.fileName })
    console.log(`[runninghub] Image${i + 1} uploaded: ${upload.fileName}`)
  }

  // Upload video
  let videoUpload: { fileName: string } | null = null
  if (videoBase64) {
    const v = typeof videoBase64 === 'string' ? { base64: videoBase64, fileName: 'video.mp4', mimeType: 'video/mp4' } : videoBase64
    videoUpload = await rhUpload(apiKey, v.base64, v.fileName || 'video.mp4', v.mimeType || 'video/mp4')
    console.log(`[runninghub] Video uploaded: ${videoUpload.fileName}`)
  }

  // Upload audio
  let audioUpload: { fileName: string } | null = null
  if (audioBase64) {
    const a = typeof audioBase64 === 'string' ? { base64: audioBase64, fileName: 'audio.mp3', mimeType: 'audio/mpeg' } : audioBase64
    audioUpload = await rhUpload(apiKey, a.base64, a.fileName || 'audio.mp3', a.mimeType || 'audio/mpeg')
    console.log(`[runninghub] Audio uploaded: ${audioUpload.fileName}`)
  }

  // Build nodeInfoList
  const nodeInfoList: any[] = []

  for (const img of imageUploads) {
    nodeInfoList.push({ nodeId: img.nodeId, fieldName: 'image', fieldValue: img.fileName, description: 'image' })
  }

  if (videoUpload) {
    nodeInfoList.push({ nodeId: '7', fieldName: 'file', fieldValue: videoUpload.fileName, description: 'video' })
  }

  if (audioUpload) {
    nodeInfoList.push({ nodeId: '8', fieldName: 'audio', fieldValue: audioUpload.fileName, description: 'audio' })
  }

  if (prompt) {
    nodeInfoList.push({ nodeId: '9', fieldName: 'text', fieldValue: prompt, description: 'text' })
  }

  // Config params for main node (node 1)
  nodeInfoList.push({ nodeId: '1', fieldName: 'resolution', fieldValue: resolution || '720p', description: 'resolution' })
  nodeInfoList.push({ nodeId: '1', fieldName: 'duration', fieldValue: duration || '5', description: 'duration' })
  nodeInfoList.push({ nodeId: '1', fieldName: 'ratio', fieldValue: ratio || '16:9', description: 'ratio' })
  nodeInfoList.push({ nodeId: '1', fieldName: 'bitrateMode', fieldValue: 'standard', description: 'bitrateMode' })
  nodeInfoList.push({ nodeId: '1', fieldName: 'outputFormat', fieldValue: 'mp4', description: 'outputFormat' })

  const body = {
    nodeInfoList,
    instanceType: 'default',
    usePersonalQueue: 'false',
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${RUNNINGHUB_SEEDANCE25_WORKFLOW_ID}`

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 10000
  let lastRawText = ''
  let lastData: any = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[runninghub] POST ${endpoint} (attempt ${attempt}/${MAX_RETRIES})`)

    const apiRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })

    lastRawText = await apiRes.text()
    console.log(`[runninghub] seedance25 ${apiRes.status}:`, lastRawText.slice(0, 500))

    let data: any
    try { data = JSON.parse(lastRawText) } catch { data = { raw: lastRawText } }
    lastData = data

    const rhCode = data.code ?? data.errorCode
    const rhMsg = data.msg || data.errorMessage || data.message

    if (apiRes.status === 429 || rhCode === 429) {
      return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
    }

    if (rhCode === 421 || rhCode === '421') {
      console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s...`)
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }
      return res.status(200).json({ ok: false, error: 'Queue limit reached', data, retryable: true })
    }

    if (rhCode !== undefined && rhCode !== 0 && rhCode !== '0' && rhCode !== '') {
      const errorMsg = translateRhError(String(rhCode), rhMsg) || rhMsg || `Error code: ${rhCode}`
      return res.status(200).json({ ok: false, error: errorMsg, code: rhCode, data })
    }

    const taskId = data.data?.taskId || data.taskId || data.id || data.task_id
    if (!taskId) {
      console.error(`[runninghub] No taskId found:`, JSON.stringify(data).slice(0, 500))
      return res.status(200).json({ ok: false, error: 'No taskId returned', raw: lastRawText.slice(0, 500) })
    }

    return res.status(200).json({
      ok: true,
      data: {
        id: taskId,
        taskId,
        status: data.data?.status || data.status || 'QUEUED',
        provider: 'runninghub',
      },
    })
  }

  return res.status(200).json({ ok: false, error: 'Max retries exceeded', raw: lastRawText.slice(0, 500) })
}

async function handleQuery(apiKey: string, taskId: string, res: Response) {
  if (!taskId) return res.status(200).json({ ok: false, error: 'Missing taskId' })

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/query`

  const apiRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ taskId }),
    signal: AbortSignal.timeout(30000),
  })

  const rawText = await apiRes.text()
  console.log(`[runninghub] query ${apiRes.status}:`, rawText.slice(0, 1000))

  let data: any
  try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

  const rhCode = data.code ?? data.errorCode
  const errorMsg = data.msg || data.errorMessage || data.message

  if (apiRes.status === 429 || rhCode === 429) {
    return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
  }

  if (rhCode !== undefined && rhCode !== 0 && rhCode !== '0' && rhCode !== '') {
    return res.status(200).json({ ok: false, error: translateRhError(String(rhCode), errorMsg) || errorMsg || `Error code: ${rhCode}`, data })
  }

  const taskData = data.data || data
  const status = (taskData.status || data.status || '').toUpperCase()

  let mappedStatus = 'RUNNING'
  if (status === 'COMPLETED' || status === 'SUCCESS' || status === 'FINISHED') mappedStatus = 'COMPLETED'
  else if (status === 'FAILED') mappedStatus = 'FAILED'
  else if (status === 'QUEUED') mappedStatus = 'QUEUED'

  let videoUrl: string | null = null
  if (mappedStatus === 'COMPLETED') {
    const results = taskData.results || taskData.output || data.results || taskData.outputs || data.outputs
    if (Array.isArray(results) && results.length > 0) {
      for (const r of results) {
        const url = r.url || r.uri || r.download_url || (typeof r === 'string' ? r : null)
        if (url && ((r.outputType && r.outputType !== 'text') || /\.(mp4|webm|mov)$/i.test(url))) {
          videoUrl = url
          break
        }
      }
      if (!videoUrl && typeof results[0] === 'object' && (results[0]?.url || results[0]?.uri)) {
        videoUrl = results[0].url || results[0].uri
      }
    } else if (typeof results === 'string') {
      videoUrl = results
    }
  }

  return res.status(200).json({
    ok: true,
    data: {
      id: taskId,
      taskId,
      status: mappedStatus,
      progress: taskData.progress || data.progress || 0,
      videoUrl,
      error: mappedStatus === 'FAILED' ? (taskData.errorMessage || taskData.failedReason || taskData.msg || errorMsg || 'Task failed') : null,
      provider: 'runninghub',
    },
  })
}

function translateRhError(code: string, msg?: string): string {
  const map: Record<string, string> = {
    '414': 'Saldo/kuota kerja (power) tidak cukup untuk menjalankan task ini. Silakan top up RH coins di akun RunningHub.',
    '404': 'Workflow tidak ditemukan atau tidak dapat diakses API key ini.',
    '403': 'Akses ditolak. API key tidak berhak mengakses workflow ini.',
    '1002': 'API key tidak valid.',
    '1003': 'API key tidak valid atau telah kedaluwarsa.',
    '1004': 'Workflow tidak ditemukan.',
    '5101': 'Gagal membuat task, coba lagi.',
  }
  if (msg && /NOT_ENOUGH_POWER|balance|insufficient|coin/i.test(msg)) {
    return 'Saldo/kuota kerja tidak cukup. Silakan top up RH coins di akun RunningHub.'
  }
  return map[code] || msg || `Error RunningHub (${code})`
}

async function handleCheckBalance(apiKey: string, res: Response) {
  try {
    const endpoint = `${RUNNINGHUB_BASE}/uc/openapi/accountStatus`

    const apiRes = await fetch(endpoint, {
      method: 'POST',
      headers: rhAuthHeaders(apiKey),
      body: JSON.stringify({ apiKey }),
    })

    const rawText = await apiRes.text()
    console.log(`[runninghub] check-balance ${apiRes.status}:`, rawText.slice(0, 500))

    let data: any
    try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

    if (data.code !== undefined && data.code !== 0) {
      return res.status(200).json({
        ok: false,
        error: translateRhError(String(data.code), data.msg) || data.msg || 'Gagal cek saldo',
        balance: null,
        isValidUser: false,
      })
    }

    const info = data.data || {}
    const balance = info.remainCoins !== undefined && info.remainCoins !== null ? parseFloat(info.remainCoins) : null

    return res.status(200).json({
      ok: true,
      balance,
      isValidUser: true,
      apiType: info.apiType || null,
      message: 'API key valid',
    })
  } catch (err: any) {
    return res.status(200).json({
      ok: false,
      error: err.message,
      balance: null,
      isValidUser: false,
      message: 'Gagal terhubung ke RunningHub',
    })
  }
}

export default router
