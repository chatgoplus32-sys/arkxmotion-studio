// ─── Galleri5 Token Capture — Popup Script ─────────────────────
// No inline event handlers — uses event delegation for CSP compliance

document.addEventListener('DOMContentLoaded', function () {
  loadTokens()

  document.getElementById('refreshBtn').addEventListener('click', loadTokens)
  document.getElementById('clearBtn').addEventListener('click', clearTokens)

  // Event delegation for token card buttons
  document.getElementById('tokenList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]')
    if (!btn) return

    var action = btn.getAttribute('data-action')
    var index = parseInt(btn.getAttribute('data-index'), 10)

    if (action === 'copy') copyToken(index)
    else if (action === 'send') sendToArkx(index)
    else if (action === 'refresh') refreshToken(index)
  })
})

function loadTokens() {
  try {
    chrome.runtime.sendMessage({ type: 'get_tokens' }, function (response) {
      var tokens = (response && response.tokens) || []
      renderTokens(tokens)
    })
  } catch (e) {
    renderTokens([])
  }
}

function renderTokens(tokens) {
  var list = document.getElementById('tokenList')
  var dot = document.getElementById('statusDot')
  var statusText = document.getElementById('statusText')

  if (tokens.length === 0) {
    dot.classList.remove('active')
    statusText.textContent = 'No tokens'
    list.innerHTML = '<div class="empty"><div class="icon">&#x1f511;</div><p>No tokens captured yet.<br>Login to <a href="https://aistudio.galleri5.com" target="_blank">aistudio.galleri5.com</a> and the token will be captured automatically.</p></div>'
    return
  }

  dot.classList.add('active')
  statusText.textContent = tokens.length + ' token' + (tokens.length > 1 ? 's' : '') + ' captured'

  var html = ''
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i]
    var isExpired = t.exp && Date.now() > t.exp
    var expDate = t.exp ? new Date(t.exp).toLocaleString() : 'unknown'
    var captureDate = new Date(t.capturedAt).toLocaleString()
    var preview = t.token.slice(0, 40) + '...' + t.token.slice(-20)
    var expiredHtml = isExpired ? '<span class="expired">EXPIRED</span>' : 'Expires: ' + escapeHtml(expDate)

    html += '<div class="token-card">'
    html += '<div class="email">' + escapeHtml(t.email || 'unknown@email') + '</div>'
    html += '<div class="meta">' + escapeHtml(t.name || 'Unknown') + ' &middot; ' + expiredHtml + '<br>Captured: ' + captureDate + '</div>'
    html += '<div class="preview">' + escapeHtml(preview) + '</div>'
    html += '<div class="actions">'
    html += '<button class="btn btn-primary" data-action="copy" data-index="' + i + '">&#x1f4cb; Copy JWT</button>'
    html += '<button class="btn btn-primary" data-action="send" data-index="' + i + '">&#x1f680; Send to ARKx</button>'
    if (isExpired) {
      html += '<button class="btn btn-secondary" data-action="refresh" data-index="' + i + '">&#x1f504; Refresh</button>'
    }
    html += '</div></div>'
  }

  list.innerHTML = html
}

// ─── Actions ───────────────────────────────────────────────────

function copyToken(index) {
  chrome.runtime.sendMessage({ type: 'get_tokens' }, function (response) {
    var token = response && response.tokens && response.tokens[index] && response.tokens[index].token
    if (!token) return showToast('Token not found', false)

    navigator.clipboard.writeText(token).then(function () {
      showToast('Token copied to clipboard!')
    }).catch(function () {
      // Fallback: create textarea and copy
      var ta = document.createElement('textarea')
      ta.value = token
      ta.style.cssText = 'position:fixed;left:-9999px'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        showToast('Token copied!')
      } catch (e) {
        showToast('Failed to copy', false)
      }
      document.body.removeChild(ta)
    })
  })
}

function sendToArkx(index) {
  chrome.runtime.sendMessage({ type: 'get_tokens' }, function (response) {
    var t = response && response.tokens && response.tokens[index]
    if (!t) return showToast('Token not found', false)

    navigator.clipboard.writeText(t.token).then(function () {
      chrome.tabs.create({ url: 'https://arkxmotion-studio.vercel.app/providers' })
      showToast('Opening ARKx Motion Studio...')
    }).catch(function () {
      chrome.tabs.create({ url: 'https://arkxmotion-studio.vercel.app/providers' })
    })
  })
}

function refreshToken(index) {
  chrome.runtime.sendMessage({ type: 'get_tokens' }, function (response) {
    var t = response && response.tokens && response.tokens[index]
    if (!t) return showToast('Token not found', false)

    chrome.runtime.sendMessage({ type: 'refresh_token', refreshToken: t.token }, function (result) {
      if (result && result.ok) {
        chrome.runtime.sendMessage({
          type: 'capture_from_page',
          token: result.accessToken,
          sourceUrl: 'manual-refresh',
        }, function () {
          showToast('Token refreshed!')
          loadTokens()
        })
      } else {
        showToast('Refresh failed: ' + (result ? result.error : 'unknown'), false)
      }
    })
  })
}

function clearTokens() {
  chrome.runtime.sendMessage({ type: 'clear_tokens' }, function () {
    loadTokens()
    showToast('Tokens cleared')
  })
}

// ─── Helpers ───────────────────────────────────────────────────

function showToast(msg, success) {
  if (success === undefined) success = true
  var toast = document.getElementById('toast')
  toast.textContent = msg
  toast.style.background = success ? '#22c55e' : '#ef4444'
  toast.classList.add('show')
  setTimeout(function () { toast.classList.remove('show') }, 2500)
}

function escapeHtml(str) {
  if (!str) return ''
  var div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}
