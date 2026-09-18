import type { Plugin } from 'vite'
import http from 'http'

const VERCEL_ORIGIN = 'https://arkxmotion-studio.vercel.app'
const LOCAL_ORIGIN = 'http://127.0.0.1:6000'

// Dev: Express lokal (:6000, `npm run dev:server`) dulu — deploy Vercel
// production sedang 402 (spend cap), jadi Vercel hanya fallback terakhir.
//
// Catatan: JANGAN pakai fetch() ke :6000 — undici/Chrome menganggap 6000
// "bad port" (daftar port X11 yang diblokir), jadi request lokal selalu
// gagal "fetch failed". Pakai http.request yang tidak punya batasan itu.
function forwardLocal(path: string, method: string, headers: Record<string, string>, body?: Buffer): Promise<{ status: number; text: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const proxyReq = http.request(
      { host: '127.0.0.1', port: 6000, path, method, headers },
      (proxyRes) => {
        const chunks: Buffer[] = []
        proxyRes.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
        proxyRes.on('end', () => resolve({
          status: proxyRes.statusCode || 500,
          text: Buffer.concat(chunks).toString(),
          contentType: String(proxyRes.headers['content-type'] || 'application/json'),
        }))
      },
    )
    proxyReq.on('error', reject)
    proxyReq.setTimeout(30000, () => proxyReq.destroy(new Error('local timeout')))
    if (body && body.length && method !== 'GET' && method !== 'HEAD') proxyReq.write(body)
    proxyReq.end()
  })
}

async function forwardApi(path: string, init: { method?: string; headers?: Record<string, string>; body?: Buffer | string }): Promise<{ status: number; text: string; contentType: string }> {
  const method = init.method || 'GET'
  const bodyBuf = !init.body || method === 'GET' || method === 'HEAD'
    ? undefined
    : Buffer.isBuffer(init.body) ? init.body : Buffer.from(init.body)
  try {
    const local = await forwardLocal(path, method, init.headers || {}, bodyBuf)
    if (local.status !== 404 && local.status !== 405) {
      return local
    }
    console.log(`[proxy] local ${path} → ${local.status}, fallback Vercel`)
  } catch (err: any) {
    console.log(`[proxy] local ${path} unreachable (${err.message}), fallback Vercel`)
  }
  const up = await fetch(`${VERCEL_ORIGIN}${path}`, {
    method,
    headers: init.headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : bodyBuf,
  })
  return { status: up.status, text: await up.text(), contentType: up.headers.get('content-type') || 'application/json' }
}

export function roboneoProxyPlugin(): Plugin {
  return {
    name: 'roboneo-proxy',
    configureServer(server) {
      server.middlewares.use('/api/public/tiktok-download', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          })
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end('Method not allowed')
          return
        }

        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk)
          const rawBody = Buffer.concat(chunks).toString()

          console.log(`[tiktok-proxy] POST → ${VERCEL_ORIGIN}/api/public/tiktok-download`)

          const tiktokRes = await fetch(`${VERCEL_ORIGIN}/api/public/tiktok-download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: rawBody,
          })

          const tiktokText = await tiktokRes.text()
          console.log(`[tiktok-proxy] ${tiktokRes.status}:`, tiktokText.slice(0, 300))

          res.writeHead(tiktokRes.status, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          })
          res.end(tiktokText)
        } catch (err: any) {
          console.error(`[tiktok-proxy] error:`, err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })

      server.middlewares.use('/api/public/upload-catbox', async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end('Method not allowed')
          return
        }

        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk)
          const rawBody = Buffer.concat(chunks)

          const contentType = req.headers['content-type'] || ''

          const roboneoRes = await fetch(`${VERCEL_ORIGIN}/api/public/upload-catbox`, {
            method: 'POST',
            headers: {
              'Content-Type': contentType,
            },
            body: rawBody,
          })

          const roboneoText = await roboneoRes.text()
          console.log(`[upload-proxy] ${roboneoRes.status}:`, roboneoText.slice(0, 300))

          let roboneoData: any = null
          try { roboneoData = JSON.parse(roboneoText) } catch {}

          const innerData = roboneoData?.data ?? roboneoData

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            ok: roboneoRes.ok,
            status: roboneoRes.status,
            data: innerData,
          }))
        } catch (err: any) {
          console.error(`[upload-proxy] error:`, err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })

      server.middlewares.use('/backend/api/video', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': '*',
          })
          res.end()
          return
        }
        const targetUrl = `http://localhost:3000${req.url || ''}`
        try {
          const proxyRes = await fetch(targetUrl)
          const headers: Record<string, string> = {
            'Content-Type': proxyRes.headers.get('content-type') || 'video/mp4',
            'Access-Control-Allow-Origin': '*',
          }
          const contentLength = proxyRes.headers.get('content-length')
          if (contentLength) headers['Content-Length'] = contentLength
          res.writeHead(proxyRes.status, headers)
          if (proxyRes.body) {
            const reader = proxyRes.body.getReader()
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              res.write(value)
            }
          }
          res.end()
        } catch (err: any) {
          console.error(`[video-proxy] error:`, err.message)
          res.writeHead(502)
          res.end('Video proxy error')
        }
      })

      // ─── Framia direct proxy (for /framia/video/api paths used by Framia.tsx) ──
      server.middlewares.use('/framia/video/api', async (req, res) => {
        const auth = req.headers.authorization || ''
        const upstreamPath = req.url || '/'
        const upstreamUrl = `https://api.framia.pro/video/api${upstreamPath}`
        console.log(`[framia-direct] ${req.method} ${upstreamPath} → api.framia.pro`)
        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk)
          const rawBody = Buffer.concat(chunks).toString()
          const framiaRes = await fetch(upstreamUrl, {
            method: req.method,
            headers: {
              'Content-Type': 'application/json',
              Authorization: String(auth),
            },
            body: req.method === 'POST' ? rawBody : undefined,
          })
          const text = await framiaRes.text()
          console.log(`[framia-direct] ${framiaRes.status}:`, text.slice(0, 300))
          res.writeHead(framiaRes.status, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          })
          res.end(text)
        } catch (err: any) {
          console.error(`[framia-direct] error:`, err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })

      server.middlewares.use('/api/public/framia', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          })
          res.end()
          return
        }

        const urlObj = new URL(req.url || '', 'http://localhost')
        const subpath = urlObj.searchParams.get('path') || ''
        const auth = req.headers.authorization || ''

        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk)
        const rawBody = Buffer.concat(chunks).toString()

        const authPreview = String(auth).slice(0, 40) + '...'
        console.log(`[framia-proxy] ${req.method} ${subpath} → direct api.framia.pro | auth: ${authPreview}`)

        const FRAMIA_DIRECT = 'https://api.framia.pro/video/api'
        try {
          const upstreamUrl = `${FRAMIA_DIRECT}/${subpath}`

          const framiaRes = await fetch(upstreamUrl, {
            method: req.method,
            headers: {
              'Content-Type': 'application/json',
              Authorization: String(auth),
            },
            body: req.method === 'POST' ? rawBody : undefined,
          })

          const framiaText = await framiaRes.text()
          console.log(`[framia-proxy] ${framiaRes.status}:`, framiaText.slice(0, 500))

          res.writeHead(framiaRes.status, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          })
          res.end(framiaText)
        } catch (err: any) {
          console.error(`[framia-proxy] error:`, err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })

      server.middlewares.use('/api/public/roboneo', async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end('Method not allowed')
          return
        }

        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk)
        const rawBody = Buffer.concat(chunks).toString()
        const token = req.headers['x-roboneo-token'] || ''

        let parsed: any = null
        try { parsed = JSON.parse(rawBody) } catch {}
        const apiPath = parsed?.path || 'unknown'

        // Direct gateway call — bypass Vercel to avoid timeout/sleep issues
        const GATEWAY_URL = 'https://ai-engine-gateway-roboneo.meitu.com/roboneo/sync/request'
        console.log(`[roboneo-proxy] ${apiPath} → DIRECT gateway (tokenLen=${String(token).length})`)

        try {
          const roboneoRes = await fetch(`${GATEWAY_URL}/${apiPath}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'access-token': String(token),
              'client-id': '1189857647',
              'Origin': 'https://www.roboneo.com',
              'Referer': 'https://www.roboneo.com/',
            },
            body: JSON.stringify({ parameter: parsed?.parameter || {} }),
          })

          const roboneoText = await roboneoRes.text()
          console.log(`[roboneo-proxy] gateway ${roboneoRes.status} ${apiPath}:`, roboneoText.slice(0, 1500))

          // Gateway returns SSE text — parse like the Vercel handler does
          let roboneoData: any = null
          const lines = roboneoText.split('\n')
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data: ')) continue
            const jsonStr = trimmed.slice(6)
            try {
              const obj = JSON.parse(jsonStr)
              if (obj.type === 'resp' || obj.task_id || obj.room_id) {
                roboneoData = obj
                break
              }
            } catch {}
          }
          if (!roboneoData) {
            try { roboneoData = JSON.parse(roboneoText) } catch {}
          }

          const innerData = roboneoData?.data ?? roboneoData

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            ok: roboneoRes.ok && !(innerData?.error_code && innerData.error_code !== 0),
            status: roboneoRes.status,
            data: innerData,
            raw: roboneoText.slice(0, 500),
          }))
        } catch (err: any) {
          console.error(`[roboneo-proxy] error:`, err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })

      // Direct roboneo-membership handler — bypass Vercel for balance checks
      server.middlewares.use('/api/public/roboneo-membership', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Roboneo-Token' })
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end('Method not allowed')
          return
        }

        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk)
        const token = req.headers['x-roboneo-token'] || ''

        if (!token) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Missing token' }))
          return
        }

        // Build vipshow request (same as Vercel handler)
        const GATEWAY_URL = 'https://ai-engine-gateway-roboneo.meitu.com/roboneo/sync/request/vipshow'
        const roomId = `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
        const uid = (() => { try { let t = String(token).replace(/^_v\d+/, ''); t += '='.repeat((4 - (t.length % 4)) % 4); const decoded = Buffer.from(t, 'base64').toString('binary'); const p = decoded.split('#')[2]; return p && /^\d+$/.test(p) ? p : '0'; } catch { return '0'; } })()
        const gid = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`

        const parameter = {
          token: '45C30555F10E49629098A75F95828DA6',
          gid,
          uid,
          trace_id: `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
          client_id: '1189857647',
          app_scene: 'roboneo',
          area_code: 'US',
          lang: 'en',
          time_zone: 'Asia/Jakarta',
          tt_ttclid: '',
          tt_ttp: '01KY0BNV4XCDZ126QDN7SYJCVB_.tt.1',
          first_url: 'https://www.roboneo.com/home',
          page_url: 'https://www.roboneo.com/ai_flow',
          referrer: 'https://www.roboneo.com/home',
          pixel_ready: 1,
          extra: { big_data_patch: { position_type: '/ai_flow' } },
          path_scene: 'vipshow',
          room_id: roomId,
          _access_token: token,
          features: '',
          later_face: 0,
        }

        console.log(`[roboneo-membership] → DIRECT gateway vipshow (tokenLen=${String(token).length})`)

        try {
          const proxyRes = await fetch(GATEWAY_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'access-token': String(token),
              'client-id': '1189857647',
              'Origin': 'https://www.roboneo.com',
              'Referer': 'https://www.roboneo.com/',
            },
            body: JSON.stringify({ parameter }),
          })
          const text = await proxyRes.text()
          console.log(`[roboneo-membership] gateway ${proxyRes.status}:`, text.slice(0, 300))

          let data: any = null
          try { data = JSON.parse(text) } catch {}

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            ok: proxyRes.ok && !(data?.error_code && data.error_code !== 0),
            status: proxyRes.status,
            raw: text.slice(0, 500),
            data: data,
          }))
        } catch (err: any) {
          console.error(`[roboneo-membership] gateway error:`, err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })

      server.middlewares.use('/api/public/createpulse', async (req, res) => {
        const urlObj = new URL(req.url || '', 'http://localhost')
        const action = urlObj.searchParams.get('action') || 'generate'
        const batchId = urlObj.searchParams.get('batchId') || ''
        const apiKey = req.headers['x-api-key'] || process.env.CREATEPULSE_API_KEY || ''

        if (req.method === 'POST' && action === 'generate') {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk)
          const rawBody = Buffer.concat(chunks).toString()

          console.log(`[createpulse-proxy] POST /api/generate`)

          try {
            const cpRes = await fetch('https://createpulse.online/api/generate', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-API-Key': String(apiKey),
              },
              body: rawBody,
            })

            const cpText = await cpRes.text()
            console.log(`[createpulse-proxy] generate ${cpRes.status}:`, cpText.slice(0, 300))

            res.writeHead(cpRes.status, { 'Content-Type': 'application/json' })
            res.end(cpText)
          } catch (err: any) {
            console.error(`[createpulse-proxy] generate error:`, err.message)
            res.writeHead(502, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: err.message }))
          }
        } else if (req.method === 'GET' && action === 'status' && batchId) {
          console.log(`[createpulse-proxy] GET /api/status?batchId=${batchId}`)

          try {
            const cpRes = await fetch(`https://createpulse.online/api/status?batchId=${batchId}`, {
              headers: { 'X-API-Key': String(apiKey) },
            })

            const cpText = await cpRes.text()
            console.log(`[createpulse-proxy] status ${cpRes.status}:`, cpText.slice(0, 300))

            res.writeHead(cpRes.status, { 'Content-Type': 'application/json' })
            res.end(cpText)
          } catch (err: any) {
            console.error(`[createpulse-proxy] status error:`, err.message)
            res.writeHead(502, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: err.message }))
          }
        } else if (req.method === 'GET' && action === 'download' && urlObj.searchParams.get('url')) {
          const targetUrl = urlObj.searchParams.get('url')!
          console.log(`[createpulse-proxy] download: ${targetUrl.slice(0, 80)}`)

          try {
            const cpRes = await fetch(targetUrl)
            const contentType = cpRes.headers.get('content-type') || 'video/mp4'
            res.writeHead(cpRes.status, {
              'Content-Type': contentType,
              'Access-Control-Allow-Origin': '*',
            })
            if (cpRes.body) {
              const reader = cpRes.body.getReader()
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                res.write(value)
              }
            }
            res.end()
          } catch (err: any) {
            console.error(`[createpulse-proxy] download error:`, err.message)
            res.writeHead(502)
            res.end('Download error')
          }
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid action or missing params' }))
        }
      })

            server.middlewares.use('/api/public/leonardo', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          })
          res.end()
          return
        }

        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk)
        const rawBody = Buffer.concat(chunks).toString()
        const auth = req.headers.authorization || ''

        console.log(`[leonardo-proxy] POST → local ${LOCAL_ORIGIN}/api/public/leonardo (fallback Vercel)`)

        try {
          const { status, text: leoText } = await forwardApi('/api/public/leonardo', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: String(auth),
            },
            body: rawBody,
          })

          console.log(`[leonardo-proxy] ${status}:`, leoText.slice(0, 500))

          res.writeHead(status, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          })
          res.end(leoText)
        } catch (err: any) {
          console.error(`[leonardo-proxy] error:`, err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })

      server.middlewares.use('/api/public/firefly', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Firefly-Token, X-Firefly-Api-Key, X-Firefly-Account, X-Firefly-Session, X-Firefly-Nonce, X-Firefly-Arp',
          })
          res.end()
          return
        }

        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk)
        const rawBody = Buffer.concat(chunks).toString()

        const token = req.headers['x-firefly-token'] || ''
        const apiKey = req.headers['x-firefly-api-key'] || 'clio-playground-web'
        const account = req.headers['x-firefly-account'] || ''
        const session = req.headers['x-firefly-session'] || ''
        const nonce = req.headers['x-firefly-nonce'] || ''
        const arpSession = req.headers['x-firefly-arp'] || ''

        console.log(`[firefly-proxy] POST → ${VERCEL_ORIGIN}/api/public/firefly`)

        try {
          const ffRes = await fetch(`${VERCEL_ORIGIN}/api/public/firefly`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Firefly-Token': String(token),
              'X-Firefly-Api-Key': String(apiKey),
              'X-Firefly-Account': String(account),
              'X-Firefly-Session': String(session),
              ...(nonce ? { 'X-Firefly-Nonce': String(nonce) } : {}),
              ...(arpSession ? { 'X-Firefly-Arp': String(arpSession) } : {}),
            },
            body: rawBody,
          })

          const ffText = await ffRes.text()
          console.log(`[firefly-proxy] ${ffRes.status}:`, ffText.slice(0, 500))

          res.writeHead(ffRes.status, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          })
          res.end(ffText)        } catch (err: any) {
          console.error(`[firefly-proxy] error:`, err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })

      // ─── OneOver proxy (Supabase edge functions) ──────────────────────
      const ONEOVER_SUPABASE_URL = 'https://mjuwtqkfhtpgavwjrual.supabase.co'
      const ONEOVER_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdXd0cWtmaHRwZ2F2d2pydWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyMzcxODgsImV4cCI6MjA4MjgxMzE4OH0.h7PCq_fZJ7JfsQtxMuqLyhSvL4JMgOvBumsw2rBwJOc'

      server.middlewares.use('/api/public/oneover', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          })
          res.end()
          return
        }

        try {
          const urlObj = new URL(req.url || '/', 'http://localhost')
          const action = urlObj.searchParams.get('action') || ''

          const auth = String(req.headers.authorization || '')
          const accessToken = auth.replace(/^Bearer\s+/i, '').trim()

          if (!accessToken) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing access token' }))
            return
          }

          const headers: Record<string, string> = {
            Authorization: `Bearer ${accessToken}`,
            apikey: ONEOVER_SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          }

          if (action === 'balance') {
            const userId = urlObj.searchParams.get('user_id') || ''
            const upstream = userId
              ? `${ONEOVER_SUPABASE_URL}/functions/v1/get-credit-balance?user_id=${encodeURIComponent(userId)}`
              : `${ONEOVER_SUPABASE_URL}/functions/v1/get-credit-balance`
            console.log(`[oneover-proxy] GET balance userId=${userId}`)
            const r = await fetch(upstream, { method: 'GET', headers })
            const text = await r.text()
            console.log(`[oneover-proxy] balance → ${r.status}: ${text.slice(0, 300)}`)
            res.writeHead(r.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
            res.end(text)
            return
          }

          if (action === 'generate') {
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
            const body = JSON.parse(Buffer.concat(chunks).toString())
            const { accessToken: _, action: __, ...submitBody } = body
            console.log(`[oneover-proxy] POST video-generate model=${submitBody.model}`)
            const r = await fetch(`${ONEOVER_SUPABASE_URL}/functions/v1/video-generate`, {
              method: 'POST',
              headers,
              body: JSON.stringify(submitBody),
              signal: AbortSignal.timeout(45000),
            })
            const text = await r.text()
            console.log(`[oneover-proxy] generate → ${r.status}`)
            res.writeHead(r.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
            res.end(text)
            return
          }

          if (action === 'poll') {
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
            const body = JSON.parse(Buffer.concat(chunks).toString())
            const { accessToken: _, action: __, pollBody, ...rest } = body
            const pollData = pollBody || rest
            console.log(`[oneover-proxy] POST video-poll`)
            const r = await fetch(`${ONEOVER_SUPABASE_URL}/functions/v1/video-poll`, {
              method: 'POST',
              headers,
              body: JSON.stringify(pollData),
              signal: AbortSignal.timeout(30000),
            })
            const text = await r.text()
            console.log(`[oneover-proxy] poll → ${r.status}`)
            res.writeHead(r.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
            res.end(text)
            return
          }

          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid action' }))
        } catch (err: any) {
          console.error(`[oneover-proxy] error:`, err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })

      // ─── Video-proxy: stream binary langsung (bukan .text()) ────────────
      // Cache Genspark session cookies per API key
      const gensparkSessionCache = new Map<string, { cookie: string; expires: number }>()

      server.middlewares.use('/api/public/video-proxy', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': '*' })
          res.end()
          return
        }
        const urlParam = new URL(req.url || '/', 'http://localhost').searchParams.get('url')
        if (!urlParam || !urlParam.startsWith('http')) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Missing or invalid url param' }))
          return
        }
        console.log(`[video-proxy-local] GET ${urlParam.slice(0, 100)}`)
        try {
          // For Genspark URLs, fetch session cookie first for file access
          const isGenspark = /genspark\.ai/i.test(urlParam)
          const apiKeyParam = new URL(req.url || '/', 'http://localhost').searchParams.get('api_key') || ''
          const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Referer': 'https://www.genspark.ai/',
          }
          if (isGenspark && apiKeyParam) {
            // Fetch session cookie (cached 30 min)
            try {
              let cached = gensparkSessionCache.get(apiKeyParam)
              if (!cached || cached.expires < Date.now()) {
                const meRes = await fetch('https://www.genspark.ai/api/tool_cli/me', {
                  headers: {
                    'X-Api-Key': apiKeyParam,
                    'X-GSK-CLI-Caps': 'video_generation',
                    'X-GSK-CLI-Version': '1.7.1',
                  },
                })
                const setCookies = meRes.headers.getSetCookie?.() || []
                const cookies = setCookies.map(sc => sc.split(';')[0]).join('; ')
                if (cookies) {
                  gensparkSessionCache.set(apiKeyParam, { cookie: cookies, expires: Date.now() + 30 * 60 * 1000 })
                  cached = gensparkSessionCache.get(apiKeyParam)
                }
              }
              if (cached) {
                headers['Cookie'] = cached.cookie
              }
            } catch (e) {
              console.warn('[video-proxy] Failed to get session cookie:', e)
            }
          }
          let upstreamRes = await fetch(urlParam, {
            headers,
            redirect: 'follow',
          })
          // If403 and is Genspark, clear cache and retry with fresh session
          if (upstreamRes.status === 403 && isGenspark && apiKeyParam) {
            gensparkSessionCache.delete(apiKeyParam)
            // Re-fetch session
            try {
              const meRes = await fetch('https://www.genspark.ai/api/tool_cli/me', {
                headers: {
                  'X-Api-Key': apiKeyParam,
                  'X-GSK-CLI-Caps': 'video_generation',
                  'X-GSK-CLI-Version': '1.7.1',
                },
              })
              const setCookies = meRes.headers.getSetCookie?.() || []
              const cookies = setCookies.map(sc => sc.split(';')[0]).join('; ')
              if (cookies) {
                headers['Cookie'] = cookies
                upstreamRes = await fetch(urlParam, { headers, redirect: 'follow' })
              }
            } catch (e) {
              console.warn('[video-proxy] Retry with fresh session failed:', e)
            }
          }
          if (!upstreamRes.ok && upstreamRes.status !== 206) {
            res.writeHead(upstreamRes.status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: `Upstream: ${upstreamRes.status}` }))
            return
          }
          const ct = upstreamRes.headers.get('content-type') || 'video/mp4'
          const cl = upstreamRes.headers.get('content-length')
          res.writeHead(upstreamRes.status, {
            'Content-Type': ct,
            'Access-Control-Allow-Origin': '*',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=300',
            ...(cl ? { 'Content-Length': cl } : {}),
          })
          const reader = upstreamRes.body?.getReader()
          if (reader) {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              res.write(value)
            }
          }
          res.end()
        } catch (err: any) {
          console.error(`[video-proxy-local] error:`, err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })

      // ─── RunningHub direct proxy ──────────────────────────
      server.middlewares.use('/api/public/runninghub', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' })
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end('Method not allowed')
          return
        }

        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk)
        const rawBody = Buffer.concat(chunks).toString()
        let parsed: any
        try { parsed = JSON.parse(rawBody) } catch {}

        const { action, apiKey, ...params } = parsed || {}
        const RUNNINGHUB_BASE = 'https://www.runninghub.ai'

        console.log(`[runninghub-proxy] action=${action}`)

        try {
          if (action === 'check-balance') {
            const r = await fetch(`${RUNNINGHUB_BASE}/uc/openapi/accountStatus`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'User-Agent': 'ArkxMotion/1.0' },
              body: JSON.stringify({ apiKey }),
            })
            const text = await r.text()
            let data: any; try { data = JSON.parse(text) } catch { data = {} }
            console.log(`[runninghub-proxy] check-balance ${r.status}:`, text.slice(0, 300))
            if (data.code !== undefined && data.code !== 0) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, balance: null, isValidUser: false, error: data.msg || 'Token tidak valid' }))
              return
            }
            const info = data?.data || {}
            const balance = info?.remainCoins !== undefined && info?.remainCoins !== null ? parseFloat(info.remainCoins) : null
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, balance, isValidUser: true }))
            return
          }

          if (action === 'query') {
            const { taskId } = params
            const r = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/query`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
              body: JSON.stringify({ taskId }),
            })
            const text = await r.text()
            let data: any; try { data = JSON.parse(text) } catch { data = {} }
            const task = data?.data || data
            const status = (task?.status || '').toUpperCase()
            const errCode = task?.errorCode || data?.errorCode || null
            if (status === 'SUCCESS' || status === 'FAILED') {
              console.log(`[runninghub-proxy] query ${taskId.slice(0, 12)}... → ${status} code=${errCode} err=${JSON.stringify(task?.errorMessage || task?.failedReason || null).slice(0, 300)}`)
            }
            const results = Array.isArray(task?.results) ? task.results : []
            const pickVid = results.find((x: any) =>
              /\.(mp4|webm|mov|m4v)$/i.test(String(x?.url || '').split('?')[0]) || /video/i.test(String(x?.outputType || '')))
            const pickImg = results.find((x: any) =>
              /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(x?.url || '').split('?')[0]) || /image/i.test(String(x?.outputType || '')))
            const videoUrl = pickVid?.url || results[0]?.url || null
            const imageUrl = pickImg?.url || null
            const progress = status === 'SUCCESS' ? 100 : status === 'RUNNING' ? (task?.progress || 50) : 0
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              ok: true,
              data: {
                taskId,
                status: status === 'SUCCESS' ? 'COMPLETED' : status === 'FAILED' ? 'FAILED' : 'RUNNING',
                videoUrl,
                imageUrl,
                code: errCode,
                progress,
                error: task?.errorMessage || task?.failedReason || null,
              }
            }))
            return
          }

          if (action === 'motion-control-v3') {
            const { imageUrl, videoUrl, characterOrientation = 'video', prompt = '', negativePrompt = '', keepOriginalSound = true } = params
            if (!imageUrl || !videoUrl) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Missing imageUrl or videoUrl' }))
              return
            }
            const body: any = { imageUrl, videoUrl, characterOrientation, prompt, keepOriginalSound }
            if (negativePrompt) body.negativePrompt = negativePrompt

            const r = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/kling-v3.0-pro/motion-control`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
              body: JSON.stringify(body),
            })
            const text = await r.text()
            console.log(`[runninghub-proxy] V3 ${r.status}:`, text.slice(0, 500))
            let data: any; try { data = JSON.parse(text) } catch { data = { raw: text } }

            const taskId = data?.taskId || data?.data?.taskId || data?.id
            if (!taskId) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: data?.errorMessage || data?.msg || 'No taskId', data }))
              return
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, data: { id: taskId, taskId, status: data?.status || 'QUEUED', provider: 'runninghub' } }))
            return
          }

          if (action === 'motion-control-v2.6-pro') {
            const { imageUrl, videoUrl, characterOrientation = 'video', prompt = '', keepOriginalSound = 'yes' } = params
            if (!imageUrl || !videoUrl) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Missing imageUrl or videoUrl' }))
              return
            }
            const r = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/kling-v2.6-pro/motion-control`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
              body: JSON.stringify({ imageUrl, videoUrl, characterOrientation, prompt, keepOriginalSound }),
            })
            const text = await r.text()
            console.log(`[runninghub-proxy] V2.6-pro ${r.status}:`, text.slice(0, 500))
            let data: any; try { data = JSON.parse(text) } catch { data = { raw: text } }

            const taskId = data?.taskId || data?.data?.taskId || data?.id
            if (!taskId) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: data?.errorMessage || 'No taskId', data }))
              return
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, data: { id: taskId, taskId, status: data?.status || 'QUEUED', provider: 'markasflow-v2' } }))
            return
          }

          if (action === 'motion-control-v2.6-std') {
            const { imageUrl, videoUrl, characterOrientation = 'video', prompt = '', keepOriginalSound = 'yes' } = params
            if (!imageUrl || !videoUrl) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Missing imageUrl or videoUrl' }))
              return
            }
            const r = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/kling-v2.6-std/motion-control`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
              body: JSON.stringify({ imageUrl, videoUrl, characterOrientation, prompt, keepOriginalSound }),
            })
            const text = await r.text()
            console.log(`[runninghub-proxy] V2.6-std ${r.status}:`, text.slice(0, 500))
            let data: any; try { data = JSON.parse(text) } catch { data = { raw: text } }

            const taskId = data?.taskId || data?.data?.taskId || data?.id
            if (!taskId) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: data?.errorMessage || 'No taskId', data }))
              return
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, data: { id: taskId, taskId, status: data?.status || 'QUEUED', provider: 'markasflow-v2' } }))
            return
          }

          // MC Ultra Fast HD workflow (2095008448978407425) — handled locally
          // so dev doesn't depend on Vercel deploy. Uploads + auto-maps nodes.
          if (action === 'motion-control-ultra-hd' || action === 'get-workflow-info') {
            const ULTRA_HD_WF = '2095008448978407425'
            const wfId = params.workflow_id || params.workflowId || ULTRA_HD_WF

            const discoverNodes = async (): Promise<any[]> => {
              let lastErr = ''
              for (const ep of [`${RUNNINGHUB_BASE}/api/openapi/getJsonApiFormat`, `${RUNNINGHUB_BASE}/openapi/getJsonApiFormat`]) {
                try {
                  const r = await fetch(ep, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({ apiKey, workflowId: wfId }),
                  })
                  const t = await r.text()
                  let d: any; try { d = JSON.parse(t) } catch { d = {} }
                  const ps = d?.data?.prompt || d?.prompt || d?.data
                  if (typeof ps === 'string' && ps.includes('class_type')) {
                    const prompt = JSON.parse(ps)
                    return Object.entries(prompt).map(([nodeId, node]: [string, any]) => ({
                      nodeId, classType: node.class_type, inputs: node.inputs || {}, title: node._meta?.title || '',
                    }))
                  }
                  lastErr = `${ep} → ${r.status}: ${t.slice(0, 200)}`
                } catch (err: any) {
                  lastErr = `${ep}: ${err.message}`
                }
              }
              console.log(`[runninghub-proxy] ultra-hd discovery failed: ${lastErr}`)
              throw new Error('node discovery failed')
            }

            if (action === 'get-workflow-info') {
              try {
                const nodes = await discoverNodes()
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, data: { workflowId: wfId, nodes } }))
              } catch (err: any) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: err.message }))
              }
              return
            }

            // motion-control-ultra-hd
            const { imageBase64, videoBase64, imageFileName = 'image.jpg', videoFileName = 'video.mp4',
              imageMimeType = 'image/jpeg', videoMimeType = 'video/mp4',
              fps = 60, steps = 4, maxFrames = 120, max_frames, frameLimit } = params
            if (!imageBase64 || !videoBase64) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Missing imageBase64 or videoBase64' }))
              return
            }
            const upOne = async (b64: string, name: string, mime: string) => {
              const bin = Buffer.from(b64.includes(',') ? b64.split(',')[1] : b64, 'base64')
              const fd = new FormData()
              fd.append('file', new Blob([bin], { type: mime }), name)
              const r = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/media/upload/binary`, {
                method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: fd,
              })
              const t = await r.text()
              let d: any; try { d = JSON.parse(t) } catch { d = {} }
              const fn = d?.data?.fileName || d?.fileName
              if (!fn) throw new Error('Upload failed: ' + t.slice(0, 200))
              return fn
            }
            try {
              const imgFn = await upOne(imageBase64, imageFileName, imageMimeType)
              const vidFn = await upOne(videoBase64, videoFileName, videoMimeType)
              const effFps = Math.max(1, Math.min(60, Number(fps) || 60))
              const effSteps = Math.max(1, Math.min(100, Number(steps) || 4))
              const effMax = Math.max(1, Math.min(1000, Number(maxFrames ?? max_frames ?? frameLimit) || 120))
              // Node resmi Ultra HD: 30 = image, 33 = video (dok. workflow).
              let nodeInfoList: any[] = [
                { nodeId: '30', fieldName: 'image', fieldValue: imgFn },
                { nodeId: '33', fieldName: 'video', fieldValue: vidFn },
              ]
              try {
                const nodes = await discoverNodes()
                const nl: any[] = []
                let imgOk = false, vidOk = false
                const findKey = (inputs: any, pats: RegExp[]) => Object.keys(inputs).find((k) => pats.some((p) => p.test(k))) || null
                for (const n of nodes) {
                  const inp = n.inputs || {}
                  const tag = `${n.classType || ''} ${n.title || ''}`
                  if (!imgOk && /loadimage|image/i.test(tag)) {
                    nl.push({ nodeId: String(n.nodeId), fieldName: findKey(inp, [/image/i]) || 'image', fieldValue: imgFn })
                    imgOk = true; continue
                  }
                  if (!vidOk && /loadvideo|video/i.test(tag)) {
                    nl.push({ nodeId: String(n.nodeId), fieldName: findKey(inp, [/video/i]) || 'video', fieldValue: vidFn })
                    vidOk = true; continue
                  }
                  const fk = findKey(inp, [/^fps$/i, /frame_?rate/i])
                  if (fk) { nl.push({ nodeId: String(n.nodeId), fieldName: fk, fieldValue: String(effFps) }); continue }
                  const sk = findKey(inp, [/^steps$/i])
                  if (sk) { nl.push({ nodeId: String(n.nodeId), fieldName: sk, fieldValue: String(effSteps) }); continue }
                  const mk = findKey(inp, [/max_?frames?/i, /frame_?limit/i, /num_?frames?/i, /^frames?$/i])
                  if (mk) { nl.push({ nodeId: String(n.nodeId), fieldName: mk, fieldValue: String(effMax) }); continue }
                }
                if (imgOk && vidOk) {
                  nodeInfoList = nl
                } else {
                  // Discovery sebagian: pertahankan base 30/33, tempel extras non-image/video
                  const extras = nl.filter((e) => !/^(image|video)$/i.test(e.fieldName))
                  if (extras.length) nodeInfoList = [...nodeInfoList, ...extras]
                }
              } catch {}
              const r = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${wfId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({ nodeInfoList, instanceType: 'default', usePersonalQueue: 'false' }),
              })
              const text = await r.text()
              console.log(`[runninghub-proxy] ultra-hd ${r.status}:`, text.slice(0, 500))
              let data: any; try { data = JSON.parse(text) } catch { data = { raw: text } }
              const taskId = data?.data?.taskId || data?.taskId || data?.id
              if (!taskId) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: data?.msg || data?.message || 'No taskId', data }))
                return
              }
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true, data: { id: taskId, taskId, status: data?.data?.status || 'QUEUED', provider: 'runninghub', workflowId: wfId } }))
            } catch (err: any) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: err.message }))
            }
            return
          }

          // Virtual Try-On (2099800742046818306): node 13 = orang, 53 = pakaian
          if (action === 'submit-tryon') {
            const TRYON_WF = '2099800742046818306'
            const wfId = params.workflow_id || params.workflowId || TRYON_WF
            const { personBase64, personFileName = 'person.jpg', personMimeType = 'image/jpeg',
              garmentBase64, garmentFileName = 'garment.jpg', garmentMimeType = 'image/jpeg',
              mode = 'tryon' } = params
            if (!personBase64 || (mode === 'tryon' && !garmentBase64)) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Missing personBase64 or garmentBase64' }))
              return
            }
            const upOne = async (b64: string, name: string, mime: string) => {
              const bin = Buffer.from(b64.includes(',') ? b64.split(',')[1] : b64, 'base64')
              const fd = new FormData()
              fd.append('file', new Blob([bin], { type: mime }), name)
              const r = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/media/upload/binary`, {
                method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: fd,
              })
              const t = await r.text()
              let d: any; try { d = JSON.parse(t) } catch { d = {} }
              const fn = d?.data?.fileName || d?.fileName
              if (!fn) throw new Error('Upload failed: ' + t.slice(0, 200))
              return fn
            }
            try {
              const personFn = await upOne(personBase64, personFileName, personMimeType)
              const nodeInfoList: any[] = [{ nodeId: '13', fieldName: 'image', fieldValue: personFn }]
              if (garmentBase64) {
                const garmentFn = await upOne(garmentBase64, garmentFileName, garmentMimeType)
                nodeInfoList.push({ nodeId: '53', fieldName: 'image', fieldValue: garmentFn })
              }
              const r = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${wfId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({ nodeInfoList, instanceType: 'default', usePersonalQueue: 'false' }),
              })
              const text = await r.text()
              console.log(`[runninghub-proxy] tryon ${r.status}:`, text.slice(0, 500))
              let data: any; try { data = JSON.parse(text) } catch { data = { raw: text } }
              const taskId = data?.data?.taskId || data?.taskId || data?.id
              if (!taskId) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: data?.msg || data?.message || 'No taskId', data }))
                return
              }
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true, data: { id: taskId, taskId, status: data?.data?.status || 'QUEUED', provider: 'runninghub', workflowId: wfId } }))
            } catch (err: any) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: err.message }))
            }
            return
          }

          // H3 Audio Avatar (2099332942179229697): node 209 = foto, 215 = audio
          if (action === 'submit-audio-avatar') {
            const AVATAR_WF = '2099332942179229697'
            const wfId = params.workflow_id || params.workflowId || AVATAR_WF
            const { imageBase64, imageFileName = 'photo.jpg', imageMimeType = 'image/jpeg',
              audioBase64, audioFileName = 'audio.mp3', audioMimeType = 'audio/mpeg' } = params
            if (!imageBase64 || !audioBase64) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Missing imageBase64 or audioBase64' }))
              return
            }
            const upOne = async (b64: string, name: string, mime: string) => {
              const bin = Buffer.from(b64.includes(',') ? b64.split(',')[1] : b64, 'base64')
              const fd = new FormData()
              fd.append('file', new Blob([bin], { type: mime }), name)
              const r = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/media/upload/binary`, {
                method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: fd,
              })
              const t = await r.text()
              let d: any; try { d = JSON.parse(t) } catch { d = {} }
              const fn = d?.data?.fileName || d?.fileName
              if (!fn) throw new Error('Upload failed: ' + t.slice(0, 200))
              return fn
            }
            try {
              const imgFn = await upOne(imageBase64, imageFileName, imageMimeType)
              const audFn = await upOne(audioBase64, audioFileName, audioMimeType)
              const nodeInfoList = [
                { nodeId: '209', fieldName: 'image', fieldValue: imgFn },
                { nodeId: '215', fieldName: 'audio', fieldValue: audFn },
              ]
              const r = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${wfId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({ nodeInfoList, instanceType: 'default', usePersonalQueue: 'false' }),
              })
              const text = await r.text()
              console.log(`[runninghub-proxy] audio-avatar ${r.status}:`, text.slice(0, 500))
              let data: any; try { data = JSON.parse(text) } catch { data = { raw: text } }
              const taskId = data?.data?.taskId || data?.taskId || data?.id
              if (!taskId) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: data?.msg || data?.message || 'No taskId', data }))
                return
              }
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true, data: { id: taskId, taskId, status: data?.data?.status || 'QUEUED', provider: 'runninghub', workflowId: wfId } }))
            } catch (err: any) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: err.message }))
            }
            return
          }

          // VOSR2 Video Upscale 2K (2100537736599035906)
          if (action === 'submit-video-upscale') {
            const UPSCALE_WF = '2100537736599035906'
            const wfId = params.workflow_id || params.workflowId || UPSCALE_WF
            const ALLOWED_SCHED = new Set(['simple', 'sgm_uniform', 'karras', 'exponential', 'ddim_uniform', 'beta', 'normal', 'linear_quadratic', 'kl_optimal', 'beta57', 'gits', 'beta_1_1'])
            const { videoBase64, videoFileName = 'video.mp4', videoMimeType = 'video/mp4',
              steps = 4, cfg = 4.5, scheduler = 'beta', frameLoadCap = 0 } = params
            if (!videoBase64) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Missing videoBase64' }))
              return
            }
            const effSteps = Math.max(1, Math.min(50, Number(steps) || 4))
            const effCfg = Math.max(0, Math.min(30, Number(cfg) || 4.5))
            const effScheduler = ALLOWED_SCHED.has(String(scheduler)) ? String(scheduler) : 'beta'
            const effFrameCap = Math.max(0, Math.min(10000, Number(frameLoadCap) || 0))
            try {
              const bin = Buffer.from(videoBase64.includes(',') ? videoBase64.split(',')[1] : videoBase64, 'base64')
              const fd = new FormData()
              fd.append('file', new Blob([bin], { type: videoMimeType }), videoFileName)
              const up = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/media/upload/binary`, {
                method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: fd,
              })
              const upText = await up.text()
              let upData: any; try { upData = JSON.parse(upText) } catch { upData = {} }
              const vidFn = upData?.data?.fileName || upData?.fileName
              if (!vidFn) throw new Error('Upload failed: ' + upText.slice(0, 200))
              const baseList = [
                { nodeId: '1', fieldName: 'video', fieldValue: vidFn },
                { nodeId: '1', fieldName: 'frame_load_cap', fieldValue: String(effFrameCap) },
                { nodeId: '21', fieldName: 'cfg', fieldValue: String(effCfg) },
                { nodeId: '21', fieldName: 'scheduler', fieldValue: effScheduler },
                { nodeId: '21', fieldName: 'steps', fieldValue: String(effSteps) },
                { nodeId: '13', fieldName: 'save_output', fieldValue: 'true' },
              ]
              const postRun = async (list: any[]) => {
                const r = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${wfId}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                  body: JSON.stringify({ nodeInfoList: list, instanceType: 'default', usePersonalQueue: 'false' }),
                })
                const text = await r.text()
                console.log(`[runninghub-proxy] upscale ${r.status}:`, text.slice(0, 500))
                let data: any; try { data = JSON.parse(text) } catch { data = { raw: text } }
                return {
                  data,
                  code: data?.code ?? data?.errorCode,
                  msg: String(data?.msg || data?.errorMessage || data?.message || ''),
                  taskId: data?.data?.taskId || data?.taskId || data?.id,
                  status: data?.data?.status || 'QUEUED',
                }
              }
              const parseMM = (msg: string) => {
                const m = /nodeId=([^,\)]+),\s*fieldName=([^,\)]+),\s*reason=([^,\)]+)/.exec(msg)
                return m ? { nodeId: m[1].trim(), fieldName: m[2].trim(), reason: m[3].trim() } : null
              }
              const ok = (taskId: string, status: string) => {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, data: { id: taskId, taskId, status, provider: 'runninghub', workflowId: wfId } }))
              }
              const fail = (error: string, data?: any) => {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error, data }))
              }
              let lastErr = 'Unknown'
              let lastData: any = null
              let done = false
              for (const vf of ['video', 'file', 'path', 'video_path', 'filename']) {
                if (done) break
                let list = baseList.map((e) =>
                  e.nodeId === '1' && /video|file|path|filename|input/i.test(e.fieldName) ? { ...e, fieldName: vf } : e,
                )
                for (let fix = 0; fix < 6 && !done; fix++) {
                  console.log(`[runninghub-proxy] upscale field=${vf} fix=${fix}`)
                  const r = await postRun(list)
                  if (r.taskId) { ok(r.taskId, r.status); done = true; break }
                  lastErr = r.msg || `Error code: ${r.code}`
                  lastData = r.data
                  const mm = r.code === 803 || (r.code as any) === '803' ? parseMM(r.msg) : null
                  if (mm && /field_not_found|node_not_found/i.test(mm.reason)) {
                    const isVideoEntry = mm.nodeId === '1' && mm.fieldName === vf
                    if (isVideoEntry) {
                      if (/field_not_found/i.test(mm.reason)) break
                      fail('Node video (1) tidak ada di workflow ini', r.data); done = true; break
                    }
                    console.log(`[runninghub-proxy] upscale buang field ${mm.nodeId}/${mm.fieldName} (${mm.reason})`)
                    list = list.filter((e) => !(String(e.nodeId) === mm.nodeId && String(e.fieldName) === mm.fieldName))
                    continue
                  }
                  fail(r.msg || 'No taskId', r.data); done = true; break
                }
              }
              if (!done) fail(`Semua kandidat field video ditolak. Terakhir: ${lastErr}`, lastData)
            } catch (err: any) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: err.message }))
            }
            return
          }

          // AI Photo Enhancer (2100619334354759681): node 642 = foto, 688 = scale_by
          if (action === 'submit-photo-enhance') {
            const ENHANCE_WF = '2100619334354759681'
            const wfId = params.workflow_id || params.workflowId || ENHANCE_WF
            const { imageBase64, imageFileName = 'photo.jpg', imageMimeType = 'image/jpeg', scaleBy = 2 } = params
            if (!imageBase64) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Missing imageBase64' }))
              return
            }
            const effScale = Math.max(1, Math.min(4, Number(scaleBy) || 2))
            try {
              const bin = Buffer.from(imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64, 'base64')
              const fd = new FormData()
              fd.append('file', new Blob([bin], { type: imageMimeType }), imageFileName)
              const up = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/media/upload/binary`, {
                method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: fd,
              })
              const upText = await up.text()
              let upData: any; try { upData = JSON.parse(upText) } catch { upData = {} }
              const imgFn = upData?.data?.fileName || upData?.fileName
              if (!imgFn) throw new Error('Upload failed: ' + upText.slice(0, 200))
              const baseList = [
                { nodeId: '642', fieldName: 'image', fieldValue: imgFn },
                { nodeId: '688', fieldName: 'scale_by', fieldValue: String(effScale) },
              ]
              const postRun = async (list: any[]) => {
                const r = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${wfId}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                  body: JSON.stringify({ nodeInfoList: list, instanceType: 'default', usePersonalQueue: 'false' }),
                })
                const text = await r.text()
                console.log(`[runninghub-proxy] enhance ${r.status}:`, text.slice(0, 500))
                let data: any; try { data = JSON.parse(text) } catch { data = { raw: text } }
                return {
                  data,
                  code: data?.code ?? data?.errorCode,
                  msg: String(data?.msg || data?.errorMessage || data?.message || ''),
                  taskId: data?.data?.taskId || data?.taskId || data?.id,
                  status: data?.data?.status || 'QUEUED',
                }
              }
              const parseMM = (msg: string) => {
                const m = /nodeId=([^,\)]+),\s*fieldName=([^,\)]+),\s*reason=([^,\)]+)/.exec(msg)
                return m ? { nodeId: m[1].trim(), fieldName: m[2].trim(), reason: m[3].trim() } : null
              }
              const ok = (taskId: string, status: string) => {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, data: { id: taskId, taskId, status, provider: 'runninghub', workflowId: wfId } }))
              }
              const fail = (error: string, data?: any) => {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error, data }))
              }
              let lastErr = 'Unknown'
              let lastData: any = null
              let done = false
              for (const vf of ['image', 'file', 'path', 'filename', 'input', 'src']) {
                if (done) break
                let list = baseList.map((e) =>
                  e.nodeId === '642' && /image|file|path|filename|input|src/i.test(e.fieldName) ? { ...e, fieldName: vf } : e,
                )
                for (let fix = 0; fix < 4 && !done; fix++) {
                  console.log(`[runninghub-proxy] enhance field=${vf} fix=${fix}`)
                  const r = await postRun(list)
                  if (r.taskId) { ok(r.taskId, r.status); done = true; break }
                  lastErr = r.msg || `Error code: ${r.code}`
                  lastData = r.data
                  const mm = r.code === 803 || (r.code as any) === '803' ? parseMM(r.msg) : null
                  if (mm && /field_not_found|node_not_found/i.test(mm.reason)) {
                    const isImageEntry = mm.nodeId === '642' && mm.fieldName === vf
                    if (isImageEntry) {
                      if (/field_not_found/i.test(mm.reason)) break
                      fail('Node image (642) tidak ada di workflow ini', r.data); done = true; break
                    }
                    console.log(`[runninghub-proxy] enhance buang field ${mm.nodeId}/${mm.fieldName} (${mm.reason})`)
                    list = list.filter((e) => !(String(e.nodeId) === mm.nodeId && String(e.fieldName) === mm.fieldName))
                    continue
                  }
                  fail(r.msg || 'No taskId', r.data); done = true; break
                }
              }
              if (!done) fail(`Semua kandidat field image ditolak. Terakhir: ${lastErr}`, lastData)
            } catch (err: any) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: err.message }))
            }
            return
          }

          // LTX-2.5 LipSync ID (2098820058905927682)
          if (action === 'submit-lipsync') {
            const LIPSYNC_WF = '2098820058905927682'
            const wfId = params.workflow_id || params.workflowId || LIPSYNC_WF
            const { imageBase64, imageFileName = 'photo.jpg', imageMimeType = 'image/jpeg',
              imageBase64_2, imageFileName2 = 'photo2.jpg', imageMimeType2 = 'image/jpeg',
              audioBase64, audioFileName = 'audio.mp3', audioMimeType = 'audio/mpeg',
              width = 1280, height = 720, fps = 30 } = params
            if (!imageBase64 || !audioBase64) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Missing imageBase64 or audioBase64' }))
              return
            }
            const effW = Math.max(64, Math.min(2048, Number(width) || 1280))
            const effH = Math.max(64, Math.min(2048, Number(height) || 720))
            const effF = Math.max(1, Math.min(60, Number(fps) || 30))
            const upOne = async (b64: string, name: string, mime: string) => {
              const bin = Buffer.from(b64.includes(',') ? b64.split(',')[1] : b64, 'base64')
              const fd = new FormData()
              fd.append('file', new Blob([bin], { type: mime }), name)
              const r = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/media/upload/binary`, {
                method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: fd,
              })
              const t = await r.text()
              let d: any; try { d = JSON.parse(t) } catch { d = {} }
              const fn = d?.data?.fileName || d?.fileName
              if (!fn) throw new Error('Upload failed: ' + t.slice(0, 200))
              return fn
            }
            try {
              const imgFn = await upOne(imageBase64, imageFileName, imageMimeType)
              const imgFn2 = imageBase64_2 ? await upOne(imageBase64_2, imageFileName2, imageMimeType2) : null
              const audFn = await upOne(audioBase64, audioFileName, audioMimeType)
              const IMG_CANDS = ['image', 'file', 'path', 'filename', 'input', 'src']
              const AUD_CANDS = ['audio', 'file', 'path', 'filename', 'input', 'src']
              const nodeField: Record<string, string> = { '23': 'image', '148': 'audio' }
              if (imgFn2) nodeField['30'] = 'image'
              const dropped = new Set<string>()
              const buildList = () => {
                const l: any[] = [
                  { nodeId: '23', fieldName: nodeField['23'], fieldValue: imgFn },
                  ...(imgFn2 ? [{ nodeId: '30', fieldName: nodeField['30'], fieldValue: imgFn2 }] : []),
                  { nodeId: '148', fieldName: nodeField['148'], fieldValue: audFn },
                  { nodeId: '14', fieldName: 'value', fieldValue: String(effW) },
                  { nodeId: '15', fieldName: 'value', fieldValue: String(effH) },
                  { nodeId: '16', fieldName: 'value', fieldValue: String(effF) },
                ]
                return dropped.size === 0 ? l : l.filter((e) => !dropped.has(`${e.nodeId}/${e.fieldName}`))
              }
              const postRun = async (list: any[]) => {
                const r = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${wfId}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                  body: JSON.stringify({ nodeInfoList: list, instanceType: 'default', usePersonalQueue: 'false' }),
                })
                const text = await r.text()
                console.log(`[runninghub-proxy] lipsync ${r.status}:`, text.slice(0, 500))
                let data: any; try { data = JSON.parse(text) } catch { data = { raw: text } }
                return {
                  data,
                  code: data?.code ?? data?.errorCode,
                  msg: String(data?.msg || data?.errorMessage || data?.message || ''),
                  taskId: data?.data?.taskId || data?.taskId || data?.id,
                  status: data?.data?.status || 'QUEUED',
                }
              }
              const parseMM = (msg: string) => {
                const m = /nodeId=([^,\)]+),\s*fieldName=([^,\)]+),\s*reason=([^,\)]+)/.exec(msg)
                return m ? { nodeId: m[1].trim(), fieldName: m[2].trim(), reason: m[3].trim() } : null
              }
              const ok = (taskId: string, status: string) => {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, data: { id: taskId, taskId, status, provider: 'runninghub', workflowId: wfId } }))
              }
              const fail = (error: string, data?: any) => {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error, data }))
              }
              let lastErr = 'Unknown'
              let lastData: any = null
              let done = false
              for (let round = 0; round < 18 && !done; round++) {
                console.log(`[runninghub-proxy] lipsync round=${round}`)
                const r = await postRun(buildList())
                if (r.taskId) { ok(r.taskId, r.status); done = true; break }
                lastErr = r.msg || `Error code: ${r.code}`
                lastData = r.data
                const mm = r.code === 803 || (r.code as any) === '803' ? parseMM(r.msg) : null
                if (mm && /field_not_found|node_not_found/i.test(mm.reason) && ['23', '30', '148'].includes(mm.nodeId)) {
                  if (/node_not_found/i.test(mm.reason)) { fail(`Node ${mm.nodeId} tidak ada di workflow ini`, r.data); done = true; break }
                  const cands = mm.nodeId === '148' ? AUD_CANDS : IMG_CANDS
                  const cur = nodeField[mm.nodeId] || ''
                  const ni = cands.indexOf(cur) + 1
                  if (ni <= 0 || ni >= cands.length) { fail(`Field ${mm.nodeId} ditolak semua kandidat. Terakhir: ${r.msg}`, r.data); done = true; break }
                  nodeField[mm.nodeId] = cands[ni]
                  console.log(`[runninghub-proxy] lipsync node ${mm.nodeId}: "${cur}" → "${cands[ni]}"`)
                  continue
                }
                if (mm && /field_not_found|node_not_found/i.test(mm.reason)) {
                  console.log(`[runninghub-proxy] lipsync buang field ${mm.nodeId}/${mm.fieldName} (${mm.reason})`)
                  dropped.add(`${mm.nodeId}/${mm.fieldName}`)
                  continue
                }
                fail(r.msg || 'No taskId', r.data); done = true; break
              }
              if (!done) fail(`Gagal submit lip-sync. Terakhir: ${lastErr}`, lastData)
            } catch (err: any) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: err.message }))
            }
            return
          }

          // Fallback: Express lokal dulu (punya semua handler runninghub
          // termasuk motion-control-ultra-hd), Vercel terakhir
          const { status, text } = await forwardApi('/api/public/runninghub', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: rawBody,
          })
          res.writeHead(status, { 'Content-Type': 'application/json' })
          res.end(text)
        } catch (err: any) {
          console.error(`[runninghub-proxy] error:`, err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })

      // ─── Genspark AI Tool API ──────────────────────────
      const GENSPARK_BASE = 'https://www.genspark.ai'

      // IMPORTANT: genspark-upload MUST be registered BEFORE genspark
      // because '/api/public/genspark' prefix matches '/api/public/genspark-upload'
      // ─── Genspark Upload (server-side to avoid CORS) ──────────
      server.middlewares.use('/api/public/genspark-upload', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key' })
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        try {
          // Step 1: Read multipart form data
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk)
          const rawBody = Buffer.concat(chunks)
          const contentType = req.headers['content-type'] || ''
          const apiKey = req.headers['x-api-key'] as string
          if (!apiKey) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing X-Api-Key' }))
            return
          }
          // Parse multipart to get file
          const boundary = contentType.split('boundary=')[1]
          if (!boundary) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'No boundary in content-type' }))
            return
          }
          const parts = rawBody.toString('binary').split('--' + boundary)
          let fileBuffer: Buffer | null = null
          let fileName = 'upload.bin'
          let fileType = 'application/octet-stream'
          for (const part of parts) {
            const headerEnd = part.indexOf('\r\n\r\n')
            if (headerEnd === -1) continue
            const header = part.substring(0, headerEnd)
            const body = part.substring(headerEnd + 4)
            if (header.includes('filename=')) {
              const fnMatch = header.match(/filename="([^"]+)"/)
              if (fnMatch) fileName = fnMatch[1]
              const ctMatch = header.match(/Content-Type:\s*(.+)/i)
              if (ctMatch) fileType = ctMatch[1].trim()
              // Remove trailing --\r\n
              const endMarker = body.lastIndexOf('\r\n')
              fileBuffer = Buffer.from(body.substring(0, endMarker), 'binary')
              break
            }
          }
          if (!fileBuffer) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'No file in request' }))
            return
          }
          console.log(`[genspark-upload] Got file: ${fileName} (${fileBuffer.length} bytes, ${fileType})`)
          // Step 2: Get presigned upload URL from Genspark (API key auth)
          const metaRes = await fetch(`${GENSPARK_BASE}/api/tool_cli/file/upload_url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey, 'X-GSK-CLI-Caps': 'video_generation', 'X-GSK-CLI-Version': '1.7.1' },
            body: JSON.stringify({ content_type: fileType, name: fileName }),
          })
          if (!metaRes.ok) {
            const errText = await metaRes.text().catch(() => '')
            console.error(`[genspark-upload] Genspark API error: ${metaRes.status}: ${errText.slice(0, 200)}`)
            res.writeHead(metaRes.status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: `Genspark API error: ${metaRes.status}` }))
            return
          }
          const meta: any = await metaRes.json()
          console.log(`[genspark-upload] get_upload_url response:`, JSON.stringify(meta).slice(0, 400))
          const data = meta?.data || meta
          const uploadUrl = data?.upload_url
          const fileWrapperUrl = data?.file_wrapper_url
          if (!uploadUrl) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'No upload URL from Genspark', data }))
            return
          }
          console.log(`[genspark-upload] Got upload URL: ${uploadUrl.substring(0, 80)}...`)
          // Step 3: Upload file to Azure Blob Storage
          const putRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': fileType, 'x-ms-blob-type': 'BlockBlob' },
            body: fileBuffer,
          })
          if (!putRes.ok) {
            const errText = await putRes.text().catch(() => '')
            console.error(`[genspark-upload] Azure upload error: ${putRes.status}: ${errText.slice(0, 200)}`)
            res.writeHead(502, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: `Azure upload failed: ${putRes.status}` }))
            return
          }
          console.log(`[genspark-upload] Upload success → ${fileWrapperUrl || uploadUrl}`)
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
          res.end(JSON.stringify({ ok: true, file_url: fileWrapperUrl || uploadUrl }))
        } catch (err: any) {
          console.error(`[genspark-upload] error:`, err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })

      // ─── Genspark AI Tool API proxy ──────────────────────────
      server.middlewares.use('/api/public/genspark', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, Authorization, Cookie, X-GSK-CLI-Caps, X-GSK-CLI-Version' })
          res.end()
          return
        }

        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk)
          const rawBody = Buffer.concat(chunks)
          const contentType = req.headers['content-type'] || ''
          const apiKeyParam = (req.headers['x-api-key'] as string) || ''
          const upstreamUrl = `${GENSPARK_BASE}${req.url || '/'}`

          console.log(`[genspark-proxy] ${req.method} ${req.url} → ${upstreamUrl}`)

          const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Origin': 'https://www.genspark.ai',
            'Referer': 'https://www.genspark.ai/',
          }
          if (contentType) headers['Content-Type'] = contentType
          if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'] as string
          if (req.headers['x-api-key']) headers['X-Api-Key'] = req.headers['x-api-key'] as string
          if (req.headers['cookie']) headers['Cookie'] = req.headers['cookie'] as string
          const caps = req.url?.includes('sb-brain') ? 'second_brain'
            : req.url?.includes('image_generation') ? 'image_generation'
            : req.url?.includes('analyze_media') ? 'video_generation'
            : 'video_generation'
          headers['X-GSK-CLI-Caps'] = caps
          headers['X-GSK-CLI-Version'] = '1.7.1'

          if ((req.url?.includes('/llm_proxy/') || req.url?.includes('/agent/ask_proxy')) && apiKeyParam) {
            // Only fetch tool_cli/me cookies if client DIDN'T already send cookies
            // Client cookies (from browser paste) take priority — they have cf_clearance
            if (!headers['Cookie']) {
              let cached = gensparkSessionCache.get(apiKeyParam)
              if (!cached || cached.expires < Date.now()) {
                try {
                  const meRes = await fetch(`${GENSPARK_BASE}/api/tool_cli/me`, {
                    headers: { 'X-Api-Key': apiKeyParam, 'X-GSK-CLI-Caps': 'video_generation', 'X-GSK-CLI-Version': '1.7.1' },
                  })
                  const setCookies = (meRes.headers as any).getSetCookie?.() || []
                  const cookies = setCookies.join('; ')
                  if (cookies) {
                    gensparkSessionCache.set(apiKeyParam, { cookie: cookies, expires: Date.now() + 30 * 60 * 1000 })
                    cached = gensparkSessionCache.get(apiKeyParam)
                    console.log(`[genspark-proxy] Got session cookie from tool_cli/me (${cookies.length} chars)`)
                  }
                } catch (e: any) {
                  console.warn('[genspark-proxy] Failed to get session cookie:', e.message)
                }
              }
              if (cached) {
                headers['Cookie'] = cached.cookie
              }
            } // end if (!headers['Cookie'])
          }

          let proxyRes = await fetch(upstreamUrl, {
            method: req.method,
            headers,
            body: req.method !== 'GET' && req.method !== 'HEAD' ? rawBody : undefined,
          })

          if (proxyRes.status === 403 && apiKeyParam) {
            gensparkSessionCache.delete(apiKeyParam)
            try {
              const meRes = await fetch(`${GENSPARK_BASE}/api/tool_cli/me`, {
                headers: { 'X-Api-Key': apiKeyParam, 'X-GSK-CLI-Caps': 'video_generation', 'X-GSK-CLI-Version': '1.7.1' },
              })
              const setCookies = (meRes.headers as any).getSetCookie?.() || []
              const cookies = setCookies.join('; ')
              if (cookies) {
                gensparkSessionCache.set(apiKeyParam, { cookie: cookies, expires: Date.now() + 30 * 60 * 1000 })
                headers['Cookie'] = cookies
                console.log(`[genspark-proxy] Retry with fresh session cookie`)
                proxyRes = await fetch(upstreamUrl, {
                  method: req.method,
                  headers,
                  body: req.method !== 'GET' && req.method !== 'HEAD' ? rawBody : undefined,
                })
              }
            } catch (e: any) {
              console.warn('[genspark-proxy] Retry with fresh session failed:', e.message)
            }
          }

          const ct = proxyRes.headers.get('content-type') || 'application/json'

          // SSE streaming: pipe response directly instead of buffering
          if (ct.includes('text/event-stream') || req.url?.includes('ask_proxy') || req.url?.includes('vg_tasks_status')) {
            console.log(`[genspark-proxy] SSE streaming: ${req.url}`)
            res.writeHead(proxyRes.status, {
              'Content-Type': ct,
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            })
            // Pipe the response body stream
            if (proxyRes.body) {
              const reader = proxyRes.body.getReader()
              const pump = async () => {
                while (true) {
                  const { done, value } = await reader.read()
                  if (done) { res.end(); break }
                  res.write(value)
                }
              }
              pump().catch((err) => { console.error('[genspark-proxy] SSE stream error:', err.message); res.end() })
            } else {
              const text = await proxyRes.text()
              res.end(text)
            }
          } else {
            const text = await proxyRes.text()
            console.log(`[genspark-proxy] ${proxyRes.status}: ${text.slice(0, 300)}`)
            res.writeHead(proxyRes.status, {
              'Content-Type': ct,
              'Access-Control-Allow-Origin': '*',
            })
            res.end(text)
          }
        } catch (err: any) {
          console.error(`[genspark-proxy] error:`, err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })

      // Catch-all untuk endpoint /api/public/* lain (galleri5, magnific,
      // weavy, uploads, shotstack, creatomate, roboneo-membership, dsb)
      // → diteruskan ke deployment Vercel. Spesifik handler di atas menang duluan.
      // NexaBot: proxy langsung ke Express lokal (:6000) — jangan pakai fetch()
      // karena port 6000 termasuk blocked-port WHATWG.
      server.middlewares.use('/api/public/nexabot', (req, res) => {
        const proxyReq = http.request({
          hostname: '127.0.0.1',
          port: 6000,
          path: `/api/public/nexabot${req.url || '/'}`,
          method: req.method,
          headers: { ...req.headers, host: '127.0.0.1:6000' },
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
          proxyRes.pipe(res)
        })
        proxyReq.on('error', (err) => {
          console.error(`[nexabot-proxy-local] error:`, err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        })
        req.pipe(proxyReq)
      })

      server.middlewares.use('/api/public', async (req, res, next) => {
        // Endpoint yang memang router Express lokal (bukan upstream provider)
        // diteruskan ke proxy /api → localhost:6000, jangan ke Vercel.
        if ((req.url || '').startsWith('/nexabot') || (req.url || '').startsWith('/pricing')) return next()

        if (req.method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Roboneo-Token, X-Firefly-Token, X-Firefly-Api-Key, X-Firefly-Account, X-Firefly-Session, X-Leonardo-Token, X-Leonardo-Account',
          })
          res.end()
          return
        }

        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
          const rawBody = Buffer.concat(chunks)

          // Connect menghapus prefix mount ('/api/public') dari req.url,
          // forwardApi menambahkan lagi dari path yang diberikan.
          const headers: Record<string, string> = {
            'Content-Type': req.headers['content-type'] || 'application/json',
          }
          if (req.headers.authorization) headers['Authorization'] = String(req.headers.authorization)
          for (const h of ['x-roboneo-token', 'x-firefly-token', 'x-firefly-api-key', 'x-firefly-account', 'x-firefly-session', 'x-api-key', 'x-leonardo-token']) {
            const v = req.headers[h]
            if (v) headers[h] = String(v)
          }

          console.log(`[public-proxy] ${req.method} ${req.url} → local ${LOCAL_ORIGIN} (fallback Vercel)`)

          const { status, text, contentType } = await forwardApi(`/api/public${req.url || '/'}`, {
            method: req.method,
            headers,
            body: req.method === 'GET' ? undefined : rawBody,
          })

          res.writeHead(status, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
          })
          res.end(text)
        } catch (err: any) {
          console.error(`[public-proxy] error:`, err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })
    },
  }
}
