/**
 * Katalog geometri watermark video Gemini/Veo.
 *
 * Port dari @pilio/gemini-watermark-remover (MIT):
 *   src/video/videoWatermarkCatalog.js
 *
 * Ukuran referensi adalah 1920x1080 dengan logo 72 px pada margin 108 px
 * (varian standar) dan 144 px (varian inset / "relocated"). Untuk resolusi
 * lain kandidat diproyeksikan memakai skala min(w/1920, h/1080), lalu
 * ditambah varian eksplisit untuk 720p, portrait 1080x1920, dan 720x1280.
 */

const REFERENCE_WIDTH = 1920
const REFERENCE_HEIGHT = 1080

export interface VideoWatermarkCandidate {
  id: string
  label: string
  size: number
  width: number
  height: number
  marginRight: number
  marginBottom: number
  x: number
  y: number
  videoWidth: number
  videoHeight: number
  sourcePriority: number
  sourceFamily: string
  evidenceGate: 'standard' | 'required'
  exactSizeVariant?: boolean
  referenceSize?: boolean
  scaledFromReference?: boolean
  sourceCandidateId?: string | null
  sourceResolution?: string
  sourceScale?: number
}

interface ReferenceCandidate {
  id: string
  label: string
  size: number
  marginRight: number
  marginBottom: number
  sourcePriority?: number
  sourceFamily?: string
}

interface CandidateExtras {
  sourcePriority?: number
  sourceFamily?: string
  evidenceGate?: 'standard' | 'required'
  exactSizeVariant?: boolean
  referenceSize?: boolean
  scaledFromReference?: boolean
  sourceCandidateId?: string | null
  sourceResolution?: string
  sourceScale?: number
}

const REFERENCE_CANDIDATES: ReferenceCandidate[] = [
  {
    id: 'veo-1080p-standard',
    label: '1080p standard, 72px, margin 108',
    size: 72,
    marginRight: 108,
    marginBottom: 108,
  },
  {
    id: 'veo-1080p-inset',
    label: '1080p inset, 72px, margin 144',
    size: 72,
    marginRight: 144,
    marginBottom: 144,
  },
]

const EXACT_PROJECTED_CANDIDATE_OVERRIDES_BY_SIZE: Record<
  string,
  Record<string, Partial<CandidateExtras> & { id?: string; label?: string }>
> = {
  '1280x720': {
    'veo-1080p-inset': {
      id: 'veo-720p-3-inset',
      label: '720p-3 inset, 48px, margin 96',
      sourcePriority: 0,
      exactSizeVariant: true,
    },
    'veo-1080p-standard': {
      id: 'veo-720p-1-standard',
      label: '720p-1 standard, 48px, margin 72',
      sourcePriority: 1,
      exactSizeVariant: true,
    },
  },
}

const clampInteger = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(value)))

export function isReferenceGeminiVideoSize(width: number, height: number): boolean {
  return width === REFERENCE_WIDTH && height === REFERENCE_HEIGHT
}

export function getReferenceVideoWatermarkCatalog() {
  return {
    referenceSize: { width: REFERENCE_WIDTH, height: REFERENCE_HEIGHT },
    candidates: REFERENCE_CANDIDATES.map((candidate) => ({ ...candidate })),
  }
}

function buildCandidate(
  candidate: ReferenceCandidate,
  width: number,
  height: number,
  scale = 1,
  extras: CandidateExtras = {},
): Omit<VideoWatermarkCandidate, 'videoWidth' | 'videoHeight'> {
  const size = clampInteger(candidate.size * scale, 24, Math.min(width, height))
  const marginRight = clampInteger(candidate.marginRight * scale, 0, width - size)
  const marginBottom = clampInteger(candidate.marginBottom * scale, 0, height - size)
  return {
    ...candidate,
    size,
    width: size,
    height: size,
    marginRight,
    marginBottom,
    x: width - marginRight - size,
    y: height - marginBottom - size,
    sourcePriority: candidate.sourcePriority ?? extras.sourcePriority ?? 100,
    sourceFamily: extras.sourceFamily ?? 'reference-projected',
    evidenceGate: extras.evidenceGate ?? 'standard',
    ...extras,
  }
}

function isCandidateInBounds(
  candidate: VideoWatermarkCandidate,
): boolean {
  return (
    candidate.x >= 0 &&
    candidate.y >= 0 &&
    candidate.x + candidate.size <= candidate.videoWidth &&
    candidate.y + candidate.size <= candidate.videoHeight
  )
}

function withVideoBounds(
  candidate: Omit<VideoWatermarkCandidate, 'videoWidth' | 'videoHeight'>,
  width: number,
  height: number,
): VideoWatermarkCandidate {
  return { ...candidate, videoWidth: width, videoHeight: height }
}

function videoSizeKey(width: number, height: number): string {
  return `${width}x${height}`
}

function getProjectedReferenceCandidates(width: number, height: number): VideoWatermarkCandidate[] {
  const scale = Math.min(width / REFERENCE_WIDTH, height / REFERENCE_HEIGHT)
  const referenceSize = isReferenceGeminiVideoSize(width, height)
  const overrides = EXACT_PROJECTED_CANDIDATE_OVERRIDES_BY_SIZE[videoSizeKey(width, height)] || {}

  return REFERENCE_CANDIDATES.map((candidate, index) => {
    const override = overrides[candidate.id] || {}
    return withVideoBounds(
      buildCandidate(candidate, width, height, scale, {
        referenceSize,
        scaledFromReference: !referenceSize,
        sourceCandidateId: candidate.id,
        sourceResolution: `${REFERENCE_WIDTH}x${REFERENCE_HEIGHT}`,
        sourceScale: scale,
        sourceFamily: referenceSize ? 'reference-exact' : 'reference-projected',
        evidenceGate: 'standard',
        sourcePriority: override.sourcePriority ?? index,
        ...override,
      }),
      width,
      height,
    )
  }).filter(isCandidateInBounds)
}

function buildCandidateGeometryKey(candidate: VideoWatermarkCandidate): string {
  return `${candidate.size}:${candidate.marginRight}:${candidate.marginBottom}`
}

function getCandidatePriority(candidate: VideoWatermarkCandidate): number {
  return Number.isFinite(candidate?.sourcePriority) ? candidate.sourcePriority : 100
}

function dedupeVideoCandidates(candidates: VideoWatermarkCandidate[]): VideoWatermarkCandidate[] {
  const bestByGeometry = new Map<string, VideoWatermarkCandidate>()
  for (const candidate of candidates.filter(isCandidateInBounds)) {
    const key = buildCandidateGeometryKey(candidate)
    const existing = bestByGeometry.get(key)
    if (!existing || getCandidatePriority(candidate) < getCandidatePriority(existing)) {
      bestByGeometry.set(key, candidate)
    }
  }
  return [...bestByGeometry.values()].sort(
    (left, right) => getCandidatePriority(left) - getCandidatePriority(right),
  )
}

function getExplicitCandidates(width: number, height: number): VideoWatermarkCandidate[] {
  if (width === 1080 && height === 1920) {
    return [
      {
        id: 'veo-1080x1920-portrait-72',
        label: '1080x1920 portrait, 72px, margin 108',
        size: 72,
        marginRight: 108,
        marginBottom: 108,
        sourcePriority: 0,
      },
      {
        id: 'veo-1080x1920-portrait-relocated-72',
        label: '1080x1920 portrait relocated, 72px, margin 144',
        size: 72,
        marginRight: 144,
        marginBottom: 144,
        sourcePriority: 1,
      },
    ]
      .map((candidate) =>
        withVideoBounds(
          buildCandidate(candidate, width, height, 1, {
            referenceSize: false,
            scaledFromReference: false,
            sourceCandidateId: null,
            sourceFamily: 'binary-prior',
            evidenceGate: 'required',
            exactSizeVariant: true,
          }),
          width,
          height,
        ),
      )
      .filter(isCandidateInBounds)
  }

  if (width === 1280 && height === 720) {
    return [
      {
        id: 'veo-720p-2-compact',
        label: '720p-2 compact, 44px, margin 29/40',
        size: 44,
        marginRight: 29,
        marginBottom: 40,
        sourcePriority: 2,
      },
    ]
      .map((candidate) =>
        withVideoBounds(
          buildCandidate(candidate, width, height, 1, {
            referenceSize: false,
            scaledFromReference: false,
            sourceCandidateId: null,
            sourceFamily: 'exact-size-exception',
            evidenceGate: 'required',
            exactSizeVariant: true,
          }),
          width,
          height,
        ),
      )
      .filter(isCandidateInBounds)
  }

  if (width === 720 && height === 1280) {
    return [
      {
        id: 'veo-720x1280-portrait-48',
        label: '720x1280 portrait, 48px, margin 72',
        size: 48,
        marginRight: 72,
        marginBottom: 72,
        sourcePriority: 1,
        sourceFamily: 'binary-prior',
      },
      {
        id: 'veo-720x1280-portrait-relocated-48',
        label: '720x1280 portrait relocated, 48px, margin 96',
        size: 48,
        marginRight: 96,
        marginBottom: 96,
        sourcePriority: 0,
        sourceFamily: 'binary-prior',
      },
      {
        id: 'veo-720x1280-animated-compact-24',
        label: '720x1280 animated compact, 24px, margin 48',
        size: 24,
        marginRight: 48,
        marginBottom: 48,
        sourcePriority: 0,
        sourceFamily: 'exact-size-exception',
      },
      {
        id: 'veo-720x1280-vertical-inset',
        label: '720x1280 vertical inset, 35px, margin 102/96',
        size: 35,
        marginRight: 102,
        marginBottom: 96,
        sourcePriority: 1,
        sourceFamily: 'exact-size-exception',
      },
      {
        id: 'veo-720x1280-compact-44',
        label: '720x1280 compact, 44px, margin 29/40',
        size: 44,
        marginRight: 29,
        marginBottom: 40,
        sourcePriority: 3,
        sourceFamily: 'binary-prior',
      },
    ]
      .map((candidate) =>
        withVideoBounds(
          buildCandidate(candidate, width, height, 1, {
            referenceSize: false,
            scaledFromReference: false,
            sourceCandidateId: null,
            sourceFamily: candidate.sourceFamily,
            evidenceGate: 'required',
            exactSizeVariant: true,
          }),
          width,
          height,
        ),
      )
      .filter(isCandidateInBounds)
  }

  return []
}

/**
 * Semua kandidat geometri untuk video berukuran `width` x `height`, sudah
 * dideduplikasi berdasarkan geometri dan diurutkan menurut prioritas.
 */
export function resolveVideoWatermarkCandidates(
  width: number,
  height: number,
): VideoWatermarkCandidate[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return []
  }
  return dedupeVideoCandidates([
    ...getProjectedReferenceCandidates(width, height),
    ...getExplicitCandidates(width, height),
  ])
}
