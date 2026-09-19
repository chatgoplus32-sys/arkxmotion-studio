import { useState, useEffect, useRef } from 'react'
import { PageContent } from '@/components/layout'
import { Button, Label } from '@/components/ui'
import { Loader2, Send, MessageSquare, Plus, Settings, Copy, Trash2, RefreshCw } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import {
  fetchDolaConversations,
  sendDolaMessage,
  getDolaMessages,
  setDolaCookies,
  getDolaStatus,
  type DolaConversation,
  type DolaMessage,
} from '@/lib/dola'

export default function DolaChatPage() {
  const addToast = useToastStore((s) => s.addToast)

  const [configured, setConfigured] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [cookieInput, setCookieInput] = useState('')

  const [conversations, setConversations] = useState<DolaConversation[]>([])
  const [activeConv, setActiveConv] = useState<string | null>(null)
  const [messages, setMessages] = useState<DolaMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingConvs, setLoadingConvs] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setConfigured(getDolaStatus().configured)
    if (getDolaStatus().configured) {
      // Don't auto-load conversations - let user trigger manually
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadConversations = async () => {
    setLoadingConvs(true)
    try {
      const convs = await fetchDolaConversations()
      setConversations(convs)
      if (convs.length === 0) {
        addToast('📋 Tidak ada percakapan ditemukan')
      } else {
        addToast(`📋 ${convs.length} percakapan dimuat`)
      }
    } catch (e: any) {
      addToast(`❌ Gagal load: ${e.message}`, 'error')
    } finally {
      setLoadingConvs(false)
    }
  }

  const loadMessages = async (convId: string) => {
    setActiveConv(convId)
    setLoading(true)
    try {
      const msgs = await getDolaMessages(convId)
      setMessages(msgs)
    } catch (e: any) {
      addToast(`❌ ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleSend = async () => {
    if (!input.trim() || loading) return
    if (!configured) {
      addToast('⚠️ Setup session dulu di sidebar', 'warning')
      return
    }
    const userMsg = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }])
    setLoading(true)

    try {
      const reply = await sendDolaMessage(activeConv, userMsg)
      if (reply) {
        setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: '[Tidak ada balasan dari Dola]' }])
      }
      if (!activeConv) loadConversations()
    } catch (e: any) {
      addToast(`❌ ${e.message}`, 'error')
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${e.message}` }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleSaveCookies = () => {
    if (!cookieInput.trim()) {
      addToast('⚠️ Paste cookies dola.com', 'warning')
      return
    }
    setDolaCookies(cookieInput.trim())
    setConfigured(true)
    setShowSettings(false)
    addToast('✅ Dola session tersimpan!')
    loadConversations()
  }

  const copyMessage = (text: string) => {
    navigator.clipboard.writeText(text)
    addToast('📋 Dicopy!')
  }

  return (
    <PageContent>
      <div className="flex gap-4 h-[calc(100vh-120px)]">
        {/* Left: Conversation List */}
        <div className="w-72 shrink-0 flex flex-col bg-surface-secondary rounded-xl border border-border overflow-hidden">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold">💬 Dola Chat</span>
            <div className="flex gap-1">
              <button
                onClick={() => loadConversations()}
                disabled={loadingConvs || !configured}
                className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                title="Refresh"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingConvs ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="Settings"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Settings Panel */}
          {showSettings && (
            <div className="p-3 border-b border-border bg-surface">
              <Label className="mb-2 block text-xs">🔑 Dola Session Cookies</Label>
              <textarea
                value={cookieInput}
                onChange={(e) => setCookieInput(e.target.value)}
                className="w-full h-20 px-2 py-1.5 rounded-lg bg-surface-secondary border border-border text-xs text-foreground font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Paste curl command atau cookies (key=val; key2=val2)..."
              />
              <div className="flex gap-2 mt-2">
                <Button onClick={handleSaveCookies} size="sm" className="text-xs">💾 Simpan</Button>
                <Button onClick={() => setShowSettings(false)} size="sm" variant="outline" className="text-xs">Batal</Button>
              </div>
            </div>
          )}

          {!configured && !showSettings && (
            <div className="p-3 text-center">
              <p className="text-xs text-muted-foreground mb-2">Belum dikonfigurasi</p>
              <Button onClick={() => setShowSettings(true)} size="sm" className="text-xs">
                <Settings className="h-3 w-3 mr-1" /> Setup Session
              </Button>
            </div>
          )}

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto">
            {!configured ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                Setup session dulu.
Cara: Buka dola.com/chat → F12 → Network → Copy as cURL → Paste di sidebar.
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                {loadingConvs ? 'Memuat...' : 'Belum ada percakapan'}
              </div>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.conv_id}
                  onClick={() => loadMessages(c.conv_id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-border/50 hover:bg-accent transition-colors ${
                    activeConv === c.conv_id ? 'bg-primary/10 border-l-2 border-l-primary' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs truncate">{c.title}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: Chat Area */}
        <div className="flex-1 flex flex-col bg-surface-secondary rounded-xl border border-border overflow-hidden">
          {/* Chat Header */}
          <div className="p-3 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold">
              {activeConv ? conversations.find(c => c.conv_id === activeConv)?.title || 'Chat' : '💬 New Chat'}
            </span>
            <button
              onClick={() => { setActiveConv(null); setMessages([]) }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Plus className="h-3 w-3" /> Baru
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {!configured ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Setup session Dola di sidebar untuk mulai chat
              </div>
            ) : messages.length === 0 && !loading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Mulai chat dengan Dola AI! Ketik pesan di bawah.
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-surface border border-border text-foreground'
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <button
                        onClick={() => copyMessage(msg.content)}
                        className="p-0.5 rounded hover:bg-black/10 transition-colors opacity-50 hover:opacity-100"
                        title="Copy"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-surface border border-border rounded-xl px-3 py-2 text-sm flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  <span className="text-muted-foreground">Dola sedang mengetik...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-border">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                className="flex-1 px-3 py-2 rounded-xl bg-surface border border-border text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder={configured ? 'Ketik pesan...' : 'Setup session dulu...'}
                rows={1}
                disabled={!configured || loading}
              />
              <Button
                onClick={handleSend}
                disabled={!configured || loading || !input.trim()}
                size="icon"
                className="shrink-0 rounded-xl"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </PageContent>
  )
}
