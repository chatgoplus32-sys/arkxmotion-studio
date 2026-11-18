import { useState, useRef, useEffect } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Label, EmptyState } from '@/components/ui'
import RunninghubPriceNote from '@/components/RunninghubPriceNote'
import { LogDetailActions } from '@/components/ui/LogDetailActions'
import {
  Loader2, Download, Sparkles, CheckCircle2, AlertCircle, Clock, Bot, Plus, Trash2, FileUp, Copy, ExternalLink, Terminal,
} from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import { submitCustomAiApp, pollRunningHubTask, queryRunningHubTaskFull, type CustomAiAppNode, type RunningHubQueryResultItem } from '@/lib/runninghub'
import { withTokenRotation, detectTokenError } from '@/lib/tokenRotation'
import { persistResultToR2, addResult, startGenerationTask, removeActiveTask } from '@/lib/backgroundTasks'
import { useRunninghubServerReady } from '@/lib/runninghubWallet'

const MAX_JSON_PASTE = 1024 * 1024
const MAX_FILE_ATTACH = 30 * 1024 * 1024 // 30 MB — batas body JSON relay (50 MB)
const DOCS_URL = 'https://www.runninghub.ai/openapi-docs'

interface NodeRow {
  key: string
  nodeId: string
  fieldName: string
  fieldValue: string
  description: string
}

interface LogEntry {
  time: string
  msg: string
  level: 'info' | 'warn' | 'error' | 'success'
}

interface ResultItem extends RunningHubQueryResultItem {
  key: string
}

function getStoredProviderKey(provider: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('arkxmotion.providers')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const keys = parsed[provider] || []
    const active = keys.find((k: any) => k.status === 'active' || k.status === 'unknown')
    return active?.key || keys[0]?.key || null
  } catch { return null }
}

const emptyRow = (): NodeRow => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, nodeId: '', fieldName: '', fieldValue: '', description: '' })

/** Preset contoh resmi dari dokumentasi OpenAPI v2 (ai-detail 2116538467715293186). */
const PRESET_DOCS_EXAMPLE: NodeRow[] = [
  { key: 'p1', nodeId: '209', fieldName: 'image', fieldValue: 'https://.../894caa7bc3d46602797912c88c2ce256532120ee128d19a4cccd86859f9f0c4d.png', description: '' },
  { key: 'p2', nodeId: '215', fieldName: 'audio', fieldValue: 'https://.../b1e751dc5b336ccd6d609cbf85e4006f80e80c801cc6ec6b3e4c9fb15f1bfe78.MP3', description: '' },
  { key: 'p3', nodeId: '248', fieldName: 'text', fieldValue: 'Describe the characters and background in detail. Do not describe poses, movements, or actions performed by characters or objects. Then describe any dialogue or singing. Provide the output directly, with a maximum of 200 words.', description: '' },
  { key: 'p4', nodeId: '214', fieldName: 'value', fieldValue: 'The character in Image 1 faces the camera and opens their mouth to speak or sing.', description: '' },
]
const PRESET_DOCS_APP_ID = '2116538467715293186'

export default function CustomAiAppPage() {
  const addToast = useToastStore((s) => s.addToast)

  const [appId, setAppId] = useState('')
  const [rows, setRows] = useState<NodeRow[]>([emptyRow()])
  const [instanceType, setInstanceType] = useState<'default' | 'plus' | 'ultra'>('default')
  const [usePersonalQueue, setUsePersonalQueue] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [retainSeconds, setRetainSeconds] = useState('')
  const [jsonPaste, setJsonPaste] = useState('')
  const [jsonOpen, setJsonOpen] = useState(false)

  const [loading, setLoading] = useState(false)
  const [taskStatus, setTaskStatus] = useState<'idle' | 'submitting' | 'running' | 'success' | 'error'>('idle')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [results, setResults] = useState<ResultItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [history, setHistory] = useState<{ time: string; taskId: string; status: string }[]>([])

  const logsEndRef = useRef<HTMLDivElement>(null)
  const attachPickerRef = useRef<HTMLInputElement | null>(null)
  const attachTargetRef = useRef<string | null>(null)
  const apiKey = getStoredProviderKey('runninghub')
  const rhServerReady = useRunninghubServerReady()

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const addLog = (msg: string, level: LogEntry['level'] = 'info') => {
    const time = new Date().toLocaleTimeString('id-ID')
    setLogs((prev) => [...prev, { time, msg, level }].slice(-200))
  }

  const updateRow = (key: string, patch: Partial<NodeRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }
  const removeRow = (key: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)))
  }
  const addRow = () => setRows((prev) => [...prev, emptyRow()])

  /** Lampirkan file lokal ke fieldValue sebagai data URI (docs: data URI diterima). */
  const attachFile = async (file: File, rowKey: string) => {
    if (file.size > MAX_FILE_ATTACH) {
      addToast(`File ${(file.size / 1024 / 1024).toFixed(1)}MB terlalu besar — unggah ke URL publik lalu tempel URL, atau kompres dulu.`, 'warning')
      return
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Gagal membaca file'))
      reader.readAsDataURL(file)
    })
    updateRow(rowKey, { fieldValue: dataUrl })
    addLog(`📎 ${file.name} → data URI (${(file.size / 1024).toFixed(0)} KB)`, 'success')
  }

  const applyJsonPaste = () => {
    try {
      const parsed = JSON.parse(jsonPaste)
      if (!Array.isArray(parsed)) throw new Error('Isi harus berupa array nodeInfoList')
      const next: NodeRow[] = []
      for (const [i, n] of parsed.entries()) {
        if (!n || typeof n !== 'object') throw new Error(`Node #${i + 1} bukan objek`)
        next.push({
          key: `${Date.now()}-${i}`,
          nodeId: String(n.nodeId ?? ''),
          fieldName: String(n.fieldName ?? ''),
          fieldValue: typeof n.fieldValue === 'string' ? n.fieldValue : String(n.fieldValue ?? ''),
          description: n.description == null ? '' : String(n.description),
        })
      }
      if (!next.length) throw new Error('Array kosong')
      setRows(next)
      setJsonPaste('')
      setJsonOpen(false)
      addToast(`${next.length} node dimuat dari JSON`, 'success')
    } catch (e: any) {
      addToast(`JSON tidak valid: ${e.message}`, 'error')
    }
  }

  const loadPreset = () => {
    setAppId(PRESET_DOCS_APP_ID)
    setRows(PRESET_DOCS_EXAMPLE.map((r) => ({ ...r })))
    addLog('Preset contoh dokumentasi dimuat (App ID 2116538467715293186) — ganti nodeInfoList dengan milik Anda.', 'info')
  }

  const validate = (): CustomAiAppNode[] | null => {
    const appIdTrim = appId.trim()
    if (!/^\d{5,25}$/.test(appIdTrim)) {
      addToast('App ID tidak valid — isi angka ID Aplikasi/Workflow dari URL runninghub.ai.', 'error')
      return null
    }
    const nodes: CustomAiAppNode[] = []
    for (const [i, r] of rows.entries()) {
      const nodeId = r.nodeId.trim()
      const fieldName = r.fieldName.trim()
      const fieldValue = r.fieldValue
      if (!nodeId && !fieldName && !fieldValue.trim() && !r.description.trim()) continue // baris kosong dilewati
      if (!nodeId) { addToast(`Node #${i + 1}: nodeId wajib diisi.`, 'error'); return null }
      if (!fieldName) { addToast(`Node #${i + 1}: fieldName wajib diisi.`, 'error'); return null }
      if (!fieldValue.trim()) { addToast(`Node #${i + 1} (${nodeId}/${fieldName}): fieldValue kosong.`, 'error'); return null }
      nodes.push({ nodeId, fieldName, fieldValue, description: r.description.trim() || null })
    }
    if (!nodes.length) {
      addToast('nodeInfoList kosong — isi minimal satu node.', 'error')
      return null
    }
    if (nodes.length > 50) {
      addToast('nodeInfoList maksimum 50 node.', 'error')
      return null
    }
    return nodes
  }

  const runApp = async () => {
    const nodes = validate()
    if (!nodes) return
    if (!apiKey && !rhServerReady) {
      addToast('⚠️ Top up saldo RunningHub dulu, atau tambahkan RunningHub API key / access token di Providers.', 'warning')
      return
    }

    setLoading(true)
    setError(null)
    setResults([])
    setProgress(0)
    setTaskStatus('submitting')
    setLogs([])
    const trackId = startGenerationTask({
      page: 'custom-ai-app',
      model: `Custom AI App (${appId.trim()})`,
      prompt: `${nodes.length} node · instanceType ${instanceType}`.slice(0, 500),
      provider: 'runninghub',
    })
    addLog(`Mulai Custom AI App — App ID ${appId.trim()} (${nodes.length} node, instanceType=${instanceType})`)
    if (webhookUrl.trim()) addLog(`webhookUrl: ${webhookUrl.trim().slice(0, 80)}`)
    if (retainSeconds.trim()) addLog(`retainSeconds: ${retainSeconds.trim()}`)
    addLog('docs: fieldValue = URL publik atau data URI base64; link hasil berlaku 24 jam', 'info')

    try {
      let submittedTaskId = ''
      const rotation = await withTokenRotation<string>(
        'runninghub',
        async (key, keyInfo) => {
          addLog(`🔑 Key: ${keyInfo?.name || keyInfo?.id || 'default'}`)
          const submit = await submitCustomAiApp({
            appId: appId.trim(),
            nodeInfoList: nodes,
            instanceType,
            usePersonalQueue,
            webhookUrl: webhookUrl.trim() || undefined,
            retainSeconds: retainSeconds.trim() ? Number(retainSeconds) : undefined,
            apiKey: key,
          })
          submittedTaskId = submit.taskId
          setTaskId(submit.taskId)
          setTaskStatus('running')
          addLog(`TaskId: ${submit.taskId} (status: ${submit.status})`, 'success')
          const url = await pollRunningHubTask(submit.taskId, (status, pct) => {
            setTaskStatus('running')
            setProgress(pct)
            addLog(`Poll: ${status} ${pct}%`)
          }, 600000, key, `Custom AI App (${appId.trim()})`)
          return url
        },
        {
          onKeySwitch: (from, to, attempt) => {
            const msg = `🔄 Key "${from.name}" gagal, pindah ke key #${attempt}: "${to.name}"`
            addLog(msg, 'warn')
            addToast(msg, 'info')
          },
          onError: (err, key) => {
            if (detectTokenError('runninghub', err)) {
              const msg = `⚠️ Key "${key.name}" bermasalah: ${err.message}`
              addLog(msg, 'warn')
              addToast(msg, 'warning')
            }
          },
        },
      )

      if (!rotation.ok || !rotation.result) {
        throw new Error(rotation.error || 'Custom AI App gagal')
      }

      // Ambil daftar hasil mentah (nodeId/outputType/url/text) — teks & file non-media
      // tidak tercakup pollRunningHubTask yang hanya mengembalikan URL utama.
      let items: ResultItem[] = []
      try {
        const full = await queryRunningHubTaskFull(submittedTaskId || taskId || '', rotation.usedKey?.key)
        items = (full.results ?? []).map((r, i) => ({ ...r, key: `${Date.now()}-${i}` }))
        addLog(`Hasil: ${items.length} output`, 'success')
      } catch {
        items = [{ url: rotation.result, outputType: 'file', key: `${Date.now()}-main` }]
      }
      if (!items.length && rotation.result) {
        items = [{ url: rotation.result, outputType: 'file', key: `${Date.now()}-main` }]
      }
      setResults(items)
      setTaskStatus('success')
      setProgress(100)

      const firstUrl = items.find((i) => i.url)?.url || rotation.result
      const isImage = firstUrl ? /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(firstUrl.split('?')[0]) : false
      if (firstUrl) {
        persistResultToR2(submittedTaskId || trackId, firstUrl)
        addResult({
          id: submittedTaskId || trackId,
          url: firstUrl,
          prompt: `Custom AI App ${appId.trim()} · ${nodes.length} node`.slice(0, 500),
          date: new Date().toISOString(),
          page: 'custom-ai-app',
          kind: isImage ? 'image' : 'video',
          provider: 'runninghub',
          model: `Custom AI App (${appId.trim()})`,
        })
      }
      setHistory((prev) => [
        { time: new Date().toLocaleTimeString('id-ID'), taskId: submittedTaskId || '-', status: '✅ Selesai' },
        ...prev,
      ])
      addToast('✅ Custom AI App selesai!', 'success')
    } catch (e: any) {
      setTaskStatus('error')
      setError(e?.message || 'Unknown error')
      addLog(`❌ Error: ${e?.message || e}`, 'error')
      addToast(`Custom AI App gagal: ${e?.message || e}`, 'error')
    } finally {
      removeActiveTask(trackId)
      setLoading(false)
    }
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="RUNNINGHUB OPENAI"
        title="Custom AI App"
        highlight="Runner"
        desc="Panggil AI App / workflow ComfyUI manapun dari runninghub.ai via HTTP — isi App ID + nodeInfoList, submit, poll hasil. Porting langsung dari dokumentasi OpenAPI v2."
      />

      <div className="grid lg:grid-cols-[1fr_400px] gap-6">
        {/* ── Form ── */}
        <Section>
          <div className="flex items-center justify-between gap-2 mb-3">
            <Label><span className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" /> App ID</span></Label>
            <div className="flex items-center gap-2">
              <button onClick={loadPreset} className="text-[11px] text-primary hover:underline flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> Contoh dokumentasi
              </button>
              <a href={DOCS_URL} target="_blank" rel="noreferrer" className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                Docs <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value.replace(/\D/g, ''))}
            placeholder="2116538467715293186"
            inputMode="numeric"
            className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Angka dari URL AI App / workflow ComfyUI — mis. <code>runninghub.ai/ai-detail/2116538467715293186</code> → App ID <code>2116538467715293186</code>.
          </p>

          <div className="flex items-center justify-between gap-2 mt-5 mb-2">
            <Label>nodeInfoList</Label>
            <button onClick={() => setJsonOpen((v) => !v)} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
              <Terminal className="h-3 w-3" /> {jsonOpen ? 'Tutup JSON' : 'Tempel JSON'}
            </button>
          </div>

          {jsonOpen && (
            <div className="mb-3 rounded-lg border border-border bg-secondary/30 p-2">
              <textarea
                value={jsonPaste}
                onChange={(e) => setJsonPaste(e.target.value.slice(0, MAX_JSON_PASTE))}
                placeholder='[{"nodeId":"209","fieldName":"image","fieldValue":"https://.../x.png"}, ...]'
                className="w-full h-28 rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <div className="flex justify-end mt-1.5">
                <Button size="sm" variant="secondary" onClick={applyJsonPaste}>Muat nodeInfoList</Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={row.key} className="rounded-lg border border-border bg-secondary/20 p-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground w-5 text-center font-mono">#{i + 1}</span>
                  <input
                    value={row.nodeId}
                    onChange={(e) => updateRow(row.key, { nodeId: e.target.value })}
                    placeholder="nodeId"
                    className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <input
                    value={row.fieldName}
                    onChange={(e) => updateRow(row.key, { fieldName: e.target.value })}
                    placeholder="fieldName"
                    className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button
                    title="Lampirkan file → data URI"
                    onClick={() => { attachTargetRef.current = row.key; attachPickerRef.current?.click() }}
                    className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-primary/50"
                  >
                    <FileUp className="h-3.5 w-3.5" />
                  </button>
                  <button title="Hapus node" onClick={() => removeRow(row.key)} className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-red-400 hover:border-red-400/50">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <textarea
                  value={row.fieldValue}
                  onChange={(e) => updateRow(row.key, { fieldValue: e.target.value })}
                  placeholder="fieldValue — URL publik atau data URI base64"
                  className="w-full mt-1.5 h-16 rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <input
                  value={row.description}
                  onChange={(e) => updateRow(row.key, { description: e.target.value })}
                  placeholder="description (opsional)"
                  className="w-full mt-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            ))}
          </div>
          <Button size="sm" variant="secondary" className="mt-2" onClick={addRow}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Tambah node
          </Button>

          <input
            ref={attachPickerRef}
            type="file"
            accept="image/*,audio/*,video/*,application/pdf,text/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              const target = attachTargetRef.current
              if (file && target) attachFile(file, target).catch(() => {})
              e.target.value = ''
            }}
          />

          <details className="mt-4 rounded-lg border border-border bg-secondary/20 p-3">
            <summary className="text-xs font-semibold cursor-pointer select-none text-muted-foreground hover:text-foreground">Lanjutan — instanceType · usePersonalQueue · webhookUrl · retainSeconds</summary>
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              <div>
                <Label className="text-[11px]">instanceType</Label>
                <select
                  value={instanceType}
                  onChange={(e) => setInstanceType(e.target.value as any)}
                  className="w-full mt-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="default">default — 24G VRAM</option>
                  <option value="plus">plus — 48G VRAM</option>
                  <option value="ultra">ultra — 84G VRAM</option>
                </select>
              </div>
              <div>
                <Label className="text-[11px]">retainSeconds <span className="text-muted-foreground font-normal">(10–180, khusus Kunci API Bersama Perusahaan)</span></Label>
                <input
                  type="number"
                  min={10}
                  max={180}
                  value={retainSeconds}
                  onChange={(e) => setRetainSeconds(e.target.value)}
                  placeholder="kosong = jangan kirim"
                  className="w-full mt-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-[11px]">webhookUrl <span className="text-muted-foreground font-normal">(opsional — RunningHub POST callback saat tugas selesai)</span></Label>
                <input
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full mt-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <label className="sm:col-span-2 flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input type="checkbox" checked={usePersonalQueue} onChange={(e) => setUsePersonalQueue(e.target.checked)} className="accent-primary" />
                usePersonalQueue — pakai antrean eksklusif pribadi
              </label>
            </div>
          </details>

          <div className="mt-5 flex flex-col items-center gap-2">
            <Button size="lg" onClick={runApp} disabled={loading} className="w-full sm:w-auto min-w-56">
              {loading ? (
                <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {taskStatus === 'submitting' ? 'Menjalankan…' : 'Menunggu hasil…'}</span>
              ) : (
                <span className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Run AI App</span>
              )}
            </Button>
            <RunninghubPriceNote action="submit-custom-ai-app" />
            {error && (
              <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 max-w-md">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /><span>{error}</span>
              </div>
            )}
          </div>
        </Section>

        {/* ── Hasil & log ── */}
        <div className="space-y-4">
          <Section>
            <div className="flex items-center justify-between mb-2">
              <Label>Hasil</Label>
              {taskId && <span className="text-[10px] font-mono text-muted-foreground">taskId: {taskId}</span>}
            </div>
            {taskStatus === 'running' && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <Clock className="h-3.5 w-3.5 animate-pulse" /> Berjalan… {progress > 0 ? `${progress}%` : ''}
              </div>
            )}
            {results.length === 0 ? (
              <EmptyState
                icon={<Bot className="h-8 w-8" />}
                title="Belum ada hasil"
                description="Isi App ID + nodeInfoList lalu Run AI App. Link hasil berlaku 24 jam — unduh / simpan hasilmu."
              />
            ) : (
              <div className="space-y-3">
                {results.map((item) => {
                  const url = item.url || ''
                  const t = String(item.outputType || '').toLowerCase()
                  const isImg = /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(url.split('?')[0]) || /image/i.test(t)
                  const isVid = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url.split('?')[0]) || /video/i.test(t)
                  const isAud = /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(url.split('?')[0]) || /audio/i.test(t)
                  const text = typeof item.text === 'string' && item.text.trim() ? item.text : null
                  return (
                    <div key={item.key} className="rounded-lg border border-border bg-secondary/20 p-2">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[10px] font-mono text-muted-foreground">{item.nodeId ? `node ${item.nodeId}` : 'output'}{item.outputType ? ` · ${item.outputType}` : ''}</span>
                        {url && (
                          <div className="flex items-center gap-1.5">
                            <button
                              title="Salin link"
                              className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                              onClick={() => { navigator.clipboard.writeText(url).catch(() => {}); addToast('Link disalin', 'success') }}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <a href={url} download target="_blank" rel="noreferrer" className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Unduh (berlaku 24 jam)">
                              <Download className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        )}
                      </div>
                      {isImg && url && <img src={url} alt={`node ${item.nodeId ?? ''}`} className="w-full rounded-md border border-border" />}
                      {isVid && url && <video src={url} controls className="w-full rounded-md border border-border" />}
                      {isAud && url && <audio src={url} controls className="w-full" />}
                      {text && <pre className="whitespace-pre-wrap text-[11px] text-foreground/90 bg-background border border-border rounded-md p-2 max-h-56 overflow-auto">{text}</pre>}
                      {!isImg && !isVid && !isAud && !text && url && (
                        <a href={url} target="_blank" rel="noreferrer" className="text-[11px] font-mono text-primary hover:underline break-all">{url}</a>
                      )}
                    </div>
                  )
                })}
                <p className="text-[10px] text-muted-foreground">⚠️ Link hasil RunningHub berlaku 24 jam — unduh atau simpan sekarang.</p>
              </div>
            )}
          </Section>

          <Section>
            <div className="flex items-center justify-between mb-2">
              <Label>Log</Label>
              <LogDetailActions logs={logs} onClear={() => setLogs([])} />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-background/60 p-2 font-mono text-[10px] leading-relaxed">
              {logs.length === 0 ? (
                <p className="text-muted-foreground">Log muncul di sini saat submit/poll…</p>
              ) : logs.map((l, i) => (
                <div key={i} className={l.level === 'error' ? 'text-red-400' : l.level === 'success' ? 'text-emerald-400' : l.level === 'warn' ? 'text-amber-400' : 'text-muted-foreground'}>
                  <span className="opacity-60">{l.time}</span> {l.msg}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </Section>
        </div>
      </div>

      {/* ── Riwayat ── */}
      {history.length > 0 && (
        <Section className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <Label>Riwayat sesi ini</Label>
          </div>
          <div className="space-y-1">
            {history.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground border-b border-border/50 py-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span className="font-mono">{h.time}</span>
                <span className="font-mono">{h.taskId}</span>
                <span>{h.status}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </PageContent>
  )
}
