import type { VercelRequest, VercelResponse } from '@vercel/node'

const RUNNINGHUB_BASE = 'https://www.runninghub.ai'
const RUNNINGHUB_DEFAULT_WORKFLOW_ID = '2087539655340654593'

function rhAuthHeaders(_apiKey: string) {
  return { 'Content-Type': 'application/json', 'User-Agent': 'ArkxMotion/1.0' }
}

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
    workflowId: effectiveWorkflowId,
    apiKey,
    nodeInfoList,
  }

  const endpoint = `${RUNNINGHUB_BASE}/task/openapi/create`
  console.log(`[runninghub] POST ${endpoint}`)
  console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

  const apiRes = await fetch(endpoint, {
    method: 'POST',
    headers: rhAuthHeaders(apiKey),
    body: JSON.stringify(body),
  })

  const rawText = await apiRes.text()
  console.log(`[runninghub] motion-control ${apiRes.status}:`, rawText.slice(0, 1000))

  let data: any
  try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

  const SUCCESS_CODE = 0
  const errorMsg = (data as any)?.msg || (data as any)?.errorMessage || (data as any)?.message || (data as any)?.error

  if (apiRes.status === 429 || data.code === 429) {
    return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
  }

  if (data.code !== undefined && data.code !== SUCCESS_CODE) {
    const friendly = translateRhError(String(data.code), errorMsg)
    return res.status(200).json({ ok: false, error: friendly, code: data.code, data })
  }

  const taskData = data.data || {}
  const taskId = taskData.taskId || data.taskId || taskData.id || data.id
  if (!taskId) {
    return res.status(200).json({ ok: false, error: 'No taskId returned', raw: rawText.slice(0, 500) })
  }

  const netWssUrl = taskData.netWssUrl
  return res.status(200).json({
    ok: true,
    data: {
      id: taskId,
      taskId,
      status: taskData.status || 'QUEUED',
      netWssUrl,
      provider: 'markasflow-v2',
      workflowId: effectiveWorkflowId,
    },
  })
}

async function handleQuery(apiKey: string, taskId: string, res: VercelResponse) {
  if (!taskId) return res.status(200).json({ ok: false, error: 'Missing taskId' })

  const endpoint = `${RUNNINGHUB_BASE}/task/openapi/query`

  const apiRes = await fetch(endpoint, {
    method: 'POST',
    headers: rhAuthHeaders(apiKey),
    body: JSON.stringify({ apiKey, taskId }),
  })

  const rawText = await apiRes.text()
  console.log(`[runninghub] query ${apiRes.status}:`, rawText.slice(0, 1000))

  let data: any
  try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

  const errorMsg = (data as any)?.msg || (data as any)?.errorMessage
  if (apiRes.status === 429 || data.code === 429) {
    return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
  }

  if (data.code !== undefined && data.code !== 0) {
    return res.status(200).json({ ok: false, error: translateRhError(String(data.code), errorMsg) || errorMsg || `Error code: ${data.code}`, data })
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
      provider: 'markasflow-v2',
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

async function handleCheckBalance(apiKey: string, res: VercelResponse) {
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