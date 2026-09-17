export default {
  async fetch(request, _env, _ctx) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors })

    const url = new URL(request.url)
    const path = url.searchParams.get('path')
    if (!path) return new Response(JSON.stringify({ error: 'Missing ?path=' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })

    const auth = request.headers.get('Authorization') || ''
    if (!auth) return new Response(JSON.stringify({ error: 'Missing Authorization' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })

    const target = `https://api.weavy.ai/api${path}`
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    const rawBody = hasBody ? await request.arrayBuffer() : undefined
    const incomingCt = request.headers.get('Content-Type') || ''

    const r = await fetch(target, {
      method: request.method,
      headers: {
        Authorization: auth,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': incomingCt.includes('multipart/form-data') ? incomingCt : 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
        'Sec-Ch-Ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        Origin: 'https://app.weavy.ai',
        Referer: 'https://app.weavy.ai/',
      },
      body: rawBody,
    })

    const text = await r.text()
    return new Response(text, { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
}
