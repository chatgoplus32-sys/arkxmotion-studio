/**
 * Genspark API Proxy — Cloudflare Worker
 * 
 * Fungsi:
 * 1. Serve halaman untuk paste cookies (GET /setup)
 * 2. Store cookies di KV (POST /api/cookies)
 * 3. Proxy request ke Genspark dengan cookies (POST /api/*)
 * 
 * Setup:
 * 1. `wrangler kv:namespace create GENSPARK_COOKIES`
 * 2. Update KV_NAMESPACE_ID di wrangler.toml
 * 3. `wrangler deploy`
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, Cookie, X-GSK-CLI-Caps, X-GSK-CLI-Version',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // ── GET /setup — Halaman paste cookies ──
    if (path === '/setup' && request.method === 'GET') {
      return new Response(setupPageHtml(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
      })
    }

    // ── POST /api/cookies — Simpan cookies ──
    if (path === '/api/cookies' && request.method === 'POST') {
      try {
        const { cookies } = await request.json()
        if (!cookies || typeof cookies !== 'string') {
          return Response.json({ error: 'Missing cookies' }, { status: 400, headers: corsHeaders })
        }
        await env.GENSPARK_COOKIES.put('session', cookies)
        return Response.json({ ok: true, length: cookies.length }, { headers: corsHeaders })
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders })
      }
    }

    // ── GET /api/cookies — Cek status cookies ──
    if (path === '/api/cookies' && request.method === 'GET') {
      const cookies = await env.GENSPARK_COOKIES.get('session')
      return Response.json({
        hasCookies: !!cookies,
        length: cookies?.length || 0,
        hasCfClearance: cookies?.includes('cf_clearance=') || false,
      }, { headers: corsHeaders })
    }

    // ── POST /api/proxy/* — Proxy ke Genspark ──
    if (path.startsWith('/api/proxy/')) {
      const cookies = await env.GENSPARK_COOKIES.get('session')
      if (!cookies) {
        return Response.json({ error: 'No cookies stored. Visit /setup first.' }, { status: 401, headers: corsHeaders })
      }

      const gensparkPath = path.replace('/api/proxy/', '/api/')
      const upstreamUrl = `https://www.genspark.ai${gensparkPath}`

      console.log(`[proxy] ${request.method} ${gensparkPath} → ${upstreamUrl}`)

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://www.genspark.ai',
        'Referer': 'https://www.genspark.ai/',
        'Cookie': cookies,
      }

      // Forward API key if provided
      const apiKey = request.headers.get('X-Api-Key')
      if (apiKey) {
        headers['X-Api-Key'] = apiKey
        headers['X-GSK-CLI-Caps'] = 'video_generation'
        headers['X-GSK-CLI-Version'] = '1.7.1'
      }

      // Forward content-type
      const ct = request.headers.get('Content-Type')
      if (ct) headers['Content-Type'] = ct

      try {
        const body = request.method !== 'GET' && request.method !== 'HEAD'
          ? await request.arrayBuffer()
          : undefined

        const upstreamRes = await fetch(upstreamUrl, {
          method: request.method,
          headers,
          body,
        })

        // Check if Cloudflare challenged us
        if (upstreamRes.status === 403) {
          const text = await upstreamRes.text()
          if (text.includes('Just a moment') || text.includes('cf-browser-verification')) {
            return Response.json({
              error: 'Cloudflare challenge — cookies may be expired. Visit /setup to update.',
              status: 403,
            }, { status: 403, headers: corsHeaders })
          }
        }

        // Stream response (handle SSE)
        const upstreamCt = upstreamRes.headers.get('content-type') || 'application/json'
        if (upstreamCt.includes('text/event-stream')) {
          return new Response(upstreamRes.body, {
            status: upstreamRes.status,
            headers: {
              'Content-Type': upstreamCt,
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache',
            },
          })
        }

        // Buffer and return
        const respBody = await upstreamRes.arrayBuffer()
        return new Response(respBody, {
          status: upstreamRes.status,
          headers: {
            'Content-Type': upstreamCt,
            'Access-Control-Allow-Origin': '*',
          },
        })
      } catch (err) {
        return Response.json({ error: err.message }, { status: 502, headers: corsHeaders })
      }
    }

    // ── Default: index page ──
    return new Response('Genspark Proxy Worker. Visit /setup to configure.', {
      headers: { 'Content-Type': 'text/plain', ...corsHeaders },
    })
  },
}

function setupPageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Genspark Proxy — Setup</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #e0e0e0; min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }
    .container { max-width: 600px; width: 100%; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; color: #fff; }
    .subtitle { color: #888; margin-bottom: 24px; font-size: 0.9rem; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 24px; margin-bottom: 16px; }
    .card h2 { font-size: 1.1rem; margin-bottom: 12px; color: #fff; }
    .steps { list-style: none; margin-bottom: 16px; }
    .steps li { padding: 8px 0; border-bottom: 1px solid #222; font-size: 0.9rem; line-height: 1.5; }
    .steps li:last-child { border-bottom: none; }
    .steps .num { display: inline-block; width: 24px; height: 24px; background: #333; border-radius: 50%; text-align: center; line-height: 24px; font-size: 0.8rem; margin-right: 8px; color: #fff; }
    textarea { width: 100%; min-height: 120px; background: #0d0d0d; border: 1px solid #333; border-radius: 8px; color: #e0e0e0; padding: 12px; font-family: monospace; font-size: 0.85rem; resize: vertical; }
    textarea:focus { outline: none; border-color: #666; }
    button { background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 12px 24px; font-size: 0.95rem; cursor: pointer; width: 100%; margin-top: 12px; }
    button:hover { background: #1d4ed8; }
    button:disabled { background: #333; cursor: not-allowed; }
    .status { margin-top: 12px; padding: 12px; border-radius: 8px; font-size: 0.9rem; display: none; }
    .status.ok { display: block; background: #0d2818; border: 1px solid #166534; color: #4ade80; }
    .status.error { display: block; background: #2d0a0a; border: 1px solid #7f1d1d; color: #f87171; }
    .status.loading { display: block; background: #1a1a2e; border: 1px solid #1e3a5f; color: #60a5fa; }
    code { background: #222; padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔑 Genspark Proxy Setup</h1>
    <p class="subtitle">Paste browser cookies untuk bypass Cloudflare</p>
    
    <div class="card">
      <h2>Cara ambil cookies:</h2>
      <ol class="steps">
        <li><span class="num">1</span> Buka <a href="https://www.genspark.ai/" target="_blank" style="color:#60a5fa">genspark.ai</a> di Chrome (pastikan <strong>sudah login</strong>)</li>
        <li><span class="num">2</span> Tekan <strong>F12</strong> → tab <strong>Network</strong></li>
        <li><span class="num">3</span> Generate video apa saja di web UI Genspak</li>
        <li><span class="num">4</span> Di Network, cari request ke <code>genspark.ai</code></li>
        <li><span class="num">5</span> Klik kanan → <strong>Copy</strong> → <strong>Copy as cURL (bash)</strong></li>
        <li><span class="num">6</span> Copy value setelah <code>-b '</code> atau <code>--cookie '</code> dari cURL command</li>
        <li><span class="num">7</span> Paste ke bawah ini</li>
      </ol>
    </div>

    <div class="card">
      <h2>Paste Cookies:</h2>
      <textarea id="cookies" placeholder="cf_clearance=...; ak_bmsc=...; _ga=..."></textarea>
      <button id="saveBtn" onclick="saveCookies()">💾 Save Cookies</button>
      <div id="status" class="status"></div>
    </div>
  </div>

  <script>
    async function saveCookies() {
      const cookies = document.getElementById('cookies').value.trim()
      const status = document.getElementById('status')
      const btn = document.getElementById('saveBtn')
      
      if (!cookies) {
        status.className = 'status error'
        status.textContent = '❌ Paste cookies dulu!'
        return
      }

      btn.disabled = true
      status.className = 'status loading'
      status.textContent = '⏳ Menyimpan...'

      try {
        const res = await fetch('/api/cookies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookies }),
        })
        const data = await res.json()
        
        if (data.ok) {
          status.className = 'status ok'
          status.textContent = '✅ Cookies tersimpan! (' + data.length + ' chars) cf_clearance: ' + (cookies.includes('cf_clearance=') ? 'YA ✅' : 'TIDAK ❌')
        } else {
          status.className = 'status error'
          status.textContent = '❌ Error: ' + (data.error || 'Unknown')
        }
      } catch (err) {
        status.className = 'status error'
        status.textContent = '❌ Network error: ' + err.message
      } finally {
        btn.disabled = false
      }
    }

    // Check current status
    fetch('/api/cookies').then(r => r.json()).then(data => {
      const status = document.getElementById('status')
      if (data.hasCookies) {
        status.className = 'status ok'
        status.textContent = '✅ Cookies active (' + data.length + ' chars) cf_clearance: ' + (data.hasCfClearance ? 'YA ✅' : 'TIDAK ❌')
      }
    })
  </script>
</body>
</html>`
}
