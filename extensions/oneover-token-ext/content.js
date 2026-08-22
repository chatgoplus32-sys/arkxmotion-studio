// ─── OneOver Token Manager — Content Script ────────────────────
// Runs on https://oneover.com/*
// 1. Intercepts fetch/XHR for Bearer tokens
// 2. Reads Supabase session from localStorage
// 3. Asks background to read HttpOnly cookies via chrome.cookies API
// 4. Injects a floating "Copy Token" button

(function () {
  'use strict'

  var SUPABASE_STORAGE_KEY = 'sb-mjuwtqkfhtpgavwjrual-auth-token'
  var SENT = {}

  function send(accessToken, refreshToken, source) {
    if (!accessToken || accessToken.length < 50) return
    var fingerprint = accessToken.slice(0, 20)
    if (SENT[fingerprint]) return
    SENT[fingerprint] = true
    console.log('[OneOver Ext] Token captured from:', source)
    try {
      chrome.runtime.sendMessage({
        type: 'add_token_pair',
        accessToken: accessToken,
        refreshToken: refreshToken || '',
        source: source || ''
      })
    } catch {}
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
    if (token && token !== 'undefined' && token.indexOf('eyJ') === 0) {
      send(token, '', 'fetch:' + url)
    }

    // Capture Supabase refresh responses
    if (url.indexOf('auth/v1/token') !== -1 || url.indexOf('grant_type=refresh_token') !== -1) {
      return origFetch.apply(this, arguments).then(function (res) {
        var clone = res.clone()
        clone.json().then(function (data) {
          if (data && data.access_token) {
            send(data.access_token, data.refresh_token || '', 'supabase-refresh')
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
    if (this._auth && this._auth.indexOf('eyJ') === 0) {
      send(this._auth, '', 'xhr:' + this._url)
    }
    return origSend.apply(this, arguments)
  }

  // ── Read from Supabase localStorage ──────────────────────────
  function readSupabaseLocalStorage() {
    try {
      var raw = localStorage.getItem(SUPABASE_STORAGE_KEY)
      if (!raw) return null
      var parsed = JSON.parse(raw)
      var session = parsed && parsed.current_session ? parsed.current_session : parsed
      return session
    } catch (e) {
      return null
    }
  }

  // ── Ask background to read HttpOnly cookies ──────────────────
  function askBackgroundForCookies(callback) {
    try {
      chrome.runtime.sendMessage({ type: 'read_cookies' }, function (response) {
        callback(response)
      })
    } catch {
      callback(null)
    }
  }

  // ── Find ALL tokens (localStorage + background cookies) ──────
  function findAllTokens(callback) {
    var results = []

    // 1. Try localStorage
    var localSession = readSupabaseLocalStorage()
    if (localSession && localSession.access_token) {
      results.push({
        accessToken: localSession.access_token,
        refreshToken: localSession.refresh_token || '',
        source: 'localStorage'
      })
    }

    // 2. Ask background to read HttpOnly cookies
    askBackgroundForCookies(function (cookieResult) {
      if (cookieResult && cookieResult.ok && cookieResult.accessToken) {
        var exists = results.some(function (r) { return r.accessToken === cookieResult.accessToken })
        if (!exists) {
          results.push({
            accessToken: cookieResult.accessToken,
            refreshToken: cookieResult.refreshToken || '',
            source: 'cookies'
          })
        }
      }

      callback(results)
    })
  }

  // ── Inject floating copy button ──────────────────────────────
  function addCopyButton() {
    if (document.getElementById('oo-copy-btn')) return

    var btn = document.createElement('div')
    btn.id = 'oo-copy-btn'
    btn.innerHTML = '🔮 Copy OneOver Token'
    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;background:linear-gradient(135deg,#7c3aed,#a78bfa);color:#fff;padding:10px 16px;border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 15px rgba(124,58,237,.4);user-select:none;font-family:system-ui;'

    btn.onclick = function () {
      btn.innerHTML = '⏳ Searching...'

      findAllTokens(function (tokens) {
        if (tokens.length === 0) {
          btn.innerHTML = '❌ Not found — make sure you are logged in'
          setTimeout(function () { btn.innerHTML = '🔮 Copy OneOver Token' }, 3000)
          return
        }

        // Send ALL found tokens to background
        for (var i = 0; i < tokens.length; i++) {
          send(tokens[i].accessToken, tokens[i].refreshToken, 'click:' + tokens[i].source)
        }

        // Copy the best one (prefer one with refresh_token)
        var best = tokens.find(function (t) { return t.refreshToken }) || tokens[0]
        var payload = JSON.stringify({ access_token: best.accessToken, refresh_token: best.refreshToken || '' })

        navigator.clipboard.writeText(payload).then(function () {
          btn.innerHTML = '✅ Copied! (' + tokens.length + ' source' + (tokens.length > 1 ? 's' : '') + ')'
          setTimeout(function () { btn.innerHTML = '🔮 Copy OneOver Token' }, 3000)
        }, function () {
          prompt('Copy this JSON:', payload)
          btn.innerHTML = '🔮 Copy OneOver Token'
        })
      })
    }

    document.body.appendChild(btn)
  }

  // ── Run on page load ─────────────────────────────────────────
  setTimeout(function () {
    console.log('[OneOver Ext] Content script loaded on:', window.location.href)

    // Auto-capture on load
    findAllTokens(function (tokens) {
      if (tokens.length > 0) {
        console.log('[OneOver Ext] Found', tokens.length, 'token(s) on page load')
        for (var i = 0; i < tokens.length; i++) {
          send(tokens[i].accessToken, tokens[i].refreshToken, 'auto-load:' + tokens[i].source)
        }
      } else {
        console.log('[OneOver Ext] No tokens found on page load')
      }
    })

    addCopyButton()
  }, 3000)

  // Re-inject on SPA navigation
  var observer = new MutationObserver(function () {
    addCopyButton()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })

  // Re-read periodically (for async logins)
  setInterval(function () {
    findAllTokens(function (tokens) {
      for (var i = 0; i < tokens.length; i++) {
        send(tokens[i].accessToken, tokens[i].refreshToken, 'periodic:' + tokens[i].source)
      }
    })
  }, 8000)

})()
