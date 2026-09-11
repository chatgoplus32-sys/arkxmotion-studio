// ─── NexaBot Session Cookie Manager — Content Script ────────────────────────
// Jalan di halaman nexabot.id. Tugasnya: tombol satu-klik untuk copy cookie
// session (yang diambil background lewat chrome.cookies — HttpOnly included)
// plus snapshot localStorage sebagai cadangan kalau ada token non-HttpOnly.

(function () {
  'use strict'

  var BTN_ID = 'nxb-cookie-btn'
  var COPIED = false

  function send(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (res) { resolve(res || null) })
      } catch {
        resolve(null)
      }
    })
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text)
    }
    return Promise.reject(new Error('Clipboard API tidak tersedia'))
  }

  function setLabel(btn, text, color) {
    btn.textContent = text
    if (color) btn.style.background = color
  }

  function addButton() {
    if (document.getElementById(BTN_ID)) return

    var btn = document.createElement('div')
    btn.id = BTN_ID
    btn.textContent = '🍪 Copy NexaBot Cookie'
    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;' +
      'background:linear-gradient(135deg,#00b894,#00D4AA);color:#04241f;' +
      'padding:10px 16px;border-radius:12px;font-size:13px;font-weight:700;' +
      'cursor:pointer;box-shadow:0 4px 15px rgba(0,212,170,.35);' +
      'user-select:none;font-family:system-ui'

    btn.onclick = function () {
      setLabel(btn, '⏳ Mengambil cookie...', '')
      send({ type: 'grab', source: 'inpage-button' }).then(function (res) {
        if (!res || !res.ok || !res.session) {
          setLabel(btn, '❌ ' + ((res && res.error) || 'Cookie tidak ditemukan'))
          setTimeout(function () { setLabel(btn, '🍪 Copy NexaBot Cookie', '') }, 3500)
          return
        }
        copyText(res.session.cookies).then(function () {
          COPIED = true
          setLabel(btn, '✅ Cookie copied (' + res.session.count + ') — paste di Providers')
          setTimeout(function () { setLabel(btn, '🍪 Copy NexaBot Cookie', '') }, 4000)
        }, function () {
          window.prompt('Copy cookie ini lalu paste di Providers → Session Login Unlimited:', res.session.cookies)
          setLabel(btn, '🍪 Copy NexaBot Cookie', '')
        })
      })
    }

    document.body.appendChild(btn)
  }

  // Snapshot localStorage/sessionStorage — dipakai hanya sebagai info tambahan,
  // karena cookie sesi NexaBot umumnya HttpOnly.
  function scanStorage() {
    var found = []
    function walk(storage, label) {
      try {
        for (var i = 0; i < storage.length; i++) {
          var key = storage.key(i)
          if (!key) continue
          var val = storage.getItem(key) || ''
          if (/session|token|auth|jwt/i.test(key) && val.length > 10) {
            found.push(label + ':' + key)
          }
        }
      } catch {}
    }
    walk(localStorage, 'localStorage')
    walk(sessionStorage, 'sessionStorage')
    return found
  }

  function boot() {
    addButton()
    // Laporkan ke background bahwa halaman nexabot.id sedang terbuka.
    send({ type: 'grab', source: 'content-load' })
    try {
      var keys = scanStorage()
      if (keys.length) console.log('[NexaBot extension] kunci storage terdeteksi:', keys.join(', '))
    } catch {}
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 1200)
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1200) })
  }

  // Re-inject saat SPA navigasi (tombol bisa hilang kalau body di-replace).
  var observer = new MutationObserver(function () { addButton() })
  observer.observe(document.documentElement, { childList: true, subtree: true })

  // Kalau user login di tab ini, ambil ulang cookie setelahnya.
  setInterval(function () {
    if (!COPIED) send({ type: 'grab', source: 'content-interval' })
  }, 60000)
})()
