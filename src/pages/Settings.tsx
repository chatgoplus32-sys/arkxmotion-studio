import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, Select, Input } from '@/components/ui'
import { Shield, Square, Trash2, AlertTriangle, Loader2, Download, Upload, Video, Clock3, Zap, X } from 'lucide-react'
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
import { logAudit, getAuditLog, clearAuditLog } from '@/lib/auditLog'

export default function SettingsPage() {
  const [theme, setTheme] = useState('system')
  const [language, setLanguage] = useState('id')
  const [notifications, setNotifications] = useState(true)
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([])
  const [results, setResults] = useState<CompletedResult[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [stopping, setStopping] = useState<string | null>(null)
  const [stoppingAll, setStoppingAll] = useState(false)
  const [confirmTask, setConfirmTask] = useState<ActiveTask | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const [now, setNow] = useState(Date.now())
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
        logAudit('CHANGE_PASSWORD', 'Password changed successfully', 'success')
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
    const tick = setInterval(()=> setNow(Date.now()), 1000)
    return () => {
      window.removeEventListener('arkxmotion-tasks-changed', handler)
      clearInterval(interval)
      clearInterval(tick)
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
    logAudit('EXPORT_KEYS', 'Provider keys exported to JSON', 'success')
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
      logAudit('IMPORT_KEYS', 'Provider keys imported from JSON', 'success')
    } catch (err: any) {
      addToast(`Import gagal: ${err.message}`, 'error')
    }
    if (importRef.current) importRef.current.value = ''
  }

  const formatElapsed = (startedAt: number) => {
    const diff = now - startedAt
    const min = Math.floor(diff / 60000)
    const sec = Math.floor((diff % 60000) / 1000)
    return `${min}m ${sec}s`
  }
  const pageIcon = (page: string) => page==='motion' ? <Video className="h-3.5 w-3.5" /> : page==='image-to-video' ? <Zap className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />

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
            <p className="text-[12px] text-muted-foreground">
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
        sub="Paksa hentikan proses generasi yang macet/ngambang — swipe, confirm, live timer"
        className="mt-5"
        right={
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={()=> setConfirmAll(true)}
              disabled={stoppingAll || activeTasks.length === 0}
            >
              <Square className="h-3.5 w-3.5" />
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
            <div className="text-center py-10">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 grid place-items-center mx-auto"><span className="text-emerald-400">✓</span></div>
              <p className="text-sm font-medium mt-3">Tidak ada proses aktif</p>
              <p className="text-xs text-muted-foreground mt-1">Semua task selesai atau dihentikan</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-mono px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" /> {activeTasks.length} LIVE
                </div>
                <span className="text-[11px] text-muted-foreground">auto-refresh 3s • live timer 1s</span>
              </div>
              {activeTasks.map((task) => (
                <div
                  key={task.taskId}
                  className="group flex items-center justify-between gap-3 p-3.5 rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.04] to-white/[0.01] hover:border-amber-500/20 hover:from-amber-500/5 hover:to-transparent hover:-translate-y-0.5 transition-all"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="h-7 w-7 rounded-xl bg-amber-500/15 border border-amber-500/20 grid place-items-center text-amber-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /></span>
                      <span className="text-sm font-semibold truncate">{task.model}</span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/50">{pageIcon(task.page)} {task.page}</span>
                      <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/40">
                        {formatElapsed(task.startedAt)} ago
                      </span>
                    </div>
                    <div className="text-xs text-white/40 truncate mt-1.5 pl-9">
                      {task.prompt.slice(0, 90)}{task.prompt.length > 90 ? '...' : ''}
                    </div>
                    <div className="text-[11px] font-mono text-white/25 mt-1 pl-9 truncate">
                      {task.taskId.slice(0, 36)}...
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setConfirmTask(task)}
                    disabled={stopping === task.taskId}
                    className="shrink-0 rounded-xl"
                  >
                    <Square className="h-3.5 w-3.5" />
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
                  <div key={i} className="text-[12px] font-mono flex gap-2">
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

      {confirmTask && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={()=>setConfirmTask(null)}>
          <div onClick={e=>e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#141414] p-5 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
            <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/20 grid place-items-center text-red-400 mx-auto"><AlertTriangle className="h-5 w-5" /></div>
            <h3 className="text-center font-bold mt-3">Hentikan task?</h3>
            <p className="text-center text-sm text-white/50 mt-1 truncate">{confirmTask.model} • {confirmTask.taskId.slice(0,28)}...</p>
            <p className="text-center text-xs text-white/30 mt-1">Polling akan di-abort & task dihapus dari daftar.</p>
            <div className="flex gap-2 mt-5">
              <Button variant="outline" className="flex-1" onClick={()=>setConfirmTask(null)}><X className="h-4 w-4" /> Batal</Button>
              <Button variant="destructive" className="flex-1" loading={stopping===confirmTask.taskId} onClick={async()=>{ const t=confirmTask; setConfirmTask(null); await handleStopTask(t.taskId, t.model)}}><Square className="h-4 w-4" /> End Task</Button>
            </div>
          </div>
        </div>
      )}
      {confirmAll && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={()=>setConfirmAll(false)}>
          <div onClick={e=>e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#141414] p-5">
            <h3 className="font-bold text-center">Hentikan semua {activeTasks.length} task?</h3>
            <p className="text-center text-sm text-white/50 mt-1">Semua polling akan di-abort.</p>
            <div className="flex gap-2 mt-5">
              <Button variant="outline" className="flex-1" onClick={()=>setConfirmAll(false)}>Batal</Button>
              <Button variant="destructive" className="flex-1" loading={stoppingAll} onClick={async()=>{ setConfirmAll(false); await handleStopAll()}}>Stop All</Button>
            </div>
          </div>
        </div>
      )}

      {/* Audit Log */}
      <Section
        title="📋 Audit Log"
        sub="Riwayat aktivitas penting"
        className="mt-5"
        right={
          <Button variant="outline" size="sm" onClick={() => { clearAuditLog(); addToast('Audit log dihapus', 'info') }}>
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </Button>
        }
      >
        {(() => {
          const auditLog = getAuditLog()
          if (auditLog.length === 0) {
            return (
              <div className="text-center py-6 text-muted-foreground text-sm">
                <div className="text-2xl mb-2">📋</div>
                Belum ada audit log
              </div>
            )
          }
          return (
            <div className="max-h-64 overflow-y-auto rounded-lg bg-background/50 border border-border p-2 space-y-1">
              {auditLog.slice(0, 50).map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 text-[11px] font-mono py-1 border-b border-border/30 last:border-0">
                  <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                    entry.level === 'success' ? 'bg-green-500' :
                    entry.level === 'error' ? 'bg-red-500' :
                    entry.level === 'warn' ? 'bg-yellow-500' :
                    'bg-blue-500'
                  }`} />
                  <span className="text-muted-foreground shrink-0 w-20">{new Date(entry.timestamp).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  <span className="shrink-0 font-semibold text-foreground/80 w-24 truncate">{entry.action}</span>
                  <span className="text-muted-foreground truncate flex-1">{entry.detail}</span>
                </div>
              ))}
            </div>
          )
        })()}
      </Section>
    </PageContent>
  )
}
