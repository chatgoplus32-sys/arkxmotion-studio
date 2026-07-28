import type { VercelRequest, VercelResponse } from '@vercel/node'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'arkxmotion-studio-secret-key-2026'

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function verifyAdmin(req: VercelRequest): boolean {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return false
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { role: string }
    return decoded.role === 'admin'
  } catch {
    return false
  }
}

interface ProviderStatus {
  name: string
  status: 'online' | 'slow' | 'offline' | 'no_config'
  latency: number | null
  message: string
  lastCheck: string
}

async function checkRoboneo(): Promise<ProviderStatus> {
  const start = Date.now()
  try {
    const res = await fetch('https://ai-engine-gateway-roboneo.meitu.com/roboneo/sync/request/vipshow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://www.roboneo.com',
        'Referer': 'https://www.roboneo.com/',
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10000),
    })
    const latency = Date.now() - start
    const data = await res.json()

    if (res.ok || data.error_code) {
      return {
        name: 'Roboneo',
        status: latency > 5000 ? 'slow' : 'online',
        latency,
        message: data.error_code ? `Error code: ${data.error_code}` : 'Server responds OK',
        lastCheck: new Date().toISOString(),
      }
    }

    return {
      name: 'Roboneo',
      status: 'offline',
      latency,
      message: `HTTP ${res.status}`,
      lastCheck: new Date().toISOString(),
    }
  } catch (err: any) {
    return {
      name: 'Roboneo',
      status: 'offline',
      latency: Date.now() - start,
      message: err.message || 'Connection failed',
      lastCheck: new Date().toISOString(),
    }
  }
}

async function checkFramia(): Promise<ProviderStatus> {
  const start = Date.now()
  try {
    const res = await fetch('https://aacreative.vercel.app/framia/video/api/v1/user/credits', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    const latency = Date.now() - start

    if (res.ok || res.status === 401 || res.status === 403 || res.status === 404) {
      return {
        name: 'Framia',
        status: latency > 5000 ? 'slow' : 'online',
        latency,
        message: res.ok ? 'Server responds OK' : `HTTP ${res.status} (server aktif, butuh API key)`,
        lastCheck: new Date().toISOString(),
      }
    }

    return {
      name: 'Framia',
      status: 'offline',
      latency,
      message: `HTTP ${res.status}`,
      lastCheck: new Date().toISOString(),
    }
  } catch (err: any) {
    return {
      name: 'Framia',
      status: 'offline',
      latency: Date.now() - start,
      message: err.message || 'Connection failed',
      lastCheck: new Date().toISOString(),
    }
  }
}

async function checkWeavy(): Promise<ProviderStatus> {
  const start = Date.now()
  try {
    const res = await fetch('https://app.weavy.ai', {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    })
    const latency = Date.now() - start

    if (res.ok || res.status === 403 || res.status === 401) {
      return {
        name: 'Weavy',
        status: latency > 5000 ? 'slow' : 'online',
        latency,
        message: res.ok ? 'Server OK' : `HTTP ${res.status} (server aktif, butuh login)`,
        lastCheck: new Date().toISOString(),
      }
    }

    return {
      name: 'Weavy',
      status: 'offline',
      latency,
      message: `HTTP ${res.status}`,
      lastCheck: new Date().toISOString(),
    }
  } catch (err: any) {
    return {
      name: 'Weavy',
      status: 'offline',
      latency: Date.now() - start,
      message: err.message || 'Connection failed',
      lastCheck: new Date().toISOString(),
    }
  }
}

async function checkCreatePulse(): Promise<ProviderStatus> {
  const start = Date.now()
  try {
    const res = await fetch('https://createpulse.online/api', {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    })
    const latency = Date.now() - start

    if (res.ok || res.status === 401 || res.status === 403 || res.status === 404) {
      return {
        name: 'CreatePulse',
        status: latency > 5000 ? 'slow' : 'online',
        latency,
        message: res.ok ? 'Server OK' : `HTTP ${res.status} (server aktif)`,
        lastCheck: new Date().toISOString(),
      }
    }

    return {
      name: 'CreatePulse',
      status: 'offline',
      latency,
      message: `HTTP ${res.status}`,
      lastCheck: new Date().toISOString(),
    }
  } catch (err: any) {
    return {
      name: 'CreatePulse',
      status: 'offline',
      latency: Date.now() - start,
      message: err.message || 'Connection failed',
      lastCheck: new Date().toISOString(),
    }
  }
}



export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!verifyAdmin(req)) return res.status(403).json({ error: 'Admin access required' })

  try {
    const [roboneo, framia, weavy, createpulse] = await Promise.all([
      checkRoboneo(),
      checkFramia(),
      checkWeavy(),
      checkCreatePulse(),
    ])

    const allStatuses = [roboneo, framia, weavy, createpulse]
    const overallStatus = allStatuses.every(s => s.status === 'online')
      ? 'online'
      : allStatuses.some(s => s.status === 'offline')
        ? 'degraded'
        : 'partial'

    return res.status(200).json({
      overall: overallStatus,
      providers: allStatuses,
      checkedAt: new Date().toISOString(),
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
