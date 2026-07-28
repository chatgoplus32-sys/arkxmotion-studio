import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Textarea, Badge } from '@/components/ui'
import { Sparkles, ArrowRight, Loader2, Video, Film, Clapperboard, ShoppingBag, Image, Search } from 'lucide-react'

interface WorkflowRoute {
  id: string
  label: string
  route: string
  icon: React.ReactNode
  keywords: string[]
  description: string
}

const workflows: WorkflowRoute[] = [
  {
    id: 'motion',
    label: 'Motion Control',
    route: '/generate/motion',
    icon: <Video className="h-5 w-5" />,
    keywords: ['motion', 'dance', 'gerakan', 'karakter', 'transfer', 'animasi', 'character', 'move'],
    description: 'Transfer gerakan karakter dari video/gambar referensi',
  },
  {
    id: 'narrative-video',
    label: 'Naratif Video',
    route: '/generate/naratif',
    icon: <Film className="h-5 w-5" />,
    keywords: ['video', 'naratif', 'cerita', 'story', 'berita', 'news', 'artikel', 'article', 'narrative', 'education', 'what-if'],
    description: 'Buat video naratif dari artikel/berita/blog',
  },
  {
    id: 'storyboard',
    label: 'Produk Storyboard',
    route: '/generate/storyboard',
    icon: <Clapperboard className="h-5 w-5" />,
    keywords: ['storyboard', 'produk', 'product', 'iklan', 'ad', 'affiliate', 'commerce', 'multi-scene'],
    description: 'Generate storyboard untuk produk/iklan',
  },
  {
    id: 'bulk-fashion',
    label: 'Bulk Fashion',
    route: '/generate/bulk-fashion',
    icon: <ShoppingBag className="h-5 w-5" />,
    keywords: ['fashion', 'outfit', 'baju', 'pakaian', 'clothing', 'apparel', 'model', 'wear'],
    description: 'Generate banyak foto fashion dari 1 karakter + banyak outfit',
  },
  {
    id: 'image-to-video',
    label: 'Image to Video',
    route: '/generate/image-to-video',
    icon: <Image className="h-5 w-5" />,
    keywords: ['image', 'gambar', 'animate', 'foto', 'photo', 'picture', 'img2vid', 'i2v'],
    description: 'Animasi gambar menjadi video',
  },
  {
    id: 'providers',
    label: 'Providers',
    route: '/providers',
    icon: <Search className="h-5 w-5" />,
    keywords: ['provider', 'api', 'key', 'token', 'setup', 'config'],
    description: 'Kelola API key dan provider AI',
  },
]

const STEPS = ['Menganalisa intent', 'Memilih workflow', 'Menyiapkan handoff']

export default function CommandPage() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(0)
  const [result, setResult] = useState<{
    workflow: string
    title: string
    keyword: string
    reasoning: string
    route: string
  } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        textareaRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const analyzePrompt = (text: string) => {
    const lower = text.toLowerCase()
    const words = lower.split(/\s+/)

    let bestMatch = workflows[workflows.length - 1] // default to research
    let bestScore = 0

    for (const workflow of workflows) {
      let score = 0
      for (const keyword of workflow.keywords) {
        if (lower.includes(keyword)) {
          score += keyword.length // longer matches score higher
        }
      }
      if (score > bestScore) {
        bestScore = score
        bestMatch = workflow
      }
    }

    return bestMatch
  }

  const extractTitle = (text: string): string => {
    // Try to extract a meaningful title from the prompt
    const cleaned = text.replace(/[?.!,]+$/g, '').trim()
    if (cleaned.length <= 60) return cleaned
    return cleaned.slice(0, 57) + '...'
  }

  const extractKeyword = (text: string): string => {
    const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    return words.slice(0, 5).join(' ')
  }

  const handleRun = async () => {
    const trimmed = prompt.trim()
    if (!trimmed) return

    setLoading(true)
    setResult(null)
    setStep(0)

    // Step 1: Analyze
    await new Promise((r) => setTimeout(r, 700))
    setStep(1)

    // Step 2: Choose workflow
    await new Promise((r) => setTimeout(r, 700))
    const workflow = analyzePrompt(trimmed)
    setStep(2)

    // Step 3: Prepare handoff
    await new Promise((r) => setTimeout(r, 600))

    const title = extractTitle(trimmed)
    const keyword = extractKeyword(trimmed)

    setResult({
      workflow: workflow.id,
      title,
      keyword,
      reasoning: `Berdasarkan permintaan Anda, saya merekomendasikan workflow "${workflow.label}" karena ${workflow.description.toLowerCase()}.`,
      route: workflow.route,
    })

    setLoading(false)
  }

  const handleGoToWorkflow = () => {
    if (result) {
      navigate(result.route)
    }
  }

  const matchedWorkflow = result ? workflows.find((w) => w.id === result.workflow) : null

  return (
    <PageContent>
      <PageHeader
        eyebrow="AI"
        title="Command"
        highlight="Center"
        desc="Tulis apa yang mau kamu buat. AI memilih workflow, sumber, dan hand-off ke studio yang tepat."
      />

      <div className="max-w-3xl mx-auto space-y-6">
        {/* Main Command Input */}
        <Section
          title="What do you want to create?"
          sub="Tulis permintaanmu dalam Bahasa Indonesia atau Inggris"
        >
          <div className="space-y-4">
            <div className="relative">
              <Textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Contoh: Buat video motion dari gambar karakter ini dengan gerakan dance..."
                rows={3}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    handleRun()
                  }
                }}
                disabled={loading}
              />
              <div className="absolute bottom-2 right-2 text-[10px] text-muted-foreground">
                Ctrl+Enter to run
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={handleRun} loading={loading} disabled={!prompt.trim()}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Routing…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Run
                  </>
                )}
              </Button>
              <span className="text-xs text-muted-foreground">
                Ctrl+K to focus
              </span>
            </div>

            {/* Loading Steps */}
            {loading && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {STEPS.map((s, i) => (
                  <div key={s} className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        i <= step
                          ? 'bg-primary shadow-[0_0_8px_var(--primary)]'
                          : 'bg-border'
                      }`}
                    />
                    <span className={i <= step ? 'text-foreground/80' : ''}>{s}</span>
                    {i < STEPS.length - 1 && <span className="opacity-40">→</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Result */}
            {result && !loading && (
              <div className="p-4 rounded-xl border border-border bg-card/50 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex items-start gap-3">
                  <ArrowRight className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Routed to </span>
                      <Badge className="ml-1">{result.workflow}</Badge>
                      {matchedWorkflow && (
                        <span className="ml-2 text-muted-foreground">
                          · {result.title}
                        </span>
                      )}
                    </div>
                    {result.reasoning && (
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {result.reasoning}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-3">
                      <Button size="sm" onClick={handleGoToWorkflow}>
                        Go to {matchedWorkflow?.label} <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                      <span className="text-[10px] text-muted-foreground">
                        Keyword: {result.keyword}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* Available Workflows */}
        <Section title="Available Workflows" sub="Pilih workflow secara manual atau gunakan AI Command Center">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {workflows.map((wf) => (
              <a
                key={wf.id}
                href={wf.route}
                className="flex items-start gap-3 p-3 rounded-xl border border-border hover:bg-accent hover:border-primary/30 transition group"
              >
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition">
                  {wf.icon}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{wf.label}</div>
                  <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                    {wf.description}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </Section>

        {/* Quick Examples */}
        <Section title="💡 Quick Examples">
          <div className="flex flex-wrap gap-2">
            {[
              'Buat video dance dari gambar karakter',
              'Buat video naratif dari artikel berita',
              'Generate storyboard untuk produk skincare',
              'Buat 10 foto fashion dengan outfit berbeda',
              'Animasi gambar pemandangan jadi video',
              'Riset trending topic untuk YouTube',
            ].map((example) => (
              <button
                key={example}
                onClick={() => {
                  setPrompt(example)
                  textareaRef.current?.focus()
                }}
                className="px-3 py-1.5 rounded-full border border-border text-xs hover:bg-accent hover:border-primary/30 transition"
              >
                {example}
              </button>
            ))}
          </div>
        </Section>
      </div>
    </PageContent>
  )
}
