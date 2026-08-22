import type { Plugin } from 'vite'

const VERCEL_ORIGIN = 'https://arkxmotion-studio.vercel.app'

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
        const apiKey = req.headers['x-api-key'] || 'cp_26YvEv7Sgi039yiB50cZYwPRfikmClvj'

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

        console.log(`[leonardo-proxy] POST → ${VERCEL_ORIGIN}/api/public/leonardo`)

        try {
          const leoRes = await fetch(`${VERCEL_ORIGIN}/api/public/leonardo`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: String(auth),
            },
            body: rawBody,
          })

          const leoText = await leoRes.text()
          console.log(`[leonardo-proxy] ${leoRes.status}:`, leoText.slice(0, 500))

          res.writeHead(leoRes.status, {
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
          const upstreamRes = await fetch(urlParam, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Accept': '*/*',
            },
            redirect: 'follow',
          })
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

      // Catch-all untuk endpoint /api/public/* lain (galleri5, magnific,
      // weavy, uploads, shotstack, creatomate, roboneo-membership, dsb)
      // → diteruskan ke deployment Vercel. Spesifik handler di atas menang duluan.
      server.middlewares.use('/api/public', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Roboneo-Token, X-Firefly-Token, X-Firefly-Api-Key, X-Firefly-Account, X-Firefly-Session',
          })
          res.end()
          return
        }

        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
          const rawBody = Buffer.concat(chunks)

          // Connect menghapus prefix mount ('/api/public') dari req.url, jadi tambahkan lagi
          const url = new URL(`/api/public${req.url || '/'}`, VERCEL_ORIGIN)
          const headers: Record<string, string> = {
            'Content-Type': req.headers['content-type'] || 'application/json',
          }
          if (req.headers.authorization) headers['Authorization'] = String(req.headers.authorization)
          for (const h of ['x-roboneo-token', 'x-firefly-token', 'x-firefly-api-key', 'x-firefly-account', 'x-firefly-session', 'x-api-key']) {
            const v = req.headers[h]
            if (v) headers[h] = String(v)
          }

          console.log(`[public-proxy] ${req.method} ${req.url} → ${VERCEL_ORIGIN}`)

          const upstream = await fetch(url.toString(), {
            method: req.method,
            headers,
            body: req.method === 'GET' ? undefined : rawBody,
          })

          const text = await upstream.text()
          res.writeHead(upstream.status, {
            'Content-Type': upstream.headers.get('content-type') || 'application/json',
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
