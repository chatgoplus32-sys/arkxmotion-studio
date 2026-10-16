import { useState, useEffect } from 'react'
import { Loader2, Play } from 'lucide-react'

export default function VideoPlayer({ directUrl, proxyFallback, rawUrl, ratio }: { directUrl: string; proxyFallback: string; rawUrl: string; ratio?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [triedProxy, setTriedProxy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [started, setStarted] = useState(false)

  const beginPlay = () => {
    if (started) return
    setStarted(true)
    setSrc(directUrl)
    setLoading(true)
  }

  useEffect(() => {
    setStarted(false)
    setSrc(null)
    setTriedProxy(false)
    setFailed(false)
    setLoading(false)
  }, [directUrl])

  const handleError = () => {
    if (!triedProxy && directUrl !== proxyFallback) {
      setSrc(proxyFallback)
      setTriedProxy(true)
    } else {
      setFailed(true)
      setLoading(false)
    }
  }

  const aspectClass = ratio === '1:1' ? 'aspect-square' : ratio === '16:9' ? 'aspect-video' : 'aspect-[9/16]'

  return (
    <div className="relative">
      {!failed ? (
        <>
          {loading && (
            <div className={`absolute inset-0 ${aspectClass} bg-black flex items-center justify-center z-10`}>
              <Loader2 className="h-6 w-6 text-white animate-spin" />
            </div>
          )}
          {started ? (
            <video
              key={src}
              src={src!}
              controls
              playsInline
              preload="metadata"
              onError={handleError}
              onLoadedData={() => setLoading(false)}
              onCanPlay={() => setLoading(false)}
              className={`w-full ${aspectClass} object-cover bg-black`}
            />
          ) : (
            <button
              aria-label="Putar video"
              onClick={beginPlay}
              className={`w-full ${aspectClass} bg-black grid place-items-center text-white hover:bg-black/80 transition`}
            >
              <div className="grid place-items-center gap-1">
                <Play className="h-8 w-8" />
                <span className="text-[10px] text-white/60">Ketuk untuk putar</span>
              </div>
            </button>
          )}
        </>
      ) : (
        <div className={`w-full ${aspectClass} bg-black flex items-center justify-center`}>
          <div className="text-center p-4">
            <p className="text-red-400 text-xs mb-2">Gagal memuat video</p>
            <a href={rawUrl} target="_blank" rel="noreferrer" className="text-primary text-xs underline">Coba buka langsung</a>
          </div>
        </div>
      )}
    </div>
  )
}
