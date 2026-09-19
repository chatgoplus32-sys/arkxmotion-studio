/**
 * IndexedDB-backed MI-GAN model cache.
 * Model ONNX ~29 MB downloaded once, stored in IndexedDB, reused forever.
 *
 * Model: MI-GAN (Picsart Research, ICCV 2023)
 * Source: https://huggingface.co/lxfater/inpaint-web/resolve/main/migan.onnx
 */

const DB_NAME = 'arkxmotion-watermark'
const DB_VERSION = 1
const STORE = 'models'
const MODEL_KEY = 'migan_v1'
const MODEL_URL = 'https://huggingface.co/lxfater/inpaint-web/resolve/main/migan.onnx'
const MODEL_SHA256 = 'bb7189b2523b8485d9dd6baa2e7e8bccce4493760daa33ffcd432f667945bf62'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key: string): Promise<ArrayBuffer | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key: string, value: ArrayBuffer): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).put(value, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(h))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function verifyModelBytes(bytes: Uint8Array, source: string): Promise<void> {
  if (!MODEL_SHA256) return
  if (!globalThis.crypto?.subtle) {
    console.warn('[model-cache] crypto.subtle unavailable — skipping integrity check')
    return
  }
  const hash = await sha256Hex(bytes)
  if (hash !== MODEL_SHA256) {
    throw new Error(
      `Model integrity check failed — the file from ${source} does not match the expected SHA-256. Expected ${MODEL_SHA256.slice(0, 16)}…, got ${hash.slice(0, 16)}….`
    )
  }
  console.log(`[model-cache] ✓ Integrity verified (SHA-256 matches) — ${source}`)
}

async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    const already = await navigator.storage.persisted()
    if (already) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

interface ProgressInfo {
  done: number
  total: number
  cached?: boolean
  stage?: string
}

export async function loadModel(onProgress?: (p: ProgressInfo) => void): Promise<Uint8Array> {
  // 1. Try IndexedDB cache
  try {
    const cached = await idbGet(MODEL_KEY)
    if (cached && cached.byteLength > 1_000_000) {
      console.log(`[model-cache] HIT — model from IndexedDB (${(cached.byteLength / 1024 / 1024).toFixed(1)} MB)`)
      onProgress?.({ done: cached.byteLength, total: cached.byteLength, cached: true, stage: 'Loaded from cache' })
      return new Uint8Array(cached)
    }
    console.log('[model-cache] MISS — will download')
  } catch (e) {
    console.warn('[model-cache] IndexedDB read failed, re-downloading:', e)
  }

  await requestPersistentStorage()

  // 2. Download
  onProgress?.({ done: 0, total: 0, stage: 'Connecting…' })
  const res = await fetch(MODEL_URL, { cache: 'force-cache' })
  if (!res.ok) throw new Error(`Could not download model (HTTP ${res.status})`)

  const total = parseInt(res.headers.get('content-length') || '0', 10)
  if (!res.body) {
    const buf = await res.arrayBuffer()
    onProgress?.({ done: buf.byteLength, total: buf.byteLength, stage: 'Downloaded' })
    const bytes = new Uint8Array(buf)
    await verifyModelBytes(bytes, 'the download')
    await idbSet(MODEL_KEY, bytes.buffer)
    return bytes
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let done = 0
  while (true) {
    const { value, done: finished } = await reader.read()
    if (finished) break
    chunks.push(value)
    done += value.byteLength
    onProgress?.({ done, total, stage: 'Downloading model (~29 MB)' })
  }

  const out = new Uint8Array(done)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }

  // 3. Verify + cache
  onProgress?.({ done: out.byteLength, total: out.byteLength, stage: 'Verifying…' })
  await verifyModelBytes(out, 'the download')

  try {
    await idbSet(MODEL_KEY, out.buffer)
    console.log(`[model-cache] ✓ Saved to IndexedDB (${(out.byteLength / 1024 / 1024).toFixed(1)} MB)`)
  } catch (e) {
    console.error('[model-cache] ✗ Could not save to IndexedDB:', e)
  }

  return out
}

export async function isModelCached(): Promise<boolean> {
  try {
    const cached = await idbGet(MODEL_KEY)
    return !!(cached && cached.byteLength > 1_000_000)
  } catch {
    return false
  }
}
