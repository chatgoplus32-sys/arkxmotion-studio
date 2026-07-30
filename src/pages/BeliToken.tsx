import { useState, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge } from '@/components/ui'
import { ShoppingCart, ExternalLink, Loader2, Copy, Check } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'

interface TokenItem {
  id: number
  provider: string
  name: string
  price: number
  status: string
}

const WHATSAPP_LINK = 'https://wa.me/6285156207924?text=Halo%20saya%20ingin%20order%20token'

const PROVIDER_INFO: Record<string, { label: string; color: string; desc: string }> = {
  roboneo: { label: 'Roboneo', color: 'text-blue-400', desc: 'Motion Control, Kling 2.6, Seedance' },
  framia: { label: 'Framia', color: 'text-purple-400', desc: 'Video & Image generation (Converge AI)' },
  weavy: { label: 'Weavy', color: 'text-cyan-400', desc: 'Kling, Sora, Veo, Seedance, Wan' },
}

export default function BeliTokenPage() {
  const { token } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const [tokens, setTokens] = useState<TokenItem[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetchTokens()
  }, [])

  const fetchTokens = async () => {
    try {
      const res = await fetch('/api/tokens', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setTokens(data.tokens || [])
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  const handleOrder = (token: TokenItem) => {
    const msg = `Halo, saya ingin order token:\n\nProvider: ${token.provider}\nToken: ${token.name}\nHarga: Rp ${token.price.toLocaleString('id-ID')}\n\nMohon info pembayaran.`
    const url = `https://wa.me/6285156207924?text=${encodeURIComponent(msg)}`
    window.open(url, '_blank')
  }

  const handleCopyWA = () => {
    navigator.clipboard.writeText('6285156207924')
    setCopied(true)
    addToast('Nomor WhatsApp disalin!', 'success')
    setTimeout(() => setCopied(false), 2000)
  }

  const availableTokens = tokens.filter(t => t.status === 'available')
  const grouped = availableTokens.reduce((acc, t) => {
    if (!acc[t.provider]) acc[t.provider] = []
    acc[t.provider].push(t)
    return acc
  }, {} as Record<string, TokenItem[]>)

  return (
    <PageContent>
      <PageHeader
        eyebrow="Marketplace"
        title="Beli"
        highlight="Token"
        desc="Beli API token provider untuk mengakses semua fitur AI generation."
      />

      <div className="max-w-4xl mx-auto space-y-6">
        <Section title="Cara Pemesanan" sub="3 langkah mudah untuk mendapatkan token">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { step: '1', title: 'Pilih Token', desc: 'Pilih provider dan token yang diinginkan dari daftar di bawah.' },
              { step: '2', title: 'Hubungi Admin', desc: 'Klik "Pesan" atau hubungi WhatsApp admin untuk proses pembayaran.' },
              { step: '3', title: 'Token Aktif', desc: 'Setelah pembayaran dikonfirmasi, token akan langsung aktif di akun kamu.' },
            ].map((s) => (
              <div key={s.step} className="rounded-xl border border-border bg-card/50 p-4 text-center">
                <div className="h-8 w-8 rounded-full gold-gradient flex items-center justify-center text-sm font-bold text-black mx-auto">
                  {s.step}
                </div>
                <div className="mt-2 text-sm font-medium">{s.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{s.desc}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Kontak Admin" sub="Hubungi via WhatsApp untuk pemesanan">
          <div className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card/50">
            <div className="h-10 w-10 rounded-full bg-green-500/20 flex items-center justify-center">
              <ShoppingCart className="h-5 w-5 text-green-400" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">WhatsApp Admin</div>
              <div className="text-xs text-muted-foreground">0851-5620-7924</div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleCopyWA}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Tersalin' : 'Salin'}
              </Button>
              <Button size="sm" onClick={() => window.open(WHATSAPP_LINK, '_blank')}>
                <ExternalLink className="h-3.5 w-3.5" /> Chat
              </Button>
            </div>
          </div>
        </Section>

        <Section title="Daftar Token" sub="Token yang tersedia untuk dibeli">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : availableTokens.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Belum ada token tersedia. Hubungi admin untuk info lebih lanjut.
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(grouped).map(([provider, items]) => {
                const info = PROVIDER_INFO[provider] || { label: provider, color: 'text-gray-400', desc: '' }
                return (
                  <div key={provider} className="rounded-xl border border-border overflow-hidden">
                    <div className="px-4 py-3 border-b border-border bg-card/50">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold ${info.color}`}>{info.label}</span>
                        <Badge>{items.length} token</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{info.desc}</div>
                    </div>
                    <div className="divide-y divide-border">
                      {items.map((t) => (
                        <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/50 transition">
                          <div>
                            <div className="text-sm font-medium">{t.name}</div>
                            <div className="text-xs text-muted-foreground">Rp {t.price.toLocaleString('id-ID')}</div>
                          </div>
                          <Button size="sm" onClick={() => handleOrder(t)}>
                            Pesan
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Section>

        <Section title="Token Saya" sub="Ringkasan token yang sudah kamu miliki">
          <div className="text-center py-6 text-sm text-muted-foreground">
            Lihat detail token di halaman <a href="/providers" className="text-primary hover:underline">Providers</a>.
          </div>
        </Section>
      </div>
    </PageContent>
  )
}
