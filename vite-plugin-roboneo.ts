import type { Plugin } from 'vite'

const VERCEL_ORIGIN = 'https://aacreative.vercel.app'

export function roboneoProxyPlugin(): Plugin {
  return {
    name: 'roboneo-proxy',
    configureServer(server) {
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
    },
  }
}
