// ─── TikTok Symphony Token Manager — Content Script ───────────────────────
// Jalan di Symphony Creative Studio & TikTok for Business portal.
// Menangkap:
//   1. access_token (dari response /oauth2/access_token/ atau header Access-Token)
//   2. tto_id / tto account id (dari response JSON / storage / URL)
// lalu dikirim ke background untuk disimpan & auto-sync ke app.
(function () {
  'use strict'

  var SENT = {}

  function send(kind, value, source) {
    if (!value || typeof value !== 'string') return
    value = value.trim()
    if (value.length < 3) return
    var fp = kind + ':' + value.slice(0, 12) + ':' + value.length
    if (SENT[fp]) return
    SENT[fp] = true
    try {
      chrome.runtime.sendMessage({ type: 'capture', kind: kind, value: value, source: source || '' })
    } catch (e) {}
  }

  // ── Access-Token: panjang, biasanya dimulai 'sk' / '_' / base64-like ─────
  function looksLikeAccessToken(v) {
    if (!v || typeof v !== 'string') return false
    v = v.trim()
    if (v.length < 30) return false
    if (/\s/.test(v)) return false
    // Abaikan JWT app kita sendiri & hal yang jelas bukan token TikTok
    if (v.indexOf('eyJ') === 0 && v.indexOf('.') > -1) return false
    return true
  }

  function looksLikeTtoId(v) {
    if (!v || typeof v !== 'string') return false
    v = String(v).trim()
    // tto_id biasanya angka (account id) — terima digit 6-25
    return /^\d{6,25}$/.test(v)
  }

  // ── Terima pesan dari background: pindai storage & URL ───────────────────
  function scanStorage() {
    try {
      var stores = [window.localStorage, window.sessionStorage]
      for (var s = 0; s < stores.length; s++) {
        var st = stores[s]
        for (var i = 0; i < st.length; i++) {
          var key = st.key(i) || ''
          var val = st.getItem(key) || ''
          var lower = key.toLowerCase()
          // Langsung: kunci mengandung 'token'
          if (/access.?token|tto.?token|symphony.?token/.test(lower) && looksLikeAccessToken(val)) {
            send('accessToken', val, 'storage:' + key)
          }
          if (/tto.?id|account.?id|tto.?account/.test(lower) && looksLikeTtoId(val)) {
            send('ttoId', val, 'storage:' + key)
          }
          // JSON bertingkat
          try {
            var obj = JSON.parse(val)
            scanObject(obj, 'storage:' + key)
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  function scanObject(obj, source) {
    if (!obj || typeof obj !== 'object') return
    var keys = Object.keys(obj)
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i]
      var v = obj[k]
      var lk = k.toLowerCase()
      if (typeof v === 'string') {
        if (/access.?token|^token$/.test(lk) && looksLikeAccessToken(v)) send('accessToken', v, source + ':' + k)
        if (/tto.?id|tto.?account.?id|^tto$/.test(lk) && looksLikeTtoId(v)) send('ttoId', v, source + ':' + k)
      } else if (typeof v === 'object') {
        scanObject(v, source + ':' + k)
      }
    }
  }

  // ── Intercept fetch (response body) ─────────────────────────────────────
  var origFetch = window.fetch
  window.fetch = function () {
    var url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url) || ''
    var p = origFetch.apply(this, arguments)
    try {
      if (p && typeof p.clone === 'function') {
        p.clone().text().then(function (text) {
          if (!text || text.length > 2_000_000) return
          try {
            var j = JSON.parse(text)
            scanObject(j, 'fetch:' + url)
          } catch (e) {}
        }).catch(function () {})
      }
    } catch (e) {}
    return p
  }

  // ── Intercept XHR response ──────────────────────────────────────────────
  var origOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function () {
    this._ttUrl = arguments[1]
    return origOpen.apply(this, arguments)
  }
  var origSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.send = function () {
    var self = this
    this.addEventListener('load', function () {
      try {
        var text = self.responseText
        if (!text || text.length > 2_000_000) return
        var j = JSON.parse(text)
        scanObject(j, 'xhr:' + (self._ttUrl || ''))
      } catch (e) {}
    })
    return origSend.apply(this, arguments)
  }

  // ── URL (auth_code flow sering memuat id di query) ──────────────────────
  try {
    var params = new URLSearchParams(window.location.search)
    params.forEach(function (val, key) {
      var lk = key.toLowerCase()
      if (/tto.?id|account.?id/.test(lk) && looksLikeTtoId(val)) send('ttoId', val, 'url:' + key)
    })
  } catch (e) {}

  // ── Scan saat load + sesekali (SPA ganti state tanpa reload) ────────────
  scanStorage()
  setTimeout(scanStorage, 2000)
  setInterval(scanStorage, 15000)
})()
