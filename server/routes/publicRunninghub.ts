import { Router, Request, Response } from 'express'

const router = Router()

const RUNNINGHUB_BASE = 'https://www.runninghub.ai'
const RUNNINGHUB_DEFAULT_WORKFLOW_ID = '2092795737699856386'
const RUNNINGHUB_ULTRA_HD_WORKFLOW_ID = '2095008448978407425'
// MC Ultra Fast HD — node ID resmi dari dokumentasi workflow:
// node 30 = image (LoadImage), node 33 = video (LoadVideo)
const ULTRA_HD_IMAGE_NODE = '30'
const ULTRA_HD_VIDEO_NODE = '33'
// Virtual Try-On & Ekstraksi Pakaian: node 13 = foto orang, node 53 = pakaian
const RUNNINGHUB_TRYON_WORKFLOW_ID = '2099800742046818306'
const RUNNINGHUB_TRYON_PERSON_NODE = '13'
const RUNNINGHUB_TRYON_GARMENT_NODE = '53'
// H3 Audio Avatar: node 209 = foto, node 215 = audio
const RUNNINGHUB_AUDIO_AVATAR_WORKFLOW_ID = '2099332942179229697'
const RUNNINGHUB_AUDIO_AVATAR_IMAGE_NODE = '209'
const RUNNINGHUB_AUDIO_AVATAR_AUDIO_NODE = '215'
// VOSR2 Video Upscale 2K: node 1 = video + frame_load_cap,
// node 21 = cfg/scheduler/steps, node 13 = save_output
const RUNNINGHUB_VIDEO_UPSCALE_WORKFLOW_ID = '2100537736599035906'
// AI Photo Enhancer: node 642 = image, node 688 = scale_by
const RUNNINGHUB_PHOTO_ENHANCE_WORKFLOW_ID = '2100619334354759681'

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
    if (action === 'motion-control-v2.6-std') {
      return await handleMotionControlV26Std(apiKey, params, res)
    }
    if (action === 'motion-control-v2.6-pro') {
      return await handleMotionControlV26Pro(apiKey, params, res)
    }
    if (action === 'motion-control-v3') {
      return await handleMotionControlV3(apiKey, params, res)
    }
    if (action === 'motion-control-ultra-hd') {
      return await handleMotionControlUltraHD(apiKey, params, res)
    }
    if (action === 'get-workflow-info') {
      return await handleGetWorkflowInfo(apiKey, params.workflowId || params.workflow_id, res)
    }
    if (action === 'submit-tryon') {
      return await handleSubmitTryOn(apiKey, params, res)
    }
    if (action === 'submit-audio-avatar') {
      return await handleSubmitAudioAvatar(apiKey, params, res)
    }
    if (action === 'submit-video-upscale') {
      return await handleSubmitVideoUpscale(apiKey, params, res)
    }
    if (action === 'submit-photo-enhance') {
      return await handleSubmitPhotoEnhance(apiKey, params, res)
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

async function handleGetWorkflowInfo(apiKey: string, workflowId: string, res: Response) {
  if (!workflowId) return res.status(200).json({ ok: false, error: 'Missing workflowId' })
  try {
    const nodes = await fetchWorkflowNodes(apiKey, workflowId)
    return res.status(200).json({ ok: true, data: { workflowId, nodes } })
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: err.message })
  }
}

async function fetchWorkflowNodes(apiKey: string, workflowId: string): Promise<any[]> {
  const endpoints = [
    `${RUNNINGHUB_BASE}/api/openapi/getJsonApiFormat`,
    `${RUNNINGHUB_BASE}/openapi/getJsonApiFormat`,
  ]
  let lastErr = ''
  for (const endpoint of endpoints) {
    try {
      const apiRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ apiKey, workflowId }),
      })
      const raw = await apiRes.text()
      let data: any
      try { data = JSON.parse(raw) } catch { data = {} }
      const promptStr = data.data?.prompt || data.prompt || data.data
      if (typeof promptStr === 'string' && promptStr.includes('class_type')) {
        const prompt = JSON.parse(promptStr)
        return Object.entries(prompt).map(([nodeId, node]: [string, any]) => ({
          nodeId,
          classType: node.class_type,
          inputs: node.inputs || {},
          title: node._meta?.title || '',
        }))
      }
      lastErr = (data.msg || data.message || raw).slice(0, 200)
    } catch (err: any) {
      lastErr = err.message
    }
  }
  throw new Error(`Gagal ambil workflow JSON: ${lastErr || 'unknown'}`)
}

function buildUltraHDNodeList(nodes: any[], opts: {
  imageFileName: string
  videoFileName: string
  fps: number
  steps: number
  maxFrames: number
  prompt: string
  negativePrompt: string
}): any[] | null {
  if (!nodes || nodes.length === 0) return null
  const list: any[] = []
  let imageSet = false
  let videoSet = false

  const findInputKey = (inputs: Record<string, any>, patterns: RegExp[]): string | null => {
    for (const k of Object.keys(inputs)) {
      if (patterns.some((p) => p.test(k))) return k
    }
    return null
  }

  for (const n of nodes) {
    const inputs = n.inputs || {}
    const cls = String(n.classType || '')
    const title = String(n.title || '')

    if (!imageSet && /loadimage|image/i.test(cls + ' ' + title)) {
      const key = findInputKey(inputs, [/image/i]) || 'image'
      list.push({ nodeId: String(n.nodeId), fieldName: key, fieldValue: opts.imageFileName })
      imageSet = true
      continue
    }
    if (!videoSet && /loadvideo|video/i.test(cls + ' ' + title)) {
      const key = findInputKey(inputs, [/video/i]) || 'video'
      list.push({ nodeId: String(n.nodeId), fieldName: key, fieldValue: opts.videoFileName })
      videoSet = true
      continue
    }
    const fpsKey = findInputKey(inputs, [/^fps$/i, /frame_?rate/i])
    if (fpsKey) {
      list.push({ nodeId: String(n.nodeId), fieldName: fpsKey, fieldValue: String(opts.fps) })
      continue
    }
    const stepsKey = findInputKey(inputs, [/^steps$/i])
    if (stepsKey) {
      list.push({ nodeId: String(n.nodeId), fieldName: stepsKey, fieldValue: String(opts.steps) })
      continue
    }
    const frameKey = findInputKey(inputs, [/max_?frames?/i, /frame_?limit/i, /num_?frames?/i, /^frames?$/i])
    if (frameKey) {
      list.push({ nodeId: String(n.nodeId), fieldName: frameKey, fieldValue: String(opts.maxFrames) })
      continue
    }
    const promptKey = findInputKey(inputs, [/^prompt$/i, /^text$/i, /positive/i])
    if (promptKey && /clip|prompt|text/i.test(cls + ' ' + title)) {
      const isNegative = /negative/i.test(title + ' ' + cls)
      const value = isNegative ? opts.negativePrompt : opts.prompt
      if (value) list.push({ nodeId: String(n.nodeId), fieldName: promptKey, fieldValue: value })
      continue
    }
  }

  if (!list.some((l) => /fps/i.test(l.fieldName))) {
    for (const n of nodes) {
      const inputs = n.inputs || {}
      if (inputs.fps !== undefined) {
        list.push({ nodeId: String(n.nodeId), fieldName: 'fps', fieldValue: String(opts.fps) })
        break
      }
    }
  }

  if (!imageSet || !videoSet) return null
  return list
}

function collectUltraHDExtras(nodes: any[], opts: {
  fps: number
  steps: number
  maxFrames: number
  prompt: string
  negativePrompt: string
}): any[] {
  const extras: any[] = []
  if (!nodes || nodes.length === 0) return extras

  const findInputKey = (inputs: Record<string, any>, patterns: RegExp[]): string | null => {
    for (const k of Object.keys(inputs)) {
      if (patterns.some((p) => p.test(k))) return k
    }
    return null
  }

  for (const n of nodes) {
    const inputs = n.inputs || {}
    const cls = String(n.classType || '')
    const title = String(n.title || '')
    const tag = `${cls} ${title}`
    if (/loadimage|loadvideo|image|video/i.test(tag) && (findInputKey(inputs, [/^image$/i, /^video$/i]))) continue

    const fpsKey = findInputKey(inputs, [/^fps$/i, /frame_?rate/i])
    if (fpsKey) {
      extras.push({ nodeId: String(n.nodeId), fieldName: fpsKey, fieldValue: String(opts.fps) })
      continue
    }
    const stepsKey = findInputKey(inputs, [/^steps$/i])
    if (stepsKey) {
      extras.push({ nodeId: String(n.nodeId), fieldName: stepsKey, fieldValue: String(opts.steps) })
      continue
    }
    const frameKey = findInputKey(inputs, [/max_?frames?/i, /frame_?limit/i, /num_?frames?/i, /^frames?$/i])
    if (frameKey) {
      extras.push({ nodeId: String(n.nodeId), fieldName: frameKey, fieldValue: String(opts.maxFrames) })
      continue
    }
    const promptKey = findInputKey(inputs, [/^prompt$/i, /^text$/i, /positive/i])
    if (promptKey && /clip|prompt|text/i.test(tag)) {
      const isNegative = /negative/i.test(tag)
      const value = isNegative ? opts.negativePrompt : opts.prompt
      if (value) extras.push({ nodeId: String(n.nodeId), fieldName: promptKey, fieldValue: value })
      continue
    }
  }
  return extras
}

async function handleMotionControlUltraHD(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    imageBase64,
    videoBase64,
    imageFileName = 'image.jpg',
    videoFileName = 'video.mp4',
    imageMimeType = 'image/jpeg',
    videoMimeType = 'video/mp4',
    fps = 24,
    steps = 20,
    maxFrames,
    max_frames,
    frameLimit,
    prompt = '',
    negative_prompt = '',
    negativePrompt = '',
  } = params

  if (!imageBase64) return res.status(200).json({ ok: false, error: 'Missing imageBase64' })
  if (!videoBase64) return res.status(200).json({ ok: false, error: 'Missing videoBase64' })

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_ULTRA_HD_WORKFLOW_ID
  const effFps = Math.max(1, Math.min(60, Number(fps) || 60))
  const effSteps = Math.max(1, Math.min(100, Number(steps) || 4))
  const effMaxFrames = Math.max(1, Math.min(1000, Number(maxFrames ?? max_frames ?? frameLimit) || 120))
  const effPrompt = String(prompt || '')
  const effNegative = String(negative_prompt || negativePrompt || '')

  console.log(`[runninghub] Uploading image (ultra-hd)...`)
  const imageUpload = await rhUpload(apiKey, imageBase64, imageFileName, imageMimeType)
  console.log(`[runninghub] Image uploaded: ${imageUpload.fileName}`)

  console.log(`[runninghub] Uploading video (ultra-hd)...`)
  const videoUpload = await rhUpload(apiKey, videoBase64, videoFileName, videoMimeType)
  console.log(`[runninghub] Video uploaded: ${videoUpload.fileName}`)

  let nodeInfoList: any[] = [
    { nodeId: ULTRA_HD_IMAGE_NODE, fieldName: 'image', fieldValue: imageUpload.fileName },
    { nodeId: ULTRA_HD_VIDEO_NODE, fieldName: 'video', fieldValue: videoUpload.fileName },
  ]
  try {
    const nodes = await fetchWorkflowNodes(apiKey, effectiveWorkflowId)
    console.log(`[runninghub] ultra-hd discovered ${nodes.length} nodes`)
    const mapped = buildUltraHDNodeList(nodes, {
      imageFileName: imageUpload.fileName,
      videoFileName: videoUpload.fileName,
      fps: effFps,
      steps: effSteps,
      maxFrames: effMaxFrames,
      prompt: effPrompt,
      negativePrompt: effNegative,
    })
    if (mapped) {
      nodeInfoList = mapped
      console.log(`[runninghub] ultra-hd auto-mapped ${nodeInfoList.length} fields`)
    } else {
      const extras = collectUltraHDExtras(nodes, {
        fps: effFps,
        steps: effSteps,
        maxFrames: effMaxFrames,
        prompt: effPrompt,
        negativePrompt: effNegative,
      })
      if (extras.length > 0) {
        nodeInfoList = [...nodeInfoList, ...extras]
        console.log(`[runninghub] ultra-hd base 30/33 + ${extras.length} extras`)
      } else {
        console.log(`[runninghub] ultra-hd base 30/33 (workflow defaults untuk fps/steps/frames)`)
      }
    }
  } catch (err: any) {
    console.log(`[runninghub] ultra-hd node discovery failed, pakai base 30/33: ${err.message}`)
  }

  const body = {
    nodeInfoList,
    instanceType: 'default',
    usePersonalQueue: 'false',
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 10000
  let lastRawText = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[runninghub] POST ${endpoint} (ultra-hd attempt ${attempt}/${MAX_RETRIES})`)
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
    console.log(`[runninghub] motion-control-ultra-hd ${apiRes.status}:`, lastRawText.slice(0, 1000))

    let data: any
    try { data = JSON.parse(lastRawText) } catch { data = { raw: lastRawText } }

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
      console.error(`[runninghub] No taskId found (ultra-hd):`, JSON.stringify(data).slice(0, 500))
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
        workflowId: effectiveWorkflowId,
      },
    })
  }

  return res.status(200).json({ ok: false, error: 'Max retries exceeded', raw: lastRawText.slice(0, 500) })
}

async function handleSubmitTryOn(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    mode = 'tryon',
    personBase64,
    personFileName = 'person.jpg',
    personMimeType = 'image/jpeg',
    garmentBase64,
    garmentFileName = 'garment.jpg',
    garmentMimeType = 'image/jpeg',
    prompt = '',
  } = params

  if (!personBase64) return res.status(200).json({ ok: false, error: 'Missing personBase64' })
  if (mode === 'tryon' && !garmentBase64) {
    return res.status(200).json({ ok: false, error: 'Missing garmentBase64 (mode tryon butuh foto pakaian)' })
  }

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_TRYON_WORKFLOW_ID

  console.log(`[runninghub] Uploading person image (tryon)...`)
  const personUpload = await rhUpload(apiKey, personBase64, personFileName, personMimeType)
  console.log(`[runninghub] Person uploaded: ${personUpload.fileName}`)

  let garmentUpload: { fileName: string; downloadUrl: string } | null = null
  if (garmentBase64) {
    console.log(`[runninghub] Uploading garment image (tryon)...`)
    garmentUpload = await rhUpload(apiKey, garmentBase64, garmentFileName, garmentMimeType)
    console.log(`[runninghub] Garment uploaded: ${garmentUpload.fileName}`)
  }

  const nodeInfoList: any[] = [
    { nodeId: RUNNINGHUB_TRYON_PERSON_NODE, fieldName: 'image', fieldValue: personUpload.fileName },
  ]
  if (garmentUpload) {
    nodeInfoList.push({ nodeId: RUNNINGHUB_TRYON_GARMENT_NODE, fieldName: 'image', fieldValue: garmentUpload.fileName })
  }

  try {
    const nodes = await fetchWorkflowNodes(apiKey, effectiveWorkflowId)
    const extras = collectUltraHDExtras(nodes, {
      fps: 0, steps: 0, maxFrames: 0, prompt: String(prompt || ''), negativePrompt: '',
    }).filter((e) => /prompt|text|positive/i.test(e.fieldName))
    if (extras.length > 0) {
      nodeInfoList.push(...extras)
      console.log(`[runninghub] tryon + ${extras.length} extras`)
    }
  } catch (err: any) {
    console.log(`[runninghub] tryon discovery skipped: ${err.message}`)
  }

  const body = {
    nodeInfoList,
    instanceType: 'default',
    usePersonalQueue: 'false',
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 10000
  let lastRawText = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[runninghub] POST ${endpoint} (tryon attempt ${attempt}/${MAX_RETRIES})`)
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
    console.log(`[runninghub] submit-tryon ${apiRes.status}:`, lastRawText.slice(0, 1000))

    let data: any
    try { data = JSON.parse(lastRawText) } catch { data = { raw: lastRawText } }

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
      console.error(`[runninghub] No taskId found (tryon):`, JSON.stringify(data).slice(0, 500))
      return res.status(200).json({ ok: false, error: 'No taskId returned', raw: lastRawText.slice(0, 500) })
    }

    return res.status(200).json({
      ok: true,
      data: {
        id: taskId,
        taskId,
        status: data.data?.status || data.status || 'QUEUED',
        provider: 'runninghub',
        workflowId: effectiveWorkflowId,
      },
    })
  }

  return res.status(200).json({ ok: false, error: 'Max retries exceeded', raw: lastRawText.slice(0, 500) })
}

async function handleSubmitAudioAvatar(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    imageBase64,
    imageFileName = 'photo.jpg',
    imageMimeType = 'image/jpeg',
    audioBase64,
    audioFileName = 'audio.mp3',
    audioMimeType = 'audio/mpeg',
    prompt = '',
  } = params

  if (!imageBase64) return res.status(200).json({ ok: false, error: 'Missing imageBase64' })
  if (!audioBase64) return res.status(200).json({ ok: false, error: 'Missing audioBase64' })

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_AUDIO_AVATAR_WORKFLOW_ID

  console.log(`[runninghub] Uploading photo (audio-avatar)...`)
  const imageUpload = await rhUpload(apiKey, imageBase64, imageFileName, imageMimeType)
  console.log(`[runninghub] Photo uploaded: ${imageUpload.fileName}`)

  console.log(`[runninghub] Uploading audio (audio-avatar)...`)
  const audioUpload = await rhUpload(apiKey, audioBase64, audioFileName, audioMimeType)
  console.log(`[runninghub] Audio uploaded: ${audioUpload.fileName}`)

  const nodeInfoList: any[] = [
    { nodeId: RUNNINGHUB_AUDIO_AVATAR_IMAGE_NODE, fieldName: 'image', fieldValue: imageUpload.fileName },
    { nodeId: RUNNINGHUB_AUDIO_AVATAR_AUDIO_NODE, fieldName: 'audio', fieldValue: audioUpload.fileName },
  ]

  try {
    const nodes = await fetchWorkflowNodes(apiKey, effectiveWorkflowId)
    const extras = collectUltraHDExtras(nodes, {
      fps: 0, steps: 0, maxFrames: 0, prompt: String(prompt || ''), negativePrompt: '',
    }).filter((e) => /prompt|text|positive/i.test(e.fieldName))
    if (extras.length > 0) {
      nodeInfoList.push(...extras)
      console.log(`[runninghub] audio-avatar + ${extras.length} extras`)
    }
  } catch (err: any) {
    console.log(`[runninghub] audio-avatar discovery skipped: ${err.message}`)
  }

  const body = {
    nodeInfoList,
    instanceType: 'default',
    usePersonalQueue: 'false',
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 10000
  let lastRawText = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[runninghub] POST ${endpoint} (audio-avatar attempt ${attempt}/${MAX_RETRIES})`)
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
    console.log(`[runninghub] submit-audio-avatar ${apiRes.status}:`, lastRawText.slice(0, 1000))

    let data: any
    try { data = JSON.parse(lastRawText) } catch { data = { raw: lastRawText } }

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
      console.error(`[runninghub] No taskId found (audio-avatar):`, JSON.stringify(data).slice(0, 500))
      return res.status(200).json({ ok: false, error: 'No taskId returned', raw: lastRawText.slice(0, 500) })
    }

    return res.status(200).json({
      ok: true,
      data: {
        id: taskId,
        taskId,
        status: data.data?.status || data.status || 'QUEUED',
        provider: 'runninghub',
        workflowId: effectiveWorkflowId,
      },
    })
  }

  return res.status(200).json({ ok: false, error: 'Max retries exceeded', raw: lastRawText.slice(0, 500) })
}

const VOSR2_SCHEDULERS = new Set([
  'simple', 'sgm_uniform', 'karras', 'exponential', 'ddim_uniform', 'beta',
  'normal', 'linear_quadratic', 'kl_optimal', 'beta57', 'gits', 'beta_1_1',
])

async function handleSubmitVideoUpscale(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    videoBase64,
    videoFileName = 'video.mp4',
    videoMimeType = 'video/mp4',
    steps = 4,
    cfg = 4.5,
    scheduler = 'beta',
    frameLoadCap = 0,
  } = params

  if (!videoBase64) return res.status(200).json({ ok: false, error: 'Missing videoBase64' })

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_VIDEO_UPSCALE_WORKFLOW_ID
  const effSteps = Math.max(1, Math.min(50, Number(steps) || 4))
  const effCfg = Math.max(0, Math.min(30, Number(cfg) || 4.5))
  const effScheduler = VOSR2_SCHEDULERS.has(String(scheduler)) ? String(scheduler) : 'beta'
  const effFrameCap = Math.max(0, Math.min(10000, Number(frameLoadCap) || 0))

  console.log(`[runninghub] Uploading video (upscale)...`)
  const videoUpload = await rhUpload(apiKey, videoBase64, videoFileName, videoMimeType)
  console.log(`[runninghub] Video uploaded: ${videoUpload.fileName}`)

  const baseList: any[] = [
    { nodeId: '1', fieldName: 'video', fieldValue: videoUpload.fileName },
    { nodeId: '1', fieldName: 'frame_load_cap', fieldValue: String(effFrameCap) },
    { nodeId: '21', fieldName: 'cfg', fieldValue: String(effCfg) },
    { nodeId: '21', fieldName: 'scheduler', fieldValue: effScheduler },
    { nodeId: '21', fieldName: 'steps', fieldValue: String(effSteps) },
    { nodeId: '13', fieldName: 'save_output', fieldValue: 'true' },
  ]

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`
  const RETRY_DELAY_MS = 10000
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const postRun = async (list: any[]) => {
    const apiRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ nodeInfoList: list, instanceType: 'default', usePersonalQueue: 'false' }),
    })
    const rawText = await apiRes.text()
    console.log(`[runninghub] submit-video-upscale ${apiRes.status}:`, rawText.slice(0, 1000))
    let data: any
    try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }
    return {
      http: apiRes.status,
      data,
      raw: rawText.slice(0, 500),
      code: data.code ?? data.errorCode,
      msg: String(data.msg || data.errorMessage || data.message || ''),
      taskId: data.data?.taskId || data.taskId || data.id || data.task_id,
      status: data.data?.status || data.status || 'QUEUED',
    }
  }

  const parseMismatch = (msg: string): { nodeId: string; fieldName: string; reason: string } | null => {
    const m = /nodeId=([^,\)]+),\s*fieldName=([^,\)]+),\s*reason=([^,\)]+)/.exec(msg)
    return m ? { nodeId: m[1].trim(), fieldName: m[2].trim(), reason: m[3].trim() } : null
  }

  const VIDEO_FIELDS = ['video', 'file', 'path', 'video_path', 'filename']
  let lastErr = 'Unknown error'
  let lastData: any = null

  for (const vf of VIDEO_FIELDS) {
    let list = baseList.map((e) =>
      e.nodeId === '1' && /video|file|path|filename|input/i.test(e.fieldName) ? { ...e, fieldName: vf } : e,
    )
    for (let fix = 0; fix < 6; fix++) {
      let r: Awaited<ReturnType<typeof postRun>> | null = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`[runninghub] upscale field=${vf} fix=${fix} (attempt ${attempt}/3)`)
        r = await postRun(list)
        if (r.taskId || (r.http !== 429 && r.code !== 429 && r.code !== 421 && r.code !== '421')) break
        if (r.http === 429 || r.code === 429) {
          return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data: r.data, retryable: true })
        }
        console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s...`)
        if (attempt < 3) await sleep(RETRY_DELAY_MS)
      }
      if (!r) break
      if (r.taskId) {
        return res.status(200).json({
          ok: true,
          data: {
            id: r.taskId,
            taskId: r.taskId,
            status: r.status,
            provider: 'runninghub',
            workflowId: effectiveWorkflowId,
          },
        })
      }
      if (r.code === 421 || r.code === '421') {
        return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data: r.data, retryable: true })
      }
      lastErr = r.msg || `Error code: ${r.code}`
      lastData = r.data
      const mm = r.code === 803 || r.code === '803' ? parseMismatch(r.msg) : null
      if (mm && /field_not_found|node_not_found/i.test(mm.reason)) {
        const isVideoEntry = mm.nodeId === '1' && mm.fieldName === vf
        if (isVideoEntry) {
          if (/field_not_found/i.test(mm.reason)) {
            console.log(`[runninghub] upscale field "${vf}" ditolak, coba kandidat berikutnya`)
            break
          }
          return res.status(200).json({ ok: false, error: `Node video (1) tidak ada di workflow ini`, data: r.data })
        }
        console.log(`[runninghub] upscale buang field ${mm.nodeId}/${mm.fieldName} (${mm.reason}), pakai default workflow`)
        list = list.filter((e) => !(String(e.nodeId) === mm.nodeId && String(e.fieldName) === mm.fieldName))
        continue
      }
      const errorMsg = translateRhError(String(r.code ?? ''), r.msg) || r.msg || 'Submit gagal'
      return res.status(200).json({ ok: false, error: errorMsg, code: r.code, data: r.data })
    }
  }

  return res.status(200).json({ ok: false, error: `Semua kandidat field video ditolak. Terakhir: ${lastErr}`, data: lastData })
}

async function handleSubmitPhotoEnhance(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    imageBase64,
    imageFileName = 'photo.jpg',
    imageMimeType = 'image/jpeg',
    scaleBy = 2,
  } = params

  if (!imageBase64) return res.status(200).json({ ok: false, error: 'Missing imageBase64' })

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_PHOTO_ENHANCE_WORKFLOW_ID
  const effScaleBy = Math.max(1, Math.min(4, Number(scaleBy) || 2))

  console.log(`[runninghub] Uploading photo (enhance)...`)
  const imageUpload = await rhUpload(apiKey, imageBase64, imageFileName, imageMimeType)
  console.log(`[runninghub] Photo uploaded: ${imageUpload.fileName}`)

  const baseList: any[] = [
    { nodeId: '642', fieldName: 'image', fieldValue: imageUpload.fileName },
    { nodeId: '688', fieldName: 'scale_by', fieldValue: String(effScaleBy) },
  ]

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`
  const RETRY_DELAY_MS = 10000
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const postRun = async (list: any[]) => {
    const apiRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ nodeInfoList: list, instanceType: 'default', usePersonalQueue: 'false' }),
    })
    const rawText = await apiRes.text()
    console.log(`[runninghub] submit-photo-enhance ${apiRes.status}:`, rawText.slice(0, 1000))
    let data: any
    try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }
    return {
      http: apiRes.status,
      data,
      raw: rawText.slice(0, 500),
      code: data.code ?? data.errorCode,
      msg: String(data.msg || data.errorMessage || data.message || ''),
      taskId: data.data?.taskId || data.taskId || data.id || data.task_id,
      status: data.data?.status || data.status || 'QUEUED',
    }
  }

  const parseMismatch = (msg: string): { nodeId: string; fieldName: string; reason: string } | null => {
    const m = /nodeId=([^,\)]+),\s*fieldName=([^,\)]+),\s*reason=([^,\)]+)/.exec(msg)
    return m ? { nodeId: m[1].trim(), fieldName: m[2].trim(), reason: m[3].trim() } : null
  }

  const IMAGE_FIELDS = ['image', 'file', 'path', 'filename', 'input', 'src']
  let lastErr = 'Unknown error'
  let lastData: any = null

  for (const vf of IMAGE_FIELDS) {
    let list = baseList.map((e) =>
      e.nodeId === '642' && /image|file|path|filename|input|src/i.test(e.fieldName) ? { ...e, fieldName: vf } : e,
    )
    for (let fix = 0; fix < 4; fix++) {
      let r: Awaited<ReturnType<typeof postRun>> | null = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`[runninghub] enhance field=${vf} fix=${fix} (attempt ${attempt}/3)`)
        r = await postRun(list)
        if (r.taskId || (r.http !== 429 && r.code !== 429 && r.code !== 421 && r.code !== '421')) break
        if (r.http === 429 || r.code === 429) {
          return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data: r.data, retryable: true })
        }
        console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s...`)
        if (attempt < 3) await sleep(RETRY_DELAY_MS)
      }
      if (!r) break
      if (r.taskId) {
        return res.status(200).json({
          ok: true,
          data: {
            id: r.taskId,
            taskId: r.taskId,
            status: r.status,
            provider: 'runninghub',
            workflowId: effectiveWorkflowId,
          },
        })
      }
      if (r.code === 421 || r.code === '421') {
        return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data: r.data, retryable: true })
      }
      lastErr = r.msg || `Error code: ${r.code}`
      lastData = r.data
      const mm = r.code === 803 || r.code === '803' ? parseMismatch(r.msg) : null
      if (mm && /field_not_found|node_not_found/i.test(mm.reason)) {
        const isImageEntry = mm.nodeId === '642' && mm.fieldName === vf
        if (isImageEntry) {
          if (/field_not_found/i.test(mm.reason)) {
            console.log(`[runninghub] enhance field "${vf}" ditolak, coba kandidat berikutnya`)
            break
          }
          return res.status(200).json({ ok: false, error: `Node image (642) tidak ada di workflow ini`, data: r.data })
        }
        console.log(`[runninghub] enhance buang field ${mm.nodeId}/${mm.fieldName} (${mm.reason}), pakai default workflow`)
        list = list.filter((e) => !(String(e.nodeId) === mm.nodeId && String(e.fieldName) === mm.fieldName))
        continue
      }
      const errorMsg = translateRhError(String(r.code ?? ''), r.msg) || r.msg || 'Submit gagal'
      return res.status(200).json({ ok: false, error: errorMsg, code: r.code, data: r.data })
    }
  }

  return res.status(200).json({ ok: false, error: `Semua kandidat field image ditolak. Terakhir: ${lastErr}`, data: lastData })
}

async function handleMotionControl(apiKey: string, params: any, res: Response) {
  const {
    _workflow_id,
    imageBase64,
    videoBase64,
    imageFileName = 'image.jpg',
    videoFileName = 'video.mp4',
    imageMimeType = 'image/jpeg',
    videoMimeType = 'video/mp4',
    _prompt = '',
    _negative_prompt = '',
    _keep_original_sound = false,
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
  let _lastData: any = null

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
    _lastData = data

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
  let imageUrl: string | null = null
  if (mappedStatus === 'COMPLETED') {
    const results = taskData.results || taskData.output || data.results || taskData.outputs || data.outputs
    const pickUrl = (r: any): string | null =>
      r?.url || r?.uri || r?.download_url || (typeof r === 'string' ? r : null)
    const isVideo = (r: any, url: string | null): boolean =>
      !!url && (/\.(mp4|webm|mov|m4v)$/i.test(url.split('?')[0]) || /video/i.test(String(r?.outputType || '')))
    const isImage = (r: any, url: string | null): boolean =>
      !!url && (/\.(png|jpe?g|webp|gif|bmp)$/i.test(url.split('?')[0]) || /image/i.test(String(r?.outputType || '')))
    if (Array.isArray(results) && results.length > 0) {
      for (const r of results) {
        const url = pickUrl(r)
        if (isVideo(r, url)) { videoUrl = url; break }
      }
      if (!videoUrl) {
        for (const r of results) {
          const url = pickUrl(r)
          if (url && (typeof r === 'string' || (r?.outputType && r.outputType !== 'text'))) { videoUrl = url; break }
        }
      }
      if (!videoUrl) videoUrl = pickUrl(results[0])
      for (const r of results) {
        const url = pickUrl(r)
        if (isImage(r, url)) { imageUrl = url; break }
      }
      if (!imageUrl && videoUrl && /\.(png|jpe?g|webp|gif|bmp)$/i.test(videoUrl.split('?')[0])) {
        imageUrl = videoUrl
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
      imageUrl,
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
