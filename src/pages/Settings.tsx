import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, Select, Input } from '@/components/ui'
import { Shield, Square, Trash2, AlertTriangle, Loader2, Download, Upload } from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useProviderManager } from '@/stores/providerManager'
import {
  getActiveTasks,
  forceStopTask,
  forceStopAllTasks,
  clearResults,
  clearLogs,
  clearAllTasks,
  getResults,
  getLogs,
  type ActiveTask,
  type CompletedResult,
  type LogEntry,
} from '@/lib/backgroundTasks'
import { useToastStore } from '@/stores/toastStore'

export default function SettingsPage() {
  const [theme, setTheme] = useState('system')
  const [language, setLanguage] = useState('id')
  const [notifications, setNotifications] = useState(true)
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([])
  const [results, setResults] = useState<CompletedResult[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [stopping, setStopping] = useState<string | null>(null)
  const [stoppingAll, setStoppingAll] = useState(false)
  const addToast = useToastStore((s) => s.addToast)
  const authStore = useAuthStore()

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const providerManager = useProviderManager()

  const refresh = useCallback(() => {
    setActiveTasks(getActiveTasks())
    setResults(getResults())
    setLogs(getLogs())
  }, [])

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword || newPassword.length < 4) return
    setChangingPassword(true)
    try {
      const response = await fetch('/api/auth?path=change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authStore.token}` },
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
      })
      if (response.ok) {
        addToast('Password berhasil diubah', 'success')
        setOldPassword('')
        setNewPassword('')
      } else {
        const data = await response.json()
        addToast(data.error || 'Gagal mengubah password', 'error')
      }
    } catch {
      addToast('Gagal mengubah password', 'error')
    } finally {
      setChangingPassword(false)
    }
  }

  useEffect(() => {
    refresh()
    const handler = () => refresh()
    window.addEventListener('arkxmotion-tasks-changed', handler)
    const interval = setInterval(refresh, 3000)
    return () => {
      window.removeEventListener('arkxmotion-tasks-changed', handler)
      clearInterval(interval)
    }
  }, [refresh])

  const handleStopTask = async (taskId: string, model: string) => {
    setStopping(taskId)
    await new Promise((r) => setTimeout(r, 300))
    const stopped = forceStopTask(taskId)
    addToast(stopped ? `Task ${model} dihentikan` : `Task ${model} dihapus dari daftar`, stopped ? 'warning' : 'info')
    setStopping(null)
    refresh()
  }

  const handleStopAll = async () => {
    setStoppingAll(true)
    await new Promise((r) => setTimeout(r, 300))
    const count = forceStopAllTasks()
    addToast(`${count} task dihentikan paksa`, 'warning')
    setStoppingAll(false)
    refresh()
  }

  const handleClearResults = () => {
    clearResults()
    addToast('Semua hasil dihapus', 'info')
    refresh()
  }

  const handleClearLogs = () => {
    clearLogs()
    addToast('Semua log dihapus', 'info')
    refresh()
  }

  const handleClearAll = () => {
    forceStopAllTasks()
    clearAllTasks()
    addToast('Semua data proses dihapus', 'warning')
    refresh()
  }

  const handleExportKeys = () => {
    const data = {
      keys: providerManager.keys,
      routing: providerManager.routing,
      exportedAt: new Date().toISOString(),
      version: '1.0.0',
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `arkxmotion-keys-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    addToast('Provider keys berhasil di-export', 'success')
  }

  const handleImportKeys = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (data.keys) {
        Object.entries(data.keys).forEach(([provider, keys]) => {
          const keyArray = keys as Array<{ key: string; name?: string; status?: string }>
          keyArray.forEach((k) => {
            providerManager.addKey(provider as any, k.key, k.name)
          })
        })
      }
      if (data.routing) {
        Object.entries(data.routing).forEach(([workflow, provider]) => {
          providerManager.setRouting(workflow, provider as any)
        })
      }
      addToast(`Provider keys berhasil di-import`, 'success')
    } catch (err: any) {
      addToast(`Import gagal: ${err.message}`, 'error')
    }
    if (importRef.current) importRef.current.value = ''
  }

  const formatElapsed = (startedAt: number) => {
    const diff = Date.now() - startedAt
    const min = Math.floor(diff / 60000)
    const sec = Math.floor((diff % 60000) / 1000)
    return `${min}m ${sec}s`
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        highlight=""
        desc="Configure your ARKXMotion Studio preferences."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="🎨 Appearance">
          <div className="space-y-4">
            <div>
              <Label>Theme</Label>
              <Select
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'system', label: 'System' },
                ]}
              />
            </div>
            <div>
              <Label>Language</Label>
              <Select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                options={[
                  { value: 'id', label: 'Bahasa Indonesia' },
                  { value: 'en', label: 'English' },
                ]}
              />
            </div>
          </div>
        </Section>

        <Section title="🔔 Notifications">
          <div className="space-y-4">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <div className="text-sm font-medium">Push Notifications</div>
                <div className="text-xs text-muted-foreground">Get notified when generations complete</div>
              </div>
              <input
                type="checkbox"
                checked={notifications}
                onChange={(e) => setNotifications(e.target.checked)}
                className="h-4 w-4"
              />
            </label>
          </div>
        </Section>

        <Section title="🔐 Security">
          <div className="space-y-4">
            <div>
              <Label>API Keys Storage</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Keys are stored locally in your browser. Never shared with third parties.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={handleExportKeys}>
                <Download className="h-4 w-4" /> Export Keys
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => importRef.current?.click()}>
                <Upload className="h-4 w-4" /> Import Keys
              </Button>
              <input ref={importRef} type="file" accept=".json" hidden onChange={handleImportKeys} />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Export: Semua provider keys & routing settings → JSON file
            </p>
          </div>
        </Section>

        <Section title="🔑 Ganti Password">
          <div className="space-y-3">
            <div>
              <Label>Password Lama</Label>
              <Input
                type="password"
                placeholder="Masukkan password lama"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
              />
            </div>
            <div>
              <Label>Password Baru</Label>
              <Input
                type="password"
                placeholder="Masukkan password baru (min 4 karakter)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <Button
              onClick={handleChangePassword}
              disabled={!oldPassword || !newPassword || newPassword.length < 4 || changingPassword}
              loading={changingPassword}
            >
              <Shield className="h-4 w-4" /> Ganti Password
            </Button>
          </div>
        </Section>

        <Section title="ℹ️ About">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Version</span>
              <span className="font-mono">1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Build</span>
              <span className="font-mono">2026.07.24</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Framework</span>
              <span>React + Vite + TailwindCSS</span>
            </div>
          </div>
        </Section>
      </div>

      <Section
        title="🔧 Developer Tools — Task Manager"
        sub="Paksa hentikan proses generasi yang macet/ngambang"
        className="mt-5"
        right={
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleStopAll}
              disabled={stoppingAll || activeTasks.length === 0}
              loading={stoppingAll}
            >
              {!stoppingAll && <Square className="h-3.5 w-3.5" />}
              Stop All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearAll}
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear All
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {activeTasks.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              <div className="text-2xl mb-2">✅</div>
              Tidak ada proses yang sedang berjalan
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-amber-500 font-medium mb-2">
                <AlertTriangle className="h-3.5 w-3.5" />
                {activeTasks.length} proses aktif
              </div>
              {activeTasks.map((task) => (
                <div
                  key={task.taskId}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-background/50 hover:bg-accent/30 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500 shrink-0" />
                      <span className="text-sm font-medium truncate">{task.model}</span>
                      <span className="text-xs text-muted-foreground font-mono shrink-0">
                        {formatElapsed(task.startedAt)} ago
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-1">
                      {task.prompt.slice(0, 80)}{task.prompt.length > 80 ? '...' : ''}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-1 opacity-60">
                      ID: {task.taskId.slice(0, 30)}...
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleStopTask(task.taskId, task.model)}
                    disabled={stopping === task.taskId}
                    loading={stopping === task.taskId}
                    className="shrink-0"
                  >
                    {stopping !== task.taskId && <Square className="h-3.5 w-3.5" />}
                    End Task
                  </Button>
                </div>
              ))}
            </div>
          )}

          {results.length > 0 && (
            <div className="pt-3 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground font-medium">
                  {results.length} hasil tersimpan
                </span>
                <Button variant="ghost" size="sm" onClick={handleClearResults}>
                  <Trash2 className="h-3 w-3" /> Clear Results
                </Button>
              </div>
            </div>
          )}

          {logs.length > 0 && (
            <div className="pt-3 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground font-medium">
                  {logs.length} log entries
                </span>
                <Button variant="ghost" size="sm" onClick={handleClearLogs}>
                  <Trash2 className="h-3 w-3" /> Clear Logs
                </Button>
              </div>
              <div className="max-h-32 overflow-y-auto rounded-lg bg-background/50 border border-border p-2 space-y-0.5">
                {logs.slice(-15).reverse().map((log, i) => (
                  <div key={i} className="text-[10px] font-mono flex gap-2">
                    <span className="text-muted-foreground shrink-0">{log.time}</span>
                    <span className={log.level === 'error' ? 'text-red-500' : log.level === 'success' ? 'text-green-500' : 'text-muted-foreground'}>
                      {log.msg}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>
    </PageContent>
  )
}
