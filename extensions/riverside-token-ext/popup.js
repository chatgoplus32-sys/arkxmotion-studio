// ─── Riverside Token Manager — Popup ───────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active') })
      document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active') })
      tab.classList.add('active')
      document.getElementById('tab-' + tab.getAttribute('data-tab')).classList.add('active')
    })
  })

  loadTokens()
  document.getElementById('addBtn').addEventListener('click', addToken)
  document.getElementById('refreshBtn').addEventListener('click', doRefresh)
  document.getElementById('clearBtn').addEventListener('click', clearAll)
  document.getElementById('saveAppUrl').addEventListener('click', saveAppUrl)

  // Load app URL setting + last sync status
  chrome.storage.local.get(['rs_app_url', 'rs_last_sync', 'rs_last_sync_msg'], function (d) {
    document.getElementById('appUrl').value = d.rs_app_url || 'http://localhost:6000'
    var status = document.getElementById('syncStatus')
    if (d.rs_last_sync) {
      status.textContent = 'Sync terakhir: ' + new Date(d.rs_last_sync).toLocaleTimeString() + (d.rs_last_sync_msg ? ' (' + d.rs_last_sync_msg + ')' : '')
    } else {
      status.textContent = 'Belum sync — buka tab dashboard riverside.com biar token terkirim otomatis.'
    }
  })

  document.getElementById('tokenList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]')
    if (!btn) return
    var action = btn.getAttribute('data-action')
    var index = parseInt(btn.getAttribute('data-i'), 10)
    if (action === 'copy') copyToken(index)
    else if (action === 'delete') deleteToken(index)
  })
})

function saveAppUrl() {
  var val = document.getElementById('appUrl').value.trim().replace(/\/+$/, '')
  if (!val) return showToast('Isi URL server dulu', false)
  chrome.storage.local.set({ rs_app_url: val }, function () {
    showToast('App URL tersimpan: ' + val, true)
  })
}

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
    list.innerHTML = '<div class="empty">No tokens yet.<br>Login di riverside.com/dashboard — token otomatis ter-capture.</div>'
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
    var preview = t.token.slice(0, 25) + '...' + t.token.slice(-12)

    html += '<div class="token-card">'
    html += '<div class="email">' + esc(t.email || t.sub || 'Riverside user') + '</div>'
    html += '<div class="meta">'
    html += t.isRefresh ? '<span class="refresh">♻️ refresh</span>' : (expired ? '<span class="expired">EXPIRED</span>' : '<span class="valid">valid</span>')
    html += ' · Exp: ' + esc(expStr)
    html += '<br>Source: ' + esc(t.source || '') + ' · Captured: ' + esc(captured)
    html += '</div>'
    html += '<div class="preview">' + esc(preview) + '</div>'
    html += '<div class="actions">'
    html += '<button class="btn btn-primary" data-action="copy" data-i="' + i + '">📋 Copy Token</button>'
    html += '<button class="btn btn-secondary" data-action="delete" data-i="' + i + '">🗑️</button>'
    html += '</div></div>'
  }
  list.innerHTML = html
}

function addToken() {
  var input = document.getElementById('addInput')
  var val = input.value.trim()
  if (!val) return showToast('Paste a token first', false)

  var token = val
  if (val.charAt(0) === '{') {
    try {
      var obj = JSON.parse(val)
      token = obj.refresh_token || obj.access_token || obj.token || ''
    } catch {
      return showToast('Invalid JSON', false)
    }
  }
  if (!token) return showToast('No token found in input', false)

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
      resultBox.innerHTML = '<b style="color:#22c55e">✅ Refreshed!</b>\n\n<b>New Access Token:</b>\n' + res.id_token + '\n\n<b>New Refresh Token:</b>\n' + res.refresh_token
      showToast('Token refreshed!')
      loadTokens()
    } else {
      resultBox.innerHTML = '<b style="color:#ef4444">❌ Failed</b>\n' + (res ? res.error : 'unknown') + '\n\n(Refresh ini hanya bekerja kalau Riverside pakai Firebase Auth — kalau gagal, ambil token langsung dari dashboard.)'
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

function deleteToken(index) {
  chrome.runtime.sendMessage({ type: 'get_tokens' }, function (res) {
    var tokens = (res && res.tokens) || []
    if (index >= tokens.length) return
    var rest = tokens.filter(function (_, i) { return i !== index })
    chrome.storage.local.set({ rs_tokens: rest }, function () {
      loadTokens()
      showToast('Token deleted')
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
    try { document.execCommand('copy'); showToast('Copied!') } catch { showToast('Failed', false) }
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