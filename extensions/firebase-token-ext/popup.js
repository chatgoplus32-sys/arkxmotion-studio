// ─── Firebase Token Manager — Popup ────────────────────────────

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

  // Load tokens
  loadTokens()

  // Button handlers
  document.getElementById('addBtn').addEventListener('click', addToken)
  document.getElementById('doRefreshBtn').addEventListener('click', doRefresh)
  document.getElementById('clearBtn').addEventListener('click', clearAll)

  // Event delegation for token cards
  document.getElementById('tokenList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]')
    if (!btn) return
    var action = btn.getAttribute('data-action')
    var index = parseInt(btn.getAttribute('data-i'), 10)
    if (action === 'copy') copyToken(index)
    else if (action === 'copy-refresh') copyRefresh(index)
    else if (action === 'check') checkBalance(index)
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
    list.innerHTML = '<div class="empty">No tokens yet.<br>Browse to any site and login — token auto-captured.</div>'
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
    var preview = t.token.slice(0, 30) + '...' + t.token.slice(-15)

    html += '<div class="token-card">'
    html += '<div class="email">' + esc(t.email || 'unknown') + '</div>'
    html += '<div class="meta">' + esc(t.name || '') + ' &middot; ' + (expired ? '<span class="expired">EXPIRED</span>' : 'Exp: ' + esc(expStr)) + '<br>Captured: ' + esc(captured) + '</div>'
    html += '<div class="preview">' + esc(preview) + '</div>'
    html += '<div class="actions">'
    html += '<button class="btn btn-primary" data-action="copy" data-i="' + i + '">📋 Copy Token</button>'
    html += '<button class="btn btn-secondary" data-action="check" data-i="' + i + '">💰 Balance</button>'
    html += '</div></div>'
  }
  list.innerHTML = html
}

function addToken() {
  var input = document.getElementById('addInput')
  var val = input.value.trim()
  if (!val) return showToast('Paste a token first', false)

  // Detect format
  var token = val
  if (val.indexOf('{') === 0) {
    try {
      var obj = JSON.parse(val)
      token = obj.Authorization || obj.authorization || obj.token || ''
      token = token.replace(/^Bearer\s+/i, '').trim()
    } catch (e) {}
  }

  if (!token) return showToast('Invalid token format', false)

  chrome.runtime.sendMessage({ type: 'add_token', token: token, source: 'manual' }, function () {
    showToast('Token added!')
    input.value = ''
    loadTokens()
  })
}

function doRefresh() {
  var input = document.getElementById('refreshInput')
  var refreshToken = input.value.trim()
  if (!refreshToken) return showToast('Paste a refresh token first', false)

  var resultBox = document.getElementById('refreshResult')
  resultBox.style.display = 'block'
  resultBox.textContent = '🔄 Refreshing...'

  chrome.runtime.sendMessage({ type: 'refresh', refresh_token: refreshToken }, function (res) {
    if (res && res.ok) {
      resultBox.innerHTML = '<b style="color:#22c55e">✅ Refreshed!</b>\n\n<b>ID Token:</b>\n' + res.id_token + '\n\n<b>New Refresh Token:</b>\n' + res.refresh_token
      showToast('Token refreshed!')
      loadTokens()
    } else {
      resultBox.innerHTML = '<b style="color:#ef4444">❌ Failed</b>\n' + (res ? res.error : 'unknown')
    }
  })
}

function copyToken(index) {
  chrome.runtime.sendMessage({ type: 'get_tokens' }, function (res) {
    var t = res && res.tokens && res.tokens[index]
    if (!t) return
    copyText(t.token)
  })
}

function copyRefresh(index) {
  chrome.runtime.sendMessage({ type: 'get_tokens' }, function (res) {
    var t = res && res.tokens && res.tokens[index]
    if (!t) return
    copyText(t.token)
  })
}

function checkBalance(index) {
  chrome.runtime.sendMessage({ type: 'get_tokens' }, function (res) {
    var t = res && res.tokens && res.tokens[index]
    if (!t) return
    chrome.runtime.sendMessage({ type: 'balance', access_token: t.token }, function (info) {
      if (info && info.email) {
        showToast(info.email + ': ' + info.available_credits + ' credits (' + info.plan_name + ')')
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

function copyText(text) {
  navigator.clipboard.writeText(text).then(function () {
    showToast('Copied!')
  }).catch(function () {
    var ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;left:-9999px'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy'); showToast('Copied!') } catch (e) { showToast('Failed', false) }
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
