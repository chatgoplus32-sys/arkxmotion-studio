const RUNNINGHUB_PROXY = '/api/public/runninghub'

const RUNNINGHUB_DEFAULT_WORKFLOW_ID = '2092795737699856386'

export const RUNNINGHUB_ULTRA_HD_WORKFLOW_ID = '2095008448978407425'

// Virtual Try-On & Ekstraksi Pakaian (FireRed 2-in-1)
// node 13 = foto orang/model, node 53 = foto pakaian/garment
export const RUNNINGHUB_TRYON_WORKFLOW_ID = '2099800742046818306'
export const RUNNINGHUB_TRYON_PERSON_NODE = '13'
export const RUNNINGHUB_TRYON_GARMENT_NODE = '53'

// H3 Studio Markas HD 1080p Audio Sync (MiniMax H3 digital human):
// 1 foto + audio → video bicara/bernyanyi.
// node 209 = image (foto), node 215 = audio
export const RUNNINGHUB_AUDIO_AVATAR_WORKFLOW_ID = '2099332942179229697'
export const RUNNINGHUB_AUDIO_AVATAR_IMAGE_NODE = '209'
export const RUNNINGHUB_AUDIO_AVATAR_AUDIO_NODE = '215'

// LTX-2.5 I2V LipSync Bahasa Indonesia:
// foto + audio → video lip-sync.
// node 23 = image1, node 30 = image2, node 148 = audio,
// node 14 = width, node 15 = height, node 16 = fps
export const RUNNINGHUB_LIPSYNC_WORKFLOW_ID = '2098820058905927682'

// FLUX.1 Kontext image edit (instruksi bahasa alami):
// node 28 = image (foto), node 31 = text (perintah edit)
export const RUNNINGHUB_IMAGE_EDIT_WORKFLOW_ID = '1928844216607129602'

// VOSR2 Video Upscale 2K (peningkatan bertingkat):
// node 1 = video + frame_load_cap, node 21 = cfg/scheduler/steps,
// node 13 = save_output
export const RUNNINGHUB_VIDEO_UPSCALE_WORKFLOW_ID = '2100537736599035906'

// AI Photo Enhancer (retus potret alami):
// node 642 = image (foto), node 688 = scale_by
export const RUNNINGHUB_PHOTO_ENHANCE_WORKFLOW_ID = '2100619334354759681'

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

function runninghubProxy(action: string, params: Record<string, any>, apiKey?: string): Promise<any> {
  const key = apiKey || getRunningHubApiKey()
  if (!key) throw new Error('Belum ada RunningHub API key. Silakan tambahkan di Settings.')

  return fetch(RUNNINGHUB_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, apiKey: key, ...params }),
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
  modelVersion?: string
  mode?: string
  apiKey?: string
  workflowId?: string
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
  const workflowId = params.workflowId || getRunningHubWorkflowId()

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
  }, params.apiKey)

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

export interface MotionControlV3Params {
  imageUrl: string
  videoUrl: string
  characterOrientation?: 'image' | 'video'
  prompt?: string
  negativePrompt?: string
  keepOriginalSound?: boolean
}

export interface MotionControlUltraHDParams {
  imageFile: File
  videoFile: File
  fps?: number
  steps?: number
  maxFrames?: number
  prompt?: string
  negativePrompt?: string
  apiKey?: string
  workflowId?: string
}

export async function submitRunningHubUltraFastHD(params: MotionControlUltraHDParams): Promise<MotionControlResult> {
  const workflowId = params.workflowId || RUNNINGHUB_ULTRA_HD_WORKFLOW_ID

  const [imageBase64, videoBase64] = await Promise.all([
    fileToBase64(params.imageFile),
    fileToBase64(params.videoFile),
  ])

  const result = await runninghubProxy('motion-control-ultra-hd', {
    workflow_id: workflowId,
    imageBase64,
    videoBase64,
    imageFileName: params.imageFile.name,
    videoFileName: params.videoFile.name,
    imageMimeType: params.imageFile.type || 'image/jpeg',
    videoMimeType: params.videoFile.type || 'video/mp4',
    fps: params.fps ?? 60,
    steps: params.steps ?? 4,
    maxFrames: params.maxFrames ?? 120,
    prompt: params.prompt || '',
    negative_prompt: params.negativePrompt || '',
  }, params.apiKey)

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'runninghub',
    workflowId: result.workflowId || workflowId,
  }
}

export async function submitRunningHubMotionControlV26Pro(params: MotionControlV26StdParams): Promise<MotionControlResult> {
  const result = await runninghubProxy('motion-control-v2.6-pro', {
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

export type RunningHubTaskStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED'

export interface TryOnParams {
  personFile: File
  garmentFile?: File | null
  mode?: 'tryon' | 'extract'
  prompt?: string
  apiKey?: string
  workflowId?: string
}

export async function submitRunningHubTryOn(params: TryOnParams): Promise<MotionControlResult> {
  const workflowId = params.workflowId || RUNNINGHUB_TRYON_WORKFLOW_ID

  const fileToB64 = (f: File) => fileToBase64(f)
  const personBase64 = await fileToB64(params.personFile)
  const garmentBase64 = params.garmentFile ? await fileToB64(params.garmentFile) : undefined

  const result = await runninghubProxy('submit-tryon', {
    workflow_id: workflowId,
    mode: params.mode || 'tryon',
    personBase64,
    personFileName: params.personFile.name,
    personMimeType: params.personFile.type || 'image/jpeg',
    ...(garmentBase64 && params.garmentFile ? {
      garmentBase64,
      garmentFileName: params.garmentFile.name,
      garmentMimeType: params.garmentFile.type || 'image/jpeg',
    } : {}),
    prompt: params.prompt || '',
  }, params.apiKey)

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'runninghub',
    workflowId: result.workflowId || workflowId,
  }
}

export interface AudioAvatarParams {
  imageFile: File
  audioFile: File
  prompt?: string
  apiKey?: string
  workflowId?: string
}
export async function submitRunningHubAudioAvatar(params: AudioAvatarParams): Promise<MotionControlResult> {
  const workflowId = params.workflowId || RUNNINGHUB_AUDIO_AVATAR_WORKFLOW_ID

  const [imageBase64, audioBase64] = await Promise.all([
    fileToBase64(params.imageFile),
    fileToBase64(params.audioFile),
  ])

  const result = await runninghubProxy('submit-audio-avatar', {
    workflow_id: workflowId,
    imageBase64,
    imageFileName: params.imageFile.name,
    imageMimeType: params.imageFile.type || 'image/jpeg',
    audioBase64,
    audioFileName: params.audioFile.name,
    audioMimeType: params.audioFile.type || 'audio/mpeg',
    prompt: params.prompt || '',
  }, params.apiKey)

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'runninghub',
    workflowId: result.workflowId || workflowId,
  }
}

export interface VideoUpscaleParams {
  videoFile: File
  steps?: number
  cfg?: number
  scheduler?: string
  frameLoadCap?: number
  apiKey?: string
  workflowId?: string
}
export async function submitRunningHubVideoUpscale(params: VideoUpscaleParams): Promise<MotionControlResult> {
  const workflowId = params.workflowId || RUNNINGHUB_VIDEO_UPSCALE_WORKFLOW_ID

  const videoBase64 = await fileToBase64(params.videoFile)

  const result = await runninghubProxy('submit-video-upscale', {
    workflow_id: workflowId,
    videoBase64,
    videoFileName: params.videoFile.name,
    videoMimeType: params.videoFile.type || 'video/mp4',
    steps: params.steps ?? 4,
    cfg: params.cfg ?? 4.5,
    scheduler: params.scheduler || 'beta',
    frameLoadCap: params.frameLoadCap ?? 0,
  }, params.apiKey)

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'runninghub',
    workflowId: result.workflowId || workflowId,
  }
}

export interface PhotoEnhanceParams {
  imageFile: File
  scaleBy?: number
  apiKey?: string
  workflowId?: string
}export async function submitRunningHubPhotoEnhance(params: PhotoEnhanceParams): Promise<MotionControlResult> {
  const workflowId = params.workflowId || RUNNINGHUB_PHOTO_ENHANCE_WORKFLOW_ID

  const imageBase64 = await fileToBase64(params.imageFile)

  const result = await runninghubProxy('submit-photo-enhance', {
    workflow_id: workflowId,
    imageBase64,
    imageFileName: params.imageFile.name,
    imageMimeType: params.imageFile.type || 'image/jpeg',
    scaleBy: params.scaleBy ?? 2,
  }, params.apiKey)

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'runninghub',
    workflowId: result.workflowId || workflowId,
  }
}

export interface LipSyncParams {
  imageFile: File
  imageFile2?: File | null
  audioFile: File
  width?: number
  height?: number
  fps?: number
  prompt?: string
  apiKey?: string
  workflowId?: string
}

export async function submitRunningHubLipSync(params: LipSyncParams): Promise<MotionControlResult> {
  const workflowId = params.workflowId || RUNNINGHUB_LIPSYNC_WORKFLOW_ID

  const [imageBase64, audioBase64] = await Promise.all([
    fileToBase64(params.imageFile),
    fileToBase64(params.audioFile),
  ])
  const imageBase64_2 = params.imageFile2 ? await fileToBase64(params.imageFile2) : undefined

  const result = await runninghubProxy('submit-lipsync', {
    workflow_id: workflowId,
    imageBase64,
    imageFileName: params.imageFile.name,
    imageMimeType: params.imageFile.type || 'image/jpeg',
    ...(imageBase64_2 && params.imageFile2 ? {
      imageBase64_2,
      imageFileName2: params.imageFile2.name,
      imageMimeType2: params.imageFile2.type || 'image/jpeg',
    } : {}),
    audioBase64,
    audioFileName: params.audioFile.name,
    audioMimeType: params.audioFile.type || 'audio/mpeg',
    width: params.width ?? 1280,
    height: params.height ?? 720,
    fps: params.fps ?? 30,
    prompt: params.prompt || '',
  }, params.apiKey)

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'runninghub',
    workflowId: result.workflowId || workflowId,
  }
}

export interface ImageEditParams {
  imageFile: File
  prompt: string
  apiKey?: string
  workflowId?: string
}

export async function submitRunningHubImageEdit(params: ImageEditParams): Promise<MotionControlResult> {
  const workflowId = params.workflowId || RUNNINGHUB_IMAGE_EDIT_WORKFLOW_ID

  const imageBase64 = await fileToBase64(params.imageFile)

  const result = await runninghubProxy('submit-image-edit', {
    workflow_id: workflowId,
    imageBase64,
    imageFileName: params.imageFile.name,
    imageMimeType: params.imageFile.type || 'image/jpeg',
    prompt: params.prompt,
  }, params.apiKey)

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'runninghub',
    workflowId: result.workflowId || workflowId,
  }
}

export async function pollRunningHubTask(
  taskId: string,
  onProgress?: (status: string, progress: number) => void,
  timeoutMs = 3600000,
  apiKey?: string,
): Promise<string> {
  const startTime = Date.now()
  const POLL_INTERVAL = 5000
  const MAX_RETRIES = 10

  const poll = async (): Promise<string> => {
    let consecutiveErrors = 0

    const fatal = (msg: string): Error => {
      const e: any = new Error(msg)
      e.fatalTaskFailure = true
      return e
    }

    while (Date.now() - startTime < timeoutMs) {
      try {
        const result = await runninghubProxy('query', { taskId }, apiKey)

        consecutiveErrors = 0

        const status = (result.status || '').toUpperCase() as RunningHubTaskStatus
        const progress = result.progress || 0

        if (status === 'COMPLETED') {
          const url = result.imageUrl || result.videoUrl
          if (url) {
            onProgress?.('COMPLETED', 100)
            return url
          }
          throw fatal('Task completed but no result URL found')
        }

        if (status === 'FAILED') {
          // Task gagal di server — fatal, jangan habiskan retry.
          // Sertakan kode RunningHub kalau ada (mis. 1501 = verifikasi konten).
          const detail = result.error || result.errorMessage || 'Task failed'
          const code = result.code ? ` [${result.code}]` : ''
          throw fatal(`Task gagal${code}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
        }

        onProgress?.(status || 'RUNNING', Math.min(progress, 99))
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
      } catch (err: any) {
        if (err?.fatalTaskFailure) throw err
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