// ─── NexaBot Session Cookie Manager — Popup ─────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  var dot = document.getElementById('statusDot')
  var statusText = document.getElementById('statusText')
  var card = document.getElementById('sessionCard')
  var meta = document.getElementById('sessionMeta')
  var preview = document.getElementById('sessionPreview')
  var appUrlInput = document.getElementById('appUrl')
  var syncStatus = document.getElementById('syncStatus')
  var linkStatus = document.getElementById('linkStatus')

  function send(msg) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(msg, function (res) { resolve(res || null) })
    })
  }

  function mask(text) {
    if (!text) return ''
    if (text.length <= 70) return text
    return text.slice(0, 55) + ' … ' + text.slice(-15)
  }

  function render(session) {
    if (!session || !session.cookies) {
      dot.classList.remove('active')
      statusText.textContent = 'Belum ada cookie — login di nexabot.id'
      card.style.display = 'none'
      return
    }
    dot.classList.add('active')
    statusText.textContent = session.count + ' cookie tersimpan' + (session.hasSession ? ' · sesi terdeteksi ✓' : ' · sesi belum terverifikasi')

    card.style.display = 'block'
    meta.innerHTML =
      'Diambil: ' + new Date(session.capturedAt).toLocaleString() +
      (session.source ? ' · ' + session.source : '') +
      '<br>Kunci: ' + (session.names || []).slice(0, 8).join(', ')
    preview.textContent = mask(session.cookies)
  }

  function renderLink(linked, origin) {
    if (linked) {
      linkStatus.innerHTML = 'Terhubung ke app' + (origin ? ' (' + origin + ')' : '') + ' — credential dikirim atas nama akunmu.'
      linkStatus.className = 'meta sync-ok'
      linkStatus.style.fontSize = '10px'
    } else {
      linkStatus.innerHTML = 'Belum terhubung. Buka app ARKXMotion di tab lain & login, lalu klik tombol di atas — extension mengambil izinnya sendiri, tanpa paste token.'
      linkStatus.className = 'meta'
      linkStatus.style.fontSize = '10px'
    }
  }

  function renderSync(lastSync) {
    if (!lastSync) {
      syncStatus.textContent = 'Belum sync — pastikan server app jalan.'
      return
    }
    var when = new Date(lastSync.at).toLocaleTimeString()
    syncStatus.innerHTML = 'Sync terakhir ' + when + ' — <span class="' + (lastSync.ok ? 'sync-ok' : 'sync-bad') + '">' + lastSync.message + '</span>'
  }

  function showToast(msg) {
    var toast = document.getElementById('toast')
    toast.textContent = msg
    toast.classList.add('show')
    setTimeout(function () { toast.classList.remove('show') }, 2200)
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text)
    }
    var ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    var ok = false
    try { ok = document.execCommand('copy') } catch { ok = false }
    document.body.removeChild(ta)
    return ok ? Promise.resolve() : Promise.reject(new Error('Copy gagal'))
  }

  function refresh() {
    return send({ type: 'get_session' }).then(function (data) {
      if (!data) return
      appUrlInput.value = data.appUrl || 'http://localhost:6000'
      render(data.session)
      renderLink(data.linked, data.linkedOrigin)
      renderSync(data.lastSync)
    })
  }

  document.getElementById('copyBtn').addEventListener('click', function () {
    send({ type: 'grab', source: 'popup-copy' }).then(function (res) {
      if (!res || !res.ok || !res.session) {
        showToast((res && res.error) || 'Cookie tidak ditemukan')
        return
      }
      copyText(res.session.cookies).then(function () {
        showToast('Cookie copied — paste di Providers')
      }, function () {
        showToast('Gagal copy, pakai tombol Sync ke App')
      })
      render(res.session)
    })
  })

  document.getElementById('grabBtn').addEventListener('click', function () {
    showToast('Mengambil cookie…')
    send({ type: 'sync_now' }).then(function (res) {
      if (!res || !res.ok) {
        showToast((res && res.error) || 'Cookie tidak ditemukan')
        refresh()
        return
      }
      showToast('Cookie diambil & dikirim ke app')
      refresh()
    })
  })

  document.getElementById('linkBtn').addEventListener('click', function () {
    showToast('Mencari tab app…')
    send({ type: 'link_app' }).then(function (res) {
      if (!res || !res.ok) {
        showToast((res && res.error) || 'Gagal terhubung ke app')
        refresh()
        return
      }
      showToast('Terhubung ke app ✓')
      send({ type: 'sync_now' }).then(refresh)
    })
  })

  document.getElementById('saveAppUrl').addEventListener('click', function () {
    var url = appUrlInput.value.trim()
    if (!url) { showToast('Isi URL app dulu'); return }
    send({ type: 'set_app_url', url: url }).then(function (res) {
      appUrlInput.value = (res && res.appUrl) || url
      showToast('URL app tersimpan')
      send({ type: 'sync_now' }).then(refresh)
    })
  })

  document.getElementById('clearBtn').addEventListener('click', function () {
    send({ type: 'clear' }).then(function () {
      showToast('Cookie dihapus dari extension')
      refresh()
    })
  })

  refresh()
})
