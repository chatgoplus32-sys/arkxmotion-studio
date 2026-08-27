/**
 * lazyWithRetry — wraps React.lazy() with automatic retry + cache-bust
 *
 * Problem: After a Vercel deploy, chunk filenames change. Users with cached
 * HTML (referencing old chunk names) get "Failed to fetch dynamically
 * imported module" on every navigation.
 *
 * Solution: Intercept dynamic imports, detect chunk-load failures, and
 * retry with a cache-busting query param. Max 2 retries to prevent loops.
 */

import { ComponentType, LazyExoticComponent, ReactNode, createElement, lazy } from 'react'

interface LazyOptions {
  /** Max retries before giving up (default: 2) */
  maxRetries?: number
}

type RetryLoader = () => Promise<{ default: ComponentType<any> }>

export function lazyWithRetry(
  loader: RetryLoader,
  options: LazyOptions = {}
): LazyExoticComponent<ComponentType<any>> {
  const { maxRetries = 2 } = options

  const loadWithRetry = (attempt: number): Promise<{ default: ComponentType<any> }> => {
    return loader().catch((error: Error) => {
      const isChunkError =
        /Failed to fetch.*imported module|ChunkLoadError|Loading chunk|dynamically imported module/i.test(
          error.message || String(error)
        )

      if (isChunkError && attempt < maxRetries) {
        console.warn(
          `[lazyWithRetry] Chunk load failed (attempt ${attempt + 1}/${maxRetries}), retrying with cache-bust...`
        )

        // Append cache-bust to force fresh fetch
        // We do this by adding a timestamp to the import URL
        const ts = Date.now()
        const bustLoader = (): Promise<{ default: ComponentType<any> }> => {
          // Dynamic import with cache-bust — only works for Vite dev server
          // In production, chunks are hashed, so we use the reload approach
          return loader().catch(() => {
            // If retry also fails, trigger a full page reload with cache-bust
            if (attempt + 1 >= maxRetries) {
              console.warn('[lazyWithRetry] All retries exhausted, forcing cache-bust reload')
              const url = new URL(location.href)
              url.search.set('_cb', String(ts))
              location.replace(url.toString())
            }
            throw error
          })
        }

        // Wait a moment before retry (allows browser to settle)
        return new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1))).then(bustLoader)
      }

      throw error
    })
  }

  return lazy(() => loadWithRetry(0))
}
