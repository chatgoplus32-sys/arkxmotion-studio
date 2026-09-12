function showStatus(msg, type) {
  var el = document.getElementById('status')
  el.textContent = msg
  el.className = 'status ' + (type === 'error' ? 'error' : 'success')
  el.classList.remove('hidden')
  setTimeout(function() { el.classList.add('hidden') }, 5000)
}

function grabTokens() {
  chrome.storage.local.get(['accessToken', 'refreshToken', 'debugInfo', 'capturedTime'], function(result) {
    if (result.accessToken) {
      document.getElementById('refreshArea').value = result.refreshToken || '(no refresh token)'
      document.getElementById('accessArea').value = result.accessToken
      document.getElementById('tokenSection').classList.remove('hidden')
      var age = Math.round((Date.now() - (result.capturedTime || 0)) / 1000)
      showStatus('Tokens found! (' + age + 's ago)', 'success')
      return
    }

    // No tokens — show debug info
    if (result.debugInfo && result.debugInfo.length > 0) {
      var debugText = result.debugInfo.join('\n')
      document.getElementById('debugArea').value = debugText
      document.getElementById('debugSection').classList.remove('hidden')
      showStatus('No tokens found. Lihat debug info di bawah.', 'error')
    } else {
      showStatus('No tokens found. Buka oneover.com → login dulu!', 'error')
    }
  })
}

function copyRefresh() {
  var t = document.getElementById('refreshArea').value
  if (t && !t.includes('(no')) {
    navigator.clipboard.writeText(t).then(function() { showStatus('Refresh token copied!', 'success') })
  }
}

function copyAccess() {
  var t = document.getElementById('accessArea').value
  if (t) {
    navigator.clipboard.writeText(t).then(function() { showStatus('Access token copied!', 'success') })
  }
}

function copyJSON() {
  var refresh = document.getElementById('refreshArea').value
  var access = document.getElementById('accessArea').value
  var json = JSON.stringify({ access_token: access, refresh_token: refresh.includes('(no') ? '' : refresh }, null, 2)
  navigator.clipboard.writeText(json).then(function() { showStatus('JSON copied!', 'success') })
}

function clearAll() {
  chrome.storage.local.set({ accessToken: null, refreshToken: null, capturedTime: null, debugInfo: null })
  chrome.action.setBadgeText({ text: '' })
  document.getElementById('tokenSection').classList.add('hidden')
  document.getElementById('debugSection').classList.add('hidden')
  showStatus('Cleared')
}

async function reInject() {
  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    var tab = tabs[0]
    if (!tab || !tab.url || !tab.url.includes('oneover.com')) {
      showStatus('Buka oneover.com dulu!', 'error')
      return
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['inject.js'] })
    showStatus('Injected! Tunggu 3 detik lalu Grab Tokens.')
  } catch (e) {
    showStatus('Error: ' + e.message, 'error')
  }
}

async function directGrab() {
  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    var tab = tabs[0]
    if (!tab || !tab.url || !tab.url.includes('oneover.com')) {
      showStatus('Buka oneover.com dulu!', 'error')
      return
    }

    // Directly read ALL storage via scripting
    var results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const result = { keys: [], cookies: '', sessionStorage: [], tokens: null }

        // 1. Scan localStorage
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i) || ''
          const val = localStorage.getItem(key) || ''
          result.keys.push(key + ' [' + val.length + ']')
        }

        // 2. Get cookies
        result.cookies = document.cookie

        // 3. Scan sessionStorage
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i) || ''
          const val = sessionStorage.getItem(key) || ''
          result.sessionStorage.push(key + ' [' + val.length + ']')

          // Check for JWT in sessionStorage
          if (val.length > 50) {
            try {
              const parsed = JSON.parse(val)
              const session = parsed?.current_session || parsed?.session || parsed
              if (session?.access_token && session.access_token.includes('.')) {
                result.tokens = { accessToken: session.access_token, refreshToken: session.refresh_token || '', source: 'sessionStorage:' + key }
              }
              if (parsed?.access_token && parsed.access_token.includes('.') && !result.tokens) {
                result.tokens = { accessToken: parsed.access_token, refreshToken: parsed.refresh_token || '', source: 'sessionStorage:' + key }
              }
            } catch {}
          }
        }

        // 4. Check cookies for auth tokens
        if (!result.tokens && document.cookie) {
          const cookieParts = document.cookie.split(';')
          for (const part of cookieParts) {
            const [name, ...valParts] = part.trim().split('=')
            const val = valParts.join('=')

            // sb-mjuwtqkfhtpgavwjrual-auth-token=base64-...
            if (name.includes('sb-') && name.includes('auth-token')) {
              result.keys.push('COOKIE: ' + name + ' [' + val.length + ']')

              try {
                var decoded = val
                // Strip base64- prefix if present
                if (val.startsWith('base64-')) {
                  decoded = atob(val.slice(7))
                }

                const parsed = JSON.parse(decoded)
                const session = parsed?.current_session || parsed?.session || parsed
                if (session?.access_token && session.access_token.includes('.')) {
                  result.tokens = { accessToken: session.access_token, refreshToken: session.refresh_token || '', source: 'cookie:' + name }
                } else if (parsed?.access_token && parsed.access_token.includes('.')) {
                  result.tokens = { accessToken: parsed.access_token, refreshToken: parsed.refresh_token || '', source: 'cookie:' + name }
                }
              } catch (e) {
                result.keys.push('  decode error: ' + e.message)
              }
            }
          }
        }

        // 5. Check meta tags
        const metas = document.querySelectorAll('meta[name*="token"], meta[name*="auth"]')
        metas.forEach(m => {
          result.keys.push('META: ' + m.getAttribute('name') + ' = ' + (m.getAttribute('content') || '').slice(0, 50))
        })

        return result
      }
    })

    var data = results?.[0]?.result
    if (data?.tokens) {
      chrome.storage.local.set({
        accessToken: data.tokens.accessToken,
        refreshToken: data.tokens.refreshToken,
        capturedTime: Date.now(),
      })
      chrome.action.setBadgeText({ text: '!' })
      document.getElementById('refreshArea').value = data.tokens.refreshToken || '(no refresh token)'
      document.getElementById('accessArea').value = data.tokens.accessToken
      document.getElementById('tokenSection').classList.remove('hidden')
      showStatus('Tokens found from: ' + data.tokens.source, 'success')
    } else {
      var debug = '=== LOCALSTORAGE (' + data.keys.length + ') ===\n' + data.keys.join('\n')
      debug += '\n\n=== SESSIONSTORAGE (' + data.sessionStorage.length + ') ===\n' + data.sessionStorage.join('\n')
      debug += '\n\n=== COOKIES ===\n' + (data.cookies || '(empty)')
      document.getElementById('debugArea').value = debug
      document.getElementById('debugSection').classList.remove('hidden')
      showStatus('No tokens found. Copy debug info lalu kirim ke saya.', 'error')
    }
  } catch (e) {
    showStatus('Direct grab error: ' + e.message, 'error')
  }
}

document.getElementById('btnGrab').addEventListener('click', grabTokens)
document.getElementById('btnDirect').addEventListener('click', directGrab)
document.getElementById('btnCopyRefresh').addEventListener('click', copyRefresh)
document.getElementById('btnCopyAccess').addEventListener('click', copyAccess)
document.getElementById('btnCopyJSON').addEventListener('click', copyJSON)
document.getElementById('btnClear').addEventListener('click', clearAll)
document.getElementById('btnInject').addEventListener('click', reInject)

chrome.storage.local.get('accessToken', function(result) {
  if (result.accessToken) grabTokens()
})