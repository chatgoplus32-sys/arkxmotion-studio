import { useState, useEffect, useRef } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Textarea, Input, Label, EmptyState } from '@/components/ui'
import { useToastStore } from '@/stores/toastStore'
import { getGensparkApiKey } from '@/lib/genspark'
import { createTask, taskStatus, type CreateTaskParams } from '@/lib/genspark-tools'
import { Film, Upload, Loader2, Play, Download, Scissors, Wand2, Sparkles } from 'lucide-react'

const EDIT_TYPES = [
  { value: 'highlight', label: '🎯 Highlight Reel', description: 'Extract best moments from video' },
  { value: 'summary', label: '📝 Video Summary', description: 'Create a summary clip' },
  { value: 'cut', label: '✂️ Smart Cut', description: 'Remove pauses and filler' },
  { value: 'remix', label: '🎵 Remix', description: 'Remix video with new style' },
  { value: 'caption', label: '💬 Add Captions', description: 'Auto-generate captions' },
  { value: 'custom', label: '🎨 Custom Edit', description: 'Describe your own edit' },
]

export default function ClipGeniusPage() {
  const addToast = useToastStore((s) => s.addToast)
  const [videoUrl, setVideoUrl] = useState('')
  const [editType, setEditType] = useState('highlight')
  const [customPrompt, setCustomPrompt] = useState('')
  const [processing, setProcessing] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [taskUrl, setTaskUrl] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])

  const hasApiKey = !!getGensparkApiKey()

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} ${msg}`].slice(-50))
  }

  const getEditPrompt = (): string => {
    const base = videoUrl ? `Video URL: ${videoUrl}` : ''

    switch (editType) {
      case 'highlight':
        return `${base}\n\nCreate a highlight reel from this video. Extract the most interesting and engaging moments. Add smooth transitions between clips. Keep the best parts only.`
      case 'summary':
        return `${base}\n\nCreate a summary clip of this video. Include key points and important moments. Make it concise and informative.`
      case 'cut':
        return `${base}\n\nSmart cut this video. Remove pauses, filler words, and dead air. Keep the video flowing smoothly.`
      case 'remix':
        return `${base}\n\nRemix this video with a fresh style. Add dynamic transitions, effects, and pacing.`
      case 'caption':
        return `${base}\n\nAdd automatic captions/subtitles to this video. Make them readable and well-timed.`
      case 'custom':
        return `${base}\n\n${customPrompt}`
      default:
        return base
    }
  }

  const handleProcess = async () => {
    if (!videoUrl.trim() && editType !== 'custom') {
      addToast('Masukkan URL video', 'error')
      return
    }
    if (editType === 'custom' && !customPrompt.trim()) {
      addToast('Masukkan deskripsi edit', 'error')
      return
    }
    if (!hasApiKey) {
      addToast('Belum ada Genspark API key', 'error')
      return
    }

    setProcessing(true)
    setResult(null)
    setTaskId(null)
    setTaskUrl(null)
    setProgress(0)

    try {
      addLog('🎬 Submitting video edit task...')

      const prompt = getEditPrompt()
      const taskResult = await createTask({
        taskType: 'video_generation',
        query: prompt,
        taskName: `Clip Genius - ${EDIT_TYPES.find(e => e.value === editType)?.label || editType}`,
      })

      const data = taskResult?.data || taskResult
      const id = data?.project_id || data?.task_id || data?.id
      const url = data?.task_url || data?.url

      if (id) {
        setTaskId(id)
        addLog(`📋 Task ID: ${id}`)
      }
      if (url) {
        setTaskUrl(url)
        setProgress(20)
        addLog(`🔗 Task URL: ${url.slice(0, 60)}...`)

        // Poll for status
        addLog('⏳ Waiting for video processing...')
        let attempts = 0
        const maxAttempts = 60 // 5 minutes max

        const pollInterval = setInterval(async () => {
          attempts++
          setProgress(Math.min(20 + (attempts / maxAttempts) * 70, 90))

          try {
            const status = await taskStatus(id)
            const statusData = status?.data || status
            const statusStr = statusData?.status || ''

            addLog(`📊 Status: ${statusStr} (${attempts}/${maxAttempts})`)

            if (statusStr === 'completed' || statusStr === 'done' || statusStr === 'success') {
              clearInterval(pollInterval)
              setResult(statusData)
              setProgress(100)
              setProcessing(false)
              addToast('Video edit selesai!', 'success')
              addLog('✅ Video edit completed!')
            } else if (statusStr === 'failed' || statusStr === 'error') {
              clearInterval(pollInterval)
              setProcessing(false)
              addToast('Video edit gagal', 'error')
              addLog(`❌ Task failed: ${statusData?.error || 'Unknown error'}`)
            }
          } catch (err: any) {
            addLog(`⚠️ Poll error: ${err.message}`)
          }

          if (attempts >= maxAttempts) {
            clearInterval(pollInterval)
            setProcessing(false)
            addToast('Timeout — coba cek task URL', 'warning')
            addLog('⏰ Polling timeout')
          }
        }, 5000) // Poll every 5 seconds

      } else {
        // No URL returned, task might be sync
        setResult(data)
        setProgress(100)
        setProcessing(false)
        addLog('✅ Task submitted (sync mode)')
      }
    } catch (err: any) {
      setProcessing(false)
      addToast(`Error: ${err.message}`, 'error')
      addLog(`❌ Error: ${err.message}`)
    }
  }

  if (!hasApiKey) {
    return (
      <PageContent>
        <PageHeader
          eyebrow="Tools"
          title="Clip"
          highlight="Genius"
          desc="AI Video Editor — edit video dengan satu prompt."
        />
        <EmptyState
          icon={<Film className="h-12 w-12" />}
          title="Belum ada Genspark API Key"
          description="Tambahkan Genspark API key di Providers untuk menggunakan Clip Genius."
          action={
            <Button onClick={() => window.location.href = '/providers'}>
              Buka Providers
            </Button>
          }
        />
      </PageContent>
    )
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Tools"
        title="Clip"
        highlight="Genius"
        desc="AI Video Editor — edit video dengan satu prompt. Upload video URL lalu pilih jenis edit."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input */}
        <div className="space-y-4">
          <Section title="🎬 Video Input" sub="URL video yang akan di-edit">
            <div className="space-y-3">
              <div>
                <Label>Video URL</Label>
                <Input
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://example.com/video.mp4 atau YouTube URL"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Masukkan URL video (MP4, YouTube, atau direct link)
              </p>
            </div>
          </Section>

          <Section title="✂️ Edit Type" sub="Pilih jenis edit yang diinginkan">
            <div className="grid grid-cols-2 gap-2">
              {EDIT_TYPES.map((type) => (
                <button
                  key={type.value}
                  onClick={() => setEditType(type.value)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    editType === type.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/30'
                  }`}
                >
                  <div className="text-sm font-medium">{type.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{type.description}</div>
                </button>
              ))}
            </div>
          </Section>

          {editType === 'custom' && (
            <Section title="📝 Custom Instructions" sub="Deskripsikan edit yang diinginkan">
              <Textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Buat video lebih dramatis dengan transisi cepat dan efek slow motion di bagian climax..."
                className="min-h-[100px]"
              />
            </Section>
          )}

          <Button
            onClick={handleProcess}
            disabled={processing || (!videoUrl.trim() && editType !== 'custom')}
            className="w-full"
            size="lg"
          >
            {processing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing... {progress}%
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-4 w-4" />
                Process Video
              </>
            )}
          </Button>

          {processing && (
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>

        {/* Right: Result & Logs */}
        <div className="space-y-4">
          <Section title="📋 Logs" sub="Proses editing">
            <div className="bg-muted/50 rounded-lg p-3 max-h-[200px] overflow-y-auto font-mono text-xs space-y-1">
              {logs.length > 0 ? (
                logs.map((log, idx) => (
                  <div key={idx} className="text-muted-foreground">{log}</div>
                ))
              ) : (
                <div className="text-muted-foreground">Menunggu input...</div>
              )}
            </div>
          </Section>

          <Section title="🎬 Hasil" sub="Video yang sudah di-edit">
            {result ? (
              <div className="space-y-3">
                {result.video_url || result.result_url || result.url ? (
                  <div className="relative rounded-xl overflow-hidden border border-border">
                    <video
                      src={result.video_url || result.result_url || result.url}
                      controls
                      className="w-full"
                    />
                  </div>
                ) : result.task_url ? (
                  <div className="p-4 rounded-lg bg-muted/50 border border-border">
                    <p className="text-sm font-medium mb-2">Task selesai!</p>
                    <a
                      href={result.task_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline text-sm"
                    >
                      Buka di Genspark →
                    </a>
                  </div>
                ) : (
                  <pre className="text-xs whitespace-pre-wrap p-4 bg-muted/50 rounded-lg max-h-[300px] overflow-y-auto">
                    {JSON.stringify(result, null, 2).slice(0, 3000)}
                  </pre>
                )}

                {taskUrl && (
                  <a
                    href={taskUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Play className="h-4 w-4" />
                    Buka Task di Genspark
                  </a>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Film className="h-12 w-12 mb-4 opacity-50" />
                <p>Belum ada hasil</p>
                <p className="text-xs mt-1">Masukkan video URL lalu pilih jenis edit</p>
              </div>
            )}
          </Section>
        </div>
      </div>
    </PageContent>
  )
}
