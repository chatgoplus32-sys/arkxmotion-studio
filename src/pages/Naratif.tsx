import { useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Input, Textarea, Select, Label, Badge, EmptyState } from '@/components/ui'
import { Film, Upload, Rocket, Loader2, Mic, Play, Sparkles, Merge } from 'lucide-react'

export default function NaratifPage() {
  const [url, setUrl] = useState('')
  const [material, setMaterial] = useState<any>(null)
  const [scraping, setScraping] = useState(false)
  const [scrapeStatus, setScrapeStatus] = useState('')
  const [ratio, setRatio] = useState('9:16')
  const [extra, setExtra] = useState('')
  const [scenes, setScenes] = useState<any[]>([])
  const [brainStatus, setBrainStatus] = useState('')
  const [generating, setGenerating] = useState({ img: false, vo: false, vid: false, merge: false })
  const [finalUrl, setFinalUrl] = useState<string | null>(null)

  const handleScrape = async () => {
    if (!url.trim()) return
    setScraping(true)
    setScrapeStatus('Mengambil materi…')
    await new Promise((r) => setTimeout(r, 2000))
    setMaterial({
      title: 'Sample Article Title',
      desc: 'This is a sample article description for testing purposes.',
      body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      images: [],
    })
    setScrapeStatus('✅ Materi terambil')
    setScraping(false)
  }

  const handleBrain = async () => {
    if (!material) return
    setBrainStatus('Brain menganalisa & menyusun scene…')
    await new Promise((r) => setTimeout(r, 2000))
    setScenes([
      { idx: 1, prompt: 'Scene 1: Opening shot', videoPrompt: 'Slow zoom in', narration: 'Opening narration for scene 1.' },
      { idx: 2, prompt: 'Scene 2: Main content', videoPrompt: 'Pan right', narration: 'Main content narration for scene 2.' },
      { idx: 3, prompt: 'Scene 3: Conclusion', videoPrompt: 'Dolly zoom', narration: 'Conclusion narration for scene 3.' },
    ])
    setBrainStatus('✅ 3 scene siap. Edit prompt & narasi bila perlu.')
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Generate"
        title="Naratif Video"
        highlight="Maker"
        desc="Link artikel/berita/blog → scrape → Brain → gambar per scene → voice-over → gabung jadi video naratif."
      />

      {/* Source URL */}
      <Section title="🔗 Sumber Artikel">
        <div className="flex gap-2">
          <Input
            type="url"
            placeholder="https://..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button onClick={handleScrape} loading={scraping} disabled={!url.trim()} className="whitespace-nowrap shrink-0">
            <Upload className="h-4 w-4" /> Ambil Materi
          </Button>
        </div>
        {scrapeStatus && <div className="mt-2 text-[11px] text-muted-foreground">{scrapeStatus}</div>}
      </Section>

      {/* Material */}
      {material && (
        <Section title="📰 Materi">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <Label>Judul</Label>
              <Input value={material.title} onChange={(e) => setMaterial({ ...material, title: e.target.value })} />
            </div>
            <div>
              <Label>Deskripsi Singkat</Label>
              <Textarea rows={2} value={material.desc} onChange={(e) => setMaterial({ ...material, desc: e.target.value })} />
            </div>
            <div>
              <Label>Isi Artikel</Label>
              <Textarea rows={6} value={material.body} onChange={(e) => setMaterial({ ...material, body: e.target.value })} className="text-xs" />
            </div>
          </div>
        </Section>
      )}

      {/* Brain Settings */}
      {material && (
        <Section title="🧠 Brain — Naskah & Model">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <Label>Aspek Rasio</Label>
              <Select
                value={ratio}
                onChange={(e) => setRatio(e.target.value)}
                options={[
                  { value: '9:16', label: '9:16 Vertical' },
                  { value: '16:9', label: '16:9 Landscape' },
                  { value: '1:1', label: '1:1 Square' },
                ]}
              />
            </div>
            <div>
              <Label>Extra Prompt (opsional)</Label>
              <Textarea
                rows={2}
                placeholder="Gaya visual, mood, angle bercerita tertentu…"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            <Button onClick={handleBrain}>
              <Sparkles className="h-4 w-4" /> Analisa & Bikin Naskah
            </Button>
            {brainStatus && <div className="text-[11px] text-muted-foreground">{brainStatus}</div>}
          </div>
        </Section>
      )}

      {/* Scenes */}
      {scenes.length > 0 && (
        <Section title={`🎬 Scenes (${scenes.length})`}>
          <div className="flex flex-col gap-4">
            {scenes.map((scene, index) => (
              <div key={scene.idx} className="rounded-xl border border-border bg-card/40 p-4">
                <div className="flex flex-col lg:flex-row gap-4">
                  <div className="md:w-56 shrink-0 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-mono bg-primary/15 text-primary">
                        Scene #{scene.idx}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ◻️ ◻️ ◻️
                      </span>
                    </div>
                    <div className="aspect-[9/16] rounded-lg overflow-hidden bg-black/40 border border-border grid place-items-center">
                      <span className="text-[11px] text-muted-foreground">Belum ada gambar</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" className="!px-2 !py-1 text-[11px]">
                        <Sparkles className="h-3 w-3" /> Img
                      </Button>
                      <Button size="sm" variant="outline" className="!px-2 !py-1 text-[11px]">
                        <Mic className="h-3 w-3" /> VO
                      </Button>
                      <Button size="sm" variant="outline" className="!px-2 !py-1 text-[11px]">
                        <Film className="h-3 w-3" /> Vid
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col gap-3 min-w-0">
                    <div>
                      <Label>Prompt Gambar</Label>
                      <Textarea
                        rows={3}
                        value={scene.prompt}
                        onChange={(e) => {
                          const newScenes = [...scenes]
                          newScenes[index].prompt = e.target.value
                          setScenes(newScenes)
                        }}
                      />
                    </div>
                    <div>
                      <Label>Prompt Video (motion / kamera)</Label>
                      <Textarea
                        rows={2}
                        placeholder="Slow zoom in, gentle parallax…"
                        value={scene.videoPrompt}
                        onChange={(e) => {
                          const newScenes = [...scenes]
                          newScenes[index].videoPrompt = e.target.value
                          setScenes(newScenes)
                        }}
                      />
                    </div>
                    <div>
                      <Label>Narasi (VO)</Label>
                      <Textarea
                        rows={3}
                        value={scene.narration}
                        onChange={(e) => {
                          const newScenes = [...scenes]
                          newScenes[index].narration = e.target.value
                          setScenes(newScenes)
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={generating.img}>
              {generating.img ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating.img ? 'Menggenerate Gambar…' : 'Generate Semua Gambar'}
            </Button>
            <Button disabled={generating.vo}>
              {generating.vo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
              {generating.vo ? 'Menggenerate VO…' : 'Generate Semua Voice-Over'}
            </Button>
            <Button disabled={generating.vid}>
              {generating.vid ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
              {generating.vid ? 'Menggenerate Video…' : 'Generate Semua Image→Video'}
            </Button>
            <Button disabled={generating.merge} className="relative overflow-hidden">
              {generating.merge ? <Loader2 className="h-4 w-4 animate-spin" /> : <Merge className="h-4 w-4" />}
              {generating.merge ? 'Menggabung…' : 'Gabung jadi Video Naratif'}
            </Button>
          </div>
        </Section>
      )}

      {/* Final Video */}
      {finalUrl && (
        <Section title="🎬 Video Naratif">
          <video src={finalUrl} controls className="w-full rounded-lg aspect-[9/16] bg-black" />
          <div className="flex justify-center mt-3">
            <a href={finalUrl} download className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
              ⬇️ Unduh Video Naratif
            </a>
          </div>
        </Section>
      )}

      {/* Empty State */}
      {!material && (
        <Section>
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Rocket className="mx-auto h-8 w-8 opacity-50" />
            <div className="mt-2">
              Paste URL artikel di atas lalu klik <b>Ambil Materi</b> untuk memulai.
            </div>
          </div>
        </Section>
      )}
    </PageContent>
  )
}
