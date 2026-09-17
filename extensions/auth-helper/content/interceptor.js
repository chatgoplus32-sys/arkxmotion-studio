// ─── auth-helper — interceptor jaringan (world: MAIN) ────────────────────────
// Berjalan di konteks halaman supaya bisa membungkus fetch/XHR milik halaman itu
// sendiri. Tugasnya HANYA melaporkan apa yang dilihatnya lewat window.postMessage;
// yang memutuskan token itu milik provider mana adalah background (lihat
// content/bridge.js sebagai jembatan ke chrome.runtime).
//
// Ini pengganti pendekatan lama "chrome.debugger + Network.enable" (Firefly) dan
// "chrome.webRequest <all_urls>" (G5/JWT): dua permission berat itu tidak lagi
// dibutuhkan, jadi tidak ada lagi prompt "extension ini bisa men-debug tab" dan
// tidak ada akses ke seluruh riwayat jaringan.

;(() => {
  if (window.__arkxAuthHelperInstalled) return
  window.__arkxAuthHelperInstalled = true

  const _HEADER_KEYS = [
    'authorization',
    'x-api-key',
    'x-gw-ims-user-id',
    'x-arp-session-id',
    'x-ims-user-id',
  ]
  // Endpoint refresh token: responsnya berisi token baru yang belum pernah
  // muncul di header request mana pun (Firebase id_token & Supabase access_token).
  const REFRESH_HINTS = ['securetoken.googleapis.com', 'auth/v1/token', 'grant_type=refresh_token']

  const looksLikeToken = (value) => typeof value === 'string' && value.trim().length >= 20

  function post(payload) {
    try {
      window.postMessage({ __arkxAuthHelper: true, ...payload }, '*')
    } catch {
      /* jangan pernah mengganggu halaman karena gagal melapor */
    }
  }

  function headersToObject(headers) {
    const out = {}
    if (!headers) return out
    try {
      // Headers (fetch) → punya forEach
      if (typeof headers.forEach === 'function' && typeof headers.get === 'function') {
        headers.forEach((value, key) => {
          out[String(key).toLowerCase()] = String(value)
        })
        return out
      }
      // Array pasangan [key, value]
      if (Array.isArray(headers)) {
        for (const pair of headers) {
          if (Array.isArray(pair) && pair.length === 2) out[String(pair[0]).toLowerCase()] = String(pair[1])
        }
        return out
      }
      // Objek biasa
      if (typeof headers === 'object') {
        for (const key of Object.keys(headers)) out[key.toLowerCase()] = String(headers[key])
      }
    } catch {
      /* header tidak terbaca */
    }
    return out
  }

  function reportRequest(url, method, headers) {
    const all = headersToObject(headers)
    const bearer = (all.authorization || '').replace(/^Bearer\s+/i, '').trim()
    const apiKey = all['x-api-key'] || ''
    if (!looksLikeToken(bearer) && !apiKey) return
    post({
      kind: 'network',
      url,
      token: looksLikeToken(bearer) ? bearer : '',
      source: `network:${method || 'GET'}`,
      extra: {
        // Field khas Adobe IMS yang dipakai tombol "Copy JSON" di popup Firefly.
        apiKey,
        account: all['x-gw-ims-user-id'] || '',
        session: all['x-arp-session-id'] || '',
        ims: all['x-ims-user-id'] || '',
      },
    })
  }

  function reportRefreshResponse(url, data) {
    if (!data || typeof data !== 'object') return
    const token = data.access_token || data.id_token || data.accessToken
    const refreshToken = data.refresh_token || data.refreshToken || ''
    if (!looksLikeToken(token) && !looksLikeToken(refreshToken)) return
    post({
      kind: 'refresh',
      url,
      token: looksLikeToken(token) ? token : '',
      refreshToken: looksLikeToken(refreshToken) ? refreshToken : '',
      source: 'refresh-response',
    })
  }

  // ── fetch ──────────────────────────────────────────────────────────────────
  const originalFetch = window.fetch
  if (typeof originalFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || ''
        const headers = (init && init.headers) || (typeof input === 'object' && input && input.headers)
        reportRequest(url, (init && init.method) || (input && input.method) || 'GET', headers)

        const lower = String(url).toLowerCase()
        if (REFRESH_HINTS.some((hint) => lower.includes(hint))) {
          const result = originalFetch.apply(this, arguments)
          if (result && typeof result.then === 'function') {
            result
              .then((response) => {
                try {
                  const clone = response.clone()
                  clone
                    .json()
                    .then((data) => reportRefreshResponse(url, data))
                    .catch(() => {})
                } catch {
                  /* body tidak bisa dibaca */
                }
                return response
              })
              .catch(() => {})
          }
          return result
        }
      } catch {
        /* lanjut ke pemanggilan asli di bawah */
      }
      return originalFetch.apply(this, arguments)
    }
  }

  // ── XMLHttpRequest ─────────────────────────────────────────────────────────
  const XHR = window.XMLHttpRequest
  if (XHR && XHR.prototype) {
    const originalOpen = XHR.prototype.open
    const originalSetHeader = XHR.prototype.setRequestHeader
    const originalSend = XHR.prototype.send

    XHR.prototype.open = function (method, url) {
      this.__arkxAuthHelperUrl = url
      this.__arkxAuthHelperMethod = method
      this.__arkxAuthHelperHeaders = {}
      return originalOpen.apply(this, arguments)
    }

    XHR.prototype.setRequestHeader = function (name, value) {
      try {
        if (this.__arkxAuthHelperHeaders) this.__arkxAuthHelperHeaders[String(name)] = String(value)
      } catch {
        /* diabaikan */
      }
      return originalSetHeader.apply(this, arguments)
    }

    XHR.prototype.send = function () {
      try {
        reportRequest(
          this.__arkxAuthHelperUrl,
          this.__arkxAuthHelperMethod,
          this.__arkxAuthHelperHeaders,
        )
      } catch {
        /* diabaikan */
      }
      return originalSend.apply(this, arguments)
    }
  }
})()
