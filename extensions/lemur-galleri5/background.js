// ─── Galleri5 Token Capture — Background Service Worker ─────────

const G5_BACKEND = 'https://aistudio-backend.calmdesert-ca599847.centralindia.azurecontainerapps.io'
const FIREBASE_API_KEY = 'AIzaSyBejuWIKZ7yQT9bdG_jnb4RrkW3DoFCNNo'

// Intercept webRequest to capture Authorization headers
try {
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      try {
        const headers = details.requestHeaders || details.tabHeaders?.[details.tabId] || []
        for (const header of headers) {
          if (header.name && header.name.toLowerCase() === 'authorization' && header.value && header.value.startsWith('Bearer ')) {
            const token = header.value.replace(/^Bearer\s+/i, '').trim()
            if (token && token.length > 50) {
              saveToken(token, details.url)
            }
          }
        }
      } catch {}
    },
    { urls: [`${G5_BACKEND}/*`] },
    ['requestHeaders']
  )
} catch {}

// Save captured token to storage
async function saveToken(token, sourceUrl) {
  try {
    const existing = await chrome.storage.local.get('galleri5_tokens')
    const tokens = existing.galleri5_tokens || []

    const payload = decodeJwtPayload(token)
    if (!payload) return

    const entry = {
      token: token,
      email: payload.email || '',
      name: payload.name || '',
      sub: payload.sub || '',
      iss: payload.iss || '',
      exp: payload.exp ? payload.exp * 1000 : null,
      aud: payload.aud || '',
      capturedAt: Date.now(),
      sourceUrl: sourceUrl || '',
    }

    const filtered = tokens.filter((t) => t.sub !== entry.sub)
    filtered.unshift(entry)

    await chrome.storage.local.set({ galleri5_tokens: filtered.slice(0, 5) })

    chrome.action.setBadgeText({ text: String(filtered.length) })
    chrome.action.setBadgeBackgroundColor({ color: '#e879f9' })
  } catch {}
}

function decodeJwtPayload(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const decoded = decodeURIComponent(
      atob(payload)
        .split('')
        .map(function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2) })
        .join('')
    )
    return JSON.parse(decoded)
  } catch {
    try {
      return JSON.parse(atob(token.split('.')[1]))
    } catch {
      return null
    }
  }
}

// Listen for messages
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'get_tokens') {
    chrome.storage.local.get('galleri5_tokens').then(function (data) {
      sendResponse({ tokens: data.galleri5_tokens || [] })
    })
    return true
  }

  if (msg.type === 'clear_tokens') {
    chrome.storage.local.remove('galleri5_tokens').then(function () {
      chrome.action.setBadgeText({ text: '' })
      sendResponse({ ok: true })
    })
    return true
  }

  if (msg.type === 'capture_from_page') {
    if (msg.token) {
      saveToken(msg.token, msg.sourceUrl || 'content-script')
      sendResponse({ ok: true })
    }
    return true
  }

  if (msg.type === 'refresh_token') {
    refreshToken(msg.refreshToken).then(function (result) {
      sendResponse(result)
    })
    return true
  }
})

// Firebase token refresh
async function refreshToken(refreshToken) {
  try {
    const res = await fetch(
      'https://securetoken.googleapis.com/v1/token?key=' + FIREBASE_API_KEY,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken),
      }
    )
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status }
    const data = await res.json()
    return {
      ok: true,
      accessToken: data.id_token || data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: Number(data.expires_in) || 3600,
    }
  } catch {
    return { ok: false, error: e.message }
  }
}
