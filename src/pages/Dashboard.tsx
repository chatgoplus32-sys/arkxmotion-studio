import { PageHeader, PageContent } from '@/components/layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { Sparkles, Video, Image, Zap } from 'lucide-react'

export default function DashboardPage() {
  return (
    <PageContent>
      <PageHeader
        eyebrow="Dashboard"
        title="Welcome to"
        highlight="ARKXMotion Studio"
        desc="AI-powered creative content production platform. Generate videos, images, and more."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card variant="bordered" className="hover:glow-gold transition-all">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Generations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold gold-text">0</div>
            <p className="text-xs text-muted-foreground mt-1">Start creating today</p>
          </CardContent>
        </Card>

        <Card variant="bordered" className="hover:glow-gold transition-all">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold silver-text">0</div>
            <p className="text-xs text-muted-foreground mt-1">No projects yet</p>
          </CardContent>
        </Card>

        <Card variant="bordered" className="hover:glow-gold transition-all">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Assets Saved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold gold-text">0</div>
            <p className="text-xs text-muted-foreground mt-1">Images, videos, audio</p>
          </CardContent>
        </Card>

        <Card variant="bordered" className="hover:glow-gold transition-all">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Credits Used</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold silver-text">0</div>
            <p className="text-xs text-muted-foreground mt-1">This billing period</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card variant="bordered" className="hover:glow-gold transition-all">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg gold-gradient flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-black" />
              </div>
              <span className="gold-text">Quick Start</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { icon: <Video className="h-4 w-4" />, label: 'Motion Control', desc: 'Transfer character motion from video', href: '/generate/motion' },
                { icon: <Image className="h-4 w-4" />, label: 'Image to Video', desc: 'Animate any image with AI', href: '/generate/image-to-video' },
              ].map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary/30 hover:bg-primary/5 transition group"
                >
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:gold-gradient group-hover:text-black transition">
                    {item.icon}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-xs text-muted-foreground">{item.desc}</div>
                  </div>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card variant="bordered" className="hover:glow-gold transition-all">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg silver-gradient flex items-center justify-center">
                <Zap className="h-4 w-4 text-black" />
              </div>
              <span className="silver-text">AI Brain Briefing</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-muted-foreground">
              <Sparkles className="h-8 w-8 mx-auto mb-2 text-gold opacity-50" />
              <p className="text-sm">Connect your AI keys to get daily briefings</p>
              <p className="text-xs mt-1">Trending keywords, news, and opportunities</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContent>
  )
}
