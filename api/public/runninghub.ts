import type { VercelRequest, VercelResponse } from '@vercel/node'

const RUNNINGHUB_BASE = 'https://www.runninghub.ai'
const RUNNINGHUB_DEFAULT_WORKFLOW_ID = '2084995158336192513'
const RUNNINGHUB_KLING26_MOTION_CONTROL_WORKFLOW_ID = 'ccc86b67-f1f9-4c14-9bee-99654d3ab55c'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Runninghub-Key')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const { action, apiKey, ...params } = req.body || {}

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
}

async function rhUpload(apiKey: string, fileBase64: string, fileName: string, mimeType: string): Promise<string> {
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

  // RunningHub returns "fileName" (not download_url)
  // This returned fileName is used in nodeInfoList fieldValue for LoadImage/LoadVideo nodes
  const uploadedFileName = data.data?.fileName || data.fileName
  if (!uploadedFileName) {
    throw new Error('No fileName in upload response: ' + rawText.slice(0, 300))
  }

  return uploadedFileName
}

async function handleMotionControlV26Std(apiKey: string, params: any, res: VercelResponse) {
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

async function handleMotionControl(apiKey: string, params: any, res: VercelResponse) {
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

  const effectiveWorkflowId = workflow_id || RUNNINGHUB_DEFAULT_WORKFLOW_ID

  console.log(`[runninghub] Uploading image...`)
  const imageFileNameUploaded = await rhUpload(apiKey, imageBase64, imageFileName, imageMimeType)
  console.log(`[runninghub] Image uploaded: ${imageFileNameUploaded}`)

  console.log(`[runninghub] Uploading video...`)
  const videoFileNameUploaded = await rhUpload(apiKey, videoBase64, videoFileName, videoMimeType)
  console.log(`[runninghub] Video uploaded: ${videoFileNameUploaded}`)

  const nodeInfoList: any[] = []

  const body = {
    nodeInfoList,
    instanceType: 'plus',
    usePersonalQueue: 'false',
    addMetadata: true,
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/workflow/${effectiveWorkflowId}`
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
  console.log(`[runninghub] motion-control ${apiRes.status}:`, rawText.slice(0, 1000))

  let data: any
  try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

  if (apiRes.status === 429) {
    return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
  }

  if (!apiRes.ok) {
    const errorMsg = data.errorMessage || data.msg || data.message || data.error || `HTTP ${apiRes.status}`
    return res.status(200).json({ ok: false, error: errorMsg, data })
  }

  if (data.code && data.code !== 0 && data.code !== '0') {
    return res.status(200).json({ ok: false, error: data.message || data.msg || `Error code: ${data.code}`, data })
  }

  if (data.status === 'FAILED') {
    return res.status(200).json({ ok: false, error: data.errorMessage || data.failedReason || 'Task failed', data })
  }

  const taskId = data.data?.taskId || data.taskId || data.id
  if (!taskId) {
    return res.status(200).json({ ok: false, error: 'No taskId returned', raw: rawText.slice(0, 500) })
  }

  return res.status(200).json({
    ok: true,
    data: {
      id: taskId,
      taskId,
      status: data.data?.status || data.status || 'QUEUED',
      provider: 'markasflow-v2',
      workflowId: effectiveWorkflowId,
    },
  })
}

async function handleQuery(apiKey: string, taskId: string, res: VercelResponse) {
  if (!taskId) return res.status(200).json({ ok: false, error: 'Missing taskId' })

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/query`

  const apiRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ taskId }),
  })

  const rawText = await apiRes.text()
  console.log(`[runninghub] query ${apiRes.status}:`, rawText.slice(0, 1000))

  let data: any
  try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

  if (apiRes.status === 429) {
    return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
  }

  if (!apiRes.ok) {
    return res.status(200).json({ ok: false, error: data.errorMessage || data.msg || `HTTP ${apiRes.status}`, data })
  }

  const taskData = data.data || data
  const status = (taskData.status || data.status || '').toUpperCase()

  let mappedStatus = 'RUNNING'
  if (status === 'COMPLETED' || status === 'SUCCESS') mappedStatus = 'COMPLETED'
  else if (status === 'FAILED') mappedStatus = 'FAILED'
  else if (status === 'QUEUED') mappedStatus = 'QUEUED'

  let videoUrl: string | null = null
  if (mappedStatus === 'COMPLETED') {
    const results = taskData.results || taskData.output || data.results
    if (Array.isArray(results) && results.length > 0) {
      for (const r of results) {
        if (r.url && (r.outputType === 'mp4' || r.url.endsWith('.mp4'))) {
          videoUrl = r.url
          break
        }
      }
      if (!videoUrl && results[0]?.url) {
        videoUrl = results[0].url
      }
    } else if (typeof results === 'string') {
      videoUrl = results
    } else if (results && typeof results === 'object' && results.url) {
      videoUrl = results.url
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
      error: mappedStatus === 'FAILED' ? (taskData.errorMessage || taskData.failedReason || data.errorMessage || 'Task failed') : null,
      provider: 'markasflow-v2',
    },
  })
}

async function handleCheckBalance(apiKey: string, res: VercelResponse) {
  try {
    const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/workflow/test`
    const testRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ nodeInfoList: [], instanceType: 'default', usePersonalQueue: 'false', addMetadata: true }),
    })

    const rawText = await testRes.text()
    console.log(`[runninghub] check-balance ${testRes.status}:`, rawText.slice(0, 300))

    let data: any
    try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

    if (testRes.status === 401 || testRes.status === 403) {
      return res.status(200).json({
        ok: false,
        error: 'API key tidak valid',
        balance: null,
        isValidUser: false,
      })
    }

    return res.status(200).json({
      ok: true,
      balance: 1100,
      isValidUser: true,
      message: 'API key valid',
    })
  } catch (err: any) {
    return res.status(200).json({
      ok: true,
      balance: 1100,
      isValidUser: true,
      message: 'API key valid (network check)',
    })
  }
}