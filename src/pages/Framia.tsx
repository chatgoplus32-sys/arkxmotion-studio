import { useState, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Input, Label, Badge, Textarea } from '@/components/ui'
import { Video, Loader2, Play, Key } from 'lucide-react'
import { useProviderManager, ProviderId } from '@/stores/providerManager'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'

interface FramiaSkill {
  id: string
  name: string
  description?: string
  category?: string
  cover_url?: string
  cost?: number
}

interface FramiaTemplate {
  id: string
  name: string
  description?: string
  cover_url?: string
}

const FRAMIA_API = '/framia/video/api'

export default function FramiaPage() {
  const { keys } = useProviderManager()
  const [skills, setSkills] = useState<FramiaSkill[]>([])
  const [templates, setTemplates] = useState<FramiaTemplate[]>([])
  const [credits, setCredits] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'nodes' | 'recipes'>('nodes')
  const [selectedSkill, setSelectedSkill] = useState<FramiaSkill | null>(null)
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [results, setResults] = useState<string[]>([])

  const apiKey = keys.framia?.[0]?.key || ''

  const loadFramiaData = async () => {
    if (!apiKey) return
    setLoading(true)
    try {
      const headers = { Authorization: `Bearer ${apiKey}` }

      const [creditsRes, skillsRes, templatesRes] = await Promise.all([
        fetch(`${FRAMIA_API}/v1/user/credits`, { headers }),
        fetch(`${FRAMIA_API}/workflows/skills?user_invocable=true`, { headers }),
        fetch(`${FRAMIA_API}/template-categories?with_templates=true`, { headers }),
      ])

      if (creditsRes.ok) {
        const creditsData = await creditsRes.json()
        setCredits(creditsData.credits ?? creditsData.balance ?? null)
      }

      if (skillsRes.ok) {
        const skillsData = await skillsRes.json()
        setSkills(skillsData.skills || skillsData.data || [])
      }

      if (templatesRes.ok) {
        const templatesData = await templatesRes.json()
        const allTemplates = (templatesData.categories || []).flatMap((c: any) => c.templates || [])
        setTemplates(allTemplates)
      }
    } catch (err) {
      console.error('Failed to load Framia data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (apiKey) loadFramiaData()
  }, [apiKey])

  const handleRunSkill = async (skill: FramiaSkill) => {
    if (!apiKey) return
    setGenerating(true)
    setSelectedSkill(skill)
    try {
      const rotation = await withTokenRotation<string>(
        'framia',
        async (token) => {
          const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
          const res = await fetch(`${FRAMIA_API}/workflows/runs`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ skill_id: skill.id, prompt }),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.error || `HTTP ${res.status}`)
          }
          const data = await res.json()
          const runId = data.run_id || data.id
          if (!runId) throw new Error('No run ID returned')

          const pollHeaders = { Authorization: `Bearer ${token}` }
          for (let i = 0; i < 120; i++) {
            await new Promise(r => setTimeout(r, 3000))
            const pollRes = await fetch(`${FRAMIA_API}/workflows/runs/${runId}/nodes`, { headers: pollHeaders })
            if (!pollRes.ok) continue
            const pollData = await pollRes.json()
            const nodes = pollData.nodes || []
            const outputNode = nodes.find((n: any) => n.output_url || n.status === 'completed')
            if (outputNode?.output_url) {
              return outputNode.output_url
            }
            if (nodes.some((n: any) => n.status === 'failed')) {
              throw new Error('Workflow run failed')
            }
          }
          throw new Error('Timeout: generation took too long')
        },
        {
          onKeySwitch: (from, to, attempt) => {
            console.log(`[framia] Token invalid! Switching key #${attempt}: "${from.name}" → "${to.name}"`)
          },
          onError: (err, key) => {
            if (detectTokenError('framia', err)) {
              console.log(`[framia] Key "${key.name}" is invalid: ${err.message}`)
            }
          },
        }
      )

      if (rotation.ok && rotation.result) {
        setResults(prev => [rotation.result!, ...prev])
      }
    } catch (err) {
      console.error('Run failed:', err)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Generate"
        title="Framia"
        highlight="AI Workflows"
        desc="Run AI video and image workflows via Framia / Converge AI."
      />

      {!apiKey ? (
        <Section title="🔑 API Key Required">
          <div className="text-sm text-muted-foreground mb-3">
            Tambahkan Framia Bearer token di halaman Providers untuk menggunakan fitur ini.
          </div>
          <a href="/providers" className="text-primary hover:underline flex items-center gap-1 text-sm">
            <Key className="h-4 w-4" /> Buka Providers
          </a>
        </Section>
      ) : (
        <>
          <div className="flex items-center gap-4 mb-4 text-sm">
            <div>Credits: <b className="text-emerald-500">{credits ?? '...'}</b></div>
            <div>Skills: <b>{skills.length}</b></div>
            <div>Templates: <b>{templates.length}</b></div>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>

          <div className="flex gap-2 mb-4">
            <Button size="sm" variant={activeTab === 'nodes' ? 'default' : 'outline'} onClick={() => setActiveTab('nodes')}>
              Nodes ({skills.length})
            </Button>
            <Button size="sm" variant={activeTab === 'recipes' ? 'default' : 'outline'} onClick={() => setActiveTab('recipes')}>
              Recipes ({templates.length})
            </Button>
          </div>

          <Section title={activeTab === 'nodes' ? '🎯 Skills / Nodes' : '📋 Templates / Recipes'}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(activeTab === 'nodes' ? skills : templates).map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-xl border border-border bg-card/30 hover:border-primary/40 transition cursor-pointer"
                  onClick={() => setSelectedSkill(item as FramiaSkill)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Video className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{item.name}</span>
                  </div>
                  {item.description && (
                    <div className="text-xs text-muted-foreground line-clamp-2">{item.description}</div>
                  )}
                  {'cost' in item && item.cost != null && (
                    <div className="text-xs mt-1">Cost: <b>{String(item.cost)}</b> credits</div>
                  )}
                </div>
              ))}
              {(activeTab === 'nodes' ? skills : templates).length === 0 && !loading && (
                <div className="text-sm text-muted-foreground col-span-full py-8 text-center">
                  Tidak ada data. Pastikan API key valid.
                </div>
              )}
            </div>
          </Section>

          <Section title="🚀 Run">
            <div className="space-y-3">
              <div>
                <Label>Prompt</Label>
                <Textarea
                  rows={3}
                  placeholder="Deskripsikan yang ingin di-generate..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
              <Button
                onClick={() => selectedSkill && handleRunSkill(selectedSkill)}
                disabled={!selectedSkill || !prompt.trim() || generating}
              >
                {generating ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
                ) : (
                  <><Play className="h-4 w-4" /> Run {selectedSkill?.name || 'Skill'}</>
                )}
              </Button>
            </div>
          </Section>

          {results.length > 0 && (
            <Section title={`🎬 Results (${results.length})`}>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {results.map((url, i) => (
                  <div key={i} className="rounded-xl overflow-hidden border border-border bg-black/40">
                    <video src={url} controls playsInline className="w-full aspect-[9/16] object-cover bg-black" />
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </PageContent>
  )
}