import { useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Select, Badge } from '@/components/ui'
import { Wand2, Loader2, Upload } from 'lucide-react'
import type { ProviderId } from '@/stores/providerManager'
import { useToastStore } from '@/stores/toastStore'

const UPSCALE_MODELS = [
  { value: 'magnific-2x', label: 'Magnific 2x', provider: 'magnific' as ProviderId, cr: 19 },
  { value: 'magnific-4x', label: 'Magnific 4x', provider: 'magnific' as ProviderId, cr: 38 },
  { value: 'topaz-2x', label: 'Topaz 2x', provider: 'leonardo' as ProviderId, cr: 25 },
]

export default function UpscalerPage() {
  const addToast = useToastStore((s) => s.addToast)
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [model, setModel] = useState(UPSCALE_MODELS[0].value)
  const [loading, setLoading] = useState(false)

  const selectedModel = UPSCALE_MODELS.find(m => m.value === model) || UPSCALE_MODELS[0]

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      setImgUrl(url)
    }
  }

  const handleUpscale = async () => {
    if (!imgUrl) return
    setLoading(true)
    try {
      await new Promise(r => setTimeout(r, 2000))
      addToast('Image upscale submitted.', 'success')
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
        title="Image"
        highlight="Upscaler"
        desc="Tingkatkan resolusi dan kualitas gambar menggunakan AI."
      />

      <div className="max-w-3xl mx-auto space-y-6">
        <Section title="Upload Image" sub="Drag & drop atau klik untuk upload">
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary/50 transition cursor-pointer"
          >
            {imgUrl ? (
              <img src={imgUrl} alt="Input" className="max-h-64 mx-auto rounded-lg" />
            ) : (
              <div className="space-y-2">
                <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Drag & drop image di sini</p>
              </div>
            )}
          </div>
        </Section>

        <Section title="Settings">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Model</label>
              <Select
                value={model}
                onChange={e => setModel(e.target.value)}
                disabled={loading}
                options={UPSCALE_MODELS.map(m => ({ value: m.value, label: `${m.label} (${m.cr} cr)` }))}
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

        <Section title="Upscale">
          <div className="flex items-center gap-3">
            <Button onClick={handleUpscale} loading={loading} disabled={!imgUrl}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {loading ? 'Upscaling...' : 'Upscale Image'}
            </Button>
          </div>
        </Section>
      </div>
    </PageContent>
  )
}
