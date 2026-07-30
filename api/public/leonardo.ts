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
        const errText = await balRes.text().catch(() => '')
        const status = balRes.status
        if (status === 401 || status === 403) {
          return res.status(200).json({ ok: false, error: 'Token expired / tidak valid', expired: true })
        }
        if (status === 400) {
          return res.status(200).json({ ok: false, error: 'Token expired atau format tidak valid', expired: true })
        }
        return res.status(200).json({ ok: false, error: `Leonardo API ${status}: ${errText.slice(0, 100)}` })
      }
      const balData = await balRes.json()
      const user = balData?.user_details?.[0] || balData?.userDetails?.[0] || balData
      const credits = user?.paidTokens || user?.subscriptionTokens || user?.apiPaidTokens || 0
      return res.json({
        credits,
        subscription: user?.subscription?.plan ?? user?.tier ?? null,
      })
    }

    if (action === 'generate') {
      const { slug, prompt, width, height, duration, imageUrl } = req.body
      const token = auth.replace(/^Bearer\s+/i, '')
      const diags: string[] = []

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
        diags.push(`fetching image from ${imageUrl.slice(0, 80)}`)
        const imgRes = await fetch(imageUrl)
        if (!imgRes.ok) {
          diags.push(`image fetch FAILED: ${imgRes.status}`)
        } else {
          const imgBlob = await imgRes.blob()
          const ext = imageUrl.includes('.webp') ? 'webp' : imageUrl.includes('.png') ? 'png' : 'jpg'
          diags.push(`image fetched: ${imgBlob.size} bytes, ext=${ext}`)

          const arrayBuf = await imgBlob.arrayBuffer()
          const bytes = new Uint8Array(arrayBuf)
          let binary = ''
          const chunk = 32768
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
          }
          const b64 = btoa(binary)

          const initRes = await fetch(`${LEONARDO_API}/api/rest/v1/init-image`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ extension: ext }),
          })
          const initData = await initRes.json()
          diags.push(`init-image response: ${JSON.stringify(initData).slice(0, 500)}`)

          const initImage = initData?.uploadInitImage || initData?.upload_init_image || initData
          const presignedUrl = initImage?.url
          const imageId = initImage?.id

          if (presignedUrl && imageId) {
            const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
            const putRes = await fetch(presignedUrl, {
              method: 'PUT',
              headers: { 'Content-Type': mime },
              body: imgBlob,
            })
            diags.push(`PUT to S3: ${putRes.status} ${putRes.statusText}`)

            if (putRes.ok) {
              body.parameters.guidances = {
                image_reference: [{ image: { id: imageId, type: 'UPLOADED' }, strength: 'MID' }],
              }
              diags.push(`guidances SET with imageId=${imageId}`)
            } else {
              const errText = await putRes.text().catch(() => '')
              diags.push(`PUT FAILED: ${errText.slice(0, 200)}`)
            }
          } else {
            diags.push(`no presigned URL or imageId. Keys: ${Object.keys(initData || {})}`)
          }
        }
      }

      const hasGuidances = !!body.parameters.guidances
      diags.push(`submitting to GraphQL. hasGuidances=${hasGuidances}`)

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
        genData?.data?.generate?.generation_id

      if (!generationId) {
        const errMsg = genData?.errors?.[0]?.message || JSON.stringify(genData).slice(0, 300)
        return res.status(400).json({ error: 'No generationId', detail: errMsg, diags })
      }

      return res.json({ generationId, hasGuidances, diags })
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
        ...gen,
      })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err: any) {
    console.error(`[leonardo-proxy] error:`, err.message)
    return res.status(502).json({ ok: false, error: err.message })
  }
}
