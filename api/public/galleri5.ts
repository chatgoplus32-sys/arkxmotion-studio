import type { VercelRequest, VercelResponse } from '@vercel/node'

const G5_BACKEND = 'https://aistudio-backend.calmdesert-ca599847.centralindia.azurecontainerapps.io'
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/anacron-334611/databases/(default)/documents'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  try {
    const { action, sessionId, payload, taskId } = req.body || {}

    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'Missing sessionId' })
    }

    if (action === 'submit') {
      if (!payload) {
        return res.status(400).json({ ok: false, error: 'Missing payload' })
      }

      console.log(`[galleri5-proxy] submit → ${payload.model_path}`)

      const apiRes = await fetch(`${G5_BACKEND}/api/v1/model-garden/submit-form-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-unit-session-id': sessionId,
          'Cookie': `unit_session_id=${sessionId}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000),
      })

      const data = await apiRes.json().catch(() => null)
      console.log(`[galleri5-proxy] submit → ${apiRes.status}`, JSON.stringify(data).slice(0, 300))

      if (!apiRes.ok) {
        return res.status(200).json({ ok: false, error: data?.message || data?.error || `HTTP ${apiRes.status}` })
      }

      return res.json({ ok: true, data })
    }

    if (action === 'status') {
      if (!taskId) {
        return res.status(400).json({ ok: false, error: 'Missing taskId' })
      }

      console.log(`[galleri5-proxy] status → ${taskId.slice(0, 20)}...`)

      // Try Firestore job document
      const docPath = `jobs/${taskId}`
      const firestoreRes = await fetch(`${FIRESTORE_BASE}/${docPath}`, {
        method: 'GET',
        signal: AbortSignal.timeout(15000),
      })

      if (firestoreRes.ok) {
        const doc = await firestoreRes.json().catch(() => null)
        if (doc) {
          // Parse Firestore document format
          const fields = doc.fields || {}
          const status = fields.status?.stringValue || ''
          const outputUrl = fields.output_url?.stringValue || fields.result_url?.stringValue || ''
          const resultUrls = fields.result_urls?.arrayValue?.values?.map((v: any) => v.stringValue) || []

          console.log(`[galleri5-proxy] firestore status: ${status}`)

          return res.json({
            ok: true,
            data: {
              status,
              output_url: outputUrl,
              result_url: outputUrl,
              result_urls: resultUrls,
              job_id: taskId,
              raw: fields,
            },
          })
        }
      }

      // Fallback: try G5 backend status endpoint
      console.log(`[galleri5-proxy] firestore miss, trying backend...`)
      const backendRes = await fetch(`${G5_BACKEND}/api/v1/model-garden/prediction/${taskId}`, {
        method: 'GET',
        signal: AbortSignal.timeout(15000),
      })

      const backendData = await backendRes.json().catch(() => null)
      return res.json({ ok: true, data: backendData })
    }

    return res.status(400).json({ ok: false, error: `Unknown action: ${action}` })
  } catch (err: any) {
    console.error(`[galleri5-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
