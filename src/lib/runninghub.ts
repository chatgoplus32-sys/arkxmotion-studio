const RUNNINGHUB_PROXY = '/api/public/runninghub'

const RUNNINGHUB_DEFAULT_WORKFLOW_ID = '2092795737699856386'

function getStoredProviderKey(provider: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('arkxmotion.providers')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const keys = parsed[provider] || []
    const active = keys.find((k: any) => k.status === 'active' || k.status === 'unknown')
    return active?.key || keys[0]?.key || null
  } catch { return null }
}

export function getRunningHubApiKey(): string | null {
  return getStoredProviderKey('runninghub')
}

export async function checkRunningHubBalance(apiKey: string): Promise<{
  ok: boolean
  balance: number | null
  isValidUser: boolean
  error?: string
}> {
  try {
    const res = await fetch(RUNNINGHUB_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check-balance', apiKey }),
    })
    const data = await res.json()
    return {
      ok: data.ok ?? false,
      balance: data.balance ?? null,
      isValidUser: data.isValidUser ?? false,
      error: data.error,
    }
  } catch (err: any) {
    return { ok: false, balance: null, isValidUser: false, error: err.message }
  }
}

export function getRunningHubWorkflowId(): string {
  if (typeof window === 'undefined') return RUNNINGHUB_DEFAULT_WORKFLOW_ID
  try {
    return localStorage.getItem('runninghub.workflowId') || RUNNINGHUB_DEFAULT_WORKFLOW_ID
  } catch { return RUNNINGHUB_DEFAULT_WORKFLOW_ID }
}

export function setRunningHubWorkflowId(workflowId: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem('runninghub.workflowId', workflowId)
}

function runninghubProxy(action: string, params: Record<string, any>): Promise<any> {
  const apiKey = getRunningHubApiKey()
  if (!apiKey) throw new Error('Belum ada RunningHub API key. Silakan tambahkan di Settings.')

  return fetch(RUNNINGHUB_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, apiKey, ...params }),
  }).then(async (res) => {
    const data = await res.json()
    if (!res.ok || !data.ok) {
      const detail = data.raw
        ? ` · ${String(data.raw).slice(0, 300)}`
        : data.data
          ? ` · ${JSON.stringify(data.data).slice(0, 300)}`
          : ''
      throw new Error((data.error || `HTTP ${res.status}`) + detail)
    }
    return data.data || data
  })
}

export interface MotionControlParams {
  imageFile: File
  videoFile: File
  prompt?: string
  negativePrompt?: string
  keepOriginalSound?: boolean
  modelVersion?: string
  mode?: string
}

export interface MotionControlV26StdParams {
  imageUrl?: string
  videoUrl?: string
  imageFile?: File
  videoFile?: File
  characterOrientation?: 'image' | 'video'
  prompt?: string
  keepOriginalSound?: 'yes' | 'no'
}

export interface MotionControlResult {
  id: string
  taskId: string
  status: string
  provider: string
  workflowId?: string
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export async function submitRunningHubMotionControl(params: MotionControlParams): Promise<MotionControlResult> {
  const workflowId = getRunningHubWorkflowId()

  const [imageBase64, videoBase64] = await Promise.all([
    fileToBase64(params.imageFile),
    fileToBase64(params.videoFile),
  ])

  const result = await runninghubProxy('motion-control', {
    workflow_id: workflowId,
    imageBase64,
    videoBase64,
    imageFileName: params.imageFile.name,
    videoFileName: params.videoFile.name,
    imageMimeType: params.imageFile.type || 'image/jpeg',
    videoMimeType: params.videoFile.type || 'video/mp4',
    prompt: params.prompt || '',
    negative_prompt: params.negativePrompt || '',
    keep_original_sound: params.keepOriginalSound ?? false,
    model_version: params.modelVersion || '2.6',
    mode: params.mode || 'std',
  })

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'markasflow-v2',
    workflowId: result.workflowId || workflowId,
  }
}

export async function submitRunningHubMotionControlV26Std(params: MotionControlV26StdParams): Promise<MotionControlResult> {
  const body: Record<string, any> = {
    characterOrientation: params.characterOrientation || 'video',
    prompt: params.prompt || '',
    keepOriginalSound: params.keepOriginalSound || 'yes',
  }
  if (params.imageFile) {
    body.imageBase64 = await fileToBase64(params.imageFile)
    body.imageFileName = params.imageFile.name || 'image.jpg'
    body.imageMimeType = params.imageFile.type || 'image/jpeg'
  } else {
    body.imageUrl = params.imageUrl
  }
  if (params.videoFile) {
    body.videoBase64 = await fileToBase64(params.videoFile)
    body.videoFileName = params.videoFile.name || 'video.mp4'
    body.videoMimeType = params.videoFile.type || 'video/mp4'
  } else {
    body.videoUrl = params.videoUrl
  }
  const result = await runninghubProxy('motion-control-v2.6-std', body)

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'markasflow-v2',
  }
}

export interface MotionControlV3Params {
  imageUrl: string
  videoUrl: string
  characterOrientation?: 'image' | 'video'
  prompt?: string
  negativePrompt?: string
  keepOriginalSound?: boolean
}

export async function submitRunningHubMotionControlV26Pro(params: MotionControlV26StdParams): Promise<MotionControlResult> {
  const body: Record<string, any> = {
    characterOrientation: params.characterOrientation || 'video',
    prompt: params.prompt || '',
    keepOriginalSound: params.keepOriginalSound || 'yes',
  }
  if (params.imageFile) {
    body.imageBase64 = await fileToBase64(params.imageFile)
    body.imageFileName = params.imageFile.name || 'image.jpg'
    body.imageMimeType = params.imageFile.type || 'image/jpeg'
  } else {
    body.imageUrl = params.imageUrl
  }
  if (params.videoFile) {
    body.videoBase64 = await fileToBase64(params.videoFile)
    body.videoFileName = params.videoFile.name || 'video.mp4'
    body.videoMimeType = params.videoFile.type || 'video/mp4'
  } else {
    body.videoUrl = params.videoUrl
  }
  const result = await runninghubProxy('motion-control-v2.6-pro', body)

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'markasflow-v2',
  }
}

export async function submitRunningHubMotionControlV3(params: MotionControlV3Params): Promise<MotionControlResult> {
  const result = await runninghubProxy('motion-control-v3', {
    imageUrl: params.imageUrl,
    videoUrl: params.videoUrl,
    characterOrientation: params.characterOrientation || 'video',
    prompt: params.prompt || '',
    negativePrompt: params.negativePrompt || '',
    keepOriginalSound: params.keepOriginalSound ?? true,
  })

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'runninghub',
  }
}

export interface Seedance25Params {
  imageFiles?: File[]
  videoFile?: File
  audioFile?: File
  prompt?: string
  resolution?: string
  duration?: string
  ratio?: string
  generateAudio?: boolean
}

export async function submitSeedance25Multimodal(params: Seedance25Params): Promise<MotionControlResult> {
  const imageBase64s: { base64: string; fileName: string; mimeType: string }[] = []
  if (params.imageFiles) {
    for (const file of params.imageFiles) {
      const base64 = await fileToBase64(file)
      imageBase64s.push({ base64, fileName: file.name, mimeType: file.type || 'image/jpeg' })
    }
  }

  let videoBase64: { base64: string; fileName: string; mimeType: string } | undefined
  if (params.videoFile) {
    const base64 = await fileToBase64(params.videoFile)
    videoBase64 = { base64, fileName: params.videoFile.name, mimeType: params.videoFile.type || 'video/mp4' }
  }

  let audioBase64: { base64: string; fileName: string; mimeType: string } | undefined
  if (params.audioFile) {
    const base64 = await fileToBase64(params.audioFile)
    audioBase64 = { base64, fileName: params.audioFile.name, mimeType: params.audioFile.type || 'audio/mpeg' }
  }

  const result = await runninghubProxy('seedance25-multimodal', {
    imageBase64s,
    videoBase64,
    audioBase64,
    prompt: params.prompt || '',
    resolution: params.resolution || '720p',
    duration: params.duration || '5',
    ratio: params.ratio || '16:9',
    generateAudio: params.generateAudio ?? false,
  })

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'runninghub',
  }
}

export type RunningHubTaskStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED'

export async function pollRunningHubTask(
  taskId: string,
  onProgress?: (status: string, progress: number) => void,
  timeoutMs = 3600000,
): Promise<string> {
  const startTime = Date.now()
  const POLL_INTERVAL = 5000
  const MAX_RETRIES = 10

  const poll = async (): Promise<string> => {
    let consecutiveErrors = 0
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const result = await runninghubProxy('query', { taskId })

        consecutiveErrors = 0

        const status = (result.status || '').toUpperCase() as RunningHubTaskStatus
        const progress = result.progress || 0

        if (status === 'COMPLETED') {
          if (result.videoUrl) {
            onProgress?.('COMPLETED', 100)
            return result.videoUrl
          }
          throw new Error('Task completed but no video URL found')
        }

        if (status === 'FAILED') {
          throw new Error(result.error || 'Task failed')
        }

        onProgress?.(status || 'RUNNING', Math.min(progress, 99))
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
      } catch (err: any) {
        consecutiveErrors++
        console.warn(`[runninghub] Poll error (${consecutiveErrors}/${MAX_RETRIES}):`, err.message)
        
        if (consecutiveErrors >= MAX_RETRIES) {
          throw new Error(`Polling failed after ${MAX_RETRIES} retries: ${err.message}`)
        }
        
        await new Promise((r) => setTimeout(r, POLL_INTERVAL * Math.min(consecutiveErrors, 5)))
      }
    }

    throw new Error('Timeout: Task took too long')
  }

  return poll()
}