import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Input, EmptyState } from '@/components/ui'
import { Search, TrendingUp, Target, Users, Loader2 } from 'lucide-react'
import { useState } from 'react'

export default function ResearchPage() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<any>(null)

  const handleSearch = async () => {
    if (!query.trim()) return
    setLoading(true)
    await new Promise((r) => setTimeout(r, 2000))
    setResults({
      trending: [
        { keyword: 'AI Video Generator', volume: '12K', trend: '+45%' },
        { keyword: 'Motion Capture AI', volume: '8K', trend: '+32%' },
        { keyword: 'Faceless YouTube', volume: '15K', trend: '+28%' },
        { keyword: 'AI Content Creator', volume: '20K', trend: '+55%' },
        { keyword: 'Text to Image', volume: '18K', trend: '+40%' },
      ],
      gaps: [
        'AI-powered video editing tutorials',
        'Motion capture for indie creators',
        'Bulk content generation workflows',
      ],
      audience: [
        { segment: 'Content Creators', size: '2.5M', engagement: 'High' },
        { segment: 'Digital Marketers', size: '1.8M', engagement: 'Medium' },
        { segment: 'Small Business Owners', size: '3.2M', engagement: 'High' },
      ],
    })
    setLoading(false)
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Research"
        title="Creative"
        highlight="Research"
        desc="Trending topics, content gap analysis, and audience insights."
      />

      <Section title="🔍 Research Query">
        <div className="flex gap-2">
          <Input
            placeholder="Enter topic or keyword..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <Button onClick={handleSearch} loading={loading} disabled={!query.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </Button>
        </div>
      </Section>

      {results ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <Section title="📈 Trending Keywords">
            <div className="space-y-2">
              {results.trending.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-2 rounded-lg border border-border">
                  <div>
                    <div className="text-sm font-medium">{item.keyword}</div>
                    <div className="text-xs text-muted-foreground">{item.volume} searches</div>
                  </div>
                  <span className="text-xs text-emerald-500 font-medium">{item.trend}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="🎯 Content Gaps">
            <div className="space-y-2">
              {results.gaps.map((gap: string, i: number) => (
                <div key={i} className="p-2 rounded-lg border border-border">
                  <div className="text-sm">{gap}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="👥 Audience Insights">
            <div className="space-y-2">
              {results.audience.map((item: any, i: number) => (
                <div key={i} className="p-2 rounded-lg border border-border">
                  <div className="text-sm font-medium">{item.segment}</div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                    <span>Size: {item.size}</span>
                    <span>Engagement: {item.engagement}</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      ) : (
        <Section>
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="Start your research"
            description="Enter a topic or keyword to get trending insights, content gaps, and audience data"
          />
        </Section>
      )}
    </PageContent>
  )
}
