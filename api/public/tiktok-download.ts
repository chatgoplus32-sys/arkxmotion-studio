import type { VercelRequest, VercelResponse } from '@vercel/node'

export const config = { maxDuration: 30 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const { url } = req.body || {}
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ ok: false, error: 'Missing url in body' })
  }

  // Normalize TikTok URL
  let tiktokUrl = url.trim()
  if (!tiktokUrl.startsWith('http')) {
    return res.status(400).json({ ok: false, error: 'Invalid URL format' })
  }

  // Extract video ID from various TikTok URL formats
  const videoIdMatch = tiktokUrl.match(/\/video\/(\d+)/) || tiktokUrl.match(/\/(\d{15,})/)
  if (!videoIdMatch) {
    return res.status(400).json({ ok: false, error: 'Tidak dapat menemukan video ID dari URL' })
  }

  try {
    // Use TikTok oEmbed API to get basic info
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(tiktokUrl)}`
    const oembedRes = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    })

    if (!oembedRes.ok) {
      return res.status(400).json({ ok: false, error: 'Video TikTok tidak ditemukan atau tidak publik' })
    }

    const oembedData = await oembedRes.json() as any

    // Method 1: Try cobalt.tools API (popular open-source video downloader)
    try {
      const cobaltRes = await fetch('https://api.cobalt.tools/api/json', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          url: tiktokUrl,
          vCodec: 'h264',
          vQuality: '720',
          aFormat: 'mp3',
          isNoTTWatermark: true,
        }),
      })

      if (cobaltRes.ok) {
        const cobaltData = await cobaltRes.json() as any
        if (cobaltData?.url) {
          return res.status(200).json({
            ok: true,
            url: cobaltData.url,
            title: oembedData?.title || 'TikTok Video',
            author: oembedData?.author_name || 'Unknown',
          })
        }
      }
    } catch {}

    // Method 2: Try tikwm.com API
    try {
      const tikwmRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`)
      if (tikwmRes.ok) {
        const tikwmData = await tikwmRes.json() as any
        if (tikwmData?.data?.play) {
          return res.status(200).json({
            ok: true,
            url: tikwmData.data.play,
            title: tikwmData.data.title || oembedData?.title || 'TikTok Video',
            author: tikwmData.data.author?.nickname || oembedData?.author_name || 'Unknown',
          })
        }
      }
    } catch {}

    return res.status(400).json({ ok: false, error: 'Gagal mengambil video. Coba paste link video langsung.' })
  } catch (err: any) {
    console.error('[tiktok-download] error:', err.message)
    return res.status(500).json({ ok: false, error: `Server error: ${err.message}` })
  }
}
