import type { VercelRequest, VercelResponse } from '@vercel/node'

const LEONARDO_API = 'https://api.leonardo.ai'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const auth = req.headers.authorization || ''
  const { action } = req.body || {}

  try {
    if (action === 'balance') {
      const token = auth.replace(/^Bearer\s+/i, '')
      const balRes = await fetch(`${LEONARDO_API}/api/rest/v1/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!balRes.ok) {
        const err = await balRes.json().catch(() => ({}))
        return res.status(balRes.status).json({ error: err.message || `HTTP ${balRes.status}` })
      }
      const balData = await balRes.json()
      const user = balData?.userDetails?.[0] || balData?.user_details?.[0] || balData
      return res.json({
        credits: user?.apiPaidTokens ?? user?.subscriptionTokens ?? null,
        subscription: user?.subscription?.plan ?? user?.tier ?? null,
      })
    }

    if (action === 'generate') {
      const { slug, prompt, width, height, duration, imageUrl } = req.body
      const token = auth.replace(/^Bearer\s+/i, '')

      const body: any = {
        model: slug,
        public: true,
        parameters: {
          prompt,
          width,
          height,
          duration,
          quantity: 1,
        },
      }

      if (imageUrl) {
        const imgRes = await fetch(imageUrl)
        const blob = await imgRes.blob()
        const formData = new FormData()
        formData.append('file', new File([blob], 'image.jpg', { type: 'image/jpeg' }))

        const uploadRes = await fetch(`${LEONARDO_API}/api/rest/v1/images`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        })
        const uploadData = await uploadRes.json()
        const imageId = uploadData?.images?.[0]?.id
        if (imageId) {
          body.parameters.guidances = {
            image_reference: [{ image: { id: imageId, type: 'UPLOADED' }, strength: 'MID' }],
          }
        }
      }

      const genRes = await fetch(`${LEONARDO_API}/v1/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          operationName: 'Generate',
          variables: { request: body },
          query: `mutation Generate($request: CreateGenerationRequest!) {
            generate(request: $request) { apiCreditCost generationId __typename }
          }`,
        }),
      })

      const genData = await genRes.json()
      const generationId = genData?.data?.generate?.generationId ||
        genData?.data?.generate?.generation_id ||
        genData?.errors?.[0]?.message

      if (!generationId) {
        return res.status(400).json({ error: 'No generationId', data: genData })
      }

      return res.json({ generationId })
    }

    if (action === 'status') {
      const { generationId } = req.body
      const token = auth.replace(/^Bearer\s+/i, '')

      const statusRes = await fetch(`${LEONARDO_API}/api/rest/v1/generations/${encodeURIComponent(generationId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })

      const statusData = await statusRes.json()
      const gen = statusData?.generations_by_pk

      if (!gen) {
        return res.json({ status: 'UNKNOWN' })
      }

      return res.json({
        status: gen.status,
        motionMP4URL: gen.motionMP4URL,
        generated_images: gen.generated_images,
      })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err: any) {
    console.error(`[leonardo-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
