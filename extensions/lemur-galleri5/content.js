// ─── Galleri5 Token Capture — Content Script ───────────────────
// Simple version: intercept fetch/XHR, capture Bearer tokens

(function () {
  'use strict'

  var G5_BACKEND = 'aistudio-backend.calmdesert'
  var FIREBASE_HOST = 'securetoken.googleapis.com'

  function isG5Url(url) {
    return typeof url === 'string' && url.indexOf(G5_BACKEND) !== -1
  }

  function isFirebaseUrl(url) {
    return typeof url === 'string' && url.indexOf(FIREBASE_HOST) !== -1
  }

  function extractBearer(headers) {
    if (!headers) return null
    if (typeof headers.get === 'function') {
      var val = headers.get('Authorization')
      if (val && val.indexOf('Bearer ') === 0) return val.replace(/^Bearer\s+/i, '').trim()
      return null
    }
    if (typeof headers === 'object') {
      for (var key in headers) {
        if (key.toLowerCase() === 'authorization') {
          var v = headers[key]
          if (v && v.indexOf('Bearer ') === 0) return v.replace(/^Bearer\s+/i, '').trim()
        }
      }
    }
    return null
  }

  function sendCapture(token, source) {
    try {
      chrome.runtime.sendMessage({
        type: 'capture_from_page',
        token: token,
        sourceUrl: source || 'content-script',
      })
    } catch (e) {}
  }

  // ── Intercept fetch ──────────────────────────────────────────
  var origFetch = window.fetch
  window.fetch = function () {
    var args = arguments
    var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || ''

    if (isG5Url(url)) {
      var opts = args[1] || {}
      var token = extractBearer(opts.headers)
      if (token && token.length > 50) {
        sendCapture(token, url)
      }
    }

    return origFetch.apply(this, args).then(function (res) {
      if (isFirebaseUrl(url) && res && res.ok) {
        var clone = res.clone()
        clone.json().then(function (data) {
          if (data && data.id_token) {
            sendCapture(data.id_token, 'firebase-refresh')
          }
        }).catch(function () {})
      }
      return res
    })
  }

  // ── Intercept XMLHttpRequest ─────────────────────────────────
  var origOpen = XMLHttpRequest.prototype.open
  var origSetReqHeader = XMLHttpRequest.prototype.setRequestHeader

  XMLHttpRequest.prototype.open = function (method, url) {
    this._g5Url = url
    this._g5Auth = null
    return origOpen.apply(this, arguments)
  }

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (name && name.toLowerCase() === 'authorization' && value && value.indexOf('Bearer ') === 0) {
      this._g5Auth = value.replace(/^Bearer\s+/i, '').trim()
    }
    return origSetReqHeader.apply(this, arguments)
  }

  var origSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.send = function () {
    if (this._g5Url && isG5Url(this._g5Url) && this._g5Auth && this._g5Auth.length > 50) {
      sendCapture(this._g5Auth, this._g5Url)
    }
    return origSend.apply(this, arguments)
  }

  // ── Floating button on G5 AI Studio ─────────────────────────
  function addCopyButton() {
    if (document.getElementById('g5-copy-btn')) return
    if (window.location.hostname !== 'aistudio.galleri5.com') return

    var btn = document.createElement('div')
    btn.id = 'g5-copy-btn'
    btn.textContent = '📋 Copy Token'
    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;background:linear-gradient(135deg,#e879f9,#a855f7);color:white;padding:10px 16px;border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 15px rgba(232,121,249,0.4);user-select:none;font-family:system-ui,-apple-system,sans-serif;'

    btn.onclick = function () {
      // Try localStorage for Firebase auth
      var token = null
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i)
          var val = localStorage.getItem(key) || ''
          if (val.indexOf('eyJ') === 0 && val.indexOf('.') !== -1) {
            token = val
            break
          }
          try {
            var obj = JSON.parse(val)
            if (obj && obj.stsTokenManager && obj.stsTokenManager.accessToken) {
              token = obj.stsTokenManager.accessToken
              break
            }
          } catch (e) {}
        }
      } catch (e) {}

      if (token) {
        navigator.clipboard.writeText(token).then(function () {
          btn.textContent = '✅ Copied!'
          setTimeout(function () { btn.textContent = '📋 Copy Token' }, 2000)
        })
      } else {
        btn.textContent = '❌ No token found'
        setTimeout(function () { btn.textContent = '📋 Copy Token' }, 2000)
      }
    }

    document.body.appendChild(btn)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(addCopyButton, 2000) })
  } else {
    setTimeout(addCopyButton, 2000)
  }

  var observer = new MutationObserver(function () { addCopyButton() })
  observer.observe(document.documentElement, { childList: true, subtree: true })

})()
