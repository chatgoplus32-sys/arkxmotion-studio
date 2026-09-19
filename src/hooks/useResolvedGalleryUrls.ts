import { useState, useEffect } from 'react'
import { loadVideoBlob } from '@/lib/videoStorage'

/**
 * Hook that resolves idb: marker URLs to live blob URLs.
 * Pass gallery items; returns the same items with idb: URLs replaced by playable blob URLs.
 */
export function useResolvedGalleryUrls<T extends { id: string; url: string }>(items: T[]): T[] {
  const [resolved, setResolved] = useState<T[]>(items)

  useEffect(() => {
    let cancelled = false

    async function resolve() {
      const out: T[] = []
      for (const item of items) {
        if (item.url && item.url.startsWith('idb:')) {
          const videoId = item.url.slice(4)
          try {
            const blob = await loadVideoBlob(videoId)
            if (blob && !cancelled) {
              out.push({ ...item, url: URL.createObjectURL(blob) })
              continue
            }
          } catch {}
          // IndexedDB entry missing — skip this item
          continue
        }
        out.push(item)
      }
      if (!cancelled) setResolved(out)
    }

    resolve()
    return () => { cancelled = true }
  }, [items])

  return resolved
}
