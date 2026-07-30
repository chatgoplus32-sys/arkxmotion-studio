export interface LeonardoSizeTier {
  id: string
  label: string
  short: number
  long: number
}

export interface LeonardoVideoModel {
  id: string
  slug: string
  label: string
  group: string
  aspectRatios: string[]
  durations: number[]
  durationMode: 'slider' | 'buttons'
  sizeTiers: LeonardoSizeTier[]
  audio: boolean
  supportsI2V: boolean
  supportsT2V: boolean
  crPerSecond: number
  crPerMpSecond: number
  crExamples: Array<{ tier: string; seconds: number; cr: number }>
}

const SIZE_STANDARD: LeonardoSizeTier = { id: 'standard', label: 'Standard 496×864', short: 496, long: 864 }
const SIZE_STANDARD_400: LeonardoSizeTier = { id: 'standard', label: 'Standard 400×736', short: 400, long: 736 }
const SIZE_HD: LeonardoSizeTier = { id: 'hd', label: 'HD 720×1280', short: 720, long: 1280 }
const SIZE_HD_ALT: LeonardoSizeTier = { id: 'hd', label: 'HD 1072×1888', short: 1072, long: 1888 }
const SIZE_QUALITY: LeonardoSizeTier = { id: 'quality', label: 'Quality 720×1280', short: 720, long: 1280 }
const SIZE_HIGH_QUALITY: LeonardoSizeTier = { id: 'highQuality', label: 'High Quality 1080×1920', short: 1080, long: 1920 }
const SIZE_FULL_HD: LeonardoSizeTier = { id: 'fullHd', label: 'Full HD 1080×1920', short: 1080, long: 1920 }
const SIZE_4K: LeonardoSizeTier = { id: '4k', label: '4K 2160×3840', short: 2160, long: 3840 }

export const LEONARDO_VIDEO_MODELS: LeonardoVideoModel[] = [
  {
    id: 'leo-vid:gemini-omni-flash',
    slug: 'gemini-omni-flash',
    label: 'Gemini Omni Flash',
    group: 'Featured',
    aspectRatios: ['16:9', '9:16'],
    durations: [1, 10],
    durationMode: 'slider',
    sizeTiers: [SIZE_HD],
    audio: false,
    supportsI2V: true,
    supportsT2V: true,
    crPerSecond: 100,
    crPerMpSecond: 108.5,
    crExamples: [{ tier: 'hd', seconds: 10, cr: 1000 }],
  },
  {
    id: 'leo-vid:seedance-2.0-mini',
    slug: 'seedance-2.0-mini',
    label: 'Seedance 2.0 Mini',
    group: 'Featured',
    aspectRatios: ['16:9', '1:1', '9:16'],
    durations: [1, 15],
    durationMode: 'slider',
    sizeTiers: [SIZE_STANDARD, SIZE_HD],
    audio: false,
    supportsI2V: true,
    supportsT2V: true,
    crPerSecond: 74.4,
    crPerMpSecond: 173.6,
    crExamples: [{ tier: 'hd', seconds: 15, cr: 2400 }],
  },
  {
    id: 'leo-vid:grok-imagine-1.5',
    slug: 'grok-imagine-1.5',
    label: 'Grok Imagine 1.5',
    group: 'Featured',
    aspectRatios: ['1:1', '16:9', '9:16'],
    durations: [1, 15],
    durationMode: 'slider',
    sizeTiers: [SIZE_STANDARD_400, SIZE_HD, SIZE_HD_ALT],
    audio: true,
    supportsI2V: true,
    supportsT2V: true,
    crPerSecond: 52.7,
    crPerMpSecond: 179,
    crExamples: [{ tier: 'hd', seconds: 15, cr: 2475 }],
  },
  {
    id: 'leo-vid:wan-2.6',
    slug: 'wan-2.6',
    label: 'Wan 2.6',
    group: 'Featured',
    aspectRatios: ['1:1', '3:4', '4:3', '16:9', '9:16'],
    durations: [5, 10, 15],
    durationMode: 'buttons',
    sizeTiers: [SIZE_HD, SIZE_FULL_HD],
    audio: true,
    supportsI2V: true,
    supportsT2V: true,
    crPerSecond: 35,
    crPerMpSecond: 37.98,
    crExamples: [{ tier: 'hd', seconds: 15, cr: 525 }],
  },
  {
    id: 'leo-vid:veo-3.1-lite',
    slug: 'veo-3.1-lite',
    label: 'Veo 3.1 Lite',
    group: 'Featured',
    aspectRatios: ['16:9', '9:16'],
    durations: [4, 6, 8],
    durationMode: 'buttons',
    sizeTiers: [SIZE_QUALITY, SIZE_HIGH_QUALITY],
    audio: true,
    supportsI2V: true,
    supportsT2V: true,
    crPerSecond: 50,
    crPerMpSecond: 54.25,
    crExamples: [{ tier: 'quality', seconds: 8, cr: 400 }],
  },
  {
    id: 'leo-vid:veo-3.1-fast',
    slug: 'veo-3.1-fast',
    label: 'Veo 3.1 Fast',
    group: 'Featured',
    aspectRatios: ['16:9', '9:16'],
    durations: [4, 6, 8],
    durationMode: 'buttons',
    sizeTiers: [SIZE_HD, SIZE_FULL_HD, SIZE_4K],
    audio: true,
    supportsI2V: true,
    supportsT2V: true,
    crPerSecond: 150,
    crPerMpSecond: 162.8,
    crExamples: [{ tier: 'hd', seconds: 8, cr: 1200 }],
  },
  {
    id: 'leo-vid:seedance-2.0',
    slug: 'seedance-2.0',
    label: 'Seedance 2.0',
    group: 'Other',
    aspectRatios: ['16:9', '1:1', '9:16'],
    durations: [1, 15],
    durationMode: 'slider',
    sizeTiers: [SIZE_STANDARD, SIZE_HD, SIZE_FULL_HD, SIZE_4K],
    audio: false,
    supportsI2V: true,
    supportsT2V: true,
    crPerSecond: 140.6,
    crPerMpSecond: 328.125,
    crExamples: [{ tier: 'standard', seconds: 15, cr: 2109 }],
  },
  {
    id: 'leo-vid:seedance-2.0-fast',
    slug: 'seedance-2.0-fast',
    label: 'Seedance 2.0 Fast',
    group: 'Other',
    aspectRatios: ['16:9', '1:1', '9:16'],
    durations: [1, 15],
    durationMode: 'slider',
    sizeTiers: [SIZE_STANDARD, SIZE_HD],
    audio: false,
    supportsI2V: true,
    supportsT2V: true,
    crPerSecond: 112.5,
    crPerMpSecond: 262.5,
    crExamples: [{ tier: 'standard', seconds: 15, cr: 1687 }],
  },
  {
    id: 'leo-vid:kling-o3-omni',
    slug: 'kling-o3-omni',
    label: 'Kling Video O3 Omni',
    group: 'Other',
    aspectRatios: ['1:1', '16:9', '9:16'],
    durations: [1, 15],
    durationMode: 'slider',
    sizeTiers: [SIZE_HD, SIZE_FULL_HD, SIZE_4K],
    audio: true,
    supportsI2V: true,
    supportsT2V: true,
    crPerSecond: 224,
    crPerMpSecond: 243.1,
    crExamples: [{ tier: 'hd', seconds: 15, cr: 3360 }],
  },
  {
    id: 'leo-vid:kling-2.6',
    slug: 'kling-2.6',
    label: 'Kling 2.6',
    group: 'Other',
    aspectRatios: ['1:1', '16:9', '9:16'],
    durations: [5, 10],
    durationMode: 'buttons',
    sizeTiers: [SIZE_FULL_HD],
    audio: true,
    supportsI2V: true,
    supportsT2V: true,
    crPerSecond: 140,
    crPerMpSecond: 67.5,
    crExamples: [{ tier: 'fullHd', seconds: 10, cr: 1400 }],
  },
]

export function getLeonardoVideoModel(key: string): LeonardoVideoModel | null {
  const slug = key.replace(/^leo-vid:/, '')
  return LEONARDO_VIDEO_MODELS.find((m) => m.slug === slug || m.id === key) ?? null
}

export function estimateLeonardoCost(model: LeonardoVideoModel, tierId: string, seconds: number): number {
  const tier = model.sizeTiers.find((t) => t.id === tierId) ?? model.sizeTiers[0]
  const mp = (tier.short * tier.long) / 1_000_000
  return Math.round(model.crPerMpSecond * mp * seconds)
}

export function resolveLeonardoSize(model: LeonardoVideoModel, tierId?: string): LeonardoSizeTier {
  if (tierId) {
    const found = model.sizeTiers.find((t) => t.id === tierId)
    if (found) return found
  }
  return model.sizeTiers[0]
}

function resolveDimensions(aspectRatio: string, tier: LeonardoSizeTier): { width: number; height: number } {
  const { short: s, long: l } = tier
  switch (aspectRatio) {
    case '9:16': return { width: s, height: l }
    case '16:9': return { width: l, height: s }
    case '1:1': return { width: s, height: s }
    case '3:4': return { width: s, height: Math.round(s * 4 / 3) }
    case '4:3': return { width: Math.round(s * 4 / 3), height: s }
    default: return { width: s, height: l }
  }
}

export interface LeonardoQualityOption {
  value: string
  label: string
  tierId: number | string
  width: number
  height: number
  seconds: number
  cr: number
  audio: boolean
}

export function leonardoVideoQualityOptions(
  modelKey: string,
  preferredRatio: string = '9:16'
): LeonardoQualityOption[] {
  const model = getLeonardoVideoModel(modelKey)
  if (!model) return []

  const durations = model.durationMode === 'buttons'
    ? model.durations
    : Array.from(new Set(
        [5, 8, 10, 12, 15]
          .filter((d) => d >= model.durations[0] && d <= model.durations[model.durations.length - 1])
          .concat(model.durations[model.durations.length - 1])
      )).sort((a, b) => a - b)

  const options: LeonardoQualityOption[] = []
  for (const tier of model.sizeTiers) {
    for (const secs of durations) {
      const ar = model.aspectRatios.includes(preferredRatio) ? preferredRatio : model.aspectRatios[0]
      const dims = resolveDimensions(ar, tier)
      options.push({
        value: `${tier.id}-${secs}s`,
        label: `${tier.label} - ${secs}s${model.audio ? ' - Audio' : ''}`,
        tierId: tier.id,
        width: dims.width,
        height: dims.height,
        seconds: secs,
        cr: estimateLeonardoCost(model, tier.id, secs),
        audio: model.audio,
      })
    }
  }
  return options
}

export function resolveSizeTierId(resolution?: string): string | undefined {
  if (!resolution) return undefined
  const r = resolution.toLowerCase()
  if (r === '480p' || r === 'standard') return 'standard'
  if (r === '720p' || r === 'hd') return 'hd'
  if (r === '1080p' || r === 'fullhd' || r === 'full hd') return 'fullHd'
  if (r === '4k' || r === '2160p') return '4k'
  return undefined
}
