export interface CdnUploadResult {
  ok: boolean
  url?: string
  error?: string
}

function isTokenExpiring(token: string): boolean {
  try {
    const payload = token.split('.')[1]
    if (!payload) return true
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
    const data = JSON.parse(atob(padded)) as { exp?: number }
    return typeof data.exp !== 'number' || data.exp * 1000 < Date.now() + 60_000
  } catch {
    return true
  }
}

/** Endpoint upload butuh login; refresh token dulu kalau akses sudah mepet kedaluwarsa. */
async function getUploadToken(): Promise<string | null> {
  try {
    const { useAuthStore } = await import('@/stores/authStore')
    let token = useAuthStore.getState().token || localStorage.getItem('arkxmotion_token')
    if (!token || isTokenExpiring(token)) {
      const refreshed = await useAuthStore.getState().refresh()
      if (refreshed) token = useAuthStore.getState().token || localStorage.getItem('arkxmotion_token')
    }
    if (!token || isTokenExpiring(token)) return null
    return token
  } catch {
    const token = localStorage.getItem('arkxmotion_token')
    return token && !isTokenExpiring(token) ? token : null
  }
}

const SESSION_EXPIRED = 'Sesi berakhir — login ulang untuk menyimpan hasil.'

export async function uploadToCdn(
  videoUrl: string,
  filename?: string,
): Promise<CdnUploadResult> {
  try {
    const token = await getUploadToken()
    if (!token) return { ok: false, error: SESSION_EXPIRED }

    const res = await fetch('/api/public/r2-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        url: videoUrl,
        filename: filename || `video-${Date.now()}.mp4`,
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: false, error: data.error || `HTTP ${res.status}` }
    }

    const data = await res.json()
    if (!data.ok) return { ok: false, error: data.error }

    return { ok: true, url: data.url }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
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
    const token = await getUploadToken()
    if (!token) return { ok: false, error: SESSION_EXPIRED }

    const fd = new FormData()
    fd.append('file', blob, filename || `video-${Date.now()}.mp4`)

    const url = await new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/public/r2-upload')
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
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
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
