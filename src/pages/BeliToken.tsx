import { useState } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { ShoppingCart, ExternalLink, Copy, Check } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'

const WHATSAPP_LINK = 'https://wa.me/6285156207924?text=Halo%20saya%20ingin%20order%20token'

export default function BeliTokenPage() {
  const addToast = useToastStore((s) => s.addToast)
  const [copied, setCopied] = useState(false)

  const handleCopyWA = () => {
    navigator.clipboard.writeText('6285156207924')
    setCopied(true)
    addToast('Nomor WhatsApp disalin!', 'success')
    setTimeout(() => setCopied(false), 2000)
  }

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
              { step: '1', title: 'Pilih Provider', desc: 'Tentukan provider mana yang kamu butuhkan (Roboneo, Framia, Weavy, dll).' },
              { step: '2', title: 'Hubungi Admin', desc: 'Chat WhatsApp admin untuk info harga dan proses pembayaran.' },
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

        <Section title="Provider yang Didukung" sub="Token tersedia untuk provider berikut">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: 'Roboneo', desc: 'Motion Control, Kling 2.6, Seedance', color: 'text-blue-400' },
              { label: 'Framia', desc: 'Video & Image generation (Converge AI)', color: 'text-purple-400' },
              { label: 'Weavy', desc: 'Kling, Sora, Veo, Seedance, Wan', color: 'text-cyan-400' },
            ].map((p) => (
              <div key={p.label} className="rounded-xl border border-border bg-card/50 p-4">
                <div className={`text-sm font-semibold ${p.color}`}>{p.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{p.desc}</div>
              </div>
            ))}
          </div>
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
