// ─── OneOver Token Manager — Background ────────────────────────

var SUPABASE_URL = 'https://mjuwtqkfhtpgavwjrual.supabase.co'
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdXd0cWtmaHRwZ2F2d2pydWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyMzcxODgsImV4cCI6MjA4MjgxMzE4OH0.h7PCq_fZJ7JfsQtxMuqLyhSvL4JMgOvBumsw2rBwJOc'
var TOKEN_PREFIX = 'sb-mjuwtqkfhtpgavwjrual-auth-token'

// ── Token Storage ──────────────────────────────────────────────

function saveTokenPair(accessToken, refreshToken, source) {
  chrome.storage.local.get('oo_tokens', function (data) {
    var tokens = data.oo_tokens || []
    var payload = decodeJwt(accessToken)
    if (!payload) return

    var entry = {
      accessToken: accessToken,
      refreshToken: refreshToken || '',
      sub: payload.sub || '',
      email: payload.email || '',
      exp: payload.exp ? payload.exp * 1000 : null,
      capturedAt: Date.now(),
      source: source || '',
    }

    // Dedupe by sub
    var filtered = tokens.filter(function (t) { return t.sub !== entry.sub })
    filtered.unshift(entry)
    tokens = filtered.slice(0, 10)

    chrome.storage.local.set({ oo_tokens: tokens }, function () {
      chrome.action.setBadgeText({ text: String(tokens.length) })
      chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' })
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

// ── Read HttpOnly cookies via Chrome API ───────────────────────

function readAllCookiesForDomain(domain, callback) {
  chrome.cookies.getAll({ domain: domain }, function (cookies) {
    callback(cookies || [])
  })
}

function extractTokenFromCookies(cookies) {
  // 1. Look for the sb- auth token cookie (Supabase v2 format)
  //    Value format: base64-eyJhY2Nlc3NfdG9rZW4iOi...
  //    OR: eyJhY2Nlc3NfdG9rZW4iOi... (raw base64)
  for (var i = 0; i < cookies.length; i++) {
    var c = cookies[i]
    if (c.name === TOKEN_PREFIX && c.value) {
      var result = decodeSupabaseCookieValue(c.value)
      if (result) {
        result.source = 'sb-cookie:' + c.name
        return result
      }
    }
  }

  // 2. Look for chunked sb- auth tokens (sb-xxx.0, sb-xxx.1, etc.)
  var chunks = []
  for (var j = 0; j < cookies.length; j++) {
    var c2 = cookies[j]
    if (c2.name.indexOf(TOKEN_PREFIX + '.') === 0) {
      var idx = parseInt(c2.name.slice(TOKEN_PREFIX.length + 1), 10)
      chunks[idx] = c2.value
    }
  }
  if (chunks.length > 0) {
    try {
      var fullJson = chunks.join('')
      var parsed = JSON.parse(fullJson)
      var session = parsed.current_session || parsed
      if (session && session.access_token) {
        return {
          accessToken: session.access_token,
          refreshToken: session.refresh_token || '',
          source: 'chunked-cookie'
        }
      }
    } catch (e) {}
  }

  // 3. Look for raw JWT in any cookie
  for (var k = 0; k < cookies.length; k++) {
    var val = cookies[k].value
    if (val && val.indexOf('eyJ') === 0 && val.indexOf('.') !== -1) {
      return {
        accessToken: val,
        refreshToken: '',
        source: 'raw-cookie:' + cookies[k].name
      }
    }
  }

  // 4. Look for JSON with access_token in any cookie
  for (var m = 0; m < cookies.length; m++) {
    try {
      var obj = JSON.parse(cookies[m].value)
      if (obj && obj.access_token && obj.access_token.indexOf('eyJ') === 0) {
        return {
          accessToken: obj.access_token,
          refreshToken: obj.refresh_token || '',
          source: 'json-cookie:' + cookies[m].name
        }
      }
    } catch {}
  }

  return null
}

function decodeSupabaseCookieValue(value) {
  try {
    // Format: base64-eyJhY2Nlc3NfdG9rZW4iOi...
    var b64 = value
    if (value.indexOf('base64-') === 0) {
      b64 = value.slice(7) // strip 'base64-'
    }

    // Base64 decode
    var decoded = atob(b64)
    var obj = JSON.parse(decoded)

    // Supabase v2 format: { access_token, refresh_token, ... }
    // or { current_session: { access_token, refresh_token } }
    var session = obj.current_session || obj
    if (session && session.access_token && session.access_token.indexOf('eyJ') === 0) {
      return {
        accessToken: session.access_token,
        refreshToken: session.refresh_token || ''
      }
    }

    // Maybe the decoded JSON IS the access_token directly? No, it's an object.
    return null
  } catch (e) {
    console.log('[OneOver] Cookie decode error:', e.message)
    return null
  }
}

function findAllTokens(callback) {
  var results = []
  var domains = ['oneover.com', '.oneover.com', '.supabase.co', 'supabase.co']
  var checked = 0

  domains.forEach(function (domain) {
    readAllCookiesForDomain(domain, function (cookies) {
      var token = extractTokenFromCookies(cookies)
      if (token) {
        var exists = results.some(function (r) { return r.accessToken === token.accessToken })
        if (!exists) results.push(token)
      }
      checked++
      if (checked === domains.length) {
        callback(results)
      }
    })
  })
}

function getDiagnostic(callback) {
  var diag = { cookies: [], localStorage: [], found: [] }

  // Read cookies from all domains
  var domains = ['oneover.com', '.oneover.com', '.supabase.co']
  var checked = 0

  domains.forEach(function (domain) {
    readAllCookiesForDomain(domain, function (cookies) {
      cookies.forEach(function (c) {
        diag.cookies.push({
          domain: c.domain,
          name: c.name,
          value: c.value.length > 120 ? c.value.slice(0, 120) + '...' : c.value,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
        })
      })

      var token = extractTokenFromCookies(cookies)
      if (token) {
        diag.found.push({
          accessToken: token.accessToken.slice(0, 40) + '...',
          refreshToken: token.refreshToken ? token.refreshToken.slice(0, 20) + '...' : '',
          source: token.source,
          domain: domain,
        })
      }

      checked++
      if (checked === domains.length) {
        callback(diag)
      }
    })
  })
}

// ── Token Refresh ──────────────────────────────────────────────

function refreshSupabaseToken(refreshToken, callback) {
  fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
    .then(function (res) {
      if (!res.ok) return res.json().then(function (d) {
        callback({ ok: false, error: d.error_description || d.error || 'HTTP ' + res.status })
      })
      return res.json()
    })
    .then(function (data) {
      if (data && data.access_token) {
        saveTokenPair(data.access_token, data.refresh_token || refreshToken, 'supabase-refresh')
        callback({
          ok: true,
          accessToken: data.access_token,
          refreshToken: data.refresh_token || refreshToken,
          expiresIn: Number(data.expires_in) || 3600,
        })
      }
    })
    .catch(function (e) {
      callback({ ok: false, error: e.message })
    })
}

function getBalance(accessToken, callback) {
  var payload = decodeJwt(accessToken)
  var userId = payload && (payload.sub || payload.user_id)
  var url = SUPABASE_URL + '/functions/v1/get-credit-balance'
  if (userId) url += '?user_id=' + encodeURIComponent(userId)

  fetch(url, {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + accessToken, 'apikey': SUPABASE_ANON_KEY },
  })
    .then(function (res) { return res.ok ? res.json() : { error: 'HTTP ' + res.status } })
    .then(function (data) {
      callback({ ok: true, balance: data.balance != null ? data.balance : data.credits })
    })
    .catch(function (e) { callback({ ok: false, error: e.message }) })
}

// ── Auto-capture on tab update ─────────────────────────────────

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.status !== 'complete') return
  if (!tab.url || tab.url.indexOf('oneover.com') === -1) return

  setTimeout(function () {
    findAllTokens(function (results) {
      results.forEach(function (t) {
        saveTokenPair(t.accessToken, t.refreshToken, 'auto-nav')
      })
      if (results.length > 0) {
        console.log('[OneOver] Auto-captured', results.length, 'token(s)')
      }
    })
  }, 3000)
})

// ── Also capture on extension install/update ───────────────────

chrome.runtime.onInstalled.addListener(function () {
  // Try to capture tokens from currently open oneover.com tabs
  chrome.tabs.query({ url: '*://oneover.com/*' }, function (tabs) {
    tabs.forEach(function (tab) {
      setTimeout(function () {
        findAllTokens(function (results) {
          results.forEach(function (t) {
            saveTokenPair(t.accessToken, t.refreshToken, 'on-install')
          })
        })
      }, 2000)
    })
  })
})

// ── Message Handler ────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'get_tokens') {
    chrome.storage.local.get('oo_tokens', function (d) {
      sendResponse({ tokens: d.oo_tokens || [] })
    })
    return true
  }

  if (msg.type === 'clear_tokens') {
    chrome.storage.local.remove('oo_tokens', function () {
      chrome.action.setBadgeText({ text: '' })
      sendResponse({ ok: true })
    })
    return true
  }

  if (msg.type === 'add_token_pair') {
    saveTokenPair(msg.accessToken, msg.refreshToken || '', msg.source || 'manual')
    sendResponse({ ok: true })
    return true
  }

  if (msg.type === 'refresh_supabase') {
    refreshSupabaseToken(msg.refreshToken, sendResponse)
    return true
  }

  if (msg.type === 'balance') {
    getBalance(msg.accessToken, sendResponse)
    return true
  }

  if (msg.type === 'diagnostic') {
    getDiagnostic(sendResponse)
    return true
  }

  if (msg.type === 'scan_cookies') {
    findAllTokens(function (results) {
      results.forEach(function (t) {
        saveTokenPair(t.accessToken, t.refreshToken, 'cookie-scan')
      })
      sendResponse({ ok: true, count: results.length, tokens: results })
    })
    return true
  }
})
