const LEONARDO_PROXY = '/api/public/leonardo'

interface LeonardoGenerateOptions {
  apiKey: string
  slug: string
  prompt: string
  width: number
  height: number
  duration: number
  imageUrl?: string
}

interface LeonardoBalanceResult {
  ok: boolean
  credits?: number
  subscription?: string
  error?: string
}

export async function fetchLeonardoBalance(apiKey: string): Promise<LeonardoBalanceResult> {
  try {
    const res = await fetch(LEONARDO_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ action: 'balance' }),
    })
    const data = await res.json().catch(() => ({})) as any
    if (data.error) {
      return { ok: false, error: data.error }
    }
    return {
      ok: true,
      credits: data.credits,
      subscription: data.subscription,
    }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function leonardoGenerate(opts: LeonardoGenerateOptions): Promise<{ generationId: string }> {
  const { apiKey, slug, prompt, width, height, duration, imageUrl } = opts

  const res = await fetch(LEONARDO_PROXY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ action: 'generate', slug, prompt, width, height, duration, imageUrl }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Leonardo HTTP ${res.status}`)
  }

  const data = await res.json()
  if (!data.generationId) throw new Error('Leonardo: no generationId')
  return { generationId: data.generationId }
}

export async function leonardoPollStatus(
  apiKey: string,
  generationId: string,
  onLog?: (msg: string, level?: string) => void,
  onStatus?: (text: string, pct: number) => void,
): Promise<string> {
  const maxPolls = 96
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 5000))

    const res = await fetch(LEONARDO_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ action: 'status', generationId }),
    })

    if (!res.ok) {
      onLog?.(`Poll #${i + 1}: HTTP ${res.status} (retrying...)`, 'warn')
      continue
    }

    const data = await res.json()
    const status = data.status
    const pct = Math.min(95, 40 + (i / maxPolls) * 55)
    onLog?.(`Poll #${i + 1}: ${status || 'processing'}`, 'debug')
    onStatus?.(`Leonardo ${status}...`, pct)

    if (status === 'COMPLETE') {
      const videoUrl = data.motionMP4URL || data.generated_images?.[0]?.motionMP4URL || data.generated_images?.[0]?.videoUrl
      if (!videoUrl) throw new Error('Leonardo: URL not found in COMPLETE response')
      return videoUrl
    }

    if (status === 'FAILED') throw new Error('Leonardo: generation FAILED')
  }
  throw new Error('Leonardo: timeout')
}

export async function generateWithLeonardo(opts: LeonardoGenerateOptions & {
  onLog?: (msg: string, level?: string) => void
  onStatus?: (text: string, pct: number) => void
}): Promise<string> {
  const { apiKey, slug, prompt, width, height, duration, imageUrl, onLog, onStatus } = opts

  onLog?.(`Submitting to Leonardo... model=${slug}`)
  onStatus?.('Submitting to Leonardo...', 10)

  const { generationId } = await leonardoGenerate({ apiKey, slug, prompt, width, height, duration, imageUrl })
  onLog?.(`Generation ${generationId.slice(0, 8)}... ✓`)
  onStatus?.('Rendering...', 40)

  const videoUrl = await leonardoPollStatus(apiKey, generationId, onLog, onStatus)
  onStatus?.('Done!', 100)
  return videoUrl
}
