export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    try {
      const body = await request.arrayBuffer()
      const contentType = request.headers.get('Content-Type') || 'multipart/form-data'

      const upstreamRes = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        body,
      })

      const text = await upstreamRes.text()
      console.log(`[upload-catbox] upstream ${upstreamRes.status}:`, text.slice(0, 300))

      const url = text.trim()
      if (!url.startsWith('http')) {
        return new Response(JSON.stringify({ error: `catbox: ${text.slice(0, 200)}` }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      return new Response(JSON.stringify({ ok: true, url }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    } catch (err: any) {
      console.error('[upload-catbox] error:', err.message)
      return new Response(JSON.stringify({ error: err.message }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
  },
}

interface Env {}
