// ─── Firebase Token Manager — Background ───────────────────────

var FIREBASE_API_KEY = 'AIzaSyBejuWIKZ7yQT9bdG_jnb4RrkW3DoFCNNo'
var G5_BACKEND = 'https://aistudio-backend.calmdesert-ca599847.centralindia.azurecontainerapps.io'

// Save token
function saveToken(token, source) {
  chrome.storage.local.get('fb_tokens', function (data) {
    var tokens = data.fb_tokens || []
    var payload = decodeJwt(token)
    if (!payload) return

    var entry = {
      token: token,
      email: payload.email || '',
      name: payload.name || '',
      sub: payload.sub || '',
      iss: payload.iss || '',
      aud: payload.aud || '',
      exp: payload.exp ? payload.exp * 1000 : null,
      capturedAt: Date.now(),
      source: source || '',
    }

    // Dedupe by sub
    var filtered = tokens.filter(function (t) { return t.sub !== entry.sub })
    filtered.unshift(entry)
    tokens = filtered.slice(0, 10)

    chrome.storage.local.set({ fb_tokens: tokens }, function () {
      chrome.action.setBadgeText({ text: String(tokens.length) })
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' })
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
  } catch (e) {
    try { return JSON.parse(atob(token.split('.')[1])) } catch (e2) { return null }
  }
}

// Refresh token via Firebase
function refreshToken(refreshToken, callback) {
  fetch('https://securetoken.googleapis.com/v1/token?key=' + FIREBASE_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken),
  })
    .then(function (res) {
      if (!res.ok) return callback({ ok: false, error: 'HTTP ' + res.status })
      return res.json()
    })
    .then(function (data) {
      // Save new token
      saveToken(data.id_token || data.access_token, 'firebase-refresh')
      callback({
        ok: true,
        id_token: data.id_token || data.access_token,
        refresh_token: data.refresh_token || refreshToken,
        expires_in: Number(data.expires_in) || 3600,
      })
    })
    .catch(function (e) {
      callback({ ok: false, error: e.message })
    })
}

// Get balance
function getBalance(accessToken, callback) {
  fetch(G5_BACKEND + '/api/v1/auth/me/info', {
    method: 'POST',
    headers: {
      'Accept': '*/*',
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
    .then(function (res) { return res.json() })
    .then(function (data) { callback(data) })
    .catch(function (e) { callback({ error: e.message }) })
}

// Messages
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'get_tokens') {
    chrome.storage.local.get('fb_tokens', function (d) {
      sendResponse({ tokens: d.fb_tokens || [] })
    })
    return true
  }

  if (msg.type === 'clear_tokens') {
    chrome.storage.local.remove('fb_tokens', function () {
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
    refreshToken(msg.refresh_token, function (r) {
      sendResponse(r)
    })
    return true
  }

  if (msg.type === 'balance') {
    getBalance(msg.access_token, function (r) {
      sendResponse(r)
    })
    return true
  }
})
