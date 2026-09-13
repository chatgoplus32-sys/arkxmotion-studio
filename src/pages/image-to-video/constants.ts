import type { ProviderId } from '@/stores/providerManager'
import { LEONARDO_VIDEO_MODELS } from '@/lib/leonardo-video'

export interface ModelOption {
  value: string
  label: string
  cr: number
  provider: ProviderId
  apiModel?: string // model name for API
}

export const PROVIDER_MODELS: Record<ProviderId, ModelOption[]> = {
  weavy: [
    { value: 'sora-2', label: 'Sora 2 Pro', cr: 96, provider: 'weavy' },
    { value: 'grok-video', label: 'Grok Imagine Video v1.5', cr: 90, provider: 'weavy' },
    { value: 'gemini-omni', label: 'Gemini Omni Flash', cr: 100, provider: 'weavy' },
    { value: 'seedance-mini', label: 'Seedance 2.0 Mini', cr: 130, provider: 'weavy' },
    { value: 'kling-3-turbo', label: 'Kling 3.0 Turbo Standard', cr: 135, provider: 'weavy' },
    { value: 'kling-video', label: 'Kling Video 2.1 Pro', cr: 90, provider: 'weavy' },
  ],
  wavespeed: [
    { value: 'kling-2.1', label: 'Kling V2.1', cr: 26, provider: 'wavespeed' },
    { value: 'seedance', label: 'Seedance', cr: 30, provider: 'wavespeed' },
    { value: 'wan-i2v', label: 'Wan i2v', cr: 18, provider: 'wavespeed' },
  ],
  roboneo: [
    { value: 'rn:seedance-2.0', label: 'Seedance 2.0 (Roboneo)', cr: 143, provider: 'roboneo' },
    { value: 'rn:seedance-2.0-mini', label: 'Seedance 2.0 Mini (Roboneo)', cr: 140, provider: 'roboneo' },
    { value: 'rn:seedance-2.0-fast', label: 'Seedance 2.0 Fast (Roboneo)', cr: 90, provider: 'roboneo' },
    { value: 'rn:happyhorse-1.1', label: 'Happy Horse 1.1 (Roboneo)', cr: 144, provider: 'roboneo' },
    { value: 'rn:happyhorse-1.0', label: 'Happy Horse 1.0 (Roboneo)', cr: 120, provider: 'roboneo' },
    { value: 'rn:kling-v3', label: 'Kling 3.0 (Roboneo)', cr: 130, provider: 'roboneo' },
    { value: 'rn:kling-v3-turbo', label: 'Kling 3.0 Turbo (Roboneo)', cr: 90, provider: 'roboneo' },
    { value: 'rn:seedance-1.0', label: 'Seedance 1.0 / Pro (Roboneo)', cr: 100, provider: 'roboneo' },
    { value: 'rn:google-omni', label: 'Google Omni Flash (Roboneo)', cr: 45, provider: 'roboneo' },
    { value: 'rn:kling-v26:std', label: 'Kling 2.6 (Roboneo)', cr: 80, provider: 'roboneo' },
    { value: 'rn:kling-v21:std', label: 'Kling 2.1 (Roboneo)', cr: 65, provider: 'roboneo' },
    { value: 'rn:seedance-pro', label: 'Seedance Pro — legacy alias (Roboneo)', cr: 100, provider: 'roboneo' },
    { value: 'rn:wan-26', label: 'Wan 2.6 (Roboneo)', cr: 75, provider: 'roboneo' },
    { value: 'rn:wan-26-std', label: 'Wan 2.6 Standard (Roboneo)', cr: 55, provider: 'roboneo' },
    { value: 'rn:sora-2', label: 'Sora 2 (Roboneo)', cr: 150, provider: 'roboneo' },
    { value: 'rn:veo-3', label: 'VEO 3.0 (Roboneo)', cr: 160, provider: 'roboneo' },
    { value: 'rn:veo-3-fast', label: 'VEO 3.0 Fast (Roboneo)', cr: 100, provider: 'roboneo' },
  ],
  createpulse: [
    { value: 'cp:dreamina-seedance-2.0', label: 'Seedance 2.0 (FAST)', cr: 22, provider: 'createpulse', apiModel: 'dreamina-seedance-2.0' },
    { value: 'cp:dreamina-seedance-2.5', label: 'Seedance 2.5 (BEST)', cr: 22, provider: 'createpulse', apiModel: 'dreamina-seedance-2.5' },
    { value: 'cp:dreamina-seedance-2.0-15s', label: 'Seedance 2.0 Extended (15s)', cr: 33, provider: 'createpulse', apiModel: 'dreamina-seedance-2.0-15s' },
    { value: 'cp:dreamina-seedance-2.5-15s', label: 'Seedance 2.5 · 15 Second', cr: 33, provider: 'createpulse', apiModel: 'dreamina-seedance-2.5-15s' },
    { value: 'cp:dreamina-seedance-2.5-20s', label: 'Seedance 2.5 · 20 Second', cr: 33, provider: 'createpulse', apiModel: 'dreamina-seedance-2.5-20s' },
    { value: 'cp:dreamina-seedance-2.5-30s', label: 'Seedance 2.5 · 30 Second — longest', cr: 33, provider: 'createpulse', apiModel: 'dreamina-seedance-2.5-30s' },
    { value: 'cp:veo-omni-10s', label: 'Veo Omni (CINEMATIC)', cr: 33, provider: 'createpulse', apiModel: 'veo-omni-10s' },
  ],
  framia: [
    { value: 'framia:gemini-omni-flash', label: 'Gemini Omni Flash (Framia)', cr: 20, provider: 'framia' },
    { value: 'framia:seedance-2.0', label: 'Seedance 2.0 (Framia)', cr: 45, provider: 'framia' },
    { value: 'framia:seedance-2.0-fast', label: 'Seedance 2.0 Fast (Framia)', cr: 30, provider: 'framia' },
    { value: 'framia:kling-3.0-omni', label: 'Kling 3.0 Omni (Framia)', cr: 60, provider: 'framia' },
    { value: 'framia:kling-3.0', label: 'Kling 3.0 (Framia)', cr: 50, provider: 'framia' },
    { value: 'framia:veo-3.1', label: 'Veo 3.1 (Framia)', cr: 90, provider: 'framia' },
    { value: 'framia:veo-3.1-fast', label: 'Veo 3.1 Fast (Framia)', cr: 65, provider: 'framia' },
    { value: 'framia:wan-2.7', label: 'Wan 2.7 (Framia)', cr: 25, provider: 'framia' },
    { value: 'framia:happyhorse-1.1', label: 'HappyHorse 1.1 (Framia)', cr: 28, provider: 'framia' },
    { value: 'framia:kling-avatar', label: 'Kling Avatar (Framia)', cr: 40, provider: 'framia' },
  ],
  magnific: [
    { value: 'magnific:kling-v3-pro', label: 'Kling V3 Pro (Magnific)', cr: 84, provider: 'magnific' },
    { value: 'magnific:kling-v3-std', label: 'Kling V3 Standard (Magnific)', cr: 63, provider: 'magnific' },
  ],
  leonardo: LEONARDO_VIDEO_MODELS.map((m) => ({
    value: m.id,
    label: `${m.label} (Leonardo · ~${m.crPerSecond} cr/s)`,
    cr: m.crExamples[0]?.cr ?? Math.round(m.crPerSecond * 5),
    provider: 'leonardo' as ProviderId,
  })),
  gemini: [],
  openai: [],
  shotstack: [],
  creatomate: [],
  firefly: [
    { value: 'firefly:veo-3.1-fast', label: 'Veo 3.1 Fast (Firefly)', cr: 100, provider: 'firefly' },
    { value: 'firefly:veo-3.1', label: 'Veo 3.1 (Firefly)', cr: 130, provider: 'firefly' },
    { value: 'firefly:veo-3.1-ref', label: 'Veo 3.1 Reference I2V (Firefly)', cr: 130, provider: 'firefly' },
    { value: 'firefly:gemini-omni-flash', label: 'Gemini Omni Flash (Firefly)', cr: 80, provider: 'firefly' },
    { value: 'firefly:kling-3', label: 'Kling 3.0 I2V (Firefly)', cr: 100, provider: 'firefly' },
    { value: 'firefly:kling-v3-pro-i2v', label: 'Kling 3.0 Pro I2V (Firefly)', cr: 130, provider: 'firefly' },
  ],
  runninghub: [
    { value: 'rh:pro:2.6', label: 'Kling 2.6 Pro (Markasflow-V2)', cr: 80, provider: 'runninghub' },
    { value: 'rh:std:2.6', label: 'Kling 2.6 Standard (Markasflow-V2)', cr: 50, provider: 'runninghub' },
    { value: 'rh:pro:2.1', label: 'Kling 2.1 Pro (Markasflow-V2)', cr: 60, provider: 'runninghub' },
    { value: 'rh:std:2.1', label: 'Kling 2.1 Standard (Markasflow-V2)', cr: 35, provider: 'runninghub' },
  ],
  galleri5: [
    { value: 'g5:gemini-omni-flash-i2v', label: 'Gemini Omni Flash I2V (Galery5)', cr: 134, provider: 'galleri5' },
    { value: 'g5:wan-2.7-i2v', label: 'Wan 2.7 Image to Video (Galery5)', cr: 200, provider: 'galleri5' },
  ],
  oneover: [
    { value: 'oo:grok-imagine-video', label: 'Grok Imagine Video (OneOver)', cr: 70, provider: 'oneover', apiModel: 'grok-imagine-video' },
    { value: 'oo:seedance-2.0', label: 'Seedance 2.0 (OneOver)', cr: 70, provider: 'oneover', apiModel: 'seedance-2.0' },
    { value: 'oo:seedance-2.5', label: 'Seedance 2.5 (OneOver)', cr: 105, provider: 'oneover', apiModel: 'seedance-2.5' },
    { value: 'oo:gemini-omni-flash-preview', label: 'Gemini Omni Flash (OneOver)', cr: 80, provider: 'oneover', apiModel: 'gemini-omni-flash-preview' },
  ],
  genspark: [
    { value: 'gp:kling/v3', label: 'Kling V3 (Genspark)', cr: 130, provider: 'genspark', apiModel: 'kling/v3' },
    { value: 'gp:kling/o3', label: 'Kling O3 (Genspark)', cr: 150, provider: 'genspark', apiModel: 'kling/o3' },
    { value: 'gp:gemini/veo3.1', label: 'Gemini Veo 3.1 (Genspark)', cr: 120, provider: 'genspark', apiModel: 'gemini/veo3.1' },
    { value: 'gp:gemini/omni-flash', label: 'Gemini Omni Flash (Genspark)', cr: 100, provider: 'genspark', apiModel: 'gemini/omni-flash' },
    { value: 'gp:minimax/h3', label: 'MiniMax H3 (Genspark)', cr: 100, provider: 'genspark', apiModel: 'minimax/h3' },
    { value: 'gp:wan/v3.0', label: 'Wan 3.0 (Genspark) ⭐', cr: 70, provider: 'genspark', apiModel: 'wan/v3.0' },
    { value: 'gp:wan/v2.7', label: 'Wan v2.7 (Genspark)', cr: 60, provider: 'genspark', apiModel: 'wan/v2.7' },
    { value: 'gp:vidu/q3', label: 'Vidu Q3 (Genspark)', cr: 90, provider: 'genspark', apiModel: 'vidu/q3' },
    { value: 'gp:runway/gen4_turbo', label: 'Runway Gen4 Turbo (Genspark)', cr: 80, provider: 'genspark', apiModel: 'runway/gen4_turbo' },
    { value: 'gp:pixverse/v6', label: 'PixVerse V6 (Genspark)', cr: 70, provider: 'genspark', apiModel: 'pixverse/v6' },
    { value: 'gp:pixverse/c1', label: 'PixVerse C1 (Genspark)', cr: 80, provider: 'genspark', apiModel: 'pixverse/c1' },
    { value: 'gp:fal-ai/bytedance/seedance-2.0', label: 'Seedance 2.0 (Genspark)', cr: 100, provider: 'genspark', apiModel: 'fal-ai/bytedance/seedance-2.0' },
    { value: 'gp:fal-ai/bytedance/seedance-2.5', label: 'Seedance 2.5 (Genspark) ⭐ 30s', cr: 110, provider: 'genspark', apiModel: 'fal-ai/bytedance/seedance-2.5' },
    { value: 'gp:xai/grok-imagine-video', label: 'Grok Imagine Video (Genspark)', cr: 90, provider: 'genspark', apiModel: 'xai/grok-imagine-video' },
    { value: 'gp:bfl/flux-3-preview-high', label: 'BFL FLUX 3 (Genspark) ⭐', cr: 100, provider: 'genspark', apiModel: 'bfl/flux-3-preview-high' },
    { value: 'gp:alibaba/happy-horse', label: 'Alibaba Happy Horse (Genspark)', cr: 90, provider: 'genspark', apiModel: 'alibaba/happy-horse' },
    { value: 'gp:alibaba/happy-horse/reference-to-video', label: 'Happy Horse Ref-to-Video (Genspark)', cr: 100, provider: 'genspark', apiModel: 'alibaba/happy-horse/reference-to-video' },
  ],
  riverside: [
    { value: 'rs:veo-3.1', label: 'Veo 3.1 (Riverside)', cr: 26, provider: 'riverside', apiModel: 'veo-3.1' },
    { value: 'rs:gemini-omni-flash', label: 'Gemini Omni Flash (Riverside)', cr: 9, provider: 'riverside', apiModel: 'gemini-omni-flash' },
    { value: 'rs:gemini-omni-flash-edit', label: 'Gemini Omni Flash Edit (Riverside)', cr: 9, provider: 'riverside', apiModel: 'gemini-omni-flash-edit' },
    { value: 'rs:hailuo-2.3-pro', label: 'Hailuo 2.3 Pro (Riverside)', cr: 7, provider: 'riverside', apiModel: 'hailuo-2.3-pro' },
    { value: 'rs:happyhorse-1.1', label: 'HappyHorse 1.1 (Riverside)', cr: 12, provider: 'riverside', apiModel: 'happyhorse-1.1' },
    { value: 'rs:kling-3.0-pro', label: 'Kling 3.0 Pro (Riverside)', cr: 13, provider: 'riverside', apiModel: 'kling-3.0-pro' },
  ],
  // NexaBot hanya menyediakan satu model: Google Omni. API-nya tidak punya parameter
  // `model` (docs resmi hanya: mode, prompt, telegram_id, ratio), jadi mode spesifik
  // (start frame / image / video reference) diturunkan otomatis dari media yang di-upload.
  nexabot: [
    { value: 'nb:omni', label: '✨ Google Omni (NexaBot)', cr: 0.25, provider: 'nexabot', apiModel: 't2v' },
  ],
}

export const QUALITY_OPTIONS: Record<ProviderId, Record<string, Array<{ value: string; label: string; mult: number; duration: number; cr?: number; resolution?: string; sound?: string; sizeTier?: string }>>> = {
  weavy: {
    'sora-2': [
      { value: '16s-720p', label: '16 detik · 720p', mult: 1, duration: 16, cr: 96, resolution: '720p' },
      { value: '12s-720p', label: '12 detik · 720p', mult: 1, duration: 12, cr: 96, resolution: '720p' },
      { value: '8s-720p', label: '8 detik · 720p', mult: 1, duration: 8, cr: 96, resolution: '720p' },
      { value: '4s-720p', label: '4 detik · 720p', mult: 1, duration: 4, cr: 96, resolution: '720p' },
    ],
    'grok-video': [
      { value: '15s-720p', label: '15 detik · 720p', mult: 1, duration: 15, cr: 90, resolution: '720p' },
      { value: '10s-720p', label: '10 detik · 720p', mult: 1, duration: 10, cr: 90, resolution: '720p' },
      { value: '5s-720p', label: '5 detik · 720p', mult: 1, duration: 5, cr: 90, resolution: '720p' },
    ],
    'gemini-omni': [
      { value: '10s', label: '10 detik', mult: 1, duration: 10, cr: 125, resolution: '720p' },
      { value: '8s', label: '8 detik', mult: 1, duration: 8, cr: 100, resolution: '720p' },
    ],
    'seedance-mini': [
      { value: '10s-720p', label: '10 detik · 720p', mult: 1, duration: 10, cr: 130, resolution: '720p' },
      { value: '10s-480p', label: '10 detik · 480p', mult: 1, duration: 10, cr: 130, resolution: '480p' },
      { value: '5s-720p', label: '5 detik · 720p', mult: 1, duration: 5, cr: 130, resolution: '720p' },
      { value: '5s-480p', label: '5 detik · 480p', mult: 1, duration: 5, cr: 130, resolution: '480p' },
    ],
    'kling-3-turbo': [
      { value: '15s', label: '15 detik', mult: 1, duration: 15, cr: 135, resolution: '720p' },
      { value: '10s', label: '10 detik', mult: 1, duration: 10, cr: 135, resolution: '720p' },
      { value: '5s', label: '5 detik', mult: 1, duration: 5, cr: 135, resolution: '720p' },
    ],
    'kling-video': [
      { value: '10s', label: '10 detik', mult: 1, duration: 10, cr: 90, resolution: '720p' },
      { value: '5s', label: '5 detik', mult: 1, duration: 5, cr: 90, resolution: '720p' },
    ],
  },
  wavespeed: {
    default: [
      { value: 'std', label: 'Standard 5s', mult: 1, duration: 5 },
      { value: 'long', label: 'Long 10s', mult: 2, duration: 10 },
    ],
  },
  roboneo: {
    'rn:seedance-2.0': [
      { value: '480p-10s-audio', label: '480p · 10s · audio', mult: 1, duration: 10, resolution: '480p', sound: 'on', cr: 143 },
      { value: '480p-10s', label: '480p · 10s', mult: 1, duration: 10, resolution: '480p', sound: 'off', cr: 120 },
      { value: '480p-5s-audio', label: '480p · 5s · audio', mult: 1, duration: 5, resolution: '480p', sound: 'on', cr: 75 },
      { value: '480p-5s', label: '480p · 5s', mult: 1, duration: 5, resolution: '480p', sound: 'off', cr: 60 },
    ],
    'rn:seedance-2.0-mini': [
      { value: '480p-12s-audio', label: '480p · 12s · audio', mult: 1, duration: 12, resolution: '480p', sound: 'on', cr: 140 },
      { value: '480p-10s-audio', label: '480p · 10s · audio', mult: 1, duration: 10, resolution: '480p', sound: 'on', cr: 118 },
      { value: '480p-5s-audio', label: '480p · 5s · audio', mult: 1, duration: 5, resolution: '480p', sound: 'on', cr: 60 },
      { value: '480p-5s', label: '480p · 5s', mult: 1, duration: 5, resolution: '480p', sound: 'off', cr: 48 },
    ],
    'rn:seedance-2.0-fast': [
      { value: '480p-10s', label: '480p · 10s', mult: 1, duration: 10, resolution: '480p', sound: 'off', cr: 90 },
      { value: '480p-5s', label: '480p · 5s', mult: 1, duration: 5, resolution: '480p', sound: 'off', cr: 45 },
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', sound: 'off', cr: 65 },
    ],
    'rn:happyhorse-1.1': [
      { value: '720p-14s', label: '720p · 14s', mult: 1, duration: 14, resolution: '720p', cr: 144 },
      { value: '720p-10s', label: '720p · 10s', mult: 1, duration: 10, resolution: '720p', cr: 100 },
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 50 },
      { value: '480p-14s', label: '480p · 14s', mult: 1, duration: 14, resolution: '480p', cr: 100 },
    ],
    'rn:happyhorse-1.0': [
      { value: '720p-10s', label: '720p · 10s', mult: 1, duration: 10, resolution: '720p', cr: 120 },
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 60 },
    ],
    'rn:kling-v3': [
      { value: '10s-off', label: '10s · No Sound', mult: 1, duration: 10, sound: 'off', cr: 130 },
      { value: '5s-off', label: '5s · No Sound', mult: 1, duration: 5, sound: 'off', cr: 65 },
      { value: '5s-on', label: '5s · Sound', mult: 1, duration: 5, sound: 'on', cr: 85 },
    ],
    'rn:kling-v3-turbo': [
      { value: '10s-off', label: '10s · No Sound', mult: 1, duration: 10, sound: 'off', cr: 90 },
      { value: '5s-off', label: '5s · No Sound', mult: 1, duration: 5, sound: 'off', cr: 45 },
    ],
    'rn:seedance-1.0': [
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 50 },
      { value: '720p-10s', label: '720p · 10s', mult: 1, duration: 10, resolution: '720p', cr: 100 },
      { value: '720p-12s', label: '720p · 12s', mult: 1, duration: 12, resolution: '720p', cr: 120 },
      { value: '480p-5s', label: '480p · 5s', mult: 1, duration: 5, resolution: '480p', cr: 35 },
    ],
    'rn:seedance-pro': [
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 50 },
      { value: '720p-10s', label: '720p · 10s', mult: 1, duration: 10, resolution: '720p', cr: 100 },
      { value: '720p-12s', label: '720p · 12s', mult: 1, duration: 12, resolution: '720p', cr: 120 },
      { value: '480p-5s', label: '480p · 5s', mult: 1, duration: 5, resolution: '480p', cr: 35 },
    ],
    'rn:google-omni': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5, cr: 25 },
      { value: '10s', label: 'Durasi 10s', mult: 1, duration: 10, cr: 45 },
    ],
    'rn:kling-v26:std': [
      { value: '5s-off', label: '5s · No Sound', mult: 1, duration: 5, sound: 'off', cr: 40 },
      { value: '5s-on', label: '5s · Sound', mult: 1, duration: 5, sound: 'on', cr: 55 },
      { value: '10s-off', label: '10s · No Sound', mult: 1, duration: 10, sound: 'off', cr: 80 },
      { value: '10s-on', label: '10s · Sound', mult: 1, duration: 10, sound: 'on', cr: 105 },
    ],
    'rn:kling-v21:std': [
      { value: '5s-off', label: '5s · No Sound', mult: 1, duration: 5, sound: 'off', cr: 30 },
      { value: '5s-on', label: '5s · Sound', mult: 1, duration: 5, sound: 'on', cr: 45 },
      { value: '10s-off', label: '10s · No Sound', mult: 1, duration: 10, sound: 'off', cr: 65 },
      { value: '10s-on', label: '10s · Sound', mult: 1, duration: 10, sound: 'on', cr: 85 },
    ],

    'rn:wan-26': [
      { value: '720p-10s-audio', label: '720p · 10s · audio', mult: 1, duration: 10, resolution: '720p', sound: 'on', cr: 75 },
      { value: '720p-5s-audio', label: '720p · 5s · audio', mult: 1, duration: 5, resolution: '720p', sound: 'on', cr: 40 },
      { value: '480p-10s', label: '480p · 10s', mult: 1, duration: 10, resolution: '480p', sound: 'off', cr: 55 },
      { value: '480p-5s', label: '480p · 5s', mult: 1, duration: 5, resolution: '480p', sound: 'off', cr: 30 },
    ],
    'rn:wan-26-std': [
      { value: '720p-10s', label: '720p · 10s', mult: 1, duration: 10, resolution: '720p', sound: 'off', cr: 55 },
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', sound: 'off', cr: 30 },
      { value: '480p-10s', label: '480p · 10s', mult: 1, duration: 10, resolution: '480p', sound: 'off', cr: 40 },
      { value: '480p-5s', label: '480p · 5s', mult: 1, duration: 5, resolution: '480p', sound: 'off', cr: 22 },
    ],
    'rn:sora-2': [
      { value: '720p-10s', label: '720p · 10s', mult: 1, duration: 10, resolution: '720p', cr: 150 },
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 80 },
      { value: '480p-10s', label: '480p · 10s', mult: 1, duration: 10, resolution: '480p', cr: 100 },
    ],
    'rn:veo-3': [
      { value: '720p-10s', label: '720p · 10s', mult: 1, duration: 10, resolution: '720p', cr: 160 },
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 85 },
      { value: '480p-10s', label: '480p · 10s', mult: 1, duration: 10, resolution: '480p', cr: 110 },
    ],
    'rn:veo-3-fast': [
      { value: '720p-10s', label: '720p · 10s', mult: 1, duration: 10, resolution: '720p', cr: 100 },
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 55 },
      { value: '480p-10s', label: '480p · 10s', mult: 1, duration: 10, resolution: '480p', cr: 70 },
    ],
    default: [
      { value: 'std', label: 'Standard 5s', mult: 1, duration: 5 },
    ],
  },
  createpulse: {
    'cp:dreamina-seedance-2.0': [
      { value: '10s', label: '10 detik', mult: 1, duration: 10 },
    ],
    'cp:dreamina-seedance-2.5': [
      { value: '10s', label: '10 detik', mult: 1, duration: 10 },
    ],
    'cp:dreamina-seedance-2.0-15s': [
      { value: '15s', label: '15 detik', mult: 1, duration: 15 },
    ],
    'cp:dreamina-seedance-2.5-15s': [
      { value: '15s', label: '15 detik', mult: 1, duration: 15 },
    ],
    'cp:dreamina-seedance-2.5-20s': [
      { value: '20s', label: '20 detik', mult: 1, duration: 20 },
    ],
    'cp:dreamina-seedance-2.5-30s': [
      { value: '30s', label: '30 detik', mult: 1, duration: 30 },
    ],
    'cp:veo-omni-10s': [
      { value: '10s', label: '10 detik', mult: 1, duration: 10 },
    ],
    default: [
      { value: '10s', label: '10 detik', mult: 1, duration: 10 },
    ],
  },
  framia: {
    'framia:gemini-omni-flash': [
      { value: '720p-10s', label: '720p · 10s', mult: 2, duration: 10, resolution: '720p', cr: 45 },
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 25 },
    ],
    'framia:seedance-2.0': [
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 25 },
      { value: '720p-10s', label: '720p · 10s', mult: 2, duration: 10, resolution: '720p', cr: 45 },
    ],
    'framia:seedance-2.0-fast': [
      { value: '720p-5s', label: '720p · 5s', mult: 1, duration: 5, resolution: '720p', cr: 15 },
      { value: '720p-10s', label: '720p · 10s', mult: 2, duration: 10, resolution: '720p', cr: 25 },
    ],
    'framia:kling-3.0-omni': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5, cr: 40 },
      { value: '10s', label: 'Durasi 10s', mult: 2, duration: 10, cr: 80 },
    ],
    'framia:kling-3.0': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5, cr: 30 },
      { value: '10s', label: 'Durasi 10s', mult: 2, duration: 10, cr: 60 },
    ],
    'framia:veo-3.1': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5, cr: 90 },
      { value: '10s', label: 'Durasi 10s', mult: 2, duration: 10, cr: 180 },
    ],
    'framia:veo-3.1-fast': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5, cr: 65 },
      { value: '10s', label: 'Durasi 10s', mult: 2, duration: 10, cr: 130 },
    ],
    'framia:wan-2.7': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5, cr: 20 },
      { value: '10s', label: 'Durasi 10s', mult: 2, duration: 10, cr: 40 },
    ],
    'framia:happyhorse-1.1': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5, cr: 28 },
      { value: '10s', label: 'Durasi 10s', mult: 2, duration: 10, cr: 56 },
    ],
    'framia:kling-avatar': [
      { value: '5s', label: 'Durasi 5s', mult: 1, duration: 5, cr: 40 },
      { value: '10s', label: 'Durasi 10s', mult: 2, duration: 10, cr: 80 },
    ],
    default: [
      { value: 'std', label: 'Standard', mult: 1, duration: 10, cr: 45 },
      { value: 'long', label: 'Long 15s', mult: 1.5, duration: 15, cr: 68 },
    ],
  },
  magnific: {
    default: [
      { value: 'std', label: 'Standard 5s', mult: 1, duration: 5 },
    ],
  },
  leonardo: {},
  gemini: { default: [] },
  openai: { default: [] },
  shotstack: { default: [] },
  creatomate: { default: [] },
  firefly: {
    default: [
      { value: '5s', label: '5 detik', mult: 1, duration: 5 },
    ],

    'firefly:veo-3.1-fast': [
      { value: '4s', label: '4 detik', mult: 1, duration: 4 },
      { value: '6s', label: '6 detik', mult: 1, duration: 6 },
      { value: '8s', label: '8 detik', mult: 1, duration: 8 },
    ],
    'firefly:veo-3.1': [
      { value: '4s', label: '4 detik', mult: 1, duration: 4 },
      { value: '6s', label: '6 detik', mult: 1, duration: 6 },
      { value: '8s', label: '8 detik', mult: 1, duration: 8 },
    ],
    'firefly:veo-3.1-ref': [
      { value: '8s', label: '8 detik', mult: 1, duration: 8 },
    ],
    'firefly:gemini-omni-flash': [
      { value: '5s', label: '5 detik', mult: 1, duration: 5 },
      { value: '8s', label: '8 detik', mult: 1, duration: 8 },
      { value: '10s', label: '10 detik', mult: 1, duration: 10 },
    ],
    'firefly:kling-3': [
      { value: '5s', label: '5 detik', mult: 1, duration: 5 },
      { value: '10s', label: '10 detik', mult: 2, duration: 10 },
      { value: '15s', label: '15 detik', mult: 3, duration: 15 },
    ],
    'firefly:kling-v3-pro-i2v': [
      { value: '5s', label: '5 detik', mult: 1, duration: 5 },
      { value: '10s', label: '10 detik', mult: 2, duration: 10 },
    ],
  },
  runninghub: {
    default: [
      { value: 'std', label: 'Standard 5s', mult: 1, duration: 5 },
      { value: 'long', label: 'Long 10s', mult: 2, duration: 10 },
    ],
  },
  galleri5: {
    'g5:gemini-omni-flash-i2v': [
      { value: '10s-720p', label: '10 detik · 720p', mult: 1, duration: 10, cr: 134, resolution: '720p' },
      { value: '8s-720p', label: '8 detik · 720p', mult: 1, duration: 8, cr: 134, resolution: '720p' },
      { value: '5s-720p', label: '5 detik · 720p', mult: 1, duration: 5, cr: 134, resolution: '720p' },
    ],
    'g5:wan-2.7-i2v': [
      { value: '15s-1080p', label: '15 detik · 1080p', mult: 1, duration: 15, cr: 200, resolution: '1080p' },
      { value: '15s-720p', label: '15 detik · 720p', mult: 1, duration: 15, cr: 200, resolution: '720p' },
      { value: '10s-1080p', label: '10 detik · 1080p', mult: 1, duration: 10, cr: 200, resolution: '1080p' },
      { value: '10s-720p', label: '10 detik · 720p', mult: 1, duration: 10, cr: 200, resolution: '720p' },
      { value: '5s-1080p', label: '5 detik · 1080p', mult: 1, duration: 5, cr: 200, resolution: '1080p' },
      { value: '5s-720p', label: '5 detik · 720p', mult: 1, duration: 5, cr: 200, resolution: '720p' },
    ],
  },
  oneover: {
    'oo:grok-imagine-video': [
      { value: '15s-720p', label: '15 detik · 720p', mult: 1, duration: 15, cr: 210, resolution: '720p' },
      { value: '10s-720p', label: '10 detik · 720p', mult: 1, duration: 10, cr: 140, resolution: '720p' },
      { value: '5s-720p', label: '5 detik · 720p', mult: 1, duration: 5, cr: 70, resolution: '720p' },
      { value: '15s-480p', label: '15 detik · 480p', mult: 1, duration: 15, cr: 150, resolution: '480p' },
      { value: '10s-480p', label: '10 detik · 480p', mult: 1, duration: 10, cr: 100, resolution: '480p' },
      { value: '5s-480p', label: '5 detik · 480p', mult: 1, duration: 5, cr: 50, resolution: '480p' },
    ],
    'oo:seedance-2.0': [
      { value: '10s-720p', label: '10 detik · 720p · 🔊 audio', mult: 1, duration: 10, cr: 140, resolution: '720p', sound: 'on' },
      { value: '5s-720p', label: '5 detik · 720p · 🔊 audio', mult: 1, duration: 5, cr: 70, resolution: '720p', sound: 'on' },
      { value: '10s-480p', label: '10 detik · 480p · 🔊 audio', mult: 1, duration: 10, cr: 140, resolution: '480p', sound: 'on' },
      { value: '5s-480p', label: '5 detik · 480p · 🔊 audio', mult: 1, duration: 5, cr: 70, resolution: '480p', sound: 'on' },
    ],
    'oo:seedance-2.5': [
      { value: '30s-480p', label: '30 detik · 480p · 🔊 audio', mult: 1, duration: 30, cr: 630, resolution: '480p', sound: 'on' },
      { value: '20s-480p', label: '20 detik · 480p · 🔊 audio', mult: 1, duration: 20, cr: 420, resolution: '480p', sound: 'on' },
      { value: '15s-480p', label: '15 detik · 480p · 🔊 audio', mult: 1, duration: 15, cr: 315, resolution: '480p', sound: 'on' },
      { value: '10s-480p', label: '10 detik · 480p · 🔊 audio', mult: 1, duration: 10, cr: 210, resolution: '480p', sound: 'on' },
      { value: '5s-480p', label: '5 detik · 480p · 🔊 audio', mult: 1, duration: 5, cr: 105, resolution: '480p', sound: 'on' },
      { value: '10s-720p', label: '10 detik · 720p · 🔊 audio', mult: 1, duration: 10, cr: 470, resolution: '720p', sound: 'on' },
    ],
    'oo:gemini-omni-flash-preview': [
      { value: '10s-720p', label: '10 detik · 720p · 🔊 audio', mult: 1, duration: 10, cr: 200, resolution: '720p', sound: 'on' },
      { value: '8s-720p', label: '8 detik · 720p · 🔊 audio', mult: 1, duration: 8, cr: 160, resolution: '720p', sound: 'on' },
      { value: '6s-720p', label: '6 detik · 720p · 🔊 audio', mult: 1, duration: 6, cr: 120, resolution: '720p', sound: 'on' },
      { value: '4s-720p', label: '4 detik · 720p · 🔊 audio', mult: 1, duration: 4, cr: 80, resolution: '720p', sound: 'on' },
    ],
    default: [
      { value: '10s', label: '10 detik', mult: 1, duration: 10 },
      { value: '5s', label: '5 detik', mult: 1, duration: 5 },
    ],
  },
  genspark: {
    'gp:kling/v3': [
      { value: '10s', label: '10 detik · 720p', mult: 1, duration: 10, resolution: '720p' },
      { value: '5s', label: '5 detik · 720p', mult: 1, duration: 5, resolution: '720p' },
    ],
    'gp:kling/o3': [
      { value: '10s', label: '10 detik · 720p', mult: 1, duration: 10, resolution: '720p' },
      { value: '5s', label: '5 detik · 720p', mult: 1, duration: 5, resolution: '720p' },
    ],
    'gp:gemini/veo3.1': [
      { value: '8s-1080p', label: '8 detik · 1080p', mult: 1, duration: 8, resolution: '1080p' },
      { value: '6s-1080p', label: '6 detik · 1080p', mult: 1, duration: 6, resolution: '1080p' },
      { value: '4s-1080p', label: '4 detik · 1080p', mult: 1, duration: 4, resolution: '1080p' },
      { value: '8s-720p', label: '8 detik · 720p', mult: 1, duration: 8, resolution: '720p' },
      { value: '6s-720p', label: '6 detik · 720p', mult: 1, duration: 6, resolution: '720p' },
      { value: '4s-720p', label: '4 detik · 720p', mult: 1, duration: 4, resolution: '720p' },
    ],
    'gp:minimax/h3': [
      { value: '15s-2k', label: '15 detik · 2K', mult: 1, duration: 15, resolution: '2k' },
      { value: '10s-2k', label: '10 detik · 2K', mult: 1, duration: 10, resolution: '2k' },
      { value: '5s-2k', label: '5 detik · 2K', mult: 1, duration: 5, resolution: '2k' },
    ],
    'gp:wan/v2.7': [
      { value: '5s-720p', label: '5 detik · 720p', mult: 1, duration: 5, resolution: '720p' },
      { value: '5s-480p', label: '5 detik · 480p', mult: 1, duration: 5, resolution: '480p' },
    ],
    'gp:vidu/q3': [
      { value: '16s-1080p', label: '16 detik · 1080p', mult: 1, duration: 16, resolution: '1080p' },
      { value: '10s-1080p', label: '10 detik · 1080p', mult: 1, duration: 10, resolution: '1080p' },
      { value: '5s-1080p', label: '5 detik · 1080p', mult: 1, duration: 5, resolution: '1080p' },
      { value: '10s-720p', label: '10 detik · 720p', mult: 1, duration: 10, resolution: '720p' },
      { value: '5s-720p', label: '5 detik · 720p', mult: 1, duration: 5, resolution: '720p' },
    ],
    'gp:runway/gen4_turbo': [
      { value: '10s', label: '10 detik', mult: 1, duration: 10 },
      { value: '5s', label: '5 detik', mult: 1, duration: 5 },
    ],
    'gp:pixverse/v6': [
      { value: '8s-1080p', label: '8 detik · 1080p', mult: 1, duration: 8, resolution: '1080p' },
      { value: '5s-1080p', label: '5 detik · 1080p', mult: 1, duration: 5, resolution: '1080p' },
      { value: '8s-720p', label: '8 detik · 720p', mult: 1, duration: 8, resolution: '720p' },
      { value: '5s-720p', label: '5 detik · 720p', mult: 1, duration: 5, resolution: '720p' },
    ],
    'gp:pixverse/c1': [
      { value: '15s-1080p', label: '15 detik · 1080p · 🔊 audio', mult: 1, duration: 15, resolution: '1080p', sound: 'on' },
      { value: '10s-1080p', label: '10 detik · 1080p · 🔊 audio', mult: 1, duration: 10, resolution: '1080p', sound: 'on' },
      { value: '5s-1080p', label: '5 detik · 1080p · 🔊 audio', mult: 1, duration: 5, resolution: '1080p', sound: 'on' },
      { value: '10s-720p', label: '10 detik · 720p · 🔊 audio', mult: 1, duration: 10, resolution: '720p', sound: 'on' },
    ],
    'gp:fal-ai/bytedance/seedance-2.0': [
      { value: '10s-1080p', label: '10 detik · 1080p', mult: 1, duration: 10, resolution: '1080p' },
      { value: '5s-1080p', label: '5 detik · 1080p', mult: 1, duration: 5, resolution: '1080p' },
      { value: '10s-720p', label: '10 detik · 720p', mult: 1, duration: 10, resolution: '720p' },
      { value: '5s-720p', label: '5 detik · 720p', mult: 1, duration: 5, resolution: '720p' },
      { value: '10s-480p', label: '10 detik · 480p', mult: 1, duration: 10, resolution: '480p' },
      { value: '5s-480p', label: '5 detik · 480p', mult: 1, duration: 5, resolution: '480p' },
    ],
    'gp:xai/grok-imagine-video': [
      { value: '15s-1080p', label: '15 detik · 1080p', mult: 1, duration: 15, resolution: '1080p' },
      { value: '10s-1080p', label: '10 detik · 1080p', mult: 1, duration: 10, resolution: '1080p' },
      { value: '5s-1080p', label: '5 detik · 1080p', mult: 1, duration: 5, resolution: '1080p' },
      { value: '10s-720p', label: '10 detik · 720p', mult: 1, duration: 10, resolution: '720p' },
      { value: '5s-720p', label: '5 detik · 720p', mult: 1, duration: 5, resolution: '720p' },
    ],
    default: [
      { value: '10s', label: '10 detik', mult: 1, duration: 10 },
      { value: '5s', label: '5 detik', mult: 1, duration: 5 },
    ],
  },
  riverside: {
    'rs:veo-3.1': [
      { value: '10s-4k', label: '10 detik · 4K', mult: 1, duration: 10, cr: 260, resolution: '4k' },
      { value: '8s-4k', label: '8 detik · 4K', mult: 1, duration: 8, cr: 208, resolution: '4k' },
      { value: '8s-1080p', label: '8 detik · 1080p', mult: 1, duration: 8, cr: 208, resolution: '1080p' },
      { value: '4s-1080p', label: '4 detik · 1080p', mult: 1, duration: 4, cr: 104, resolution: '1080p' },
    ],
    'rs:gemini-omni-flash': [
      { value: '10s', label: '10 detik', mult: 1, duration: 10, cr: 90 },
      { value: '8s', label: '8 detik', mult: 1, duration: 8, cr: 72 },
      { value: '4s', label: '4 detik', mult: 1, duration: 4, cr: 36 },
    ],
    'rs:gemini-omni-flash-edit': [
      { value: '10s', label: '10 detik', mult: 1, duration: 10, cr: 90 },
      { value: '8s', label: '8 detik', mult: 1, duration: 8, cr: 72 },
      { value: '4s', label: '4 detik', mult: 1, duration: 4, cr: 36 },
    ],
    'rs:hailuo-2.3-pro': [
      { value: '10s-1080p', label: '10 detik · 1080p', mult: 1, duration: 10, cr: 70, resolution: '1080p' },
      { value: '8s-1080p', label: '8 detik · 1080p', mult: 1, duration: 8, cr: 56, resolution: '1080p' },
      { value: '8s-720p', label: '8 detik · 720p', mult: 1, duration: 8, cr: 56, resolution: '720p' },
      { value: '4s-720p', label: '4 detik · 720p', mult: 1, duration: 4, cr: 28, resolution: '720p' },
    ],
    'rs:happyhorse-1.1': [
      { value: '10s-1080p', label: '10 detik · 1080p', mult: 1, duration: 10, cr: 120, resolution: '1080p' },
      { value: '8s-1080p', label: '8 detik · 1080p', mult: 1, duration: 8, cr: 96, resolution: '1080p' },
      { value: '8s-720p', label: '8 detik · 720p', mult: 1, duration: 8, cr: 96, resolution: '720p' },
      { value: '4s-720p', label: '4 detik · 720p', mult: 1, duration: 4, cr: 48, resolution: '720p' },
    ],
    'rs:kling-3.0-pro': [
      { value: '10s-1080p', label: '10 detik · 1080p', mult: 1, duration: 10, cr: 130, resolution: '1080p' },
      { value: '8s-1080p', label: '8 detik · 1080p', mult: 1, duration: 8, cr: 104, resolution: '1080p' },
      { value: '8s-720p', label: '8 detik · 720p', mult: 1, duration: 8, cr: 104, resolution: '720p' },
      { value: '4s-720p', label: '4 detik · 720p', mult: 1, duration: 4, cr: 52, resolution: '720p' },
    ],
    default: [
      { value: '8s', label: '8 detik', mult: 1, duration: 8 },
      { value: '4s', label: '4 detik', mult: 1, duration: 4 },
    ],
  },
  nexabot: {
    // Durasi tidak dikirim ke API NexaBot (tidak ada parameter durasi/max_seconds),
    // jadi semua mode memakai daftar yang sama. `cr` wajib diisi eksplisit:
    // totalCredits memakai Math.round(cr * mult), dan Math.round(0.25) = 0.
    default: [
      { value: '5s', label: '5 detik', mult: 1, duration: 5, cr: 0.25 },
      { value: '10s', label: '10 detik', mult: 1, duration: 10, cr: 0.25 },
    ],
  },
}

export const CP_PRICES: Record<string, number> = {
  'dreamina-seedance-2.0': 1500,
  'dreamina-seedance-2.5': 1500,
  'dreamina-seedance-2.0-15s': 2250,
  'dreamina-seedance-2.5-15s': 2500,
  'dreamina-seedance-2.5-20s': 3000,
  'dreamina-seedance-2.5-30s': 4500,
  'veo-omni-10s': 2250,
}
export const getCreatepulseCost = (apiModel?: string) => apiModel ? (CP_PRICES[apiModel] ?? 1500) : 1500

export const RATIOS = ['16:9', '9:16', '1:1', '4:3']

/** Model-specific ratio restrictions (empty = use all RATIOS). */
export const MODEL_RATIO_RESTRICTIONS: Record<string, string[]> = {
  'veo-omni-10s': ['9:16', '16:9'],
}

export const TEMPLATES = [
  { name: 'Cinematic Slow Pan', body: 'Cinematic slow camera pan, natural lighting, subtle wind on hair, subject stays centered' },
  { name: 'Dolly Zoom', body: 'Slow dolly zoom in, subject sharp, background bokeh, moody' },
  { name: 'Gentle Parallax', body: 'Gentle parallax movement, soft bokeh background, subject in focus' },
  { name: 'Dynamic Action', body: 'Dynamic camera movement, fast paced, energetic motion' },
]

export const CREATEPULSE_API = '/api/public/createpulse'
