import { useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Textarea, Select, Badge } from '@/components/ui'
import { PlayCircle, Loader2, Download } from 'lucide-react'
import { useProviderManager, ProviderId } from '@/stores/providerManager'
import { useToastStore } from '@/stores/toastStore'

const T2V_MODELS: Array<{ value: string; label: string; provider: ProviderId; cr: number }> = [
  { value: 'kling-3-pro', label: 'Kling V3 Pro', provider: 'weavy', cr: 80 },
  { value: 'veo-3.1', label: 'Veo 3.1', provider: 'weavy', cr: 90 },
  { value: 'sora-2', label: 'Sora 2', provider: 'weavy', cr: 60 },
  { value: 'wan-t2v', label: 'Wan 2.2 T2V', provider: 'weavy', cr: 30 },
  { value: 'seedance-2', label: 'Seedance 2.0', provider: 'weavy', cr: 50 },
  { value: 'kling-2.1', label: 'Kling V2.1', provider: 'wavespeed', cr: 36 },
  { value: 'rn:kling-v3', label: 'Kling 3.0 (Roboneo)', provider: 'roboneo', cr: 130 },
]

const DURATION_OPTIONS = [
  { value: '5s', label: '5 detik' },
  { value: '10s', label: '10 detik' },
  { value: '15s', label: '15 detik' },
]

export default function TextToVideoPage() {
  const { keys } = useProviderManager()
  const addToast = useToastStore((s) => s.addToast)
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState(T2V_MODELS[0].value)
  const [duration, setDuration] = useState('5s')
  const [loading, setLoading] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)

  const selectedModel = T2V_MODELS.find(m => m.value === model) || T2V_MODELS[0]
  const hasKey = keys[selectedModel.provider]?.some(k => k.status === 'active' || k.status === 'unknown')

  const handleGenerate = async () => {
    if (!prompt.trim()) return
    if (!hasKey) {
      addToast(`Tambahkan ${selectedModel.provider} key di Providers`, 'error')
      return
    }
    setLoading(true)
    setResultUrl(null)
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
        highlight="Video"
        desc="Buat video dari teks/prompt menggunakan AI. Pilih model dan durasi yang diinginkan."
      />

      <div className="max-w-3xl mx-auto space-y-6">
        <Section title="Prompt" sub="Deskripsikan video yang ingin kamu buat">
          <Textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Contoh: A astronaut floating in space with Earth in the background, cinematic lighting, slow camera movement..."
            rows={4}
            disabled={loading}
          />
        </Section>

        <Section title="Model & Durasi">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Model</label>
              <Select
                value={model}
                onChange={e => setModel(e.target.value)}
                disabled={loading}
                options={T2V_MODELS.map(m => ({ value: m.value, label: `${m.label} (${m.cr} cr)` }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Durasi</label>
              <Select
                value={duration}
                onChange={e => setDuration(e.target.value)}
                disabled={loading}
                options={DURATION_OPTIONS}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Provider</label>
              <div className="flex items-center h-10 px-3 rounded-xl border border-border bg-muted/30">
                <Badge>{selectedModel.provider}</Badge>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Generate">
          <div className="flex items-center gap-3">
            <Button onClick={handleGenerate} loading={loading} disabled={!prompt.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              {loading ? 'Generating...' : 'Generate Video'}
            </Button>
            {!hasKey && (
              <span className="text-xs text-destructive">Tambah {selectedModel.provider} key di Providers</span>
            )}
          </div>

          {resultUrl && (
            <div className="mt-4 rounded-xl border border-border overflow-hidden">
              <video src={resultUrl} controls className="w-full" />
              <div className="p-3 flex justify-end">
                <a href={resultUrl} download className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                  <Download className="h-3 w-3" /> Download
                </a>
              </div>
            </div>
          )}
        </Section>
      </div>
    </PageContent>
  )
}
