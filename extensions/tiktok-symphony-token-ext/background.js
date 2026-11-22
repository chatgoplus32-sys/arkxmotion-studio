// ─── TikTok Symphony Token Manager — Background ───────────────────────────
// Menerima capture (accessToken + ttoId) dari content script, menyimpannya,
// lalu mengirim otomatis ke app ARKXMotion via endpoint ADMIN yang sudah ada:
//   PUT /api/admin/tiktok/credentials  { accessToken, ttoId }
//
// Butuh JWT login admin app (dibaca dari tab app, sama seperti extension lain).
// Kredensial TIDAK pernah dikirim ke host selain app yang dipilih user.

var APP_TOKEN_STORAGE_KEY = 'arkxmotion_token'
var APP_TOKEN_KEY = 'tts_app_jwt'
var APP_URL_KEY = 'tts_app_url'
var AUTO_SYNC_KEY = 'tts_auto_sync'
var CREDS_KEY = 'tts_creds'

var APP_TAB_CANDIDATES = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:6000',
  'https://arkxmotion-studio.win',
]
var DEFAULT_APP_URL = 'https://arkxmotion-studio.win'

// ── Penyimpanan kredensial hasil tangkapan ────────────────────────────────
async function saveCapture(kind, value, source) {
  var data = await chrome.storage.local.get(CREDS_KEY)
  var creds = data[CREDS_KEY] || { accessToken: '', ttoId: '' }
  var before = creds.accessToken + '|' + creds.ttoId
  if (kind === 'accessToken') creds.accessToken = value
  else if (kind === 'ttoId') creds.ttoId = value
  creds.updatedAt = Date.now()
  creds.sources = creds.sources || {}
  creds.sources[kind] = String(source || '').slice(0, 120)
  await chrome.storage.local.set({ [CREDS_KEY]: creds })
  setBadge(creds.accessToken && creds.ttoId ? '2' : creds.accessToken || creds.ttoId ? '1' : '')
  if (creds.accessToken + '|' + creds.ttoId !== before) {
    autoSync(creds)
  }
}

function setBadge(text) {
  try {
    chrome.action.setBadgeText({ text: text || '' })
    chrome.action.setBadgeBackgroundColor({ color: '#25F4EE' })
  } catch (e) {}
}

// ── Baca JWT admin dari tab app ───────────────────────────────────────────
async function readAppTokenFromTabs(base) {
  var candidates = [base].concat(APP_TAB_CANDIDATES)
  var seen = {}
  for (var i = 0; i < candidates.length; i++) {
    var origin = String(candidates[i] || '').replace(/\/+$/, '')
    if (!origin || seen[origin]) continue
    seen[origin] = true
    var tabs = []
    try { tabs = await chrome.tabs.query({ url: origin + '/*' }) } catch (e) { tabs = [] }
    for (var j = 0; j < tabs.length; j++) {
      var tab = tabs[j]
      if (tab.id == null) continue
      try {
        var res = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: function (key) { try { return localStorage.getItem(key) } catch (e) { return null } },
          args: [APP_TOKEN_STORAGE_KEY],
        })
        var token = res && res[0] && res[0].result
        if (token && typeof token === 'string' && token.length > 20) return { token: token, origin: origin }
      } catch (e) {}
    }
  }
  return null
}

async function getAppJwt(opts) {
  var settings = await chrome.storage.local.get([APP_URL_KEY, APP_TOKEN_KEY])
  var base = settings[APP_URL_KEY] || DEFAULT_APP_URL
  if (!(opts && opts.refresh) && settings[APP_TOKEN_KEY]) {
    return { token: settings[APP_TOKEN_KEY], origin: base }
  }
  var found = await readAppTokenFromTabs(base)
  if (found) await chrome.storage.local.set({ [APP_TOKEN_KEY]: found.token })
  return found
}

// ── Kirim ke app ──────────────────────────────────────────────────────────
async function postCredentials(creds, force) {
  var settings = await chrome.storage.local.get([APP_URL_KEY, AUTO_SYNC_KEY])
  if (!force && settings[AUTO_SYNC_KEY] === false) {
    return { ok: false, skipped: true, message: 'auto-sync dimatikan' }
  }
  if (!creds.accessToken || !creds.ttoId) {
    return { ok: false, message: 'Access-Token dan tto_id belum lengkap' }
  }
  var base = String(settings[APP_URL_KEY] || DEFAULT_APP_URL).replace(/\/+$/, '')
  var found = await getAppJwt({ refresh: false })
  if (!found) return { ok: false, message: 'Buka tab app sambil login sebagai admin dulu' }

  var res = await fetch(base + '/api/admin/tiktok/credentials', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + found.token,
    },
    body: JSON.stringify({ accessToken: creds.accessToken, ttoId: creds.ttoId }),
  }).catch(function (e) { return null })

  if (!res) return { ok: false, message: 'Gagal terhubung ke app' }
  var text = await res.text().catch(function () { return '' })
  var data = {}
  try { data = JSON.parse(text) } catch (e) {}
  if (!res.ok || data.ok === false) {
    // JWT kedaluwarsa → baca ulang sekali
    if (res.status === 401 || res.status === 403) {
      await chrome.storage.local.remove(APP_TOKEN_KEY)
      var fresh = await getAppJwt({ refresh: true })
      if (fresh) {
        var res2 = await fetch(base + '/api/admin/tiktok/credentials', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + fresh.token },
          body: JSON.stringify({ accessToken: creds.accessToken, ttoId: creds.ttoId }),
        }).catch(function () { return null })
        if (res2 && res2.ok) return { ok: true, message: 'terkirim', origin: base }
      }
    }
    return { ok: false, message: data.error || ('HTTP ' + res.status) }
  }
  return { ok: true, message: 'terkirim', origin: base }
}

async function autoSync(creds) {
  var r = await postCredentials(creds, false)
  await chrome.storage.local.set({
    tts_last_sync: { ok: !!r.ok, message: r.message, at: Date.now(), origin: r.origin || '' },
  })
  if (r.ok) {
    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: 'TikTok Symphony → ARKXMotion',
        message: 'Access-Token & tto_id berhasil disinkron ke aplikasi.',
      })
    } catch (e) {}
  }
}

// ── Message handler ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === 'capture') {
    saveCapture(msg.kind, msg.value, msg.source).then(function () {
      sendResponse({ ok: true })
    })
    return true
  }
  if (msg && msg.type === 'get_creds') {
    chrome.storage.local.get([CREDS_KEY, APP_URL_KEY, AUTO_SYNC_KEY, 'tts_last_sync'], function (d) {
      sendResponse({
        creds: d[CREDS_KEY] || { accessToken: '', ttoId: '' },
        appUrl: d[APP_URL_KEY] || DEFAULT_APP_URL,
        autoSync: d[AUTO_SYNC_KEY] !== false,
        lastSync: d.tts_last_sync || null,
      })
    })
    return true
  }
  if (msg && msg.type === 'set_app_url') {
    chrome.storage.local.set({ [APP_URL_KEY]: String(msg.url || DEFAULT_APP_URL) }, function () {
      chrome.storage.local.remove(APP_TOKEN_KEY)
      sendResponse({ ok: true })
    })
    return true
  }
  if (msg && msg.type === 'set_auto_sync') {
    chrome.storage.local.set({ [AUTO_SYNC_KEY]: !!msg.value }, function () { sendResponse({ ok: true }) })
    return true
  }
  if (msg && msg.type === 'send_now') {
    chrome.storage.local.get(CREDS_KEY, function (d) {
      postCredentials(d[CREDS_KEY] || { accessToken: '', ttoId: '' }, true).then(function (r) {
        chrome.storage.local.set({ tts_last_sync: { ok: !!r.ok, message: r.message, at: Date.now(), origin: r.origin || '' } })
        sendResponse(r)
      })
    })
    return true
  }
  if (msg && msg.type === 'clear') {
    chrome.storage.local.set({ [CREDS_KEY]: { accessToken: '', ttoId: '' } }, function () {
      setBadge('')
      sendResponse({ ok: true })
    })
    return true
  }
  if (msg && msg.type === 'set_manual') {
    (async function () {
      await saveCapture('accessToken', String(msg.accessToken || ''), 'manual')
      await saveCapture('ttoId', String(msg.ttoId || ''), 'manual')
      var data = await chrome.storage.local.get(CREDS_KEY)
      var r = await postCredentials(data[CREDS_KEY] || {}, true)
      await chrome.storage.local.set({ tts_last_sync: { ok: !!r.ok, message: r.message, at: Date.now(), origin: r.origin || '' } })
      sendResponse(r)
    })()
    return true
  }
})

// Init badge
chrome.storage.local.get(CREDS_KEY, function (d) {
  var c = d[CREDS_KEY] || {}
  setBadge(c.accessToken && c.ttoId ? '2' : c.accessToken || c.ttoId ? '1' : '')
})
