import { useState, useCallback, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import {
  Coins,
  RefreshCw,
  Save,
  Trash2,
  Download,
  CheckSquare,
  Filter,
  Edit3,
  X,
} from 'lucide-react'

interface Token {
  id: number
  provider: string
  name: string
  credits: number | null
  credit_group: string | null
  status: string
  created_at: string
}

interface Summary {
  provider: string
  total: number
  available: number
  total_credits: number
}

const PROVIDER_COLORS: Record<string, string> = {
  roboneo: 'bg-blue-500/10 text-blue-500',
  framia: 'bg-purple-500/10 text-purple-500',
  weavy: 'bg-green-500/10 text-green-500',
  createpulse: 'bg-orange-500/10 text-orange-500',
}

export default function AdminCreditManagement() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [summary, setSummary] = useState<Summary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [filterProvider, setFilterProvider] = useState('')
  const [bulkCredits, setBulkCredits] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editGroup, setEditGroup] = useState('')
  const token = useAuthStore((state) => state.token)
  const addToast = useToastStore((state) => state.addToast)

  const fetchData = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/credits', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setTokens(data.tokens || [])
        setSummary(data.summary || [])
      }
    } catch {
      addToast('Failed to fetch credits', 'error')
    } finally {
      setLoading(false)
    }
  }, [token, addToast])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-refresh when tab becomes visible or every 10s
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') fetchData() }
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(fetchData, 10000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(interval)
    }
  }, [fetchData])

  const providers = [...new Set(tokens.map(t => t.provider))].sort()
  const filtered = filterProvider ? tokens.filter(t => t.provider === filterProvider) : tokens
  const allSelected = filtered.length > 0 && filtered.every(t => selectedIds.has(t.id))

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map(t => t.id)))
  }

  const handleUpdateCredit = async (id: number, credits: number, creditGroup?: string) => {
    if (!token) return
    try {
      const body: any = { credits }
      if (creditGroup !== undefined) body.credit_group = creditGroup
      const res = await fetch(`/api/admin/credits/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message, 'success')
        fetchData()
      } else {
        addToast(data.error || 'Update failed', 'error')
      }
    } catch {
      addToast('Update failed', 'error')
    }
  }

  const handleBulkUpdate = async () => {
    if (selectedIds.size === 0 || !bulkCredits) return
    if (!confirm(`Set credits to ${bulkCredits} for ${selectedIds.size} token(s)?`)) return
    if (!token) return
    try {
      const res = await fetch('/api/admin/credits/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: Array.from(selectedIds), credits: Number(bulkCredits) }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message, 'success')
        setSelectedIds(new Set())
        setBulkCredits('')
        fetchData()
      } else {
        addToast(data.error || 'Bulk update failed', 'error')
      }
    } catch {
      addToast('Bulk update failed', 'error')
    }
  }

  const handleResetAll = async () => {
    if (!confirm('Reset ALL token credits to 0? This cannot be undone.')) return
    if (!token) return
    try {
      const res = await fetch('/api/admin/credits/reset', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok) {
        addToast(data.message, 'success')
        fetchData()
      } else {
        addToast(data.error || 'Reset failed', 'error')
      }
    } catch {
      addToast('Reset failed', 'error')
    }
  }

  const startEdit = (t: Token) => {
    setEditingId(t.id)
    setEditValue(t.credits?.toString() ?? '')
    setEditGroup(t.credit_group || '')
  }

  const saveEdit = () => {
    if (editingId === null) return
    handleUpdateCredit(editingId, Number(editValue) || 0, editGroup)
    setEditingId(null)
  }

  const totalCreditsAll = tokens.reduce((sum, t) => sum + (t.credits || 0), 0)
  const availableTokens = tokens.filter(t => t.status === 'available').length

  return (
    <div>
      <PageHeader
        title="Credit Management"
        desc="Manage API token credits, groups, and balances"
      />
      <PageContent>
        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground mb-1">Total Tokens</div>
            <div className="text-2xl font-bold">{tokens.length}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground mb-1">Available</div>
            <div className="text-2xl font-bold text-green-500">{availableTokens}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground mb-1">Total Credits</div>
            <div className="text-2xl font-bold text-yellow-500">{totalCreditsAll.toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground mb-1">Providers</div>
            <div className="text-2xl font-bold">{providers.length}</div>
          </div>
        </div>

        {/* Provider Summary */}
        {summary.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {summary.map(s => (
              <div key={s.provider} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${PROVIDER_COLORS[s.provider] || 'bg-secondary text-muted-foreground'}`}>
                {s.provider}: {s.total} tokens · {s.total_credits.toLocaleString()} credits
              </div>
            ))}
          </div>
        )}

        <Section title="Tokens" desc="View and manage credits for each API token">
          {/* Bulk Actions */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-primary/5 border border-primary/20">
              <span className="text-sm text-primary font-medium">{selectedIds.size} dipilih</span>
              <input
                type="number"
                value={bulkCredits}
                onChange={e => setBulkCredits(e.target.value)}
                placeholder="Credits"
                className="w-24 px-2 py-1 text-sm rounded border border-border bg-card"
              />
              <Button variant="outline" size="sm" onClick={handleBulkUpdate} disabled={!bulkCredits}>
                <Save className="h-3.5 w-3.5 mr-1" /> Set Credits
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Batal</Button>
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center gap-2 mb-4">
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <select
              value={filterProvider}
              onChange={e => setFilterProvider(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs"
            >
              <option value="">Semua Provider</option>
              {providers.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={() => window.open('/api/admin/credits/export', '_blank')}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleResetAll} className="text-destructive hover:bg-destructive/10 ml-auto">
              <Trash2 className="h-4 w-4 mr-1" /> Reset All
            </Button>
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No tokens found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-3 px-2 w-8">
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="rounded border-border cursor-pointer" />
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Provider</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Name</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Credits</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Group</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => (
                    <tr key={t.id} className="border-b border-border hover:bg-secondary/50">
                      <td className="py-3 px-2">
                        <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelect(t.id)} className="rounded border-border cursor-pointer" />
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PROVIDER_COLORS[t.provider] || 'bg-secondary text-muted-foreground'}`}>
                          {t.provider}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-medium">{t.name}</td>
                      <td className="py-3 px-4">
                        {editingId === t.id ? (
                          <input
                            type="number"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            className="w-24 px-2 py-1 text-sm rounded border border-primary bg-card"
                            autoFocus
                          />
                        ) : (
                          <span className={`font-mono ${t.credits === null ? 'text-muted-foreground' : t.credits === 0 ? 'text-red-500' : 'text-yellow-500'}`}>
                            {t.credits?.toLocaleString() ?? '—'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {editingId === t.id ? (
                          <input
                            type="text"
                            value={editGroup}
                            onChange={e => setEditGroup(e.target.value)}
                            placeholder="optional"
                            className="w-24 px-2 py-1 text-sm rounded border border-primary bg-card"
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">{t.credit_group || '—'}</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          t.status === 'available' ? 'bg-green-500/10 text-green-500' : 'bg-secondary text-muted-foreground'
                        }`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {editingId === t.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="outline" size="sm" onClick={saveEdit} className="text-green-500">
                              <Save className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => startEdit(t)}>
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </PageContent>
    </div>
  )
}
