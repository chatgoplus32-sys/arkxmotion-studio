// ─── Firebase Token Manager — Content Script ───────────────────
// 1. Intercept fetch/XHR for Bearer tokens
// 2. Read from Firebase IndexedDB/localStorage
// 3. Inject copy button on G5 AI Studio

(function () {
  'use strict'

  var SENT = {}

  function send(token, source) {
    if (!token || token.length < 50 || SENT[token.slice(0, 20)]) return
    SENT[token.slice(0, 20)] = true
    try {
      chrome.runtime.sendMessage({ type: 'add_token', token: token, source: source || '' })
    } catch (e) {}
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
    if (token) send(token, 'fetch:' + url)

    // Also capture Firebase refresh response
    if (url.indexOf('securetoken.googleapis.com') !== -1) {
      return origFetch.apply(this, arguments).then(function (res) {
        var clone = res.clone()
        clone.json().then(function (data) {
          if (data && data.id_token) send(data.id_token, 'firebase-refresh')
          if (data && data.id_token) {
            // Store refresh token too
            try {
              var obj = JSON.parse(localStorage.getItem('_fb_rt') || '{}')
              obj[data.user_id || 'default'] = data.refresh_token
              localStorage.setItem('_fb_rt', JSON.stringify(obj))
            } catch (e) {}
          }
        }).catch(function () {})
        return res
      })
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
    if (this._auth) send(this._auth, 'xhr:' + this._url)
    return origSend.apply(this, arguments)
  }

  // ── Read from Firebase IndexedDB ─────────────────────────────
  function readFirebaseIndexedDB() {
    try {
      var req = indexedDB.open('firebaseLocalStorageDb')
      req.onsuccess = function (e) {
        var db = e.target.result
        if (!db.objectStoreNames.contains('firebaseLocalStorage')) return
        var tx = db.transaction('firebaseLocalStorage', 'readonly')
        var store = tx.objectStore('firebaseLocalStorage')
        var getAll = store.getAll()
        getAll.onsuccess = function () {
          var items = getAll.result || []
          for (var i = 0; i < items.length; i++) {
            var item = items[i]
            if (item && item.value && item.value.stsTokenManager) {
              var token = item.value.stsTokenManager.accessToken
              if (token) send(token, 'indexeddb')
            }
          }
        }
      }
    } catch (e) {}
  }

  // ── Read from localStorage ───────────────────────────────────
  function readLocalStorage() {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i)
      if (!key) continue
      var val = localStorage.getItem(key) || ''

      // Direct JWT
      if (val.indexOf('eyJ') === 0 && val.indexOf('.') !== -1) {
        send(val, 'localStorage:' + key)
      }

      // Firebase auth user object
      try {
        var obj = JSON.parse(val)
        if (obj && obj.stsTokenManager && obj.stsTokenManager.accessToken) {
          send(obj.stsTokenManager.accessToken, 'localStorage:' + key)
        }
        // Nested
        for (var k in obj) {
          if (obj[k] && obj[k].stsTokenManager && obj[k].stsTokenManager.accessToken) {
            send(obj[k].stsTokenManager.accessToken, 'localStorage:' + key + ':' + k)
          }
          if (typeof obj[k] === 'string' && obj[k].indexOf('eyJ') === 0 && obj[k].indexOf('.') !== -1) {
            send(obj[k], 'localStorage:' + key + ':' + k)
          }
        }
      } catch (e) {}
    }
  }

  // ── Read from sessionStorage ─────────────────────────────────
  function readSessionStorage() {
    for (var i = 0; i < sessionStorage.length; i++) {
      var key = sessionStorage.key(i)
      if (!key) continue
      var val = sessionStorage.getItem(key) || ''
      if (val.indexOf('eyJ') === 0 && val.indexOf('.') !== -1) {
        send(val, 'sessionStorage:' + key)
      }
      try {
        var obj = JSON.parse(val)
        if (obj && obj.stsTokenManager && obj.stsTokenManager.accessToken) {
          send(obj.stsTokenManager.accessToken, 'sessionStorage:' + key)
        }
      } catch (e) {}
    }
  }

  // ── Inject copy button on G5 AI Studio ──────────────────────
  function addCopyButton() {
    if (document.getElementById('fb-copy-btn')) return
    var hostname = window.location.hostname
    if (hostname !== 'aistudio.galleri5.com' && hostname !== 'aistudio.galleri5.ai') return

    var btn = document.createElement('div')
    btn.id = 'fb-copy-btn'
    btn.textContent = '📋 Copy Token'
    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;background:#22c55e;color:#fff;padding:10px 16px;border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 15px rgba(34,197,94,.4);user-select:none;font-family:system-ui;'

    btn.onclick = function () {
      // Scan all sources
      readFirebaseIndexedDB()
      readLocalStorage()
      readSessionStorage()

      // Try to find token in Firebase IndexedDB
      var req = indexedDB.open('firebaseLocalStorageDb')
      req.onsuccess = function (e) {
        var db = e.target.result
        if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
          btn.textContent = '❌ No token'
          setTimeout(function () { btn.textContent = '📋 Copy Token' }, 2000)
          return
        }
        var tx = db.transaction('firebaseLocalStorage', 'readonly')
        var store = tx.objectStore('firebaseLocalStorage')
        var getAll = store.getAll()
        getAll.onsuccess = function () {
          var items = getAll.result || []
          for (var i = 0; i < items.length; i++) {
            var item = items[i]
            if (item && item.value && item.value.stsTokenManager) {
              var token = item.value.stsTokenManager.accessToken
              if (token) {
                navigator.clipboard.writeText(token).then(function () {
                  btn.textContent = '✅ Copied!'
                  send(token, 'manual-click')
                  setTimeout(function () { btn.textContent = '📋 Copy Token' }, 2000)
                })
                return
              }
            }
          }
          btn.textContent = '❌ No token'
          setTimeout(function () { btn.textContent = '📋 Copy Token' }, 2000)
        }
      }
    }

    document.body.appendChild(btn)
  }

  // ── Run all readers on page load ─────────────────────────────
  setTimeout(function () {
    readFirebaseIndexedDB()
    readLocalStorage()
    readSessionStorage()
    addCopyButton()
  }, 2000)

  // Re-inject button on SPA navigation
  var observer = new MutationObserver(function () {
    readLocalStorage()
    addCopyButton()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })

  // Re-read periodically (for async logins)
  setInterval(function () {
    readFirebaseIndexedDB()
    readLocalStorage()
  }, 5000)

})()
