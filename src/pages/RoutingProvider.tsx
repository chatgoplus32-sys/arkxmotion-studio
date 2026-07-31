import { useState, useMemo, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Button, Badge } from '@/components/ui'
import {
  useProviderManager,
  PROVIDER_CONFIGS,
  ProviderId,
} from '@/stores/providerManager'
import {
  Check,
  Settings,
  Save,
  RotateCcw,
  Image,
  Video,
  Mic,
  Wand2,
  Brain,
  Sparkles,
  Film,
  Palette,
  Volume2,
  ChevronDown,
  ChevronRight,
  Info,
  Activity,
  CheckCircle2,
  ArrowUpDown,
  Layers,
} from 'lucide-react'

interface WorkflowConfig {
  id: string
  name: string
  description: string
  category: 'image' | 'video' | 'voice' | 'motion' | 'ai'
  icon: React.ReactNode
  providers: ProviderId[]
  defaultProvider: ProviderId
  fallbackProviders?: ProviderId[]
}

const WORKFLOW_CONFIGS: WorkflowConfig[] = [
  {
    id: 'motion',
    name: 'Motion Control',
    description: 'Kontrol gerakan video dengan AI — Kling 2.6, Seedance',
    category: 'motion',
    icon: <Film className="h-4 w-4" />,
    providers: ['weavy', 'roboneo', 'leonardo'],
    defaultProvider: 'weavy',
    fallbackProviders: ['roboneo', 'leonardo'],
  },
  {
    id: 'narrative-video',
    name: 'Narrative Video',
    description: 'Video naratif otomatis dengan storyboard & voice-over',
    category: 'video',
    icon: <Video className="h-4 w-4" />,
    providers: ['weavy', 'roboneo', 'framia', 'createpulse'],
    defaultProvider: 'weavy',
    fallbackProviders: ['framia', 'createpulse'],
  },
  {
    id: 'storyboard',
    name: 'Storyboard',
    description: 'Generasi storyboard visual dari prompt teks',
    category: 'image',
    icon: <Layers className="h-4 w-4" />,
    providers: ['weavy', 'framia', 'leonardo'],
    defaultProvider: 'weavy',
    fallbackProviders: ['framia'],
  },
  {
    id: 'bulk-fashion',
    name: 'Bulk Fashion',
    description: 'Generate gambar fashion dalam jumlah besar',
    category: 'image',
    icon: <Palette className="h-4 w-4" />,
    providers: ['weavy', 'framia', 'leonardo'],
    defaultProvider: 'weavy',
    fallbackProviders: ['framia', 'leonardo'],
  },
  {
    id: 'image-to-video',
    name: 'Image to Video',
    description: 'Ubah gambar statis menjadi video bergerak',
    category: 'video',
    icon: <Video className="h-4 w-4" />,
    providers: ['weavy', 'roboneo', 'framia', 'createpulse', 'leonardo'],
    defaultProvider: 'weavy',
    fallbackProviders: ['roboneo', 'framia', 'createpulse'],
  },
  {
    id: 'text-to-image',
    name: 'Text to Image',
    description: 'Generasi gambar dari deskripsi teks',
    category: 'image',
    icon: <Image className="h-4 w-4" />,
    providers: ['weavy', 'framia', 'leonardo', 'wavespeed'],
    defaultProvider: 'weavy',
    fallbackProviders: ['framia', 'leonardo'],
  },
  {
    id: 'upscaler',
    name: 'Upscaler',
    description: 'Tingkatkan resolusi & kualitas gambar',
    category: 'image',
    icon: <Wand2 className="h-4 w-4" />,
    providers: ['magnific', 'leonardo', 'wavespeed'],
    defaultProvider: 'magnific',
    fallbackProviders: ['leonardo'],
  },
  {
    id: 'dubbing',
    name: 'Dubbing / Voice Over',
    description: 'Suara AI multibahasa untuk narasi video',
    category: 'voice',
    icon: <Mic className="h-4 w-4" />,
    providers: ['elevenlabs'],
    defaultProvider: 'elevenlabs',
  },
  {
    id: 'ai-influencer',
    name: 'AI Influencer',
    description: 'Konten influencer AI — script, visual, voice',
    category: 'ai',
    icon: <Sparkles className="h-4 w-4" />,
    providers: ['gemini', 'openai'],
    defaultProvider: 'gemini',
    fallbackProviders: ['openai'],
  },
  {
    id: 'render',
    name: 'Cloud Render',
    description: 'Render video besar via cloud (fallback untuk file >400MB)',
    category: 'video',
    icon: <Activity className="h-4 w-4" />,
    providers: ['shotstack', 'creatomate'],
    defaultProvider: 'shotstack',
    fallbackProviders: ['creatomate'],
  },
]

const CATEGORY_CONFIG = {
  image: {
    label: 'Image',
    icon: <Image className="h-4 w-4" />,
    color: '#facc15',
    description: 'Generasi & manipulasi gambar',
  },
  video: {
    label: 'Video',
    icon: <Video className="h-4 w-4" />,
    color: '#22d3ee',
    description: 'Pembuatan & editing video',
  },
  voice: {
    label: 'Voice',
    icon: <Volume2 className="h-4 w-4" />,
    color: '#818cf8',
    description: 'Suara AI & text-to-speech',
  },
  motion: {
    label: 'Motion',
    icon: <Film className="h-4 w-4" />,
    color: '#f472b6',
    description: 'Kontrol gerakan video',
  },
  ai: {
    label: 'AI Brain',
    icon: <Brain className="h-4 w-4" />,
    color: '#34d399',
    description: 'Kecerdasan buatan & konten',
  },
}

const PROVIDER_ICONS: Record<string, string> = {
  weavy: '🌊',
  wavespeed: '⚡',
  magnific: '✨',
  roboneo: '🤖',
  createpulse: '💜',
  framia: '🎬',
  firefly: '🔥',
  leonardo: '🎨',
  elevenlabs: '🎙️',
  gemini: '💎',
  openai: '🤖',
  shotstack: '🎬',
  creatomate: '🎥',
}

const PROVIDER_COLORS: Record<string, string> = {
  weavy: '#22d3ee',
  wavespeed: '#38bdf8',
  magnific: '#a78bfa',
  roboneo: '#34d399',
  createpulse: '#c084fc',
  framia: '#fb923c',
  firefly: '#f97316',
  leonardo: '#facc15',
  elevenlabs: '#818cf8',
  gemini: '#f472b6',
  openai: '#10b981',
  shotstack: '#94a3b8',
  creatomate: '#f43f5e',
}

export default function RoutingProviderPage() {
  const { keys, routing, setRouting } = useProviderManager()

  const [expandedCategory, setExpandedCategory] = useState<string | null>('image')
  const [editingWorkflow, setEditingWorkflow] = useState<string | null>(null)
  const [tempRouting, setTempRouting] = useState<Record<string, ProviderId>>({})
  const [showSaveConfirm, setShowSaveConfirm] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const currentRouting = useMemo(() => {
    const r = { ...routing }
    Object.keys(tempRouting).forEach((k) => {
      r[k] = tempRouting[k]
    })
    return r
  }, [routing, tempRouting])

  const groupedWorkflows = useMemo(() => {
    const groups: Record<string, WorkflowConfig[]> = {
      image: [],
      video: [],
      voice: [],
      motion: [],
      ai: [],
    }
    WORKFLOW_CONFIGS.forEach((wf) => {
      groups[wf.category].push(wf)
    })
    return groups
  }, [])

  const getProviderKeyCount = useCallback(
    (providerId: ProviderId) => {
      return keys[providerId]?.length || 0
    },
    [keys]
  )

  const getProviderStatus = useCallback(
    (providerId: ProviderId): 'active' | 'limited' | 'no-keys' | 'unknown' => {
      const providerKeys = keys[providerId] || []
      if (providerKeys.length === 0) return 'no-keys'
      const activeKey = providerKeys.find((k) => k.status === 'active')
      if (activeKey) return 'active'
      const emptyKey = providerKeys.find((k) => k.status === 'empty')
      if (emptyKey) return 'limited'
      return 'unknown'
    },
    [keys]
  )

  const handleProviderChange = useCallback(
    (workflowId: string, providerId: ProviderId) => {
      setTempRouting((prev) => ({
        ...prev,
        [workflowId]: providerId,
      }))
      setEditingWorkflow(null)
    },
    []
  )

  const handleSave = useCallback(() => {
    Object.entries(tempRouting).forEach(([workflowId, providerId]) => {
      setRouting(workflowId, providerId)
    })
    setTempRouting({})
    setShowSaveConfirm(false)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)
  }, [tempRouting, setRouting])

  const handleReset = useCallback(() => {
    WORKFLOW_CONFIGS.forEach((wf) => {
      setRouting(wf.id, wf.defaultProvider)
    })
    setTempRouting({})
    setShowResetConfirm(false)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)
  }, [setRouting])

  const handleSetAllToProvider = useCallback(
    (providerId: ProviderId) => {
      const newRouting: Record<string, ProviderId> = {}
      WORKFLOW_CONFIGS.forEach((wf) => {
        if (wf.providers.includes(providerId)) {
          newRouting[wf.id] = providerId
        }
      })
      setTempRouting(newRouting)
    },
    []
  )

  const hasChanges = Object.keys(tempRouting).length > 0

  return (
    <PageContent>
      <PageHeader
        eyebrow="Manage"
        title="Routing"
        highlight="Provider"
        desc="Konfigurasi provider mana yang menangani setiap workflow. Atur prioritas, fallback, dan optimalkan penggunaan API key."
      />

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {Object.entries(CATEGORY_CONFIG).map(([key, config]) => {
          const categoryWorkflows = groupedWorkflows[key] || []
          const activeCount = categoryWorkflows.filter(
            (wf) => getProviderStatus(currentRouting[wf.id] || wf.defaultProvider) === 'active'
          ).length
          return (
            <div
              key={key}
              className="neumorph p-3 flex items-center gap-3 cursor-pointer hover:border-[#d4a017]/30 transition-colors"
              onClick={() => setExpandedCategory(expandedCategory === key ? null : key)}
            >
              <div
                className="h-9 w-9 rounded-lg grid place-items-center shrink-0"
                style={{ background: `${config.color}15`, color: config.color }}
              >
                {config.icon}
              </div>
              <div className="min-w-0">
                <div className="text-xs text-[#a0a0a0]">{config.label}</div>
                <div className="text-sm font-semibold text-[#f5f5f5]">
                  {activeCount}/{categoryWorkflows.length} active
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Button
          onClick={() => setShowSaveConfirm(true)}
          disabled={!hasChanges}
          className="gold-gradient text-[#0a0a0a] hover:opacity-90"
        >
          <Save className="h-3.5 w-3.5" />
          Simpan Perubahan
          {hasChanges && (
            <Badge className="ml-1 bg-[#0a0a0a]/20 text-[#0a0a0a] text-[10px]">
              {Object.keys(tempRouting).length}
            </Badge>
          )}
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowResetConfirm(true)}
          className="border-[#2a2a2a] bg-[#1a1a1a] text-[#f5f5f5] hover:bg-[#2a2a2a] hover:border-[#d4a017]/50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset Default
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-[#a0a0a0]">Quick set all ke:</span>
          {['weavy', 'roboneo', 'framia', 'leonardo'].map((pid) => (
            <button
              key={pid}
              onClick={() => handleSetAllToProvider(pid as ProviderId)}
              className="inline-flex items-center gap-1 rounded-full border border-[#2a2a2a] bg-[#141414] px-2 py-1 text-[10px] text-[#a0a0a0] hover:border-[#d4a017]/50 hover:text-[#f5f5f5] transition"
              title={`Set semua workflow ke ${PROVIDER_CONFIGS[pid as ProviderId].name}`}
            >
              <span>{PROVIDER_ICONS[pid]}</span>
              {PROVIDER_CONFIGS[pid as ProviderId].name}
            </button>
          ))}
        </div>
      </div>

      {/* Success Toast */}
      {saveSuccess && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center gap-2 animate-in fade-in duration-200">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span className="text-sm text-emerald-300">Routing berhasil disimpan!</span>
        </div>
      )}

      {/* Workflow Categories */}
      <div className="space-y-4">
        {Object.entries(CATEGORY_CONFIG).map(([categoryKey, categoryConfig]) => {
          const workflows = groupedWorkflows[categoryKey] || []
          if (workflows.length === 0) return null
          const isExpanded = expandedCategory === categoryKey

          return (
            <div key={categoryKey} className="neumorph overflow-hidden">
              {/* Category Header */}
              <button
                type="button"
                onClick={() => setExpandedCategory(isExpanded ? null : categoryKey)}
                className="w-full flex items-center gap-3 p-4 hover:bg-[#141414] transition-colors"
              >
                <div
                  className="h-8 w-8 rounded-lg grid place-items-center shrink-0"
                  style={{ background: `${categoryConfig.color}15`, color: categoryConfig.color }}
                >
                  {categoryConfig.icon}
                </div>
                <div className="flex-1 text-left">
                  <div className="text-sm font-semibold text-[#f5f5f5]">{categoryConfig.label}</div>
                  <div className="text-[11px] text-[#a0a0a0]">{categoryConfig.description}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-[#1a1a1a] text-[#a0a0a0] border-[#2a2a2a] text-[10px]">
                    {workflows.length} workflows
                  </Badge>
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-[#a0a0a0]" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-[#a0a0a0]" />
                  )}
                </div>
              </button>

              {/* Workflow List */}
              {isExpanded && (
                <div className="border-t border-[#2a2a2a] divide-y divide-[#2a2a2a]">
                  {workflows.map((workflow) => {
                    const activeProviderId = currentRouting[workflow.id] || workflow.defaultProvider
                    const activeProvider = PROVIDER_CONFIGS[activeProviderId]
                    const providerStatus = getProviderStatus(activeProviderId)
                    const keyCount = getProviderKeyCount(activeProviderId)
                    const isEditing = editingWorkflow === workflow.id
                    const isChanged = tempRouting[workflow.id] !== undefined

                    return (
                      <div key={workflow.id} className="p-4 hover:bg-[#0f0f0f] transition-colors">
                        <div className="flex items-start gap-4">
                          {/* Workflow Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[#f5f5f5]">{workflow.icon}</span>
                              <span className="text-sm font-medium text-[#f5f5f5]">{workflow.name}</span>
                              {isChanged && (
                                <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[9px]">
                                  changed
                                </Badge>
                              )}
                            </div>
                            <p className="text-[11px] text-[#a0a0a0] mt-0.5">{workflow.description}</p>
                          </div>

                          {/* Current Provider */}
                          <div className="flex items-center gap-2">
                            <div className="text-right">
                              <div className="text-[10px] text-[#a0a0a0]">Active Provider</div>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="text-xs font-semibold"
                                  style={{ color: PROVIDER_COLORS[activeProviderId] }}
                                >
                                  {PROVIDER_ICONS[activeProviderId]} {activeProvider?.name}
                                </span>
                                {providerStatus === 'active' && (
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                )}
                                {providerStatus === 'no-keys' && (
                                  <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                                )}
                              </div>
                            </div>

                            <button
                              onClick={() => setEditingWorkflow(isEditing ? null : workflow.id)}
                              className="h-8 w-8 rounded-lg grid place-items-center border border-[#2a2a2a] bg-[#141414] text-[#a0a0a0] hover:text-[#f5f5f5] hover:border-[#d4a017]/50 transition"
                              title="Ganti provider"
                            >
                              <Settings className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Provider Selector */}
                        {isEditing && (
                          <div className="mt-3 ml-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {workflow.providers.map((pid) => {
                              const config = PROVIDER_CONFIGS[pid]
                              const status = getProviderStatus(pid)
                              const pkCount = getProviderKeyCount(pid)
                              const isSelected = pid === activeProviderId

                              return (
                                <button
                                  key={pid}
                                  onClick={() => handleProviderChange(workflow.id, pid)}
                                  className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                                    isSelected
                                      ? 'border-[#d4a017] bg-[#d4a017]/10 shadow-[0_0_12px_rgba(212,160,23,0.2)]'
                                      : 'border-[#2a2a2a] bg-[#141414] hover:border-[#444]'
                                  }`}
                                >
                                  <span className="text-lg">{PROVIDER_ICONS[pid]}</span>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className="text-xs font-semibold"
                                        style={{ color: PROVIDER_COLORS[pid] }}
                                      >
                                        {config.name}
                                      </span>
                                      {isSelected && <Check className="h-3 w-3 text-[#d4a017]" />}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      <span className="text-[10px] text-[#a0a0a0]">
                                        {pkCount} key{pkCount !== 1 ? 's' : ''}
                                      </span>
                                      {status === 'active' && (
                                        <span className="text-[9px] text-emerald-400">● active</span>
                                      )}
                                      {status === 'no-keys' && (
                                        <span className="text-[9px] text-rose-400">● no keys</span>
                                      )}
                                      {status === 'limited' && (
                                        <span className="text-[9px] text-amber-400">● limited</span>
                                      )}
                                    </div>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        )}

                        {/* Fallback Info */}
                        {workflow.fallbackProviders && workflow.fallbackProviders.length > 0 && !isEditing && (
                          <div className="mt-2 ml-6 flex items-center gap-1.5 text-[10px] text-[#a0a0a0]">
                            <ArrowUpDown className="h-3 w-3" />
                            <span>Fallback:</span>
                            {workflow.fallbackProviders.map((fp, i) => (
                              <span key={fp}>
                                <span style={{ color: PROVIDER_COLORS[fp] }}>
                                  {PROVIDER_ICONS[fp]} {PROVIDER_CONFIGS[fp].name}
                                </span>
                                {i < (workflow.fallbackProviders?.length || 0) - 1 && (
                                  <span className="mx-1">→</span>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Provider Summary */}
      <div className="mt-6 neumorph p-4">
        <div className="flex items-center gap-2 mb-3">
          <Info className="h-4 w-4 text-[#d4a017]" />
          <span className="text-sm font-semibold text-[#f5f5f5]">Ringkasan Penggunaan Provider</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {Object.entries(PROVIDER_CONFIGS).map(([pid, config]) => {
            const usageCount = WORKFLOW_CONFIGS.filter(
              (wf) => (currentRouting[wf.id] || wf.defaultProvider) === pid
            ).length
            if (usageCount === 0) return null
            const status = getProviderStatus(pid as ProviderId)
            const pkCount = getProviderKeyCount(pid as ProviderId)

            return (
              <div
                key={pid}
                className="flex items-center gap-2 rounded-lg border border-[#2a2a2a] bg-[#141414] p-2"
              >
                <span className="text-sm">{PROVIDER_ICONS[pid]}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium text-[#f5f5f5] truncate">{config.name}</div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-[#a0a0a0]">
                      {usageCount} workflow{usageCount !== 1 ? 's' : ''}
                    </span>
                    <span className="text-[10px] text-[#a0a0a0]">·</span>
                    <span className="text-[10px] text-[#a0a0a0]">
                      {pkCount} key{pkCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                {status === 'active' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />}
                {status === 'no-keys' && <span className="h-1.5 w-1.5 rounded-full bg-rose-400 shrink-0" />}
              </div>
            )
          })}
        </div>
      </div>

      {/* Save Confirmation Modal */}
      {showSaveConfirm && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={() => setShowSaveConfirm(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="neumorph w-full max-w-md p-6 relative animate-in zoom-in-95 duration-200"
            style={{ background: '#0a0a0a' }}
          >
            <div className="flex items-center gap-2.5 mb-4">
              <div className="h-9 w-9 rounded-full grid place-items-center shrink-0 gold-gradient">
                <Save className="h-5 w-5 text-[#0a0a0a]" />
              </div>
              <div className="font-display text-lg text-[#f5f5f5] gold-text">Simpan Routing</div>
            </div>
            <p className="text-sm text-[#a0a0a0] mb-4">
              Simpan {Object.keys(tempRouting).length} perubahan routing provider?
            </p>
            <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] divide-y divide-[#2a2a2a] max-h-48 overflow-y-auto">
              {Object.entries(tempRouting).map(([wfId, pid]) => {
                const wf = WORKFLOW_CONFIGS.find((w) => w.id === wfId)
                return (
                  <div key={wfId} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                    <span className="text-[#a0a0a0]">{wf?.name}</span>
                    <span className="flex items-center gap-1 text-[#f5f5f5]">
                      <span style={{ color: PROVIDER_COLORS[pid] }}>
                        {PROVIDER_ICONS[pid]} {PROVIDER_CONFIGS[pid].name}
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowSaveConfirm(false)}
                className="border-[#2a2a2a] bg-[#1a1a1a] text-[#f5f5f5]"
              >
                Batal
              </Button>
              <Button onClick={handleSave} className="gold-gradient text-[#0a0a0a]">
                <Check className="h-3.5 w-3.5" /> Simpan
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={() => setShowResetConfirm(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="neumorph w-full max-w-md p-6 relative animate-in zoom-in-95 duration-200"
            style={{ background: '#0a0a0a' }}
          >
            <div className="flex items-center gap-2.5 mb-4">
              <div className="h-9 w-9 rounded-full grid place-items-center shrink-0 bg-rose-500/20">
                <RotateCcw className="h-5 w-5 text-rose-400" />
              </div>
              <div className="font-display text-lg text-[#f5f5f5] text-rose-400">Reset ke Default</div>
            </div>
            <p className="text-sm text-[#a0a0a0] mb-4">
              Semua routing akan dikembalikan ke pengaturan default. Yakin?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowResetConfirm(false)}
                className="border-[#2a2a2a] bg-[#1a1a1a] text-[#f5f5f5]"
              >
                Batal
              </Button>
              <Button
                onClick={handleReset}
                className="bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageContent>
  )
}
