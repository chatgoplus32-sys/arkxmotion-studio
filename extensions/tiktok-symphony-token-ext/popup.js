(function () {
  'use strict'

  var $ = function (id) { return document.getElementById(id) }

  function toast(msg, ok) {
    var el = $('toast')
    el.textContent = msg
    el.style.background = ok ? '#166534' : '#991b1b'
    el.classList.add('show')
    setTimeout(function () { el.classList.remove('show') }, 2600)
  }

  function mask(v) {
    if (!v) return ''
    if (v.length <= 14) return v
    return v.slice(0, 8) + '…' + v.slice(-6) + ' (' + v.length + ' char)'
  }

  function load() {
    chrome.runtime.sendMessage({ type: 'get_creds' }, function (d) {
      if (!d) return
      var c = d.creds || {}
      var atk = c.accessToken || ''
      var tto = c.ttoId || ''
      $('atkVal').textContent = atk ? mask(atk) : 'belum tertangkap'
      $('atkVal').className = 'val' + (atk ? '' : ' empty')
      $('atkSrc').textContent = c.sources && c.sources.accessToken ? 'sumber: ' + c.sources.accessToken : ''
      $('ttoVal').textContent = tto ? tto : 'belum tertangkap'
      $('ttoVal').className = 'val' + (tto ? '' : ' empty')
      $('ttoSrc').textContent = c.sources && c.sources.ttoId ? 'sumber: ' + c.sources.ttoId : ''
      $('atkMark').textContent = atk ? '✓' : '✗'
      $('atkMark').className = atk ? 'check' : 'miss'
      $('ttoMark').textContent = tto ? '✓' : '✗'
      $('ttoMark').className = tto ? 'check' : 'miss'
      $('appUrl').value = d.appUrl || ''
      $('autoSync').checked = !!d.autoSync

      var complete = atk && tto
      $('dot').className = 'dot ' + (complete ? 'ok' : atk || tto ? 'warn' : '')
      $('statusText').textContent = complete
        ? 'Lengkap — siap kirim ke app'
        : atk || tto ? 'Sebagian tertangkap — buka Symphony & login' : 'Menunggu token dari browser'

      var ls = d.lastSync
      var le = $('lastSync')
      if (ls) {
        le.className = 'last ' + (ls.ok ? 'ok' : 'fail')
        le.textContent = (ls.ok ? '✓' : '✗') + ' ' + (ls.message || '') + (ls.origin ? ' · ' + ls.origin : '') + ' · ' + new Date(ls.at).toLocaleString('id-ID')
      } else {
        le.className = 'last'
        le.textContent = ''
      }
    })
  }

  $('sendBtn').addEventListener('click', function () {
    var btn = this
    btn.disabled = true
    btn.textContent = 'Mengirim…'
    chrome.runtime.sendMessage({ type: 'send_now' }, function (r) {
      btn.disabled = false
      btn.textContent = 'Kirim ke Aplikasi'
      if (r && r.ok) toast('✓ Berhasil dikirim ke aplikasi', true)
      else toast('✗ ' + (r && r.message ? r.message : 'Gagal'), false)
      setTimeout(load, 400)
    })
  })

  $('refreshBtn').addEventListener('click', function () { load(); toast('Diperbarui') })

  $('manualBtn').addEventListener('click', function () {
    var atk = $('manualAtk').value.trim()
    var tto = $('manualTto').value.trim()
    if (!atk && !tto) { toast('Isi Access-Token dan/atau tto_id', false); return }
    var btn = this
    btn.disabled = true
    btn.textContent = 'Mengirim…'
    chrome.runtime.sendMessage({ type: 'set_manual', accessToken: atk, ttoId: tto }, function (r) {
      btn.disabled = false
      btn.textContent = 'Pakai nilai ini & Kirim ke Aplikasi'
      if (r && r.ok) { toast('✓ Tersimpan & terkirim ke aplikasi', true); $('manualAtk').value = ''; $('manualTto').value = '' }
      else toast('✗ ' + (r && r.message ? r.message : 'Gagal'), false)
      setTimeout(load, 400)
    })
  })

  $('clearBtn').addEventListener('click', function () {
    if (!window.confirm('Hapus token yang tersimpan di extension?')) return
    chrome.runtime.sendMessage({ type: 'clear' }, function () { load(); toast('Dihapus') })
  })

  $('appUrl').addEventListener('change', function () {
    chrome.runtime.sendMessage({ type: 'set_app_url', url: this.value.trim() }, function () {
      toast('App URL disimpan', true)
    })
  })

  $('autoSync').addEventListener('change', function () {
    chrome.runtime.sendMessage({ type: 'set_auto_sync', value: this.checked })
  })

  load()
})()
