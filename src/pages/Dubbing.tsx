import { useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Textarea, Select, Badge } from '@/components/ui'
import { Mic, Loader2 } from 'lucide-react'
import { useProviderManager, ProviderId } from '@/stores/providerManager'
import { useToastStore } from '@/stores/toastStore'

const DUBBING_VOICES = [
  { value: 'elevenlabs-multilingual', label: 'ElevenLabs Multilingual v2', provider: 'elevenlabs' as ProviderId },
  { value: 'elevenlabs-turbo', label: 'ElevenLabs Turbo v2.5', provider: 'elevenlabs' as ProviderId },
]

const LANGUAGE_OPTIONS = [
  { value: 'id', label: 'Indonesian' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
]

export default function DubbingPage() {
  const { keys } = useProviderManager()
  const addToast = useToastStore((s) => s.addToast)
  const [text, setText] = useState('')
  const [voice, setVoice] = useState(DUBBING_VOICES[0].value)
  const [targetLang, setTargetLang] = useState('id')
  const [loading, setLoading] = useState(false)

  const selectedVoice = DUBBING_VOICES.find(v => v.value === voice) || DUBBING_VOICES[0]
  const hasKey = keys[selectedVoice.provider]?.some(k => k.status === 'active' || k.status === 'unknown')

  const handleDub = async () => {
    if (!text.trim()) return
    setLoading(true)
    try {
      await new Promise(r => setTimeout(r, 2000))
      addToast('Voice generation submitted.', 'success')
    } catch (err: any) {
      addToast(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Tools"
        title="AI"
        highlight="Dubbing"
        desc="Generate voice-over dari teks dengan pilihan model dan bahasa."
      />

      <div className="max-w-3xl mx-auto space-y-6">
        <Section title="Script" sub="Tulis teks yang ingin di-voice">
          <Textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Contoh: Selamat datang di channel kami. Hari ini kita akan membahas tentang AI..."
            rows={4}
            disabled={loading}
          />
        </Section>

        <Section title="Voice & Language">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Voice Model</label>
              <Select
                value={voice}
                onChange={e => setVoice(e.target.value)}
                disabled={loading}
                options={DUBBING_VOICES}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Target Language</label>
              <Select
                value={targetLang}
                onChange={e => setTargetLang(e.target.value)}
                disabled={loading}
                options={LANGUAGE_OPTIONS}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Provider</label>
              <div className="flex items-center h-10 px-3 rounded-xl border border-border bg-muted/30">
                <Badge>{selectedVoice.provider}</Badge>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Generate">
          <div className="flex items-center gap-3">
            <Button onClick={handleDub} loading={loading} disabled={!text.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
              {loading ? 'Generating...' : 'Generate Voice'}
            </Button>
            {!hasKey && (
              <span className="text-xs text-destructive">Tambah {selectedVoice.provider} key di Providers</span>
            )}
          </div>
        </Section>
      </div>
    </PageContent>
  )
}
