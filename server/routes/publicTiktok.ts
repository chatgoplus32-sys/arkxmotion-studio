import { Router, Request, Response } from 'express'

// Import video TikTok (HD tanpa watermark) untuk video referensi Motion Control.
//
// Resolver: tikwm (hdplay = HD tanpa watermark, play = tanpa watermark versi
// lebih kecil). SnapTik tidak dipanggil dari server karena /api/extract miliknya
// mewajibkan token anti-bot yang hanya bisa diselesaikan di browser.
const router = Router()

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const RESOLVE_TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 5 * 60_000

interface ResolvedVideo {
  url: string
  hd: boolean
  title: string
  author: string
  duration: number | null
  cover: string | null
}

const cache = new Map<string, { at: number; video: ResolvedVideo }>()
const inflight = new Map<string, Promise<ResolvedVideo>>()

class ResolveError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

// Menerima link penuh maupun short link (vm./vt.tiktok.com). Share text dari
// aplikasi TikTok sering membawa teks lain, jadi ambil URL pertama di dalamnya.
function extractTikTokUrl(raw: string): string | null {
  const match = raw.match(/https?:\/\/[^\s"'<>]+/i)
  const candidate = (match ? match[0] : raw.trim()).replace(/[),.;]+$/, '')
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null

  const host = parsed.hostname.toLowerCase()
  const isTikTok =
    host === 'tiktok.com' ||
    host.endsWith('.tiktok.com') ||
    host === 'douyin.com' ||
    host.endsWith('.douyin.com')
  if (!isTikTok) return null

  parsed.hash = ''
  return parsed.toString()
}

async function callTikwm(base: string, tiktokUrl: string): Promise<any | null> {
  const endpoint = new URL(base)
  endpoint.searchParams.set('url', tiktokUrl)
  endpoint.searchParams.set('hd', '1')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS)
  try {
    const res = await fetch(endpoint.toString(), {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
        'Referer': 'https://www.tikwm.com/',
      },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function resolveTikTok(tiktokUrl: string): Promise<ResolvedVideo> {
  let lastMessage = ''

  for (const base of ['https://www.tikwm.com/api/', 'https://tikwm.com/api/']) {
    const json = await callTikwm(base, tiktokUrl)
    if (!json) continue

    if (json.code !== 0 || !json.data) {
      lastMessage = typeof json.msg === 'string' ? json.msg : ''
      continue
    }

    const data = json.data
    if (Array.isArray(data.images) && data.images.length > 0) {
      throw new ResolveError('Link ini berisi foto/slide TikTok, bukan video.')
    }

    const hdUrl = typeof data.hdplay === 'string' && data.hdplay ? data.hdplay : ''
    const sdUrl = typeof data.play === 'string' && data.play ? data.play : ''
    if (!hdUrl && !sdUrl) {
      lastMessage = 'Video tanpa watermark tidak tersedia.'
      continue
    }

    return {
      url: hdUrl || sdUrl,
      hd: Boolean(hdUrl),
      title: typeof data.title === 'string' ? data.title : '',
      author: typeof data.author?.nickname === 'string' ? data.author.nickname : '',
      duration: typeof data.duration === 'number' ? data.duration : null,
      cover: typeof data.cover === 'string' ? data.cover : null,
    }
  }

  if (/private|not available|region/i.test(lastMessage)) {
    throw new ResolveError('Video tidak bisa diakses. Pastikan video publik dan tidak dibatasi wilayah.')
  }
  if (lastMessage) {
    throw new ResolveError('Video tidak ditemukan. Pastikan link benar dan video bersifat publik.')
  }
  throw new ResolveError('Gagal mengambil video TikTok. Coba lagi beberapa saat.', 502)
}

router.post('/', async (req: Request, res: Response) => {
  const raw = req.body?.url
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return res.status(400).json({ ok: false, error: 'Tempel link video TikTok terlebih dahulu.' })
  }

  const tiktokUrl = extractTikTokUrl(raw)
  if (!tiktokUrl) {
    return res.status(400).json({
      ok: false,
      error: 'Link harus dari TikTok (contoh: https://www.tiktok.com/@user/video/... atau https://vm.tiktok.com/...).',
    })
  }

  const cached = cache.get(tiktokUrl)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.status(200).json({ ok: true, ...cached.video })
  }

  try {
    let job = inflight.get(tiktokUrl)
    if (!job) {
      job = resolveTikTok(tiktokUrl).finally(() => inflight.delete(tiktokUrl))
      inflight.set(tiktokUrl, job)
    }

    const video = await job
    cache.set(tiktokUrl, { at: Date.now(), video })

    if (cache.size > 200) {
      const cutoff = Date.now() - CACHE_TTL_MS
      for (const [key, entry] of cache) {
        if (entry.at < cutoff) cache.delete(key)
      }
    }

    return res.status(200).json({ ok: true, ...video })
  } catch (err: any) {
    const status = err instanceof ResolveError ? err.status : 502
    if (status >= 500) console.error('[tiktok-download] error:', err?.message)
    return res.status(status).json({ ok: false, error: err?.message || 'Gagal mengambil video TikTok.' })
  }
})

export default router
