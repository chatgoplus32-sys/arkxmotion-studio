/**
 * Perekam request untuk membedah web Muse (video generation).
 *
 * Cara pakai:
 *   1. Buka halaman Muse yang dipakai (muse.ai / meta.ai), login.
 *   2. DevTools -> Console -> tempel seluruh isi berkas ini -> Enter.
 *   3. Generate satu video pendek sampai hasilnya muncul.
 *   4. Klik tombol "Download capture" di kanan bawah, kirim berkas JSON-nya.
 *
 * Cookie, Authorization, CSRF, dan tanda tangan URL diredaksi otomatis, jadi
 * berkas hasilnya aman dikirim. Body request/response dipotong supaya berkas
 * tidak membengkak, tapi tetap memuat nama model, prompt, status, dan URL hasil.
 *
 * Kalau web memakai Service Worker, hook fetch bisa tidak melihat request
 * (service worker yang memegang fetch). Dalam kasus itu pakai HAR dari tab
 * Network sebagai gantinya.
 */
;(() => {
  if (window.__MUSE_CAPTURE_INSTALLED__) {
    console.log('[MUSE] Perekam sudah aktif. Klik "Download capture" kalau sudah selesai.')
    return
  }
  window.__MUSE_CAPTURE_INSTALLED__ = true

  /** false = hanya host Muse/Meta; ubah true kalau endpoint ternyata di domain lain. */
  window.__MUSE_CAPTURE_ALL = window.__MUSE_CAPTURE_ALL ?? false

  const ENTRIES = []
  window.__MUSE_CAPTURE = ENTRIES

  const MAX_BODY = 20000
  const SECRET_KEY = /authorization|cookie|csrf|xsrf|token|signature|api[-_]?key|secret/i
  const HOST_OK = /(^|\.)(muse\.ai|meta\.ai)$/i

  const truncate = (text) => {
    if (typeof text !== 'string') return text
    if (text.length <= MAX_BODY) return text
    return text.slice(0, 12000) + `\n…[dipotong ${text.length - 14000} karakter]…\n` + text.slice(-2000)
  }

  const redactName = (name) => SECRET_KEY.test(name)

  function redactUrl(raw) {
    try {
      const url = new URL(raw, location.href)
      for (const key of [...url.searchParams.keys()]) {
        if (SECRET_KEY.test(key)) url.searchParams.set(key, '<REDACTED>')
      }
      return url.toString()
    } catch {
      return raw
    }
  }

  function redactHeaders(headers) {
    const out = {}
    if (!headers) return out
    for (const [k, v] of headers) {
      out[k] = redactName(k) ? '<REDACTED>' : v
    }
    return out
  }

  /**
   * Token sesi bisa ikut di BODY (mis. `claims: ["at.…"]` di muse.ai), bukan
   * hanya di header. Redaksi body wajib, kalau tidak berkas capture memuat
   * kredensial hidup yang bisa dipakai orang lain.
   */
  function redactValue(value, depth) {
    if (depth > 12) return '<REDACTED:deep>'
    if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1))
    if (value && typeof value === 'object') {
      const out = {}
      for (const [k, v] of Object.entries(value)) {
        out[k] = redactName(k) ? '<REDACTED>' : redactValue(v, depth + 1)
      }
      return out
    }
    return value
  }

  function redactBody(text) {
    if (typeof text !== 'string') return text
    const parsed = safeJson(text)
    if (parsed === null) return truncate(text)
    try { return truncate(JSON.stringify(redactValue(parsed, 0))) } catch { return '<REDACTED:unserializable>' }
  }

  function wanted(rawUrl) {
    if (window.__MUSE_CAPTURE_ALL) return true
    try {
      return HOST_OK.test(new URL(rawUrl, location.href).hostname)
    } catch {
      return false
    }
  }

  function push(entry) {
    ENTRIES.push(entry)
    const tag = entry.kind === 'wx' ? 'WS' : entry.method || 'GET'
    console.log(`[MUSE] #${ENTRIES.length} ${tag} ${entry.status ?? ''} ${entry.url}`)
  }

  function safeJson(text) {
    if (typeof text !== 'string') return null
    const trimmed = text.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
    try { return JSON.parse(trimmed) } catch { return null }
  }

  // ── fetch ────────────────────────────────────────────────────────────────
  const origFetch = window.fetch
  window.fetch = async function (input, init) {
    let url = ''
    let method = 'GET'
    let reqHeaders = {}
    let reqBody = null

    try {
      if (typeof input === 'string' || input instanceof URL) url = String(input)
      else if (input && input.url) { url = input.url; method = input.method || 'GET' }

      if (init) {
        method = init.method || method
        reqHeaders = redactHeaders(init.headers ? new Headers(init.headers) : null)
        if (typeof init.body === 'string') reqBody = redactBody(init.body)
        else if (init.body instanceof FormData) {
          const obj = {}
          for (const [k, v] of init.body.entries()) obj[k] = typeof v === 'string' ? truncate(v) : `[File ${v.name || ''} ${v.size || 0}B ${v.type || ''}]`
          reqBody = obj
        } else if (init.body) reqBody = '[non-string body]'
      } else if (input && input.clone) {
        reqHeaders = redactHeaders(input.headers)
        const cloned = input.clone()
        reqBody = redactBody(await cloned.text().catch(() => null))
      }
    } catch { /* rekaman tidak boleh mengganggu halaman */ }

    const capture = wanted(url)
    const started = Date.now()
    try {
      const res = await origFetch.apply(this, arguments)
      if (capture) {
        const text = redactBody(await res.clone().text().catch(() => null))
        push({
          kind: 'fetch',
          at: new Date().toISOString(),
          ms: Date.now() - started,
          method,
          url: redactUrl(url),
          requestHeaders: reqHeaders,
          requestBody: reqBody,
          status: res.status,
          responseHeaders: { 'content-type': res.headers.get('content-type') || '' },
          responseBody: truncate(text),
          responseJson: safeJson(text),
        })
      }
      return res
    } catch (err) {
      if (capture) {
        push({
          kind: 'fetch',
          at: new Date().toISOString(),
          ms: Date.now() - started,
          method,
          url: redactUrl(url),
          requestHeaders: reqHeaders,
          requestBody: reqBody,
          error: String(err && err.message ? err.message : err),
        })
      }
      throw err
    }
  }

  // ── XHR ──────────────────────────────────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open
  const origSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__muse = { method, url: String(url) }
    return origOpen.apply(this, arguments)
  }
  XMLHttpRequest.prototype.send = function (body) {
    const meta = this.__muse
    if (meta && wanted(meta.url)) {
      const started = Date.now()
      this.addEventListener('loadend', () => {
        let text = null
        try { text = this.responseType === '' || this.responseType === 'text' ? this.responseText : null } catch {}
        push({
          kind: 'xhr',
          at: new Date().toISOString(),
          ms: Date.now() - started,
          method: meta.method,
          url: redactUrl(meta.url),
          requestHeaders: redactHeaders(new Headers()),
          requestBody: typeof body === 'string' ? redactBody(body) : body ? '[non-string body]' : null,
          status: this.status,
          responseHeaders: { 'content-type': this.getResponseHeader('content-type') || '' },
          responseBody: truncate(redactBody(text)),
          responseJson: safeJson(redactBody(text)),
        })
      })
    }
    return origSend.apply(this, arguments)
  }

  // ── WebSocket (kalau status video di-stream) ─────────────────────────────
  const OrigWS = window.WebSocket
  if (OrigWS) {
    window.WebSocket = class extends OrigWS {
      constructor(url, protocols) {
        super(url, protocols)
        this.__museUrl = String(url)
        this.addEventListener('message', (ev) => {
          if (!wanted(this.__museUrl)) return
          push({
            kind: 'ws',
            at: new Date().toISOString(),
            direction: 'in',
            url: redactUrl(this.__museUrl),
            responseBody: truncate(typeof ev.data === 'string' ? ev.data : '[binary]'),
          })
        })
      }
      send(data) {
        if (wanted(this.__museUrl)) {
          push({
            kind: 'ws',
            at: new Date().toISOString(),
            direction: 'out',
            url: redactUrl(this.__museUrl),
            requestBody: truncate(typeof data === 'string' ? data : '[binary]'),
          })
        }
        return super.send(data)
      }
    }
  }

  // ── Tombol unduh ─────────────────────────────────────────────────────────
  const btn = document.createElement('button')
  btn.textContent = 'Download capture (0)'
  Object.assign(btn.style, {
    position: 'fixed', right: '16px', bottom: '16px', zIndex: 2147483647,
    padding: '10px 14px', borderRadius: '10px', border: '0',
    background: '#111827', color: '#fff', font: '600 13px system-ui',
    boxShadow: '0 6px 20px rgba(0,0,0,.25)', cursor: 'pointer',
  })
  btn.onclick = () => {
    const snapshot = {
      capturedAt: new Date().toISOString(),
      page: location.href,
      userAgent: navigator.userAgent,
      total: ENTRIES.length,
      entries: ENTRIES,
    }
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `muse-capture-${Date.now()}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 3000)
  }
  document.body.appendChild(btn)

  setInterval(() => {
    btn.textContent = `Download capture (${ENTRIES.length})`
  }, 1000)

  console.log(
    '[MUSE] Perekam aktif. Cookie/Authorization/CSRF diredaksi otomatis.\n' +
    'Generate video sekarang, lalu klik tombol "Download capture" di kanan bawah.\n' +
    'Kalau daftar tetap kosong padahal video jalan, jalankan dulu: window.__MUSE_CAPTURE_ALL = true, lalu ulangi.',
  )
})()
