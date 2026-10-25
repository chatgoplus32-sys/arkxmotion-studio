import { ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { DEFAULT_PRO_FEE, getProFee } from '@/lib/pro'
import { formatRp } from '@/lib/membership'
import { ArrowRight, Crown, Lock } from 'lucide-react'

const FEATURES = [
  'Gemini Tools',
  'AI Song Cover',
  'H3 Music Avatar',
]

export default function ProRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const isPro = user?.role === 'admin' || user?.plan === 'pro'
  const [fee, setFee] = useState(DEFAULT_PRO_FEE)

  useEffect(() => {
    if (isPro) return
    getProFee().then(setFee).catch(() => {})
  }, [isPro])

  if (isPro) return <>{children}</>

  return (
    <PageContent>
      <PageHeader
        eyebrow="ARKXMOTION PRO"
        title="Fitur"
        highlight="Pro"
        desc="Tiga fitur premium khusus member Pro. Fitur AI lainnya tetap terbuka."
      />
      <Section className="max-w-2xl mx-auto">
        <div className="flex flex-col items-center text-center py-6">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
            <Lock className="h-8 w-8" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold uppercase tracking-wide mb-3">
            <Crown className="h-3 w-3" /> Pro only
          </div>
          <h2 className="text-xl font-display font-bold">Fitur premium terkunci</h2>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-md">
            Upgrade Pro sekali bayar untuk membuka <b>Gemini Tools</b>, <b>AI Song Cover</b>, dan{' '}
            <b>H3 Music Avatar</b>. Fitur AI lain tetap bisa kamu pakai tanpa upgrade.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 w-full max-w-lg mt-5">
            {FEATURES.map((feature) => (
              <div
                key={feature}
                className="flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground"
              >
                <Lock className="h-3.5 w-3.5 shrink-0" /> {feature}
              </div>
            ))}
          </div>

          <Link to="/upgrade-pro" className="mt-6">
            <Button size="lg">
              <Crown className="h-4 w-4" /> Upgrade ke Pro <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <p className="text-[11px] text-muted-foreground mt-2">
            Upgrade member lama {formatRp(fee)} · sekali bayar, permanen
          </p>
        </div>
      </Section>
    </PageContent>
  )
}
