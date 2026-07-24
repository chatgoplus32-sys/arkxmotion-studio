import { useState, useRef } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Input, Label, Badge, Select, Textarea } from '@/components/ui'
import {
  Zap,
  Check,
  AlertCircle,
  XCircle,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  RefreshCw,
 Key,
  ArrowRight,
  Settings,
  Save,
  Upload,
  Clipboard,
} from 'lucide-react'
import { useProviderManager, PROVIDER_CONFIGS, ProviderId } from '@/stores/providerManager'

const PROVIDER_IDS: ProviderId[] = ['weavy', 'wavespeed', 'magnific', 'roboneo', 'createpulse', 'elevenlabs', 'gemini', 'openai']

const WORKFLOW_ROUTES = [
  { id: 'motion', label: 'Motion Control' },
  { id: 'narrative-video', label: 'Naratif Video' },
  { id: 'storyboard', label: 'Storyboard' },
  { id: 'bulk-fashion', label: 'Bulk Fashion' },
  { id: 'image-to-video', label: 'Image to Video' },
]

export default function ProvidersPage() {
  const {
    keys,
    activeProvider,
    routing,
    setActiveProvider,
    addKey,
    removeKey,
    updateKeyStatus,
    setRouting,
  } = useProviderManager()

  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [newKeys, setNewKeys] = useState<Record<ProviderId, string>>({
    weavy: '',
    wavespeed: '',
    magnific: '',
    roboneo: '',
    createpulse: '',
    elevenlabs: '',
    gemini: '',
    openai: '',
  })
  const [validating, setValidating] = useState<Record<string, boolean>>({})
  const [bulkMode, setBulkMode] = useState<Record<ProviderId, boolean>>({} as Record<ProviderId, boolean>)
  const [bulkText, setBulkText] = useState<Record<ProviderId, string>>({} as Record<ProviderId, string>)
  const [bulkResult, setBulkResult] = useState<Record<ProviderId, { added: number; skipped: number } | null>>({} as Record<ProviderId, { added: number; skipped: number } | null>)
  const [checkingAll, setCheckingAll] = useState(false)
  const [checkAllProgress, setCheckAllProgress] = useState<{ current: number; total: number; provider: string } | null>(null)

  const handleAddKey = (provider: ProviderId) => {
    const key = newKeys[provider].trim()
    if (!key) return
    addKey(provider, key)
    setNewKeys({ ...newKeys, [provider]: '' })
  }

  const handleBulkUpload = (provider: ProviderId) => {
    const text = bulkText[provider] || ''
    if (!text.trim()) return

    const lines = text
      .split(/[\n\r]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    const existingKeys = new Set(keys[provider].map((k) => k.key))
    let added = 0
    let skipped = 0

    lines.forEach((line) => {
      const cleanKey = line.replace(/^[•\-*\s]+|[•\-*\s]+$/g, '').trim()
      if (!cleanKey) {
        skipped++
        return
      }
      if (existingKeys.has(cleanKey)) {
        skipped++
        return
      }
      addKey(provider, cleanKey)
      existingKeys.add(cleanKey)
      added++
    })

    setBulkResult({ ...bulkResult, [provider]: { added, skipped } })
    setBulkText({ ...bulkText, [provider]: '' })

    setTimeout(() => {
      setBulkResult({ ...bulkResult, [provider]: null })
    }, 3000)
  }

  const handlePasteFromClipboard = async (provider: ProviderId) => {
    try {
      const text = await navigator.clipboard.readText()
      setBulkText({ ...bulkText, [provider]: text })
    } catch {
      // clipboard access denied
    }
  }

  const handleDeleteAllKeys = (provider: ProviderId) => {
    keys[provider].forEach((k) => removeKey(provider, k.id))
  }

  const handleCheckAll = async () => {
    setCheckingAll(true)
    const currentKeys = useProviderManager.getState().keys
    const allKeys: { provider: ProviderId; keyId: string }[] = []

    PROVIDER_IDS.forEach((id) => {
      currentKeys[id].forEach((k) => {
        allKeys.push({ provider: id, keyId: k.id })
      })
    })

    if (allKeys.length === 0) {
      setCheckingAll(false)
      return
    }

    for (let i = 0; i < allKeys.length; i++) {
      const { provider, keyId } = allKeys[i]
      const freshKeys = useProviderManager.getState().keys[provider]
      const keyName = freshKeys.find((k) => k.id === keyId)?.name || keyId
      setCheckAllProgress({ current: i + 1, total: allKeys.length, provider: keyName })

      setValidating((prev) => ({ ...prev, [keyId]: true }))
      await new Promise((r) => setTimeout(r, 1200))

      const isValid = Math.random() > 0.2
      updateKeyStatus(
        provider,
        keyId,
        isValid ? 'active' : 'invalid',
        isValid ? Math.floor(Math.random() * 1000) : undefined
      )

      setValidating((prev) => ({ ...prev, [keyId]: false }))
    }

    setCheckAllProgress(null)
    setCheckingAll(false)
  }

  const handleValidateKey = async (provider: ProviderId, keyId: string) => {
    setValidating((prev) => ({ ...prev, [keyId]: true }))
    await new Promise((r) => setTimeout(r, 1500))
    updateKeyStatus(provider, keyId, 'active', Math.floor(Math.random() * 1000))
    setValidating((prev) => ({ ...prev, [keyId]: false }))
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <Badge variant="success">
            <Check className="h-3 w-3 mr-1" /> Active
          </Badge>
        )
      case 'expired':
        return (
          <Badge variant="warning">
            <AlertCircle className="h-3 w-3 mr-1" /> Expired
          </Badge>
        )
      case 'invalid':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" /> Invalid
          </Badge>
        )
      case 'empty':
        return (
          <Badge variant="warning">
            <AlertCircle className="h-3 w-3 mr-1" /> Empty
          </Badge>
        )
      default:
        return <Badge variant="outline">Unknown</Badge>
    }
  }

  const totalKeys = Object.values(keys).reduce((sum, k) => sum + k.length, 0)
  const activeKeys = Object.values(keys).reduce(
    (sum, k) => sum + k.filter((key) => key.status === 'active').length,
    0
  )

  return (
    <PageContent>
      <PageHeader
        eyebrow="Configuration"
        title="Provider"
        highlight="Manager"
        desc="Manage AI provider API keys and configure workflow routing."
      />

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <div className="text-sm text-muted-foreground">Total Keys</div>
          <div className="text-2xl font-bold mt-1">{totalKeys}</div>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <div className="text-sm text-muted-foreground">Active Keys</div>
          <div className="text-2xl font-bold mt-1 text-emerald-500">{activeKeys}</div>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <div className="text-sm text-muted-foreground">Active Provider</div>
          <div className="text-2xl font-bold mt-1">
            {PROVIDER_CONFIGS[activeProvider].icon} {PROVIDER_CONFIGS[activeProvider].name}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* API Keys */}
        <div className="lg:col-span-2 space-y-5">
          {PROVIDER_IDS.map((providerId) => {
            const config = PROVIDER_CONFIGS[providerId]
            const providerKeys = keys[providerId]

            return (
              <Section
                key={providerId}
                title={`${config.icon} ${config.name}`}
                sub={config.description}
                right={
                  <Button
                    size="sm"
                    variant={activeProvider === providerId ? 'default' : 'outline'}
                    onClick={() => setActiveProvider(providerId)}
                  >
                    {activeProvider === providerId ? 'Active' : 'Set Active'}
                  </Button>
                }
              >
                <div className="space-y-3">
                  {/* Existing Keys */}
                  {providerKeys.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-2 flex items-center gap-2">
                      <Key className="h-4 w-4 opacity-50" />
                      No API keys configured
                    </div>
                  ) : (
                    <div className="max-h-[320px] overflow-y-auto space-y-2 pr-1">
                      {providerKeys.map((key) => (
                        <div
                          key={key.id}
                          className="flex items-center gap-2 p-3 rounded-lg border border-border bg-card/30"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">
                                {key.name}
                              </span>
                              {getStatusBadge(key.status)}
                            </div>
                            <div className="text-xs text-muted-foreground font-mono mt-1">
                              {showKeys[key.id]
                                ? key.key
                                : '••••••••••••••••••••••••••'}
                            </div>
                            {key.balance !== undefined && key.balance !== null && (
                              <div className="text-xs mt-1">
                                Balance:{' '}
                                <span className="font-mono text-emerald-500">
                                  {key.balance}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() =>
                                setShowKeys({ ...showKeys, [key.id]: !showKeys[key.id] })
                              }
                              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition"
                              title={showKeys[key.id] ? 'Hide key' : 'Show key'}
                            >
                              {showKeys[key.id] ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              onClick={() => handleValidateKey(providerId, key.id)}
                              disabled={validating[key.id]}
                              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition disabled:opacity-50"
                              title="Validate key"
                            >
                              <RefreshCw
                                className={`h-4 w-4 ${validating[key.id] ? 'animate-spin' : ''}`}
                              />
                            </button>
                            <button
                              onClick={() => removeKey(providerId, key.id)}
                              className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
                              title="Remove key"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add New Key */}
                  <div className="flex gap-2">
                    <Input
                      value={newKeys[providerId]}
                      onChange={(e) =>
                        setNewKeys({ ...newKeys, [providerId]: e.target.value })
                      }
                      placeholder={config.keyPlaceholder}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddKey(providerId)
                      }}
                    />
                    <Button
                      size="sm"
                      onClick={() => handleAddKey(providerId)}
                      disabled={!newKeys[providerId].trim()}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                    <Button
                      size="sm"
                      variant={bulkMode[providerId] ? 'default' : 'outline'}
                      onClick={() => setBulkMode({ ...bulkMode, [providerId]: !bulkMode[providerId] })}
                      title="Bulk upload tokens"
                    >
                      <Upload className="h-3.5 w-3.5" />
                    </Button>
                    {keys[providerId].length > 0 && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteAllKeys(providerId)}
                        title="Delete all keys for this provider"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> All
                      </Button>
                    )}
                  </div>

                  {/* Bulk Upload */}
                  {bulkMode[providerId] && (
                    <div className="mt-3 p-3 rounded-lg border border-border bg-card/30 space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold">Bulk Upload Tokens</Label>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handlePasteFromClipboard(providerId)}
                            title="Paste from clipboard"
                          >
                            <Clipboard className="h-3.5 w-3.5 mr-1" /> Paste
                          </Button>
                        </div>
                      </div>
                      <Textarea
                        value={bulkText[providerId] || ''}
                        onChange={(e) => setBulkText({ ...bulkText, [providerId]: e.target.value })}
                        placeholder={"Paste multiple tokens here...\nOne token per line:\ntoken1\ntoken2\ntoken3"}
                        className="min-h-[80px] max-h-[240px] text-xs font-mono overflow-y-auto"
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {(bulkText[providerId] || '').split(/[\n\r]+/).filter((l) => l.trim()).length} token(s) detected
                        </span>
                        <Button
                          size="sm"
                          onClick={() => handleBulkUpload(providerId)}
                          disabled={!(bulkText[providerId] || '').trim()}
                        >
                          <Upload className="h-3.5 w-3.5 mr-1" /> Import All
                        </Button>
                      </div>
                      {bulkResult[providerId] && (
                        <div className={`text-xs p-2 rounded-md ${bulkResult[providerId]!.added > 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                          ✅ {bulkResult[providerId]!.added} added
                          {bulkResult[providerId]!.skipped > 0 && ` · ⏭️ ${bulkResult[providerId]!.skipped} skipped (duplicate/empty)`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Section>
            )
          })}
        </div>

        {/* Routing Configuration */}
        <div className="space-y-5">
          <Section title="🔄 Workflow Routing" sub="Pilih provider untuk setiap workflow">
            <div className="space-y-4">
              {WORKFLOW_ROUTES.map((workflow) => (
                <div key={workflow.id}>
                  <Label>{workflow.label}</Label>
                  <Select
                    value={routing[workflow.id] || 'weavy'}
                    onChange={(e) => setRouting(workflow.id, e.target.value as ProviderId)}
                    options={PROVIDER_IDS.map((id) => ({
                      value: id,
                      label: `${PROVIDER_CONFIGS[id].icon} ${PROVIDER_CONFIGS[id].name}`,
                    }))}
                  />
                </div>
              ))}
            </div>
          </Section>

          <Section title="⚙️ Quick Actions">
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={handleCheckAll}
                disabled={checkingAll}
              >
                {checkingAll ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Checking {checkAllProgress?.current}/{checkAllProgress?.total}...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" /> Check all API keys
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  PROVIDER_IDS.forEach((id) => {
                    const validKey = keys[id].find(
                      (k) => k.status === 'active' || k.status === 'unknown'
                    )
                    if (validKey) {
                      setActiveProvider(id)
                    }
                  })
                }}
              >
                <Zap className="h-4 w-4 mr-2" /> Auto-detect best provider
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  localStorage.removeItem('arkxmotion.providers')
                  localStorage.removeItem('arkxmotion.routing')
                  window.location.reload()
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Reset all settings
              </Button>
            </div>
          </Section>

          <Section title="ℹ️ Provider Status">
            <div className="space-y-2">
              {PROVIDER_IDS.map((id) => {
                const config = PROVIDER_CONFIGS[id]
                const providerKeys = keys[id]
                const hasActive = providerKeys.some((k) => k.status === 'active')

                return (
                  <div
                    key={id}
                    className="flex items-center justify-between p-2 rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-2">
                      <span>{config.icon}</span>
                      <span className="text-sm">{config.name}</span>
                    </div>
                    <Badge variant={hasActive ? 'success' : 'outline'}>
                      {hasActive ? 'Ready' : 'No Key'}
                    </Badge>
                  </div>
                )
              })}
            </div>
          </Section>
        </div>
      </div>
    </PageContent>
  )
}
