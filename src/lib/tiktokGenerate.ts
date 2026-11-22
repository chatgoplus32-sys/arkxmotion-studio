// ─── TikTok Symphony generate client ────────────────────────────────────────
// Semua lewat proxy server (/api/public/tiktok-symphony) — kredensial TikTok
// (Access-Token + tto_id) tidak pernah disimpan di browser.
import { TIKTOK_API } from '@/pages/image-to-video/constants'

export interface TiktokGenerateOpts {
  token: string
  prompt: string
  model?: string
  imageUrl?: string | null
  endFrameUrl?: string | null
  referenceImageUrls?: string[]
  duration?: number
  ratio?: string
  resolution?: string
  generateAudio?: boolean
  onLog?: (msg: string) => void
  onStatus?: (text: string, pct: number) => void
}

export async function tiktokCreateTask(opts: TiktokGenerateOpts): Promise<string> {
  const res = await fetch(`${TIKTOK_API}?action=generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
    body: JSON.stringify({
      prompt: opts.prompt,
      model: opts.model || 'SEEDANCE_2_0_FAST',
      imageUrl: opts.imageUrl || null,
      endFrameUrl: opts.endFrameUrl || null,
      referenceImageUrls: opts.referenceImageUrls || [],
      duration: opts.duration || 5,
      ratio: opts.ratio || '9:16',
      resolution: opts.resolution || '720P',
      generateAudio: opts.generateAudio ?? true,
    }),
    signal: AbortSignal.timeout(40000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data?.ok) throw new Error(data?.error || `Gagal membuat task TikTok (${res.status})`)
  return data.taskId
}

export async function tiktokPollTask(
  token: string,
  taskId: string,
  opts: { onLog?: (msg: string) => void; onStatus?: (text: string, pct: number) => void; maxPolls?: number; intervalMs?: number } = {},
): Promise<string> {
  const maxPolls = opts.maxPolls || 180
  const intervalMs = opts.intervalMs || 5000
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, intervalMs))
    const pct = Math.min(95, 10 + (i / maxPolls) * 85)
    opts.onStatus?.(`Menunggu TikTok Symphony… (${i + 1}/${maxPolls})`, pct)
    try {
      const res = await fetch(`${TIKTOK_API}?action=status&taskId=${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        opts.onLog?.(`poll #${i + 1}: error ${data?.error || res.status}`)
        continue
      }
      opts.onLog?.(`poll #${i + 1}: ${data.status}`)
      if (data.status === 'SUCCEEDED' && data.videoUrl) {
        opts.onStatus?.('Selesai!', 100)
        return data.videoUrl
      }
      if (data.status === 'FAILED' || data.status === 'EXPIRED' || data.status === 'CANCELLED') {
        throw new Error(data.error || `Task TikTok ${data.status}`)
      }
      // QUEUED / RUNNING → lanjut polling
    } catch (e: any) {
      if (e?.message && /Task TikTok|Gagal membuat/.test(e.message)) throw e
      // network hiccup — lanjut
    }
  }
  throw new Error('Timeout: TikTok Symphony terlalu lama')
}

/** Submit + poll + return URL hasil. */
export async function generateWithTiktok(opts: TiktokGenerateOpts): Promise<string> {
  opts.onStatus?.('Mengirim ke TikTok Symphony…', 5)
  const taskId = await tiktokCreateTask(opts)
  opts.onLog?.(`Task dibuat: ${taskId}`)
  opts.onStatus?.('Memproses di TikTok Symphony…', 20)
  return tiktokPollTask(opts.token, taskId, { onLog: opts.onLog, onStatus: opts.onStatus })
}
