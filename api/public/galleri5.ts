import type { VercelRequest, VercelResponse } from '@vercel/node'

const G5_BACKEND = 'https://aistudio-backend.calmdesert-ca599847.centralindia.azurecontainerapps.io'

async function fetchWithRetry(url: string, opts: RequestInit, retries = 2, delayMs = 1500): Promise<Response> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, opts)
    } catch (e: any) {
      lastErr = e
      const msg = (e.message || '').toLowerCase()
      const isRetryable = msg.includes('fetch failed') || msg.includes('network') || msg.includes('econnreset') || msg.includes('timeout') || msg.includes('socket hang up')
      console.log(`[g5Fetch] retry ${attempt + 1}/${retries}: ${e.message}`)
      if (isRetryable && attempt < retries) {
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)))
        continue
      }
      throw e
    }
  }
  throw lastErr ?? new Error('fetch gagal')
}

async function g5Fetch(
  path: string,
  headers: Record<string, string>,
  options: { method?: string; body?: any; timeout?: number } = {}
): Promise<any> {
  const { method = 'GET', body, timeout = 30000 } = options
  const fetchOpts: RequestInit = {
    method,
    headers: { ...headers },
    signal: AbortSignal.timeout(timeout),
  }
  if (body && method !== 'GET') {
    fetchOpts.body = JSON.stringify(body)
  }
  const res = await fetchWithRetry(`${G5_BACKEND}${path}`, fetchOpts, 2, 1500)
  const text = await res.text()
  let data: any = null
  try { data = JSON.parse(text) } catch { data = text }
  console.log(`[g5Fetch] ${method} ${path} → ${res.status}`, text.slice(0, 500))
  if (!res.ok) {
    let detail: string
    if (typeof data === 'object' && data !== null) {
      const raw = data.detail || data.message || data.error || ''
      detail = typeof raw === 'object' ? JSON.stringify(raw) : String(raw)
    } else {
      detail = String(data).slice(0, 200)
    }
    throw new Error(`G5 HTTP ${res.status}: ${detail || 'request gagal'}`)
  }
  return data
}

function parseAuthHeaders(raw: any): Record<string, string> {
  if (!raw) throw new Error('Missing authHeaders')
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { throw new Error('authHeaders: JSON parse gagal') }
  }
  if (typeof raw === 'object') return raw
  throw new Error('authHeaders: format tidak dikenal')
}

function buildHeaders(authHeaders: Record<string, string>, orgId?: string | null): Record<string, string> {
  // Extract only Authorization from authHeaders — ignore extra headers from client
  const auth = authHeaders['Authorization'] || authHeaders['authorization'] || ''
  const h: Record<string, string> = { Accept: '*/*' }
  if (auth) h['Authorization'] = auth
  if (orgId) h['x-organization-id'] = orgId
  return h
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  try {
    const body = req.body || {}
    const { action } = body

    if (!action) {
      return res.status(400).json({ ok: false, error: 'Missing action' })
    }

    // ─── INFO (cek akun / balance) ───────────────────────────────────
    if (action === 'info') {
      const authHeaders = parseAuthHeaders(body.authHeaders)
      console.log(`[galleri5-proxy] info`)
      const headers = buildHeaders(authHeaders)
      headers['Content-Type'] = 'application/json'
      const data = await g5Fetch('/api/v1/auth/me/info', headers, {
        method: 'POST',
        body: {},
        timeout: 15000,
      })
      return res.json({ ok: true, data })
    }

    // ─── SUBMIT (kirim task generate) ────────────────────────────────
    if (action === 'submit') {
      const authHeaders = parseAuthHeaders(body.authHeaders)
      const { payload, orgId } = body
      if (!payload) return res.status(400).json({ ok: false, error: 'Missing payload' })

      console.log(`[galleri5-proxy] submit → ${payload.model_path}`)
      const headers = buildHeaders(authHeaders, orgId)
      headers['Content-Type'] = 'application/json'

      const data = await g5Fetch('/api/v1/model-garden/submit-form-stream', headers, {
        method: 'POST',
        body: payload,
        timeout: 120000,
      })
      console.log(`[galleri5-proxy] submit → done`, JSON.stringify(data).slice(0, 300))
      return res.json({ ok: true, data })
    }

    // ─── STATUS (poll hasil) ─────────────────────────────────────────
    if (action === 'status') {
      const authHeaders = parseAuthHeaders(body.authHeaders)
      const { taskId, orgId } = body
      if (!taskId) return res.status(400).json({ ok: false, error: 'Missing taskId' })

      console.log(`[galleri5-proxy] status → ${String(taskId).slice(0, 20)}...`)
      const data = await g5Fetch(
        `/api/v1/unit-sessions/${encodeURIComponent(taskId)}`,
        buildHeaders(authHeaders, orgId),
        { timeout: 15000 }
      )
      // latest_inference berisi status & result
      const inference = data?.latest_inference ?? data
      return res.json({ ok: true, data: inference })
    }

    // ─── SESSION CREATE ──────────────────────────────────────────────
    if (action === 'session-create') {
      const authHeaders = parseAuthHeaders(body.authHeaders)
      const { payload, orgId } = body
      if (!payload) return res.status(400).json({ ok: false, error: 'Missing payload' })

      console.log(`[galleri5-proxy] session-create → ${payload.name || 'unnamed'}`)
      const headers = buildHeaders(authHeaders, orgId)
      headers['Content-Type'] = 'application/json'

      const data = await g5Fetch('/api/v1/unit-sessions', headers, {
        method: 'POST',
        body: payload,
        timeout: 30000,
      })
      return res.json({ ok: true, data })
    }

    // ─── SESSION LINK (hubungkan upload ke session) ──────────────────
    if (action === 'session-link') {
      const authHeaders = parseAuthHeaders(body.authHeaders)
      const { uploadIds, sessionId, orgId } = body
      if (!uploadIds || !sessionId) {
        return res.status(400).json({ ok: false, error: 'Missing uploadIds or sessionId' })
      }

      console.log(`[galleri5-proxy] session-link → ${uploadIds.length} uploads`)
      const headers = buildHeaders(authHeaders, orgId)
      headers['Content-Type'] = 'application/json'

      const data = await g5Fetch('/api/v1/uploads/link-session', headers, {
        method: 'PATCH',
        body: { upload_ids: uploadIds, session_id: sessionId },
        timeout: 30000,
      })
      return res.json({ ok: true, data })
    }

    // ─── ESTIMATE ( perkiraan credit ) ───────────────────────────────
    if (action === 'estimate') {
      const authHeaders = parseAuthHeaders(body.authHeaders)
      const { modelPath, formFields, orgId } = body
      if (!modelPath) return res.status(400).json({ ok: false, error: 'Missing modelPath' })

      console.log(`[galleri5-proxy] estimate → ${modelPath}`)
      const headers = buildHeaders(authHeaders, orgId)
      headers['Content-Type'] = 'application/json'

      const data = await g5Fetch('/api/v1/model-garden/estimate-credits', headers, {
        method: 'POST',
        body: { model_path: modelPath, form_fields: formFields || {} },
        timeout: 15000,
      })
      return res.json({ ok: true, data })
    }

    // ─── UPLOAD (upload file ke G5 backend) ──────────────────────────
    if (action === 'upload') {
      const authHeaders = parseAuthHeaders(body.authHeaders)
      const { fileUrl, fileName, contentType, orgId } = body
      if (!fileUrl) return res.status(400).json({ ok: false, error: 'Missing fileUrl' })

      console.log(`[galleri5-proxy] upload → ${fileName || 'file'} (url: ${fileUrl.slice(0, 80)})`)

      // Helper: fetch with retry for network errors
      async function fetchWithRetry(url: string, opts: RequestInit, retries = 2, delayMs = 1500): Promise<Response> {
        let lastErr: Error | null = null
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            return await fetch(url, opts)
          } catch (e: any) {
            lastErr = e
            const msg = (e.message || '').toLowerCase()
            const isRetryable = msg.includes('fetch failed') || msg.includes('network') || msg.includes('econnreset') || msg.includes('timeout') || msg.includes('socket hang up')
            console.log(`[galleri5-proxy] fetch retry ${attempt + 1}/${retries}: ${e.message}`)
            if (isRetryable && attempt < retries) {
              await new Promise(r => setTimeout(r, delayMs * (attempt + 1)))
              continue
            }
            throw e
          }
        }
        throw lastErr ?? new Error('fetch gagal')
      }

      // Download file dari URL lalu upload ke G5
      let fileRes: Response
      try {
        fileRes = await fetchWithRetry(fileUrl, { 
          signal: AbortSignal.timeout(60000),
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0' }
        }, 2, 2000)
      } catch (e: any) {
        console.log(`[galleri5-proxy] download error: ${e.message}`)
        return res.status(200).json({ ok: false, error: `Download gagal: ${e.message}` })
      }
      if (!fileRes.ok) {
        return res.status(200).json({ ok: false, error: `Download gagal: HTTP ${fileRes.status}` })
      }
      
      const contentTypeHeader = fileRes.headers.get('content-type') || ''
      console.log(`[galleri5-proxy] downloaded: ${contentTypeHeader}, size: ${fileRes.headers.get('content-length')}`)
      
      // Check if response is HTML (tmpfiles view page - need to extract actual download URL)
      if (contentTypeHeader.includes('text/html')) {
        const html = await fileRes.text().catch(() => '')
        console.log(`[galleri5-proxy] got HTML, trying to extract download link from: ${html.slice(0, 300)}`)
        
        // Extract actual download URL from tmpfiles HTML page
        const dlMatch = html.match(/href="(https:\/\/tmpfiles\.org\/dl\/[^"]+)"/i)
        if (dlMatch) {
          const dlUrl = dlMatch[1]
          console.log(`[galleri5-proxy] extracted download URL: ${dlUrl}`)
          try {
            fileRes = await fetchWithRetry(dlUrl, { 
              signal: AbortSignal.timeout(60000),
              redirect: 'follow',
              headers: { 'User-Agent': 'Mozilla/5.0' }
            }, 2, 2000)
          } catch (e: any) {
            return res.status(200).json({ ok: false, error: `Download gagal: ${e.message}` })
          }
          if (!fileRes.ok) {
            return res.status(200).json({ ok: false, error: `Download gagal: HTTP ${fileRes.status}` })
          }
        } else {
          return res.status(200).json({ ok: false, error: `Download gagal: URL mengembalikan HTML, bukan file` })
        }
      }
      
      const fileBuffer = Buffer.from(await fileRes.arrayBuffer())
      
      // Determine content type
      const detectedType = contentType || fileRes.headers.get('content-type') || 'image/jpeg'
      const ext = fileName?.split('.').pop() || 'jpg'
      
      const headers = buildHeaders(authHeaders, orgId)
      delete headers['Content-Type'] // biar FormData yang set

      const formData = new FormData()
      const blob = new Blob([fileBuffer], { type: detectedType })
      formData.append('file', blob, fileName || `upload.${ext}`)

      let uploadRes: Response
      try {
        uploadRes = await fetchWithRetry(`${G5_BACKEND}/api/v1/file-upload`, {
          method: 'POST',
          headers,
          body: formData,
          signal: AbortSignal.timeout(120000),
        }, 2, 2000)
      } catch (e: any) {
        console.log(`[galleri5-proxy] upload to G5 error: ${e.message}`)
        return res.status(200).json({ ok: false, error: `Upload ke G5 gagal: ${e.message}` })
      }

      const text = await uploadRes.text()
      let data: any = null
      try { data = JSON.parse(text) } catch { data = text }

      if (!uploadRes.ok) {
        const detail = (typeof data === 'object' && data !== null) ? (data.detail || data.message || text.slice(0, 160)) : String(data).slice(0, 160)
        return res.status(200).json({ ok: false, error: `Upload gagal (${uploadRes.status}): ${detail}` })
      }

      const fileUrl2 = data?.file_url || data?.url
      if (!fileUrl2) {
        return res.status(200).json({ ok: false, error: `Upload gagal: file_url tidak ditemukan` })
      }

      return res.json({
        ok: true,
        data: {
          file_url: fileUrl2,
          upload_id: data?.upload_id ?? null,
        },
      })
    }

    return res.status(400).json({ ok: false, error: `Unknown action: ${action}` })
  } catch (err: any) {
    console.error(`[galleri5-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
