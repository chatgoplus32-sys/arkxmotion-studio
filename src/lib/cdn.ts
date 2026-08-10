export interface CdnUploadResult {
  ok: boolean
  url?: string
  error?: string
}

export async function uploadToCdn(
  videoUrl: string,
  filename?: string,
): Promise<CdnUploadResult> {
  try {
    const res = await fetch('/api/public/r2-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: videoUrl,
        filename: filename || `video-${Date.now()}.mp4`,
        prefix: 'videos',
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: false, error: data.error || `HTTP ${res.status}` }
    }

    const data = await res.json()
    if (!data.ok) return { ok: false, error: data.error }

    return { ok: true, url: data.url }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export function isCdnConfigured(): boolean {
  return true
}
