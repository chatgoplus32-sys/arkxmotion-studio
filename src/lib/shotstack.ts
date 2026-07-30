const SHOTSTACK_PROXY = '/api/public/shotstack'

export interface ShotstackRender {
  id: string
  status: 'queued' | 'processing' | 'done' | 'failed'
  url?: string
  progress?: number
  error?: string
}

export async function checkShotstackBalance(apiKey: string): Promise<{ ok: boolean; balance?: number; error?: string }> {
  try {
    const res = await fetch(`${SHOTSTACK_PROXY}?path=account`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const data = await res.json()
    return { ok: true, balance: data.plan?.remaining?.minutes ?? null }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function submitShotstackRender(
  apiKey: string,
  timeline: any,
  outputFormat?: { format?: string; resolution?: string }
): Promise<{ renderId: string }> {
  const body: any = { timeline }
  if (outputFormat) body.output = outputFormat

  const res = await fetch(`${SHOTSTACK_PROXY}?path=render`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || err.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  return { renderId: data.response?.id || data.id }
}

export async function pollShotstackRender(
  apiKey: string,
  renderId: string,
  onStatus?: (text: string, pct: number) => void
): Promise<string> {
  const maxPolls = 120
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 3000))

    const res = await fetch(`${SHOTSTACK_PROXY}?path=render/${renderId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) continue

    const data = await res.json()
    const status = data.response?.status
    const pct = Math.min(90, 10 + (i / maxPolls) * 80)
    onStatus?.(`Rendering... ${status} (${i + 1}/${maxPolls})`, pct)

    if (status === 'done') {
      const url = data.response?.url
      if (url) return url
      throw new Error('Render done but no URL returned')
    }
    if (status === 'failed') {
      throw new Error(data.response?.error || 'Render failed')
    }
  }
  throw new Error('Timeout: render took too long')
}

export async function generateWithShotstack(
  apiKey: string,
  timeline: any,
  onStatus?: (text: string, pct: number) => void
): Promise<string> {
  if (!apiKey) throw new Error('No Shotstack API key')
  onStatus?.('Submitting render...', 10)
  const { renderId } = await submitShotstackRender(apiKey, timeline)
  onStatus?.(`Render started: ${renderId.slice(0, 8)}...`, 20)
  const url = await pollShotstackRender(apiKey, renderId, onStatus)
  onStatus?.('Done!', 100)
  return url
}
