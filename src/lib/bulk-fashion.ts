import { useProviderManager } from '@/stores/providerManager'
import { submitFramiaRun, pollFramiaRun } from '@/lib/framia'
import { leonardoApi, withLeonardoTokens } from '@/lib/leonardo'

// ─── Prompt Template ───────────────────────────────────────────────────────
const BASE_PROMPT = `PENTING (multi-referensi): Gambar #1 adalah KARAKTER — pertahankan identitas persis (wajah, kulit, rambut/hijab, bentuk tubuh, ekspresi). Gambar #2 adalah OUTFIT/PAKAIAN yang harus dikenakan oleh karakter dari gambar #1, mengganti pakaian aslinya. Salin bentuk, warna, motif, tekstur, kerah, dan detail outfit dari gambar #2 seakurat mungkin. Jangan mencampur outfit gambar #1 dengan gambar #2 — outfit lama dari karakter DIHAPUS. Hasil akhir: satu foto karakter dari gambar #1 memakai outfit dari gambar #2.

Instruksi visual tambahan: `

function buildPrompt(template: string, productType: string, outfitIndex: number): string {
  return BASE_PROMPT + template.replaceAll('{product_type}', productType).replaceAll('{outfit_index}', String(outfitIndex + 1))
}

// ─── Provider Configs ──────────────────────────────────────────────────────
export interface QualityTier {
  v: string
  label: string
  cr: number
  default?: boolean
}

export interface ModelConfig {
  key: string
  label: string
  qualities: QualityTier[]
}

export interface ProviderBulkConfig {
  id: string
  name: string
  models: ModelConfig[]
}

export const BULK_FASHION_PROVIDERS: ProviderBulkConfig[] = [
  {
    id: 'framia',
    name: 'Framia',
    models: [
      {
        key: 'framia:nano-banana-lite-edit',
        label: 'Nano Banana Lite Edit (Framia)',
        qualities: [
          { v: '1K', label: '1K (~1 cr)', cr: 1, default: true },
          { v: '2K', label: '2K (~2 cr)', cr: 2 },
        ],
      },
      {
        key: 'framia:nano-banana-edit',
        label: 'Nano Banana Edit (Framia)',
        qualities: [
          { v: '1K', label: '1K (~2 cr)', cr: 2, default: true },
          { v: '2K', label: '2K (~3 cr)', cr: 3 },
        ],
      },
      {
        key: 'framia:nano-banana-2-edit',
        label: 'Nano Banana 2 Edit (Framia)',
        qualities: [
          { v: '1K', label: '1K (~3 cr)', cr: 3, default: true },
          { v: '2K', label: '2K (~4 cr)', cr: 4 },
        ],
      },
      {
        key: 'framia:nano-banana-pro-edit',
        label: 'Nano Banana Pro Edit (Framia)',
        qualities: [
          { v: 'default', label: 'Standard (~5 cr)', cr: 5, default: true },
        ],
      },
      {
        key: 'framia:gpt-image-2-edit',
        label: 'GPT Image 2 Edit (Framia)',
        qualities: [
          { v: '2K', label: '2K (~5 cr)', cr: 5, default: true },
          { v: '4K', label: '4K (~8 cr)', cr: 8 },
        ],
      },
      {
        key: 'framia:seedream-4-edit',
        label: 'Seedream 4.0 Edit (Framia)',
        qualities: [
          { v: '1K', label: '1K (~3 cr)', cr: 3, default: true },
          { v: '2K', label: '2K (~4 cr)', cr: 4 },
        ],
      },
      {
        key: 'framia:seedream-4-5-edit',
        label: 'Seedream 4.5 Edit (Framia)',
        qualities: [
          { v: '1K', label: '1K (~3 cr)', cr: 3, default: true },
          { v: '2K', label: '2K (~4 cr)', cr: 4 },
        ],
      },
      {
        key: 'framia:seedream-5-edit',
        label: 'Seedream 5 Edit (Framia)',
        qualities: [
          { v: '1K', label: '1K (~4 cr)', cr: 4, default: true },
          { v: '2K', label: '2K (~5 cr)', cr: 5 },
        ],
      },
      {
        key: 'framia:seedream-5-pro-edit',
        label: 'Seedream 5 Pro Edit (Framia)',
        qualities: [
          { v: '1K', label: '1K (~4 cr)', cr: 4, default: true },
          { v: '2K', label: '2K (~5 cr)', cr: 5 },
        ],
      },
    ],
  },
  {
    id: 'leonardo',
    name: 'Leonardo',
    models: [
      {
        key: 'leonardo:nano-banana-2',
        label: 'Nano Banana 2 (Leonardo)',
        qualities: [
          { v: '1K', label: '1K (~3 cr)', cr: 3, default: true },
          { v: '2K', label: '2K (~4 cr)', cr: 4 },
        ],
      },
      {
        key: 'leonardo:seedream-4',
        label: 'Seedream 4.0 (Leonardo)',
        qualities: [
          { v: '1K', label: '1K (~3 cr)', cr: 3, default: true },
          { v: '2K', label: '2K (~4 cr)', cr: 4 },
        ],
      },
      {
        key: 'leonardo:seedream-5',
        label: 'Seedream 5.0 (Leonardo)',
        qualities: [
          { v: '1K', label: '1K (~4 cr)', cr: 4, default: true },
          { v: '2K', label: '2K (~5 cr)', cr: 5 },
        ],
      },
    ],
  },
]

// ─── File Helpers ──────────────────────────────────────────────────────────
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ─── Provider-Specific Generators ──────────────────────────────────────────
async function generateFramiaBulk(opts: BulkFashionOptions): Promise<string[]> {
  const results: string[] = []
  const store = useProviderManager.getState()
  const key = store.getFirstValidKey('framia')
  if (!key) throw Error('Belum ada Framia API key')

  for (let idx = 0; idx < opts.outfitFiles.length; idx++) {
    if (opts.signal?.aborted) break
    try {
      opts.onProgress?.(idx, `Generate outfit #${idx + 1} (Framia)...`)
      const prompt = buildPrompt(opts.promptTemplate, opts.productType, idx)
      const outfitDataUrl = await fileToDataUrl(opts.outfitFiles[idx])
      const charDataUrl = await fileToDataUrl(opts.charFile)

      const skillId = opts.modelKey.replace('framia:', '') || 'nano-banana-2-edit'
      const body: any = {
        skill_id: skillId,
        prompt,
        image_url: charDataUrl,
        reference_image_url: outfitDataUrl,
      }

      const { runId } = await submitFramiaRun(key.key, body)
      const imageUrl = await pollFramiaRun(key.key, runId)

      if (!opts.signal?.aborted) {
        results.push(imageUrl)
        opts.onProgress?.(idx, 'done', imageUrl)
      }
    } catch (err: any) {
      if (!opts.signal?.aborted) {
        opts.onProgress?.(idx, 'error', undefined, err.message || String(err))
      }
    }
  }

  return results
}

async function generateLeonardoBulk(opts: BulkFashionOptions): Promise<string[]> {
  const results: string[] = []

  for (let idx = 0; idx < opts.outfitFiles.length; idx++) {
    if (opts.signal?.aborted) break
    try {
      opts.onProgress?.(idx, `Generate outfit #${idx + 1} (Leonardo)...`)
      const prompt = buildPrompt(opts.promptTemplate, opts.productType, idx)

      const imageUrl = await withLeonardoTokens(async (token) => {
        const modelKey = opts.modelKey.replace('leonardo:', '')

        const charDataUrl = await fileToDataUrl(opts.charFile)
        const outfitDataUrl = await fileToDataUrl(opts.outfitFiles[idx])

        const generation = await leonardoApi<{
          sdGenerationJob?: { generationId?: string }
          imageGenerationJob?: { generationId?: string }
        }>({
          token,
          path: '/v1/image/generations',
          method: 'POST',
          body: {
            prompt,
            modelId: modelKey === 'nano-banana-2' ? 'bfb0589e-9a2f-4249-9e33-4d29bbc8f8ab' : undefined,
            guidance_scale: 7,
            num_images: 1,
            width: 1024,
            height: 1024,
            image_url: charDataUrl,
            reference_image_url: outfitDataUrl,
          },
        })

        const genId = generation?.sdGenerationJob?.generationId || generation?.imageGenerationJob?.generationId
        if (!genId) throw Error('No generation ID')

        for (let poll = 0; poll < 120; poll++) {
          await new Promise((r) => setTimeout(r, 3000))
          const status = await leonardoApi<{ generations?: Array<{ generated_images?: Array<{ url: string }> }> }>({
            token,
            path: `/v1/image/generations/${genId}`,
          })
          const images = status?.generations?.[0]?.generated_images
          if (images?.[0]?.url) return images[0].url
        }

        throw Error('Leonardo timeout')
      }, {
        onRotate: (idx, total, reason) => opts.onProgress?.(idx, `Token Leonardo habis (${reason}) → token #${idx + 1}/${total}`),
      })

      if (!opts.signal?.aborted) {
        results.push(imageUrl)
        opts.onProgress?.(idx, 'done', imageUrl)
      }
    } catch (err: any) {
      if (!opts.signal?.aborted) {
        opts.onProgress?.(idx, 'error', undefined, err.message || String(err))
      }
    }
  }

  return results
}

// ─── Main Generator ────────────────────────────────────────────────────────
export interface BulkFashionOptions {
  provider: string
  modelKey: string
  quality: string
  ratio: string
  charFile: File
  outfitFiles: File[]
  promptTemplate: string
  productType: string
  signal?: AbortSignal
  onProgress?: (index: number, status: string, resultUrl?: string, error?: string) => void
}

export async function generateBulkFashion(opts: BulkFashionOptions): Promise<string[]> {
  try {
    if (opts.provider === 'framia') return await generateFramiaBulk(opts)
    if (opts.provider === 'leonardo') return await generateLeonardoBulk(opts)
    throw Error(`Provider "${opts.provider}" belum support bulk fashion`)
  } finally {
    // Key refresh handled by token rotation
  }
}

// ─── Cost Calculator ───────────────────────────────────────────────────────
export function calculateBulkCost(
  providerId: string,
  modelKey: string,
  quality: string,
  outfitCount: number
): { crPerImage: number; totalCr: number } {
  const provider = BULK_FASHION_PROVIDERS.find((p) => p.id === providerId)
  if (!provider) return { crPerImage: 0, totalCr: 0 }

  const model = provider.models.find((m) => m.key === modelKey)
  if (!model) return { crPerImage: 0, totalCr: 0 }

  const tier = model.qualities.find((q) => q.v === quality) || model.qualities.find((q) => q.default) || model.qualities[0]
  const cr = tier?.cr ?? 0
  return { crPerImage: cr, totalCr: cr * outfitCount }
}
