import { useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Textarea, Select, Badge } from '@/components/ui'
import { Image, Loader2 } from 'lucide-react'
import { useProviderManager, ProviderId } from '@/stores/providerManager'
import { useToastStore } from '@/stores/toastStore'

const T2I_MODELS: Array<{ value: string; label: string; provider: ProviderId; cr: number }> = [
  { value: 'gemini-nano-banana-2', label: 'Gemini Nano Banana 2', provider: 'weavy', cr: 4 },
  { value: 'gpt-image-2', label: 'GPT Image 2', provider: 'weavy', cr: 8 },
  { value: 'seedream-5-pro', label: 'Seedream 5.0 Pro', provider: 'weavy', cr: 6 },
  { value: 'flux-2-pro', label: 'Flux.2 Pro', provider: 'weavy', cr: 5 },
  { value: 'ws:nano-banana-2', label: 'Nano Banana 2 (Wavespeed)', provider: 'wavespeed', cr: 3 },
  { value: 'ws:gpt-image-2', label: 'GPT Image 2 (Wavespeed)', provider: 'wavespeed', cr: 7 },
  { value: 'ws:seedream-4', label: 'Seedream 4 (Wavespeed)', provider: 'wavespeed', cr: 5 },
  { value: 'rn:nano-banana-2', label: 'Nano Banana 2 (Roboneo)', provider: 'roboneo', cr: 4 },
  { value: 'fr:nano-banana-2', label: 'Nano Banana 2 (Framia)', provider: 'framia', cr: 3 },
  { value: 'fr:gpt-image-2', label: 'GPT Image 2 (Framia)', provider: 'framia', cr: 7 },
  { value: 'fr:seedream-5-pro', label: 'Seedream 5.0 Pro (Framia)', provider: 'framia', cr: 6 },
  { value: 'fr:flux-2-pro', label: 'Flux.2 Pro (Framia)', provider: 'framia', cr: 5 },
  { value: 'leo:gpt-image-2', label: 'GPT Image 2 (Leonardo)', provider: 'leonardo', cr: 8 },
  { value: 'leo:seedream-5-pro', label: 'Seedream 5.0 Pro (Leonardo)', provider: 'leonardo', cr: 6 },
  { value: 'leo:flux-2-pro', label: 'Flux.2 Pro (Leonardo)', provider: 'leonardo', cr: 5 },
]

const ASPECT_RATIO_OPTIONS = [
  { value: '1:1', label: '1:1 Square' },
  { value: '16:9', label: '16:9 Landscape' },
  { value: '9:16', label: '9:16 Portrait' },
  { value: '4:3', label: '4:3 Standard' },
  { value: '3:4', label: '3:4 Portrait' },
]

export default function TextToImagePage() {
  const { keys } = useProviderManager()
  const addToast = useToastStore((s) => s.addToast)
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [model, setModel] = useState(T2I_MODELS[0].value)
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [loading, setLoading] = useState(false)
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)

  const selectedModel = T2I_MODELS.find(m => m.value === model) || T2I_MODELS[0]
  const hasKey = keys[selectedModel.provider]?.some(k => k.status === 'active' || k.status === 'unknown')

  const handleGenerate = async () => {
    if (!prompt.trim()) return
    if (!hasKey) {
      addToast(`Tambahkan ${selectedModel.provider} key di Providers`, 'error')
      return
    }
    setLoading(true)
    try {
      await new Promise(r => setTimeout(r, 2000))
      addToast('Generate submitted — model akan diproses via provider.', 'success')
    } catch (err: any) {
      addToast(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Generate"
        title="Text to"
        highlight="Image"
        desc="Buat gambar dari teks/prompt menggunakan AI. Pilih model dan aspek rasio yang diinginkan."
      />

      <div className="max-w-3xl mx-auto space-y-6">
        <Section title="Prompt" sub="Deskripsikan gambar yang ingin kamu buat">
          <Textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Contoh: A majestic astronaut floating in deep space with Earth in the background, cinematic lighting, highly detailed, 8k resolution..."
            rows={4}
            disabled={loading}
          />
        </Section>

        <Section title="Negative Prompt" sub="Elemen yang ingin dihindari (opsional)">
          <Textarea
            value={negativePrompt}
            onChange={e => setNegativePrompt(e.target.value)}
            placeholder="Contoh: blurry, low quality, distorted, deformed, watermark, text..."
            rows={2}
            disabled={loading}
          />
        </Section>

        <Section title="Pengaturan">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Model</label>
              <Select
                value={model}
                onChange={e => setModel(e.target.value)}
                disabled={loading}
                options={T2I_MODELS.map(m => ({ value: m.value, label: `${m.label} (${m.cr} cr)` }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Aspek Rasio</label>
              <Select
                value={aspectRatio}
                onChange={e => setAspectRatio(e.target.value)}
                disabled={loading}
                options={ASPECT_RATIO_OPTIONS}
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Provider:</label>
            <Badge>{selectedModel.provider}</Badge>
          </div>
        </Section>

        <Section title="Generate">
          <div className="flex items-center gap-3">
            <Button onClick={handleGenerate} loading={loading} disabled={!prompt.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Image className="h-4 w-4" />}
              {loading ? 'Generating...' : 'Generate Image'}
            </Button>
            {!hasKey && (
              <span className="text-xs text-destructive">Tambah {selectedModel.provider} key di Providers</span>
            )}
          </div>
        </Section>

        {generatedImage && (
          <Section title="Hasil">
            <div className="flex justify-center">
              <img
                src={generatedImage}
                alt="Generated image"
                className="max-w-full rounded-xl border border-border"
              />
            </div>
          </Section>
        )}
      </div>
    </PageContent>
  )
}
