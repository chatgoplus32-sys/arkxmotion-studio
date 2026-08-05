import type { Plugin } from 'vite'

const VERCEL_ORIGIN = 'https://aacreative.vercel.app'

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

        console.log(`[framia-proxy] ${req.method} ${subpath} → ${VERCEL_ORIGIN}/api/public/framia`)

        try {
          const url = new URL(`${VERCEL_ORIGIN}/api/public/framia`)
          url.searchParams.set('path', subpath)

          const framiaRes = await fetch(url.toString(), {
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

        console.log(`[roboneo-proxy] ${apiPath} → ${VERCEL_ORIGIN}/api/public/roboneo (tokenLen=${String(token).length})`)

        try {
          const roboneoRes = await fetch(`${VERCEL_ORIGIN}/api/public/roboneo`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Roboneo-Token': String(token),
            },
            body: rawBody,
          })

          const roboneoText = await roboneoRes.text()
          console.log(`[roboneo-proxy] ${roboneoRes.status}:`, roboneoText.slice(0, 500))

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
          console.error(`[roboneo-proxy] error:`, err.message)
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
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Firefly-Token, X-Firefly-Api-Key, X-Firefly-Account, X-Firefly-Session',
          })
          res.end()
          return
        }

        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk)
        const rawBody = Buffer.concat(chunks).toString()

        const token = req.headers['x-firefly-token'] || ''
        const apiKey = req.headers['x-firefly-api-key'] || 'SunbreakWebUI1'
        const account = req.headers['x-firefly-account'] || ''
        const session = req.headers['x-firefly-session'] || ''

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
            },
            body: rawBody,
          })

          const ffText = await ffRes.text()
          console.log(`[firefly-proxy] ${ffRes.status}:`, ffText.slice(0, 500))

          res.writeHead(ffRes.status, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          })
          res.end(ffText)
        } catch (err: any) {
          console.error(`[firefly-proxy] error:`, err.message)
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })
    },
  }
}
