const RUNNINGHUB_PROXY = '/api/public/runninghub'

const RUNNINGHUB_DEFAULT_WORKFLOW_ID = '2084995158336192513'
const RUNNINGHUB_KLING26_MOTION_CONTROL_WORKFLOW_ID = '2054007288427499522'

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
      throw new Error(data.error || `HTTP ${res.status}`)
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
}

export interface MotionControlV26StdParams {
  imageUrl: string
  videoUrl: string
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
  const result = await runninghubProxy('motion-control-v2.6-std', {
    imageUrl: params.imageUrl,
    videoUrl: params.videoUrl,
    characterOrientation: params.characterOrientation || 'video',
    prompt: params.prompt || '',
    keepOriginalSound: params.keepOriginalSound || 'yes',
  })

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'markasflow-v2',
  }
}

export type RunningHubTaskStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED'

const ACTIVE_STATUSES: RunningHubTaskStatus[] = ['QUEUED', 'RUNNING']

export async function pollRunningHubTask(
  taskId: string,
  onProgress?: (status: string, progress: number) => void,
  timeoutMs = 3600000,
): Promise<string> {
  const startTime = Date.now()
  const POLL_INTERVAL = 5000
  const MAX_RETRIES = 3

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
        
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
      }
    }

    throw new Error('Timeout: Task took too long')
  }

  return poll()
}