#!/usr/bin/env node
// Roboneo Local Proxy Server
// Jalankan: node proxy-server.js
// Akses: http://localhost:3002

import http from 'http'
import https from 'https'

const GATEWAY = 'https://ai-engine-gateway-roboneo.meitu.com/roboneo/sync/request'
const PORT = 3002

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Roboneo-Token')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  let body = ''
  for await (const chunk of req) body += chunk

  try {
    const { path, parameter } = JSON.parse(body)
    const token = req.headers['x-roboneo-token'] || ''

    console.log(`[proxy] ${path} token=${token.slice(0, 15)}...`)

    const url = `${GATEWAY}/${path}`
    const postData = JSON.stringify(parameter)

    const gatewayRes = await new Promise((resolve, reject) => {
      const u = new URL(url)
      const options = {
        hostname: u.hostname,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'access-token': token,
          'client-id': '1189857647',
          'Origin': 'https://www.roboneo.com',
          'Referer': 'https://www.roboneo.com/',
          'Content-Length': Buffer.byteLength(postData),
        },
      }

      const proxyReq = https.request(options, (proxyRes) => {
        let data = ''
        proxyRes.on('data', (chunk) => data += chunk)
        proxyRes.on('end', () => resolve(data))
      })

      proxyReq.on('error', reject)
      proxyReq.write(postData)
      proxyReq.end()
    })

    const data = JSON.parse(gatewayRes)
    console.log(`[proxy] response: error_code=${data.error_code}`)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: data.error_code === 0, data }))
  } catch (err) {
    console.error('[proxy] error:', err.message)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: err.message }))
  }
})

server.listen(PORT, () => {
  console.log(`\n🚀 Roboneo Proxy running at http://localhost:${PORT}`)
  console.log(`   Akses dari browser: http://localhost:${PORT}/api/public/roboneo`)
  console.log(`\n   Untuk test:`)
  console.log(`   curl -X POST http://localhost:${PORT}/api/public/roboneo \\`)
  console.log(`     -H "Content-Type: application/json" \\`)
  console.log(`     -H "X-Roboneo-Token: _v2..." \\`)
  console.log(`     -d '{"path":"vipshow","parameter":{"features":"","later_face":0}}'\n`)
})
