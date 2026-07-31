import type { VercelRequest, VercelResponse } from '@vercel/node'

const GATEWAY_URL = 'https://ai-engine-gateway-roboneo.meitu.com/roboneo/sync/request'
const TRACKING_TOKEN = '45C30555F10E49629098A75F95828DA6'
const CLIENT_ID = '1189857684'

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 3) | 8).toString(16)
  })
}

function randomHex(len = 16) {
  return Array.from({ length: len }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
}

function generateGnum() {
  const a = randomHex(14)
  return `${a}-${randomHex(15)}-${randomHex(7)}-${randomHex(7)}-${randomHex(14)}`
}

function generateRoomId() {
  const e = Math.floor(Math.random() * 1e10).toString()
  return `${Buffer.from(e).toString('base64').replace(/=/g, '')}-${Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}-${Date.now()}`
}

function extractUid(token: string): string {
  try {
    let t = token.replace(/^_v\d+/, '')
    t += '='.repeat((4 - (t.length % 4)) % 4)
    const decoded = Buffer.from(t, 'base64').toString('binary')
    const payload = decoded.split('#')[2]
    if (payload && /^\d+$/.test(payload)) return payload
  } catch {}
  return '0'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Roboneo-Token')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const token = req.headers['x-roboneo-token'] || ''

  if (!token) return res.status(400).json({ ok: false, error: 'Missing token' })

  const roomId = generateRoomId()
  const uid = extractUid(String(token))

  const tracking = {
    token: TRACKING_TOKEN,
    gid: generateGnum(),
    uid,
    trace_id: uuid(),
    client_id: CLIENT_ID,
    app_scene: 'roboneo',
    area_code: 'ID',
    lang: 'en',
    time_zone: 'Asia/Jakarta',
    tt_ttclid: '',
    tt_ttp: '',
    first_url: 'https://www.roboneo.com/home',
    page_url: 'https://www.roboneo.com/ai_flow',
    referrer: 'https://www.roboneo.com/home',
    pixel_ready: 1,
    extra: { big_data_patch: { position_type: '/ai_flow' } },
    path_scene: 'vipshow',
    room_id: roomId,
    _access_token: token,
  }

  const { _access_token, ...paramWithoutToken } = tracking

  try {
    const roboneoRes = await fetch(`${GATEWAY_URL}/vipshow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access-token': String(token),
        'client-id': CLIENT_ID,
        'Origin': 'https://www.roboneo.com',
        'Referer': 'https://www.roboneo.com/',
      },
      body: JSON.stringify({
        parameter: {
          ...paramWithoutToken,
          features: '',
          later_face: 0,
        }
      }),
    })

    const text = await roboneoRes.text()
    let data: any = null
    try { data = JSON.parse(text) } catch {}

    console.log(`[roboneo-membership] gateway ${roboneoRes.status}:`, text.slice(0, 800))

    if (data?.error_code === 98) {
      return res.status(200).json({
        ok: false,
        error_code: 98,
        error: data?.error_msg || 'Token rejected by gateway',
        raw: text.slice(0, 500),
        data
      })
    }

    // Return full response for client-side parsing
    return res.status(200).json({
      ok: data?.error_code === 0,
      status: roboneoRes.status,
      raw: text.slice(0, 500),
      data: data
    })
  } catch (err: any) {
    console.error(`[roboneo-membership] gateway error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
