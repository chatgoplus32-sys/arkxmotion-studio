import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageContent } from '@/components/layout'
import { Card, CardContent } from '@/components/ui'
import { Sparkles, ArrowRight, Loader2, Video, Image, Search, ShoppingBag, Wand2, Zap, Route, Settings, Clock, Star, Command as CommandIcon, Trash2 } from 'lucide-react'

interface WorkflowRoute {
  id: string
  label: string
  route: string
  icon: React.ReactNode
  keywords: string[]
  description: string
  accent: string
  hotkey: string
}

const workflows: WorkflowRoute[] = [
  { id: 'motion', label: 'Motion Control', route: '/generate/motion', icon: <Video className="h-5 w-5" />, keywords: ['motion','dance','gerakan','karakter','transfer','animasi','character','move','kling','wan'], description: 'Transfer gerakan video ke karakter', accent: 'from-amber-500 to-yellow-400', hotkey: 'M' },
  { id: 'image-to-video', label: 'Image to Video', route: '/generate/image-to-video', icon: <Image className="h-5 w-5" />, keywords: ['image','gambar','animate','foto','photo','picture','img2vid','i2v','veo','wan'], description: 'Foto jadi video sinematik', accent: 'from-violet-500 to-purple-400', hotkey: 'I' },
  { id: 'bulk', label: 'Bulk Fashion', route: '/generate/bulk-fashion', icon: <ShoppingBag className="h-5 w-5" />, keywords: ['bulk','fashion','outfit','csv','katalog','parallel','baju'], description: '1 model + 100 outfit parallel', accent: 'from-orange-500 to-amber-400', hotkey: 'B' },
  { id: 'ugc', label: 'Product UGC', route: '/generate/ugc', icon: <Star className="h-5 w-5" />, keywords: ['ugc','product','produk','shopee','tokopedia','tiktok','jual'], description: 'Product photo → UGC video', accent: 'from-pink-500 to-rose-400', hotkey: 'U' },
  { id: 'upscaler', label: 'AI Upscaler', route: '/generate/upscaler', icon: <Wand2 className="h-5 w-5" />, keywords: ['upscale','enhance','4k','magnific','leonardo','topaz','hd'], description: 'Upscale 4K enhance detail', accent: 'from-cyan-500 to-blue-400', hotkey: 'E' },
  { id: 'providers', label: 'Providers', route: '/providers', icon: <Zap className="h-5 w-5" />, keywords: ['provider','api','key','token','setup','config','balance'], description: 'Kelola API keys & tokens', accent: 'from-emerald-500 to-teal-400', hotkey: 'P' },
  { id: 'routing', label: 'Smart Routing', route: '/manage/routing', icon: <Route className="h-5 w-5" />, keywords: ['routing','route','smart','auto','fallback'], description: 'Auto pilih provider termurah', accent: 'from-amber-500 to-orange-400', hotkey: 'R' },
  { id: 'settings', label: 'Settings', route: '/settings', icon: <Settings className="h-5 w-5" />, keywords: ['setting','pengaturan','setting','config'], description: 'Pengaturan akun & sistem', accent: 'from-zinc-500 to-zinc-400', hotkey: 'S' },
]

const STEPS = ['Analisa intent', 'Pilih workflow', 'Siapkan handoff']
const EXAMPLES = ['Buat video dance dari gambar karakter','Animasi foto pemandangan jadi video 6s','Bulk 50 outfit katalog fashion','Upscale foto produk jadi 4K','Bikin UGC video untuk Shopee','Cek balance provider Weavy']

export default function CommandPage() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(0)
  const [history, setHistory] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('arkx.command.history')||'[]')} catch {return []}})
  const [result, setResult] = useState<{ workflow: string; title: string; keyword: string; reasoning: string; route: string } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [filter, setFilter] = useState('')

  const filteredWorkflows = useMemo(() => {
    if (!filter.trim()) return workflows
    const q = filter.toLowerCase()
    return workflows.filter(w => w.label.toLowerCase().includes(q) || w.keywords.some(k=>q.includes(k)) || w.description.toLowerCase().includes(q))
  }, [filter])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); textareaRef.current?.focus() }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const analyzePrompt = (text: string) => {
    const lower = text.toLowerCase()
    let best = workflows[0]
    let bestScore = -1
    for (const wf of workflows) {
      let score = 0
      for (const kw of wf.keywords) if (lower.includes(kw)) score += kw.length + 2
      score += wf.label.toLowerCase().split(' ').filter(w=> lower.includes(w)).length * 5
      if (score > bestScore) { bestScore = score; best = wf }
    }
    if (bestScore <= 0) {
      if (lower.includes('video') || lower.includes('gambar')) best = workflows[1]
      else best = workflows[0]
    }
    return best
  }

  const handleRun = async () => {
    const trimmed = prompt.trim()
    if (!trimmed) return
    setLoading(true); setResult(null); setStep(0)
    await new Promise(r=>setTimeout(r,500)); setStep(1)
    await new Promise(r=>setTimeout(r,500))
    const wf = analyzePrompt(trimmed)
    setStep(2)
    await new Promise(r=>setTimeout(r,400))
    const title = trimmed.length>60? trimmed.slice(0,57)+'...' : trimmed
    const keyword = trimmed.toLowerCase().split(/\s+/).filter(w=>w.length>3).slice(0,4).join(' ')
    setResult({ workflow: wf.id, title, keyword, reasoning: `Rekomendasi "${wf.label}" — ${wf.description.toLowerCase()}. Cocok untuk prompt kamu.`, route: wf.route })
    setLoading(false)
    const next = [trimmed, ...history.filter(h=>h!==trimmed)].slice(0,6)
    setHistory(next); localStorage.setItem('arkx.command.history', JSON.stringify(next))
  }

  const matched = result ? workflows.find(w=>w.id===result.workflow) : null

  return (
    <PageContent className="space-y-6">
      <div className="relative overflow-hidden rounded-[24px] border border-white/[0.06] bg-gradient-to-br from-[#d4a017]/10 via-card to-card p-6">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:radial-gradient(ellipse_60%_40%_at_50%_0%,black_60%,transparent_100%)]" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-mono tracking-[0.18em] uppercase text-amber-300/80"><CommandIcon className="h-3.5 w-3.5" /> Command Center</div>
            <h1 className="mt-2 text-[26px] font-black tracking-tight">Apa yang mau kamu buat?</h1>
            <p className="text-sm text-white/50">Ketik natural language — AI routing ke workflow yang tepat. <span className="hidden sm:inline font-mono text-xs px-1.5 py-0.5 rounded bg-white/5 border border-white/10">⌘K</span> untuk fokus.</p>
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs text-white/30"><Clock className="h-3.5 w-3.5" /> {history.length} history</div>
        </div>
      </div>

      <Card variant="bordered" className="overflow-hidden">
        <CardContent className="p-5 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-3.5 h-4 w-4 text-white/30" />
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={e=>setPrompt(e.target.value)}
              placeholder="Contoh: Buat video motion dance dari gambar karakter ini..."
              rows={3}
              onKeyDown={e=>{ if ((e.metaKey||e.ctrlKey) && e.key==='Enter'){ e.preventDefault(); handleRun() } }}
              disabled={loading}
              className="w-full pl-10 pr-4 py-3 bg-white/[0.04] border border-white/10 rounded-2xl text-sm placeholder:text-white/30 focus:outline-none focus:border-[#d4a017]/40 focus:bg-white/[0.06] transition resize-none"
            />
            <div className="absolute bottom-2 right-2 flex items-center gap-2">
              <span className="hidden sm:inline text-[11px] font-mono px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/30">Ctrl+Enter</span>
              <button onClick={handleRun} disabled={!prompt.trim()||loading} className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#d4a017] to-[#ffd700] text-black text-sm font-semibold disabled:opacity-40 hover:shadow-[0_6px_16px_rgba(212,160,23,0.3)] transition flex items-center gap-1.5">
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Routing…</> : <><Sparkles className="h-4 w-4" /> Run</>}
              </button>
            </div>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-xs">
              {STEPS.map((s,i)=> (
                <div key={s} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${i<=step?'bg-[#d4a017] shadow-[0_0_8px_rgba(212,160,23,0.6)]':'bg-white/10'}`} />
                  <span className={i<=step?'text-white':'text-white/30'}>{s}</span>
                  {i<STEPS.length-1 && <span className="text-white/20">→</span>}
                </div>
              ))}
            </div>
          )}

          {result && !loading && matched && (
            <div className="p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 flex items-start gap-3 animate-fade-in">
              <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${matched.accent} grid place-items-center text-white shrink-0`}>{matched.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold flex items-center gap-2 flex-wrap">Routed to <span className="px-2 py-0.5 rounded-full bg-white text-black text-xs font-bold">{matched.label}</span> <span className="text-white/40">· {result.title}</span></div>
                <div className="text-xs text-white/50 mt-1">{result.reasoning}</div>
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={()=>navigate(result.route)} className="px-4 py-2 rounded-xl bg-white text-black text-sm font-semibold hover:bg-white/90 transition flex items-center gap-1.5">Go to {matched.label} <ArrowRight className="h-3.5 w-3.5" /></button>
                  <span className="text-[11px] font-mono px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/40">keyword: {result.keyword}</span>
                </div>
              </div>
            </div>
          )}

          {history.length>0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-white/30 flex items-center gap-1"><Clock className="h-3 w-3" /> Recent:</span>
              {history.map(h=> (
                <button key={h} onClick={()=>setPrompt(h)} className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-xs hover:bg-white/[0.08] hover:border-[#d4a017]/30 transition truncate max-w-[220px]">{h}</button>
              ))}
              <button onClick={()=>{setHistory([]); localStorage.removeItem('arkx.command.history')}} className="p-1.5 rounded-full hover:bg-white/5 text-white/30"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30" />
          <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filter workflows..." className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-sm placeholder:text-white/30 focus:outline-none focus:border-[#d4a017]/30" />
        </div>
        <span className="text-xs text-white/30 hidden sm:inline">{filteredWorkflows.length} workflows</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {filteredWorkflows.map(wf=> (
          <button key={wf.id} onClick={()=>navigate(wf.route)} className="text-left p-4 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] hover:border-[#d4a017]/20 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.25)] transition group">
            <div className="flex items-center justify-between">
              <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${wf.accent} grid place-items-center text-white shadow-md group-hover:scale-105 transition`}>{wf.icon}</div>
              <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/40">{wf.hotkey}</span>
            </div>
            <div className="text-sm font-semibold mt-3">{wf.label}</div>
            <div className="text-xs text-white/40 mt-1 line-clamp-2">{wf.description}</div>
            <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-white/30 group-hover:text-[#d4a017] transition">Buka <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition" /></div>
          </button>
        ))}
      </div>

      <Card variant="bordered">
        <CardContent className="p-4">
          <div className="text-sm font-semibold flex items-center gap-2"><Star className="h-4 w-4 text-amber-400" /> Quick Templates</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map(ex=> (
              <button key={ex} onClick={()=>{setPrompt(ex); textareaRef.current?.focus()}} className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-xs hover:bg-[#d4a017]/10 hover:border-[#d4a017]/30 hover:text-amber-200 transition">{ex}</button>
            ))}
          </div>
        </CardContent>
      </Card>
    </PageContent>
  )
}
