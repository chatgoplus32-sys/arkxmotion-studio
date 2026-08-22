import { leonardoApi, leonardoUploadImage } from '@/lib/leonardo'

const GENERATE_MUTATION = `mutation Generate($request: CreateGenerationRequest!) {
  generate(request: $request) { apiCreditCost generationId __typename }
}`

const UPSCALE_VARIATION_QUERY = `query GetLatestPendingUpscaleVariationForGeneration($generationId: uuid!) {
  generations_by_pk(id: $generationId) {
    generated_images(order_by: [{createdAt: desc}]) {
      generated_image_variation_generics(
        where: {transformType: {_eq: UPSCALE}}
        order_by: [{createdAt: desc}]
        limit: 5
      ) {
        id createdAt status url transformType
        upscale_details {
          id variationId upscaleMultiplier width height mode modelId optional_metadata
          generated_image_variation_generic { id status url __typename }
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}`


function getUpscalerModel(upscaler: string, proType: string): string {
  if (upscaler === 'legacy') return 'legacy-upscaler'
  if (upscaler === 'ultra') return 'universal-upscaler'
  return proType === 'creative' ? 'aurora-upscaler-creative' : 'aurora-upscaler-precise'
}

function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth || 1024, height: img.naturalHeight || 1024 })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      resolve({ width: 1024, height: 1024 })
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}

function extractGenerationId(data: any): string | null {
  if (!data || typeof data !== 'object') return null
  const candidates = [
    data.generate?.generationId, data.generate?.generation_id,
    data.sdGenerationJob?.generationId, data.sdGenerationJob?.generation_id,
    data.generationId, data.generation_id, data.id, data.jobId,
    data.data?.generationId, data.data?.generation_id, data.data?.id,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c
  }
  return null
}

function extractVariationUrl(v: any): string | null {
  if (!v) return null
  const ud = Array.isArray(v.upscale_details) ? v.upscale_details[0] : v.upscale_details
  if (ud?.generated_image_variation_generic?.url) return ud.generated_image_variation_generic.url
  return v.url || null
}

function getVariationStatus(v: any): string {
  const ud = Array.isArray(v.upscale_details) ? v.upscale_details[0] : v.upscale_details
  return String(ud?.generated_image_variation_generic?.status || v.status || '').toUpperCase()
}

const MP_LIMIT = 105
const ALLOWED_FACTORS = [2, 3, 4, 5, 6, 8]

function calcMP(w: number, h: number, factor: number): number {
  return w * factor * h * factor / 1e6
}

function pickMaxFactor(w: number, h: number, requested: number): number {
  const idx = ALLOWED_FACTORS.indexOf(requested)
  if (idx === -1) return 2
  return ALLOWED_FACTORS.slice(0, idx + 1).reverse().find(f => calcMP(w, h, f) <= MP_LIMIT) ?? 2
}

export interface LeonardoUpscaleSettings {
  upscaler: 'legacy' | 'ultra' | 'pro'
  pro_type: 'precise' | 'creative'
  upscale_factor: number
  fix_artifacts: boolean
}

export async function runLeonardoUpscale(
  token: string,
  file: File,
  settings: LeonardoUpscaleSettings,
  onLog?: (msg: string) => void
): Promise<string> {
  const ext = (file.type || '').toLowerCase().includes('webp') ? 'webp'
    : (file.type || '').toLowerCase().includes('png') ? 'png' : 'jpg'

  let uploadFile: File = file
  if (file.size > 8 * 1024 * 1024) {
    onLog?.('Compressing image...')
    uploadFile = await new Promise<File>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const maxDim = 2048
          let w = img.width, h = img.height
          if (w > maxDim) { h = h * maxDim / w; w = maxDim }
          canvas.width = w; canvas.height = h
          canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
          canvas.toBlob(
            (blob) => resolve(blob ? new File([blob], file.name, { type: 'image/jpeg' }) : file),
            'image/jpeg', 0.92
          )
        }
        img.onerror = () => resolve(file)
        img.src = String(reader.result || '')
      }
      reader.readAsDataURL(file)
    })
  }

  const { width, height } = await getImageDimensions(uploadFile)
  const actualFactor = pickMaxFactor(width, height, settings.upscale_factor)

  if (actualFactor !== settings.upscale_factor) {
    const reqMP = calcMP(width, height, settings.upscale_factor).toFixed(1)
    const actMP = calcMP(width, height, actualFactor).toFixed(1)
    onLog?.(`Multiplier ${settings.upscale_factor}x melebihi limit Aurora ±${MP_LIMIT}MP (${reqMP}MP), pakai ${actualFactor}x (${actMP}MP)...`)
  }

  onLog?.('Upload ke Leonardo...')
  const imagePromptId = await leonardoUploadImage(token, uploadFile, ext)

  const model = getUpscalerModel(settings.upscaler, settings.pro_type)
  const mode = settings.fix_artifacts ? 'clean' : 'detailed'

  const parameters: any = {
    model,
    public: false,
    parameters: {
      guidances: {
        image_reference: [{ image: { id: imagePromptId, type: 'UPLOADED' } }],
      },
      upscale_factor: actualFactor,
      width,
      height,
    },
  }

  if (settings.upscaler === 'pro' && settings.pro_type === 'creative') {
    parameters.parameters.creativity = settings.fix_artifacts ? 'low' : 'mid'
  } else {
    parameters.parameters.upscale_mode = mode
  }

  onLog?.(`Generate ${model} (${actualFactor}x · ${mode}${settings.upscaler === 'pro' ? ` · ${settings.pro_type}` : ''})...`)

  let generationId: string | null = null
  try {
    const restData = await leonardoApi({
      token,
      base: 'cloud',
      path: '/api/rest/v2/generations',
      method: 'POST',
      body: parameters,
    })
    generationId = extractGenerationId(restData)
  } catch (err: any) {
    const restErr = err instanceof Error ? err.message : String(err)
    try {
      const gqlData = await leonardoApi({
        token,
        base: 'api',
        path: '/v1/graphql',
        method: 'POST',
        body: {
          operationName: 'Generate',
          variables: { request: parameters },
          query: GENERATE_MUTATION,
        },
      })
      generationId = gqlData?.data?.generate?.generationId
      if (!generationId) {
        const gqlErr = JSON.stringify(gqlData?.errors || {}).slice(0, 400)
        throw Error(`Leonardo: generationId tidak ditemukan — REST: ${restErr}; GraphQL: ${gqlErr}`)
      }
    } catch {
      throw Error(`Leonardo upscale gagal: ${restErr}`)
    }
  }

  if (!generationId) throw Error('Leonardo: generationId kosong')

  onLog?.('Menunggu hasil...')

  let lastStatus = ''
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, i < 12 ? 4000 : 6000))

    let variations: any[] = []
    try {
      const gqlResult = await leonardoApi({
        token,
        base: 'api',
        path: '/v1/graphql',
        method: 'POST',
        body: {
          operationName: 'GetLatestPendingUpscaleVariationForGeneration',
          variables: { generationId },
          query: UPSCALE_VARIATION_QUERY,
        },
      })
      variations = (gqlResult?.data?.generations_by_pk?.generated_images ?? [])
        .flatMap((img: any) => img.generated_image_variation_generics ?? [])
        .filter((v: any) => !!v?.id)
    } catch { variations = [] }

    for (const v of variations) {
      const st = getVariationStatus(v)
      const url = extractVariationUrl(v)
      if (url && ['COMPLETE', 'COMPLETED', 'SUCCESS', 'SUCCEEDED', 'DONE'].includes(st)) return url
      if (['FAILED', 'ERROR', 'CANCELED', 'CANCELLED'].includes(st)) {
        throw Error(`Leonardo Aurora: ${st}`)
      }
      if (st && st !== lastStatus) {
        lastStatus = st
        onLog?.(`Poll Aurora: ${st.toLowerCase()}`)
      }
    }

    try {
      const genResult = await leonardoApi({
        token,
        base: 'api',
        path: `/api/rest/v1/generations/${encodeURIComponent(generationId)}`,
        method: 'GET',
      })
      const gen = genResult?.generations_by_pk ?? null
      const genStatus = String(gen?.status || '').toUpperCase()
      const genUrl = (gen?.generated_images ?? [])
        .flatMap((img: any) => img.generated_image_variation_generics ?? [])
        .map(extractVariationUrl)
        .find((u: any) => !!u) ?? null

      if (genUrl && ['COMPLETE', 'COMPLETED', 'SUCCESS', 'SUCCEEDED', 'DONE'].includes(genStatus)) return genUrl
      if (['FAILED', 'ERROR', 'CANCELED', 'CANCELLED'].includes(genStatus)) {
        throw Error(`Leonardo Aurora: ${genStatus}`)
      }
      if (genStatus && genStatus !== lastStatus) {
        lastStatus = genStatus
        onLog?.(`Poll Aurora: ${genStatus.toLowerCase()}`)
      }
    } catch (err: any) {
      if (err instanceof Error && /Leonardo Aurora/.test(err.message)) throw err
    }
  }

  throw Error('Leonardo Aurora: timeout menunggu hasil')
}
