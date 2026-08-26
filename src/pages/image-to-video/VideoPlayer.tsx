import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'

export default function VideoPlayer({ directUrl, proxyFallback, rawUrl, ratio }: { directUrl: string; proxyFallback: string; rawUrl: string; ratio?: string }) {
  const [src, setSrc] = useState(directUrl)
  const [triedProxy, setTriedProxy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setSrc(directUrl)
    setTriedProxy(false)
    setFailed(false)
    setLoading(true)
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
          <video
            key={src}
            src={src}
            controls
            playsInline
            preload="metadata"
            onError={handleError}
            onLoadedData={() => setLoading(false)}
            onCanPlay={() => setLoading(false)}
            className={`w-full ${aspectClass} object-cover bg-black`}
          />
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
