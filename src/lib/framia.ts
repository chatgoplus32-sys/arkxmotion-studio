const FRAMIA_PROXY = '/api/public/framia'

interface FramiaRunOptions {
  apiKey: string
  imageUrl?: string
  prompt: string
  skillId?: string
  onLog?: (msg: string, level?: string) => void
  onStatus?: (text: string, pct: number) => void
}

interface FramiaSkill {
  id: string
  name: string
  description?: string
  cost?: number
}

export async function fetchFramiaSkills(apiKey: string): Promise<FramiaSkill[]> {
  const res = await fetch(`${FRAMIA_PROXY}?path=workflows/skills`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.skills || data.data || []
}

export async function fetchFramiaCredits(apiKey: string): Promise<number | null> {
  const res = await fetch(`${FRAMIA_PROXY}?path=v1/user/credits`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.credits ?? data.balance ?? null
}

export async function submitFramiaRun(
  apiKey: string,
  body: { skill_id: string; prompt?: string; image_url?: string }
): Promise<{ runId: string }> {
  const res = await fetch(`${FRAMIA_PROXY}?path=workflows/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  return { runId: data.run_id || data.id }
}

export async function pollFramiaRun(
  apiKey: string,
  runId: string,
  onLog?: (msg: string, level?: string) => void,
  onStatus?: (text: string, pct: number) => void
): Promise<string> {
  const maxPolls = 120
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 3000))

    const res = await fetch(`${FRAMIA_PROXY}?path=workflows/runs/${runId}/nodes`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (!res.ok) {
      onLog?.(`Poll #${i + 1}: HTTP ${res.status} (retrying...)`, 'warn')
      continue
    }

    const data = await res.json()
    const nodes = data.nodes || []
    const pct = Math.min(90, 10 + (i / maxPolls) * 80)
    onStatus?.(`Polling... (${i + 1}/${maxPolls})`, pct)
    onLog?.(`Poll #${i + 1}: ${nodes.length} nodes`)

    const outputNode = nodes.find((n: any) => n.output_url || n.status === 'completed')
    if (outputNode?.output_url) {
      return outputNode.output_url
    }

    if (nodes.some((n: any) => n.status === 'failed')) {
      throw new Error('Workflow run failed')
    }
  }
  throw new Error('Timeout: generation took too long')
}

export async function generateWithFramia(opts: FramiaRunOptions): Promise<string> {
  const { apiKey, imageUrl, prompt, skillId, onLog, onStatus } = opts

  if (!apiKey) throw new Error('No Framia API key')

  const defaultSkill = skillId || 'i2v'
  onLog?.(`Submitting to Framia... skill=${defaultSkill}`)
  onStatus?.('Submitting to Framia...', 10)

  const body: any = { skill_id: defaultSkill, prompt }
  if (imageUrl) body.image_url = imageUrl

  const { runId } = await submitFramiaRun(apiKey, body)
  onLog?.(`Run created ✓ id=${runId}`)
  onStatus?.(`Processing... (run: ${runId.slice(0, 8)}...)`, 20)

  const videoUrl = await pollFramiaRun(apiKey, runId, onLog, onStatus)
  onStatus?.('Done!', 100)
  return videoUrl
}
