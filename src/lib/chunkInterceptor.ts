/**
 * Chunk error interceptor — catches failed dynamic imports at the
 * network level and triggers a single cache-bust reload.
 *
 * This runs BEFORE React renders, so it catches errors that would
 * otherwise crash the entire app before ErrorBoundary can handle them.
 */

let reloaded = false

export function initChunkErrorInterceptor() {
  // Intercept failed script loads (dynamic imports)
  window.addEventListener('error', (event) => {
    // Only handle script loading errors
    const target = event.target as HTMLScriptElement
    if (target && target.tagName === 'SCRIPT' && target.src) {
      console.warn('[ChunkInterceptor] Script load failed:', target.src)
      triggerReload()
    }
  }, true) // Use capture phase to catch before React

  // Also intercept unhandled promise rejections from dynamic imports
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const msg = String(reason?.message || reason || '')
    if (/Failed to fetch.*imported module|ChunkLoadError|Loading chunk|dynamically imported module/i.test(msg)) {
      console.warn('[ChunkInterceptor] Chunk load rejection:', msg)
      event.preventDefault() // Prevent default unhandled rejection
      triggerReload()
    }
  })
}

function triggerReload() {
  if (reloaded) return // Prevent infinite loop
  reloaded = true

  // Check if we've already tried reloading in this session
  const key = 'arkx.chunk-interceptor'
  const count = parseInt(sessionStorage.getItem(key) || '0', 10)
  sessionStorage.setItem(key, String(count + 1))

  if (count < 1) {
    // First failure: simple reload
    console.warn('[ChunkInterceptor] First failure, reloading page...')
    setTimeout(() => location.reload(), 200)
  } else {
    // Second failure: cache-bust reload
    console.warn('[ChunkInterceptor] Second failure, cache-bust reload...')
    const url = new URL(location.href)
    url.search.set('_cb', String(Date.now()))
    setTimeout(() => location.replace(url.toString()), 200)
  }
}
