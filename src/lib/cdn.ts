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

export async function uploadBlobToCdn(
  blob: Blob,
  filename?: string,
  onProgress?: (pct: number) => void,
): Promise<CdnUploadResult> {
  try {
    const fd = new FormData()
    fd.append('file', blob, filename || `video-${Date.now()}.mp4`)

    const url = await new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/public/r2-upload')
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          onProgress?.(Math.max(0, Math.min(99, Math.round((e.loaded / e.total) * 100))))
        }
      }
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText || 'null')
          if (xhr.status >= 200 && xhr.status < 300 && data?.ok && data?.url) resolve(data.url)
          else reject(new Error(data?.error || `HTTP ${xhr.status}`))
        } catch (e: any) {
          reject(e)
        }
      }
      xhr.onerror = () => reject(new Error('network/CORS gagal'))
      xhr.ontimeout = () => reject(new Error('timeout upload'))
      xhr.timeout = 480000
      xhr.send(fd)
    })

    return { ok: true, url }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}
