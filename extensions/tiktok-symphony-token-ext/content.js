// ─── TikTok Symphony Token Manager — Content Script ───────────────────────
// Jalan di Symphony Creative Studio / TikTok for Business portal.
// Menangkap access_token & tto_id dari:
//   1. REQUEST HEADER  'Access-Token' / 'access-token' (paling penting)
//   2. Response JSON fetch/XHR (berbagai nama field)
//   3. localStorage / sessionStorage (termasuk JSON bertingkat)
//   4. Teks DOM yang terlihat (input value / copyable text)
(function () {
  'use strict'

  var SENT = {}

  function send(kind, value, source) {
    if (!value || typeof value !== 'string') return
    value = value.trim()
    if (!value) return
    var fp = kind + ':' + value
    if (SENT[fp]) return
    SENT[fp] = true
    try {
      chrome.runtime.sendMessage({ type: 'capture', kind: kind, value: value, source: source || '' })
    } catch (e) {}
  }

  // Access-Token: long, no whitespace, not our own app JWT. TikTok tokens vary:
  // sk_live_..., hex/base64, or long strings. Accept >= 16 chars to be safe.
  function looksLikeAccessToken(v) {
    if (!v || typeof v !== 'string') return false
    v = v.trim()
    if (v.length < 16) return false
    if (/\s/.test(v)) return false
    if (v.indexOf('eyJ') === 0 && v.indexOf('.') > -1) return false // JWT app kita
    return true
  }

  function looksLikeTtoId(v) {
    if (v == null) return false
    v = String(v).trim()
    return /^\d{6,25}$/.test(v)
  }

  var TOKEN_KEYS = /^(access[-_]?token|access_token|tto[-_]?access[-_]?token|symphony[-_]?token|token|authorization)$/i
  var TTO_KEYS = /^(tto[-_]?id|tto[-_]?account[-_]?id|tto_account_id|account[-_]?id|tto|tto_id)$/i

  // ── Scan object recursively ─────────────────────────────────────────────
  function scanObject(obj, source, depth) {
    if (!obj || typeof obj !== 'object') return
    if (depth > 6) return
    var keys = Object.keys(obj)
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i]
      var v = obj[k]
      if (typeof v === 'string') {
        if (TOKEN_KEYS.test(k) && looksLikeAccessToken(v)) send('accessToken', v, source + ':' + k)
        if (TTO_KEYS.test(k) && looksLikeTtoId(v)) send('ttoId', v, source + ':' + k)
        // Authorization header value: "Bearer xxx" / "Access-Token xxx"
        if (/^bearer\s+/i.test(v)) {
          var b = v.replace(/^bearer\s+/i, '').trim()
          if (looksLikeAccessToken(b)) send('accessToken', b, source + ':bearer')
        }
      } else if (typeof v === 'object') {
        scanObject(v, source + ':' + k, (depth || 0) + 1)
      }
    }
  }

  // ── 1. REQUEST HEADERS (fetch) ──────────────────────────────────────────
  function scanFetchHeaders(headers, source) {
    if (!headers) return
    var g = headers.get ? headers.get.bind(headers) : function (name) {
      for (var k in headers) if (k.toLowerCase() === name.toLowerCase()) return headers[k]
      return null
    }
    var names = ['Access-Token', 'access-token', 'X-Access-Token', 'Authorization']
    for (var i = 0; i < names.length; i++) {
      try {
        var v = g(names[i])
        if (v) {
          if (/^bearer\s+/i.test(v)) v = v.replace(/^bearer\s+/i, '').trim()
          if (looksLikeAccessToken(v)) send('accessToken', v, source + ':' + names[i])
        }
      } catch (e) {}
    }
  }

  var origFetch = window.fetch
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || ''
    var headers = (init && init.headers) || (input && input.headers)
    scanFetchHeaders(headers, 'fetch-req:' + url)
    var p = origFetch.apply(this, arguments)
    try {
      if (p && typeof p.clone === 'function') {
        p.clone().text().then(function (text) {
          if (!text || text.length > 4_000_000) return
          try { scanObject(JSON.parse(text), 'fetch-res:' + url, 0) } catch (e) {}
        }).catch(function () {})
      }
    } catch (e) {}
    return p
  }

  // ── 2. REQUEST HEADERS (XHR) + response ─────────────────────────────────
  var origOpen = XMLHttpRequest.prototype.open
  var origSetHeader = XMLHttpRequest.prototype.setRequestHeader
  XMLHttpRequest.prototype.open = function () {
    this._ttUrl = arguments[1]
    this._ttHeaders = {}
    return origOpen.apply(this, arguments)
  }
  XMLHttpRequest.prototype.setRequestHeader = function (n, v) {
    try {
      var lk = String(n).toLowerCase()
      if (TOKEN_KEYS.test(lk) || lk === 'authorization') {
        this._ttHeaders = this._ttHeaders || {}
        this._ttHeaders[lk] = String(v)
        var val = String(v)
        if (/^bearer\s+/i.test(val)) val = val.replace(/^bearer\s+/i, '').trim()
        if (looksLikeAccessToken(val)) send('accessToken', val, 'xhr-req:' + (this._ttUrl || '') + ':' + n)
      }
    } catch (e) {}
    return origSetHeader.apply(this, arguments)
  }
  var origSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.send = function () {
    var self = this
    this.addEventListener('load', function () {
      try {
        var text = self.responseText
        if (!text || text.length > 4_000_000) return
        scanObject(JSON.parse(text), 'xhr-res:' + (self._ttUrl || ''), 0)
      } catch (e) {}
    })
    return origSend.apply(this, arguments)
  }

  // ── 3. STORAGE ──────────────────────────────────────────────────────────
  function scanStorage() {
    try {
      var stores = [window.localStorage, window.sessionStorage]
      for (var s = 0; s < stores.length; s++) {
        var st = stores[s]
        for (var i = 0; i < st.length; i++) {
          var key = st.key(i) || ''
          var val = st.getItem(key) || ''
          if (looksLikeAccessToken(val) && TOKEN_KEYS.test(key)) {
            send('accessToken', val, 'storage:' + key)
          }
          if (looksLikeTtoId(val) && TTO_KEYS.test(key)) {
            send('ttoId', val, 'storage:' + key)
          }
          try { scanObject(JSON.parse(val), 'storage:' + key, 0) } catch (e) {}
        }
      }
    } catch (e) {}
  }

  // ── 4. DOM (input values & visible text near token labels) ──────────────
  function scanDom() {
    try {
      var inputs = document.querySelectorAll('input, textarea')
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i]
        var v = (el.value || '').trim()
        var hint = ((el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('name') || '') + ' ' + (el.id || ''))
        if (looksLikeAccessToken(v) && /token/i.test(hint)) send('accessToken', v, 'dom:input')
        if (looksLikeTtoId(v) && /tto|account.?id/i.test(hint)) send('ttoId', v, 'dom:input')
      }
      // Teks yang bisa disalin (sering token ditampilkan di <code>/<span>)
      var nodes = document.querySelectorAll('code, pre, [data-token], [class*=token], [class*=code]')
      for (var j = 0; j < nodes.length; j++) {
        var t = (nodes[j].textContent || '').trim()
        if (looksLikeAccessToken(t)) send('accessToken', t, 'dom:text')
      }
    } catch (e) {}
  }

  // ── URL query ───────────────────────────────────────────────────────────
  try {
    new URLSearchParams(location.search).forEach(function (val, key) {
      if (TOKEN_KEYS.test(key) && looksLikeAccessToken(val)) send('accessToken', val, 'url:' + key)
      if (TTO_KEYS.test(key) && looksLikeTtoId(val)) send('ttoId', val, 'url:' + key)
    })
  } catch (e) {}

  scanStorage(); scanDom()
  setTimeout(function () { scanStorage(); scanDom() }, 2000)
  setInterval(function () { scanStorage(); scanDom() }, 10000)
})()
