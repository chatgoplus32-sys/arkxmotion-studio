/* ARKX AUTO Studio — service worker
 *
 * Tujuan: kunjungan kedua dan seterusnya jauh lebih cepat karena app shell
 * sudah tersimpan di cache, dan UI tetap terbuka saat jaringan lambat/putus.
 *
 * Strategi:
 *   - navigasi/dokumen : network-first, fallback index.html dari cache
 *   - aset app (scope) : cache-first, lalu disegarkan di latar
 *   - font & model AI  : stale-while-revalidate (cache dibatasi 40 entri)
 *   - POST / Range     : langsung ke jaringan, tidak pernah di-cache
 *
 * Daftar berkas pendamping (bundle JS, logo) TIDAK ditulis tangan: saat install
 * service worker membaca index.html dan mengambil sendiri semua `assets/...`
 * yang dirujuk. Jadi nama bundle ber-hash yang berganti tiap build tidak perlu
 * ikut diperbarui di sini — kalau ditulis tangan, precache akan diam-diam
 * melewatkan bundle baru setelah deploy.
 */
const VERSION = 'v3'
const SHELL_CACHE = `arkx-studio-shell-${VERSION}`
const EXT_CACHE = `arkx-studio-ext-${VERSION}`
const EXT_LIMIT = 40

// Berkas yang pasti ada dan tidak ber-hash.
const STATIC_FILES = [
  'index.html',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
]

const INDEX_URL = new URL('index.html', self.location.href).href
const SCOPE = self.registration.scope
const EXT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'storage.googleapis.com', 'cdn.jsdelivr.net']

async function addQuietly(cache, url) {
  try { await cache.add(new Request(url, { cache: 'reload' })) } catch (_) { /* 404 tidak mematikan install */ }
}

/** Baca index.html dan kumpulkan aset ber-hash yang dirujuknya (JS, gambar, css). */
async function discoverAssets() {
  try {
    const res = await fetch(new Request(INDEX_URL, { cache: 'reload' }))
    if (!res.ok) return []
    const html = await res.text()
    const found = new Set()
    const attr = /(?:src|href)="((?:\.\/)?assets\/[^"]+)"/g
    const cssUrl = /url\((['"]?)((?:\.\/)?assets\/[^)'"]+)\1\)/g
    let m
    while ((m = attr.exec(html))) found.add(m[1])
    while ((m = cssUrl.exec(html))) found.add(m[2])
    return [...found].map((u) => new URL(u.replace(/^\.\//, ''), INDEX_URL).href)
  } catch (_) {
    return []
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    await Promise.all(STATIC_FILES.map((f) => addQuietly(cache, new URL(f, self.location.href).href)))
    const assets = await discoverAssets()
    await Promise.all(assets.map((u) => addQuietly(cache, u)))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, EXT_CACHE])
    const names = await caches.keys()
    await Promise.all(names
      .filter((n) => n.startsWith('arkx-studio-') && !keep.has(n))
      .map((n) => caches.delete(n)))
    await self.clients.claim()
  })())
})

async function trimExtCache() {
  const cache = await caches.open(EXT_CACHE)
  const keys = await cache.keys()
  if (keys.length <= EXT_LIMIT) return
  for (const req of keys.slice(0, keys.length - EXT_LIMIT)) await cache.delete(req)
}

async function networkFirst(request) {
  try {
    const res = await fetch(request)
    if (res && res.ok) {
      const cache = await caches.open(SHELL_CACHE)
      cache.put(INDEX_URL, res.clone()).catch(() => {})
    }
    return res
  } catch (err) {
    const cached = await caches.match(INDEX_URL, { ignoreSearch: true })
    if (cached) return cached
    throw err
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true })
  if (cached) {
    fetch(request).then(async (res) => {
      if (res && res.ok) (await caches.open(SHELL_CACHE)).put(request, res.clone())
    }).catch(() => {})
    return cached
  }
  const res = await fetch(request)
  if (res && res.ok) (await caches.open(SHELL_CACHE)).put(request, res.clone()).catch(() => {})
  return res
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(EXT_CACHE)
  const cached = await cache.match(request)
  const network = fetch(request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(request, res.clone()).then(trimExtCache).catch(() => {})
    }
    return res
  }).catch(() => null)
  return cached || (await network) || Response.error()
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return
  if (request.headers.has('range')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }
  if (url.origin === self.location.origin && url.href.startsWith(SCOPE)) {
    event.respondWith(cacheFirst(request))
    return
  }
  if (EXT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request))
  }
})
