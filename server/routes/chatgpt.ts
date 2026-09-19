import { Router, Request, Response } from 'express'
import https from 'https'
import http from 'http'
import { URL } from 'url'
import { authenticateToken } from '../middleware/auth.js'

const router = Router()

// ChatGPT backend API base
const CHATGPT_BASE = 'https://chatgpt.com'

// Get cookies from env
function getCookies(): string {
  return process.env.CHATGPT_COOKIES || ''
}

// Get fresh access token from ChatGPT session
async function getAccessToken(): Promise<string> {
  const cookies = getCookies()
  if (!cookies) throw new Error('CHATGPT_COOKIES not configured in .env')

  const url = new URL(`${CHATGPT_BASE}/api/auth/session`)
  const res = await fetch(url.toString(), {
    headers: {
      'Cookie': cookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    },
  })

  if (!res.ok) throw new Error(`Session fetch failed: ${res.status} ${res.statusText}`)

  const data = await res.json() as any
  if (!data.accessToken) throw new Error('No accessToken in session response (cookies may be expired)')
  return data.accessToken
}

// Generic proxy helper
async function proxyRequest(
  method: string,
  path: string,
  body?: any,
  accessToken?: string,
): Promise<{ status: number; headers: any; body: any }> {
  const cookies = getCookies()
  const url = new URL(`${CHATGPT_BASE}${path}`)

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    'Accept': 'text/event-stream',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://chatgpt.com/',
    'Origin': 'https://chatgpt.com',
    'Cookie': cookies,
  }

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`
  }

  if (body && method !== 'GET') {
    headers['Content-Type'] = 'application/json'
  }

  const fetchOpts: RequestInit = { method, headers }
  if (body && method !== 'GET') {
    fetchOpts.body = JSON.stringify(body)
  }

  const res = await fetch(url.toString(), fetchOpts)
  const text = await res.text()

  let jsonBody: any
  try { jsonBody = JSON.parse(text) } catch { jsonBody = text }

  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: jsonBody }
}

// ─── POST /api/chatgpt/chat ─── Send a message and stream response
router.post('/chat', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { message, conversationId, parentId } = req.body
    if (!message) return res.status(400).json({ error: 'message is required' })

    // Get fresh access token
    const accessToken = await getAccessToken()

    // Build conversation content parts
    const parts: any[] = [message]

    // Add images as data URL content parts (ChatGPT supports this)
    if (req.body.images && Array.isArray(req.body.images)) {
      for (const img of req.body.images) {
        // ChatGPT expects image_url type for uploaded images
        parts.push({
          asset_pointer: 'file-service://local-file',
          content_type: 'multimodal_text',
          parts: [{ type: 'image_url', image_url: { url: img } }],
        })
      }
    }

    // Build conversation payload
    const payload: any = {
      action: 'next',
      messages: [{
        id: crypto.randomUUID(),
        author: { role: 'user' },
        content: { content_type: 'text', parts: [message] },
        create_time: Date.now() / 1000,
      }],
      model: 'auto',
      parent_message_id: parentId || crypto.randomUUID(),
    }

    // If images present, attach them to the message
    if (req.body.images && req.body.images.length > 0) {
      payload.messages[0].content = {
        content_type: 'multipart',
        parts: [
          { content_type: 'text', text: message || 'Describe this image' },
          ...req.body.images.map((img: string) => ({
            content_type: 'image_url',
            image_url: { url: img },
          })),
        ],
      }
    }

    if (conversationId) {
      payload.conversation_id = conversationId
    }

    // Stream the response
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const cookies = getCookies()
    const url = new URL(`${CHATGPT_BASE}/backend-api/conversation`)

    const postBody = JSON.stringify(payload)
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
        'Accept': 'text/event-stream',
        'Cookie': cookies,
        'Origin': 'https://chatgpt.com',
        'Referer': 'https://chatgpt.com/',
        'Content-Length': Buffer.byteLength(postBody),
      },
    }

    const proxyReq = https.request(options, (proxyRes) => {
      if (proxyRes.statusCode !== 200) {
        let errorBody = ''
        proxyRes.on('data', (chunk) => { errorBody += chunk })
        proxyRes.on('end', () => {
          res.write(`data: ${JSON.stringify({ error: `ChatGPT returned ${proxyRes.statusCode}`, detail: errorBody.slice(0, 500) })}\n\n`)
          res.write('data: [DONE]\n\n')
          res.end()
        })
        return
      }

      // Stream SSE events directly to client
      proxyRes.on('data', (chunk) => {
        res.write(chunk)
      })
      proxyRes.on('end', () => {
        res.end()
      })
    })

    proxyReq.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })

    proxyReq.write(postBody)
    proxyReq.end()

  } catch (err: any) {
    console.error('[CHATGPT]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/chatgpt/conversations ─── List recent conversations
router.get('/conversations', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const accessToken = await getAccessToken()
    const result = await proxyRequest('GET', '/backend-api/conversations?offset=0&limit=20', undefined, accessToken)
    res.status(result.status).json(result.body)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/chatgpt/status ─── Check if cookies are valid
router.get('/status', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const accessToken = await getAccessToken()
    res.json({ ok: true, hasToken: !!accessToken, tokenPreview: accessToken.slice(0, 20) + '...' })
  } catch (err: any) {
    res.json({ ok: false, error: err.message })
  }
})

interface AuthRequest extends Request {
  user?: any
}

export default router
