// ─── Riverside Token Manager — Background ───────────────────────

// Riverside session token — bisa JWT (eyJ...) atau Firebase refresh (AMf-...).
// Script ini menangkap keduanya dan menyimpan yang terbaik (refresh > access).

function saveToken(token, source) {
  if (!token || token.length < 20) return
  chrome.storage.local.get('rs_tokens', function (data) {
    var tokens = data.rs_tokens || []
    var payload = decodeJwt(token)
    var entry = {
      token: token,
      email: payload ? (payload.email || '') : '',
      name: payload ? (payload.name || '') : '',
      sub: payload ? (payload.sub || payload.user_id || '') : '',
      iss: payload ? (payload.iss || '') : '',
      aud: payload ? (payload.aud || '') : '',
      exp: payload && payload.exp ? payload.exp * 1000 : null,
      isRefresh: token.indexOf('AMf') === 0,
      capturedAt: Date.now(),
      source: source || '',
    }

    // Dedupe: prefer refresh token (AMf-) over access token (eyJ-) for same sub
    var filtered = tokens.filter(function (t) {
      if (entry.sub && t.sub === entry.sub) return false
      return t.token !== token
    })
    filtered.unshift(entry)

    // If we have a refresh token, drop older access tokens with same sub
    if (entry.isRefresh && entry.sub) {
      filtered = filtered.filter(function (t) {
        return !(t.sub === entry.sub && !t.isRefresh)
      })
    }

    tokens = filtered.slice(0, 10)
    chrome.storage.local.set({ rs_tokens: tokens }, function () {
      chrome.action.setBadgeText({ text: String(tokens.length) })
      chrome.action.setBadgeBackgroundColor({ color: '#ff6b6b' })
    })

    // AUTO-SYNC ke app: kirim JWT terbaru (eyJ-) ke server ARKxMotion
    // (provider='riverside'). App polling /api/sync-tokens tiap 30 detik
    // dan otomatis mengganti key yang expired — tanpa copy-paste manual.
    if (token.indexOf('eyJ') === 0) {
      syncToApp(token, 'auto:' + (source || ''))
    }
  })
}

// ── Auto-sync JWT ke app ARKxMotion ────────────────────────────
// URL server bisa diatur di popup (default http://localhost:6000)
function syncToApp(token, source) {
  chrome.storage.local.get('rs_app_url', function (data) {
    var base = (data.rs_app_url || 'http://localhost:6000').replace(/\/+$/, '')
    fetch(base + '/api/sync-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'riverside', token: token, source: source || 'extension' }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status)
        return res.json()
      })
      .then(function (data) {
        if (data && data.ok) {
          chrome.storage.local.set({ rs_last_sync: Date.now(), rs_last_sync_msg: 'OK ' + new Date().toLocaleTimeString() })
        }
      })
      .catch(function (e) {
        // Jangan ganggu user — simpan status gagal saja
        chrome.storage.local.set({ rs_last_sync_msg: 'gagal: ' + e.message })
      })
  })
}

function decodeJwt(token) {
  try {
    var parts = token.split('.')
    if (parts.length !== 3) return null
    var payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    var decoded = decodeURIComponent(
      atob(payload).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      }).join('')
    )
    return JSON.parse(decoded)
  } catch {
    try { return JSON.parse(atob(token.split('.')[1])) } catch { return null }
  }
}

// ── Read cookies via chrome.cookies ─────────────────────────────

function extractTokenFromCookies(cookies) {
  // Raw JWT in any cookie
  for (var k = 0; k < cookies.length; k++) {
    var val = cookies[k].value
    if (val && val.indexOf('eyJ') === 0 && val.indexOf('.') !== -1) {
      return { token: val, source: 'cookie:' + cookies[k].name }
    }
  }
  // JSON with token fields
  for (var m = 0; m < cookies.length; m++) {
    try {
      var obj = JSON.parse(decodeURIComponent(cookies[m].value))
      if (obj && typeof obj === 'object') {
        var cand = obj.access_token || obj.idToken || obj.refreshToken || obj.refresh_token || obj.token || obj.id_token
        if (cand && cand.length > 20) return { token: cand, source: 'cookie-json:' + cookies[m].name }
      }
    } catch {}
  }
  return null
}

function findAllTokens(callback) {
  var results = []
  var domains = ['riverside.com', '.riverside.com']
  var checked = 0

  domains.forEach(function (domain) {
    chrome.cookies.getAll({ domain: domain }, function (cookies) {
      var found = extractTokenFromCookies(cookies)
      if (found) {
        var exists = results.some(function (r) { return r.token === found.token })
        if (!exists) results.push(found)
      }
      checked++
      if (checked === domains.length) callback(results)
    })
  })
}

// ── Firebase refresh ────────────────────────────────────────────

// Refresh token via Firebase (kalau Riverside pakai Firebase Auth)
function refreshFirebaseToken(refreshToken, callback) {
  fetch('https://securetoken.googleapis.com/v1/token?key=AIzaSyBejuWIKZ7yQT9bdG_jnb4RrkW3DoFCNNo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken),
  })
    .then(function (res) {
      if (!res.ok) return callback({ ok: false, error: 'HTTP ' + res.status })
      return res.json()
    })
    .then(function (data) {
      if (data && (data.id_token || data.access_token)) {
        saveToken(data.id_token || data.access_token, 'firebase-refresh')
        callback({
          ok: true,
          id_token: data.id_token || data.access_token,
          refresh_token: data.refresh_token || refreshToken,
          expires_in: Number(data.expires_in) || 3600,
        })
      } else {
        callback({ ok: false, error: 'No token in response' })
      }
    })
    .catch(function (e) { callback({ ok: false, error: e.message }) })
}

// ── Auto-capture on riverside.com navigation ────────────────────

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.status !== 'complete') return
  if (!tab.url || tab.url.indexOf('riverside.com') === -1) return
  setTimeout(function () {
    findAllTokens(function (results) {
      results.forEach(function (r) { saveToken(r.token, 'auto-nav:' + r.source) })
    })
  }, 3000)
})

// ── Message Handler ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'get_tokens') {
    chrome.storage.local.get('rs_tokens', function (d) {
      sendResponse({ tokens: d.rs_tokens || [] })
    })
    return true
  }

  if (msg.type === 'clear_tokens') {
    chrome.storage.local.remove('rs_tokens', function () {
      chrome.action.setBadgeText({ text: '' })
      sendResponse({ ok: true })
    })
    return true
  }

  if (msg.type === 'add_token') {
    saveToken(msg.token, msg.source || 'manual')
    sendResponse({ ok: true })
    return true
  }

  if (msg.type === 'refresh') {
    refreshFirebaseToken(msg.refresh_token, sendResponse)
    return true
  }

  if (msg.type === 'scan_cookies') {
    findAllTokens(function (results) {
      results.forEach(function (r) { saveToken(r.token, 'cookie-scan:' + r.source) })
      sendResponse({ ok: true, count: results.length, tokens: results })
    })
    return true
  }
})