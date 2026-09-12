(() => {
  const STORAGE_KEY = 'sb-mjuwtqkfhtpgavwjrual-auth-token'

  function extractTokens() {
    const results = []

    try {
      // 1. Try exact Supabase key
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        results.push('Found key: ' + STORAGE_KEY + ' (length: ' + raw.length + ')')
        let parsed
        try { parsed = JSON.parse(raw) } catch { parsed = null }

        if (parsed?.current_session?.access_token) {
          return { accessToken: parsed.current_session.access_token, refreshToken: parsed.current_session.refresh_token || '' }
        }
        if (parsed?.access_token) {
          return { accessToken: parsed.access_token, refreshToken: parsed.refresh_token || '' }
        }
        // Try nested session
        const session = parsed?.current_session || parsed?.session || parsed
        if (session?.access_token) {
          return { accessToken: session.access_token, refreshToken: session.refresh_token || '' }
        }
        results.push('Key found but no access_token inside. Keys: ' + Object.keys(parsed || {}).join(', '))
      }

      // 2. Try all keys with prefix
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || ''
        if (key.startsWith('sb-') && key.includes('auth')) {
          try {
            const val = JSON.parse(localStorage.getItem(key) || '{}')
            const session = val?.current_session || val?.session || val
            if (session?.access_token && session.access_token.includes('.')) {
              return { accessToken: session.access_token, refreshToken: session.refresh_token || '' }
            }
            results.push(key + ': no access_token (keys: ' + Object.keys(val || {}).join(', ') + ')')
          } catch {
            results.push(key + ': not JSON (length: ' + (localStorage.getItem(key) || '').length + ')')
          }
        }
      }

      // 3. Scan ALL keys for any JWT-like value
      for (let j = 0; j < localStorage.length; j++) {
        const key = localStorage.key(j) || ''
        const val = localStorage.getItem(key) || ''
        if (val.length > 100 && val.includes('.') && val.includes('eyJ')) {
          try {
            const parsed = JSON.parse(val)
            const session = parsed?.current_session || parsed?.session || parsed
            if (session?.access_token && session.access_token.includes('.')) {
              return { accessToken: session.access_token, refreshToken: session.refresh_token || '' }
            }
          } catch {}
        }
      }

      // 4. Dump all keys for debug
      const allKeys = []
      for (let k = 0; k < localStorage.length; k++) {
        const key = localStorage.key(k) || ''
        allKeys.push(key + ' (' + (localStorage.getItem(key) || '').length + ')')
      }
      results.push('All localStorage keys (' + allKeys.length + '): ' + allKeys.join(' | '))
    } catch (e) {
      results.push('Error: ' + e.message)
    }

    return { debug: results }
  }

  function sendTokens() {
    const result = extractTokens()
    if (result && result.accessToken) {
      try {
        chrome.runtime.sendMessage({
          type: 'TOKENS_CAPTURED',
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        })
      } catch {}
    } else if (result && result.debug) {
      try {
        chrome.runtime.sendMessage({
          type: 'DEBUG_INFO',
          debug: result.debug,
        })
      } catch {}
    }
  }

  sendTokens()

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sendTokens)
  }

  let retries = 0
  const interval = setInterval(() => {
    retries++
    const result = extractTokens()
    if (result && result.accessToken) {
      sendTokens()
      clearInterval(interval)
    }
    if (retries >= 10) clearInterval(interval)
  }, 1000)

  console.log('[OneOver Auth Helper] v1.1 installed')
})()