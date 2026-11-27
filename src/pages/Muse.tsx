import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge, Tabs, ProgressBar } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { addResult, persistResultToR2, type CompletedResult } from '@/lib/backgroundTasks'
import { formatRp } from '@/lib/payment'
import {
  fetchMusePricing, musePrice, museChat, museImage, museVideoCreate, museVideoStatus,
  MUSE_MIN_TOPUP, type MuseChatMessage, type MusePricing,
} from '@/lib/muse'
import { Link } from 'react-router-dom'
import {
  Sparkles, MessageSquare, Image as ImageIcon, Film, Loader2, Send, Wallet, RefreshCw, ExternalLink, Download,
} from 'lucide-react'

type Mode = 'chat' | 'image' | 'video'

export default function MusePage() {
  const { token, user } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const isAdmin = user?.role === 'admin'
  const [pricing, setPricing] = useState<MusePricing | null>(null)
  const [balance, setBalance] = useState(0)
  const [mode, setMode] = useState<Mode>('chat')

  const loadData = useCallback(async () => {
    if (!token) return
    try {
      const [p, b] = await Promise.all([
        fetchMusePricing(),
        fetch('/api/muse/balance', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
      ])
      setPricing(p)
      setBalance(b.balance || 0)
    } catch { /* ignore */ }
  }, [token])
  useEffect(() => { void loadData() }, [loadData])

  const charge = useCallback(async (model: string): Promise<number | null> => {
    if (isAdmin || !token) return null
    const cost = musePrice(pricing || { models: {}, defaultPrice: 500 }, model)
    if (balance < cost) throw new Error(`Saldo tidak cukup — top up minimal ${formatRp(MUSE_MIN_TOPUP)}`)
    const res = await fetch('/api/muse/deduct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model, kind: mode }),
    })
    const d = await res.json()
    if (!res.ok) throw new Error(d.error || 'Gagal memotong saldo')
    setBalance(d.balance)
    return d.usage_id as number
  }, [isAdmin, token, balance, pricing, mode])

  const refund = useCallback(async (usageId: number | null, model: string) => {
    if (isAdmin || !token || usageId == null) return
    try {
      const res = await fetch('/api/muse/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ usage_id: usageId, model }),
      })
      if (res.ok) { const d = await res.json(); setBalance(d.balance) }
    } catch { /* ignore */ }
  }, [isAdmin, token])

  const saveResult = (url: string, prompt: string, model: string) => {
    const item: CompletedResult = {
      id: `muse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      url, prompt, date: new Date().toISOString(),
      page: 'image-to-video', provider: 'muse', model,
    }
    addResult(item, { notify: false })
    persistResultToR2(item.id, url)
  }

  // ── Chat ──
  const [messages, setMessages] = useState<MuseChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const chatEnd = useRef<HTMLDivElement>(null)
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const sendChat = async () => {
    if (!token || !chatInput.trim() || chatBusy) return
    const text = chatInput.trim()
    setChatInput('')
    const next: MuseChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setChatBusy(true)
    let usage: number | null = null
    try {
      usage = await charge('muse-spark')
      const reply = await museChat(token, next)
      setMessages((prev) => [...prev, { role: 'assistant', content: reply || '(tanpa jawaban)' }])
    } catch (e: any) {
      await refund(usage, 'muse-spark')
      addToast(e?.message || 'Chat gagal', 'error')
    } finally { setChatBusy(false) }
  }

  // ── Image ──
  const [imgPrompt, setImgPrompt] = useState('')
  const [imgBusy, setImgBusy] = useState(false)
  const [imgUrls, setImgUrls] = useState<string[]>([])
  const genImage = async () => {
    if (!token || !imgPrompt.trim() || imgBusy) return
    setImgBusy(true)
    let usage: number | null = null
    try {
      usage = await charge('muse-image')
      const urls = await museImage(token, imgPrompt.trim(), '16:9')
      urls.forEach((u) => saveResult(u, imgPrompt.trim(), 'Muse Image'))
      setImgUrls(urls)
      addToast(`${urls.length} gambar berhasil`, 'success')
    } catch (e: any) {
      await refund(usage, 'muse-image')
      addToast(e?.message || 'Gagal buat gambar', 'error')
    } finally { setImgBusy(false) }
  }

  // ── Video ──
  const [vidPrompt, setVidPrompt] = useState('')
  const [vidDuration, setVidDuration] = useState(10)
  const [vidBusy, setVidBusy] = useState(false)
  const [vidPct, setVidPct] = useState(0)
  const [vidUrl, setVidUrl] = useState('')
  const genVideo = async () => {
    if (!token || !vidPrompt.trim() || vidBusy) return
    setVidBusy(true); setVidPct(0); setVidUrl('')
    let usage: number | null = null
    try {
      usage = await charge('muse-video')
      const taskId = await museVideoCreate(token, vidPrompt.trim(), vidDuration, '16:9')
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        setVidPct(Math.min(95, Math.round((i / 120) * 95)))
        const st = await museVideoStatus(token, taskId)
        if (st.status === 'SUCCEEDED' || st.status === 'COMPLETED') {
          if (!st.url) throw new Error('Task sukses tapi tanpa URL')
          setVidUrl(st.url); saveResult(st.url, vidPrompt.trim(), 'Muse Video'); setVidPct(100)
          addToast('Video selesai', 'success')
          return
        }
        if (['FAILED', 'ERROR', 'CANCELLED'].includes(st.status)) {
          throw new Error(st.error || `Task ${st.status}`)
        }
      }
      throw new Error('Timeout menunggu video')
    } catch (e: any) {
      await refund(usage, 'muse-video')
      addToast(e?.message || 'Gagal buat video', 'error')
    } finally { setVidBusy(false) }
  }

  const tabs: Array<{ value: Mode; label: string; icon: React.ReactNode }> = [
    { value: 'chat', label: 'Chat', icon: <MessageSquare className="h-4 w-4" /> },
    { value: 'image', label: 'Gambar', icon: <ImageIcon className="h-4 w-4" /> },
    { value: 'video', label: 'Video', icon: <Film className="h-4 w-4" /> },
  ]

  return (
    <PageContent>
      <PageHeader
        eyebrow="GENERATE · MUSEAI"
        title="Muse"
        highlight="AI"
        desc="Chat, gambar, dan video dari satu akun muse.ai — tanpa API key, cukup pakai saldo MuseAI."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant="default" className="gap-1.5 px-3 py-1.5"><Sparkles className="h-3.5 w-3.5" /> Powered by muse.ai</Badge>
        <Badge variant="secondary" className="gap-1.5 px-3 py-1.5"><Wallet className="h-3.5 w-3.5" /> Saldo {formatRp(balance)}</Badge>
        <button onClick={() => void loadData()} className="text-xs text-muted-foreground hover:text-foreground"><RefreshCw className="mr-1 inline h-3 w-3" />refresh</button>
        <Link to="/topup/muse" className="ml-auto text-xs font-semibold text-primary hover:underline">Top up saldo →</Link>
      </div>

      <Tabs
        items={tabs}
        value={mode}
        onChange={(v) => setMode(v as Mode)}
        className="mb-4"
      />

      {mode === 'chat' && (
        <Section title="Chat MuseAI" sub={`Biaya ${formatRp(musePrice(pricing || { models: {}, defaultPrice: 500 }, 'muse-spark'))} per pesan${isAdmin ? ' · admin gratis' : ''}`}>
          <div className="mb-3 max-h-[420px] space-y-2 overflow-y-auto rounded-xl border border-border bg-background/50 p-3">
            {messages.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Mulai percakapan — tanya apa saja.</p>
            ) : messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`}>{m.content}</div>
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
          <div className="flex gap-2">
            <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void sendChat() }}
              placeholder="Tulis pesan…" className="h-10 flex-1 rounded-xl border border-input bg-background px-3 text-sm" />
            <Button onClick={sendChat} disabled={chatBusy || !chatInput.trim()}><Send className="mr-2 h-4 w-4" />{chatBusy ? '…' : 'Kirim'}</Button>
          </div>
        </Section>
      )}

      {mode === 'image' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Buat Gambar" sub={`Biaya ${formatRp(musePrice(pricing || { models: {}, defaultPrice: 500 }, 'muse-image'))} per gambar`}>
            <textarea value={imgPrompt} onChange={(e) => setImgPrompt(e.target.value)}
              placeholder="Contoh: kucing oranye tidur di jendela, cahaya pagi…"
              className="min-h-[120px] w-full rounded-xl border border-input bg-background p-3 text-sm" />
            <Button className="mt-3 w-full" onClick={genImage} disabled={imgBusy || !imgPrompt.trim()}>
              {imgBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}Buat Gambar
            </Button>
          </Section>
          <Section title="Hasil" sub="Tersimpan otomatis di galeri">
            {imgUrls.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Belum ada hasil.</p> : (
              <div className="grid grid-cols-2 gap-2">
                {imgUrls.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border border-border">
                    <img src={u} alt="hasil" className="w-full" /><span className="block p-1 text-center text-[10px] text-primary">Buka <ExternalLink className="inline h-3 w-3" /></span>
                  </a>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}

      {mode === 'video' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Buat Video" sub={`Biaya ${formatRp(musePrice(pricing || { models: {}, defaultPrice: 500 }, 'muse-video'))} per video · s/d 30 detik`}>
            <textarea value={vidPrompt} onChange={(e) => setVidPrompt(e.target.value)}
              placeholder="Contoh: daun maple jatuh pelan diterpa angin…"
              className="min-h-[100px] w-full rounded-xl border border-input bg-background p-3 text-sm" />
            <div className="mt-3 flex flex-wrap gap-2">
              {[5, 10, 15, 30].map((d) => (
                <button key={d} onClick={() => setVidDuration(d)} className={`rounded-lg border px-3 py-1.5 text-xs ${vidDuration === d ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>{d}s</button>
              ))}
            </div>
            <Button className="mt-3 w-full" onClick={genVideo} disabled={vidBusy || !vidPrompt.trim()}>
              {vidBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Film className="mr-2 h-4 w-4" />}{vidBusy ? 'Memproses…' : 'Buat Video'}
            </Button>
            {vidBusy && <ProgressBar className="mt-3" value={vidPct} label="Menunggu MuseAI…" />}
          </Section>
          <Section title="Hasil" sub="Tersimpan otomatis di galeri">
            {!vidUrl ? <p className="py-10 text-center text-sm text-muted-foreground">Belum ada hasil.</p> : (
              <div>
                <video src={vidUrl} controls className="w-full rounded-xl border border-border" />
                <a href={vidUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex text-xs font-semibold text-primary hover:underline"><Download className="mr-1 h-3 w-3" />Unduh / Buka</a>
              </div>
            )}
          </Section>
        </div>
      )}
    </PageContent>
  )
}
