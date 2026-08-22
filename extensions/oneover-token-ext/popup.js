// ─── OneOver Token Manager — Popup ─────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  // Tab switching
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active') })
      document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active') })
      tab.classList.add('active')
      document.getElementById('tab-' + tab.getAttribute('data-tab')).classList.add('active')
    })
  })

  // Load existing tokens
  loadTokens()

  // Button handlers
  document.getElementById('scanBtn').addEventListener('click', scanCookies)
  document.getElementById('addBtn').addEventListener('click', addToken)
  document.getElementById('diagBtn').addEventListener('click', runDiagnostic)
  document.getElementById('clearBtn').addEventListener('click', clearAll)

  // Event delegation for token cards
  document.getElementById('tokenList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]')
    if (!btn) return
    var action = btn.getAttribute('data-action')
    var index = parseInt(btn.getAttribute('data-i'), 10)
    if (action === 'copy-access') copyAccessToken(index)
    else if (action === 'copy-refresh') copyRefreshToken(index)
    else if (action === 'copy-both') copyBothTokens(index)
    else if (action === 'balance') checkBalance(index)
  })
})

function loadTokens() {
  chrome.runtime.sendMessage({ type: 'get_tokens' }, function (res) {
    renderTokens((res && res.tokens) || [])
  })
}

function renderTokens(tokens) {
  var list = document.getElementById('tokenList')
  var dot = document.getElementById('statusDot')
  var statusText = document.getElementById('statusText')

  if (tokens.length === 0) {
    dot.classList.remove('active')
    statusText.textContent = 'No tokens'
    list.innerHTML = '<div class="empty">No tokens yet.<br>Click <b>"Scan"</b> tab to capture tokens from oneover.com.</div>'
    return
  }

  dot.classList.add('active')
  statusText.textContent = tokens.length + ' token' + (tokens.length > 1 ? 's' : '')

  var html = ''
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i]
    var expired = t.exp && Date.now() > t.exp
    var expStr = t.exp ? new Date(t.exp).toLocaleString() : '?'
    var captured = new Date(t.capturedAt).toLocaleString()
    var hasRefresh = !!t.refreshToken
    var preview = t.accessToken.slice(0, 25) + '...' + t.accessToken.slice(-12)

    html += '<div class="token-card">'
    html += '<div class="email">' + esc(t.email || t.sub || 'OneOver user') + '</div>'
    html += '<div class="meta">'
    html += (expired ? '<span class="expired">EXPIRED</span>' : '<span class="valid">Valid</span>')
    html += ' · Exp: ' + esc(expStr)
    html += ' · ' + (hasRefresh ? '♻️ has refresh' : '⚠️ no refresh')
    html += '<br>Source: ' + esc(t.source || '') + ' · Captured: ' + esc(captured)
    html += '</div>'
    html += '<div class="preview">' + esc(preview) + '</div>'
    html += '<div class="actions">'
    html += '<button class="btn btn-primary" data-action="copy-access" data-i="' + i + '">📋 Access</button>'
    if (hasRefresh) {
      html += '<button class="btn btn-secondary" data-action="copy-refresh" data-i="' + i + '">♻️ Refresh</button>'
    }
    html += '<button class="btn btn-secondary" data-action="copy-both" data-i="' + i + '">📦 JSON</button>'
    html += '<button class="btn btn-secondary" data-action="balance" data-i="' + i + '">💰</button>'
    html += '</div></div>'
  }
  list.innerHTML = html
}

// ── Scan Cookies ───────────────────────────────────────────────

function scanCookies() {
  var btn = document.getElementById('scanBtn')
  var result = document.getElementById('scanResult')
  btn.textContent = '⏳ Scanning...'
  btn.disabled = true
  result.style.display = 'block'
  result.textContent = 'Scanning cookies from oneover.com...\n'

  chrome.runtime.sendMessage({ type: 'scan_cookies' }, function (res) {
    btn.textContent = '🔍 Scan Cookies Sekarang'
    btn.disabled = false

    if (res && res.ok) {
      result.textContent += 'Found ' + res.count + ' token(s)!\n\n'
      if (res.tokens && res.tokens.length > 0) {
        res.tokens.forEach(function (t, i) {
          result.textContent += 'Token ' + (i + 1) + ':\n'
          result.textContent += '  Access: ' + t.accessToken.slice(0, 40) + '...\n'
          result.textContent += '  Refresh: ' + (t.refreshToken ? 'yes' : 'no') + '\n'
          result.textContent += '  Source: ' + t.source + '\n\n'
        })
      } else {
        result.textContent += 'No tokens found in cookies.\n'
        result.textContent += 'Make sure you are logged in to oneover.com\n'
        result.textContent += 'and the tab is still open.\n'
      }
      showToast(res.count > 0 ? 'Found ' + res.count + ' token(s)!' : 'No tokens found', res.count > 0)
      loadTokens()
    } else {
      result.textContent += 'Error: ' + (res ? res.error : 'unknown')
      showToast('Scan failed', false)
    }
  })
}

// ── Diagnostic ─────────────────────────────────────────────────

function runDiagnostic() {
  var result = document.getElementById('diagResult')
  result.style.display = 'block'
  result.textContent = 'Running diagnostic...\n'

  chrome.runtime.sendMessage({ type: 'diagnostic' }, function (diag) {
    if (!diag) {
      result.textContent += 'Error: no response from background'
      return
    }

    result.textContent += '=== COOKIES (' + diag.cookies.length + ' total) ===\n'
    diag.cookies.forEach(function (c) {
      result.textContent += '  [' + c.domain + '] ' + c.name + ' = ' + c.value
      result.textContent += ' (httpOnly:' + c.httpOnly + ', secure:' + c.secure + ')\n'
    })

    result.textContent += '\n=== TOKENS FOUND (' + diag.found.length + ') ===\n'
    if (diag.found.length > 0) {
      diag.found.forEach(function (t) {
        result.textContent += '  Access: ' + t.accessToken + '\n'
        result.textContent += '  Refresh: ' + (t.refreshToken || 'none') + '\n'
        result.textContent += '  Source: ' + t.source + ' @ ' + t.domain + '\n'
      })
    } else {
      result.textContent += '  None found!\n'
    }
  })
}

// ── Add Token ──────────────────────────────────────────────────

function addToken() {
  var input = document.getElementById('addInput')
  var val = input.value.trim()
  if (!val) return showToast('Paste a token first', false)

  var accessToken = ''
  var refreshToken = ''

  if (val.charAt(0) === '{') {
    try {
      var obj = JSON.parse(val)
      accessToken = obj.access_token || ''
      refreshToken = obj.refresh_token || ''
    } catch {
      showToast('Invalid JSON', false)
      return
    }
  } else {
    accessToken = val
  }

  if (!accessToken) return showToast('No access_token found', false)

  chrome.runtime.sendMessage({
    type: 'add_token_pair',
    accessToken: accessToken,
    refreshToken: refreshToken,
    source: 'manual'
  }, function () {
    showToast('Token added!')
    input.value = ''
    loadTokens()
  })
}

// ── Token Actions ──────────────────────────────────────────────

function copyAccessToken(index) {
  chrome.runtime.sendMessage({ type: 'get_tokens' }, function (res) {
    var t = res && res.tokens && res.tokens[index]
    if (!t) return
    copyText(t.accessToken, 'Access token copied!')
  })
}

function copyRefreshToken(index) {
  chrome.runtime.sendMessage({ type: 'get_tokens' }, function (res) {
    var t = res && res.tokens && res.tokens[index]
    if (!t || !t.refreshToken) return showToast('No refresh_token', false)
    copyText(t.refreshToken, 'Refresh token copied!')
  })
}

function copyBothTokens(index) {
  chrome.runtime.sendMessage({ type: 'get_tokens' }, function (res) {
    var t = res && res.tokens && res.tokens[index]
    if (!t) return
    var payload = JSON.stringify({ access_token: t.accessToken, refresh_token: t.refreshToken || '' })
    copyText(payload, 'JSON copied!')
  })
}

function checkBalance(index) {
  chrome.runtime.sendMessage({ type: 'get_tokens' }, function (res) {
    var t = res && res.tokens && res.tokens[index]
    if (!t) return
    chrome.runtime.sendMessage({ type: 'balance', accessToken: t.accessToken }, function (info) {
      if (info && info.balance != null) {
        showToast('Balance: ' + info.balance + ' credits')
      } else {
        showToast('Balance check failed', false)
      }
    })
  })
}

function clearAll() {
  chrome.runtime.sendMessage({ type: 'clear_tokens' }, function () {
    loadTokens()
    showToast('All tokens cleared')
  })
}

function copyText(text, msg) {
  navigator.clipboard.writeText(text).then(function () {
    showToast(msg || 'Copied!')
  }).catch(function () {
    var ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;left:-9999px'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy'); showToast(msg || 'Copied!') } catch { showToast('Failed', false) }
    document.body.removeChild(ta)
  })
}

function showToast(msg, ok) {
  if (ok === undefined) ok = true
  var toast = document.getElementById('toast')
  toast.textContent = msg
  toast.style.background = ok ? '#22c55e' : '#ef4444'
  toast.classList.add('show')
  setTimeout(function () { toast.classList.remove('show') }, 2500)
}

function esc(s) {
  if (!s) return ''
  var d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}
