const RUNNINGHUB_PROXY = '/api/public/runninghub'

const RUNNINGHUB_DEFAULT_WORKFLOW_ID = '2092795737699856386'

export const RUNNINGHUB_ULTRA_HD_WORKFLOW_ID = '2102004799470764034'


// Virtual Try-On & Ekstraksi Pakaian (FireRed 2-in-1)
// node 13 = foto orang/model, node 53 = foto pakaian/garment
export const RUNNINGHUB_TRYON_WORKFLOW_ID = '2099800742046818306'
export const RUNNINGHUB_TRYON_PERSON_NODE = '13'
export const RUNNINGHUB_TRYON_GARMENT_NODE = '53'

// Virtual Try-On FLUX2-Klein (app RunningHub): transfer pakaian tubuh atas
// dengan wajah/pose/latar tetap. Urutan input sesuai contoh resmi:
// node 23 = image (Gambar Orang), node "LoadImage.0" = image (Gambar Pakaian).
// https://www.runninghub.ai/id/ai-detail/2102388260877221889
export const RUNNINGHUB_TRYON_FLUX2_APP_ID = '2102388260877221889'

// H3 Studio Markas HD 1080p Audio Sync (MiniMax H3 digital human):
// 1 foto + audio → video bicara/bernyanyi.
// node 209 = image (foto), node 215 = audio
export const RUNNINGHUB_AUDIO_AVATAR_WORKFLOW_ID = '2099332942179229697'
// MiniMax H3 Music Avatar (app RunningHub): 1 foto + audio lagu → video
// avatar menyanyi, segmen tanpa batas + video panjang.
const RUNNINGHUB_H3_MUSIC_AVATAR_APP_ID = '2111522730906955778'
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

// MiniMax H3 Ultra-HD Fast 8-Step I2V:
// node 181 = text (prompt), node 143 = image,
// node 126 = steps, node 146 = aspect_ratio
export const RUNNINGHUB_H3_I2V_WORKFLOW_ID = '2099854999999340546'
// MiniMax H3 Realistic VLOG (app RunningHub): 1 gambar + prompt VLOG
// terstruktur → video VLOG realistis 15 detik.
// node 137 = image, node 138 = text (prompt).
// https://www.runninghub.ai/id/ai-detail/2112457853784121345
export const RUNNINGHUB_H3_VLOG_APP_ID = '2112457853784121345'
// UGC Storyboard (MiniMax H3 I2V — gambar ke video multi-scene + audio)
export const RUNNINGHUB_UGC_WORKFLOW_ID = '2096092981395841025'

// Seedance 2.0 Replica — gambar + prompt storyboard → video:
// node 168 = image (gambar referensi), node 136 = text (storyboard),
// node 115 = aspect_ratio. https://www.runninghub.ai/id/ai-detail/2104455137652932609
export const RUNNINGHUB_SEEDANCE2_WORKFLOW_ID = '2104455137652932609'
export const UGC_STORYBOARD_ASPECTS = [
  '9:16 (Portrait Widescreen)', '1:1 (Square)', '2:3 (Portrait Photo)', '3:2 (Photo)',
  '3:4 (Portrait Standard)', '4:3 (Standard)', '16:9 (Widescreen)', '21:9 (Ultrawide)',
]

// Seedance 2.6 Replica (multi karakter + prompt storyboard → video):
// node 168/169/170/171/173 = image (referensi karakter), node 136 = text (storyboard),
// node 115 = aspect_ratio. https://www.runninghub.ai/id/ai-detail/2105907802166689794
export const RUNNINGHUB_SEEDANCE26_APP_ID = '2105907802166689794'

export const SEEDANCE26_MAX_IMAGES = 5

// Motion Control Pro — Motion Transfer V3 (motion transfer 15 detik):
// node 30 = image (foto karakter), node 33 = video (video referensi gerakan).
// https://www.runninghub.ai/id/ai-detail/2103523610144309249
export const RUNNINGHUB_MC_PRO_APP_ID = '2103523610144309249'

// Eposcents MC (eposcents studio by Vanixen) — motion control 512HD 32FPS,
// output maks 50 detik, flag/nama input beda: node 68 = image, node 2 = video.
// Referensi >30s otomatis pakai instance 'plus' (dikirim server dari durationHint).
// https://www.runninghub.ai/id/ai-detail/2107144516724932610
export const RUNNINGHUB_EPOSCENTS_MC_APP_ID = '2107144516724932610'

// KONTROL GERAK 50 FPS — transfer gerakan video referensi ke gambar karakter,
// output 50 FPS. Benchmark app: video 24s selesai ~17 menit.
// node 30 = image, node 33 = video. Tanpa input prompt/resolusi/fps manual.
// https://www.runninghub.ai/id/ai-detail/2112893346377531393
export const RUNNINGHUB_KONTROL_GERAKAN_APP_ID = '2112893346377531393'

// AI Song Cover Studio (app RunningHub 2104229552179425282):
// node 1 = audio (lagu asli), node 4 = prompt (gaya/arrangement cover),
// node 5 = prompt (lirik).
// https://www.runninghub.ai/ai-detail/2104229552179425282
export const RUNNINGHUB_SONG_COVER_WORKFLOW_ID = '2104229552179425282'

// PETTAPUNYA — YuE2 Indonesian Song Reimaginer (app 2102484425270693890):
// audio referensi menentukan durasi + struktur melodi, lalu YuE2 melakukan
// restyle/reimagine dengan style dan lirik baru. Bukan text-to-song murni.
// node 20 = audio, node 81 = style (positive), node 83 = lirik (positive).
// https://www.runninghub.ai/id/ai-detail/2102484425270693890
export const RUNNINGHUB_YUE2_REIMAGINER_APP_ID = '2102484425270693890'

// VOSR2 Video Upscale 2K (peningkatan bertingkat):
// node 1 = video + frame_load_cap, node 21 = cfg/scheduler/steps,
// node 13 = save_output
export const RUNNINGHUB_VIDEO_UPSCALE_WORKFLOW_ID = '2100537736599035906'

// AI Photo Enhancer (retus potret alami):
// node 642 = image (foto), node 688 = scale_by
export const RUNNINGHUB_PHOTO_ENHANCE_WORKFLOW_ID = '2100619334354759681'
export const RUNNINGHUB_TRAVEL_PHOTO_WORKFLOW_ID = '2097726202999336962'

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

export interface MotionAppParams {
  action: string
  imageFile: File
  videoFile: File
  prompt?: string
  negativePrompt?: string
  apiKey?: string
  workflowId?: string
  // Durasi video referensi dalam detik — server pakai untuk memilih
  // instanceType 'plus' bila melewati ambang app (mis. Eposcents MC >30s).
  durationHint?: number
  // Paksa kelas GPU RunningHub: default 24GB, plus 48GB, ultra 84GB.
  instanceType?: 'default' | 'plus' | 'ultra'
}

// App motion control berbasis workflow RunningHub (gambar + video referensi).
// `action` harus punya entri dengan nama sama di MOTION_APPS sisi server.
export async function submitRunningHubMotionApp(params: MotionAppParams): Promise<MotionControlResult> {
  const [imageBase64, videoBase64] = await Promise.all([
    fileToBase64(params.imageFile),
    fileToBase64(params.videoFile),
  ])

  const result = await runninghubProxy(params.action, {
    workflow_id: params.workflowId,
    imageBase64,
    videoBase64,
    imageFileName: params.imageFile.name,
    videoFileName: params.videoFile.name,
    imageMimeType: params.imageFile.type || 'image/jpeg',
    videoMimeType: params.videoFile.type || 'video/mp4',
    prompt: params.prompt || '',
    negative_prompt: params.negativePrompt || '',
    durationHint: params.durationHint ?? 0,
    instanceType: params.instanceType || '',
  }, params.apiKey)

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'runninghub',
    workflowId: result.workflowId || params.workflowId || '',
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

export async function submitRunningHubTryOnFlux2(params: TryOnParams): Promise<MotionControlResult> {
  const workflowId = params.workflowId || RUNNINGHUB_TRYON_FLUX2_APP_ID

  const [personBase64, garmentBase64] = await Promise.all([
    fileToBase64(params.personFile),
    params.garmentFile ? fileToBase64(params.garmentFile) : Promise.resolve(undefined),
  ])

  const result = await runninghubProxy('submit-tryon-flux2', {
    workflow_id: workflowId,
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
}export async function submitRunningHubAudioAvatar(params: AudioAvatarParams): Promise<MotionControlResult> {
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

export interface H3MusicAvatarParams {
  imageFile: File
  audioFile: File
  prompt?: string
  apiKey?: string
  appId?: string
}

export async function submitRunningHubH3MusicAvatar(params: H3MusicAvatarParams): Promise<MotionControlResult> {
  const appId = params.appId || RUNNINGHUB_H3_MUSIC_AVATAR_APP_ID

  const [imageBase64, audioBase64] = await Promise.all([
    fileToBase64(params.imageFile),
    fileToBase64(params.audioFile),
  ])

  const result = await runninghubProxy('submit-h3-music-avatar', {
    app_id: appId,
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
    workflowId: result.workflowId || appId,
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
}

export async function submitRunningHubPhotoEnhance(params: PhotoEnhanceParams): Promise<MotionControlResult> {
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

// ══════════════════════════════════════════════════════════════
// Qwen AI Travel Photography — 1 foto → banyak destinasi
// ══════════════════════════════════════════════════════════════
export interface TravelPhotoParams {
  characterFile: File
  destination?: string
  prompt?: string
  aspectRatio?: string
  apiKey?: string
  workflowId?: string
}

export async function submitRunningHubTravelPhoto(params: TravelPhotoParams): Promise<MotionControlResult> {
  const workflowId = params.workflowId || RUNNINGHUB_TRAVEL_PHOTO_WORKFLOW_ID

  const characterBase64 = await fileToBase64(params.characterFile)

  const result = await runninghubProxy('submit-travel-photo', {
    workflow_id: workflowId,
    characterBase64,
    characterFileName: params.characterFile.name,
    characterMimeType: params.characterFile.type || 'image/jpeg',
    destination: params.destination || '',
    prompt: params.prompt || '',
    aspectRatio: params.aspectRatio || '9:16',
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

export interface H3I2VParams {
  imageFile: File
  prompt: string
  steps?: number
  aspectRatio?: string
  apiKey?: string
  workflowId?: string
}

export async function submitRunningHubH3I2V(params: H3I2VParams): Promise<MotionControlResult> {
  const workflowId = params.workflowId || RUNNINGHUB_H3_I2V_WORKFLOW_ID

  const imageBase64 = await fileToBase64(params.imageFile)

  const result = await runninghubProxy('submit-h3-i2v', {
    workflow_id: workflowId,
    imageBase64,
    imageFileName: params.imageFile.name,
    imageMimeType: params.imageFile.type || 'image/jpeg',
    prompt: params.prompt,
    steps: params.steps ?? 8,
    aspectRatio: params.aspectRatio || 'original',
  }, params.apiKey)

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'runninghub',
    workflowId: result.workflowId || workflowId,
  }
}

export interface H3VlogParams {
  imageFile: File
  prompt: string
  apiKey?: string
  appId?: string
}

export async function submitRunningHubH3Vlog(params: H3VlogParams): Promise<MotionControlResult> {
  const appId = params.appId || RUNNINGHUB_H3_VLOG_APP_ID

  const imageBase64 = await fileToBase64(params.imageFile)

  const result = await runninghubProxy('submit-h3-vlog', {
    app_id: appId,
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
    workflowId: result.workflowId || appId,
  }
}

export interface UGCStoryboardSceneImage {
  base64: string
  fileName: string
  mimeType: string
}

export interface UGCStoryboardParams {
  characterImage: File
  sceneImages: File[]
  prompt?: string
  duration?: number
  aspectRatio?: string
  apiKey?: string
  workflowId?: string
}

export async function submitRunningHubUGCStoryboard(params: UGCStoryboardParams): Promise<MotionControlResult> {
  const workflowId = params.workflowId || RUNNINGHUB_UGC_WORKFLOW_ID

  const characterImageBase64 = await fileToBase64(params.characterImage)
  const sceneImages: UGCStoryboardSceneImage[] = []
  for (const f of params.sceneImages.slice(0, 4)) {
    sceneImages.push({
      base64: await fileToBase64(f),
      fileName: f.name || `scene${sceneImages.length + 1}.jpg`,
      mimeType: f.type || 'image/jpeg',
    })
  }

  const result = await runninghubProxy('submit-ugc-storyboard', {
    workflow_id: workflowId,
    characterImageBase64,
    characterImageFileName: params.characterImage.name || 'character.jpg',
    characterImageMimeType: params.characterImage.type || 'image/jpeg',
    sceneImages,
    prompt: params.prompt || 'follow prompt storyboards',
    duration: params.duration ?? 15,
    aspectRatio: params.aspectRatio || '9:16 (Portrait Widescreen)',
  }, params.apiKey)

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'runninghub',
    workflowId: result.workflowId || workflowId,
  }
}

export interface Seedance2Params {
  imageFile: File
  prompt?: string
  aspectRatio?: string
  apiKey?: string
  workflowId?: string
}

export async function submitRunningHubSeedance2(params: Seedance2Params): Promise<MotionControlResult> {
  const workflowId = params.workflowId || RUNNINGHUB_SEEDANCE2_WORKFLOW_ID
  const imageBase64 = await fileToBase64(params.imageFile)

  const result = await runninghubProxy('submit-seedance2', {
    workflow_id: workflowId,
    imageBase64,
    imageFileName: params.imageFile.name || 'reference.jpg',
    imageMimeType: params.imageFile.type || 'image/jpeg',
    prompt: params.prompt || 'Ikuti storyboard pada prompt.',
    aspectRatio: params.aspectRatio || '16:9 (Widescreen)',
  }, params.apiKey)

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'runninghub',
    workflowId: result.workflowId || workflowId,
  }
}

export interface Seedance26Image {
  base64: string
  fileName: string
  mimeType: string
}

export interface Seedance26Params {
  imageFiles: File[]
  prompt?: string
  aspectRatio?: string
  apiKey?: string
  workflowId?: string
}

export async function submitRunningHubSeedance26(params: Seedance26Params): Promise<MotionControlResult> {
  const appId = params.workflowId || RUNNINGHUB_SEEDANCE26_APP_ID

  const images: Seedance26Image[] = []
  for (const f of params.imageFiles.slice(0, SEEDANCE26_MAX_IMAGES)) {
    images.push({
      base64: await fileToBase64(f),
      fileName: f.name || `reference${images.length + 1}.jpg`,
      mimeType: f.type || 'image/jpeg',
    })
  }

  const result = await runninghubProxy('submit-seedance2.6', {
    workflow_id: appId,
    images,
    prompt: params.prompt || 'Ikuti storyboard pada prompt.',
    aspectRatio: params.aspectRatio || '16:9 (Widescreen)',
  }, params.apiKey)

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'runninghub',
    workflowId: result.workflowId || appId,
  }
}

export interface SongCoverParams {
  audioFile: File
  stylePrompt: string
  lyrics?: string
  apiKey?: string
  workflowId?: string
}

export async function submitRunningHubSongCover(params: SongCoverParams): Promise<MotionControlResult> {
  const workflowId = params.workflowId || RUNNINGHUB_SONG_COVER_WORKFLOW_ID
  const audioBase64 = await fileToBase64(params.audioFile)

  const result = await runninghubProxy('submit-song-cover', {
    workflow_id: workflowId,
    audioBase64,
    audioFileName: params.audioFile.name || 'song.mp3',
    audioMimeType: params.audioFile.type || 'audio/mpeg',
    stylePrompt: params.stylePrompt || '',
    lyrics: params.lyrics || '',
  }, params.apiKey)

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'runninghub',
    workflowId: result.workflowId || workflowId,
  }
}

export interface YuE2ReimaginerParams {
  audioFile: File
  stylePrompt: string
  lyrics: string
  apiKey?: string
  appId?: string
}

export async function submitRunningHubYuE2Reimaginer(params: YuE2ReimaginerParams): Promise<MotionControlResult> {
  const appId = params.appId || RUNNINGHUB_YUE2_REIMAGINER_APP_ID
  const audioBase64 = await fileToBase64(params.audioFile)

  const result = await runninghubProxy('submit-yue2-reimaginer', {
    app_id: appId,
    audioBase64,
    audioFileName: params.audioFile.name || 'reference.mp3',
    audioMimeType: params.audioFile.type || 'audio/mpeg',
    stylePrompt: params.stylePrompt || '',
    lyrics: params.lyrics || '',
  }, params.apiKey)

  return {
    id: result.id || result.taskId,
    taskId: result.taskId || result.id,
    status: result.status || 'QUEUED',
    provider: result.provider || 'runninghub',
    workflowId: result.workflowId || appId,
  }
}

// ══════════════════════════════════════════════════════════════
// Pencatatan penggunaan koin RH per model (aktual dari RunningHub)
// ══════════════════════════════════════════════════════════════
export interface RhModelUsage {
  runs: number
  coins: number
  taskSec: number
  lastAt: number
}

const RH_USAGE_KEY = 'arkxmotion.rh_usage'

export function getRhUsage(): Record<string, RhModelUsage> {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(RH_USAGE_KEY) || '{}')
  } catch { return {} }
}

export function recordRhUsage(modelLabel: string, coins = 0, taskSec = 0) {
  if (!modelLabel || typeof window === 'undefined') return
  try {
    const usage = getRhUsage()
    const cur = usage[modelLabel] || { runs: 0, coins: 0, taskSec: 0, lastAt: 0 }
    usage[modelLabel] = {
      runs: cur.runs + 1,
      coins: cur.coins + coins,
      taskSec: cur.taskSec + taskSec,
      lastAt: Date.now(),
    }
    localStorage.setItem(RH_USAGE_KEY, JSON.stringify(usage))
  } catch { /* localStorage penuh — abaikan */ }
}

export function clearRhUsage() {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(RH_USAGE_KEY) } catch { /* ignore */ }
}

export async function pollRunningHubTask(
  taskId: string,
  onProgress?: (status: string, progress: number) => void,
  timeoutMs = 3600000,
  apiKey?: string,
  modelLabel?: string,
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
          const coins = Number(result.usage?.consumeCoins ?? result.usage?.thirdPartyConsumeMoney ?? 0) || 0
          const costTime = Number(result.usage?.taskCostTime ?? 0) || 0
          if (modelLabel) recordRhUsage(modelLabel, coins, costTime)
          const url = result.imageUrl || result.videoUrl || result.audioUrl
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
          const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail)
          if (modelLabel) {
            const coins = Number(result.usage?.consumeCoins ?? 0) || 0
            if (coins > 0) recordRhUsage(modelLabel, coins, 0)
          }
          throw fatal(translateWorkflowError(detailStr, code))
        }

        onProgress?.(status || 'RUNNING', Math.min(progress, 99))
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
      } catch (err: any) {
        if (err?.fatalTaskFailure) throw err
        // Kegagalan workflow di server (mis. "工作流运行失败") bukan network error —
        // langsung fatal agar tidak retry 10x (±3 menit) dan tidak merusak key rotation.
        if (isWorkflowFailure(err?.message)) {
          throw translateWorkflowErrorAsFatal(err.message)
        }
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

function isWorkflowFailure(msg?: string): boolean {
  if (!msg) return false
  return /工作流运行失败|运行失败|workflow.*fail|task.*fail|执行失败/i.test(msg)
}

export interface RunningHubQueryFull {
  status: string
  progress: number
  videoUrl: string | null
  imageUrl: string | null
  /** Semua hasil gambar (workflow multi-output seperti Travel Photo). */
  imageUrls: string[]
  audioUrl: string | null
  usage: any
  error: string | null
}

/** Query sekali dan kembalikan SEMUA hasil (termasuk daftar gambar lengkap). */
export async function queryRunningHubTaskFull(taskId: string, apiKey?: string): Promise<RunningHubQueryFull> {
  const result = await runninghubProxy('query', { taskId }, apiKey)
  const images = Array.isArray(result.imageUrls) && result.imageUrls.length > 0
    ? result.imageUrls
    : result.imageUrl
      ? [result.imageUrl]
      : []
  return {
    status: String(result.status || '').toUpperCase(),
    progress: result.progress || 0,
    videoUrl: result.videoUrl || null,
    imageUrl: result.imageUrl || null,
    imageUrls: images,
    audioUrl: result.audioUrl || null,
    usage: result.usage || null,
    error: result.error || null,
  }
}

function translateWorkflowError(detail: string, code: string): string {
  // Saldo LLM API (node RH_LLMAPI_Pro_Node) — beda dari koin RH.
  if (/API balance is insufficient/i.test(detail)) {
    return `Task gagal${code}: Saldo LLM API RunningHub tidak cukup — fitur ini butuh "LLM API Balance" (terpisah dari koin RH). Isi ulang di RunningHub (menu LLM API / API Balance) lalu coba lagi.`
  }
  if (isWorkflowFailure(detail)) {
    return `Task gagal${code}: Workflow RunningHub gagal dijalankan. Penyebab umum: (1) gambar input ditolak model — coba JPG ≥512px, bukan hasil kompres terlalu kecil; (2) prompt terlalu pendek — coba Inggris deskriptif mis. "convert to cartoon style, keep face identity"; (3) workflow Kontext error/overload — coba lagi 1-2 menit; (4) koin RH habis. Detail asli: ${detail}`
  }
  return `Task gagal${code}: ${detail}`
}

function translateWorkflowErrorAsFatal(rawMessage: string): Error {
  if (/API balance is insufficient/i.test(rawMessage)) {
    const balErr: any = new Error(
      'Task gagal: Saldo LLM API RunningHub tidak cukup — fitur ini butuh "LLM API Balance" (terpisah dari koin RH). Isi ulang di RunningHub (menu LLM API / API Balance) lalu coba lagi.',
    )
    balErr.fatalTaskFailure = true
    return balErr
  }
  const e: any = new Error(
    `Workflow RunningHub gagal dijalankan (bukan network error, langsung berhenti agar tidak buang 3 menit retry). Penyebab umum: gambar ditolak model / prompt terlalu pendek / workflow overload / koin habis. Coba: ganti ke JPG ≥512px, prompt Inggris deskriptif, atau retry. Detail asli: ${rawMessage}`,
  )
  e.fatalTaskFailure = true
  return e
}