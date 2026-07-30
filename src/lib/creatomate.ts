const CREATOMATE_PROXY = '/api/public/creatomate'

export interface CreatomateRender {
  id: string
  status: 'queued' | 'processing' | 'succeeded' | 'failed'
  url?: string
  progress?: number
  error?: string
}

export async function checkCreatomateBalance(apiKey: string): Promise<{ ok: boolean; balance?: number; error?: string }> {
  try {
    const res = await fetch(`${CREATOMATE_PROXY}?path=account`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const data = await res.json()
    return { ok: true, balance: data.credits_remaining ?? null }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function submitCreatomateRender(
  apiKey: string,
  templateId: string | null,
  sources: any[],
  options?: { output_format?: string; fps?: number; resolution?: string }
): Promise<{ renderId: string }> {
  const body: any = { sources }
  if (templateId) body.template_id = templateId
  if (options) {
    if (options.output_format) body.output_format = options.output_format
    if (options.fps) body.fps = options.fps
    if (options.resolution) body.resolution = options.resolution
  }

  const res = await fetch(`${CREATOMATE_PROXY}?path=renders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.errors?.[0]?.detail || err.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  return { renderId: data.id }
}

export async function pollCreatomateRender(
  apiKey: string,
  renderId: string,
  onStatus?: (text: string, pct: number) => void
): Promise<string> {
  const maxPolls = 120
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 3000))

    const res = await fetch(`${CREATOMATE_PROXY}?path=renders/${renderId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) continue

    const data = await res.json()
    const status = data.status
    const pct = Math.min(90, 10 + (i / maxPolls) * 80)
    onStatus?.(`Rendering... ${status} (${i + 1}/${maxPolls})`, pct)

    if (status === 'succeeded') {
      const url = data.url
      if (url) return url
      throw new Error('Render succeeded but no URL returned')
    }
    if (status === 'failed') {
      throw new Error(data.errors?.[0]?.detail || 'Render failed')
    }
  }
  throw new Error('Timeout: render took too long')
}

export async function generateWithCreatomate(
  apiKey: string,
  templateId: string | null,
  sources: any[],
  options?: { output_format?: string; fps?: number; resolution?: string },
  onStatus?: (text: string, pct: number) => void
): Promise<string> {
  if (!apiKey) throw new Error('No Creatomate API key')
  onStatus?.('Submitting render...', 10)
  const { renderId } = await submitCreatomateRender(apiKey, templateId, sources, options)
  onStatus?.(`Render started: ${renderId.slice(0, 8)}...`, 20)
  const url = await pollCreatomateRender(apiKey, renderId, onStatus)
  onStatus?.('Done!', 100)
  return url
}
