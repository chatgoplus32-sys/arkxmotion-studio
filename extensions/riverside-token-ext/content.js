// ─── Riverside Token Manager — Content Script ──────────────────
// Runs on https://riverside.com/*
// 1. Intercepts fetch/XHR for Bearer tokens (JWT)
// 2. Reads localStorage / sessionStorage / Firebase IndexedDB
// 3. Injects floating "Copy Token" button
// 4. Auto-captures tokens and sends to background

(function () {
  'use strict'

  var SENT = {}

  function send(token, source) {
    if (!token || token.length < 20) return
    var fingerprint = token.slice(0, 20)
    if (SENT[fingerprint]) return
    SENT[fingerprint] = true
    try {
      chrome.runtime.sendMessage({ type: 'add_token', token: token, source: source || '' })
    } catch {}
  }

  function looksLikeToken(v) {
    if (!v || typeof v !== 'string') return false
    v = v.trim()
    if (v.indexOf('eyJ') === 0 && v.indexOf('.') !== -1) return true
    if (v.indexOf('AMf') === 0 && v.length > 40) return true
    if (v.length > 80 && v.indexOf(' ') === -1) return true
    return false
  }

  function extractBearer(h) {
    if (!h) return null
    if (typeof h.get === 'function') {
      var v = h.get('Authorization')
      return v && v.indexOf('Bearer ') === 0 ? v.replace(/^Bearer\s+/i, '').trim() : null
    }
    if (typeof h === 'object') {
      for (var k in h) {
        if (k.toLowerCase() === 'authorization' && h[k].indexOf('Bearer ') === 0) {
          return h[k].replace(/^Bearer\s+/i, '').trim()
        }
      }
    }
    return null
  }

  // ── Intercept fetch ──────────────────────────────────────────
  var origFetch = window.fetch
  window.fetch = function () {
    var url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url) || ''
    var token = extractBearer(arguments[1] && arguments[1].headers)
    if (token && looksLikeToken(token)) {
      send(token, 'fetch:' + url)
    }
    return origFetch.apply(this, arguments)
  }

  // ── Intercept XMLHttpRequest ─────────────────────────────────
  var origOpen = XMLHttpRequest.prototype.open
  var origSetHeader = XMLHttpRequest.prototype.setRequestHeader
  XMLHttpRequest.prototype.open = function () {
    this._url = arguments[1]
    this._auth = null
    return origOpen.apply(this, arguments)
  }
  XMLHttpRequest.prototype.setRequestHeader = function (n, v) {
    if (n.toLowerCase() === 'authorization' && v.indexOf('Bearer ') === 0) {
      this._auth = v.replace(/^Bearer\s+/i, '').trim()
    }
    return origSetHeader.apply(this, arguments)
  }
  var origSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.send = function () {
    if (this._auth && looksLikeToken(this._auth)) {
      send(this._auth, 'xhr:' + this._url)
    }
    return origSend.apply(this, arguments)
  }

  // ── Scan storage (localStorage, sessionStorage) ──────────────
  function scanStorage(storage) {
    for (var i = 0; i < storage.length; i++) {
      var key = storage.key(i)
      if (!key) continue
      var val = storage.getItem(key) || ''

      if (looksLikeToken(val)) {
        send(val, (storage === localStorage ? 'localStorage' : 'sessionStorage') + ':' + key)
      }

      // JSON wrapping tokens
      try {
        var obj = JSON.parse(val)
        if (obj && typeof obj === 'object') {
          var cand = obj.access_token || obj.idToken || obj.refreshToken ||
                     obj.refresh_token || obj.token || obj.id_token ||
                     (obj.stsTokenManager && (obj.stsTokenManager.accessToken || obj.stsTokenManager.refreshToken)) ||
                     (obj.current_session && obj.current_session.access_token)
          if (looksLikeToken(cand)) {
            // Prefer refresh token if present
            var rt = obj.refresh_token || obj.refreshToken ||
                     (obj.stsTokenManager && obj.stsTokenManager.refreshToken)
            send(rt && looksLikeToken(rt) ? rt : cand, (storage === localStorage ? 'localStorage' : 'sessionStorage') + ':json:' + key)
          }
        }
      } catch {}
    }
  }

  // ── Scan Firebase IndexedDB ──────────────────────────────────
  function scanFirebaseIndexedDB() {
    try {
      var req = indexedDB.open('firebaseLocalStorageDb')
      req.onsuccess = function (e) {
        var db = e.target.result
        if (!db.objectStoreNames.contains('firebaseLocalStorage')) { db.close(); return }
        var tx = db.transaction('firebaseLocalStorage', 'readonly')
        var getAll = tx.objectStore('firebaseLocalStorage').getAll()
        getAll.onsuccess = function () {
          var items = getAll.result || []
          for (var i = 0; i < items.length; i++) {
            var item = items[i]
            if (item && item.value && item.value.stsTokenManager) {
              var sts = item.value.stsTokenManager
              // Prefer refresh token (long-lived)
              if (sts.refreshToken && looksLikeToken(sts.refreshToken)) {
                send(sts.refreshToken, 'indexeddb:refresh')
              } else if (sts.accessToken && looksLikeToken(sts.accessToken)) {
                send(sts.accessToken, 'indexeddb:access')
              }
            }
          }
          db.close()
        }
      }
    } catch {}
  }

  // ── Inject floating copy button ──────────────────────────────
  function addCopyButton() {
    if (document.getElementById('rs-copy-btn')) return

    var btn = document.createElement('div')
    btn.id = 'rs-copy-btn'
    btn.innerHTML = '🎙️ Copy Riverside Token'
    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;background:linear-gradient(135deg,#e04848,#ff6b6b);color:#fff;padding:10px 16px;border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 15px rgba(255,107,107,.4);user-select:none;font-family:system-ui;'

    btn.onclick = function () {
      btn.innerHTML = '⏳ Searching...'
      scanStorage(localStorage)
      scanStorage(sessionStorage)
      scanFirebaseIndexedDB()

      setTimeout(function () {
        chrome.runtime.sendMessage({ type: 'get_tokens' }, function (res) {
          var tokens = (res && res.tokens) || []
          if (tokens.length === 0) {
            btn.innerHTML = '❌ Not found — login dulu di riverside.com'
            setTimeout(function () { btn.innerHTML = '🎙️ Copy Riverside Token' }, 3000)
            return
          }
          // Prefer refresh token (AMf-) kalau ada; kalau tidak, ambil yang TERBARU
          // (Riverside session JWT cuma ±10 menit — token terbaru = paling hidup)
          var best = tokens.find(function (t) { return t.isRefresh }) ||
                     tokens.slice().sort(function (a, b) { return (b.capturedAt || 0) - (a.capturedAt || 0) })[0]
          navigator.clipboard.writeText(best.token).then(function () {
            btn.innerHTML = '✅ Copied! (' + tokens.length + ' token)'
            setTimeout(function () { btn.innerHTML = '🎙️ Copy Riverside Token' }, 3000)
          }, function () {
            prompt('Copy token ini:', best.token)
            btn.innerHTML = '🎙️ Copy Riverside Token'
          })
        })
      }, 1500)
    }

    document.body.appendChild(btn)
  }

  // ── KEEP-ALIVE: session JWT Riverside cuma ±10 menit ─────────
  // Dashboard Riverside mempertahankan login lewat cookie refresh
  // endpoint: GET /auth/refresh/reactive (credentials: include).
  // Endpoint ini cuma bisa dipanggil dari dalam browser yang sudah
  // login (butuh session cookie) — makanya keep-alive ini jalan di
  // content script, bukan dari app. Setelah refresh, request berikutnya
  // membawa JWT baru di header Authorization → tertangkap interceptor.
  var KEEPALIVE_INTERVAL = 4 * 60 * 1000 // tiap 4 menit
  var REFRESH_ENDPOINTS = ['/auth/refresh/reactive', '/graphql/auth/refresh/reactive']

  function keepAlive() {
    var idx = 0
    function tryNext() {
      if (idx >= REFRESH_ENDPOINTS.length) {
        scanStorage(localStorage)
        scanStorage(sessionStorage)
        scanFirebaseIndexedDB()
        return
      }
      var url = REFRESH_ENDPOINTS[idx++]
      fetch(url, { method: 'GET', credentials: 'include', keepalive: true, cache: 'no-cache' })
        .then(function (res) {
          if (res.ok || res.status === 204) {
            // refresh sukses → JWT baru muncul di request berikutnya;
            // paksa scan storage + tunggu interceptor menangkapnya
            setTimeout(function () {
              scanStorage(localStorage)
              scanStorage(sessionStorage)
              scanFirebaseIndexedDB()
            }, 800)
          } else {
            tryNext()
          }
        })
        .catch(function () { tryNext() })
    }
    tryNext()
  }

  // Jalankan saat halaman aktif & tiap beberapa menit
  setTimeout(function () {
    scanStorage(localStorage)
    scanStorage(sessionStorage)
    scanFirebaseIndexedDB()
    addCopyButton()
    keepAlive()
  }, 2500)

  // Re-inject on SPA navigation
  var observer = new MutationObserver(function () {
    addCopyButton()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })

  // Periodic re-scan (async logins / refresh)
  setInterval(function () {
    scanStorage(localStorage)
    scanFirebaseIndexedDB()
  }, 8000)

  // Keep-alive rutin biar token tidak mati selama tab kebuka
  setInterval(keepAlive, KEEPALIVE_INTERVAL)

  // Saat tab kembali fokus, langsung refresh (biasanya token expired)
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      scanStorage(localStorage)
      scanStorage(sessionStorage)
      scanFirebaseIndexedDB()
      keepAlive()
    }
  })
})()